import { BatchWorkflow, parsePrintedBatchQr, type WorkflowBatch, type WorkflowStore } from './batchWorkflow'
import { ConcurrentUploads } from './concurrentUploads'
import type { CaptureRecord } from './uploadQueue'

type ScanWork = { assignmentId: string; title: string; variant: string; templateId: string; templateVersion: number; expectedPageCount: number }

export function scannedWork(captures: CaptureRecord[], raw: string, printedPageCount?: number): ScanWork {
  const qr = parsePrintedBatchQr(raw)
  if (!qr) throw new Error('На листе не найден QR бланка')
  if (qr.pageNumber > 100) throw new Error('Номер листа должен быть от 1 до 100')
  if (printedPageCount !== undefined && qr.pageNumber > printedPageCount) throw new Error('Номер страницы из QR превышает число листов в бланке')
  const observedPageCount = captures.reduce((count, record) => {
    const page = parsePrintedBatchQr(record.metadata.qr.raw)
    return page && page.templateId === qr.templateId && page.templateVersion === qr.templateVersion && page.pageNumber <= 100
      ? Math.max(count, page.pageNumber) : count
  }, qr.pageNumber)
  const expectedPageCount = printedPageCount ?? observedPageCount
  return { assignmentId: qr.templateId, title: 'Контрольная работа', variant: 'auto', templateId: qr.templateId,
    templateVersion: qr.templateVersion, expectedPageCount }
}

/** Every new photograph is an independent submission; historic records are never resumed. */
export class ScanSession {
  readonly queue: ConcurrentUploads
  private disposed = false
  private seen = new Set<string>()
  private polling: Promise<void> | undefined
  constructor(readonly id: string, readonly ownerId: number, private store: WorkflowStore, private api: BatchWorkflow,
    private changed: () => void = () => {}, private failed: (message: string) => void = () => {}) {
    this.queue = new ConcurrentUploads(id => this.send(id), changed)
  }
  async captures() {
    return (await this.store.listCaptures()).filter(record => record.metadata.ownerId === this.ownerId && (record.metadata.scanSessionId === this.id || record.batchId === this.id))
      .sort((a, b) => a.metadata.capturedAt.localeCompare(b.metadata.capturedAt))
  }
  async batches() { return (await this.store.listBatches()).filter(batch => batch.ownerId === this.ownerId && (batch.scanSessionId === this.id || batch.batchId === this.id)) }
  async enqueue(record: CaptureRecord) {
    if (this.disposed) throw new Error('Сканирование завершено')
    if (record.metadata.ownerId !== this.ownerId || record.metadata.scanSessionId !== this.id) throw new Error('Фото относится к другой проверке')
    if (this.seen.has(record.metadata.captureId)) return
    this.seen.add(record.metadata.captureId)
    await this.store.put(record)
    this.queue.enqueue(record.metadata.captureId)
    this.changed()
  }
  async resume() { /* Starting the camera never resends saved photographs. */ }
  private async send(id: string) {
    try {
      let record = await this.store.getCapture(id)
      if (!record || this.disposed || record.metadata.ownerId !== this.ownerId || record.metadata.scanSessionId !== this.id) return
      if (record.submissionStatus === 'ACCEPTED') return
      let batch = record.batchId ? await this.api.getBatch(record.batchId) : undefined
      if (!batch) {
        batch = await this.api.createBatch({ ownerId: this.ownerId, scanSessionId: this.id, workTitle: 'Фотография работы',
          assignmentId: record.metadata.captureId, variant: 'auto', templateId: record.metadata.templateId,
          templateVersion: record.metadata.templateVersion, markerTemplateId: record.metadata.templateId,
          markerTemplateVersion: record.metadata.templateVersion, expectedStudentCount: 1, expectedPageCount: 1 })
        record = { ...record, batchId: batch.batchId, pageId: record.pageId ?? crypto.randomUUID(), pageNumber: 1 }
        await this.store.put(record)
      }
      if (batch.ownerId !== this.ownerId || batch.scanSessionId !== this.id) throw new Error('Фото относится к другой проверке')
      await this.api.submitPhoto(id, batch.batchId)
      await this.api.closeBatch(batch.batchId)
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'Не удалось отправить фотографию'
      const record = await this.store.getCapture(id)
      if (record) await this.store.put({ ...record, submissionStatus: record.submissionStatus === 'ACCEPTED' ? 'ACCEPTED' : 'FAILED', submissionError: message })
      if (!this.disposed) this.failed(message)
      throw cause
    } finally { if (!this.disposed) this.changed() }
  }
  async finish() {
    await this.queue.drain()
    for (const record of await this.captures()) if (this.seen.has(record.metadata.captureId)) await this.store.put({ ...record, metadata: { ...record.metadata, scanFinished: true } })
    this.changed()
  }
  poll() {
    return this.polling ??= (async () => {
      for (const batch of await this.batches()) {
        if (this.disposed) return
        if (batch.status === 'OPEN' || batch.serverCleanupAcknowledged) continue
        for (let page = 0; page < 20 && !this.disposed; page++) { const result = await this.api.pollResults(batch.batchId); if (!result.has_more) break }
      }
      this.changed()
    })().finally(() => { this.polling = undefined })
  }
  async acknowledge() {
    for (const batch of await this.batches()) if (batch.status !== 'OPEN' && !batch.serverCleanupAcknowledged) await this.api.acknowledgePersistedResults(batch.batchId, false)
    this.changed()
  }
  dispose() { this.disposed = true; this.queue.dispose() }
}
