import test from 'node:test';
import assert from 'node:assert/strict';
import { cameraConstraints, cameraError, stopTracks } from '../app/composables/useCamera';

test('camera selection uses deviceId without microphone permission', () => {
  assert.deepEqual((cameraConstraints('document').video as MediaTrackConstraints).deviceId, {exact:'document'});
  assert.equal(cameraConstraints().audio, false);
  assert.equal((cameraConstraints().video as MediaTrackConstraints).deviceId, undefined);
});
test('all tracks released and missing stream accepted', () => {
  let stopped=0;
  stopTracks({getTracks:()=>[{stop:()=>stopped++},{stop:()=>stopped++}]} as unknown as MediaStream);
  stopTracks(null); assert.equal(stopped,2);
});
test('camera failures provide recovery guidance', () => {
  assert.match(cameraError({name:'NotAllowedError'}), /Разрешите/);
  assert.match(cameraError({name:'NotFoundError'}), /Подключите/);
  assert.equal(cameraError(new Error('driver failed')), 'driver failed');
});
