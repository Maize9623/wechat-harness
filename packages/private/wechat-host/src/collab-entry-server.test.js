import assert from 'node:assert/strict'
import test from 'node:test'
import { registerDiyCollabEntryRoute } from './collab-entry-server.js'

function fakeCtx() {
  let registered
  return {
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

test('GET returns the loopback group-chat URL while the sidecar is listening', async () => {
  const ctx = fakeCtx()
  registerDiyCollabEntryRoute(ctx, () => ({
    running: true,
    url: 'http://127.0.0.1:3191/?setup=token_1',
    firstSetup: true,
  }))
  const response = await ctx.registered().fetch(new Request('http://127.0.0.1/api/diy-collab-entry'))
  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), {
    ok: true,
    running: true,
    url: 'http://127.0.0.1:3191/?setup=token_1',
    firstSetup: true,
  })
})

test('GET fails closed when the sidecar is down', async () => {
  const ctx = fakeCtx()
  registerDiyCollabEntryRoute(ctx, () => ({ running: false, url: 'http://127.0.0.1:3191/' }))
  const response = await ctx.registered().fetch(new Request('http://127.0.0.1/api/diy-collab-entry'))
  assert.equal(response.status, 503)
  const body = await response.json()
  assert.equal(body.ok, false)
  assert.equal(body.running, false)
})
