import type { WorkflowBatch, WorkflowStore, BatchWorkflow } from '../scanner/core/batchWorkflow'
import type { CaptureRecord } from '../scanner/core/uploadQueue'

export function selectGradingResults(savedBatches: WorkflowBatch[], savedCaptures: CaptureRecord[], ownerId: number, scanId?: string) {
  const batches = savedBatches.filter(batch => batch.ownerId === ownerId && (!scanId || batch.scanSessionId === scanId || batch.batchId === scanId))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  const batchIds = new Set(batches.map(batch => batch.batchId))
  const sessionIds = new Set(batches.map(batch => batch.scanSessionId).filter((id): id is string => !!id))
  if (scanId) sessionIds.add(scanId)
  const captures = savedCaptures.filter(record => {
    if (record.metadata.ownerId !== ownerId) return false
    const batchId = record.batchId ?? record.metadata.batchId
    if (batchId) return batchIds.has(batchId)
    const sessionId = record.metadata.scanSessionId
    return !!sessionId && (!scanId || sessionIds.has(sessionId))
  }).sort((a, b) => a.metadata.capturedAt.localeCompare(b.metadata.capturedAt))
  return { batches, captures }
}

export function needsGradingResultsPolling(batch: WorkflowBatch) {
  if (batch.serverCleanupAcknowledged || ['OPEN', 'COMPLETED', 'CLEANING', 'CLEANED'].includes(batch.status)) return false
  const tasks = Object.values(batch.tasks)
  return !!batch.hasMore || tasks.length < (batch.closeExpectedTaskCount ?? batch.expectedStudentCount)
    || tasks.some(task => !['SUCCEEDED', 'FAILED', 'INCOMPLETE'].includes(task.status))
}

type ReaderOptions = {
  store: Pick<WorkflowStore, 'listBatches' | 'listCaptures' | 'getBatch'>
  workflow: Pick<BatchWorkflow, 'pollResults' | 'acknowledgePersistedResults'>
  ownerId: number
  scanId?: string
  isCurrent: () => boolean
  onResults: (value: { batches: WorkflowBatch[]; captures: CaptureRecord[] }) => void
  onPolling?: (value: boolean) => void
}

/** One traversal at a time, including manual ACK; page persistence belongs to BatchWorkflow. */
export function createGradingResultsReader(options: ReaderOptions) {
  let active: Promise<void> | undefined

  async function load() {
    if (!options.isCurrent()) return
    const [batches, captures] = await Promise.all([options.store.listBatches(), options.store.listCaptures()])
    if (!options.isCurrent()) return
    const value = selectGradingResults(batches, captures, options.ownerId, options.scanId)
    options.onResults(value)
    return value
  }

  function run(operation: () => Promise<void>) {
    if (active) return active
    active = Promise.resolve().then(async () => { if (options.isCurrent()) await operation() }).finally(() => { active = undefined })
    return active
  }

  function refresh() { return run(async () => { await load() }) }

  function poll(force = false) {
    return run(async () => {
      const saved = await load()
      if (!saved) return
      let failure: unknown
      let startedPolling = false
      try {
        for (const selected of saved.batches) {
          if (!options.isCurrent()) return
          const batch = await options.store.getBatch(selected.batchId)
          if (!options.isCurrent()) return
          if (!batch || batch.ownerId !== options.ownerId || batch.status === 'OPEN' || batch.serverCleanupAcknowledged || (!force && !needsGradingResultsPolling(batch))) continue
          if (!startedPolling) { startedPolling = true; options.onPolling?.(true) }
          try {
            for (let page = 0; page < 20 && options.isCurrent(); page++) {
              const result = await options.workflow.pollResults(batch.batchId)
              if (!result.has_more) break
            }
          } catch (cause) { failure ??= cause }
        }
      } finally { if (startedPolling) options.onPolling?.(false) }
      await load()
      if (failure) throw failure
    })
  }

  async function acknowledge() {
    // A manual action must run after an active poll, rather than being coalesced with it.
    while (active) await active.catch(() => {})
    return run(async () => {
      const saved = await load()
      if (!saved) return
      try {
        for (const selected of saved.batches) {
          if (!options.isCurrent()) return
          const batch = await options.store.getBatch(selected.batchId)
          if (!options.isCurrent()) return
          if (!batch || batch.ownerId !== options.ownerId || batch.status === 'OPEN' || batch.serverCleanupAcknowledged) continue
          await options.workflow.acknowledgePersistedResults(batch.batchId, false)
        }
      } finally { await load() }
    })
  }

  return { refresh, poll, acknowledge }
}
