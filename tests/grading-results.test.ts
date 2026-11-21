import test from 'node:test'
import assert from 'node:assert/strict'
import { BatchWorkflow, type WorkflowBatch, type WorkflowStore, type StudentRecord } from '../app/scanner/core/batchWorkflow'
import type { CaptureRecord } from '../app/scanner/core/uploadQueue'
import { selectGradingResults, needsGradingResultsPolling, createGradingResultsReader } from '../app/utils/grading-results'

const batch = (overrides: Partial<WorkflowBatch> = {}): WorkflowBatch => ({
  ownerId: 7, scanSessionId: 'finished-session', batchId: crypto.randomUUID(), assignmentId: 'work', variant: 'A',
  templateId: 'T1', templateVersion: 18, markerTemplateId: 'camera', markerTemplateVersion: 1,
  expectedStudentCount: 1, expectedPageCount: 1, status: 'PROCESSING', createdAt: '2026-11-21T10:00:00Z',
  cursor: '', tasks: {}, pendingAckTaskIds: [], ...overrides,
})
const capture = (overrides: Partial<CaptureRecord> = {}, metadata: Partial<CaptureRecord['metadata']> = {}): CaptureRecord => ({
  metadata: { ownerId: 7, scanSessionId: 'finished-session', scanFinished: true, captureId: crypto.randomUUID(), cycleId: 'cycle',
    qr: { raw: 'B1:T1:18:1', data: null, format: 'text' }, templateId: 'camera', templateVersion: 1,
    capturedAt: '2026-11-21T10:00:00Z', quality: {}, ...metadata },
  blob: new Blob(['photo'], { type: 'image/jpeg' }), status: 'succeeded', attempts: 1, ...overrides,
})
const terminal = (status: 'SUCCEEDED' | 'FAILED' | 'INCOMPLETE' = 'SUCCEEDED') => ({ taskId: crypto.randomUUID(), studentId: crypto.randomUUID(), displayName: 'Иванов', status })

class Store implements WorkflowStore {
  batches = new Map<string, WorkflowBatch>()
  captures: CaptureRecord[] = []
  async list() { return structuredClone(this.captures) }
  async listCaptures() { return this.list() }
  async getCapture(id: string) { return this.captures.find(item => item.metadata.captureId === id) }
  async put(record: CaptureRecord) { this.captures.push(record) }
  async delete(id: string) { this.captures = this.captures.filter(item => item.metadata.captureId !== id) }
  async listBatches() { return structuredClone([...this.batches.values()]) }
  async getBatch(id: string) { const value = this.batches.get(id); return value && structuredClone(value) }
  async putBatch(value: WorkflowBatch) { this.batches.set(value.batchId, structuredClone(value)) }
  async listStudents() { return [] }
  async putStudent(_student: StudentRecord) {}
  async associatePage(record: CaptureRecord, value: WorkflowBatch) { await this.put(record); await this.putBatch(value) }
  async clearBatch(id: string) { this.batches.delete(id) }
}

test('all saved results include finished sessions and completed batches', () => {
  const older = batch({ status: 'COMPLETED', createdAt: '2026-11-20T10:00:00Z' })
  const newer = batch({ scanSessionId: 'another-session' })
  const photo = capture({ batchId: older.batchId })
  const selected = selectGradingResults([older, newer], [photo], 7)
  assert.deepEqual(selected.batches.map(value => value.batchId), [newer.batchId, older.batchId])
  assert.deepEqual(selected.captures.map(value => value.metadata.captureId), [photo.metadata.captureId])
})

test('explicit links select either a scan session or the modern batch ID', () => {
  const first = batch(), second = batch({ scanSessionId: 'other-session' })
  assert.deepEqual(selectGradingResults([first, second], [], 7, 'finished-session').batches.map(value => value.batchId), [first.batchId])
  assert.deepEqual(selectGradingResults([first, second], [], 7, second.batchId).batches.map(value => value.batchId), [second.batchId])
})

test('foreign owners and captures associated with foreign batches never enter a session', () => {
  const mine = batch(), foreign = batch({ ownerId: 8 })
  const minePhoto = capture({ batchId: mine.batchId })
  const foreignPhoto = capture({ batchId: mine.batchId }, { ownerId: 8 })
  const wrongAssociation = capture({ batchId: foreign.batchId })
  const unknownOwner = capture({ batchId: mine.batchId }, { ownerId: undefined })
  const selected = selectGradingResults([mine, foreign], [minePhoto, foreignPhoto, wrongAssociation, unknownOwner], 7, 'finished-session')
  assert.deepEqual(selected.batches.map(value => value.batchId), [mine.batchId])
  assert.deepEqual(selected.captures.map(value => value.metadata.captureId), [minePhoto.metadata.captureId])
})

test('unassociated failed photos stay visible for their selected session including capture-only sessions', () => {
  const saved = batch(), failed = capture({ status: 'failed', preparationStatus: 'FAILED' })
  const another = capture({ status: 'failed' }, { scanSessionId: 'capture-only' })
  assert.deepEqual(selectGradingResults([saved], [failed, another], 7, saved.batchId).captures.map(value => value.metadata.captureId), [failed.metadata.captureId])
  assert.deepEqual(selectGradingResults([], [another], 7, 'capture-only').captures.map(value => value.metadata.captureId), [another.metadata.captureId])
})

test('closed batches need every expected terminal task and the final cursor page', () => {
  const succeeded = terminal(), failed = terminal('FAILED'), incomplete = terminal('INCOMPLETE')
  const closed = batch({ status: 'CLOSED_INCOMPLETE', expectedStudentCount: 10, closeExpectedTaskCount: 3,
    tasks: { [succeeded.taskId]: succeeded, [failed.taskId]: failed, [incomplete.taskId]: incomplete }, hasMore: false })
  assert.equal(needsGradingResultsPolling(closed), false)
  assert.equal(needsGradingResultsPolling({ ...closed, closeExpectedTaskCount: 4 }), true)
  assert.equal(needsGradingResultsPolling({ ...closed, closeExpectedTaskCount: undefined }), true)
  assert.equal(needsGradingResultsPolling({ ...closed, hasMore: true }), true)
  assert.equal(needsGradingResultsPolling({ ...closed, tasks: { [succeeded.taskId]: { ...succeeded, status: 'PROCESSING' } }, closeExpectedTaskCount: 1 }), true)
})

test('open, completed and server-acknowledged batches never need HTTP polling', () => {
  for (const status of ['OPEN', 'COMPLETED', 'CLEANING', 'CLEANED'] as const) assert.equal(needsGradingResultsPolling(batch({ status })), false)
  assert.equal(needsGradingResultsPolling(batch({ serverCleanupAcknowledged: true, hasMore: true })), false)
})

test('reader drains cursor pages durably and only ACKs on explicit action', async () => {
  const store = new Store(), saved = batch(), task = terminal()
  await store.putBatch(saved)
  store.captures = [capture({ batchId: saved.batchId })]
  const requests: string[] = []
  let latest: WorkflowBatch[] = []
  const workflow = new BatchWorkflow({ store, origin: 'http://api.test', fetcher: async (input, options) => {
    const url = new URL(String(input)); requests.push(url.pathname + url.search)
    if (url.pathname.endsWith('/ack')) {
      const persisted = await store.getBatch(saved.batchId)
      assert.equal(persisted?.cursor, 'page-2')
      assert.equal(persisted?.tasks[task.taskId]?.status, 'SUCCEEDED')
      assert.deepEqual(JSON.parse(String(options?.body)), { task_ids: [task.taskId], acknowledge_missing_students: false })
      return new Response(null, { status: 204 })
    }
    const last = url.searchParams.get('cursor') === 'page-1'
    return Response.json({ items: [{ task_id: task.taskId, student_id: task.studentId, status: last ? 'SUCCEEDED' : 'PROCESSING', updated_at: '2026-11-21T10:00:00Z' }], next_cursor: last ? 'page-2' : 'page-1', has_more: !last })
  } })
  const reader = createGradingResultsReader({ store, workflow, ownerId: 7, isCurrent: () => true, onResults: value => { latest = value.batches } })
  await reader.poll()
  assert.equal(latest[0]?.tasks[task.taskId]?.status, 'SUCCEEDED')
  assert.equal(requests.length, 2)
  assert.ok(requests[1]?.includes('cursor=page-1'))
  await reader.poll()
  assert.equal(requests.length, 2, 'terminal batches still refresh locally without more HTTP')
  await reader.acknowledge()
  assert.equal(requests.length, 3)
  assert.equal((await store.getBatch(saved.batchId))?.serverCleanupAcknowledged, true)
  assert.equal(store.captures.length, 1, 'ACK retains uploaded photos')
})

test('reader caps a cursor drain at 20 pages then continues on the next tick', async () => {
  const store = new Store(), saved = batch()
  await store.putBatch(saved)
  let pages = 0
  const workflow = new BatchWorkflow({ store, origin: 'http://api.test', fetcher: async () => Response.json({ items: [], next_cursor: String(++pages), has_more: true }) })
  const reader = createGradingResultsReader({ store, workflow, ownerId: 7, isCurrent: () => true, onResults: () => {} })
  await reader.poll()
  assert.equal((await store.getBatch(saved.batchId))?.cursor, '20')
  await reader.poll()
  assert.equal((await store.getBatch(saved.batchId))?.cursor, '40')
})

test('completed history continues local discovery for a new other-tab batch', async () => {
  const store = new Store(), completed = batch({ serverCleanupAcknowledged: true }), task = terminal()
  await store.putBatch(completed)
  let latest: WorkflowBatch[] = [], requests = 0
  const workflow = new BatchWorkflow({ store, origin: 'http://api.test', fetcher: async () => {
    requests++
    return Response.json({ items: [{ task_id: task.taskId, student_id: task.studentId, status: 'SUCCEEDED', updated_at: '2026-11-21T10:00:00Z' }], next_cursor: 'done', has_more: false })
  } })
  const reader = createGradingResultsReader({ store, workflow, ownerId: 7, isCurrent: () => true, onResults: value => { latest = value.batches } })
  await reader.poll()
  assert.equal(requests, 0)
  const added = batch({ scanSessionId: 'other-tab' })
  await store.putBatch(added)
  await reader.poll()
  assert.equal(requests, 1)
  assert.equal(latest.length, 2)
  assert.equal(latest.find(value => value.batchId === added.batchId)?.tasks[task.taskId]?.status, 'SUCCEEDED')
})

test('slow polls are shared and manual ACK waits until cursor persistence', async () => {
  const store = new Store(), saved = batch(), task = terminal()
  await store.putBatch(saved)
  let release!: () => void, began!: () => void, requests = 0
  const started = new Promise<void>(resolve => { began = resolve })
  const gate = new Promise<void>(resolve => { release = resolve })
  const workflow = new BatchWorkflow({ store, origin: 'http://api.test', fetcher: async input => {
    requests++
    if (String(input).endsWith('/ack')) return new Response(null, { status: 204 })
    began(); await gate
    return Response.json({ items: [{ task_id: task.taskId, student_id: task.studentId, status: 'SUCCEEDED', updated_at: '2026-11-21T10:00:00Z' }], next_cursor: 'done', has_more: false })
  } })
  const reader = createGradingResultsReader({ store, workflow, ownerId: 7, isCurrent: () => true, onResults: () => {} })
  const first = reader.poll()
  await started
  const second = reader.poll(), refresh = reader.refresh(), ack = reader.acknowledge()
  assert.equal(requests, 1)
  release()
  await Promise.all([first, second, refresh, ack])
  assert.equal(requests, 2)
  assert.equal((await store.getBatch(saved.batchId))?.serverCleanupAcknowledged, true)
})

test('owner changes during local discovery suppress old results and network traversal', async () => {
  const store = new Store(), saved = batch()
  await store.putBatch(saved)
  let current = true, publications = 0, requests = 0
  const originalList = store.listBatches.bind(store)
  store.listBatches = async () => { const values = await originalList(); current = false; return values }
  const workflow = new BatchWorkflow({ store, fetcher: async () => { requests++; return Response.json({}) } })
  const reader = createGradingResultsReader({ store, workflow, ownerId: 7, isCurrent: () => current, onResults: () => { publications++ } })
  await reader.poll()
  assert.equal(publications, 0)
  assert.equal(requests, 0)
})
