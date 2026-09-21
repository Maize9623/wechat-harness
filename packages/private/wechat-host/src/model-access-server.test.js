import assert from 'node:assert/strict'
import test from 'node:test'
import { registerDiyModelAccessRoute } from './model-access-server.js'

function fakeCtx(extras = {}) {
  let registered
  return {
    credentials: extras.credentials ?? {
      describe: async () => ({ configured: true, writable: true }),
    },
    get: (name) => extras.services?.[name],
    plugin: extras.plugin,
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

test('GET reports DeepSeek and Codex channels without echoing secrets', async () => {
  const ctx = fakeCtx({
    credentials: {
      describe: async () => ({ configured: true, writable: true }),
      describeRecord: async () => ({ configured: false, writable: true }),
    },
  })
  registerDiyModelAccessRoute(ctx)
  const response = await ctx.registered().fetch(new Request('http://127.0.0.1/api/diy-model-access'))
  assert.equal(response.status, 200)
  const body = await response.json()
  assert.equal(body.ok, true)
  assert.equal(body.access.configured, true)
  assert.equal(body.access.canConfigure, true)
  assert.deepEqual(body.access.channels.map(channel => [channel.id, channel.configured]), [
    ['deepseek', true],
    ['codex', false],
  ])
})

test('POST rejects an empty key and stores a trimmed key', async () => {
  const stored = []
  const ctx = fakeCtx({
    credentials: {
      describe: async () => ({ configured: stored.length > 0, writable: true }),
      set: async (_ref, value) => { stored.push(value) },
    },
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

test('POST codex-login starts ChatGPT OAuth and enables the route after authorize', async () => {
  const mutations = []
  let began
  let finish
  let inFlight = false
  const ctx = fakeCtx({
    credentials: {
      describe: async () => ({ configured: true, writable: true }),
      describeRecord: async () => ({ configured: false, writable: true }),
    },
    services: {
      authorization: {
        describe: () => ({ inFlight }),
        begin: async (request) => {
          began = request
          inFlight = true
          request.interaction.notify({
            message: 'Enter this code on the verification page to finish signing in.',
            url: 'https://chatgpt.com/device',
            code: 'WXYZ-1234',
          })
          await new Promise((resolve) => { finish = resolve })
          inFlight = false
          return { status: 'authorized' }
        },
      },
      settings: {
        mutate: async (ns, ops) => { mutations.push([ns, ops]) },
      },
    },
  })
  registerDiyModelAccessRoute(ctx)
  const response = await ctx.registered().fetch(new Request('http://127.0.0.1/api/diy-model-access', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action: 'codex-login' }),
  }))
  assert.equal(response.status, 200)
  const body = await response.json()
  assert.equal(began.method, 'oauth')
  assert.equal(began.key, 'llm-pi-ai/openai-codex')
  assert.equal(mutations.length, 0)
  const codex = body.access.channels.find(channel => channel.id === 'codex')
  assert.equal(codex.inFlight, true)
  assert.equal(codex.notice.code, 'WXYZ-1234')
  finish()
  for (let i = 0; i < 10 && mutations.length === 0; i += 1) await Promise.resolve()
  assert.equal(mutations[0][0], 'llm-pi-ai')
  assert.equal(mutations[0][1][0].op, 'set')
  assert.equal(mutations[0][1][0].path[1], 'openai-codex')
})

test('Codex login auto-answers the official method picker with device_code', async () => {
  let answered
  let finish
  let inFlight = false
  const ctx = fakeCtx({
    credentials: {
      describe: async () => ({ configured: true, writable: true }),
      describeRecord: async () => ({ configured: false, writable: true }),
    },
    services: {
      authorization: {
        describe: () => ({ inFlight }),
        begin: async (request) => {
          inFlight = true
          answered = await request.interaction.prompt({
            kind: 'select',
            message: 'Select OpenAI Codex login method:',
            options: [
              { id: 'browser', label: 'Browser login (default)' },
              { id: 'device_code', label: 'Device code login (headless)' },
            ],
          })
          request.interaction.notify({
            message: 'Enter this code on the verification page to finish signing in.',
            url: 'https://auth.openai.com/codex/device',
            code: 'WXYZ-1234',
          })
          await new Promise((resolve) => { finish = resolve })
          inFlight = false
          return { status: 'cancelled' }
        },
      },
    },
  })
  registerDiyModelAccessRoute(ctx)
  await ctx.registered().fetch(new Request('http://127.0.0.1/api/diy-model-access', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action: 'codex-login' }),
  }))
  for (let i = 0; i < 10 && answered === undefined; i += 1) await Promise.resolve()
  assert.equal(answered, 'device_code')
  const response = await ctx.registered().fetch(new Request('http://127.0.0.1/api/diy-model-access'))
  const body = await response.json()
  const codex = body.access.channels.find(channel => channel.id === 'codex')
  assert.equal(codex.notice.code, 'WXYZ-1234')
  assert.equal(codex.prompt, undefined)
  finish()
})

test('POST codex-cancel withdraws the in-flight ChatGPT login', async () => {
  let cancelled
  let release
  const ctx = fakeCtx({
    credentials: {
      describe: async () => ({ configured: true, writable: true }),
      describeRecord: async () => ({ configured: false, writable: true }),
    },
    services: {
      authorization: {
        describe: () => ({ inFlight: cancelled === undefined }),
        begin: async (request) => {
          request.interaction.notify({ message: 'waiting', url: 'https://chatgpt.com/device', code: 'ABCD-0000' })
          await new Promise((resolve) => { release = resolve })
          return { status: 'cancelled' }
        },
        cancel: (key) => {
          cancelled = key
          release?.()
        },
      },
    },
  })
  registerDiyModelAccessRoute(ctx)
  await ctx.registered().fetch(new Request('http://127.0.0.1/api/diy-model-access', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action: 'codex-login' }),
  }))
  const response = await ctx.registered().fetch(new Request('http://127.0.0.1/api/diy-model-access', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action: 'codex-cancel' }),
  }))
  assert.equal(response.status, 200)
  const body = await response.json()
  assert.equal(cancelled, 'llm-pi-ai/openai-codex')
  assert.equal(body.access.channels.find(channel => channel.id === 'codex').notice.message, '已取消 ChatGPT 登录。')
})

test('POST codex-logout deletes the ChatGPT record and drops the route', async () => {
  const deleted = []
  const mutations = []
  const ctx = fakeCtx({
    credentials: {
      describe: async () => ({ configured: true, writable: true }),
      describeRecord: async () => ({ configured: true, writable: true }),
      deleteRecord: async (key) => { deleted.push(key) },
    },
    services: {
      settings: {
        mutate: async (ns, ops) => { mutations.push([ns, ops]) },
      },
    },
  })
  registerDiyModelAccessRoute(ctx)
  const response = await ctx.registered().fetch(new Request('http://127.0.0.1/api/diy-model-access', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action: 'codex-logout' }),
  }))
  assert.equal(response.status, 200)
  assert.deepEqual(deleted, ['llm-pi-ai/openai-codex'])
  assert.equal(mutations[0][1][0].op, 'unset')
  assert.equal(mutations[0][1][0].path[1], 'openai-codex')
})
