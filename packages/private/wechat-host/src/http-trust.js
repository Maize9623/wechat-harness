/**
 * Admit a WeChat Host /api route with Connection's cookie + Host fence.
 * Electron strips Origin, so a local Host/Origin check always 403s these routes.
 * @param ctx - Host context that already provides `connection`.
 * @param req - Incoming HTTP request.
 * @returns 401/403 when the request must stop, otherwise undefined.
 */
export function connectionRejection(ctx, req) {
  return ctx.connection.requestRejection(req)
}
