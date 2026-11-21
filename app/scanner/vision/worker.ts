/// <reference lib="webworker" />
import { detect } from './detect';
import { decodeQrFromRaster } from './qr';
import { backgroundProfile, matchesBackground, type BackgroundProfile } from './background';
import { invert, warpRGBA } from './geometry';
import { REFERENCE_TEMPLATE, validateTemplate } from './template';
import type { Analysis, Geometry, SheetTemplate } from './types';
let template:SheetTemplate=REFERENCE_TEMPLATE;
let background:BackgroundProfile|null=null;
const scope=self as unknown as DedicatedWorkerGlobalScope;
scope.onmessage=async(event:MessageEvent)=>{const {id,type}=event.data;let bitmap:ImageBitmap|undefined=event.data.bitmap;
 try{
 if(type==='init'){template=validateTemplate(event.data.template);background=null;scope.postMessage({id,ok:true});return;}
 if(!bitmap)throw Error('Кадр отсутствует');
 if(type==='analyze'||type==='calibrate'){
  const scale=Math.min(1,1280/Math.max(bitmap.width,bitmap.height));const width=Math.round(bitmap.width*scale),height=Math.round(bitmap.height*scale);const canvas=new OffscreenCanvas(width,height);const ctx=canvas.getContext('2d',{willReadFrequently:true});if(!ctx)throw Error('Canvas недоступен');ctx.drawImage(bitmap,0,0,width,height);const raster=ctx.getImageData(0,0,width,height);const d=detect(raster,template);
  if(type==='calibrate'){if(d.markers.length)throw Error('Уберите лист и маркеры перед запоминанием фона');background=backgroundProfile(raster);bitmap.close();bitmap=undefined;scope.postMessage({id,ok:true});return;}
  if(background&&!d.markers.length){d.presence=matchesBackground(backgroundProfile(raster),background)?'absent':'unknown';}
  const sx=width/bitmap.width,sy=height/bitmap.height;const quad=d.pageQuad?.map(p=>({x:p.x/sx,y:p.y/sy})) as Analysis['quad']|undefined;
  // Detection homography maps reduced image to template; compose source scaling.
  const h=d.homography?.map((v,i)=>i===0||i===3||i===6?v*sx:i===1||i===4||i===7?v*sy:v);
  const geometry:Geometry|null=h&&quad?{homography:h,quad,templateWidth:template.width,templateHeight:template.height,frameWidth:bitmap.width,frameHeight:bitmap.height}:null;
  const result:Analysis={sessionId:event.data.sessionId,width:bitmap.width,height:bitmap.height,markers:d.markers.map(m=>({...m,corners:m.corners.map(p=>({x:p.x/sx,y:p.y/sy})) as typeof m.corners})),quad:quad??null,presence:d.presence,quality:d.quality,bitmap,geometry};
  scope.postMessage({id,ok:true,result},[bitmap]);bitmap=undefined;return;
 }
 if(type==='rectify'){
  const g:Geometry=event.data.geometry;if(g.frameWidth!==bitmap.width||g.frameHeight!==bitmap.height)throw Error('Геометрия не соответствует кадру');
  const inverse=invert(g.homography);const q=g.quad;const dist=(a:number,b:number)=>Math.hypot(q[a].x-q[b].x,q[a].y-q[b].y);
  const outScale=Math.min(3000/g.templateHeight,3000/g.templateWidth,(dist(0,1)+dist(3,2))/(2*g.templateWidth),(dist(0,3)+dist(1,2))/(2*g.templateHeight));
  const w=Math.max(1,Math.round(g.templateWidth*outScale)),h=Math.max(1,Math.round(g.templateHeight*outScale));
  const source=new OffscreenCanvas(bitmap.width,bitmap.height),ctx=source.getContext('2d',{willReadFrequently:true});if(!ctx)throw Error('Canvas недоступен');ctx.drawImage(bitmap,0,0);const raw=ctx.getImageData(0,0,bitmap.width,bitmap.height);
  const outputToSource=[inverse[0]/outScale,inverse[1]/outScale,inverse[2],inverse[3]/outScale,inverse[4]/outScale,inverse[5],inverse[6]/outScale,inverse[7]/outScale,inverse[8]];
  const pixels=warpRGBA(raw.data,raw.width,raw.height,w,h,outputToSource);const qr=decodeQrFromRaster({data:pixels,width:w,height:h},undefined,{raster:raw,geometry:g});const canvas=new OffscreenCanvas(w,h);const dest=canvas.getContext('2d');if(!dest)throw Error('Canvas недоступен');dest.putImageData(new ImageData(new Uint8ClampedArray(pixels),w,h),0,0);const blob=await canvas.convertToBlob({type:'image/jpeg',quality:.94});bitmap.close();bitmap=undefined;scope.postMessage({id,ok:true,result:{blob,qr}});return;
 }
 throw Error('Неизвестная команда');
 }catch(error){bitmap?.close();scope.postMessage({id,ok:false,error:error instanceof Error?error.message:String(error)});}
};
