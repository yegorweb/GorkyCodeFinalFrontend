import { ofetch, type FetchOptions } from 'ofetch'

export default defineNuxtPlugin(() => {
  const config = useRuntimeConfig()
  const router = useRouter()
  const user = useState<User | null>('user', () => null)
  const apiFetch = ofetch.create({
    baseURL: config.public.apiBase,
    credentials: 'include',
    retry: 0,
    onResponseError({ response }) {
      if (response.status !== 401) return
      user.value = null
      if (router.currentRoute.value.meta.auth) {
        void router.replace({ path: '/auth/login', query: { redirect: router.currentRoute.value.fullPath } })
      }
    },
  })

  async function apiFetchSafe<T>(url: string, options?: FetchOptions<'json'>): Promise<StoreResponse<T>> {
    try { return { ok: true, data: await apiFetch<T>(url, options) as T } }
    catch (cause) { return handleApiError(cause) }
  }

  async function fetchSafe<T>(url: string, options?: FetchOptions<'json'>): Promise<StoreResponse<T>> {
    try { return { ok: true, data: await ofetch<T>(url, options) as T } }
    catch (cause) { return handleApiError(cause) }
  }

  return { provide: { apiFetch, apiFetchSafe, fetchSafe } }
})
