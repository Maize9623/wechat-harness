/** Same-origin HTML preview for pages that refuse iframe embedding. */

import { connectionRejection } from './http-trust.js'

export const BROWSE_API_PREFIX = '/api/diy-browse'
const MAX_BYTES = 2_000_000
const FETCH_TIMEOUT_MS = 12_000
const BROWSER_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'

export function safeBrowseTarget(value) {
  try {
    const parsed = new URL(value)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return undefined
    const host = parsed.hostname.toLowerCase()
    if (host === 'localhost' || host === '127.0.0.1' || host === '0.0.0.0' || host === '::1' || host.endsWith('.localhost')) {
      return undefined
    }
    return parsed
  } catch {
    return undefined
  }
}

export function embedBlockedByHeaders(headers) {
  const xfo = (headers.get('x-frame-options') ?? '').trim().toLowerCase()
  if (xfo === 'deny' || xfo === 'sameorigin') return true
  const csp = (headers.get('content-security-policy') ?? '').toLowerCase()
  const ancestors = /frame-ancestors\s+([^;]+)/u.exec(csp)?.[1] ?? ''
  if (ancestors === '') return false
  return !/(?:^|\s)(?:\*|https?:\/\/)/u.test(ancestors)
}

const PREVIEW_ESCAPE_SCRIPT = '<script>(function(){window.addEventListener("keydown",function(event){if(event.key!=="Escape")return;event.preventDefault();try{parent.postMessage({type:"diywx-escape"},"*")}catch(ignored){void ignored}},true)})();</script>'

export function rewritePreviewHtml(html, baseHref) {
  const base = `<base href="${baseHref.replaceAll('&', '&amp;').replaceAll('"', '&quot;')}">`
  const stripped = html.replace(/<meta[^>]+http-equiv=["']content-security-policy["'][^>]*>/giu, '')
  const withBase = /<head\b/iu.test(stripped) ? stripped.replace(/<head([^>]*)>/iu, `<head$1>${base}`) : `${base}${stripped}`
  const bodyEnd = withBase.search(/<\/body\s*>/iu)
  return bodyEnd < 0 ? `${withBase}${PREVIEW_ESCAPE_SCRIPT}` : `${withBase.slice(0, bodyEnd)}${PREVIEW_ESCAPE_SCRIPT}${withBase.slice(bodyEnd)}`
}

function json(res, status, value) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  res.end(JSON.stringify(value))
}

function previewHeaders(contentType) {
  return {
    'content-type': contentType,
    'cache-control': 'private, no-store',
    'x-content-type-options': 'nosniff',
    'content-security-policy': "default-src * 'unsafe-inline' 'unsafe-eval' data: blob:; frame-ancestors 'self';",
  }
}

async function fetchPreview(target) {
  const response = await fetch(target.href, {
    redirect: 'follow',
    headers: { accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8', 'user-agent': BROWSER_UA },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  })
  const bytes = Buffer.from(await response.arrayBuffer())
  if (bytes.length > MAX_BYTES) throw new Error('页面过大，预览通道无法载入')
  return { response, bytes, finalUrl: response.url || target.href }
}

/**
 * @param ctx - Host context that already provides `connection`.
 * @returns prefix route that probes embed policy and proxies HTML without frame-busting headers.
 */
export function browseRoutes(ctx) {
  return [{
    kind: 'prefix', path: BROWSE_API_PREFIX,
    handler: async (req, res) => {
      const rejection = connectionRejection(ctx, req)
      if (rejection !== undefined) return json(res, rejection, { ok: false, error: rejection === 401 ? 'unauthorized' : 'forbidden' })
      const requestUrl = new URL(req.url ?? '', `http://${req.headers.host ?? '127.0.0.1'}`)
      if (req.method !== 'GET') return json(res, 405, { ok: false, error: '接口不存在' })
      const target = safeBrowseTarget(requestUrl.searchParams.get('url') ?? '')
      if (target === undefined) return json(res, 400, { ok: false, error: '预览地址无效' })
      try {
        const { response, bytes, finalUrl } = await fetchPreview(target)
        if (requestUrl.pathname === `${BROWSE_API_PREFIX}/probe`) {
          return json(res, 200, {
            ok: true,
            embeddable: response.ok && !embedBlockedByHeaders(response.headers),
            status: response.status,
          })
        }
        if (requestUrl.pathname !== BROWSE_API_PREFIX) return json(res, 404, { ok: false, error: '接口不存在' })
        const contentType = response.headers.get('content-type') ?? 'text/html; charset=utf-8'
        if (!response.ok) return json(res, 502, { ok: false, error: `预览通道返回 ${response.status}` })
        if (!contentType.toLowerCase().includes('html')) {
          res.writeHead(200, previewHeaders(contentType))
          res.end(bytes)
          return
        }
        const html = rewritePreviewHtml(bytes.toString('utf8'), finalUrl)
        res.writeHead(200, previewHeaders('text/html; charset=utf-8'))
        res.end(html)
      } catch (cause) {
        return json(res, 502, { ok: false, error: cause instanceof Error ? cause.message : '预览通道读取失败' })
      }
    },
  }]
}
