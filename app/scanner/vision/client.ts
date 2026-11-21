import { REFERENCE_TEMPLATE, validateTemplate } from './template';
import type { Analysis, Geometry, SheetTemplate, RectifiedCapture } from './types';
export type VisionClient={analyze(bitmap:ImageBitmap,sessionId:string):Promise<Analysis>;rectify(bitmap:ImageBitmap,geometry:Geometry):Promise<RectifiedCapture>;calibrate(bitmap:ImageBitmap):Promise<void>;dispose():void};
export function createVisionClient(template:SheetTemplate=REFERENCE_TEMPLATE):VisionClient {
 validateTemplate(template);const worker=new Worker(new URL('./worker.ts',import.meta.url),{type:'module'});let seq=0,disposed=false,busy=false;
 const pending=new Map<number,{resolve:(value:any)=>void;reject:(error:Error)=>void;timer:ReturnType<typeof setTimeout>}>();
 const failAll=(error:Error)=>{for(const p of pending.values()){clearTimeout(p.timer);p.reject(error);}pending.clear();busy=false;};
 const terminate=(error:Error)=>{disposed=true;worker.terminate();failAll(error);};
 worker.onmessage=({data})=>{const p=pending.get(data.id);if(!p){data.result?.bitmap?.close();return;}pending.delete(data.id);clearTimeout(p.timer);if(data.ok)p.resolve(data.result??data.blob);else p.reject(Error(data.error));};
 worker.onerror=()=>terminate(Error('Ошибка обработки изображения'));
 const request=(type:string,data:Record<string,unknown>,transfer:Transferable[]=[],onSent?:()=>void):Promise<any>=>new Promise((resolve,reject)=>{
  if(disposed){reject(Error('Сканер остановлен'));return;}const id=++seq;
  const timer=setTimeout(()=>terminate(Error('Обработка изображения превысила время ожидания')),20000);
  pending.set(id,{resolve,reject,timer});try{worker.postMessage({id,type,...data},transfer);onSent?.();}catch(error){pending.delete(id);clearTimeout(timer);reject(error);}
 });
 const ready=request('init',{template});void ready.catch(()=>{});
 const withBitmap=async(type:string,bitmap:ImageBitmap,data:Record<string,unknown>)=>{
  if(disposed||busy){bitmap.close();throw Error(disposed?'Сканер остановлен':'Предыдущий кадр ещё обрабатывается');}
  busy=true;let transferred=false;
  try{await ready;return await request(type,{...data,bitmap},[bitmap],()=>{transferred=true;});}
  catch(error){if(!transferred)bitmap.close();throw error;}
  finally{busy=false;}
 };
 return {
  analyze:(bitmap,sessionId)=>withBitmap('analyze',bitmap,{sessionId}),
  rectify:(bitmap,geometry)=>withBitmap('rectify',bitmap,{geometry}),
  calibrate:async bitmap=>{await withBitmap('calibrate',bitmap,{});},
  dispose(){if(!disposed)terminate(Error('Сканер остановлен'));}
 };
}
export { REFERENCE_TEMPLATE, validateTemplate } from './template';
export type { Analysis, Geometry, SheetTemplate, RectifiedCapture } from './types';
