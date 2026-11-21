export const gradingStatusLabels: Record<string, string> = {
  RECEIVING: 'Листы принимаются', QUEUED: 'В очереди', PROCESSING: 'Проверяется', SUCCEEDED: 'Проверено', FAILED: 'Ошибка', INCOMPLETE: 'Не все листы',
  correct: 'Верно', wrong: 'Неверно', manual: 'Требует проверки', unreadable: 'Не прочитано', missing: 'Нет ответа', pending: 'Требует проверки',
}
const text = (value: unknown) => typeof value === 'string' || typeof value === 'number' ? String(value) : ''
export function resultTaskDetails(result?: Record<string, unknown>): ResultTaskDetail[] {
  const cells = result?.cells ?? result?.tasks
  if (!Array.isArray(cells)) return []
  return cells.filter(value => value && typeof value === 'object').map((value, index) => {
    const cell = value as Record<string, unknown>
    return { number: text(cell.task_id) || String(index + 1), status: gradingStatusLabels[text(cell.status)] ?? 'Требует проверки',
      answer: text(cell.student_answer) || '—', expected: text(cell.expected ?? cell.expected_answer) || '—', message: text(cell.error_title ?? cell.feedback ?? cell.explanation) }
  })
}
