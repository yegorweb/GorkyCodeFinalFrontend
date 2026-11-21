import type { CaptureRecord } from './uploadQueue';
import type { StudentRecord, WorkflowBatch, WorkflowStore } from './batchWorkflow';

export const CAPTURE_DATABASE_NAME = 'proveryator-scanner-captures';
export const CAPTURE_DATABASE_VERSION = 2;

export function upgradeCaptureDatabase(db: IDBDatabase) {
  if (!db.objectStoreNames.contains('captures')) db.createObjectStore('captures', { keyPath: 'metadata.captureId' });
  if (!db.objectStoreNames.contains('batches')) db.createObjectStore('batches', { keyPath: 'batchId' });
  if (!db.objectStoreNames.contains('students')) {
    db.createObjectStore('students', { keyPath: ['batchId', 'studentId'] });
  }
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Ошибка браузерного хранилища'));
  });
}
function transactionDone(transaction: IDBTransaction) {
  return new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = transaction.onerror = () => reject(transaction.error ?? new Error('Ошибка транзакции браузерного хранилища'));
  });
}

export class IndexedDBWorkflowStore implements WorkflowStore {
  private db: Promise<IDBDatabase> | null = null;
  private open() {
    if (!globalThis.indexedDB) return Promise.reject(new Error('IndexedDB недоступен'));
    return this.db ??= new Promise((resolve, reject) => {
      const request = indexedDB.open(CAPTURE_DATABASE_NAME, CAPTURE_DATABASE_VERSION);
      request.onupgradeneeded = () => upgradeCaptureDatabase(request.result);
      request.onsuccess = () => { request.result.onversionchange = () => request.result.close(); resolve(request.result); };
      request.onerror = () => reject(request.error ?? new Error('Не удалось открыть хранилище'));
      request.onblocked = () => reject(new Error('Закройте другие вкладки сканера для обновления хранилища'));
    });
  }
  async list() {
    const db = await this.open(); const tx = db.transaction('captures', 'readonly'); const done = transactionDone(tx);
    const records = await requestResult(tx.objectStore('captures').getAll() as IDBRequest<CaptureRecord[]>); await done; return records;
  }
  async put(record: CaptureRecord) { const db = await this.open(); const tx = db.transaction('captures', 'readwrite'); const done = transactionDone(tx); tx.objectStore('captures').put(record); await done; }
  async delete(id: string) { const db = await this.open(); const tx = db.transaction('captures', 'readwrite'); const done = transactionDone(tx); tx.objectStore('captures').delete(id); await done; }
  async getCapture(id: string) { const db = await this.open(); const tx = db.transaction('captures', 'readonly'); const done = transactionDone(tx); const value = await requestResult(tx.objectStore('captures').get(id) as IDBRequest<CaptureRecord | undefined>); await done; return value; }
  async getBatch(id: string) { const db = await this.open(); const tx = db.transaction('batches', 'readonly'); const done = transactionDone(tx); const value = await requestResult(tx.objectStore('batches').get(id) as IDBRequest<WorkflowBatch | undefined>); await done; return value; }
  async putBatch(batch: WorkflowBatch) { const db = await this.open(); const tx = db.transaction('batches', 'readwrite'); const done = transactionDone(tx); tx.objectStore('batches').put(batch); await done; }
  async listBatches() { const db = await this.open(); const tx = db.transaction('batches', 'readonly'); const done = transactionDone(tx); const values = await requestResult(tx.objectStore('batches').getAll() as IDBRequest<WorkflowBatch[]>); await done; return values; }
  async listCaptures() { return this.list(); }
  async listStudents(batchId: string) { const db = await this.open(); const tx = db.transaction('students', 'readonly'); const done = transactionDone(tx); const values = await requestResult(tx.objectStore('students').getAll() as IDBRequest<StudentRecord[]>); await done; return values.filter(student => student.batchId === batchId); }
  async putStudent(student: StudentRecord) { const db = await this.open(); const tx = db.transaction('students', 'readwrite'); const done = transactionDone(tx); tx.objectStore('students').put(student); await done; }
  async associatePage(record: CaptureRecord, batch: WorkflowBatch, student: StudentRecord) {
    const db = await this.open(); const tx = db.transaction(['captures', 'batches', 'students'], 'readwrite'); const done = transactionDone(tx);
    tx.objectStore('captures').put(record);
    const batches = tx.objectStore('batches');
    const existing = batches.get(batch.batchId) as IDBRequest<WorkflowBatch | undefined>;
    existing.onsuccess = () => {
      const prior = existing.result;
      const tasks = { ...prior?.tasks };
      for (const [id, incoming] of Object.entries(batch.tasks)) {
        const old = tasks[id];
        tasks[id] = old && (old.receivedPages ?? 0) > (incoming.receivedPages ?? 0) ? { ...incoming, ...old } : { ...old, ...incoming };
      }
      batches.put({ ...prior, ...batch, tasks, pendingAckTaskIds: [...new Set([...(prior?.pendingAckTaskIds ?? []), ...batch.pendingAckTaskIds])] });
    };
    tx.objectStore('students').put(student); await done;
  }
  async clearBatch(batchId: string) {
    const db = await this.open();
    const [captures, students] = await Promise.all([this.listCaptures(), this.listStudents(batchId)]);
    const tx = db.transaction(['captures', 'batches', 'students'], 'readwrite'); const done = transactionDone(tx);
    const captureStore = tx.objectStore('captures');
    for (const record of captures.filter(value => value.batchId === batchId)) {
      if (record.submissionStatus === 'ACCEPTED') {
        captureStore.delete(record.metadata.captureId);
      } else {
        // Closing the batch must not destroy scans that the backend never accepted.
        const { batchId: _batchId, pageNumber: _pageNumber, studentId: _studentId, displayName: _displayName, taskId: _taskId, ...unsubmitted } = record;
        captureStore.put(unsubmitted);
      }
    }
    const studentStore = tx.objectStore('students');
    for (const student of students) studentStore.delete([student.batchId, student.studentId]);
    tx.objectStore('batches').delete(batchId); await done;
  }
  close() { void this.db?.then(db => db.close()); this.db = null; }
}
