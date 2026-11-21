import type { Detection, MarkerReference, Point, Quad, SheetTemplate } from './types';
import { area, homography, invert, project, reduceQuad } from './geometry';
export type Raster={data:Uint8ClampedArray;width:number;height:number};
export function grayscale(r:Raster):Uint8Array {const g=new Uint8Array(r.width*r.height);for(let i=0;i<g.length;i++)g[i]=(r.data[i*4]*77+r.data[i*4+1]*150+r.data[i*4+2]*29)>>8;return g;}
function threshold(g:Uint8Array):number {const hist=new Float64Array(256);for(const p of g)hist[p]++;let sum=0;for(let i=0;i<256;i++)sum+=i*hist[i];let count=0,partial=0,best=0,cut=100;for(let i=0;i<255;i++){count+=hist[i];partial+=i*hist[i];if(!count||count===g.length)continue;const d=partial/count-(sum-partial)/(g.length-count),score=count*(g.length-count)*d*d;if(score>best){best=score;cut=i;}}return Math.min(180,Math.max(50,cut+8));}
function candidates(g:Uint8Array,w:number,h:number,cut:number):Quad[]{const seen=new Uint8Array(w*h),queue=new Int32Array(w*h),out:Quad[]=[];for(let sy=1;sy<h-1;sy++)for(let sx=1;sx<w-1;sx++){const seed=sy*w+sx;if(seen[seed]||g[seed]>=cut)continue;let head=0,tail=1,minx=sx,maxx=sx,miny=sy,maxy=sy;queue[0]=seed;seen[seed]=1;const edge:Point[]=[];while(head<tail){const k=queue[head++],x=k%w,y=(k/w)|0;minx=Math.min(minx,x);maxx=Math.max(maxx,x);miny=Math.min(miny,y);maxy=Math.max(maxy,y);let boundary=false;for(const n of [k-1,k+1,k-w,k+w]){if(n<0||n>=g.length||Math.abs(n%w-x)>1){boundary=true;continue;}if(g[n]>=cut){boundary=true;continue;}if(!seen[n]){seen[n]=1;queue[tail++]=n;}}if(boundary)edge.push({x,y});}
 const bw=maxx-minx+1,bh=maxy-miny+1;if(tail<45||bw<9||bh<9||bw/bh<.3||bw/bh>3.3||bw*bh>w*h*.12||tail/(bw*bh)<.2)continue;const q=reduceQuad(edge);if(!q||area(q)<60||area(q)/(bw*bh)<.45)continue;out.push(q);if(out.length>300)return out;}return out;}
// Local means separate dark cells from light cells even when a marker is in shadow.
function sample(g:Uint8Array,w:number,h:number,q:Quad,n:number):number[]|null {
 const H=homography([{x:0,y:0},{x:n,y:0},{x:n,y:n},{x:0,y:n}],q);
 const values=new Uint8Array(n*n);
 for(let j=0;j<n;j++)for(let i=0;i<n;i++){
  let sum=0,count=0;
  for(const oy of [.3,.5,.7])for(const ox of [.3,.5,.7]){
   const p=project(H,{x:i+ox,y:j+oy}),x=Math.round(p.x),y=Math.round(p.y);
   if(x>=0&&y>=0&&x<w&&y<h){sum+=g[y*w+x];count++;}
  }
  if(count!==9)return null;
  values[j*n+i]=Math.round(sum/count);
 }
 const lo=Math.min(...values),hi=Math.max(...values);
 if(hi-lo<20)return null;
 // Normalize locally so the existing Otsu implementation's global clamps do not
 // impose an absolute brightness requirement on a shadowed marker.
 const normalized=Uint8Array.from(values,v=>Math.round((v-lo)*255/(hi-lo)));
 const cut=threshold(normalized);
 return Array.from(normalized,v=>v<cut?1:0);
}

function adaptiveMask(g:Uint8Array,w:number,h:number,window:number):Uint8Array {
 const stride=w+1,integral=new Float64Array(stride*(h+1));
 for(let y=0;y<h;y++){
  let row=0;
  for(let x=0;x<w;x++){row+=g[y*w+x];integral[(y+1)*stride+x+1]=integral[y*stride+x+1]+row;}
 }
 const out=new Uint8Array(g.length),radius=Math.floor(window/2);
 for(let y=0;y<h;y++)for(let x=0;x<w;x++){
  const x0=Math.max(0,x-radius),x1=Math.min(w,x+radius+1),y0=Math.max(0,y-radius),y1=Math.min(h,y+radius+1);
  const mean=(integral[y1*stride+x1]-integral[y0*stride+x1]-integral[y1*stride+x0]+integral[y0*stride+x0])/((x1-x0)*(y1-y0));
  out[y*w+x]=g[y*w+x]<mean-Math.max(4,mean*.035)?0:255;
 }
 return out;
}

function error(bits:number[],ref:MarkerReference,rotation:number):number {const n=ref.size;let bad=0;for(let y=0;y<n;y++)for(let x=0;x<n;x++){let xx=x,yy=y;for(let r=0;r<rotation;r++){const tmp=xx;xx=n-1-yy;yy=tmp;}if(bits[yy*n+xx]!==ref.bits[y*n+x])bad++;}return bad;}
export function detect(r:Raster,t:SheetTemplate,frameId=0):Detection {const {width:w,height:h}=r,g=grayscale(r),cut=threshold(g);const found:Detection['markers']=[];
 const collect=(quads:Quad[])=>{
  for(const q of quads){
   const sizes=new Map<number,number[]|null>();
   const matches:{ref:MarkerReference;rotation:number;bad:number}[]=[];
   for(const ref of t.markers){
    if(!sizes.has(ref.size))sizes.set(ref.size,sample(g,w,h,q,ref.size));
    const bits=sizes.get(ref.size);if(!bits)continue;
    for(let rot=0;rot<4;rot++)matches.push({ref,rotation:rot,bad:error(bits,ref,rot)});
   }
   matches.sort((a,b)=>a.bad-b.bad);const best=matches[0];
   if(!best||best.bad>Math.floor(best.ref.size**2*.08)||(matches[1]&&matches[1].bad-best.bad<2))continue;
   const corners=[0,1,2,3].map(i=>q[(i+best.rotation)%4]) as Quad;
   const marker={id:best.ref.id,corners,error:best.bad/(best.ref.size**2)};
   const center=(points:Quad)=>({x:points.reduce((s,p)=>s+p.x,0)/4,y:points.reduce((s,p)=>s+p.y,0)/4});
   const c=center(corners),side=Math.sqrt(area(corners));
   // Multiple thresholds may find the same physical marker. Merge only spatially
   // overlapping observations; distinct copies of an ID must remain ambiguous.
   const existing=found.findIndex(m=>{
    const a=area(m.corners),ratio=a/area(corners),p=center(m.corners);
    return ratio>.5&&ratio<2&&Math.hypot(c.x-p.x,c.y-p.y)<side*.3;
   });
   if(existing<0)found.push(marker);
   else if(marker.error<found[existing].error)found[existing]=marker;
  }
 };
 collect(candidates(g,w,h,cut));
 const complete=()=>found.length===4&&t.markers.every(ref=>found.filter(m=>m.id===ref.id).length===1);
 // The fast global pass handles even light. Local thresholds recover shadowed
 // borders without loosening payload matching or inventing missing corners.
 for(const window of [31,71]){
  if(complete())break;
  collect(candidates(adaptiveMask(g,w,h,window),w,h,128));
 }
 let presence:Detection['presence']=found.length?'partial':'unknown';let H:number[]|undefined,pageQuad:Quad|undefined;const unique=t.markers.every(ref=>found.filter(m=>m.id===ref.id).length===1);
 if(unique&&found.length===4){try{const src:Point[]=[],dst:Point[]=[];for(const ref of t.markers){const m=found.find(v=>v.id===ref.id)!;src.push(...m.corners);dst.push(...ref.pageCorners);}H=homography(src,dst);const inverse=invert(H);pageQuad=[{x:0,y:0},{x:t.width,y:0},{x:t.width,y:t.height},{x:0,y:t.height}].map(p=>project(inverse,p)) as Quad;const residual=src.reduce((s,p,i)=>{const a=project(H!,p),b=dst[i];return s+Math.hypot(a.x-b.x,a.y-b.y);},0)/src.length;const inside=pageQuad.every(p=>Number.isFinite(p.x)&&Number.isFinite(p.y)&&p.x>=-w*.015&&p.y>=-h*.015&&p.x<=w*1.015&&p.y<=h*1.015);if(residual<Math.max(t.width,t.height)*.008&&inside&&area(pageQuad)>w*h*.1)presence='full';else{H=undefined;pageQuad=undefined;}}catch{H=undefined;pageQuad=undefined;}}
 let sum=0,sumSq=0,bright=0;for(const v of g){sum+=v;sumSq+=v*v;if(v>200)bright++;}const mean=sum/g.length,std=Math.sqrt(Math.max(0,sumSq/g.length-mean*mean));
 // Conservative empty-desk heuristic: no known markers and almost no pale paper.
 // White desks remain UNKNOWN; use a contrasting matte backing for automatic rearming.
 if(!found.length&&mean>30&&mean<190&&(std<9||bright/g.length<.12))presence='absent';
 const coverage=pageQuad?area(pageQuad)/(w*h):0;const reasons:string[]=[];let sharpness=0,contrast=0;
 if(presence==='full'&&H){const inv=invert(H);let lap=0,lap2=0,n=0,lo=255,hi=0;const pw=420,ph=Math.round(pw*t.height/t.width);const pgray=new Uint8Array(pw*ph);for(let y=0;y<ph;y++)for(let x=0;x<pw;x++){const p=project(inv,{x:x*t.width/pw,y:y*t.height/ph});pgray[y*pw+x]=g[Math.min(h-1,Math.max(0,Math.round(p.y)))*w+Math.min(w-1,Math.max(0,Math.round(p.x)))];}
 for(let y=Math.round(ph*.1);y<ph*.82-1;y++)for(let x=Math.round(pw*.06);x<pw*.94-1;x++){const k=y*pw+x,v=pgray[k];lo=Math.min(lo,v);hi=Math.max(hi,v);const l=4*v-pgray[k-1]-pgray[k+1]-pgray[k-pw]-pgray[k+pw];lap+=l;lap2+=l*l;n++;}sharpness=n?lap2/n-(lap/n)**2:0;contrast=hi-lo;
 if(sharpness<18)reasons.push('Изображение размыто');if(contrast<40)reasons.push('Недостаточный контраст');if(coverage<.18)reasons.push('Поднесите лист ближе');const edges=pageQuad!.map((p,i)=>Math.hypot(p.x-pageQuad![(i+1)%4].x,p.y-pageQuad![(i+1)%4].y));if(Math.min(...edges)<180)reasons.push('Недостаточное разрешение страницы');
 }else {
 const labels:Record<string,string>={tl:'сверху слева',tr:'сверху справа',br:'снизу справа',bl:'снизу слева'};
 const missing=t.markers.filter(ref=>!found.some(m=>m.id===ref.id));
 reasons.push(!found.length?'Лист не найден':missing.length?`Не распознаны метки на бланке: ${missing.map(m=>labels[m.role]).join(', ')}. Приблизьте лист и проверьте свет`:'Метки найдены, но геометрия не согласована. Расправьте лист и покажите его целиком');
 }
 return {frameId,width:w,height:h,presence,markers:found,pageQuad,homography:H,quality:{eligible:presence==='full'&&!reasons.length,score:Math.log1p(sharpness)*Math.sqrt(coverage),sharpness,contrast,coverage,reasons}};
}
