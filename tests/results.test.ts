import assert from 'node:assert/strict'
import { test } from 'node:test'
import { resultErrorBoxes, resultTaskDetails, taskResultPhotos } from '../app/utils/results.ts'
import type { CaptureRecord } from '../app/scanner/core/uploadQueue.ts'

test('error coordinates scale with the photo and remain on their numbered page', () => {
  const result = { boxes: {
    '1': { page: 1, x0: 100, y0: 200, x1: 300, y1: 400, target: '5' },
    '2': { page: 2, x0: 0, y0: 0, x1: 1000, y1: 1000 },
  } }
  assert.deepEqual(resultErrorBoxes(result, 1), [
    { number: '1', page: 1, left: 10, top: 20, width: 20, height: 20, target: '5' },
  ])
  assert.equal(resultErrorBoxes(result, 2)[0].width, 100)
})

test('missing or malformed error locations never invent a photo highlight', () => {
  assert.deepEqual(resultErrorBoxes(undefined, 1), [])
  assert.deepEqual(resultErrorBoxes({ boxes: [] }, 1), [])
  const malformed = { boxes: {
    outside: { page: 1, x0: -1, y0: 0, x1: 200, y1: 200 },
    reversed: { page: 1, x0: 300, y0: 0, x1: 100, y1: 200 },
    oversized: { page: 1, x0: 0, y0: 0, x1: 1001, y1: 200 },
    nan: { page: 1, x0: Number.NaN, y0: 0, x1: 200, y1: 200 },
    text: { page: 1, x0: '100', y0: 0, x1: 200, y1: 200 },
    zero: { page: 1, x0: 100, y0: 0, x1: 100, y1: 200 },
    missingPage: { x0: 0, y0: 0, x1: 200, y1: 200 },
  } }
  assert.deepEqual(resultErrorBoxes(malformed, 1), [])
})

test('manual AI proposals show diagnosis evidence without claiming teacher approval', () => {
  const [detail] = resultTaskDetails({ cells: [{ task_id: '3', status: 'manual', student_answer: 0,
    expected: 5, error_title: 'Ошибка в вычислении', evidence: 'Предварительный результат: wrong.', location: 'Последняя строка' }] })
  assert.equal(detail.status, 'Требует проверки')
  assert.equal(detail.answer, '0')
  assert.equal(detail.expected, '5')
  assert.equal(detail.message, 'Ошибка в вычислении')
  assert.equal(detail.evidence, 'Предварительный результат: wrong.')
  assert.equal(detail.location, 'Последняя строка')
})

function capture(overrides: Partial<CaptureRecord>): CaptureRecord {
  return { metadata: { captureId: 'capture', cycleId: 'cycle', templateId: 'template', templateVersion: 1,
    capturedAt: '2026-11-21T09:00:00Z', quality: {}, qr: { raw: 'B1:template:1:1', payload: null } },
    blob: new Blob(['photo']), status: 'succeeded', attempts: 1,
    batchId: 'batch', taskId: 'task', pageId: 'page-1', pageNumber: 1, ...overrides }
}

test('photo selection uses exact batch, task and backend page IDs in page order', () => {
  const first = capture({})
  const second = capture({ pageId: 'page-2', pageNumber: 2 })
  const otherTask = capture({ taskId: 'someone-else' })
  const otherBatch = capture({ batchId: 'other-batch' })
  const stalePage = capture({ pageId: 'old-page', pageNumber: 1 })
  const result = { pages: [{ page_id: 'page-1', page_number: 1 }, { page_id: 'page-2', page_number: 2 }] }
  assert.deepEqual(taskResultPhotos([second, otherTask, stalePage, first, otherBatch], 'batch', 'task', result), [first, second])
})

test('legacy results can show their local task photos without backend page metadata', () => {
  const photo = capture({})
  assert.deepEqual(taskResultPhotos([photo], 'batch', 'task'), [photo])
  assert.deepEqual(taskResultPhotos([photo], 'batch', 'task', { pages: [] }), [])
})
