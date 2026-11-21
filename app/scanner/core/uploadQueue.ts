import { parseQrPayload } from '../vision/qr';
import type { QrPayload } from '../vision/types';
import { IndexedDBWorkflowStore } from './captureDatabase';
/** JSON upload contract: multipart image + metadata JSON, Idempotency-Key=captureId.
 * Server must atomically deduplicate this ID and return application/json:
 * {captureId,status:'accepted'|'processing'|'succeeded',resultUrl?,operationUrl?}.
 * HTML/redirects are not receipts. No existing legacy HTML endpoint is assumed.
 */
export type UploadStatus = 'queued' | 'uploading' | 'processing' | 'succeeded' | 'failed' | 'uncertain';
export type CaptureMetadata = {
  ownerId?: number; batchId?: string; scanSessionId?: string; scanFinished?: boolean;
  captureId: string; cycleId: string; qr: QrPayload;
  templateId: string; templateVersion: number;
  capturedAt: string; quality: unknown;
};
/** Only capture context plus decoded QR crosses the API boundary. */
function canonicalMetadata(metadata: CaptureMetadata): CaptureMetadata {
  if (!metadata.qr || typeof metadata.qr.raw !== 'string') throw new Error('У сохранённого скана нет QR. Снимите страницу заново');
  return { captureId: metadata.captureId, cycleId: metadata.cycleId,
    qr: parseQrPayload(metadata.qr.raw), templateId: metadata.templateId,
    templateVersion: metadata.templateVersion, capturedAt: metadata.capturedAt, quality: metadata.quality, ownerId: metadata.ownerId, batchId: metadata.batchId,
    ...(metadata.scanSessionId ? { scanSessionId: metadata.scanSessionId } : {}), ...(metadata.scanFinished ? { scanFinished: true } : {}) };
}
export type CaptureRecord = {
  metadata: CaptureMetadata; blob: Blob; status: UploadStatus; attempts: number;
  error?: string; resultUrl?: string; operationUrl?: string; retryAt?: number;
  /** Persisted before the first request: retries may never migrate to another API. */
  uploadEndpoint?: string;
  pageId?: string; batchId?: string; pageNumber?: number; studentId?: string; displayName?: string; taskId?: string;
  preparedBlob?: Blob; preparationId?: string; recognizedName?: string; nameReviewRequired?: boolean; preparationImageUrl?: string;
  preparationStatus?: 'PREPARING' | 'AWAITING_CONFIRMATION' | 'FAILED'; preparationError?: string;
  submissionStatus?: 'UPLOADING' | 'ACCEPTED' | 'FAILED'; submissionError?: string;
  localResult?: Record<string, unknown>; localResultStatus?: string;
};
export type UploadSettings = { mode: 'local' | 'http'; endpoint: string; maxItems: number; maxBytes: number; timeoutMs?: number };
export interface CaptureStore { list(): Promise<CaptureRecord[]>; put(record: CaptureRecord): Promise<void>; delete(id: string): Promise<void>; close?(): void }
type Receipt = { captureId: string; status: 'accepted' | 'processing' | 'succeeded' | 'failed'; resultUrl?: string; operationUrl?: string; error?: string };

export class IndexedDBCaptureStore extends IndexedDBWorkflowStore {}

const retryDelay = (attempts: number) => Math.min(60_000, 1000 * 2 ** Math.min(attempts, 6));
const MAX_AUTO_ATTEMPTS = 5;

/** Durable bounded queue. Local mode stores records but never performs requests. */
export class UploadQueue {
  private settings: UploadSettings;
  private store: CaptureStore;
  private fetcher: typeof fetch;
  private records: CaptureRecord[] = [];
  private accepts: (record: CaptureRecord) => boolean;
  private listeners = new Set<(records: CaptureRecord[]) => void>();
  private initialized = false;
  private disposed = false;
  private running = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private active: AbortController | null = null;
  private activeId: string | null = null;
  private mutation: Promise<unknown> = Promise.resolve();
  private generation = 0;
  private online = () => this.schedule(0);

  constructor(settings: UploadSettings, options: { store?: CaptureStore; fetcher?: typeof fetch; accepts?: (record: CaptureRecord) => boolean } = {}) {
    this.settings = { ...settings };
    this.validateSettings(settings);
    this.store = options.store ?? new IndexedDBCaptureStore();
    this.accepts = options.accepts ?? (() => true);
    this.fetcher = options.fetcher ?? globalThis.fetch.bind(globalThis);
    globalThis.addEventListener?.('online', this.online);
  }
  private validateSettings(settings: UploadSettings) {
    if (!Number.isFinite(settings.maxItems) || settings.maxItems < 1 || !Number.isFinite(settings.maxBytes) || settings.maxBytes <= 0) throw new Error('Некорректный лимит очереди');
    if (settings.mode === 'http' && !settings.endpoint.trim()) throw new Error('Укажите URL сервера');
  }
  private serialize<T>(fn: () => Promise<T>): Promise<T> {
    const result = this.mutation.then(fn, fn);
    this.mutation = result.catch(() => {});
    return result;
  }
  async init() {
    const records = (await this.store.list()).filter(this.accepts);
    for (const record of records) {
      if (!record.uploadEndpoint && record.attempts > 0 && ['uploading', 'processing', 'uncertain'].includes(record.status)) {
        // Old records without an origin cannot safely be retried against today's endpoint.
        record.uploadEndpoint = 'unknown';
      }
      if (record.status === 'uploading') {
        record.status = 'uncertain';
        record.error = 'Отправка была прервана. Повтор использует тот же captureId';
        record.retryAt = Date.now();
        await this.store.put(record);
      }
    }
    this.records = records;
    this.initialized = true;
    this.emit();
    this.schedule(0);
  }
  list() { return this.records.map(r => ({ ...r, metadata: { ...r.metadata } })); }
  subscribe(listener: (records: CaptureRecord[]) => void) { this.listeners.add(listener); listener(this.list()); return () => { this.listeners.delete(listener); }; }
  private emit() { const records = this.list(); for (const listener of this.listeners) listener(records); }
  hasCapacity(bytes = 0) { const pending = this.records.filter(record => record.status !== 'succeeded'); return this.initialized && !this.disposed && pending.length < this.settings.maxItems && pending.reduce((n, r) => n + r.blob.size, 0) + bytes <= this.settings.maxBytes; }
  async refresh() { this.records = (await this.store.list()).filter(this.accepts); this.emit(); }
  async enqueue(blob: Blob, metadata: CaptureMetadata): Promise<CaptureRecord> {
    const record = await this.serialize(async () => {
      if (!this.initialized || this.disposed) throw new Error('Хранилище сканера не готово');
      if (!metadata.captureId || blob.size === 0) throw new Error('Пустое изображение или идентификатор');
      if (!blob.type.startsWith('image/')) throw new Error('Ожидается изображение');
      if (this.records.some(r => r.metadata.captureId === metadata.captureId)) throw new Error('Захват с таким идентификатором уже сохранён');
      if (!this.hasCapacity(blob.size)) throw new Error('Очередь заполнена. Освободите место перед следующим захватом');
      const saved: CaptureRecord = { metadata: canonicalMetadata(metadata), blob, status: 'queued', attempts: 0, batchId: metadata.batchId };
      await this.store.put(saved); // No optimistic "saved" before transaction completion.
      this.records.push(saved);
      this.emit();
      return { ...saved };
    });
    this.schedule(0);
    return record;
  }
  updateSettings(settings: UploadSettings) {
    this.validateSettings(settings);
    const changed = this.settings.mode !== settings.mode || this.settings.endpoint !== settings.endpoint;
    this.settings = { ...settings };
    if (changed) { this.generation++; this.active?.abort(); }
    this.emit();
    this.schedule(0);
  }
  async retry(id: string) {
    await this.serialize(async () => {
      const record = this.records.find(r => r.metadata.captureId === id);
      if (!record || record.status === 'uploading' || record.status === 'succeeded' || this.activeId === id) return;
      const next = { ...record, status: record.operationUrl && record.status === 'processing' ? 'processing' as const : 'queued' as const, retryAt: undefined, attempts: 0, error: undefined };
      await this.save(next);
    });
    this.schedule(0);
  }
  async remove(id: string) {
    await this.serialize(async () => {
      const record = this.records.find(r => r.metadata.captureId === id);
      if (!record) return;
      if (record.status === 'uploading' || this.activeId === id) throw new Error('Дождитесь окончания отправки перед удалением');
      await this.store.delete(id);
      this.records = this.records.filter(r => r.metadata.captureId !== id);
      this.emit();
    });
  }
  private async save(record: CaptureRecord) {
    await this.store.put(record);
    const index = this.records.findIndex(r => r.metadata.captureId === record.metadata.captureId);
    if (index >= 0) this.records[index] = record;
    this.emit();
  }
  private schedule(delay: number) {
    if (this.disposed || !this.initialized || this.settings.mode !== 'http') return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => { this.timer = null; void this.pump(); }, delay);
  }
  private async receipt(response: Response, record: CaptureRecord): Promise<Receipt> {
    if (response.redirected || !response.headers.get('content-type')?.toLowerCase().includes('application/json')) throw new Error('Сервер не вернул JSON-квитанцию. Проверьте API, HTML-страницы не поддерживаются');
    const body = await response.json();
    if (!body || body.captureId !== record.metadata.captureId || !['accepted', 'processing', 'succeeded', 'failed'].includes(body.status)) throw new Error('Некорректная квитанция: captureId или статус не соответствует запросу');
    if (body.resultUrl !== undefined && typeof body.resultUrl !== 'string') throw new Error('Некорректный resultUrl');
    if (body.operationUrl !== undefined && typeof body.operationUrl !== 'string') throw new Error('Некорректный operationUrl');
    if (['accepted', 'processing'].includes(body.status) && !body.operationUrl) throw new Error('Сервер принял изображение, но не указал operationUrl для получения результата');
    if (body.error !== undefined && typeof body.error !== 'string') throw new Error('Некорректное описание ошибки сервера');
    const base = record.uploadEndpoint ?? this.safeURL(this.settings.endpoint);
    if (body.resultUrl) body.resultUrl = this.safeURL(body.resultUrl, base);
    if (body.operationUrl) {
      body.operationUrl = this.safeURL(body.operationUrl, base);
      if (new URL(body.operationUrl).origin !== new URL(base).origin) throw new Error('operationUrl должен принадлежать тому же серверу, что и загрузка');
    }
    return body as Receipt;
  }
  private safeURL(value: string, base = globalThis.location?.href ?? 'http://localhost/') {
    const url = new URL(value, base);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('Допустим только HTTP(S) URL без учётных данных');
    return url.href;
  }
  private async pump() {
    if (this.running || this.disposed || this.settings.mode !== 'http' || (typeof navigator !== 'undefined' && navigator.onLine === false)) return;
    const now = Date.now();
    const candidates = this.records.filter(r => ['queued', 'uncertain', 'processing'].includes(r.status) && r.attempts < MAX_AUTO_ATTEMPTS);
    const record = candidates.find(r => !r.retryAt || r.retryAt <= now);
    if (!record) {
      const next = Math.min(...candidates.map(r => r.retryAt ?? Infinity));
      if (Number.isFinite(next)) this.schedule(Math.max(100, next - now));
      return;
    }
    this.running = true;
    this.activeId = record.metadata.captureId;
    const generation = this.generation;
    const polling = record.status === 'processing' && !!record.operationUrl;
    let current: CaptureRecord = { ...record, status: polling ? 'processing' : 'uploading', attempts: record.attempts + 1, error: undefined };
    let timeout: ReturnType<typeof setTimeout> | undefined;
    let requestStarted = false;
    try {
      current.metadata = canonicalMetadata(current.metadata);
      const configuredEndpoint = this.safeURL(this.settings.endpoint);
      if (current.uploadEndpoint && current.uploadEndpoint !== configuredEndpoint) throw new Error('Этот захват привязан к другому серверу. Верните прежний URL для безопасного повтора');
      current.uploadEndpoint ??= configuredEndpoint;
      await this.save(current);
      if (generation !== this.generation || this.disposed || this.settings.mode !== 'http') throw new Error('Отправка остановлена из-за изменения настроек');
      this.active = new AbortController();
      timeout = setTimeout(() => this.active?.abort(), this.settings.timeoutMs ?? 60_000);
      const url = this.safeURL(polling ? current.operationUrl! : current.uploadEndpoint, current.uploadEndpoint);
      if (new URL(url).origin !== new URL(current.uploadEndpoint).origin) throw new Error('Адрес операции не принадлежит серверу загрузки');
      const data = new FormData();
      if (!polling) { data.append('image', current.blob, `${current.metadata.captureId}.${current.blob.type === 'image/png' ? 'png' : 'jpg'}`); data.append('metadata', JSON.stringify(current.metadata)); }
      requestStarted = true;
      const response = await this.fetcher(url, { method: polling ? 'GET' : 'POST', body: polling ? undefined : data, headers: { Accept: 'application/json', ...(polling ? {} : { 'Idempotency-Key': current.metadata.captureId }) }, credentials: 'same-origin', redirect: 'error', signal: this.active.signal });
      if (!response.ok) {
        const transient = response.status === 408 || response.status === 429 || response.status >= 500;
        current = { ...current, status: transient ? 'uncertain' : 'failed', error: `Сервер ответил HTTP ${response.status}`, retryAt: transient ? Date.now() + retryDelay(current.attempts) : undefined };
      } else {
        const receipt = await this.receipt(response, current);
        const complete = receipt.status === 'succeeded' || receipt.status === 'failed';
        current = { ...current, status: receipt.status === 'failed' ? 'failed' : complete ? 'succeeded' : 'processing', resultUrl: receipt.resultUrl, operationUrl: receipt.operationUrl, error: receipt.status === 'failed' ? receipt.error ?? 'Сервер не смог проанализировать изображение' : undefined, attempts: complete ? current.attempts : 0, retryAt: complete ? undefined : Date.now() + 2000 };
      }
      await this.save(current);
    } catch (error) {
      const uncertain = requestStarted;
      current = { ...current, status: uncertain ? (polling ? 'processing' : 'uncertain') : 'failed', error: error instanceof Error ? error.message : 'Ошибка отправки', retryAt: uncertain ? Date.now() + retryDelay(current.attempts) : undefined };
      try { await this.save(current); } catch { /* Keep in-memory evidence; original durable record remains recoverable. */ }
    } finally {
      if (timeout) clearTimeout(timeout);
      this.active = null;
      this.activeId = null;
      this.running = false;
      if (!this.disposed && (generation === this.generation || this.settings.mode === 'http')) this.schedule(100);
    }
  }
  dispose() {
    this.disposed = true;
    this.generation++;
    if (this.timer) clearTimeout(this.timer);
    this.active?.abort();
    this.listeners.clear();
    globalThis.removeEventListener?.('online', this.online);
    this.store.close?.();
  }
}
