import { BatchWorkflow, type WorkflowBatch } from '../scanner/core/batchWorkflow'
import { IndexedDBWorkflowStore } from '../scanner/core/captureDatabase'
import { ScanSession } from '../scanner/core/scanSession'
import type { CaptureRecord } from '../scanner/core/uploadQueue'

export function useScanSession(requestedId?: string) {
  const auth = useAuth({ required: true })
  const sessionUser = useState<User | null>('user')
  const config = useRuntimeConfig()
  const router = useRouter()
  const id = ref(requestedId || crypto.randomUUID())
  const captures = shallowRef<CaptureRecord[]>([])
  const batches = shallowRef<WorkflowBatch[]>([])
  const pending = ref(0)
  const loading = ref(true)
  const error = ref<string>()
  const store = new IndexedDBWorkflowStore()
  let alive = true
  let session: ScanSession | undefined
  let timer: ReturnType<typeof setInterval> | undefined
  const controllers = new Set<AbortController>()
  const ownerId = auth.user.value.id
  const origin = new URL(config.public.apiBase || location.origin, location.href).href.replace(/\/$/, '')
  const api = new BatchWorkflow({ store, origin,
    fetcher: async (input, options) => {
      if (!alive || sessionUser.value?.id !== ownerId) throw new Error('Войдите в аккаунт заново')
      const controller = new AbortController()
      controllers.add(controller)
      const timeout = setTimeout(() => controller.abort(), 120000)
      try {
        const response = await fetch(input, { ...options, signal: controller.signal })
        if (response.status === 401 && typeof input === 'string' && input.startsWith(`${origin}/api/`)) { sessionUser.value = null; void router.replace({ path: '/auth/login', query: { redirect: router.currentRoute.value.fullPath } }) }
        const body = response.body ? await response.arrayBuffer() : null
        if (!alive || sessionUser.value?.id !== ownerId) throw new Error('Войдите в аккаунт заново')
        return new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers })
      } finally { clearTimeout(timeout); controllers.delete(controller) }
    } })
  async function refresh() {
    if (!session || !alive) return
    const [nextCaptures, nextBatches] = await Promise.all([session.captures(), session.batches()])
    if (!alive || sessionUser.value?.id !== ownerId) return
    captures.value = nextCaptures; batches.value = nextBatches; pending.value = session.queue.count
  }
  async function init() {
    try {
      if (!alive) return
      session = new ScanSession(id.value, ownerId, store, api, () => { if (alive) { pending.value = session?.queue.count ?? 0; void refresh().catch(() => {}) } },
        message => { if (alive) error.value = message })
      await refresh()
    } catch (cause) { error.value = generateErrorMessage(handleApiError(cause)) }
    finally { loading.value = false }
  }
  const ready = init()
  async function enqueue(record: CaptureRecord) { await ready; if (!session) throw new Error('Не удалось начать сканирование'); await session.enqueue(record) }
  async function resume() { error.value = undefined; await ready; /* Historic captures are never resumed. */ }
  async function finish() { try { error.value = undefined; await ready; if (!session) return false; await session.finish(); await refresh(); return true } catch (cause) { error.value = generateErrorMessage(handleApiError(cause)); return false } }
  async function poll() { try { await ready; await session?.poll(); await refresh() } catch (cause) { error.value = generateErrorMessage(handleApiError(cause)) } }
  async function acknowledge() { try { await ready; await session?.acknowledge(); await refresh() } catch (cause) { error.value = generateErrorMessage(handleApiError(cause)) } }
  function dispose() { alive = false; if (timer) clearInterval(timer); for (const controller of controllers) controller.abort(); session?.dispose(); api.dispose(); store.close() }
  watch(() => sessionUser.value?.id, value => { if (value !== ownerId) { captures.value = []; batches.value = []; dispose() } }, { flush: 'sync' })
  onMounted(() => { timer = setInterval(() => { void poll() }, 2500) })
  onBeforeUnmount(dispose)
  return { id, captures, batches, pending, loading, error, ready, enqueue, resume, finish, poll, acknowledge }
}
