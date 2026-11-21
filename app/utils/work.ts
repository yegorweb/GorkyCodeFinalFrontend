export const workStatusLabels: Record<WorkStatus, string> = {
  ready: 'Готово', draft: 'Черновик',
}

export function formatWorkDate(value: string) {
  const date = new Date(value)
  const today = new Date()
  const day = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
  const currentDay = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime()
  const difference = Math.round((currentDay - day) / 86400000)
  if (difference === 0) return 'Сегодня'
  if (difference === 1) return 'Вчера'
  if (difference === 3) return 'Три дня назад'
  return date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })
}

export function formatFileSize(size: number) {
  if (size < 1024) return `${size} Б`
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} КБ`
  return `${(size / (1024 * 1024)).toFixed(1)} МБ`
}
