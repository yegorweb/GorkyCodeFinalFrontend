import jsQR from 'jsqr';
import type { Raster } from './detect';
import { invert, project } from './geometry';
import type { Geometry, QrPayload, Point } from './types';
const MAX_BYTES=8192;
export class QrError extends Error {
 constructor(public readonly code:'QR_MISSING'|'QR_INVALID'|'QR_CONFLICT',message:string){super(`${code}: ${message}`);this.name='QrError';}
}
function finiteJson(value:unknown):boolean {
 if(typeof value==='number')return Number.isFinite(value);
 if(Array.isArray(value))return value.every(finiteJson);
 if(value!==null&&typeof value==='object')return Object.values(value).every(finiteJson);
 return true;
}
/** Decode JSON data only. Its fields are untrusted metadata, never executable instructions. */
export function parseQrPayload(input:string|Uint8Array):QrPayload {
 let raw:string;
 if(typeof input==='string'){if(new TextEncoder().encode(input).byteLength>MAX_BYTES)throw new QrError('QR_INVALID','Данные QR превышают 8 КиБ');raw=input;}
 else{if(input.byteLength>MAX_BYTES)throw new QrError('QR_INVALID','Данные QR превышают 8 КиБ');try{raw=new TextDecoder('utf-8',{fatal:true}).decode(input);}catch{throw new QrError('QR_INVALID','QR должен содержать UTF-8');}}
 if(!raw.trim())throw new QrError('QR_INVALID','QR не содержит данных');
 let data:unknown;try{data=JSON.parse(raw);}catch{return {raw,data:null,format:'text'};}
 if(data===null||Array.isArray(data)||typeof data!=='object'||!finiteJson(data))return {raw,data:null,format:'text'};
 return {raw,data:data as Record<string,unknown>,format:'json'};
}
type FoundQr={binaryData:number[];location:{topLeftCorner:Point;topRightCorner:Point;bottomRightCorner:Point;bottomLeftCorner:Point}};
export type QrDecoder=(data:Uint8ClampedArray,width:number,height:number)=>FoundQr|null;
const defaultDecoder:QrDecoder=(data,w,h)=>jsQR(data,w,h,{inversionAttempts:'attemptBoth'});
function crop(r:Raster,x:number,y:number,w:number,h:number,scale:number):Raster {
 const width=w*scale,height=h*scale,data=new Uint8ClampedArray(width*height*4);
 for(let yy=0;yy<height;yy++)for(let xx=0;xx<width;xx++){const src=((y+Math.floor(yy/scale))*r.width+x+Math.floor(xx/scale))*4;data.set(r.data.subarray(src,src+4),(yy*width+xx)*4);}
 return {data,width,height};
}
function rotate(r:Raster,turns:number):Raster {
 for(let n=0;n<turns;n++){
  const data=new Uint8ClampedArray(r.data.length);
  for(let y=0;y<r.height;y++)for(let x=0;x<r.width;x++){
   const src=(y*r.width+x)*4,dst=(x*r.height+r.height-1-y)*4;
   data.set(r.data.subarray(src,src+4),dst);
  }
  r={data,width:r.height,height:r.width};
 }
 return r;
}
function canonical(value:unknown):string {
 if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';
 if(value!==null&&typeof value==='object'){const object=value as Record<string,unknown>;return '{'+Object.keys(object).sort().map(k=>JSON.stringify(k)+':'+canonical(object[k])).join(',')+'}';}
 return JSON.stringify(value);
}
type QrRegion={x:number;y:number;width:number;height:number};
type SourceFrame={raster:Raster;geometry:Geometry};
/** Keep QR validation identical for rectified pixels and untouched source pixels. */
function decodeRegion(r:Raster,decoder:QrDecoder,region:QrRegion,toPage:(p:Point)=>Point,turns=0):QrPayload {
 const payloads:QrPayload[]=[];
 const scan=(x:number,y:number,w:number,h:number,scale:number)=>{
  const image=rotate(crop(r,x,y,w,h,scale),turns);
  for(let i=0;i<8;i++){
   const qr=decoder(image.data,image.width,image.height);if(!qr)break;
   const corners=[qr.location.topLeftCorner,qr.location.topRightCorner,qr.location.bottomRightCorner,qr.location.bottomLeftCorner];
   if(corners.some(p=>!Number.isFinite(p.x)||!Number.isFinite(p.y)))break;
   const cx=corners.reduce((s,p)=>s+p.x,0)/4,cy=corners.reduce((s,p)=>s+p.y,0)/4;
   const center=turns===1?{x:cy,y:h*scale-1-cx}:turns===2?{x:w*scale-1-cx,y:h*scale-1-cy}
    :turns===3?{x:w*scale-1-cy,y:cx}:{x:cx,y:cy};
   const page=toPage({x:x+center.x/scale,y:y+center.y/scale});
   if(page.x>=.6&&page.x<=1&&page.y>=0&&page.y<=.22){payloads.push(parseQrPayload(new Uint8Array(qr.binaryData)));}
   // Remove only the decoded symbol in the scratch buffer to discover a second QR.
   const left=Math.max(0,Math.floor(Math.min(...corners.map(p=>p.x)))-2),right=Math.min(image.width,Math.ceil(Math.max(...corners.map(p=>p.x)))+3);
   const top=Math.max(0,Math.floor(Math.min(...corners.map(p=>p.y)))-2),bottom=Math.min(image.height,Math.ceil(Math.max(...corners.map(p=>p.y)))+3);
   if(left>=right||top>=bottom)break;
   for(let yy=top;yy<bottom;yy++)for(let xx=left;xx<right;xx++){const p=(yy*image.width+xx)*4;image.data[p]=image.data[p+1]=image.data[p+2]=255;image.data[p+3]=255;}
  }
 };
 const {x,y,width,height}=region;
 if(width>0&&height>0)scan(x,y,width,height,1);
 // Nearest-neighbor 2x retry preserves original cell values; it does not invent detail.
 if(!payloads.length&&width>0&&height>0&&width*height<=1_000_000)scan(x,y,width,height,2);
 if(!payloads.length)scan(0,0,r.width,r.height,1);
 if(!payloads.length)throw new QrError('QR_MISSING','QR в правом верхнем углу не прочитан. Поднесите лист ближе и держите неподвижно');
 const signature=(p:QrPayload)=>p.format==='json'?canonical(p.data):p.raw;
 const first=signature(payloads[0]);if(payloads.some(p=>signature(p)!==first))throw new QrError('QR_CONFLICT','В правом верхнем углу найдены разные QR');
 return payloads[0];
}

/** Accept only the page's upper-right QR, including when the camera is rotated. */
export function decodeQrFromRaster(r:Raster,decoder:QrDecoder=defaultDecoder,source?:SourceFrame):QrPayload {
 const x=Math.floor(r.width*.6);
 try {
  return decodeRegion(r,decoder,{x,y:0,width:r.width-x,height:Math.max(1,Math.ceil(r.height*.22))},
   p=>({x:p.x/r.width,y:p.y/r.height}));
 } catch(error) {
  // A conflict or invalid payload must never be hidden by a different decode.
  if(!(error instanceof QrError)||error.code!=='QR_MISSING'||!source)throw error;
 }
 const {raster,geometry:g}=source;
 const inverse=invert(g.homography);
 const corners=[{x:.6,y:0},{x:1,y:0},{x:1,y:.22},{x:.6,y:.22}]
  .map(p=>project(inverse,{x:p.x*g.templateWidth,y:p.y*g.templateHeight}));
 // Crop untouched pixels: interpolation can erase small QR cells.
 const left=Math.max(0,Math.floor(Math.min(...corners.map(p=>p.x)))-4);
 const top=Math.max(0,Math.floor(Math.min(...corners.map(p=>p.y)))-4);
 const right=Math.min(raster.width,Math.ceil(Math.max(...corners.map(p=>p.x)))+4);
 const bottom=Math.min(raster.height,Math.ceil(Math.max(...corners.map(p=>p.y)))+4);
 // Exact quarter-turns reorder pixels without blurring their black/white cells.
 const angle=Math.atan2(corners[1].y-corners[0].y,corners[1].x-corners[0].x);
 const turns=(4-Math.round(angle/(Math.PI/2)))%4;
 return decodeRegion(raster,decoder,{x:left,y:top,width:right-left,height:bottom-top},p=>{
  const page=project(g.homography,p);
  return {x:page.x/g.templateWidth,y:page.y/g.templateHeight};
 },turns);
}
