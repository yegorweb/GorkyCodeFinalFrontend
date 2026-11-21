import { strFromU8, unzipSync } from 'fflate'

export const studioKinds = [
  { title: 'Выбор ответа', value: 'choice' }, { title: 'Короткий ответ', value: 'short' },
  { title: 'Решение с вычислениями', value: 'calculation' }, { title: 'Развёрнутый ответ', value: 'long' }, { title: 'Рисунок / схема', value: 'drawing' },
]
export const studioPapers = [{ title: 'Авто', value: 'auto' }, { title: 'Клетка', value: 'grid' }, { title: 'Линии', value: 'lines' }, { title: 'Без разметки', value: 'blank' }]
export function newStudioTask(): StudioTask { return { id: crypto.randomUUID(), prompt: '', kind: 'short', paper: 'auto', options: [], lines: null, solution_guide: '' } }
export function newStudioExam(): StudioExam { return { title: 'Новая работа', subject: 'Физика', grade: '', variant: '1', duration: '45', style: 'classic', density: 'compact', space_factor: 1, instructions: '', tasks: [] } }
export function printableStudioExam(exam: StudioExam): StudioExam {
  return { ...exam, tasks: exam.tasks.map(({ answer, answer_type, answer_confirmed, topic, ...task }) => task) }
}
export function normalizeStudioTask(input: Partial<StudioTask>): StudioTask {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Некорректный формат задания.')
  return { ...newStudioTask(), ...input, paper: input.paper ?? 'auto', options: input.options ?? [], lines: input.lines ?? null, solution_guide: input.solution_guide ?? '', images: input.images ?? [] }
}
export function normalizeStudioExam(input: unknown): StudioExam {
  if (!input || typeof input !== 'object' || !Array.isArray((input as StudioExam).tasks)) throw new Error('В файле нет списка заданий.')
  const value = input as StudioExam
  if (value.tasks.length > 80) throw new Error('В работе может быть не больше 80 заданий.')
  const exam = { ...newStudioExam(), ...value, tasks: value.tasks.map(normalizeStudioTask) }
  validateStudioExam(exam, true)
  return exam
}
export function normalizeStudioExamples(input: unknown): StudioExample[] {
  if (!Array.isArray(input)) throw new Error('API не вернул список примеров заданий.')
  return input.map(item => {
    if (!item || typeof item !== 'object' || typeof item.name !== 'string' || !item.name.trim()) throw new Error('API вернул некорректный пример задания.')
    return { name: item.name, spec: normalizeStudioExam(item.spec) }
  })
}
export function validateStudioExam(exam: StudioExam, allowEmpty = false) {
  if (!exam.title.trim() || exam.title.length > 180) throw new Error('Укажите тему работы длиной до 180 символов.')
  if (!['classic', 'stem', 'writing'].includes(exam.style) || !['compact', 'comfortable'].includes(exam.density)) throw new Error('Неизвестное оформление бланка.')
  if (!Number.isFinite(exam.space_factor) || exam.space_factor < 1 || exam.space_factor > 1.5) throw new Error('Запас места должен быть от 100% до 150%.')
  if (exam.tasks.length > 80 || (!allowEmpty && !exam.tasks.length)) throw new Error('Добавьте от 1 до 80 заданий.')
  for (const [index, task] of exam.tasks.entries()) {
    if (typeof task.prompt !== 'string' || !Array.isArray(task.options) || task.options.some(option => typeof option !== 'string')) throw new Error(`Неверный формат задания ${index + 1}.`)
    if (!allowEmpty && !task.prompt.trim()) throw new Error(`Заполните условие задания ${index + 1}.`)
    if (typeof task.prompt !== 'string' || !studioKinds.some(kind => kind.value === task.kind)) throw new Error(`Неверный формат задания ${index + 1}.`)
    if (task.lines !== null && (!Number.isInteger(task.lines) || task.lines < 1 || task.lines > 60)) throw new Error(`Укажите от 1 до 60 строк в задании ${index + 1}.`)
    if ((task.images?.length ?? 0) > 4) throw new Error('К заданию можно прикрепить не больше 4 рисунков.')
  }
}
export function decodeBase64(value: string): Uint8Array<ArrayBuffer> { return Uint8Array.from(atob(value), char => char.charCodeAt(0)) }
export function encodeBase64(value: ArrayBuffer): string {
  const bytes = new Uint8Array(value); const chunks: string[] = []
  for (let i = 0; i < bytes.length; i += 32768) chunks.push(String.fromCharCode(...bytes.subarray(i, i + 32768)))
  return btoa(chunks.join(''))
}
export function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob); const link = document.createElement('a')
  link.href = url; link.download = name.replace(/[<>:"/\\|?*\x00-\x1f]/g, '-'); link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
export async function readStudioPackage(blob: Blob) {
  const entries = unzipSync(new Uint8Array(await blob.arrayBuffer()))
  if (!entries['blank.pdf'] || !entries['layout.json'] || !entries['exam.json']) throw new Error('В комплекте отсутствуют PDF, задания или разметка.')
  const spec = normalizeStudioExam(JSON.parse(strFromU8(entries['exam.json'])))
  const layout = JSON.parse(strFromU8(entries['layout.json'])) as StudioLayout
  if (!layout.template_id || !Number.isSafeInteger(Number(layout.revision)) || Number(layout.revision) < 1 || !Array.isArray(layout.pages) || !layout.pages.length) throw new Error('В комплекте некорректная разметка бланка.')
  return { spec, layout, pdf: new Blob([new Uint8Array(entries['blank.pdf'])], { type: 'application/pdf' }) }
}
