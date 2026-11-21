import { BatchWorkflow, parsePrintedBatchQr, type WorkflowBatch, type WorkflowStore, type StudentRecord } from './batchWorkflow'
import { ConcurrentUploads } from './concurrentUploads'
import type { CaptureRecord } from './uploadQueue'

export function scannedWork(works: Work[], raw: string): Work {
  const qr = parsePrintedBatchQr(raw)
  if (!qr) throw new Error('На листе не найден QR бланка')
  const matches = works.filter(work => work.kind === 'version' && work.keyReady && work.assignmentId && work.layout?.template_id === qr.templateId &&
    Number(work.layout.revision) === qr.templateVersion && qr.pageNumber <= work.layout.pages.length)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || (b.versionNumber ?? 0) - (a.versionNumber ?? 0))
  if (!matches.length) throw new Error('Для этого бланка нет готового ключа')
  return matches[0]!
}

// A session can contain different keys. Each pupil has an independent backend batch;
// no roster size or preselected assignment is required by the scanner screen.
export class ScanSession {
  readonly queue: ConcurrentUploads
  private identityLock: Promise<unknown> = Promise.resolve()
  private disposed = false
  constructor(readonly id: string, readonly ownerId: number, private store: WorkflowStore, private api: BatchWorkflow,
    private works: () => Promise<Work[]>, private changed: () => void = () => {}, private failed: (message: string) => void = () => {}) {
    this.queue = new ConcurrentUploads(id => this.send(id), changed)
  }
  async captures() {
    return (await this.store.listCaptures()).filter(record => record.metadata.ownerId === this.ownerId && (record.metadata.scanSessionId === this.id || (!record.metadata.scanSessionId && record.batchId === this.id)))
      .sort((a, b) => a.metadata.capturedAt.localeCompare(b.metadata.capturedAt))
  }
  async batches() { return (await this.store.listBatches()).filter(batch => batch.ownerId === this.ownerId && (batch.scanSessionId === this.id || (!batch.scanSessionId && batch.batchId === this.id))) }
  async enqueue(record: CaptureRecord) {
    if (this.disposed) throw new Error('Сканирование завершено')
    if (record.metadata.ownerId !== this.ownerId || record.metadata.scanSessionId !== this.id) throw new Error('Скан относится к другой проверке')
    await this.store.put(record)
    this.queue.enqueue(record.metadata.captureId)
    this.changed()
  }
  async resume() { for (const record of await this.captures()) if (record.submissionStatus !== 'ACCEPTED') this.queue.enqueue(record.metadata.captureId) }
  private async assign(record: CaptureRecord, work: Work, pageNumber: number): Promise<{ batch: WorkflowBatch; student: StudentRecord }> {
    if (record.batchId && record.studentId) {
      const batch = await this.api.getBatch(record.batchId)
      const student = (await this.api.listStudents(record.batchId)).find(student => student.studentId === record.studentId)
      if (!batch || !student || batch.ownerId !== this.ownerId || batch.scanSessionId !== this.id) throw new Error('Не удалось восстановить отправку листа')
      return { batch, student }
    }
    const name = record.recognizedName?.trim() || ''
    const reservations = await this.captures()
    const candidates: { batch: WorkflowBatch; student: StudentRecord }[] = []
    if (name && work.layout!.pages.length > 1) {
      for (const batch of await this.batches()) {
        if (batch.status !== 'OPEN' || batch.assignmentId !== work.assignmentId) continue
        const student = (await this.api.listStudents(batch.batchId))[0]
        if (student?.displayName === name && !reservations.some(other => other.studentId === student.studentId && other.pageNumber === pageNumber)) candidates.push({ batch, student })
      }
    }
    let chosen = candidates.length === 1 ? candidates[0]! : undefined
    if (!chosen) {
      const batch = await this.api.createBatch({ ownerId: this.ownerId, scanSessionId: this.id, workTitle: work.title, assignmentId: work.assignmentId!, variant: work.spec.variant,
        templateId: work.layout!.template_id, templateVersion: Number(work.layout!.revision), markerTemplateId: record.metadata.templateId,
        markerTemplateVersion: record.metadata.templateVersion, expectedStudentCount: 1, expectedPageCount: work.layout!.pages.length })
      chosen = { batch, student: await this.api.addStudent(batch.batchId, name || 'Без имени') }
    }
    // Reserve before releasing the identity lock. Equal names with ambiguous
    // continuations are kept as separate submissions instead of merging pupils.
    await this.store.put({ ...record, batchId: chosen.batch.batchId, studentId: chosen.student.studentId, displayName: chosen.student.displayName,
      pageNumber, nameReviewRequired: record.nameReviewRequired || !name || candidates.length > 1 })
    return chosen
  }
  private async send(id: string) {
    try {
      const original = await this.store.getCapture(id)
      if (!original || original.metadata.ownerId !== this.ownerId || original.metadata.scanSessionId !== this.id) throw new Error('Скан не найден')
      if (original.submissionStatus === 'ACCEPTED') return
      const work = scannedWork(await this.works(), original.metadata.qr.raw)
      const pageNumber = parsePrintedBatchQr(original.metadata.qr.raw)!.pageNumber
      const prepared = await this.api.prepareImage(id)
      const selected = this.identityLock.then(() => this.assign(prepared, work, pageNumber))
      this.identityLock = selected.catch(() => {})
      const { batch, student } = await selected
      await this.api.prepare(id, batch.batchId, pageNumber)
      await this.api.confirmPage(id, batch.batchId, student.studentId, student.displayName, pageNumber)
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'Не удалось отправить лист'
      const record = await this.store.getCapture(id)
      if (record) await this.store.put({ ...record, submissionStatus: 'FAILED', submissionError: message })
      this.failed(message)
      throw cause
    } finally { if (!this.disposed) this.changed() }
  }
  async finish() {
    await this.queue.drain()
    for (const record of await this.captures()) if (record.submissionStatus !== 'ACCEPTED') this.queue.enqueue(record.metadata.captureId)
    await this.queue.drain()
    const captures = await this.captures()
    if (captures.some(record => record.batchId && record.submissionStatus !== 'ACCEPTED')) throw new Error('Не все листы загружены. Нажмите «Завершить» для повторной отправки')
    await Promise.all((await this.batches()).filter(batch => batch.status === 'OPEN').map(batch => this.api.closeBatch(batch.batchId)))
    for (const record of captures) await this.store.put({ ...record, metadata: { ...record.metadata, scanFinished: true } })
    this.changed()
  }
  async poll() {
    await Promise.all((await this.batches()).filter(batch => batch.status !== 'OPEN' && !batch.serverCleanupAcknowledged).map(async batch => {
      for (let page = 0; page < 20; page++) { await this.api.pollResults(batch.batchId); if (!(await this.api.getBatch(batch.batchId))?.hasMore) break }
    }))
    this.changed()
  }
  async acknowledge() {
    await Promise.all((await this.batches()).filter(batch => !batch.serverCleanupAcknowledged).map(batch => this.api.acknowledgePersistedResults(batch.batchId, false)))
    this.changed()
  }
  dispose() { this.disposed = true; this.queue.dispose() }
}
