/** DeepSeek API key status for the conversation model popover. */

const API_PATH = '/api/diy-model-access'
const KEY_REF = 'DEEPSEEK_API_KEY'

function accessView(info) {
  return {
    configured: info?.configured === true,
    writable: info?.writable !== false,
    canConfigure: info?.writable !== false,
    providerLabel: 'DeepSeek API',
  }
}

/**
 * Register cookie-authenticated key status and rotation on Connection's `/api` channel.
 * @param ctx - Host context that already provides `connection` and `credentials`.
 */
export function registerDiyModelAccessRoute(ctx) {
  return ctx.connection.fetch.register({
    path: API_PATH,
    methods: ['GET', 'POST'],
    requestBody: 'buffered',
    fetch: async request => {
      try {
        if (request.method === 'GET') {
          return Response.json({
            ok: true,
            access: accessView(await ctx.credentials.describe(KEY_REF)),
          })
        }
        let body = {}
        try { body = await request.json() } catch (parseError) { void parseError }
        const apiKey = typeof body?.apiKey === 'string' ? body.apiKey.trim() : ''
        if (apiKey === '') {
          return Response.json({ ok: false, error: 'API Key 不能为空' }, { status: 400 })
        }
        await ctx.credentials.set(KEY_REF, apiKey)
        return Response.json({
          ok: true,
          access: accessView(await ctx.credentials.describe(KEY_REF)),
        })
      } catch (cause) {
        return Response.json({
          ok: false,
          error: cause instanceof Error ? cause.message : '模型凭据更新失败',
        }, { status: 502 })
      }
    },
  })
}
