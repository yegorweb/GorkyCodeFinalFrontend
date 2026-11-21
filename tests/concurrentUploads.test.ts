import test from 'node:test'
import assert from 'node:assert/strict'
import { ConcurrentUploads } from '../app/scanner/core/concurrentUploads'

test('captures begin sending without waiting for earlier uploads', async () => {
  const started: string[] = [], releases = new Map<string, () => void>()
  const queue = new ConcurrentUploads(id => new Promise<void>(resolve => { started.push(id); releases.set(id, resolve) }), () => {}, 2)
  queue.enqueue('a'); queue.enqueue('b'); queue.enqueue('c'); queue.enqueue('a')
  assert.deepEqual(started, ['a', 'b'])
  let drained = false; const draining = queue.drain().then(() => { drained = true })
  releases.get('b')!(); await new Promise(resolve => setTimeout(resolve, 0))
  assert.deepEqual(started, ['a', 'b', 'c']); assert.equal(drained, false)
  releases.get('a')!(); releases.get('c')!(); await draining
  assert.equal(drained, true); assert.equal(queue.count, 0)
})

test('failed deliveries remain retryable without blocking other pages', async () => {
  let attempts = 0
  const queue = new ConcurrentUploads(async id => { if (id === 'a' && attempts++ === 0) throw new Error('offline') }, () => {}, 2)
  queue.enqueue('a'); queue.enqueue('b'); await queue.drain()
  assert.equal(queue.hasFailures, true)
  queue.enqueue('a'); await queue.drain()
  assert.equal(queue.hasFailures, false); assert.equal(attempts, 2)
})
