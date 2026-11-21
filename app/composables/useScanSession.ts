import { BatchWorkflow, type WorkflowBatch } from '../scanner/core/batchWorkflow'
import { IndexedDBWorkflowStore } from '../scanner/core/captureDatabase'
import { ScanSession } from '../scanner/core/scanSession'
import type { CaptureRecord } from '../scanner/core/uploadQueue'
import { versionWork } from '../utils/constructor'

export function useScanSession(requestedId?: string) {
  const auth = useAuth({ required: true })
  const sessionUser = useState<User | null>('user')
  const config = useRuntimeConfig()
  const router = useRouter()
  const constructor = useConstructor()
  const id = ref(requestedId || crypto.randomUUID())
  const captures = shallowRef<CaptureRecord[]>([])
  const batches = shallowRef<WorkflowBatch[]>([])
  const pending = ref(0)
  const loading = ref(true)
  const error = ref<string>()
  const store = new IndexedDBWorkflowStore()
  let alive = true
  let session: ScanSession | undefined
  let library: { expires: number; value: Work[] } | undefined
  let libraryRequest: Promise<Work[]> | undefined
  const ownerId = auth.user.value.id
  const origin = new URL(config.public.apiBase || location.origin, location.href).href.replace(/\/$/, '')
  const api = new BatchWorkflow({ store, origin,
    preparationEndpoint: new URL(`${config.public.preparationBase.replace(/\/$/, '')}/v1/process`, location.href).href,
    fetcher: async (input, options) => {
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 120000)
      try {
        const response = await fetch(input, { ...options, signal: controller.signal })
        if (response.status === 401 && typeof input === 'string' && input.startsWith(`${origin}/api/`)) { sessionUser.value = null; void router.replace({ path: '/auth/login', query: { redirect: router.currentRoute.value.fullPath } }) }
        return response
      } finally { clearTimeout(timeout) }
    } })
  async function works() {
    if (library && library.expires > Date.now()) return library.value
    return libraryRequest ??= (async () => {
      const response = await constructor.versions()
      if (!response.ok) throw new Error(generateErrorMessage(response))
      if (!alive || auth.user.value?.id !== ownerId) throw new Error('Войдите в аккаунт заново')
      const value = response.data.items.map(version => versionWork(version, ownerId))
      library = { expires: Date.now() + 5000, value }
      return value
    })().finally(() => { libraryRequest = undefined })
  }
  async function refresh() {
    if (!session || !alive) return
    const [nextCaptures, nextBatches] = await Promise.all([session.captures(), session.batches()])
    if (!alive) return
    captures.value = nextCaptures; batches.value = nextBatches; pending.value = session.queue.count
  }
  async function init() {
    try {
      if (!requestedId) {
        const saved = (await store.listCaptures()).filter(record => record.metadata.ownerId === ownerId && record.metadata.scanSessionId && !record.metadata.scanFinished)
          .sort((a, b) => b.metadata.capturedAt.localeCompare(a.metadata.capturedAt))[0]
        if (saved?.metadata.scanSessionId) id.value = saved.metadata.scanSessionId
      }
      if (!alive) return
      session = new ScanSession(id.value, ownerId, store, api, works, () => { if (alive) { pending.value = session?.queue.count ?? 0; void refresh().catch(() => {}) } }, message => { if (alive) error.value = message })
      await refresh()
    } catch (cause) { error.value = generateErrorMessage(handleApiError(cause)) }
    finally { loading.value = false }
  }
  const ready = init()
  async function enqueue(record: CaptureRecord) { await ready; if (!session) throw new Error('Не удалось начать сканирование'); await session.enqueue(record) }
  async function resume() { await ready; await session?.resume() }
  async function finish() { try { error.value = undefined; await ready; if (!session) return false; await session.finish(); await refresh(); return true } catch (cause) { error.value = generateErrorMessage(handleApiError(cause)); return false } }
  async function poll() { try { await ready; await session?.poll(); await refresh() } catch (cause) { error.value = generateErrorMessage(handleApiError(cause)) } }
  async function acknowledge() { try { await ready; await session?.acknowledge(); await refresh() } catch (cause) { error.value = generateErrorMessage(handleApiError(cause)) } }
  onBeforeUnmount(() => { alive = false; session?.dispose(); api.dispose(); store.close() })
  return { id, captures, batches, pending, loading, error, ready, enqueue, resume, finish, poll, acknowledge }
}
