import test from 'node:test'
import assert from 'node:assert/strict'
import { ref } from 'vue'
import { createFetch } from 'ofetch'
import { handleApiError } from '../app/utils/error'
import { parseAuthUser } from '../app/utils/auth'

test('static-host HTML and malformed successful responses cannot become an authenticated user', () => {
  for (const value of ['<!doctype html><html></html>', null, [], {}, { id: '7', email: 'teacher@example.test' }, { id: 7, email: '' }]) assert.throws(() => parseAuthUser(value))
  assert.deepEqual(parseAuthUser({ id: 7, email: 'teacher@example.test' }), { id: 7, email: 'teacher@example.test' })
})

test('cookie session restores, signs in and signs out using the OpenAPI routes', async () => {
  const states = new Map<string, ReturnType<typeof ref>>()
  const requests: { url: string; options: RequestInit }[] = []
  const redirects: string[] = []
  Object.assign(globalThis, {
    defineNuxtPlugin: (callback: unknown) => callback,
    useRuntimeConfig: () => ({ public: { apiBase: 'https://api.example.test' } }),
    useState: (key: string, initial: () => unknown) => { if (!states.has(key)) states.set(key, ref(initial?.())); return states.get(key) },
    handleApiError,
    clearNuxtState: () => {},
    navigateTo: async (path: string) => { redirects.push(path) },
    $fetch: createFetch({ fetch: async (url, options) => {
      requests.push({ url: String(url), options: options! })
      return String(url).endsWith('/logout') ? new Response(null, { status: 204 }) : Response.json({ id: 7, email: 'teacher@example.test' })
    } }),
  })
  const plugin = (await import('../app/plugins/0.session.client')).default
  const { provide } = await plugin()
  assert.equal(states.get('user')!.value.id, 7)
  await provide.auth.login({ email: 'teacher@example.test', password: 'test-password' })
  await Promise.all([provide.auth.refresh(), provide.auth.refresh()])
  await provide.auth.logout()
  assert.deepEqual(requests.map(request => request.url), ['https://api.example.test/api/v1/auth/me', 'https://api.example.test/api/v1/auth/login', 'https://api.example.test/api/v1/auth/me', 'https://api.example.test/api/v1/auth/logout'])
  for (const request of requests) { assert.equal(request.options.credentials, 'include'); assert.equal(new Headers(request.options.headers).has('Authorization'), false) }
  assert.equal(JSON.parse(requests[1].options.body as string).email, 'teacher@example.test')
  assert.equal(states.get('user')!.value, null); assert.deepEqual(redirects, ['/'])
})
