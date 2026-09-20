/** Official remaining balance for the current DeepSeek API key. */

const API_PATH = '/api/diy-usage'
const KEY_REF = 'DEEPSEEK_API_KEY'
const BALANCE_URL = 'https://api.deepseek.com/user/balance'

function money(value) {
  const next = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(next) ? next : 0
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
 * Register the cookie-authenticated key-balance route on Connection's `/api` channel.
 * Electron strips Origin, so a raw webServer exact route cannot use Host/Origin trust.
 * @param ctx - Host context that already provides `connection` and `credentials`.
 */
export function registerDiyUsageRoute(ctx) {
  return ctx.connection.fetch.register({
    path: API_PATH,
    methods: ['GET'],
    requestBody: 'buffered',
    fetch: async () => {
      try {
        return Response.json({ ok: true, usage: await readDeepSeekKeyUsage(ctx) })
      } catch (cause) {
        return Response.json({
          ok: false,
          error: cause instanceof Error ? cause.message : '官方用量读取失败',
        }, { status: 502 })
      }
    },
  })
}
