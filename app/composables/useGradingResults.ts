import { onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import { BatchWorkflow, type WorkflowBatch } from '../scanner/core/batchWorkflow'
import { IndexedDBWorkflowStore } from '../scanner/core/captureDatabase'
import type { CaptureRecord } from '../scanner/core/uploadQueue'
import { createGradingResultsReader } from '../utils/grading-results'

export function useGradingResults(scanId?: string) {
  const auth = useAuth({ required: true })
  const sessionUser = useState<User | null>('user')
  const config = useRuntimeConfig()
  const router = useRouter()
  const ownerId = auth.user.value.id
  const batches = shallowRef<WorkflowBatch[]>([])
  const captures = shallowRef<CaptureRecord[]>([])
  const loading = ref(true)
  const polling = ref(false)
  const error = ref<string>()
  const store = new IndexedDBWorkflowStore()
  const controllers = new Set<AbortController>()
  const base = globalThis.location?.href ?? 'http://localhost/'
  const origin = new URL(config.public.apiBase || globalThis.location?.origin || 'http://localhost', base).href.replace(/\/$/, '')
  let alive = true
  let timer: ReturnType<typeof setInterval> | undefined
  const isCurrent = () => alive && sessionUser.value?.id === ownerId

  const workflow = new BatchWorkflow({ store, origin, fetcher: async (input, options) => {
    if (!isCurrent()) throw new Error('Войдите в аккаунт заново')
    const controller = new AbortController()
    controllers.add(controller)
    const timeout = setTimeout(() => controller.abort(), 30_000)
    try {
      const response = await fetch(input, { ...options, signal: controller.signal })
      if (response.status === 401 && isCurrent()) {
        sessionUser.value = null
        void router.replace({ path: '/auth/login', query: { redirect: router.currentRoute.value.fullPath } })
      }
      // Read the body inside the timeout and owner guard, before BatchWorkflow persists it.
      const body = response.body ? await response.arrayBuffer() : null
      if (!isCurrent()) throw new Error('Войдите в аккаунт заново')
      return new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers })
    } finally {
      clearTimeout(timeout)
      controllers.delete(controller)
    }
  } })

  const reader = createGradingResultsReader({ store, workflow, ownerId, scanId, isCurrent,
    onResults: value => { batches.value = value.batches; captures.value = value.captures },
    onPolling: value => { if (isCurrent()) polling.value = value },
  })

  async function perform(operation: () => Promise<void>) {
    if (!isCurrent()) return
    error.value = undefined
    try { await operation() }
    catch (cause) { if (isCurrent()) error.value = generateErrorMessage(handleApiError(cause)) }
  }

  const ready = (import.meta.client ? perform(reader.refresh) : Promise.resolve()).finally(() => { loading.value = false })
  async function refresh() { await ready; await perform(reader.refresh) }
  async function poll() { await ready; await perform(() => reader.poll(true)) }
  async function tick() { await ready; await perform(() => reader.poll()) }
  async function acknowledge() { await ready; await perform(reader.acknowledge) }

  function dispose() {
    alive = false
    if (timer) clearInterval(timer)
    for (const controller of controllers) controller.abort()
    workflow.dispose()
    store.close()
    polling.value = false
  }

  watch(() => sessionUser.value?.id, id => {
    if (id === ownerId) return
    batches.value = []
    captures.value = []
    error.value = undefined
    dispose()
  }, { flush: 'sync' })

  onMounted(() => {
    if (!isCurrent()) return
    void poll()
    // Keep discovering other-tab sessions even after the current batches have finished.
    timer = setInterval(() => { void tick() }, 2500)
  })
  onBeforeUnmount(dispose)

  return { batches, captures, loading, polling, error, ready, refresh, poll, acknowledge }
}
