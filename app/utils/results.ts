export const gradingStatusLabels: Record<string, string> = {
  RECEIVING: 'Листы принимаются', QUEUED: 'В очереди', PROCESSING: 'Проверяется', SUCCEEDED: 'Проверено', FAILED: 'Ошибка', INCOMPLETE: 'Не все листы',
  correct: 'Верно', wrong: 'Неверно', manual: 'Требует проверки', unreadable: 'Не прочитано', missing: 'Нет ответа', pending: 'Требует проверки',
}
const text = (value: unknown) => typeof value === 'string' || typeof value === 'number' ? String(value) : ''
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)
export function resultTaskDetails(result?: Record<string, unknown>): ResultTaskDetail[] {
  const cells = result?.cells ?? result?.tasks
  if (!Array.isArray(cells)) return []
  return cells.filter(object).map((cell, index) => {
    return { number: text(cell.task_id) || String(index + 1), status: gradingStatusLabels[text(cell.status)] ?? 'Требует проверки',
      answer: text(cell.student_answer) || '—', expected: text(cell.expected ?? cell.expected_answer) || '—',
      message: text(cell.error_title ?? cell.feedback ?? cell.explanation), evidence: text(cell.evidence), location: text(cell.location) }
  })
}
import type { CaptureRecord } from '../scanner/core/uploadQueue'
import type { ResultErrorBox, ResultTaskDetail } from '../types/results'


/** AI locations use 0–1000 units relative to the uploaded image, independently of its displayed size. */
export function resultErrorBoxes(result: Record<string, unknown> | undefined, pageNumber: number): ResultErrorBox[] {
  if (!object(result?.boxes)) return []
  const coordinate = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1000
  return Object.entries(result.boxes).flatMap(([number, box]) => {
    if (!number || !object(box) || box.page !== pageNumber || !Number.isSafeInteger(box.page) || pageNumber < 1) return []
    const { x0, y0, x1, y1 } = box
    if (!coordinate(x0) || !coordinate(y0) || !coordinate(x1) || !coordinate(y1) || x1 <= x0 || y1 <= y0) return []
    return [{ number, page: pageNumber, left: x0 / 10, top: y0 / 10, width: (x1 - x0) / 10, height: (y1 - y0) / 10, target: text(box.target) }]
  })
}

export function taskResultPhotos(captures: CaptureRecord[], batchId: string, taskId: string, result?: Record<string, unknown>): CaptureRecord[] {
  const pages = Array.isArray(result?.pages) ? result.pages.filter(object) : undefined
  return captures.filter(capture => capture.batchId === batchId && capture.taskId === taskId
    && (!pages || pages.some(page => page.page_id === capture.pageId && page.page_number === capture.pageNumber)))
    .sort((a, b) => (a.pageNumber ?? 1) - (b.pageNumber ?? 1))
}
