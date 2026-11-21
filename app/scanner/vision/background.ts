import type { Raster } from './detect';
import { grayscale } from './detect';
export type BackgroundProfile={width:number;height:number;aspect:number;samples:Uint8Array};
export function backgroundProfile(r:Raster):BackgroundProfile {
 const g=grayscale(r),width=96,height=Math.max(16,Math.round(width*r.height/r.width)),samples=new Uint8Array(width*height);
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){
  // Average a small neighborhood: modest sensor noise is not a new page.
  let sum=0,n=0;const cx=Math.floor((x+.5)*r.width/width),cy=Math.floor((y+.5)*r.height/height);
  for(let oy=-1;oy<=1;oy++)for(let ox=-1;ox<=1;ox++){const px=Math.max(0,Math.min(r.width-1,cx+ox)),py=Math.max(0,Math.min(r.height-1,cy+oy));sum+=g[py*r.width+px];n++;}samples[y*width+x]=sum/n;
 }
 return {width,height,aspect:r.width/r.height,samples};
}
export function matchesBackground(a:BackgroundProfile,b:BackgroundProfile):boolean {
 if(Math.abs(a.aspect-b.aspect)>.005||a.width!==b.width||a.height!==b.height)return false;
 let sum=0,changed=0;for(let i=0;i<a.samples.length;i++){const delta=Math.abs(a.samples[i]-b.samples[i]);sum+=delta;if(delta>20)changed++;}
 return sum/a.samples.length<=6&&changed/a.samples.length<=.025;
}
