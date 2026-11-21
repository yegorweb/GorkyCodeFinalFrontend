import test from 'node:test'
import assert from 'node:assert/strict'
import { BatchWorkflow, type WorkflowStore, type WorkflowBatch, type StudentRecord } from '../app/scanner/core/batchWorkflow'
import { ScanSession, scannedWork } from '../app/scanner/core/scanSession'
import type { CaptureRecord } from '../app/scanner/core/uploadQueue'
import { REFERENCE_TEMPLATE } from '../app/scanner/vision/template'

class Store implements WorkflowStore {
  records = new Map<string, CaptureRecord>()
  batchRecords = new Map<string, WorkflowBatch>()
  studentRecords = new Map<string, StudentRecord>()
  async list() { return [...this.records.values()].map(value => structuredClone(value)) }
  async listCaptures() { return this.list() }
  async put(value: CaptureRecord) { this.records.set(value.metadata.captureId, structuredClone(value)) }
  async delete(id: string) { this.records.delete(id) }
  async getCapture(id: string) { const value = this.records.get(id); return value && structuredClone(value) }
  async listBatches() { return [...this.batchRecords.values()].map(value => structuredClone(value)) }
  async getBatch(id: string) { const value = this.batchRecords.get(id); return value && structuredClone(value) }
  async putBatch(value: WorkflowBatch) { this.batchRecords.set(value.batchId, structuredClone(value)) }
  async listStudents(id: string) { return [...this.studentRecords.values()].filter(student => student.batchId === id) }
  async putStudent(value: StudentRecord) { this.studentRecords.set(value.studentId, structuredClone(value)) }
  async clearBatch(id: string) { this.batchRecords.delete(id) }
  async associatePage(record: CaptureRecord, batch: WorkflowBatch, student: StudentRecord) {
    const prior = this.batchRecords.get(batch.batchId)
    const tasks = { ...prior?.tasks }
    for (const [id, task] of Object.entries(batch.tasks)) tasks[id] = (tasks[id]?.receivedPages ?? 0) > (task.receivedPages ?? 0) ? tasks[id]! : task
    await this.put(record); await this.putBatch({ ...batch, tasks }); await this.putStudent(student)
  }
}
function capture(template = 'T1', page = 1, name = 'Иванов'): CaptureRecord {
  const id = crypto.randomUUID()
  return { metadata: { captureId: id, cycleId: id, ownerId: 7, scanSessionId: 'session', qr: { raw: `B1:${template}:18:${page}`, format: 'text', data: null },
    templateId: REFERENCE_TEMPLATE.id, templateVersion: REFERENCE_TEMPLATE.version, capturedAt: new Date().toISOString(), quality: {} },
    blob: new Blob([name], { type: 'image/jpeg' }), status: 'queued', attempts: 0 }
}
function fixture() {
  const store = new Store()
  const server = new Map<string, { taskId: string; captureId?: string; closed: boolean }>()
  const uploads: { capture: string; page: string; batch: string }[] = []
  const polled: string[] = []
  let loseReply = false
  const api = new BatchWorkflow({ store, origin: 'http://api.test', fetcher: async (input, options) => {
    const path = new URL(String(input)).pathname
    if (path === '/api/v1/batches') {
      const body = JSON.parse(String(options?.body))
      assert.equal(body.expected_student_count, 1)
      assert.equal(body.expected_page_count, 1)
      const id = crypto.randomUUID()
      server.set(id, { taskId: crypto.randomUUID(), closed: false })
      return Response.json({ batch_id: id, status: 'OPEN', created_at: new Date().toISOString() }, { status: 201 })
    }
    const batchId = path.split('/')[4]!
    const batch = server.get(batchId)!
    if (path.endsWith('/pages')) {
      const form = options?.body as FormData
      assert.equal(form.get('student_id'), null, 'A standalone photograph carries no pupil data')
      assert.equal(form.get('display_name'), null)
      assert.equal(form.get('page_number'), '1')
      assert.equal(new Headers(options?.headers).get('Idempotency-Key'), form.get('capture_id'))
      batch.captureId = String(form.get('capture_id'))
      uploads.push({ capture: String(form.get('capture_id')), page: String(form.get('page_id')), batch: batchId })
      if (loseReply) { loseReply = false; throw new Error('Lost reply') }
      return Response.json({ task_id: batch.taskId, page_id: form.get('page_id'), capture_id: form.get('capture_id'), status: 'RECEIVING', received_pages: 1, expected_pages: 1 }, { status: 202 })
    }
    if (path.endsWith('/close')) {
      batch.closed = true
      return Response.json({ batch_id: batchId, status: 'PROCESSING', queued_tasks: 1, missing_student_count: 0, incomplete_tasks: [] }, { status: 202 })
    }
    if (path.endsWith('/results/ack')) {
      const saved = await store.getBatch(batchId)
      assert.ok(saved?.cursor && Object.values(saved.tasks).every(task => task.status === 'SUCCEEDED'))
      return new Response(null, { status: 204 })
    }
    if (path.endsWith('/results')) {
      polled.push(batchId)
      assert.ok(batch.closed, 'Only closed batches are polled')
      return Response.json({ items: [{ task_id: batch.taskId, student_id: batch.captureId, display_name: '', status: 'SUCCEEDED', updated_at: new Date().toISOString(), result: { cells: [], boxes: {} } }], next_cursor: '1', has_more: false })
    }
    throw new Error('Unexpected endpoint ' + path)
  } })
  const session = new ScanSession('session', 7, store, api)
  return { session, store, uploads, polled, loseReply: () => { loseReply = true }, dispose: () => { session.dispose(); api.dispose() } }
}

test('each photograph is submitted and closed as its own work', async () => {
  const f = fixture()
  try {
    const first = capture('T1', 1, 'Иванов'), second = capture('T1', 1, 'Иванов')
    await f.session.enqueue(first)
    await f.session.enqueue(second)
    await f.session.queue.drain()
    const batches = await f.session.batches()
    assert.equal(batches.length, 2)
    assert.ok(batches.every(batch => batch.status === 'PROCESSING'))
    assert.deepEqual(batches.map(batch => batch.assignmentId).sort(), [first.metadata.captureId, second.metadata.captureId].sort())
    assert.equal(f.uploads.length, 2)
    assert.ok((await f.session.captures()).every(record => record.submissionStatus === 'ACCEPTED'))
    await f.session.finish()
    assert.ok((await f.session.captures()).every(record => record.metadata.scanFinished))
  } finally { f.dispose() }
})

test('photographs of different printed forms stay separate submissions', async () => {
  const f = fixture()
  try {
    await f.session.enqueue(capture('T1'))
    await f.session.enqueue(capture('T2'))
    await f.session.queue.drain()
    const batches = await f.session.batches()
    assert.equal(batches.length, 2)
    assert.equal(new Set(batches.map(batch => batch.batchId)).size, 2)
    assert.equal(f.uploads.length, 2)
  } finally { f.dispose() }
})

test('lost upload reply keeps the photo failed and a retry resends the same page', async () => {
  const f = fixture()
  try {
    const record = capture()
    f.loseReply()
    await f.session.enqueue(record)
    await f.session.queue.drain()
    const failed = await f.store.getCapture(record.metadata.captureId)
    assert.equal(failed?.submissionStatus, 'FAILED')
    assert.ok(failed?.submissionError)
    assert.ok(f.session.queue.hasFailures)
    f.session.queue.enqueue(record.metadata.captureId)
    await f.session.queue.drain()
    assert.equal(f.uploads.length, 2)
    assert.deepEqual(f.uploads[0], f.uploads[1])
    assert.equal((await f.store.getCapture(record.metadata.captureId))?.submissionStatus, 'ACCEPTED')
    assert.equal((await f.session.batches()).length, 1)
  } finally { f.dispose() }
})

test('finish marks seen captures finished even when a delivery failed', async () => {
  const f = fixture()
  try {
    const record = capture()
    f.loseReply()
    await f.session.enqueue(record)
    await f.session.queue.drain()
    await f.session.finish()
    const saved = await f.store.getCapture(record.metadata.captureId)
    assert.equal(saved?.submissionStatus, 'FAILED')
    assert.equal(saved?.metadata.scanFinished, true)
  } finally { f.dispose() }
})

test('resume never resends historic photographs', async () => {
  const f = fixture()
  try {
    const saved = capture()
    saved.submissionStatus = 'ACCEPTED'
    saved.metadata.scanFinished = true
    await f.store.put(saved)
    await f.session.resume()
    await f.session.queue.drain()
    assert.equal(f.uploads.length, 0)
  } finally { f.dispose() }
})

test('poll collects results and acknowledge cleans only finished batches', async () => {
  const f = fixture()
  try {
    await f.session.enqueue(capture())
    await f.session.queue.drain()
    const open = capture()
    const openBatch: WorkflowBatch = { batchId: crypto.randomUUID(), ownerId: 7, scanSessionId: 'session', workTitle: 'Фотография работы',
      assignmentId: open.metadata.captureId, variant: 'auto', templateId: open.metadata.templateId, templateVersion: open.metadata.templateVersion,
      markerTemplateId: open.metadata.templateId, markerTemplateVersion: open.metadata.templateVersion,
      expectedStudentCount: 1, expectedPageCount: 1, status: 'OPEN', createdAt: new Date().toISOString(), cursor: '', tasks: {}, pendingAckTaskIds: [] }
    await f.store.putBatch(openBatch)
    await f.session.poll()
    assert.equal(f.polled.length, 1)
    const [batch] = (await f.session.batches()).filter(item => item.status !== 'OPEN')
    assert.ok(Object.values(batch.tasks).every(task => task.status === 'SUCCEEDED'))
    await f.session.acknowledge()
    const saved = await f.store.getBatch(batch.batchId)
    assert.equal(saved?.serverCleanupAcknowledged, true)
    assert.ok(!(await f.store.getBatch(openBatch.batchId))?.serverCleanupAcknowledged)
  } finally { f.dispose() }
})

test('page totals use only the exact printed template and revision from captured QR codes', () => {
  const otherRevision = capture('T1', 9)
  otherRevision.metadata.qr.raw = 'B1:T1:17:9'
  const context = scannedWork([capture('T1', 1), capture('T1', 3), otherRevision, capture('T2', 8)], 'B1:T1:18:1')
  assert.equal(context.templateId, 'T1')
  assert.equal(context.templateVersion, 18)
  assert.equal(context.expectedPageCount, 3)
  assert.equal(context.variant, 'auto')
  for (const raw of ['bad-qr', 'B1:T1:0:1', 'B1:T1:18:101']) assert.throws(() => scannedWork([], raw))
})