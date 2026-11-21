export function useConstructor() {
  const { $apiFetchSafe } = useNuxtApp()
  const base = '/api/v1/constructor'
  const path = (part: string, id: string) => `${base}/${part}/${encodeURIComponent(id)}`
  return {
    drafts: () => $apiFetchSafe<{ items: ConstructorDraft[] }>(`${base}/drafts`),
    versions: () => $apiFetchSafe<{ items: ConstructorVersion[] }>(`${base}/versions`),
    draft: (id: string) => $apiFetchSafe<ConstructorDraft>(path('drafts', id)),
    version: (id: string) => $apiFetchSafe<ConstructorVersion>(path('versions', id)),
    save: (input: ConstructorDraftInput, id?: string) => $apiFetchSafe<ConstructorDraft>(id ? path('drafts', id) : `${base}/drafts`, { method: id ? 'PUT' : 'POST', body: input }),
    publish: (id: string, input: ConstructorPublishInput) => $apiFetchSafe<ConstructorVersion>(`${path('drafts', id)}/publish`, { method: 'POST', body: input, timeout: 300000 }),
  }
}
