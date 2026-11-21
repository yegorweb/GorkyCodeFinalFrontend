import test from 'node:test'
import assert from 'node:assert/strict'
import { useCaptureSound } from '../app/composables/useCaptureSound'
test('capture sound requires arming and releases its audio context on unmount', async () => {
  let tones = 0, closed = false, cleanup: () => void = () => {}
  const parameter = { setValueAtTime() {}, exponentialRampToValueAtTime() {} }
  class Audio {
    state = 'suspended'; currentTime = 0; destination = {}
    async resume() { this.state = 'running' }
    async close() { closed = true }
    createOscillator() { tones++; return { type: '', frequency: parameter, connect() {}, disconnect() {}, start() {}, stop() {}, onended: undefined } }
    createGain() { return { gain: parameter, connect() {}, disconnect() {} } }
  }
  Object.assign(globalThis, { AudioContext: Audio, onBeforeUnmount: (callback: () => void) => { cleanup = callback } })
  const sound = useCaptureSound()
  sound.play(); assert.equal(tones, 0)
  await sound.arm(); sound.play(); assert.equal(tones, 1)
  cleanup(); assert.equal(closed, true)
})
