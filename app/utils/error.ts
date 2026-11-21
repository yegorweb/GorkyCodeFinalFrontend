import { FetchError } from 'ofetch'

export const generateErrorMessage = (error: Extract<StoreResponse<unknown>, { ok: false }>) => {
  if (error.message) return error.message
  if (!error.status) return 'Не удалось связаться с сервером. Проверьте подключение и повторите запрос.'
  return ({ 401: 'Войдите в аккаунт.', 403: 'Нет доступа.', 404: 'Данные не найдены.', 409: 'Данные изменились. Обновите страницу.', 413: 'Файл слишком большой.' } as Record<number, string>)[error.status] ?? `Ошибка сервера (${error.status}).`
}

export const handleApiError = (cause: unknown): Extract<StoreResponse<never>, { ok: false }> => {
  if (!(cause instanceof FetchError)) return { ok: false, message: cause instanceof Error ? cause.message : undefined }
  const body = cause.data
  const message = body?.error?.message ?? body?.detail ?? body?.message
  return { ok: false, status: cause.status, message: typeof message === 'string' ? message : undefined }
}
