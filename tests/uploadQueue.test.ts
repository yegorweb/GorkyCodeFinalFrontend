import test from 'node:test';
import assert from 'node:assert/strict';
import { UploadQueue, type CaptureRecord, type CaptureMetadata, type CaptureStore } from '../app/scanner/core/uploadQueue.ts';

class Store implements CaptureStore {
 records = new Map<string,CaptureRecord>(); fail=false;
 async list(){return [...this.records.values()].map(r=>({...r}));}
 async put(r:CaptureRecord){if(this.fail)throw Error('disk full');this.records.set(r.metadata.captureId,{...r});}
 async delete(id:string){this.records.delete(id);}
}
const settings={mode:'local' as 'local'|'http',endpoint:'http://localhost/api/scans',maxItems:2,maxBytes:10_000,timeoutMs:200};
const meta=(id='a'):CaptureMetadata=>({captureId:id,cycleId:id,qr:{raw:'{"id":"student","page":1}',data:{id:'student',page:1},format:'json'},templateId:'sheet',templateVersion:1,capturedAt:new Date().toISOString(),quality:{}});
const image=()=>new Blob(['jpeg'],{type:'image/jpeg'});
async function waitFor(fn:()=>boolean){for(let i=0;i<100;i++){if(fn())return;await new Promise(r=>setTimeout(r,10));}throw Error('condition timed out');}

test('local mode persists before notification and performs no requests',async()=>{
 const store=new Store();let calls=0;const queue=new UploadQueue(settings,{store,fetcher:async()=>{calls++;throw Error('unexpected');}});
 await queue.init();await queue.enqueue(image(),meta());assert.equal(store.records.size,1);assert.equal(queue.list()[0].status,'queued');
 assert.equal(calls,0);queue.dispose();
});
test('storage failure cannot report a saved capture',async()=>{
 const store=new Store();const queue=new UploadQueue(settings,{store});await queue.init();store.fail=true;
 await assert.rejects(queue.enqueue(image(),meta()),/disk full/);assert.equal(queue.list().length,0);queue.dispose();
});
test('bounded queue serializes concurrent enqueues',async()=>{
 const queue=new UploadQueue({...settings,maxItems:1},{store:new Store()});await queue.init();
 const result=await Promise.allSettled([queue.enqueue(image(),meta('a')),queue.enqueue(image(),meta('b'))]);
 assert.equal(result.filter(r=>r.status==='fulfilled').length,1);assert.equal(queue.hasCapacity(),false);queue.dispose();
});
test('interrupted requests recover as uncertain using existing capture ID',async()=>{
 const store=new Store();await store.put({metadata:meta('existing'),blob:image(),status:'uploading',attempts:1});
 const queue=new UploadQueue(settings,{store});await queue.init();assert.equal(queue.list()[0].status,'uncertain');
 assert.equal(queue.list()[0].metadata.captureId,'existing');queue.dispose();
});
test('valid JSON receipt completes upload and uses idempotency key',async()=>{
 let key:string|null=null;const queue=new UploadQueue(settings,{store:new Store(),fetcher:async(_url,init)=>{
  key=new Headers(init?.headers).get('Idempotency-Key');return Response.json({captureId:'a',status:'succeeded',resultUrl:'/result/a'});
 }});await queue.init();await queue.enqueue(image(),meta());queue.updateSettings({...settings,mode:'http'});
 await waitFor(()=>queue.list()[0].status==='succeeded');assert.equal(key,'a');assert.equal(queue.list()[0].resultUrl,'http://localhost/result/a');queue.dispose();
});
test('HTTP 200 HTML is never accepted as successful analysis',async()=>{
 const queue=new UploadQueue(settings,{store:new Store(),fetcher:async()=>new Response('<html>error</html>',{headers:{'content-type':'text/html'}})});
 await queue.init();await queue.enqueue(image(),meta());queue.updateSettings({...settings,mode:'http'});
 await waitFor(()=>queue.list()[0].status==='uncertain');assert.match(queue.list()[0].error!,/JSON/);queue.dispose();
});
test('lost reply and manual retry reuse original capture ID',async()=>{
 const keys:string[]=[];let calls=0;const queue=new UploadQueue(settings,{store:new Store(),fetcher:async(_url,init)=>{
  keys.push(new Headers(init?.headers).get('Idempotency-Key')!);if(++calls===1)throw Error('connection lost');return Response.json({captureId:'a',status:'succeeded'});
 }});await queue.init();await queue.enqueue(image(),meta());queue.updateSettings({...settings,mode:'http'});
 await waitFor(()=>queue.list()[0].status==='uncertain');await queue.retry('a');await waitFor(()=>queue.list()[0].status==='succeeded');
 assert.deepEqual(keys,['a','a']);queue.dispose();
});
test('validation rejection is failed and not automatically retried',async()=>{
 let calls=0;const queue=new UploadQueue(settings,{store:new Store(),fetcher:async()=>{calls++;return new Response('invalid',{status:422});}});
 await queue.init();await queue.enqueue(image(),meta());queue.updateSettings({...settings,mode:'http'});
 await waitFor(()=>queue.list()[0].status==='failed');await new Promise(r=>setTimeout(r,150));assert.equal(calls,1);queue.dispose();
});
test('explicit server analysis failure is terminal and visible',async()=>{
 const queue=new UploadQueue(settings,{store:new Store(),fetcher:async()=>Response.json({captureId:'a',status:'failed',error:'Unreadable work'})});
 await queue.init();await queue.enqueue(image(),meta());queue.updateSettings({...settings,mode:'http'});
 await waitFor(()=>queue.list()[0].status==='failed');assert.equal(queue.list()[0].error,'Unreadable work');queue.dispose();
});
test('persisted upload cannot migrate to a different endpoint after lost reply',async()=>{
 const store=new Store();const destinations:string[]=[];
 const queue=new UploadQueue(settings,{store,fetcher:async(url)=>{destinations.push(String(url));throw Error('lost reply');}});
 await queue.init();await queue.enqueue(image(),meta());queue.updateSettings({...settings,mode:'http',endpoint:'https://first.example/api/scans'});
 await waitFor(()=>queue.list()[0].status==='uncertain');assert.equal(store.records.get('a')?.uploadEndpoint,'https://first.example/api/scans');
 queue.updateSettings({...settings,mode:'http',endpoint:'https://second.example/api/scans'});await queue.retry('a');
 await waitFor(()=>queue.list()[0].status==='failed');assert.equal(destinations.length,1);assert.match(queue.list()[0].error!,/другому серверу/);queue.dispose();
});
test('relative receipt URLs resolve against API server rather than frontend',async()=>{
 const queue=new UploadQueue(settings,{store:new Store(),fetcher:async()=>Response.json({captureId:'a',status:'succeeded',resultUrl:'/results/a'})});
 await queue.init();await queue.enqueue(image(),meta());queue.updateSettings({...settings,mode:'http',endpoint:'https://analysis.example/api/scans'});
 await waitFor(()=>queue.list()[0].status==='succeeded');assert.equal(queue.list()[0].resultUrl,'https://analysis.example/results/a');queue.dispose();
});
test('server cannot redirect status polling to another origin',async()=>{
 let requests=0;const queue=new UploadQueue(settings,{store:new Store(),fetcher:async()=>{requests++;return Response.json({captureId:'a',status:'accepted',operationUrl:'https://third-party.example/track'});}});
 await queue.init();await queue.enqueue(image(),meta());queue.updateSettings({...settings,mode:'http'});
 await waitFor(()=>queue.list()[0].status==='uncertain');assert.equal(requests,1);assert.match(queue.list()[0].error!,/тому же серверу/);queue.dispose();
});

test('multipart includes original QR and parsed object, excludes obsolete manual fields',async()=>{
 let payload:any;
 const queue=new UploadQueue(settings,{store:new Store(),fetcher:async(_url,options)=>{
  payload=JSON.parse((options!.body as FormData).get('metadata') as string);
  assert.ok((options!.body as FormData).get('image') instanceof Blob);
  return Response.json({captureId:'a',status:'succeeded'});
 }});
 await queue.init();await queue.enqueue(image(),{...meta(),workId:'old-field'} as any);
 queue.updateSettings({...settings,mode:'http'});await waitFor(()=>queue.list()[0].status==='succeeded');
 assert.deepEqual(payload.qr,meta().qr);assert.equal('workId' in payload,false);assert.equal('variant' in payload,false);queue.dispose();
});
test('legacy persisted captures without QR never upload',async()=>{
 const store=new Store();const old:any=meta();delete old.qr;
 store.records.set('a',{metadata:old,blob:image(),status:'queued',attempts:0});
 let calls=0;const queue=new UploadQueue({...settings,mode:'http'},{store,fetcher:async()=>{calls++;throw Error('must not send');}});
 await queue.init();await waitFor(()=>queue.list()[0].status==='failed');assert.equal(calls,0);assert.match(queue.list()[0].error!,/нет QR/);queue.dispose();
});
