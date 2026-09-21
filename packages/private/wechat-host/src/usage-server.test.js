import assert from 'node:assert/strict'
import test from 'node:test'
import { registerDiyUsageRoute } from './usage-server.js'

test('GET reports DeepSeek and Codex usage without failing the other channel', async () => {
  let registered
  const ctx = {
    credentials: {
      resolve: async () => ({ value: '' }),
      readRecord: async () => undefined,
    },
    connection: {
      fetch: {
        register(route) {
          registered = route
          return () => {}
        },
      },
    },
  }
  registerDiyUsageRoute(ctx)
  const response = await registered.fetch(new Request('http://127.0.0.1/api/diy-usage'))
  assert.equal(response.status, 200)
  const body = await response.json()
  assert.equal(body.ok, true)
  assert.equal(body.deepseek.configured, false)
  assert.equal(body.codex.configured, false)
})
