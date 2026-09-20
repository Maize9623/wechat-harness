import assert from 'node:assert/strict'
import test from 'node:test'
import { registerDiyModelAccessRoute } from './model-access-server.js'

function fakeCtx(credentials) {
  let registered
  return {
    credentials,
    connection: {
      fetch: {
        register(route) {
          registered = route
          return () => {}
        },
      },
    },
    registered: () => registered,
  }
}

test('GET reports whether the DeepSeek key is configured without echoing it', async () => {
  const ctx = fakeCtx({
    describe: async () => ({ configured: true, writable: true }),
  })
  registerDiyModelAccessRoute(ctx)
  const response = await ctx.registered().fetch(new Request('http://127.0.0.1/api/diy-model-access'))
  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), {
    ok: true,
    access: {
      configured: true,
      writable: true,
      canConfigure: true,
      providerLabel: 'DeepSeek API',
    },
  })
})

test('POST rejects an empty key and stores a trimmed key', async () => {
  const stored = []
  const ctx = fakeCtx({
    describe: async () => ({ configured: stored.length > 0, writable: true }),
    set: async (_ref, value) => { stored.push(value) },
  })
  registerDiyModelAccessRoute(ctx)
  const empty = await ctx.registered().fetch(new Request('http://127.0.0.1/api/diy-model-access', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ apiKey: '   ' }),
  }))
  assert.equal(empty.status, 400)
  const saved = await ctx.registered().fetch(new Request('http://127.0.0.1/api/diy-model-access', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ apiKey: '  sk-live  ' }),
  }))
  assert.equal(saved.status, 200)
  assert.deepEqual(stored, ['sk-live'])
})
