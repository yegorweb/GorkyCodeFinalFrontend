import { createStudioReview, mergeAppendedStudioReview, reviewedStudioTasks } from '../utils/studio-review'
import { printableStudioExam } from '../utils/studio'
export function useTestStudio(options: { loadExamples?: boolean; estimate?: boolean } = {}) {
  const { $apiFetch } = useNuxtApp()
  const exam = ref<StudioExam>(newStudioExam())
  const preview = shallowRef<StudioPreview>()
  const compiled = ref<StudioExam>()
  const busy = ref('')
  const error = ref<string>()
  const sourceText = ref('')
  const sourcePages = ref<StudioSourcePage[]>([])
  const review = ref<StudioReview>()
  const reviewOpen = ref(false)
  const capability = ref<StudioCapability>()
  const estimates = ref<StudioEstimate[]>([])
  const jobs = ref<StudioMathJob[]>([])
  const examples = ref<StudioExample[]>([])
  const progress = ref('')
  const dirty = computed(() => !compiled.value || JSON.stringify(compiled.value) !== JSON.stringify(printableStudioExam(exam.value)))
  let disposed = false
  let sourceGeneration = 0
  let estimateTimer: ReturnType<typeof setTimeout> | undefined
  let estimateGeneration = 0
  const controllers = new Set<AbortController>()
  const jobTimers = new Map<string, ReturnType<typeof setTimeout>>()

  async function request<T>(path: string, body?: unknown, responseType: 'json' | 'blob' = 'json'): Promise<T> {
    const controller = new AbortController()
    controllers.add(controller)
    try {
      const response = await $apiFetch.raw<T, 'json' | 'blob'>(`/api/v1/constructor${path}`, { method: body === undefined ? 'GET' : 'POST', body: body as Record<string, unknown>, responseType, retry: 0, timeout: 300000, signal: controller.signal })
      if (responseType === 'json' && !/\bapplication\/(?:json|[^;]+\+json)\b/i.test(response.headers.get('content-type') ?? '')) throw new Error('API вернул некорректный формат ответа. Ожидался JSON. Проверьте адрес API и маршрут запроса.')
      return response._data as T
    } finally { controllers.delete(controller) }
  }
  async function action<T>(name: string, callback: () => Promise<T>): Promise<T | undefined> {
    if (busy.value) return
    busy.value = name
    error.value = undefined
    try { return await callback() }
    catch (cause) { if (!disposed) error.value = generateErrorMessage(handleApiError(cause)) }
    finally { busy.value = '' }
  }
  function addTask() { if (exam.value.tasks.length < 80) exam.value.tasks.push(newStudioTask()) }
  function removeTask(index: number) { exam.value.tasks.splice(index, 1) }
  function moveTask(index: number, direction: number) {
    const target = index + direction
    if (target < 0 || target >= exam.value.tasks.length) return
    const [task] = exam.value.tasks.splice(index, 1)
    if (task) exam.value.tasks.splice(target, 0, task)
  }
  function selectExample(index: number | null | undefined) {
    if (typeof index !== 'number') return
    const example = examples.value[index]
    if (!example) return
    try { exam.value = normalizeStudioExam(JSON.parse(JSON.stringify(example.spec))) }
    catch (cause) { error.value = generateErrorMessage(handleApiError(cause)) }
  }
  async function build() {
    return action('build', async () => {
      while (!disposed) {
        validateStudioExam(exam.value)
        if (jobs.value.some(job => ['queued', 'running'].includes(job.status))) throw new Error('Дождитесь распознавания формул или остановите его перед сборкой.')
        const snapshot: StudioExam = JSON.parse(JSON.stringify(printableStudioExam(exam.value)))
        const result = await request<StudioPreview>('/preview', snapshot)
        if (JSON.stringify(snapshot) !== JSON.stringify(printableStudioExam(exam.value))) continue
        if (!result.pdf_base64 || !Array.isArray(result.pages) || !result.pages.length || !result.pages.every(page => page.mime === 'image/png' && page.image_base64)) throw new Error('Сервис не вернул страницы PDF.')
        preview.value = result
        compiled.value = snapshot
        return result
      }
    })
  }
  async function packageWork() {
    return action('package', async () => {
      if (dirty.value || !compiled.value) throw new Error('Сначала соберите бланк с последними изменениями.')
      const snapshot = JSON.stringify(compiled.value)
      const blob = await request<Blob>('/package', compiled.value, 'blob')
      if (snapshot !== JSON.stringify(printableStudioExam(exam.value))) throw new Error('Работа изменилась. Соберите бланк заново.')
      const bundle = await readStudioPackage(blob)
      if (bundle.layout.template_id !== preview.value?.template_id) throw new Error('Версия бланка изменилась. Соберите предпросмотр заново.')
      return { blob, ...bundle }
    })
  }
  function downloadPdf() {
    if (preview.value && !dirty.value) downloadBlob(new Blob([decodeBase64(preview.value.pdf_base64)], { type: 'application/pdf' }), `${exam.value.title}.pdf`)
  }
  async function downloadPackage() { const bundle = await packageWork(); if (bundle) downloadBlob(bundle.blob, `${exam.value.title}.zip`) }
  function exportExam() { downloadBlob(new Blob([JSON.stringify(exam.value, null, 2)], { type: 'application/json' }), `${exam.value.title}.json`) }
  async function importExam(file: File) {
    await action('open', async () => {
      if (file.size > 16 * 1024 * 1024) throw new Error('Файл заданий должен быть не больше 16 МБ.')
      exam.value = normalizeStudioExam(JSON.parse(await file.text()))
      preview.value = undefined
      compiled.value = undefined
    })
  }
  function sourceSnapshot() { return JSON.stringify({ text: sourceText.value, pages: sourcePages.value }) }
  function currentReview() {
    return review.value?.sourceSnapshot === sourceSnapshot() && review.value?.examSnapshot === JSON.stringify(exam.value) ? review.value : undefined
  }
  function retainEditedSource() {
    if (!sourcePages.value.length || sourceText.value === sourcePages.value.map(page => page.text).join('\n\n')) return false
    sourcePages.value = [{ id: crypto.randomUUID(), filename: 'Текст после ручной правки', text: sourceText.value,
      figures: sourcePages.value.flatMap(page => page.figures.map(figure => ({ ...figure, id: `${page.id}-${figure.id}` }))), page_count: sourcePages.value.reduce((sum, page) => sum + page.page_count, 0),
      warnings: [...sourcePages.value.flatMap(page => page.warnings), 'Ручные правки сохранены единым блоком. Проверьте нумерацию и привязку рисунков.'] }]
    review.value = undefined
    progress.value = 'Ручные правки сохранены единым блоком. Проверьте его перед изменением порядка.'
    return true
  }
  function moveSourcePage(index: number, direction: number) {
    if (busy.value || retainEditedSource()) return
    const target = index + direction
    if (target < 0 || target >= sourcePages.value.length) return
    const [page] = sourcePages.value.splice(index, 1)
    if (page) sourcePages.value.splice(target, 0, page)
    syncSourceText()
  }
  function removeSourcePage(index: number) {
    if (busy.value || retainEditedSource()) return
    sourcePages.value.splice(index, 1)
    syncSourceText()
  }
  function syncSourceText() {
    sourceText.value = sourcePages.value.map(page => page.text).join('\n\n')
    sourceGeneration++
    review.value = undefined
    progress.value = 'Список файлов изменён. Нажмите «Разобрать и проверить».'
  }
  async function parseSource(previous?: StudioReview) {
    await action('parse', async () => {
      if (!sourceText.value.trim()) throw new Error('Вставьте текст заданий или загрузите документ.')
      const source = sourceText.value
      const generation = sourceGeneration
      const snapshot = sourceSnapshot(), examSnapshot = JSON.stringify(exam.value)
      const separatePages = sourcePages.value.length > 1 && source === sourcePages.value.map(page => page.text).join('\n\n')
      const result = await request<StudioParseResponse>('/parse', { text: source, subject: exam.value.subject, source_import: true,
        ...(separatePages ? { pages: sourcePages.value.map(page => ({ text: page.text })) } : {}) })
      if (generation !== sourceGeneration || snapshot !== sourceSnapshot() || examSnapshot !== JSON.stringify(exam.value)) throw new Error('Текст или задания изменились. Повторите разбор.')
      if (!Array.isArray(result.tasks)) throw new Error('Сервис не вернул задания.')
      const next = createStudioReview(result, sourcePages.value, separatePages)
      if (previous) mergeAppendedStudioReview(previous, next)
      next.sourceSnapshot = snapshot
      next.examSnapshot = examSnapshot
      review.value = next
      reviewOpen.value = true
    })
  }
  function applyReview() {
    if (!review.value) return
    try {
      if (!currentReview()) throw new Error('Текст или задания изменились. Повторите разбор перед применением.')
      const next = { ...exam.value, tasks: reviewedStudioTasks(review.value), instructions: review.value.instructions }
      validateStudioExam(next)
      exam.value = next
      reviewOpen.value = false
      review.value = undefined
    } catch (cause) { error.value = cause instanceof Error ? cause.message : 'Проверьте задания.' }
  }
  async function importSources(files: File[]) {
    if (busy.value || !files.length) return
    let previous = currentReview()
    if (retainEditedSource()) previous = undefined
    const generation = ++sourceGeneration
    const result = await action('import', async () => {
      if (files.length + sourcePages.value.length > 12) throw new Error('Выберите не больше 12 файлов одной работы.')
      const failures: string[] = []
      for (const [index, file] of files.entries()) {
        if (disposed || generation !== sourceGeneration) return
        progress.value = `Распознаём «${file.name}» · ${index + 1} из ${files.length}`
        try {
          if (!file.size || file.size > 20 * 1024 * 1024 || !/\.(pdf|png|jpe?g|hei[cf]|webp|tiff?|txt|docx)$/i.test(file.name)) throw new Error('Выберите фото, PDF, TXT или DOCX до 20 МБ.')
          const content = encodeBase64(await file.arrayBuffer())
          const imported = await request<StudioImport>('/import', { filename: file.name, content_base64: content, subject: exam.value.subject, async_math: true })
          if (disposed || generation !== sourceGeneration) return
          if (!imported.text?.trim()) throw new Error('Не удалось распознать текст.')
          const count = imported.page_count ?? 1
          if (sourcePages.value.reduce((sum, page) => sum + page.page_count, 0) + count > 12) throw new Error('В работе может быть не больше 12 страниц.')
          sourcePages.value.push({ id: crypto.randomUUID(), filename: file.name, text: imported.text, warnings: imported.warnings ?? [], figures: imported.figures ?? [], page_count: count,
            preview: /\.(png|jpe?g)$/i.test(file.name) ? `data:${file.type};base64,${content}` : undefined })
          sourceText.value = sourcePages.value.map(page => page.text).join('\n\n')
          if (imported.math_job) startMathJob(imported)
        } catch (cause) { failures.push(`${file.name}: ${generateErrorMessage(handleApiError(cause))}`) }
      }
      progress.value = failures.length ? failures.join('\n') : 'Текст распознан. Проверьте задания перед применением.'
      if (failures.length) error.value = failures.join('\n')
      return !!sourcePages.value.length
    })
    const importError = error.value
    if (result) await parseSource(previous)
    if (importError && !error.value) error.value = importError
  }
  function patchText(token: string, latex: string) {
    const validReview = currentReview()
    const replacement = `\\(${latex}\\)`
    sourceText.value = sourceText.value.replaceAll(token, replacement)
    for (const page of sourcePages.value) page.text = page.text.replaceAll(token, replacement)
    for (const document of [exam.value, review.value]) {
      if (!document) continue
      document.instructions = document.instructions.replaceAll(token, replacement)
      for (const task of document.tasks) {
        task.prompt = task.prompt.replaceAll(token, replacement)
        task.options = task.options.map(option => option.replaceAll(token, replacement))
        if (task.source_text) task.source_text = task.source_text.replaceAll(token, replacement)
      }
    }
    if (review.value && validReview) {
      for (const baseline of Object.values(review.value.sourceBaselines)) {
        baseline.prompt = baseline.prompt.replaceAll(token, replacement)
        baseline.sourceText = baseline.sourceText.replaceAll(token, replacement)
      }
      review.value.sourceSnapshot = sourceSnapshot()
      review.value.examSnapshot = JSON.stringify(exam.value)
    }
  }
  function startMathJob(imported: StudioImport) {
    const job: StudioMathJob = { id: imported.math_job!.id, status: 'queued', total: imported.math_job!.total ?? imported.math_pending?.length ?? 0, completed: 0, tokens: imported.math_pending?.map(patch => patch.token) ?? [], applied: [] }
    jobs.value.push(job)
    void pollMath(job)
  }
  async function pollMath(job: StudioMathJob) {
    if (disposed || !['queued', 'running'].includes(job.status)) return
    try {
      const result = await request<{ status: string; completed: number; patches?: { token: string; status: string; latex?: string; warning?: string }[]; error?: string }>(`/import-jobs/${encodeURIComponent(job.id)}`)
      if (disposed || job.status === 'cancelled') return
      job.status = result.status
      job.completed = result.completed
      job.error = result.error
      for (const patch of result.patches ?? []) {
        if (job.tokens.includes(patch.token) && !job.applied.includes(patch.token) && patch.status === 'done' && patch.latex && !/[$⟦⟧]/.test(patch.latex)) { patchText(patch.token, patch.latex); job.applied.push(patch.token) }
      }
    } catch (cause) { job.status = 'error'; job.error = generateErrorMessage(handleApiError(cause)) }
    if (!disposed && ['queued', 'running'].includes(job.status)) jobTimers.set(job.id, setTimeout(() => { void pollMath(job) }, 1000))
  }
  async function cancelMath() {
    await action('cancel-math', async () => {
      const failures: string[] = []
      await Promise.all(jobs.value.filter(job => ['queued', 'running'].includes(job.status)).map(async job => {
        job.status = 'cancelled'
        clearTimeout(jobTimers.get(job.id))
        try { await request(`/import-jobs/${encodeURIComponent(job.id)}/cancel`, {}) }
        catch (cause) { job.error = generateErrorMessage(handleApiError(cause)); failures.push(job.error) }
      }))
      if (failures.length) throw new Error(failures.join('\n'))
    })
  }
  watch(exam, () => {
    if (options.estimate === false) return
    clearTimeout(estimateTimer)
    const generation = ++estimateGeneration
    const tasks = exam.value.tasks.filter(task => task.prompt.trim())
    if (!tasks.length) { estimates.value = []; return }
    estimateTimer = setTimeout(async () => {
      try {
        const result = await request<{ estimates: StudioEstimate[] }>('/estimate', { ...exam.value, tasks: tasks.map(task => ({ ...task, images: undefined })) })
        if (!disposed && generation === estimateGeneration) estimates.value = result.estimates
      } catch { if (generation === estimateGeneration) estimates.value = [] }
    }, 300)
  }, { deep: true })
  onMounted(async () => {
    if (options.loadExamples === false) return
    const results = await Promise.allSettled([request<{ ocr: StudioCapability }>('/capabilities'), request<unknown>('/examples').then(normalizeStudioExamples)])
    if (disposed) return
    if (results[0].status === 'fulfilled') capability.value = results[0].value.ocr
    else if ((handleApiError(results[0].reason)).status === 404) error.value = 'На этом сервере не подключён API конструктора работ. Проверьте версию backend.'
    if (results[1].status === 'fulfilled') examples.value = results[1].value
    else error.value ??= generateErrorMessage(handleApiError(results[1].reason))
  })
  onBeforeUnmount(() => {
    disposed = true
    sourceGeneration++
    clearTimeout(estimateTimer)
    for (const timer of jobTimers.values()) clearTimeout(timer)
    for (const controller of controllers) controller.abort()
    for (const job of jobs.value.filter(job => ['queued', 'running'].includes(job.status))) void $apiFetch(`/api/v1/constructor/import-jobs/${encodeURIComponent(job.id)}/cancel`, { method: 'POST', body: {}, retry: 0 }).catch(() => {})
  })
  return { exam, preview, compiled, dirty, busy, error, sourceText, sourcePages, review, reviewOpen, capability, examples, estimates, jobs, progress,
    addTask, removeTask, moveTask, selectExample, moveSourcePage, removeSourcePage, build, packageWork, downloadPdf, downloadPackage, exportExam, importExam, importSources, parseSource, applyReview, cancelMath }
}
