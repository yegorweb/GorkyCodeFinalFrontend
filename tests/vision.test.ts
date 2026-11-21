import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
function expect(value: any) { return { toBe:(expected:any)=>assert.equal(value,expected),toHaveLength:(n:number)=>assert.equal(value.length,n),toBeDefined:()=>assert.notEqual(value,undefined),toBeGreaterThan:(n:number)=>assert.ok(value>n,`${value} > ${n}`),toBeLessThan:(n:number)=>assert.ok(value<n,`${value} < ${n}`),toBeCloseTo:(n:number,d:number)=>assert.ok(Math.abs(value-n)<10**-d,`${value} ≈ ${n}`),toThrow:()=>assert.throws(value) }; }
import { inflateSync } from 'node:zlib';
import fixture from './vision-fixture.json';
import { detect, type Raster } from '../app/scanner/vision/detect';
import { area, homography, invert, project, warpRGBA } from '../app/scanner/vision/geometry';
import { REFERENCE_TEMPLATE, validateTemplate } from '../app/scanner/vision/template';
const original:Raster={width:fixture.width,height:fixture.height,data:new Uint8ClampedArray(inflateSync(Buffer.from(fixture.rgba,'base64')))};
function rotation(r:Raster,turns:number):Raster {let a=r;for(let n=0;n<turns;n++){const data=new Uint8ClampedArray(a.data.length);for(let y=0;y<a.height;y++)for(let x=0;x<a.width;x++){const src=(y*a.width+x)*4,dst=(x*a.height+(a.height-1-y))*4;data.set(a.data.subarray(src,src+4),dst);}a={data,width:a.height,height:a.width};}return a;}
describe('reference fiducials and geometry',()=>{
 it('rejects invalid templates',()=>{expect(()=>validateTemplate({})).toThrow();expect(()=>validateTemplate({...REFERENCE_TEMPLATE,markers:Array(4).fill(REFERENCE_TEMPLATE.markers[0])})).toThrow();});
 for(const turns of [0,1,2,3])it(`detects screenshot rotated ${turns*90}° and maintains canonical corners`,()=>{const r=rotation(original,turns);const d=detect(r,REFERENCE_TEMPLATE);expect(d.presence).toBe('full');expect(d.markers).toHaveLength(4);expect(d.homography).toBeDefined();expect(area(d.pageQuad!)).toBeGreaterThan(r.width*r.height*.97);const p=project(d.homography!,d.markers.find(m=>m.id==='reference-tl')!.corners[0]);expect(p.x).toBeCloseTo(9,0);expect(p.y).toBeCloseTo(13,0);});
 it('finds perspective-projected screenshot',()=>{const w=850,h=1100;const dest=[{x:72,y:63},{x:762,y:114},{x:700,y:1040},{x:116,y:1015}];const forward=homography([{x:0,y:0},{x:original.width,y:0},{x:original.width,y:original.height},{x:0,y:original.height}],dest);const data=warpRGBA(original.data,original.width,original.height,w,h,invert(forward));const d=detect({data,width:w,height:h},REFERENCE_TEMPLATE);expect(d.presence).toBe('full');d.pageQuad!.forEach((p,i)=>expect(Math.hypot(p.x-dest[i].x,p.y-dest[i].y)).toBeLessThan(5));});
 it('does not identify missing or partially hidden markers as full sheet',()=>{const data=original.data.slice();for(let y=0;y<60;y++)for(let x=0;x<60;x++){const k=(y*original.width+x)*4;data[k]=data[k+1]=data[k+2]=255;}const d=detect({...original,data},REFERENCE_TEMPLATE);expect(d.presence).toBe('partial');expect(d.quality.eligible).toBe(false);});
 it('does not treat white paper without markers as a cleared background',()=>{const data=new Uint8ClampedArray(200*200*4).fill(255);expect(detect({data,width:200,height:200},REFERENCE_TEMPLATE).presence).toBe('unknown');});
 it('accepts a plain gray empty backdrop as absent',()=>{const data=new Uint8ClampedArray(200*200*4);for(let i=0;i<data.length;i+=4){data[i]=data[i+1]=data[i+2]=100;data[i+3]=255;}expect(detect({data,width:200,height:200},REFERENCE_TEMPLATE).presence).toBe('absent');});
 it('homography is invertible and preserves correspondences',()=>{const a=[{x:0,y:0},{x:400,y:0},{x:400,y:600},{x:0,y:600}],b=[{x:20,y:40},{x:640,y:70},{x:500,y:900},{x:80,y:760}];const H=homography(a,b);a.forEach((p,i)=>{const v=project(H,p);expect(v.x).toBeCloseTo(b[i].x,5);expect(v.y).toBeCloseTo(b[i].y,5);const back=project(invert(H),v);expect(back.x).toBeCloseTo(p.x,5);expect(back.y).toBeCloseTo(p.y,5);});});
});

// Synthetic lighting regressions: geometry and payload gates must remain strict.
describe('uneven camera lighting',()=>{
 function lighting(mode:'shadow'|'gradient'|'washed-out',scale=1):Raster {
  const width=Math.round(original.width*scale),height=Math.round(original.height*scale);
  const data=warpRGBA(original.data,original.width,original.height,width,height,[1/scale,0,0,0,1/scale,0,0,0,1]);
  for(let y=0;y<height;y++)for(let x=0;x<width;x++)for(let c=0;c<3;c++){
   const k=(y*width+x)*4+c,v=data[k];
   data[k]=mode==='shadow'?(x>width*.65?v*.24+12:v):mode==='gradient'?v*(.2+.8*x/width):125+v*.26;
  }
  return {width,height,data};
 }
 for(const mode of ['shadow','gradient','washed-out'] as const)for(const scale of [1,.62]){
  it(`finds four physical markers under ${mode} at scale ${scale}`,()=>{
   const r=lighting(mode,scale),d=detect(r,REFERENCE_TEMPLATE);
   assert.equal(d.presence,'full');assert.equal(d.markers.length,4);
   assert.equal(new Set(d.markers.map(m=>m.id)).size,4);
   const expected=[{x:0,y:0},{x:r.width,y:0},{x:r.width,y:r.height},{x:0,y:r.height}];
   d.pageQuad!.forEach((p,i)=>assert.ok(Math.hypot(p.x-expected[i].x,p.y-expected[i].y)<6));
  });
 }
 it('does not recover a genuinely hidden marker from shadows',()=>{
  const r=lighting('shadow');
  for(let y=0;y<65;y++)for(let x=0;x<65;x++){const k=(y*r.width+x)*4;r.data[k]=r.data[k+1]=r.data[k+2]=255;}
  const d=detect(r,REFERENCE_TEMPLATE);
  assert.equal(d.presence,'partial');assert.equal(d.quality.eligible,false);
  assert.match(d.quality.reasons[0],/сверху слева/);
 });
 it('does not decode plain black squares as known markers',()=>{
  const width=400,height=600,data=new Uint8ClampedArray(width*height*4).fill(255);
  for(const [xx,yy] of [[15,15],[350,15],[350,550],[15,550]]){
   for(let y=yy;y<yy+30;y++)for(let x=xx;x<xx+30;x++)for(let c=0;c<3;c++)data[(y*width+x)*4+c]=0;
  }
  const d=detect({width,height,data},REFERENCE_TEMPLATE);
  assert.equal(d.markers.length,0);assert.equal(d.quality.eligible,false);
 });
 it('keeps physically separate duplicate IDs ambiguous',()=>{
  const width=900,height=1050,data=new Uint8ClampedArray(width*height*4).fill(255);
  for(let y=0;y<original.height;y++)for(let x=0;x<original.width;x++){
   data.set(original.data.subarray((y*original.width+x)*4,(y*original.width+x)*4+4),((y+20)*width+x+20)*4);
  }
  for(let y=10;y<48;y++)for(let x=6;x<44;x++){
   data.set(original.data.subarray((y*original.width+x)*4,(y*original.width+x)*4+4),((y+300)*width+x+790)*4);
  }
  const d=detect({width,height,data},REFERENCE_TEMPLATE);
  assert.equal(d.markers.filter(m=>m.id==='reference-tl').length,2);
  assert.equal(d.presence,'partial');assert.equal(d.quality.eligible,false);
 });
});
