export function parseAuthUser(value: unknown): User {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Сервер не вернул данные аккаунта. Проверьте адрес API.')
  const user = value as Partial<User>
  if (!Number.isSafeInteger(user.id) || typeof user.email !== 'string' || !user.email.trim()) throw new Error('Сервер вернул некорректные данные аккаунта.')
  return { id: user.id!, email: user.email }
}
