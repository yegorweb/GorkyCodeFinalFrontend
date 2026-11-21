import test from 'node:test'
import assert from 'node:assert/strict'
import { createStudioReview, mergeAppendedStudioReview, mergeStudioReviewTask, removeStudioReviewTask, reviewedStudioTasks } from '../app/utils/studio-review'
import { newStudioTask } from '../app/utils/studio'

const task = (id: string, page: number, number: number, prompt = id): StudioTask => ({ ...newStudioTask(), id, prompt, source_page: page, source_number: number })
const page = (id: string, number = 1): StudioSourcePage => ({ id, filename: `${id}.pdf`, text: id, page_count: 1, warnings: [], figures: [{ id: 'fig1', data_base64: 'png', caption: '', task_number: number }] })

test('figures with repeated task numbers attach to their own source files', () => {
  const review = createStudioReview({ tasks: [task('q1', 1, 1), task('q2', 2, 1)] }, [page('a'), page('b')], true)
  assert.deepEqual(review.figures.map(figure => figure.taskId), ['q1', 'q2'])
  assert.equal(new Set(review.figures.map(figure => figure.id)).size, 2)
  assert.deepEqual(reviewedStudioTasks(review).map(task => task.images?.length), [1, 1])
})

test('figure matching uses original task numbers and all continuation pages', () => {
  const continued = { ...task('q1', 1, 7), source_pages: [1, 2] }
  const review = createStudioReview({ tasks: [continued] }, [page('a', 7), page('b', 7)], true)
  assert.deepEqual(review.figures.map(figure => figure.taskId), ['q1', 'q1'])
  assert.deepEqual(review.tasks[0]?.sourceKeys, ['a:7', 'b:7'])
})

test('ambiguous or unmatched imported figures stay excluded until assigned manually', () => {
  const review = createStudioReview({ tasks: [task('q1', 1, 1), task('q2', 1, 1)] }, [page('a'), page('b', 9)], false)
  assert.deepEqual(review.figures.map(figure => figure.taskId), ['', ''])
  review.figures[0]!.taskId = 'q2'
  assert.deepEqual(reviewedStudioTasks(review).map(task => task.images?.length), [0, 1])
})

test('figure assignment follows stable task IDs through reordering, merging and removal', () => {
  const review = createStudioReview({ tasks: [task('q1', 1, 1), task('q2', 2, 1)] }, [page('a'), page('b')], true)
  review.tasks.reverse()
  assert.deepEqual(reviewedStudioTasks(review).map(task => task.images?.[0]?.id), ['b-fig1', 'a-fig1'])
  mergeStudioReviewTask(review, 1)
  assert.deepEqual(review.figures.map(figure => figure.taskId), ['q2', 'q2'])
  assert.equal(reviewedStudioTasks(review)[0]?.images?.length, 2)
  removeStudioReviewTask(review, 0)
  assert.deepEqual(review.figures.map(figure => figure.taskId), ['', ''])
})

test('appending files retains reviewed corrections and figure exclusions, with unique task IDs', () => {
  const previous = createStudioReview({ tasks: [task('q1', 1, 1)] }, [page('a')], true)
  previous.tasks[0]!.prompt = 'Исправленное условие'
  previous.figures[0]!.taskId = ''
  const incoming = createStudioReview({ tasks: [task('new1', 1, 1), task('q1', 2, 1)] }, [page('a'), page('b')], true)
  mergeAppendedStudioReview(previous, incoming)
  assert.equal(incoming.tasks[0]?.prompt, 'Исправленное условие')
  assert.equal(incoming.tasks.length, 2)
  assert.equal(new Set(incoming.tasks.map(task => task.id)).size, 2)
  assert.equal(incoming.figures[0]?.taskId, '')
  assert.equal(incoming.figures[1]?.taskId, incoming.tasks[1]?.id)
})

test('appending a continuation preserves a reviewed split and extends the final part', () => {
  const previous = createStudioReview({ tasks: [task('q1', 1, 1, 'Исходное условие')] }, [page('a')], true)
  previous.tasks[0]!.prompt = 'Первая часть'
  previous.tasks.push({ ...previous.tasks[0]!, id: 'split', prompt: 'Вторая часть' })
  const continued = { ...task('new1', 1, 1, 'Исходное условие\nПродолжение'), source_pages: [1, 2] }
  const incoming = createStudioReview({ tasks: [continued] }, [page('a'), page('b')], true)
  mergeAppendedStudioReview(previous, incoming)
  assert.deepEqual(incoming.tasks.map(task => task.prompt), ['Первая часть', 'Вторая часть\nПродолжение'])
  assert.equal(incoming.figures[1]?.taskId, 'split')
})

test('tasks moved into instructions do not reappear when new files are imported', () => {
  const previous = createStudioReview({ tasks: [task('q1', 1, 1, 'Инструкция')] }, [page('a')], true)
  previous.instructions = 'Инструкция'
  removeStudioReviewTask(previous, 0)
  const incoming = createStudioReview({ tasks: [task('q1', 1, 1, 'Инструкция'), task('q2', 2, 1)] }, [page('a'), page('b')], true)
  mergeAppendedStudioReview(previous, incoming)
  assert.equal(incoming.instructions, 'Инструкция')
  assert.equal(incoming.tasks.length, 1)
  assert.equal(incoming.tasks[0]?.id, 'q2')
})
