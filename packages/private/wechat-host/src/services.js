import { connectionRejection } from './http-trust.js'

const API_PREFIX = '/api/diy-services'
const LIVE_STATUSES = new Set(['running', 'stopping'])
const PROTECTED_PORTS = new Set([19387, 3191, 9222, 9229, 9230])

function json(res, status, value) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  res.end(JSON.stringify(value))
}

function inferredPort(label) {
  const text = String(label ?? '')
  const urlPort = /https?:\/\/[^\s'"<>]+:(\d{2,5})(?:\/|\b)/iu.exec(text)?.[1]
  const explicit = /(?:^|\s)(?:--port(?:=|\s+)|-p\s+|PORT=)(\d{2,5})(?:\s|$)/u.exec(text)?.[1]
  const httpServer = /(?:http\.server|serve)(?:\s+[^\s]+)*\s+(\d{2,5})(?:\s|$)/iu.exec(text)?.[1]
  const value = Number(urlPort ?? explicit ?? httpServer)
  return Number.isInteger(value) && value > 0 && value <= 65_535 ? value : undefined
}

function inferredUrl(label, port) {
  const exact = /https?:\/\/[^\s'"<>]+/iu.exec(String(label ?? ''))?.[0]
  if (exact) {
    try {
      const parsed = new URL(exact)
      if (parsed.protocol === 'http:' || parsed.protocol === 'https:') return parsed.href
    } catch { /* fall through to the verified port */ }
  }
  return port === undefined ? undefined : `http://127.0.0.1:${port}/`
}

function publicService(job) {
  const label = String(job.label ?? '').trim().slice(0, 500) || `${job.kind} 后台任务`
  const port = inferredPort(label)
  const url = inferredUrl(label, port)
  return {
    id: String(job.id),
    kind: String(job.kind),
    label,
    status: job.status,
    startedAt: Number(job.startedAt ?? Date.now()),
    ...(job.ownerSession === undefined ? {} : { sessionId: String(job.ownerSession) }),
    ...(port === undefined ? {} : { port }),
    ...(url === undefined ? {} : { url }),
    protected: port !== undefined && PROTECTED_PORTS.has(port),
  }
}

/** Host-side view and cancellation seam over Harness' native background jobs. */
export class DshServiceManager {
  constructor(ctx) {
    this.ctx = ctx
  }

  records() {
    const jobs = this.ctx.jobs
    const sessions = this.ctx.sessions
    const agents = this.ctx.agents
    if (!jobs || !sessions || !agents) return []
    const records = new Map()
    const collect = caller => {
      for (const job of jobs.list(caller)) {
        if (!LIVE_STATUSES.has(job.status) || String(job.kind) === 'subagent') continue
        if (!records.has(String(job.id))) records.set(String(job.id), { job, caller })
      }
    }
    collect(undefined)
    for (const session of sessions.list()) {
      const agent = agents.get(session.id)
      if (agent !== undefined) collect(agent)
    }
    return [...records.values()]
  }

  list() {
    return this.records().map(({ job }) => publicService(job)).filter(service => !service.protected)
  }

  stop(id, allowedSessionIds) {
    const record = this.records().find(({ job }) => String(job.id) === String(id))
    if (!record) throw new Error('服务已结束或不存在')
    const service = publicService(record.job)
    if (service.protected) throw new Error('Harness 自身服务不能从这里关闭')
    if (allowedSessionIds !== undefined && (service.sessionId === undefined || !allowedSessionIds.has(service.sessionId))) {
      throw new Error('无权关闭这个服务')
    }
    this.ctx.jobs.kill(record.job.id, record.caller, '用户从运行服务面板关闭')
    return { ...service, status: 'stopping' }
  }
}

/** Loopback-only 3080 carrier for the shared service manager panel. */
export class DiyServiceServer {
  constructor(manager, ctx) {
    this.manager = manager
    this.ctx = ctx
  }

  routes() {
    return [{
      kind: 'prefix', path: API_PREFIX,
      handler: (req, res) => {
        const rejection = connectionRejection(this.ctx, req)
        if (rejection !== undefined) return json(res, rejection, { ok: false, error: rejection === 401 ? 'unauthorized' : 'forbidden' })
        const url = new URL(req.url ?? '', `http://${req.headers.host ?? '127.0.0.1'}`)
        if (req.method === 'GET' && url.pathname === API_PREFIX) {
          return json(res, 200, { ok: true, services: this.manager.list().map(service => ({ ...service, canStop: true })) })
        }
        const match = /^\/api\/diy-services\/([^/]+)\/stop$/u.exec(url.pathname)
        if (req.method === 'POST' && match) {
          try { return json(res, 200, { ok: true, service: this.manager.stop(decodeURIComponent(match[1])) }) }
          catch (cause) { return json(res, 409, { ok: false, error: cause instanceof Error ? cause.message : '服务关闭失败' }) }
        }
        return json(res, 404, { ok: false, error: '接口不存在' })
      },
    }]
  }
}

export const serviceInternals = { inferredPort, inferredUrl, publicService }
