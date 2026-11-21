import test from 'node:test'
import assert from 'node:assert/strict'
import { computed, effectScope, ref, shallowRef, watch } from 'vue'
import * as studioUtils from '../app/utils/studio'
import { generateErrorMessage, handleApiError } from '../app/utils/error'

async function setupStudio(examplesReply: () => Response, otherReply?: (url: string, options: RequestInit) => Response | undefined) {
  const requests: { url: string; options: RequestInit }[] = []
  const mounted: (() => Promise<void>)[] = []
  const unmounted: (() => void)[] = []
  const originalFetch = globalThis.fetch
  Object.assign(globalThis, {
    ref, shallowRef, computed, watch, ...studioUtils, handleApiError, generateErrorMessage,
    defineNuxtPlugin: (callback: unknown) => callback,
    useRuntimeConfig: () => ({ public: { apiBase: 'https://api.example.test/gateway/', studioBase: 'https://wrong.example.test' } }),
    useRouter: () => ({ currentRoute: ref({ meta: {}, fullPath: '/works/new' }) }),
    useState: () => ref(null),
    onMounted: (callback: () => Promise<void>) => mounted.push(callback),
    onBeforeUnmount: (callback: () => void) => unmounted.push(callback),
    fetch: async (input: RequestInfo | URL, options: RequestInit) => {
      requests.push({ url: String(input), options })
      const reply = otherReply?.(String(input), options)
      if (reply) return reply
      if (String(input).endsWith('/constructor/examples')) return examplesReply()
      if (String(input).endsWith('/constructor/preview')) return Response.json({ template_id: 't', pdf_base64: 'pdf', page_count: 1, pages: [{ page_number: 1, mime: 'image/png', image_base64: 'png' }] })
      return Response.json({ ocr: { provider: 'local', ready: true, cloud: false, label: 'OCR' } })
    },
  })
  const plugin = (await import('../app/plugins/1.api.client')).default
  const { provide } = plugin()
  Object.assign(globalThis, { useNuxtApp: () => ({ $apiFetch: provide.apiFetch }) })
  const { useTestStudio } = await import('../app/composables/useTestStudio')
  const scope = effectScope()
  const studio = scope.run(() => useTestStudio())!
  return {
    studio, requests,
    mount: () => Promise.all(mounted.map(callback => callback())),
    dispose: () => { unmounted.forEach(callback => callback()); scope.stop(); globalThis.fetch = originalFetch },
  }
}

test('editor preserves /api and keeps apiBase path prefixes and session credentials', async () => {
  const spec = { ...studioUtils.newStudioExam(), tasks: [{ ...studioUtils.newStudioTask(), prompt: 'Условие' }] }
  const fixture = await setupStudio(() => Response.json([{ name: 'Пример', spec }]))
  try {
    await fixture.mount()
    assert.equal(fixture.studio.examples.value.length, 1)
    fixture.studio.selectExample(0)
    await fixture.studio.build()
    assert.deepEqual(fixture.requests.map(request => request.url), [
      'https://api.example.test/gateway/api/v1/constructor/capabilities',
      'https://api.example.test/gateway/api/v1/constructor/examples',
      'https://api.example.test/gateway/api/v1/constructor/preview',
    ])
    assert.ok(fixture.requests.every(request => request.options.credentials === 'include'))
    assert.equal(fixture.studio.preview.value?.template_id, 't')
    fixture.studio.selectExample(null)
    assert.equal(fixture.studio.exam.value.tasks[0]?.prompt, 'Условие')
  } finally { fixture.dispose() }
})

test('file import and task review use the authenticated constructor endpoints', async () => {
  const source = '1. Найдите значение 2 + 2.'
  const fixture = await setupStudio(() => Response.json([]), url => {
    if (url.endsWith('/constructor/import')) return Response.json({ text: source, page_count: 1, warnings: [], figures: [] })
    if (url.endsWith('/constructor/parse')) return Response.json({ tasks: [{ ...studioUtils.newStudioTask(), prompt: 'Найдите значение 2 + 2.' }], instructions: '', warnings: [] })
  })
  try {
    await fixture.mount()
    await fixture.studio.importSources([new File([source], 'задания.txt', { type: 'text/plain' })])
    assert.equal(fixture.studio.sourcePages.value[0]?.filename, 'задания.txt')
    assert.equal(fixture.studio.reviewOpen.value, true)
    assert.equal(fixture.studio.review.value?.tasks[0]?.prompt, 'Найдите значение 2 + 2.')
    const imported = fixture.requests.find(request => request.url.endsWith('/constructor/import'))!
    assert.equal(imported.url, 'https://api.example.test/gateway/api/v1/constructor/import')
    const payload = JSON.parse(imported.options.body as string)
    assert.equal(Buffer.from(payload.content_base64, 'base64').toString('utf8'), source)
    assert.equal(imported.options.credentials, 'include')
    assert.equal(fixture.requests.find(request => request.url.endsWith('/constructor/parse'))?.url, 'https://api.example.test/gateway/api/v1/constructor/parse')
    assert.equal(fixture.studio.error.value, undefined)
  } finally { fixture.dispose() }
})

test('partial import preserves successful tasks and reports the failed file', async () => {
  const fixture = await setupStudio(() => Response.json([]), (url, options) => {
    if (url.endsWith('/constructor/import')) {
      if (JSON.parse(options.body as string).filename === 'ошибка.txt') return Response.json({ error: { message: 'Не удалось прочитать документ' } }, { status: 422 })
      return Response.json({ text: '1. Условие', page_count: 1 })
    }
    if (url.endsWith('/constructor/parse')) return Response.json({ tasks: [{ ...studioUtils.newStudioTask(), prompt: 'Условие' }] })
  })
  try {
    await fixture.mount()
    await fixture.studio.importSources([new File(['1. Условие'], 'готово.txt'), new File(['данные'], 'ошибка.txt')])
    assert.equal(fixture.studio.sourcePages.value.length, 1)
    assert.equal(fixture.studio.review.value?.tasks.length, 1)
    assert.match(fixture.studio.error.value!, /ошибка.txt.*Не удалось прочитать документ/)
    assert.equal(fixture.studio.busy.value, '')
  } finally { fixture.dispose() }
})

test('an HTML fallback response keeps examples as an array and exposes an API error', async () => {
  const fixture = await setupStudio(() => new Response('<!doctype html><html></html>', { headers: { 'Content-Type': 'text/html' } }))
  try {
    await fixture.mount()
    assert.deepEqual(fixture.studio.examples.value, [])
    assert.match(fixture.studio.error.value!, /JSON/)
  } finally { fixture.dispose() }
})

test('incorrect JSON examples cannot reach the template or replace the current work', async () => {
  for (const body of [{ length: 2 }, [{ name: 'Пример', spec: {} }]]) {
    const fixture = await setupStudio(() => Response.json(body))
    try {
      const before = JSON.stringify(fixture.studio.exam.value)
      await fixture.mount()
      assert.deepEqual(fixture.studio.examples.value, [])
      assert.ok(fixture.studio.error.value)
      fixture.studio.selectExample(0)
      assert.equal(JSON.stringify(fixture.studio.exam.value), before)
    } finally { fixture.dispose() }
  }
})
