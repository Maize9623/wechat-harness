/** Cookie-authenticated launch URL for the isolated 3191 group-chat sidecar. */

const API_PATH = '/api/diy-collab-entry'

/**
 * Register the group-chat entry probe on Connection's `/api` channel.
 * @param ctx - Host context that already provides `connection`.
 * @param readEntry - live sidecar listen state and loopback URL.
 */
export function registerDiyCollabEntryRoute(ctx, readEntry) {
  return ctx.connection.fetch.register({
    path: API_PATH,
    methods: ['GET'],
    requestBody: 'buffered',
    fetch: async () => {
      try {
        const entry = readEntry()
        if (entry?.running !== true || typeof entry.url !== 'string') {
          return Response.json({
            ok: false,
            running: false,
            error: '群聊入口还没起来，单机聊天不受影响',
          }, { status: 503 })
        }
        return Response.json({
          ok: true,
          running: true,
          url: entry.url,
          firstSetup: entry.firstSetup === true,
        })
      } catch (cause) {
        return Response.json({
          ok: false,
          running: false,
          error: cause instanceof Error ? cause.message : '群聊入口读取失败',
        }, { status: 502 })
      }
    },
  })
}
