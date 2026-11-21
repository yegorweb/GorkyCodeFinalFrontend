import type { CaptureRecord, CaptureStore } from './uploadQueue';
import { upgradeCaptureDatabase } from './captureDatabase';
export { upgradeCaptureDatabase } from './captureDatabase';

export type BatchStatus = 'OPEN' | 'CLOSED' | 'PROCESSING' | 'COMPLETED' | 'CLOSED_INCOMPLETE' | 'CLEANING' | 'CLEANED';
export type ResultStatus = 'RECEIVING' | 'QUEUED' | 'PROCESSING' | 'SUCCEEDED' | 'FAILED' | 'INCOMPLETE';
export type StudentRecord = { batchId: string; studentId: string; displayName: string };
export type TaskRecord = { taskId: string; studentId: string; displayName: string; status: ResultStatus; receivedPages?: number; expectedPages?: number; missingPageNumbers?: number[]; result?: Record<string, unknown>; error?: { code: string; message: string; details?: Record<string, unknown> }; updatedAt?: string };
export type WorkflowBatch = {
  ownerId?: number; scanSessionId?: string; workTitle?: string; batchId: string; assignmentId: string; variant: string; templateId: string; templateVersion: number;
  markerTemplateId: string; markerTemplateVersion: number;
  expectedStudentCount: number; expectedPageCount: number; status: BatchStatus; createdAt: string;
  cursor: string; hasMore?: boolean; tasks: Record<string, TaskRecord>; pendingAckTaskIds: string[];
  acknowledgedTaskIds?: string[];
  missingStudentCount?: number; closeExpectedTaskCount?: number;
  acknowledgedMissingStudents?: boolean; serverCleanupAcknowledged?: boolean;
};
export type CreateBatchInput = Omit<WorkflowBatch, 'batchId' | 'status' | 'createdAt' | 'cursor' | 'tasks' | 'pendingAckTaskIds' | 'hasMore'>;
export interface WorkflowStore extends CaptureStore {
  getCapture(id: string): Promise<CaptureRecord | undefined>;
  getBatch(id: string): Promise<WorkflowBatch | undefined>;
  putBatch(batch: WorkflowBatch): Promise<void>;
  listBatches(): Promise<WorkflowBatch[]>;
  listCaptures(): Promise<CaptureRecord[]>;
  listStudents(batchId: string): Promise<StudentRecord[]>;
  putStudent(student: StudentRecord): Promise<void>;
  associatePage(record: CaptureRecord, batch: WorkflowBatch, student: StudentRecord): Promise<void>;
  clearBatch(batchId: string): Promise<void>;
}
import type { User } from '../../types/auth';
import type { PageReceipt, ResultItem, ResultPage, BatchCloseResult, ProcessedScan } from '../../types/grading';
type Fetcher = typeof fetch;
type Options = { store: WorkflowStore; fetcher?: Fetcher; origin?: string; preparationEndpoint?: string; id?: () => string };

const TASK_STATUSES: ResultStatus[] = ['RECEIVING', 'QUEUED', 'PROCESSING', 'SUCCEEDED', 'FAILED', 'INCOMPLETE'];
const TERMINAL_STATUSES = new Set<ResultStatus>(['SUCCEEDED', 'FAILED', 'INCOMPLETE']);
const randomId = () => crypto.randomUUID();

export function parsePrintedBatchQr(raw: string | undefined): { templateId: string; templateVersion: number; pageNumber: number; legacy: boolean } | null {
  if (!raw) return null;
  const current = /^B1:([^:]{1,100}):([1-9][0-9]*):([1-9][0-9]*)$/.exec(raw);
  const legacy = current ? null : /^B1:([^:]{1,100}):([1-9][0-9]*)$/.exec(raw);
  const match = current ?? legacy;
  if (!match) return null;
  const templateVersion = current ? Number(match[2]) : 16;
  const pageNumber = Number(current ? match[3] : match[2]);
  if (!Number.isSafeInteger(templateVersion) || !Number.isSafeInteger(pageNumber)) return null;
  return { templateId: match[1], templateVersion, pageNumber, legacy: !!legacy };
}

export function inferPrintedTemplateIdentity(rawQrValues: Array<string | undefined>): { templateId: string; templateVersion: number } | null {
  if (!rawQrValues.length) return null;
  const parsed = rawQrValues.map(parsePrintedBatchQr);
  if (parsed.some(value => !value)) return null;
  const identities = new Set(parsed.map(value => value!.templateId + ':' + value!.templateVersion));
  if (identities.size !== 1) return null;
  const identity = parsed[0]!;
  return { templateId: identity.templateId, templateVersion: identity.templateVersion };
}

export function pageNumberFromBatchQr(raw: string | undefined, printedTemplateId: string, templateVersion: number, expectedPageCount: number): number | null {
  if (!printedTemplateId || !Number.isInteger(templateVersion) || !Number.isInteger(expectedPageCount) || expectedPageCount < 1) return null;
  const qr = parsePrintedBatchQr(raw);
  if (!qr || qr.templateId !== printedTemplateId || qr.templateVersion !== templateVersion || qr.pageNumber > expectedPageCount) return null;
  return qr.pageNumber;
}

function isObject(value: unknown): value is Record<string, unknown> { return !!value && typeof value === 'object' && !Array.isArray(value); }
function nonEmpty(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error('Некорректный ответ сервера: ' + label);
  return value.trim();
}
async function bodyJson(response: Response, expected: number | number[]) {
  const codes = Array.isArray(expected) ? expected : [expected];
  if (!codes.includes(response.status)) {
    let message = 'HTTP ' + response.status;
    try { const body = await response.json(); if (typeof body?.error?.message === 'string') message = body.error.message; } catch { /* response is not JSON */ }
    throw new Error(message);
  }
  if (!response.headers.get('content-type')?.toLowerCase().includes('application/json')) throw new Error('Сервер не вернул JSON');
  const body: unknown = await response.json();
  if (!isObject(body)) throw new Error('Сервер вернул некорректный JSON');
  return body;
}
function validUUID(value: string) { return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value); }
function validateResultPage(body: Record<string, unknown>): ResultPage {
  if (!Array.isArray(body.items) || typeof body.next_cursor !== 'string' || body.next_cursor.length > 512 || typeof body.has_more !== 'boolean') throw new Error('Некорректная страница результатов');
  const items = body.items.map((raw): ResultItem => {
    if (!isObject(raw)) throw new Error('Некорректная запись результата');
    const status = raw.status as ResultStatus;
    if (!TASK_STATUSES.includes(status)) throw new Error('Неизвестный статус результата');
    if (raw.result !== undefined && !isObject(raw.result)) throw new Error('Некорректный result');
    if (raw.error !== undefined && (!isObject(raw.error) || typeof raw.error.code !== 'string' || typeof raw.error.message !== 'string')) throw new Error('Некорректная ошибка результата');
    return { task_id: nonEmpty(raw.task_id, 'task_id'), student_id: nonEmpty(raw.student_id, 'student_id'), display_name: typeof raw.display_name === 'string' ? raw.display_name : undefined, status, result: raw.result as Record<string, unknown> | undefined, error: raw.error as TaskRecord['error'], updated_at: nonEmpty(raw.updated_at, 'updated_at') };
  });
  return { items, next_cursor: body.next_cursor, has_more: body.has_more };
}

export class BatchWorkflow {
  private readonly store: WorkflowStore;
  private readonly fetcher: Fetcher;
  private readonly origin: string;
  private readonly preparationEndpoint: string;
  private readonly makeId: () => string;
  private disposed = false;
  private polling = new Set<string>();
  constructor(options: Options) {
    this.store = options.store; this.fetcher = options.fetcher ?? fetch.bind(globalThis);
    this.origin = options.origin ?? globalThis.location?.origin ?? 'http://localhost'; this.preparationEndpoint = options.preparationEndpoint ?? new URL('/v1/process', this.origin).href; this.makeId = options.id ?? randomId;
  }
  private ensureLive() { if (this.disposed) throw new Error('Сеанс сканера закрыт'); }
  private api(path: string) { return this.origin.replace(/\/$/, '') + path; }
  async currentUser(): Promise<User | null> {
    const response = await this.fetcher(this.api('/api/v1/auth/me'), { credentials: 'include', headers: { Accept: 'application/json' } });
    if (response.status === 401) return null;
    const body = await bodyJson(response, 200);
    if (!Number.isSafeInteger(body.id) || typeof body.email !== 'string') throw new Error('Некорректный профиль учителя');
    return { id: body.id as number, email: body.email };
  }
  async login(email: string, password: string): Promise<User> {
    const response = await this.fetcher(this.api('/api/v1/auth/login'), { method: 'POST', credentials: 'include', headers: { Accept: 'application/json', 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) });
    const body = await bodyJson(response, 200);
    if (!Number.isSafeInteger(body.id) || typeof body.email !== 'string') throw new Error('Некорректный профиль учителя');
    return { id: body.id as number, email: body.email };
  }
  async logout() { const response = await this.fetcher(this.api('/api/v1/auth/logout'), { method: 'POST', credentials: 'include' }); if (response.status !== 204) throw new Error('Не удалось завершить сеанс: HTTP ' + response.status); }
  async createBatch(input: CreateBatchInput): Promise<WorkflowBatch> {
    if (!input.templateId.trim() || input.templateId.length > 100) throw new Error('Укажите печатный template_id длиной до 100 символов');
    if (!Number.isSafeInteger(input.templateVersion) || input.templateVersion < 1) throw new Error('Укажите корректную revision печатного шаблона');
    if (!input.markerTemplateId.trim() || input.markerTemplateId.length > 100) throw new Error('Не выбран шаблон геометрии сканера');
    if (!Number.isSafeInteger(input.markerTemplateVersion) || input.markerTemplateVersion < 1) throw new Error('Некорректная версия геометрии сканера');
    const response = await this.fetcher(this.api('/api/v1/batches'), { method: 'POST', credentials: 'include', headers: { Accept: 'application/json', 'Content-Type': 'application/json' }, body: JSON.stringify({ assignment_id: input.assignmentId, variant: input.variant, template_id: input.templateId, template_version: input.templateVersion, expected_student_count: input.expectedStudentCount, expected_page_count: input.expectedPageCount }) });
    const body = await bodyJson(response, 201);
    const batchId = nonEmpty(body.batch_id, 'batch_id'); if (!validUUID(batchId)) throw new Error('Некорректный batch_id');
    const batch: WorkflowBatch = { ...input, batchId, status: body.status as BatchStatus, createdAt: nonEmpty(body.created_at, 'created_at'), cursor: '', tasks: {}, pendingAckTaskIds: [] };
    await this.store.putBatch(batch); return batch;
  }
  listBatches() { return this.store.listBatches(); }
  getBatch(batchId: string) { return this.store.getBatch(batchId); }
  listStudents(batchId: string) { return this.store.listStudents(batchId); }
  async addStudent(batchId: string, displayName: string): Promise<StudentRecord> {
    const batch = await this.requireBatch(batchId); if (batch.status !== 'OPEN') throw new Error('Нельзя добавлять ученика в закрытую проверку');
    const student = { batchId, studentId: this.makeId(), displayName: this.validName(displayName) };
    await this.store.putStudent(student); return student;
  }
  async renameStudent(batchId: string, studentId: string, displayName: string) {
    const student = (await this.store.listStudents(batchId)).find(value => value.studentId === studentId);
    if (!student) throw new Error('Ученик не найден в этой проверке');
    const updated = { ...student, displayName: this.validName(displayName) }; await this.store.putStudent(updated); return updated;
  }
  private validName(value: string) { const name = value.trim(); if (!name || name.length > 200) throw new Error('Укажите ФИО длиной до 200 символов'); return name; }
  private async requireBatch(id: string) { const batch = await this.store.getBatch(id); if (!batch) throw new Error('Проверка не найдена в браузерном хранилище'); return batch; }
  async prepare(captureId: string, batchId: string, pageNumber: number) {
    this.ensureLive(); const batch = await this.requireBatch(batchId);
    if (batch.status !== 'OPEN') throw new Error('Проверка закрыта для новых страниц');
    const current = await this.store.getCapture(captureId); if (!current) throw new Error('Скан не найден в браузерном хранилище');
    if (current.metadata.templateId !== batch.markerTemplateId || current.metadata.templateVersion !== batch.markerTemplateVersion) throw new Error('Скан сделан по другой геометрии листа или версии камеры');
    const printedQr = parsePrintedBatchQr(current.metadata.qr?.raw);
    if (printedQr && (printedQr.templateId !== batch.templateId || printedQr.templateVersion !== batch.templateVersion)) throw new Error('QR относится к другому печатному шаблону или его версии');
    const qrPageNumber = printedQr?.pageNumber;
    if (qrPageNumber !== undefined && qrPageNumber > batch.expectedPageCount) throw new Error('Номер страницы из QR превышает число листов в проверке');
    const effectivePageNumber = qrPageNumber ?? pageNumber;
    if (!Number.isInteger(effectivePageNumber) || effectivePageNumber < 1 || effectivePageNumber > batch.expectedPageCount) throw new Error('Номер страницы вне диапазона этой проверки');
    if (current.batchId && current.batchId !== batchId) throw new Error('Этот скан уже закреплён за другой проверкой');
    if (current.preparedBlob && current.pageNumber !== undefined && current.pageNumber !== effectivePageNumber) throw new Error('Повтор подготовки должен использовать исходный номер листа');
    if (['PREPARING', 'FAILED'].includes(current.preparationStatus ?? '') && current.pageNumber !== undefined && current.pageNumber !== effectivePageNumber) throw new Error('Повтор подготовки должен использовать исходный номер листа');
    if (current.submissionStatus === 'ACCEPTED') throw new Error('Скан уже принят сервером');
    if (current.preparedBlob && current.preparationStatus === 'AWAITING_CONFIRMATION') {
      const associated = { ...current, batchId, pageNumber: effectivePageNumber }; await this.store.put(associated); return associated;
    }
    await this.store.put({ ...current, batchId, pageNumber: effectivePageNumber });
    return this.prepareImage(captureId);
  }
  async prepareImage(captureId: string) {
    this.ensureLive();
    const current = await this.store.getCapture(captureId);
    if (!current) throw new Error('Скан не найден');
    if (current.preparedBlob && current.preparationStatus === 'AWAITING_CONFIRMATION') return current;
    const record: CaptureRecord = { ...current, preparationStatus: 'PREPARING', preparationError: undefined };
    await this.store.put(record);
    try {
      const response = await this.fetcher(this.preparationEndpoint, { method: 'POST', credentials: 'omit', headers: { Accept: 'application/json', 'Content-Type': current.blob.type }, body: current.blob });
      const body = await bodyJson(response, 200);
      if (typeof body.fio !== 'string' || typeof body.image_base64 !== 'string' || body.image_base64.length > 40 * 1024 * 1024 || !['image/png', 'image/jpeg'].includes(String(body.image_mime))) throw new Error('Сервис подготовки вернул некорректное изображение или ФИО');
      const prep = body as unknown as ProcessedScan;
      let bytes: Uint8Array<ArrayBuffer>;
      try { bytes = Uint8Array.from(atob(prep.image_base64), char => char.charCodeAt(0)); } catch { throw new Error('Подготовленное изображение передано некорректно'); }
      if (!bytes.length) throw new Error('Сервис подготовки вернул пустое изображение');
      const edited = new Blob([bytes], { type: prep.image_mime });
      const saved: CaptureRecord = { ...record, blob: edited, preparedBlob: edited, recognizedName: prep.fio.trim(), nameReviewRequired: prep.fio_review_required, preparationStatus: 'AWAITING_CONFIRMATION', preparationError: undefined };
      await this.store.put(saved); return saved;
    } catch (error) {
      const failed: CaptureRecord = { ...record, preparationStatus: 'FAILED', preparationError: error instanceof Error ? error.message : 'Ошибка подготовки изображения' };
      await this.store.put(failed); throw error;
    }
  }
  async confirmPage(captureId: string, batchId: string, studentId: string, displayName: string, pageNumber: number) {
    this.ensureLive(); const batch = await this.requireBatch(batchId); if (batch.status !== 'OPEN') throw new Error('Проверка закрыта для новых страниц');
    const record = await this.store.getCapture(captureId); if (!record?.preparedBlob) throw new Error('Сначала подготовьте скан');
    if (record.batchId && record.batchId !== batchId) throw new Error('Этот скан уже закреплён за другой проверкой');
    if (record.metadata.templateId !== batch.markerTemplateId || record.metadata.templateVersion !== batch.markerTemplateVersion) throw new Error('Скан сделан по другой геометрии листа или версии камеры');
    const printedQr = parsePrintedBatchQr(record.metadata.qr?.raw);
    if (printedQr && (printedQr.templateId !== batch.templateId || printedQr.templateVersion !== batch.templateVersion || printedQr.pageNumber > batch.expectedPageCount)) throw new Error('Печатный шаблон скана не совпадает с проверкой');
    if (record.submissionStatus === 'ACCEPTED' && record.taskId) return { task_id: record.taskId, page_id: record.pageId!, capture_id: captureId, status: 'RECEIVING' as const, received_pages: 1, expected_pages: batch.expectedPageCount };
    const student = (await this.store.listStudents(batchId)).find(value => value.studentId === studentId); if (!student) throw new Error('Выберите ученика из списка или создайте отдельного ученика');
    const name = this.validName(displayName); if (!Number.isInteger(pageNumber) || pageNumber < 1 || pageNumber > batch.expectedPageCount) throw new Error('Номер страницы вне диапазона этой проверки');
    if (student.displayName !== name) throw new Error('ФИО не совпадает с выбранным учеником. Измените запись ученика или создайте отдельную личность.');
    const pageId = record.pageId ?? this.makeId();
    if (['UPLOADING', 'FAILED'].includes(record.submissionStatus ?? '') && (record.pageId !== pageId || record.pageNumber !== pageNumber || record.studentId !== studentId || record.displayName !== name)) throw new Error('Повтор отправки должен сохранить исходные лист, ученика и ФИО');
    let uploading: CaptureRecord = { ...record, batchId, pageId, pageNumber, studentId, displayName: name, submissionStatus: 'UPLOADING', submissionError: undefined };
    await this.store.put(uploading);
    try {
      const form = new FormData(); form.append('image', record.preparedBlob, pageId + '.' + (record.preparedBlob.type === 'image/png' ? 'png' : 'jpg'));
      form.append('capture_id', captureId); form.append('student_id', studentId); form.append('display_name', name); form.append('page_id', pageId); form.append('page_number', String(pageNumber));
      form.append('template_id', batch.templateId); form.append('template_version', String(batch.templateVersion));
      if (record.metadata.qr?.raw) form.append('qr_raw', record.metadata.qr.raw);
      const response = await this.fetcher(this.api('/api/v1/batches/' + encodeURIComponent(batchId) + '/pages'), { method: 'POST', credentials: 'include', headers: { Accept: 'application/json', 'Idempotency-Key': captureId }, body: form });
      const body = await bodyJson(response, 202);
      const receipt: PageReceipt = { task_id: nonEmpty(body.task_id, 'task_id'), page_id: nonEmpty(body.page_id, 'page_id'), capture_id: nonEmpty(body.capture_id, 'capture_id'), status: body.status as PageReceipt['status'], received_pages: body.received_pages as number, expected_pages: body.expected_pages as number };
      if (!validUUID(receipt.task_id) || !validUUID(receipt.page_id) || !validUUID(receipt.capture_id) || receipt.capture_id !== captureId || receipt.page_id !== pageId || !['RECEIVING', 'QUEUED'].includes(receipt.status) || !Number.isInteger(receipt.received_pages) || receipt.received_pages < 1 || !Number.isInteger(receipt.expected_pages) || receipt.expected_pages !== batch.expectedPageCount || receipt.received_pages > receipt.expected_pages) throw new Error('Квитанция страницы не совпадает с отправленным сканом');
      const nextBatch = { ...batch, tasks: { ...batch.tasks, [receipt.task_id]: { ...(batch.tasks[receipt.task_id] ?? {}), taskId: receipt.task_id, studentId, displayName: name, status: receipt.status, receivedPages: receipt.received_pages, expectedPages: receipt.expected_pages } } };
      uploading = { ...uploading, taskId: receipt.task_id, submissionStatus: 'ACCEPTED', status: 'succeeded' };
      await this.store.associatePage(uploading, nextBatch, { ...student, displayName: name }); return receipt;
    } catch (error) {
      await this.store.put({ ...uploading, submissionStatus: 'FAILED', submissionError: error instanceof Error ? error.message : 'Ошибка отправки страницы' }); throw error;
    }
  }
  async closeBatch(batchId: string): Promise<BatchCloseResult> {
    const batch = await this.requireBatch(batchId);
    const unsubmitted = (await this.store.listCaptures()).filter(record => record.batchId === batchId && record.submissionStatus !== 'ACCEPTED');
    if (unsubmitted.length) throw new Error('Нельзя закрыть проверку: есть локальные листы, не принятые сервером. Отправьте их или сохраните отдельно');
    const response = await this.fetcher(this.api('/api/v1/batches/' + encodeURIComponent(batchId) + '/close'), { method: 'POST', credentials: 'include', headers: { Accept: 'application/json' } });
    const body = await bodyJson(response, 202);
    if (body.batch_id !== batchId || !['CLOSED', 'CLOSED_INCOMPLETE', 'PROCESSING'].includes(String(body.status)) || !Number.isSafeInteger(body.queued_tasks) || (body.queued_tasks as number) < 0 || !Number.isSafeInteger(body.missing_student_count) || (body.missing_student_count as number) < 0 || (body.missing_student_count as number) > batch.expectedStudentCount || !Array.isArray(body.incomplete_tasks)) throw new Error('Некорректный ответ закрытия проверки');
    const result = body as unknown as BatchCloseResult; const tasks = { ...batch.tasks }; const pending = new Set(batch.pendingAckTaskIds);
    for (const incomplete of result.incomplete_tasks) {
      if (!isObject(incomplete) || typeof incomplete.task_id !== 'string' || !validUUID(incomplete.task_id) || !Array.isArray(incomplete.missing_page_numbers) || incomplete.missing_page_numbers.some(page => !Number.isInteger(page) || page < 1)) throw new Error('Некорректный список неполных работ');
      const task = tasks[incomplete.task_id];
      tasks[incomplete.task_id] = { taskId: incomplete.task_id, studentId: task?.studentId ?? '', displayName: task?.displayName ?? 'Работа ' + incomplete.task_id.slice(0, 8), status: 'INCOMPLETE', missingPageNumbers: [...incomplete.missing_page_numbers], receivedPages: task?.receivedPages, expectedPages: task?.expectedPages };
      pending.add(incomplete.task_id);
    }
    await this.store.putBatch({
      ...batch, status: result.status, tasks, pendingAckTaskIds: [...pending],
      missingStudentCount: result.missing_student_count,
      closeExpectedTaskCount: result.queued_tasks + result.incomplete_tasks.length,
      acknowledgedMissingStudents: false, serverCleanupAcknowledged: false,
    }); return result;
  }
  async acknowledgePersistedResults(batchId: string, acknowledgeMissingStudents = false) {
    const batch = await this.requireBatch(batchId);
    if (batch.serverCleanupAcknowledged) return batch;
    const taskRecords = Object.values(batch.tasks);
    const expectedTaskCount = batch.closeExpectedTaskCount ?? taskRecords.length;
    if (batch.status === 'OPEN' || batch.hasMore || taskRecords.length < expectedTaskCount || taskRecords.some(task => !TERMINAL_STATUSES.has(task.status))) throw new Error('Сначала завершите проверку и сохраните все полученные результаты');
    const missingStudentCount = batch.missingStudentCount ?? 0;
    if (missingStudentCount > 0 && !acknowledgeMissingStudents) throw new Error('Отдельно подтвердите учеников без единого листа перед очисткой сервера');
    if (missingStudentCount === 0 && acknowledgeMissingStudents) throw new Error('Подтверждение отсутствующих учеников не требуется');
    const taskIds = [...new Set(batch.pendingAckTaskIds)];
    const response = await this.fetcher(this.api('/api/v1/batches/' + encodeURIComponent(batch.batchId) + '/results/ack'), { method: 'POST', credentials: 'include', headers: { Accept: 'application/json', 'Content-Type': 'application/json' }, body: JSON.stringify({ task_ids: taskIds, acknowledge_missing_students: missingStudentCount > 0 && acknowledgeMissingStudents }) });
    if (response.status !== 204) throw new Error('Не удалось подтвердить сохранённые результаты: HTTP ' + response.status);
    const saved = {
      ...batch, pendingAckTaskIds: [], acknowledgedTaskIds: [...new Set([...(batch.acknowledgedTaskIds ?? []), ...taskIds])],
      acknowledgedMissingStudents: missingStudentCount > 0 && acknowledgeMissingStudents, serverCleanupAcknowledged: true,
    };
    await this.store.putBatch(saved);
    return saved;
  }
  async pollResults(batchId: string): Promise<ResultPage> {
    this.ensureLive(); if (this.polling.has(batchId)) return { items: [], next_cursor: (await this.requireBatch(batchId)).cursor, has_more: false };
    this.polling.add(batchId);
    try {
      let batch = await this.requireBatch(batchId);
      const params = new URLSearchParams({ limit: '50' }); if (batch.cursor) params.set('cursor', batch.cursor);
      const response = await this.fetcher(this.api('/api/v1/batches/' + encodeURIComponent(batchId) + '/results?' + params), { credentials: 'include', headers: { Accept: 'application/json' } });
      const page = validateResultPage(await bodyJson(response, 200)); const tasks = { ...batch.tasks }; const pending = new Set(batch.pendingAckTaskIds);
      for (const item of page.items) {
        const old = tasks[item.task_id];
        if (!validUUID(item.task_id) || !validUUID(item.student_id)) throw new Error('Результат содержит некорректный task_id или student_id');
        if (old?.studentId && old.studentId !== item.student_id) throw new Error('Результат task_id связан с другим student_id');
        tasks[item.task_id] = { taskId: item.task_id, studentId: item.student_id, displayName: item.display_name ?? old?.displayName ?? '', status: item.status, result: item.result ?? old?.result, error: item.error ?? old?.error, updatedAt: item.updated_at, receivedPages: old?.receivedPages, expectedPages: old?.expectedPages, missingPageNumbers: old?.missingPageNumbers };
        if (TERMINAL_STATUSES.has(item.status)) pending.add(item.task_id);
      }
      batch = { ...batch, tasks, cursor: page.next_cursor, hasMore: page.has_more, pendingAckTaskIds: [...pending] };
      // Cursor and included results commit together before the ack request.
      await this.store.putBatch(batch); return page;
    } finally { this.polling.delete(batchId); }
  }
  async clearBatch(batchId: string) {
    const batch = await this.requireBatch(batchId);
    const tasks = Object.values(batch.tasks);
    if (!batch.serverCleanupAcknowledged || batch.pendingAckTaskIds.length || tasks.length < (batch.closeExpectedTaskCount ?? tasks.length) || tasks.some(task => !TERMINAL_STATUSES.has(task.status))) throw new Error('Очистка доступна только после сохранения и подтверждения всех результатов');
    const captures = (await this.store.listCaptures()).filter(record => record.batchId === batchId);
    if (captures.some(record => record.submissionStatus !== 'ACCEPTED')) throw new Error('Есть листы этой проверки, не принятые сервером. Они оставлены в браузере; локальная очистка заблокирована');
    await this.store.clearBatch(batchId);
  }
  dispose() { this.disposed = true; this.polling.clear(); }
}
