import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PNG } from 'pngjs';
import { parseQrPayload, decodeQrFromRaster } from '../app/scanner/vision/qr';
import { detect, type Raster } from '../app/scanner/vision/detect';
import { invert, warpRGBA } from '../app/scanner/vision/geometry';
import { REFERENCE_TEMPLATE } from '../app/scanner/vision/template';
import type { Geometry } from '../app/scanner/vision/types';

test('reads JSON object and preserves exact Unicode source text', () => {
  const raw = '{ "workId": "ученик-1", "page": 2, "extra": {"ok":true} }';
  const result = parseQrPayload(new TextEncoder().encode(raw));
  assert.equal(result.raw, raw); assert.equal(result.format, 'json');
  assert.deepEqual(result.data, {workId:'ученик-1',page:2,extra:{ok:true}});
});
test('preserves compact IDs and URLs without inventing fields or navigating', () => {
  for (const raw of ['B1:TS-40edbcbf82915c87:1','https://example.com/id','[1,2]','{"broken":']) {
    assert.deepEqual(parseQrPayload(raw), {raw,data:null,format:'text'});
  }
});
test('rejects empty, oversized and invalid UTF8 payloads', () => {
  for (const raw of ['', ' '.repeat(3),'x'.repeat(8193),new Uint8Array([0xff,0xfe])]) assert.throws(()=>parseQrPayload(raw), /QR_INVALID/);
});
test('decodes actual reference QR as its real compact string, not fabricated JSON', () => {
  const png=PNG.sync.read(readFileSync(new URL('./reference-sheet.png',import.meta.url)));
  const result=decodeQrFromRaster({width:png.width,height:png.height,data:new Uint8ClampedArray(png.data)});
  assert.deepEqual(result,{raw:'B1:TS-40edbcbf82915c87:1',data:null,format:'text'});
});
test('blank page is missing QR', () => {
  const data=new Uint8ClampedArray(200*300*4).fill(255);
  assert.throws(()=>decodeQrFromRaster({width:200,height:300,data}),/QR_MISSING/);
});
test('rejects conflicting QR payloads within the upper right region', () => {
  let call=0;
  const decode=()=>{if(call>=2)return null;return {binaryData:Array.from(new TextEncoder().encode(`{"id":${++call}}`)),location:{topLeftCorner:{x:4,y:4},topRightCorner:{x:12,y:4},bottomRightCorner:{x:12,y:12},bottomLeftCorner:{x:4,y:12}}};};
  assert.throws(()=>decodeQrFromRaster({width:200,height:300,data:new Uint8ClampedArray(200*300*4).fill(255)},decode),/QR_CONFLICT/);
});

function reducedFrame(): Raster {
  const png = PNG.sync.read(readFileSync(new URL('./reference-sheet.png', import.meta.url)));
  const width = 542, height = 786;
  return { width, height, data: warpRGBA(new Uint8ClampedArray(png.data), png.width, png.height, width, height,
    [png.width / width, 0, 0, 0, png.height / height, 0, 0, 0, 1]) };
}
function frameGeometry(r: Raster): Geometry {
  const detection = detect(r, REFERENCE_TEMPLATE);
  assert.equal(detection.presence, 'full');
  assert.equal(detection.quality.eligible, true);
  return { homography: detection.homography!, quad: detection.pageQuad!,
    frameWidth: r.width, frameHeight: r.height,
    templateWidth: REFERENCE_TEMPLATE.width, templateHeight: REFERENCE_TEMPLATE.height };
}
function rectifiedFrame(r: Raster, g: Geometry): Raster {
  const distance = (a: number, b: number) => Math.hypot(g.quad[a].x - g.quad[b].x, g.quad[a].y - g.quad[b].y);
  const scale = Math.min((distance(0, 1) + distance(3, 2)) / (2 * g.templateWidth),
    (distance(0, 3) + distance(1, 2)) / (2 * g.templateHeight));
  const width = Math.round(g.templateWidth * scale), height = Math.round(g.templateHeight * scale);
  const h = invert(g.homography);
  return { width, height, data: warpRGBA(r.data, r.width, r.height, width, height,
    [h[0] / scale, h[1] / scale, h[2], h[3] / scale, h[4] / scale, h[5], h[6] / scale, h[7] / scale, h[8]]) };
}
test('recovers a readable source QR when perspective resampling destroys it', () => {
  const raster = reducedFrame(), geometry = frameGeometry(raster);
  const rectified = rectifiedFrame(raster, geometry);
  assert.throws(() => decodeQrFromRaster(rectified), /QR_MISSING/);
  assert.equal(decodeQrFromRaster(rectified, undefined, { raster, geometry }).raw,
    'B1:TS-40edbcbf82915c87:1');
});
for (const turns of [1, 2, 3]) test(
  'source QR recovery follows page geometry after ' + turns * 90 + ' degree rotation', () => {
    let raster = reducedFrame();
    for (let n = 0; n < turns; n++) {
      const data = new Uint8ClampedArray(raster.data.length);
      for (let y = 0; y < raster.height; y++) for (let x = 0; x < raster.width; x++) {
        const src = (y * raster.width + x) * 4, dst = (x * raster.height + raster.height - 1 - y) * 4;
        data.set(raster.data.subarray(src, src + 4), dst);
      }
      raster = { data, width: raster.height, height: raster.width };
    }
    const geometry = frameGeometry(raster);
    const blank = { width: 200, height: 300, data: new Uint8ClampedArray(200 * 300 * 4).fill(255) };
    assert.equal(decodeQrFromRaster(blank, undefined, { raster, geometry }).raw,
      'B1:TS-40edbcbf82915c87:1');
  });

test('source recovery rejects a QR outside the canonical upper-right region', () => {
  const raster = reducedFrame(), geometry = frameGeometry(raster);
  // The symbol is still readable, but projects below the accepted page header.
  geometry.homography[5] += geometry.templateHeight * .4;
  const blank = { width: 200, height: 300, data: new Uint8ClampedArray(200 * 300 * 4).fill(255) };
  assert.throws(() => decodeQrFromRaster(blank, undefined, { raster, geometry }), /QR_MISSING/);
});

test('source recovery cannot hide conflicting or invalid rectified QR data', () => {
  const raster = reducedFrame(), geometry = frameGeometry(raster);
  const blank = { width: 200, height: 300, data: new Uint8ClampedArray(200 * 300 * 4).fill(255) };
  const location = { topLeftCorner: { x: 4, y: 4 }, topRightCorner: { x: 12, y: 4 },
    bottomRightCorner: { x: 12, y: 12 }, bottomLeftCorner: { x: 4, y: 12 } };
  let call = 0;
  const conflict = () => call >= 2 ? null : {
    binaryData: Array.from(new TextEncoder().encode('payload-' + ++call)), location };
  assert.throws(() => decodeQrFromRaster(blank, conflict, { raster, geometry }), /QR_CONFLICT/);
  const invalid = () => ({ binaryData: [255], location });
  assert.throws(() => decodeQrFromRaster(blank, invalid, { raster, geometry }), /QR_INVALID/);
});
