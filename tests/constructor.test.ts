import test from 'node:test'
import assert from 'node:assert/strict'
import { catalogueWorks, constructorTasks, draftWork, versionWork } from '../app/utils/constructor'
import { newStudioExam, newStudioTask, printableStudioExam } from '../app/utils/studio'
import { useConstructor } from '../app/composables/useConstructor'

const spec = () => ({ ...newStudioExam(), tasks: [{ ...newStudioTask(), id: 'source-task/A-123', prompt: '2 + 2 = ?', answer: '4', answer_type: 'number' as const, answer_confirmed: true, topic: 'Сложение' }] })

test('key mapping preserves complete task IDs, print order and explicit teacher answers', () => {
  const exam = spec()
  exam.tasks.push({ ...exam.tasks[0]!, id: 'another:id', prompt: 'Инструкция', answer: '', answer_confirmed: false, topic: '' })
  assert.deepEqual(constructorTasks(exam), [
    { layout_task_id: 'source-task/A-123', errorlab_task_id: '1', display_number: 1, topic: 'Сложение', answer: '4', answer_type: 'number', confirmed: true },
    { layout_task_id: 'another:id', errorlab_task_id: '2', display_number: 2, topic: null, answer: '', answer_type: 'number', confirmed: false },
  ])
  const before = JSON.stringify(printableStudioExam(exam))
  exam.tasks[0]!.answer = '5'
  exam.tasks[0]!.answer_confirmed = false
  assert.equal(JSON.stringify(printableStudioExam(exam)), before)
})

test('server draft restores key mapping without guessing a topic or confirmation', () => {
  const exam = spec()
  const draft = { id: 'draft', family_id: 'family', title: exam.title, exam, tasks: [{ ...constructorTasks(exam)[0]!, confirmed: false, topic: null }], revision: 3, created_at: '2026-11-21T00:00:00Z', updated_at: '2026-11-21T01:00:00Z' }
  const work = draftWork(draft, 7)
  assert.equal(work.draftRevision, 3)
  assert.equal(work.spec.tasks[0]?.answer, '4')
  assert.equal(work.spec.tasks[0]?.topic, '')
  assert.equal(work.spec.tasks[0]?.answer_confirmed, false)
  assert.equal(work.kind, 'draft')
})

test('printed versions without a ready key do not become checkable works', () => {
  const exam = spec()
  const version = { id: 'version', draft_id: 'draft', draft_revision: 3, family_id: 'family', title: exam.title, variant: '1', version_number: 2,
    work_id: null, key_ready: false, template_id: 'printed', revision: 18, scanner_template_id: 'reference', scanner_template_version: 1, page_count: 1,
    exam, tasks: constructorTasks(exam), layout: { template_id: 'printed', revision: 18, pages: [{}] }, artifacts: { pdf: '', zip: '', layout: '', exam: '' }, created_at: '2026-11-21T00:00:00Z' }
  const work = versionWork(version, 7)
  assert.equal(work.kind, 'version')
  assert.equal(work.keyReady, false)
  assert.equal(work.workId, undefined)
  assert.equal(work.assignmentId, 'gb-version')
  assert.equal(work.layout?.revision, 18)
})

test('constructor persistence sends revisions and stable request IDs to the real API paths', async () => {
  const requests: { path: string; options: { method?: string; body?: unknown } }[] = []
  Object.assign(globalThis, { useNuxtApp: () => ({ $apiFetchSafe: async (path: string, options = {}) => { requests.push({ path, options }); return { ok: true, data: {} } } }) })
  const api = useConstructor()
  const exam = spec()
  const input = { id: 'draft', request_id: 'request', expected_revision: 0, title: exam.title, exam, tasks: constructorTasks(exam) }
  await api.save(input)
  await api.save({ ...input, request_id: 'update', expected_revision: 1 }, 'draft')
  await api.publish('draft', { request_id: 'publication', expected_revision: 2 })
  await api.publish('draft', { request_id: 'publication', expected_revision: 2 })
  assert.deepEqual(requests.map(request => [request.path, request.options.method]), [
    ['/api/v1/constructor/drafts', 'POST'], ['/api/v1/constructor/drafts/draft', 'PUT'],
    ['/api/v1/constructor/drafts/draft/publish', 'POST'], ['/api/v1/constructor/drafts/draft/publish', 'POST'],
  ])
  assert.equal((requests[1]?.options.body as ConstructorDraftInput).expected_revision, 1)
  assert.deepEqual(requests[2]?.options.body, requests[3]?.options.body)
})

test('a published key has one ready row and an unchanged server draft is not shown as a duplicate', () => {
  const exam = spec()
  const draft = { id: 'draft', family_id: 'family', title: exam.title, exam, tasks: constructorTasks(exam), revision: 3, created_at: '2026-11-21T00:00:00Z', updated_at: '2026-11-21T01:00:00Z' }
  const version = { id: 'version', draft_id: 'draft', draft_revision: 3, family_id: 'family', title: exam.title, variant: '1', version_number: 2, work_id: 42, key_ready: true,
    template_id: 'printed', revision: 18, scanner_template_id: 'reference', scanner_template_version: 1, page_count: 1, exam, tasks: constructorTasks(exam),
    layout: { template_id: 'printed', revision: 18, pages: [{}] }, artifacts: { pdf: '', zip: '', layout: '', exam: '' }, created_at: '2026-11-21T01:00:00Z' }
  const rows = catalogueWorks([draft], [{ ...version, id: 'old', created_at: '2026-11-21T00:00:00Z' }, version], 7)
  assert.deepEqual(rows.map(work => [work.id, work.status]), [['version', 'ready']])
  assert.deepEqual(new Set(catalogueWorks([{ ...draft, revision: 4 }], [version], 7).map(work => work.status)), new Set(['ready', 'draft']))
})
