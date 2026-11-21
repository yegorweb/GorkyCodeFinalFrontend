import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { backgroundProfile, matchesBackground } from '../app/scanner/vision/background';
import { createVisionClient } from '../app/scanner/vision/client';
function raster(value:number,width=192,height=192){const data=new Uint8ClampedArray(width*height*4);for(let i=0;i<data.length;i+=4){data[i]=data[i+1]=data[i+2]=value;data[i+3]=255;}return {data,width,height};}
describe('explicit empty background',()=>{
 it('matches white empty desk with modest brightness noise',()=>{assert.ok(matchesBackground(backgroundProfile(raster(250)),backgroundProfile(raster(247))));});
 it('rejects a large covering object',()=>{const desk=raster(245),covered=raster(245);for(let y=30;y<160;y++)for(let x=30;x<160;x++){const i=(y*192+x)*4;covered.data[i]=covered.data[i+1]=covered.data[i+2]=100;}assert.equal(matchesBackground(backgroundProfile(desk),backgroundProfile(covered)),false);});
 it('rejects changed camera geometry',()=>{assert.equal(matchesBackground(backgroundProfile(raster(120)),backgroundProfile(raster(120,192,96))),false);});
 it('compares textured background spatially rather than by histogram',()=>{const a=raster(200),b=raster(200);for(let y=0;y<192;y++)for(let x=0;x<192;x++){const k=(y*192+x)*4;a.data[k]=a.data[k+1]=a.data[k+2]=x<96?50:200;b.data[k]=b.data[k+1]=b.data[k+2]=x<96?200:50;}assert.ok(matchesBackground(backgroundProfile(a),backgroundProfile(a)));assert.equal(matchesBackground(backgroundProfile(a),backgroundProfile(b)),false);});
});
class FakeWorker {
 static autoReady=false;static throwSend=false;static last:FakeWorker;
 onmessage:((event:any)=>void)|null=null;onerror:(()=>void)|null=null;terminated=false;
 constructor(){FakeWorker.last=this;}
 postMessage(data:any){if(data.type==='init'&&FakeWorker.autoReady)queueMicrotask(()=>this.onmessage?.({data:{id:data.id,ok:true}}));else if(data.type==='analyze'&&FakeWorker.throwSend)throw Error('transfer failed');}
 terminate(){this.terminated=true;}
}
function fakeBitmap(){let closed=0;return {bitmap:{close:()=>{closed++;}} as unknown as ImageBitmap,closed:()=>closed};}
async function withWorker(run:()=>Promise<void>){const previous=globalThis.Worker;globalThis.Worker=FakeWorker as unknown as typeof Worker;FakeWorker.autoReady=false;FakeWorker.throwSend=false;try{await run();}finally{globalThis.Worker=previous;}}
describe('worker ownership on failures',()=>{
 it('closes bitmap when disposed while initialization is pending',()=>withWorker(async()=>{const client=createVisionClient(),input=fakeBitmap();const promise=client.analyze(input.bitmap,'session');const rejected=assert.rejects(promise,/остановлен/);client.dispose();await rejected;assert.equal(input.closed(),1);assert.ok(FakeWorker.last.terminated);}));
 it('closes untransferred bitmap when postMessage throws',()=>withWorker(async()=>{FakeWorker.autoReady=true;FakeWorker.throwSend=true;const client=createVisionClient(),input=fakeBitmap();await assert.rejects(client.analyze(input.bitmap,'session'),/transfer failed/);assert.equal(input.closed(),1);client.dispose();}));
 it('rejects concurrent analysis and releases both local bitmaps',()=>withWorker(async()=>{const client=createVisionClient(),a=fakeBitmap(),b=fakeBitmap();const first=client.analyze(a.bitmap,'session');const rejected=assert.rejects(first,/остановлен/);await assert.rejects(client.analyze(b.bitmap,'session'),/обрабатывается/);assert.equal(b.closed(),1);client.dispose();await rejected;assert.equal(a.closed(),1);}));
});
