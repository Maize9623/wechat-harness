import assert from 'node:assert/strict'
import test from 'node:test'
import { parseCodexUsage, readCodexUsage, windowLabel } from './codex-usage.js'

test('windowLabel follows the duration the backend reported', () => {
  assert.equal(windowLabel(18_000, 'primary'), '5 小时额度')
  assert.equal(windowLabel(604_800, 'secondary'), '周额度')
  assert.equal(windowLabel(undefined, 'weekly'), '周额度')
})

test('parseCodexUsage turns used_percent into remaining percent and reset time', () => {
  const usage = parseCodexUsage({
    plan_type: 'pro',
    rate_limit: {
      allowed: true,
      limit_reached: false,
      primary_window: {
        used_percent: 23,
        limit_window_seconds: 18_000,
        reset_at: 1_778_670_307,
        resets_remaining: 1,
      },
      secondary_window: {
        used_percent: 23,
        limit_window_seconds: 604_800,
        reset_at: 1_779_511_740,
        available_resets: 0,
      },
    },
  })
  assert.equal(usage.configured, true)
  assert.equal(usage.plan, 'Pro')
  assert.equal(usage.exhausted, false)
  assert.deepEqual(usage.windows.map(window => [window.label, window.remainingPercent, window.resets]), [
    ['5 小时额度', 77, 1],
    ['周额度', 77, 0],
  ])
  assert.equal(usage.windows[1].resetAt, 1_779_511_740_000)
})

test('parseCodexUsage accepts five_hour / weekly remaining_percent', () => {
  const usage = parseCodexUsage({
    plan: 'plus',
    five_hour: { remaining_percent: 40, reset_time_ms: 1_700_000_000_000 },
    weekly: { percent_left: 88, reset_at: 1_700_000_100_000 },
  })
  assert.equal(usage.plan, 'Plus')
  assert.deepEqual(usage.windows.map(window => window.remainingPercent), [40, 88])
  assert.equal(usage.windows[0].resetAt, 1_700_000_000_000)
})

test('readCodexUsage calls ChatGPT usage with the stored grant and never echoes it', async () => {
  const headers = []
  const ctx = {
    credentials: {
      readRecord: async () => ({
        kind: 'grant',
        payload: { type: 'oauth', access: 'secret-token', accountId: 'acc-1' },
      }),
    },
  }
  const usage = await readCodexUsage(ctx, async (_url, init) => {
    headers.push(init.headers)
    return {
      ok: true,
      status: 200,
      async json() {
        return {
          plan_type: 'pro',
          rate_limit: {
            allowed: true,
            primary_window: { used_percent: 10, limit_window_seconds: 18_000, reset_at: 1_778_670_307 },
          },
        }
      },
    }
  })
  assert.equal(usage.plan, 'Pro')
  assert.equal(usage.windows[0].remainingPercent, 90)
  assert.equal(headers[0].authorization, 'Bearer secret-token')
  assert.equal(headers[0]['chatgpt-account-id'], 'acc-1')
  assert.equal(JSON.stringify(usage).includes('secret-token'), false)
})

test('readCodexUsage reports an expired login instead of throwing', async () => {
  const usage = await readCodexUsage({
    credentials: {
      readRecord: async () => ({ kind: 'grant', payload: { access: 'expired', refresh: 'rt' } }),
    },
  }, async () => ({
    ok: false,
    status: 401,
    async json() { return {} },
  }))
  assert.equal(usage.configured, true)
  assert.match(usage.error, /过期/)
})
