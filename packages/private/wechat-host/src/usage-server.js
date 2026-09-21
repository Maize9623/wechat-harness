/** DeepSeek key balance and ChatGPT Codex subscription windows. */

import { readCodexUsage } from './codex-usage.js'

const API_PATH = '/api/diy-usage'
const KEY_REF = 'DEEPSEEK_API_KEY'
const BALANCE_URL = 'https://api.deepseek.com/user/balance'

function money(value) {
  const next = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(next) ? next : 0
}

async function settled(load) {
  try {
    return await load()
  } catch (cause) {
    return { configured: false, error: cause instanceof Error ? cause.message : '官方用量读取失败' }
  }
}

/**
 * Read the current DeepSeek API key and the official remaining balance for that key.
 * @param ctx - Host context that already provides `credentials`.
 */
export async function readDeepSeekKeyUsage(ctx) {
  const hit = await ctx.credentials.resolve(KEY_REF)
  const apiKey = typeof hit?.value === 'string' ? hit.value.trim() : ''
  if (apiKey === '') return { configured: false, keyRef: KEY_REF }
  const response = await fetch(BALANCE_URL, {
    headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' },
  })
  let body = {}
  try { body = await response.json() } catch (parseError) { void parseError }
  if (!response.ok) {
    const message = typeof body?.error?.message === 'string'
      ? body.error.message
      : `官方余额接口返回 ${response.status}`
    throw new Error(message)
  }
  const infos = Array.isArray(body.balance_infos) ? body.balance_infos : []
  const cny = infos.find(info => info?.currency === 'CNY') ?? infos[0] ?? {}
  return {
    configured: true,
    keyRef: KEY_REF,
    available: body.is_available === true,
    currency: typeof cny.currency === 'string' ? cny.currency : 'CNY',
    totalBalance: money(cny.total_balance),
    grantedBalance: money(cny.granted_balance),
    toppedUpBalance: money(cny.topped_up_balance),
    fetchedAt: Date.now(),
  }
}

/**
 * Register the cookie-authenticated DeepSeek balance and Codex quota route.
 * @param ctx - Host context that already provides `connection` and `credentials`.
 */
export function registerDiyUsageRoute(ctx) {
  return ctx.connection.fetch.register({
    path: API_PATH,
    methods: ['GET'],
    requestBody: 'buffered',
    fetch: async () => {
      const [deepseek, codex] = await Promise.all([
        settled(() => readDeepSeekKeyUsage(ctx)),
        settled(() => readCodexUsage(ctx)),
      ])
      return Response.json({ ok: true, deepseek, codex })
    },
  })
}
