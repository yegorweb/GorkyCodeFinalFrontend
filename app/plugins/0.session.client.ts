import { FetchError } from 'ofetch'
import { parseAuthUser } from '../utils/auth'

export default defineNuxtPlugin(async () => {
  const config = useRuntimeConfig()
  const user = useState<User | null>('user', () => null)
  const checked = useState('auth:checked', () => false)
  let refreshTask: Promise<StoreResponse<User>> | undefined

  const request = $fetch.create({ baseURL: config.public.apiBase, credentials: 'include', retry: 0, timeout: 15000 })

  function refresh(): Promise<StoreResponse<User>> {
    if (refreshTask) return refreshTask
    refreshTask = (async () => {
      try {
        const data = parseAuthUser(await request<unknown>('/api/v1/auth/me'))
        user.value = data
        return { ok: true, data } as const
      } catch (cause) {
        if (cause instanceof FetchError && cause.status === 401) user.value = null
        return handleApiError(cause)
      } finally {
        checked.value = true
        refreshTask = undefined
      }
    })()
    return refreshTask
  }

  async function login(input: LoginRequest): Promise<StoreResponse<User>> {
    try {
      const data = parseAuthUser(await request<unknown>('/api/v1/auth/login', { method: 'POST', body: input }))
      user.value = data
      checked.value = true
      return { ok: true, data }
    } catch (cause) { return handleApiError(cause) }
  }

  async function logout(): Promise<StoreResponse<null>> {
    try {
      await request('/api/v1/auth/logout', { method: 'POST' })
      user.value = null
      checked.value = true
      clearNuxtState(key => key.startsWith('works:') || key.startsWith('batch:'))
      await navigateTo('/')
      return { ok: true, data: null }
    } catch (cause) { return handleApiError(cause) }
  }

  await refresh()
  return { provide: { auth: { refresh, login, logout } } }
})
