export function queryString(value: unknown): string {
  return typeof value === 'string' ? value : Array.isArray(value) && typeof value[0] === 'string' ? value[0] : ''
}

export function safeLocalRedirect(value: unknown): string {
  let path = queryString(value)
  try { path = decodeURIComponent(path) } catch { return '/works' }
  return path.startsWith('/') && !path.startsWith('//') && !/[\\\r\n]/.test(path) ? path : '/works'
}
