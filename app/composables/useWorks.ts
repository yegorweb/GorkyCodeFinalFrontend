import { constructorTasks, draftWork, versionWork } from '../utils/constructor'

export const useWorks = () => {
  const auth = useAuth({ required: true })
  const api = useConstructor()
  const { $apiFetch } = useNuxtApp()
  const items = useState<Work[]>('works:items', () => [])
  const failure = (cause: unknown): Extract<StoreResponse<never>, { ok: false }> => handleApiError(cause)
  async function list(): Promise<StoreResponse<Work[]>> {
    try {
      const owner = auth.user.value?.id
      if (!owner) return { ok: false, status: 401 }
      const [drafts, versions] = await Promise.all([api.drafts(), api.versions()])
      if (!drafts.ok) return drafts
      if (!versions.ok) return versions
      if (auth.user.value?.id !== owner) return { ok: false, status: 401 }
      if (!Array.isArray(drafts.data.items) || !Array.isArray(versions.data.items)) throw new Error('Не удалось загрузить список работ.')
      items.value = [...drafts.data.items.map(draft => draftWork(draft, owner)), ...versions.data.items.map(version => versionWork(version, owner))].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      return { ok: true, data: items.value }
    } catch (cause) { return failure(cause) }
  }
  async function get(id: string, kind: Work['kind'] = 'version'): Promise<StoreResponse<Work>> {
    try {
      const owner = auth.user.value?.id
      if (!owner) return { ok: false, status: 401 }
      const result = kind === 'draft' ? await api.draft(id) : await api.version(id)
      if (!result.ok) return result
      if (auth.user.value?.id !== owner) return { ok: false, status: 401 }
      return { ok: true, data: kind === 'draft' ? draftWork(result.data as ConstructorDraft, owner) : versionWork(result.data as ConstructorVersion, owner) }
    } catch (cause) { return failure(cause) }
  }
  async function save(spec: StudioExam, options: { id: string; revision: number; familyId?: string; requestId: string }): Promise<StoreResponse<Work>> {
    try {
      validateStudioExam(spec)
      const owner = auth.user.value?.id
      if (!owner) return { ok: false, status: 401 }
      const result = await api.save({ id: options.id, request_id: options.requestId, expected_revision: options.revision, family_id: options.familyId ?? null,
        title: spec.title, exam: JSON.parse(JSON.stringify(spec)), tasks: constructorTasks(spec), existing_work_id: null }, options.revision ? options.id : undefined)
      if (!result.ok) return result
      if (auth.user.value?.id !== owner) return { ok: false, status: 401 }
      return { ok: true, data: draftWork(result.data, owner) }
    } catch (cause) { return failure(cause) }
  }
  async function publish(work: Work, requestId: string): Promise<StoreResponse<Work>> {
    try {
      const result = await api.publish(work.draftId, { request_id: requestId, expected_revision: work.draftRevision })
      if (!result.ok) return result
      if (auth.user.value?.id !== work.ownerId) return { ok: false, status: 401 }
      return { ok: true, data: versionWork(result.data, work.ownerId) }
    } catch (cause) { return failure(cause) }
  }
  async function pdf(work: Work): Promise<StoreResponse<Blob>> {
    try {
      if (work.kind !== 'version') return { ok: false, message: 'Бланк ещё не готов.' }
      const data = await $apiFetch<Blob, 'blob'>(`/api/v1/constructor/versions/${encodeURIComponent(work.id)}/artifacts/pdf`, { responseType: 'blob' })
      if (data.type !== 'application/pdf') throw new Error('Не удалось загрузить бланк.')
      return { ok: true, data }
    } catch (cause) { return failure(cause) }
  }
  return { items: computed(() => items.value), list, get, save, publish, pdf }
}
