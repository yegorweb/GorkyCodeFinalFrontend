import { normalizeStudioExam } from './studio'

export function constructorTasks(spec: StudioExam): ConstructorTask[] {
  return spec.tasks.map((task, index) => ({ layout_task_id: task.id, errorlab_task_id: String(index + 1), display_number: index + 1,
    topic: task.topic?.trim() || null, answer: task.answer?.trim() ?? '', answer_type: task.answer_type ?? 'text', confirmed: task.answer_confirmed ?? false }))
}

function constructorExam(value: unknown, mapping: ConstructorTask[]): StudioExam {
  const exam = normalizeStudioExam(value)
  exam.tasks = exam.tasks.map(task => {
    const key = mapping.find(row => row.layout_task_id === task.id)
    return { ...task, answer: key?.answer ?? '', answer_type: key?.answer_type ?? 'text', answer_confirmed: key?.confirmed ?? false, topic: key?.topic ?? '' }
  })
  return exam
}

export function draftWork(draft: ConstructorDraft, ownerId: number): Work {
  return { id: draft.id, ownerId, title: draft.title, kind: 'draft', status: 'draft', draftId: draft.id, draftRevision: draft.revision,
    familyId: draft.family_id, keyReady: false, createdAt: draft.created_at, updatedAt: draft.updated_at, spec: constructorExam(draft.exam, draft.tasks) }
}

export function versionWork(version: ConstructorVersion, ownerId: number): Work {
  const layout = version.layout as unknown as StudioLayout
  if (!layout || !Array.isArray(layout.pages) || !layout.template_id || !version.id) throw new Error('API вернул некорректную версию бланка.')
  const spec = constructorExam(version.exam, version.tasks)
  return { id: version.id, ownerId, title: version.title ?? spec.title, kind: 'version', status: version.key_ready ? 'ready' : 'draft', draftId: version.draft_id,
    draftRevision: version.draft_revision, familyId: version.family_id, keyReady: version.key_ready, workId: version.work_id ?? undefined,
    assignmentId: `gb-${version.id}`, versionNumber: version.version_number, createdAt: version.created_at, updatedAt: version.created_at,
    spec, layout }
}
