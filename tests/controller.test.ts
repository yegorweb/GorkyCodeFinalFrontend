import test from 'node:test';
import assert from 'node:assert/strict';
import { ScanController } from '../app/scanner/core/controller.ts';
import { readScannerLatch, writeScannerLatch } from '../app/scanner/core/latch';

const q = { eligible:true, score:1, sharpness:50, contrast:50, coverage:0.7, reasons:[] };
const full = (x=0) => ({presence:'full' as const, width:1000,height:1000,quad:[{x,y:0},{x:x+800,y:0},{x:x+800,y:1000},{x,y:1000}] as any,quality:q});
const empty = (presence:'absent'|'unknown'|'partial'='absent') => ({presence,width:1000,height:1000,quad:null,quality:{...q,eligible:false}});
function capture(c:ScanController,start=0){ c.update(full(),start);c.update(full(),start+300);c.update(full(),start+600);return c.update(full(),start+1000); }

test('requires several stable samples then emits only one capture',()=>{
 const c=new ScanController();c.start();assert.equal(c.update(full(),0).capture,false);
 c.update(full(),300);c.update(full(),600);assert.equal(c.update(full(),1000).capture,true);
 assert.equal(c.update(full(),2000).capture,false);c.completeCapture();
 assert.equal(c.update(full(),3000).state,'wait-clear');
});
test('partial/unknown detections cannot unlock a captured page',()=>{
 const c=new ScanController();c.start();capture(c);c.completeCapture();
 c.update(empty(),2000);c.update(empty('unknown'),3000);
 assert.equal(c.update(empty(),4000).state,'wait-clear');
 assert.equal(c.update(empty('partial'),6000).state,'wait-clear');
 assert.equal(c.update(full(),8000).capture,false);
});
test('continuous empty scene unlocks next identical template',()=>{
 const c=new ScanController();c.start();capture(c);c.completeCapture();const cycle=c.cycleId;
 c.update(empty(),2000);assert.equal(c.update(empty(),3300).state,'seeking');
 assert.notEqual(c.cycleId,cycle);assert.equal(capture(c,4000).capture,true);
});
test('motion and bad quality discard candidates and restart timing',()=>{
 const c=new ScanController();c.start();c.update(full(),0);c.update(full(),500);
 const moved=c.update(full(150),1000);assert.equal(moved.capture,false);assert.equal(moved.resetCandidate,true);
 const bad=c.update({...full(150),quality:{...q,eligible:false,reasons:['Блик']}},2000);
 assert.equal(bad.collect,false);assert.equal(bad.message,'Блик');assert.equal(c.update(full(150),2100).capture,false);
});
test('full queue prevents capture without consuming physical cycle',()=>{
 const c=new ScanController();c.start();assert.equal(c.update(full(),0,false).collect,false);
 assert.equal(c.update(full(),2000,false).capture,false);assert.equal(capture(c,3000).capture,true);
});
test('stop/start and pause/resume preserve captured-page latch',()=>{
 const c=new ScanController();c.start();capture(c);c.completeCapture();c.stop();
 assert.equal(c.start().state,'wait-clear');c.pause();assert.equal(c.resume().state,'wait-clear');
 assert.equal(c.update(full(),4000).capture,false);
});
test('a completed session does not keep a new session waiting for the previous sheet', () => {
 const values = new Map<string, string>();
 Object.assign(globalThis, { sessionStorage: { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value) } });
 const previous = new ScanController(); previous.start(); capture(previous); previous.completeCapture();
 writeScannerLatch('session:first', true);
 const restored = new ScanController(); assert.equal(restored.start(readScannerLatch('session:first')).state, 'wait-clear');
 const fresh = new ScanController(); assert.equal(fresh.start(readScannerLatch('session:second')).state, 'seeking');
 assert.equal(capture(fresh).capture, true);
});
test('clock regression and duplicate frame cannot add stable samples',()=>{
 const c=new ScanController({minSamples:2});c.start();c.update({...full(),frameId:1},1000);
 assert.equal(c.update({...full(),frameId:1},3000).capture,false);
 assert.equal(c.update({...full(),frameId:2},500).capture,false);
 assert.equal(c.update({...full(),frameId:2},3000).capture,true);
});
test('recovery can require empty scene before first capture',()=>{
 const c=new ScanController();c.start(true);assert.equal(capture(c).capture,false);
 c.update(empty(),2000);c.update(empty(),3300);assert.equal(capture(c,4000).capture,true);
});
test('pause during asynchronous capture preserves latch and paused state',()=>{
 const c=new ScanController();c.start();assert.equal(capture(c).capture,true);
 c.pause();c.completeCapture();assert.equal(c.state,'paused');assert.equal(c.resume().state,'wait-clear');
});
