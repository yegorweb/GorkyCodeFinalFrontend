import test from 'node:test'
import assert from 'node:assert/strict'
import { safeLocalRedirect } from '../app/utils/route'
test('login redirects keep entity query parameters and reject external targets', () => {
  const path = '/works/results?id=work&batchId=batch'
  assert.equal(safeLocalRedirect(path), path)
  assert.equal(safeLocalRedirect(encodeURIComponent(path)), path)
  for (const value of ['https://example.com', '//example.com', '/\\example.com', '%', '/works\r\n']) assert.equal(safeLocalRedirect(value), '/works')
})
