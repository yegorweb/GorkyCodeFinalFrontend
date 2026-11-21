import test from 'node:test'
import assert from 'node:assert/strict'
import { BatchWorkflow, type WorkflowStore, type WorkflowBatch, type StudentRecord } from '../app/scanner/core/batchWorkflow'
import { ScanSession, scannedWork } from '../app/scanner/core/scanSession'
import type { CaptureRecord } from '../app/scanner/core/uploadQueue'
import { REFERENCE_TEMPLATE } from '../app/scanner/vision/template'
import { newStudioExam } from '../app/utils/studio'

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
function work(template = 'T1', pageCount = 1): Work {
  const id = crypto.randomUUID()
  return { id, ownerId: 7, title: template, status: 'ready', kind: 'version', draftId: crypto.randomUUID(), draftRevision: 1,
    familyId: crypto.randomUUID(), keyReady: true, assignmentId: `gb-${id}`, workId: 1, versionNumber: 1,
    createdAt: '2026-11-21T00:00:00Z', updatedAt: '2026-11-21T00:00:00Z', spec: newStudioExam(),
    layout: { template_id: template, revision: 18, page_count: pageCount, pages: Array.from({ length: pageCount }, () => ({})) } }
}
function capture(template = 'T1', page = 1, name = 'Иванов'): CaptureRecord {
  const id = crypto.randomUUID()
  return { metadata: { captureId: id, cycleId: id, ownerId: 7, scanSessionId: 'session', qr: { raw: `B1:${template}:18:${page}`, format: 'text', data: null },
    templateId: REFERENCE_TEMPLATE.id, templateVersion: REFERENCE_TEMPLATE.version, capturedAt: new Date().toISOString(), quality: {} },
    blob: new Blob([name], { type: 'image/jpeg' }), status: 'queued', attempts: 0 }
}
function fixture(keys: Work[]) {
  const store = new Store()
  const server = new Map<string, { taskId: string; pages: Set<number>; count: number; studentId?: string; name?: string }>()
  const uploads: { capture: string; page: string; student: string; batch: string }[] = []
  let loseReply = false, libraryUnavailable = false, preparations = 0
  const api = new BatchWorkflow({ store, origin: 'http://api.test', preparationEndpoint: 'http://preparation.test/v1/process', fetcher: async (input, options) => {
    const path = new URL(String(input)).pathname
    if (String(input).startsWith('http://preparation.test')) {
      preparations++
      return Response.json({ fio: await (options?.body as Blob).text(), fio_confidence: 1, fio_review_required: false, fio_ocr_source: 'test', image_mime: 'image/jpeg', image_base64: btoa('image') })
    }
    if (path === '/api/v1/batches') {
      const body = JSON.parse(String(options?.body)); assert.equal(body.expected_student_count, 1)
      assert.equal(body.scanSessionId, undefined); assert.equal(body.ownerId, undefined)
      const id = crypto.randomUUID()
      server.set(id, { taskId: crypto.randomUUID(), pages: new Set(), count: body.expected_page_count })
      return Response.json({ batch_id: id, status: 'OPEN', created_at: new Date().toISOString() }, { status: 201 })
    }
    const batchId = path.split('/')[4]!
    const batch = server.get(batchId)!
    if (path.endsWith('/pages')) {
      const form = options?.body as FormData
      const student = String(form.get('student_id'))
      assert.ok(!batch.studentId || batch.studentId === student, 'A batch must contain only one pupil')
      batch.studentId = student; batch.name = String(form.get('display_name')); batch.pages.add(Number(form.get('page_number')))
      uploads.push({ capture: String(form.get('capture_id')), page: String(form.get('page_id')), student, batch: batchId })
      assert.equal(new Headers(options?.headers).get('Idempotency-Key'), form.get('capture_id'))
      if (loseReply) { loseReply = false; throw new Error('Lost reply') }
      return Response.json({ task_id: batch.taskId, page_id: form.get('page_id'), capture_id: form.get('capture_id'), status: 'RECEIVING', received_pages: batch.pages.size, expected_pages: batch.count }, { status: 202 })
    }
    if (path.endsWith('/close')) {
      const missing = Array.from({ length: batch.count }, (_, i) => i + 1).filter(page => !batch.pages.has(page))
      return Response.json({ batch_id: batchId, status: missing.length ? 'CLOSED_INCOMPLETE' : 'PROCESSING', queued_tasks: missing.length ? 0 : 1, missing_student_count: 0,
        incomplete_tasks: missing.length ? [{ task_id: batch.taskId, missing_page_numbers: missing }] : [] }, { status: 202 })
    }
    if (path.endsWith('/results/ack')) {
      const saved = await store.getBatch(batchId)
      assert.ok(saved?.cursor && Object.values(saved.tasks).every(task => ['SUCCEEDED', 'INCOMPLETE'].includes(task.status)))
      return new Response(null, { status: 204 })
    }
    if (path.endsWith('/results')) return Response.json({ items: [{ task_id: batch.taskId, student_id: batch.studentId, display_name: batch.name, status: batch.pages.size === batch.count ? 'SUCCEEDED' : 'INCOMPLETE', updated_at: new Date().toISOString(), result: { cells: [] } }], next_cursor: '1', has_more: false })
    throw new Error('Unexpected endpoint ' + path)
  } })
  const session = new ScanSession('session', 7, store, api, async () => { if (libraryUnavailable) throw new Error('Library offline'); return keys })
  return { session, store, uploads, get preparations() { return preparations }, loseReply: () => { loseReply = true }, offline: () => { libraryUnavailable = true }, dispose: () => { session.dispose(); api.dispose() } }
}

test('one scan session accepts different keys and separate pupils with equal names', async () => {
  const f = fixture([work('T1'), work('T2')])
  try {
    await f.session.enqueue(capture('T1', 1, 'Иванов'))
    await f.session.enqueue(capture('T1', 1, 'Иванов'))
    await f.session.enqueue(capture('T2', 1, 'Петров'))
    await f.session.queue.drain()
    assert.equal((await f.session.batches()).length, 3)
    assert.ok((await f.session.captures()).every(record => record.submissionStatus === 'ACCEPTED'))
    await f.session.finish(); await f.session.poll(); await f.session.acknowledge()
    assert.ok((await f.session.batches()).every(batch => batch.serverCleanupAcknowledged))
    assert.ok((await f.session.captures()).every(record => record.metadata.scanFinished))
  } finally { f.dispose() }
})

test('out-of-order pages with a unique recognized name form one complete pupil submission', async () => {
  const f = fixture([work('T1', 2)])
  try {
    await f.session.enqueue(capture('T1', 2)); await f.session.enqueue(capture('T1', 1)); await f.session.queue.drain()
    assert.equal((await f.session.batches()).length, 1)
    assert.equal(new Set(f.uploads.map(upload => upload.student)).size, 1)
    await f.session.finish()
    assert.ok((await f.session.batches()).every(batch => batch.closeExpectedTaskCount === 1))
  } finally { f.dispose() }
})

test('ambiguous equal-name continuations never merge different pupils', async () => {
  const f = fixture([work('T1', 2)])
  try {
    await f.session.enqueue(capture('T1', 1)); await f.session.enqueue(capture('T1', 1)); await f.session.queue.drain()
    const prior = new Set(f.uploads.map(upload => upload.batch))
    const continuation = capture('T1', 2); await f.session.enqueue(continuation); await f.session.queue.drain()
    const record = await f.store.getCapture(continuation.metadata.captureId)
    assert.equal(prior.has(record!.batchId!), false)
    assert.equal(record?.nameReviewRequired, true)
    await f.session.finish()
  } finally { f.dispose() }
})

test('lost upload replies retry the same identity without fetching a changed key', async () => {
  const f = fixture([work()])
  try {
    f.loseReply(); await f.session.enqueue(capture()); await f.session.queue.drain()
    f.offline(); await f.session.finish()
    assert.equal(f.uploads.length, 2)
    assert.deepEqual(f.uploads[0], f.uploads[1])
    assert.equal(f.preparations, 1)
  } finally { f.dispose() }
})

test('unknown templates remain recoverable photos instead of being submitted to an unrelated key', async () => {
  const f = fixture([work()])
  try {
    const unknown = capture('UNKNOWN'); await f.session.enqueue(unknown); await f.session.queue.drain(); await f.session.finish()
    assert.equal(f.preparations, 0); assert.equal(f.uploads.length, 0)
    assert.equal(await (await f.store.getCapture(unknown.metadata.captureId))!.blob.text(), 'Иванов')
  } finally { f.dispose() }
})

test('template matching uses the latest ready key and validates revision and page number', () => {
  const old = work(); const latest = { ...old, id: crypto.randomUUID(), assignmentId: 'new', createdAt: '2026-11-21T10:00:00Z' }
  assert.equal(scannedWork([old, latest], 'B1:T1:18:1').id, latest.id)
  for (const raw of ['B1:T1:17:1', 'B1:T1:18:2', 'B1:UNKNOWN:18:1']) assert.throws(() => scannedWork([old], raw))
})
