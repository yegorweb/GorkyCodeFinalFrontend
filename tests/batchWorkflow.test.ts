import test from 'node:test';
import assert from 'node:assert/strict';
import { BatchWorkflow, inferPrintedTemplateIdentity, pageNumberFromBatchQr, parsePrintedBatchQr, upgradeCaptureDatabase, type WorkflowBatch, type WorkflowStore } from '../app/scanner/core/batchWorkflow.ts';
import type { CaptureRecord } from '../app/scanner/core/uploadQueue.ts';

class Store implements WorkflowStore {
  captures = new Map<string, CaptureRecord>();
  batches = new Map<string, WorkflowBatch>();
  students = new Map<string, { batchId: string; studentId: string; displayName: string }>();
  events: string[] = [];
  async list() { return [...this.captures.values()]; }
  async put(record: CaptureRecord) { await this.putCapture(record); }
  async delete(id: string) { this.captures.delete(id); }
  async getCapture(id: string) { return this.captures.get(id); }
  async putCapture(record: CaptureRecord) { this.captures.set(record.metadata.captureId, { ...record }); this.events.push('capture'); }
  async getBatch(id: string) { return this.batches.get(id); }
  async putBatch(batch: WorkflowBatch) { this.batches.set(batch.batchId, structuredClone(batch)); this.events.push('batch'); }
  async listBatches() { return [...this.batches.values()]; }
  async listCaptures() { return [...this.captures.values()]; }
  async listStudents(id: string) { return [...this.students.values()].filter(student => student.batchId === id); }
  async putStudent(student: { batchId: string; studentId: string; displayName: string }) { this.students.set(`${student.batchId}:${student.studentId}`, student); }
  async clearBatch(id: string) { this.batches.delete(id); for (const [key, student] of this.students) if (student.batchId === id) this.students.delete(key); for (const [key, record] of this.captures) if (record.batchId === id) this.captures.delete(key); }
  async associatePage(record: CaptureRecord, batch: WorkflowBatch, student: { batchId: string; studentId: string; displayName: string }) {
    await this.putCapture(record); await this.putBatch(batch); await this.putStudent(student);
  }
}

const uuid = (digit: string) => `${digit.repeat(8)}-${digit.repeat(4)}-4${digit.repeat(3)}-8${digit.repeat(3)}-${digit.repeat(12)}`;
const batchId = uuid('b');
const capture = (id = uuid('a')): CaptureRecord => ({
  metadata: { captureId: id, cycleId: id, qr: { raw: 'B1:TS:17:1', data: null, format: 'text' }, templateId: 'provided-physics-sheet', templateVersion: 1, capturedAt: '2026-11-20T10:00:00.000Z', quality: {} },
  blob: new Blob(['original'], { type: 'image/jpeg' }), status: 'queued', attempts: 0, pageId: uuid('5'),
});
const makeBatch = (): WorkflowBatch => ({
  batchId, assignmentId: 'exam-1', variant: 'A', templateId: 'TS', templateVersion: 17,
  markerTemplateId: 'provided-physics-sheet', markerTemplateVersion: 1,
  expectedStudentCount: 2, expectedPageCount: 2, status: 'OPEN', createdAt: '2026-11-20T10:00:00Z', cursor: '', tasks: {}, pendingAckTaskIds: [],
});
const poll = async (fn: () => boolean) => { for (let n = 0; n < 100; n++) { if (fn()) return; await new Promise(resolve => setTimeout(resolve, 5)); } throw new Error('condition timed out'); };

test('batch QR page extraction requires exact version, selected template and page range', () => {
  assert.equal(pageNumberFromBatchQr('B1:TS-40edbcbf82915c87:17:2', 'TS-40edbcbf82915c87', 17, 4), 2);
  for (const raw of [
    'B1:OTHER-TEMPLATE:17:2', 'B1:TS-40edbcbf82915c87:16:2', 'B1:TS-40edbcbf82915c87:17:0', 'B1:TS-40edbcbf82915c87:17:5',
    'B1:TS-40edbcbf82915c87:17:2:extra', 'B1:TS-40edbcbf82915c87:17:02', 'json-qr', 'https://example.org/2',
  ]) assert.equal(pageNumberFromBatchQr(raw, 'TS-40edbcbf82915c87', 17, 4), null, raw);
});

test('batch creation sends printed template identity and keeps scanner geometry local', async () => {
  const store = new Store(); let requestBody: Record<string, unknown> | undefined;
  const workflow = new BatchWorkflow({ store, origin: 'http://localhost:3000', fetcher: async (_input, init) => {
    requestBody = JSON.parse(String(init?.body));
    return Response.json({ batch_id: batchId, status: 'OPEN', created_at: '2026-11-20T10:00:00Z' }, { status: 201 });
  }});
  const batch = await workflow.createBatch({ assignmentId: 'exam-1', variant: 'A', templateId: 'TS', templateVersion: 17, markerTemplateId: 'provided-physics-sheet', markerTemplateVersion: 1, expectedStudentCount: 2, expectedPageCount: 3 });
  assert.deepEqual(requestBody, { assignment_id: 'exam-1', variant: 'A', template_id: 'TS', template_version: 17, expected_student_count: 2, expected_page_count: 3 });
  assert.equal(batch.markerTemplateId, 'provided-physics-sheet');
  workflow.dispose();
});

test('printed template ID is taken only from canonical B1 QR values', () => {
  assert.deepEqual(parsePrintedBatchQr('B1:TS-40edbcbf82915c87:17:2'), { templateId: 'TS-40edbcbf82915c87', templateVersion: 17, pageNumber: 2, legacy: false });
  assert.deepEqual(parsePrintedBatchQr('B1:TS-40edbcbf82915c87:2'), { templateId: 'TS-40edbcbf82915c87', templateVersion: 16, pageNumber: 2, legacy: true });
  for (const raw of ['B1::2', 'B1:TS:0', 'B1:TS:02', 'B1:TS:2:extra', 'B2:TS:2', 'json-qr', 'https://example.org/2']) {
    assert.equal(parsePrintedBatchQr(raw), null, raw);
  }
});

test('printed template auto-detection requires consistent canonical QR identities', () => {
  assert.deepEqual(inferPrintedTemplateIdentity(['B1:TS:17:1', 'B1:TS:17:2']), { templateId: 'TS', templateVersion: 17 });
  assert.deepEqual(inferPrintedTemplateIdentity(['B1:TS:1', 'B1:TS:2']), { templateId: 'TS', templateVersion: 16 });
  assert.equal(inferPrintedTemplateIdentity([]), null);
  assert.equal(inferPrintedTemplateIdentity(['B1:TS:17:1', 'B1:OTHER:17:2']), null);
  assert.equal(inferPrintedTemplateIdentity(['B1:TS:17:1', 'json-qr']), null);
});

test('real preparation sends original bytes and preserves capture and QR page across retry', async () => {
  const base = capture(); const record = { ...base, metadata: { ...base.metadata, qr: { raw: 'B1:TS:17:2', data: null, format: 'text' as const } } };
  const store = new Store(); await store.putCapture(record); await store.putBatch(makeBatch());
  let requests = 0;
  const workflow = new BatchWorkflow({ store, origin: 'http://localhost:3000', preparationEndpoint: 'http://localhost:8000/v1/process', fetcher: async (url, init) => {
    assert.equal(String(url), 'http://localhost:8000/v1/process');
    assert.equal(init?.method, 'POST'); assert.equal(init?.credentials, 'omit');
    assert.ok(init?.body instanceof Blob); assert.equal(await init.body.text(), await record.blob.text());
    if (++requests === 1) return new Response('retry', { status: 503 });
    return Response.json({ fio: 'Иванов Иван', fio_confidence: 0.9, fio_review_required: false, fio_ocr_source: 'local', image_mime: 'image/png', image_base64: btoa('edited') });
  } });
  await assert.rejects(workflow.prepare(record.metadata.captureId, batchId, 1));
  await workflow.prepare(record.metadata.captureId, batchId, 1);
  await workflow.prepare(record.metadata.captureId, batchId, 1);
  const prepared = await store.getCapture(record.metadata.captureId);
  assert.equal(requests, 2); assert.equal(prepared?.recognizedName, 'Иванов Иван');
  assert.equal(await prepared?.preparedBlob?.text(), 'edited');
  assert.equal(prepared?.preparedBlob?.type, 'image/png'); assert.equal(prepared?.pageNumber, 2);
  assert.equal(prepared?.batchId, batchId); assert.equal(prepared?.metadata.captureId, record.metadata.captureId);
  workflow.dispose();
});

test('preparation rejects invalid MIME, base64 and empty images without secondary fetches', async () => {
  for (const response of [
    { fio: 'Иванов Иван', image_mime: 'text/html', image_base64: 'abcd' },
    { fio: 'Иванов Иван', image_mime: 'image/png', image_base64: '!!!' },
    { fio: 'Иванов Иван', image_mime: 'image/png', image_base64: '' },
  ]) {
    const store = new Store(); const record = capture(); await store.putCapture(record); await store.putBatch(makeBatch());
    let requests = 0;
    const workflow = new BatchWorkflow({ store, origin: 'http://localhost:3000', fetcher: async () => { requests++; return Response.json(response) } });
    await assert.rejects(workflow.prepare(record.metadata.captureId, batchId, 1));
    assert.equal(requests, 1); assert.equal((await store.getCapture(record.metadata.captureId))?.preparedBlob, undefined);
    workflow.dispose();
  }
});

test('preparation rejects a recognized QR from another printed template', async () => {
  const original = capture(); const store = new Store(); const record = { ...original, metadata: { ...original.metadata, qr: { raw: 'B1:OTHER:17:1', data: null, format: 'text' as const } } }; await store.putCapture(record); await store.putBatch(makeBatch());
  let requests = 0;
  const workflow = new BatchWorkflow({ store, origin: 'http://localhost:3000', fetcher: async () => { requests++; throw new Error('request should not be sent'); } });
  await assert.rejects(workflow.prepare(record.metadata.captureId, batchId, 1), /печатному шаблону/i);
  assert.equal(requests, 0);
  workflow.dispose();
});

test('preparation pins an unsubmitted capture to its batch and page for safe retries', async () => {
  const base = capture(); const record = { ...base, metadata: { ...base.metadata, qr: { raw: 'unstructured-qrcode', data: null, format: 'text' as const } } }; const store = new Store(); await store.putCapture(record); await store.putBatch(makeBatch());
  const otherBatch = { ...makeBatch(), batchId: uuid('c') }; await store.putBatch(otherBatch);
  let requests = 0;
  const workflow = new BatchWorkflow({ store, origin: 'http://localhost:3000', fetcher: async () => { requests++; return new Response('offline', { status: 503 }); } });
  await assert.rejects(workflow.prepare(record.metadata.captureId, batchId, 2));
  await assert.rejects(workflow.prepare(record.metadata.captureId, otherBatch.batchId, 2), /другой проверкой/i);
  await assert.rejects(workflow.prepare(record.metadata.captureId, batchId, 1), /исходный номер листа/);
  const saved = await store.getCapture(record.metadata.captureId);
  assert.equal(saved?.batchId, batchId); assert.equal(saved?.pageNumber, 2); assert.equal(requests, 1);
  workflow.dispose();
});

test('equal names create separate pseudonymous students unless explicitly reused', async () => {
  const store = new Store(); await store.putBatch(makeBatch());
  const workflow = new BatchWorkflow({ store, origin: 'http://localhost:3000', fetcher: fetch });
  const first = await workflow.addStudent(batchId, 'Петров Пётр');
  const second = await workflow.addStudent(batchId, 'Петров Пётр');
  assert.notEqual(first.studentId, second.studentId);
  assert.equal((await workflow.listStudents(batchId)).length, 2);
  workflow.dispose();
});

test('page upload uses multipart and persists the task_id to the stable page relation', async () => {
  const store = new Store(); const record = { ...capture(), preparedBlob: new Blob(['edited'], { type: 'image/jpeg' }), mockName: 'Сидоров Сидор', preparationId: uuid('d'), preparationStatus: 'AWAITING_CONFIRMATION' as const };
  await store.putCapture(record); await store.putBatch(makeBatch());
  const student = await new BatchWorkflow({ store, origin: 'http://localhost:3000', fetcher: fetch }).addStudent(batchId, 'Сидоров Сидор');
  let payload: FormData | undefined; let idem = '';
  const workflow = new BatchWorkflow({ store, origin: 'http://localhost:3000', fetcher: async (_input, init) => {
    payload = init?.body as FormData; idem = new Headers(init?.headers).get('Idempotency-Key') ?? '';
    return Response.json({ task_id: uuid('6'), page_id: record.pageId, capture_id: record.metadata.captureId, status: 'RECEIVING', received_pages: 1, expected_pages: 2 }, { status: 202 });
  }});
  await workflow.confirmPage(record.metadata.captureId, batchId, student.studentId, 'Сидоров Сидор', 1);
  assert.equal(idem, record.metadata.captureId);
  assert.equal(payload?.get('image') instanceof Blob, true);
  assert.equal(payload?.get('student_id'), student.studentId);
  assert.equal(payload?.get('page_id'), record.pageId);
  assert.equal(payload?.get('template_id'), 'TS');
  assert.equal(payload?.get('template_version'), '17');
  const saved = await store.getCapture(record.metadata.captureId);
  assert.equal(saved?.taskId, uuid('6'));
  assert.equal(saved?.pageNumber, 1);
  workflow.dispose();
});

test('poll results correlate by task_id and persist before acknowledgement', async () => {
  const store = new Store(); const batch = makeBatch(); batch.status = 'PROCESSING'; batch.tasks = {
    [uuid('1')]: { taskId: uuid('1'), studentId: uuid('2'), displayName: 'Первый', status: 'QUEUED' },
    [uuid('3')]: { taskId: uuid('3'), studentId: uuid('4'), displayName: 'Второй', status: 'QUEUED' },
  }; await store.putBatch(batch);
  let ackSawPersistedResults = false;
  let ackBody: Record<string, unknown> | undefined;
  const workflow = new BatchWorkflow({ store, origin: 'http://localhost:3000', fetcher: async (input, init) => {
    const url = String(input);
    if (url.includes('/results/ack')) {
      ackBody = JSON.parse(String(init?.body));
      const saved = await store.getBatch(batchId);
      ackSawPersistedResults = !!saved?.cursor && Object.values(saved.tasks).length === 2 && Object.values(saved.tasks).every(task => ['SUCCEEDED', 'FAILED', 'INCOMPLETE'].includes(task.status));
      return new Response(null, { status: 204 });
    }
    if (url.includes('/results?')) return Response.json({ items: [
      { task_id: uuid('3'), student_id: uuid('4'), display_name: 'Второй', status: 'SUCCEEDED', result: { score: 4 }, updated_at: '2026-11-20T10:00:02Z' },
      { task_id: uuid('1'), student_id: uuid('2'), display_name: 'Первый', status: 'FAILED', error: { code: 'READ', message: 'Не прочитано' }, updated_at: '2026-11-20T10:00:01Z' },
    ], next_cursor: 'cursor-1', has_more: false });
    throw new Error(`unexpected request: ${url} ${init?.method}`);
  }});
  await workflow.pollResults(batchId);
  const saved = await store.getBatch(batchId);
  assert.equal(saved?.tasks[uuid('1')].status, 'FAILED');
  assert.deepEqual(saved?.tasks[uuid('3')].result, { score: 4 });
  assert.equal(saved?.cursor, 'cursor-1');
  assert.equal(ackSawPersistedResults, false);
  await workflow.acknowledgePersistedResults(batchId);
  assert.equal(ackSawPersistedResults, true);
  assert.deepEqual(ackBody, { task_ids: [uuid('3'), uuid('1')], acknowledge_missing_students: false });
  assert.equal((await store.getBatch(batchId))?.serverCleanupAcknowledged, true);
  workflow.dispose();
});

test('schema upgrade keeps v1 captures and adds batch and student stores', () => {
  const stores = new Set(['captures']);
  const fakeDb = { objectStoreNames: { contains: (name: string) => stores.has(name) }, createObjectStore: (name: string) => { stores.add(name); } } as unknown as IDBDatabase;
  upgradeCaptureDatabase(fakeDb);
  assert.deepEqual([...stores].sort(), ['batches', 'captures', 'students']);
});

test('empty result responses retain the previously persisted cursor and terminal tasks', async () => {
  const store = new Store();
  const task = { taskId: uuid('3'), studentId: uuid('4'), displayName: 'Иванов', status: 'SUCCEEDED' as const, result: { cells: [] } };
  await store.putBatch({ ...makeBatch(), status: 'PROCESSING', cursor: 'saved-cursor', tasks: { [task.taskId]: task }, pendingAckTaskIds: [task.taskId] });
  const workflow = new BatchWorkflow({ store, fetcher: async input => {
    assert.equal(new URL(String(input)).searchParams.get('cursor'), 'saved-cursor');
    return Response.json({ items: [], next_cursor: '', has_more: false });
  } });
  await workflow.pollResults(batchId);
  assert.equal((await store.getBatch(batchId))?.cursor, 'saved-cursor');
  assert.deepEqual((await store.getBatch(batchId))?.tasks[task.taskId], task);
  assert.deepEqual((await store.getBatch(batchId))?.pendingAckTaskIds, [task.taskId]);
});

test('poll treats a cleaned-up server batch as finished instead of surfacing 404', async () => {
  const store = new Store();
  const task = { taskId: uuid('3'), studentId: uuid('4'), displayName: 'Иванов', status: 'SUCCEEDED' as const, result: { cells: [] } };
  await store.putBatch({ ...makeBatch(), status: 'PROCESSING', cursor: 'stale-cursor', tasks: { [task.taskId]: task }, pendingAckTaskIds: [task.taskId] });
  const workflow = new BatchWorkflow({ store, fetcher: async () => Response.json({ error: { code: 'NOT_FOUND', message: 'Resource not found' } }, { status: 404 }) });
  const page = await workflow.pollResults(batchId);
  assert.deepEqual(page.items, []);
  assert.equal(page.has_more, false);
  const saved = await store.getBatch(batchId);
  assert.equal(saved?.serverCleanupAcknowledged, true);
  assert.deepEqual(saved?.pendingAckTaskIds, []);
  assert.deepEqual(saved?.tasks[task.taskId], task);
  workflow.dispose();
});

test('missing student requires explicit acknowledgement and supports an empty ACK plus separate cleanup', async () => {
  const store = new Store(); const batch = makeBatch(); batch.expectedStudentCount = 1;
  await store.putBatch(batch);
  let ackBody: Record<string, unknown> | undefined;
  const workflow = new BatchWorkflow({ store, origin: 'http://localhost:3000', fetcher: async (input, init) => {
    if (String(input).endsWith('/close')) return Response.json({ batch_id: batchId, status: 'CLOSED_INCOMPLETE', queued_tasks: 0, missing_student_count: 1, incomplete_tasks: [] }, { status: 202 });
    if (String(input).endsWith('/results/ack')) {
      ackBody = JSON.parse(String(init?.body));
      return new Response(null, { status: 204 });
    }
    throw new Error('unexpected request');
  }});
  await workflow.closeBatch(batchId);
  assert.equal((await store.getBatch(batchId))?.missingStudentCount, 1);
  await assert.rejects(workflow.acknowledgePersistedResults(batchId), /подтвердите.*ученик/i);
  await workflow.acknowledgePersistedResults(batchId, true);
  assert.deepEqual(ackBody, { task_ids: [], acknowledge_missing_students: true });
  assert.equal((await store.getBatch(batchId))?.acknowledgedMissingStudents, true);
  assert.equal((await store.getBatch(batchId))?.serverCleanupAcknowledged, true);
  await workflow.clearBatch(batchId);
  assert.equal(await store.getBatch(batchId), undefined);
  workflow.dispose();
});

test('close refuses a batch-scoped capture that the backend has not accepted', async () => {
  const store = new Store(); const batch = makeBatch(); const scan = { ...capture(), batchId, pageNumber: 1, preparationStatus: 'AWAITING_CONFIRMATION' as const, preparedBlob: new Blob(['edited'], { type: 'image/jpeg' }) };
  await store.putBatch(batch); await store.putCapture(scan);
  let requests = 0;
  const workflow = new BatchWorkflow({ store, origin: 'http://localhost:3000', fetcher: async () => { requests++; throw new Error('close must not reach server'); } });
  await assert.rejects(workflow.closeBatch(batchId), /не принятые сервером/i);
  assert.equal(requests, 0);
  assert.equal((await store.getBatch(batchId))?.status, 'OPEN');
  assert.equal((await store.getCapture(scan.metadata.captureId))?.batchId, batchId);
  workflow.dispose();
});

test('close rejects a missing-student count outside the contract', async () => {
  const store = new Store(); await store.putBatch(makeBatch());
  const workflow = new BatchWorkflow({ store, origin: 'http://localhost:3000', fetcher: async () => Response.json({ batch_id: batchId, status: 'CLOSED', queued_tasks: 0, missing_student_count: -1, incomplete_tasks: [] }, { status: 202 }) });
  await assert.rejects(workflow.closeBatch(batchId), /ответ закрытия/i);
  assert.equal((await store.getBatch(batchId))?.status, 'OPEN');
  workflow.dispose();
});
