import { normalizeStudioTask } from './studio'

export function createStudioReview(result: StudioParseResponse, pages: StudioSourcePage[], separatePages: boolean): StudioReview {
  const tasks = result.tasks.map((input, index) => ({
    ...normalizeStudioTask(input),
    sourceKeys: (input.source_pages ?? [input.source_page ?? 1]).map(page => `${pages[page - 1]?.id ?? 'raw'}:${input.source_number ?? index + 1}`),
    sourceLabel: input.source_page ? `Файл ${input.source_page} · исходное задание ${input.source_number ?? index + 1}` : '',
  }))
  const figures = pages.flatMap((page, pageIndex) => page.figures.map(figure => {
    const matches = tasks.filter((task, index) =>
      (!separatePages || (task.source_pages ?? [task.source_page ?? 1]).includes(pageIndex + 1)) &&
      Number(task.source_number ?? index + 1) === Number(figure.task_number))
    return { ...figure, id: `${page.id}-${figure.id}`, sourceKey: `${page.id}:${figure.id}`, batch_page: pageIndex + 1, filename: page.filename, taskId: matches.length === 1 ? matches[0]!.id : '' }
  }))
  return {
    tasks, figures, instructions: result.instructions ?? '',
    warnings: [...new Set([...pages.flatMap(page => page.warnings), ...(result.warnings ?? []),
      'Сверьте формулы, числа и полноту условий с оригиналом: распознавание может пропустить символы.',
    ])],
    sourceBaselines: Object.fromEntries(tasks.flatMap(task => task.sourceKeys.map(key => [key, { prompt: task.prompt, sourceText: task.source_text ?? '' }]))),
  }
}

export function reviewedStudioTasks(review: StudioReview): StudioTask[] {
  return review.tasks.map(task => normalizeStudioTask({
    ...task,
    images: [...(task.images ?? []), ...review.figures.filter(figure => figure.taskId === task.id).map(figure => ({ id: figure.id, data_base64: figure.data_base64, caption: figure.caption }))],
  }))
}

export function removeStudioReviewTask(review: StudioReview, index: number) {
  const [task] = review.tasks.splice(index, 1)
  for (const figure of review.figures) if (figure.taskId === task?.id) figure.taskId = ''
}

export function mergeStudioReviewTask(review: StudioReview, index: number) {
  const previous = review.tasks[index - 1], current = review.tasks[index]
  if (!previous || !current) return
  previous.prompt = [previous.prompt, ...previous.options, current.prompt, ...current.options].join('\n')
  previous.options = []
  if (previous.kind === 'choice') previous.kind = 'short'
  if (previous.paper === 'auto') previous.paper = current.paper
  previous.images = [...(previous.images ?? []), ...(current.images ?? [])]
  previous.solution_guide = [previous.solution_guide, current.solution_guide].filter(Boolean).join('\n\n')
  previous.sourceKeys = [...new Set([...(previous.sourceKeys ?? []), ...(current.sourceKeys ?? [])])]
  previous.source_text = [...new Set([previous.source_text, current.source_text].filter(Boolean))].join('\n\n')
  previous.review_notes = [...new Set([...(previous.review_notes ?? []), ...(current.review_notes ?? [])])]
  for (const figure of review.figures) if (figure.taskId === current.id) figure.taskId = previous.id
  review.tasks.splice(index, 1)
}

// New source files must not undo corrections, splits or instruction moves already reviewed.
export function mergeAppendedStudioReview(previous: StudioReview, incoming: StudioReview) {
  const baseline = previous.sourceBaselines
  const known = new Set(Object.keys(baseline))
  const retained: StudioTask[] = JSON.parse(JSON.stringify(previous.tasks))
  const assigned = new Map<string, string>()
  const identities = new Set(retained.map(task => task.id))
  let instructions = previous.instructions
  for (const task of incoming.tasks) {
    const keys = task.sourceKeys ?? []
    const oldKeys = keys.filter(key => known.has(key))
    const matches = retained.filter(old => old.sourceKeys?.some(key => oldKeys.includes(key)))
    if (oldKeys.length) {
      const target = matches.at(-1)
      if (target) assigned.set(task.id, target.id)
      if (keys.some(key => !known.has(key))) {
        const original = baseline[oldKeys[0]!]!
        const continuation = task.prompt.startsWith(original.prompt) ? task.prompt.slice(original.prompt.length).trim()
          : task.source_text?.startsWith(original.sourceText) ? task.source_text.slice(original.sourceText.length).trim() : task.prompt
        if (target) {
          if (continuation) target.prompt += `\n${continuation}`
          target.sourceKeys = [...new Set([...(target.sourceKeys ?? []), ...keys])]
          target.source_text = [...new Set([target.source_text, task.source_text].filter(Boolean))].join('\n\n')
          target.review_notes = [...(target.review_notes ?? []), 'Добавлено продолжение с нового файла. Проверьте стык с исправленным условием.']
        } else if (continuation) instructions = [instructions, continuation].filter(Boolean).join('\n')
      }
      continue
    }
    const originalId = task.id
    if (identities.has(task.id)) task.id = crypto.randomUUID()
    identities.add(task.id)
    assigned.set(originalId, task.id)
    retained.push(task)
  }
  const figures = new Map(previous.figures.map(figure => [figure.sourceKey, figure]))
  for (const figure of incoming.figures) {
    const original = figures.get(figure.sourceKey)
    if (original) { figure.taskId = original.taskId; figure.caption = original.caption }
    else figure.taskId = assigned.get(figure.taskId) ?? ''
  }
  incoming.tasks = retained
  incoming.instructions = instructions
  incoming.sourceBaselines = { ...baseline, ...incoming.sourceBaselines }
}
