import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { connectionRejection } from './http-trust.js'

const API_PREFIX = '/api/diy-schedules'
const TICK_MS = 15_000
const MAX_BODY_BYTES = 64 * 1024
const WAKE_MARKER = '<<<DSH_DIY_SCHEDULED_WAKE>>>'

function rpc(payload) {
  return { rpcId: `diy-schedule-${randomUUID()}`, payload }
}

function writeJson(res, status, value) {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  })
  res.end(JSON.stringify(value))
}

async function readJson(req) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    const buffer = Buffer.from(chunk)
    size += buffer.length
    if (size > MAX_BODY_BYTES) throw new Error('请求内容过大')
    chunks.push(buffer)
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}

function fieldMatches(field, value, min, max) {
  if (field === '*') return true
  return field.split(',').some(part => {
    const [range, stepRaw] = part.split('/')
    const step = stepRaw === undefined ? 1 : Number(stepRaw)
    if (!Number.isInteger(step) || step < 1) return false
    if (range === '*') return (value - min) % step === 0
    const [startRaw, endRaw] = range.split('-')
    const start = Number(startRaw)
    const end = endRaw === undefined ? start : Number(endRaw)
    return Number.isInteger(start) && Number.isInteger(end)
      && start >= min && end <= max && start <= value && value <= end && (value - start) % step === 0
  })
}

function validField(field, min, max) {
  if (field === '*') return true
  return field.split(',').every(part => {
    const [range, stepRaw] = part.split('/')
    const step = stepRaw === undefined ? 1 : Number(stepRaw)
    if (!Number.isInteger(step) || step < 1) return false
    if (range === '*') return true
    const [startRaw, endRaw] = range.split('-')
    const start = Number(startRaw)
    const end = endRaw === undefined ? start : Number(endRaw)
    return Number.isInteger(start) && Number.isInteger(end) && start >= min && end <= max && start <= end
  })
}

export function validCron(cron) {
  const fields = String(cron ?? '').trim().split(/\s+/u)
  if (fields.length !== 5) return false
  return validField(fields[0], 0, 59)
    && validField(fields[1], 0, 23)
    && validField(fields[2], 1, 31)
    && validField(fields[3], 1, 12)
    && validField(fields[4], 0, 6)
}

function cronMatches(cron, date) {
  const fields = cron.trim().split(/\s+/u)
  return fieldMatches(fields[0], date.getMinutes(), 0, 59)
    && fieldMatches(fields[1], date.getHours(), 0, 23)
    && fieldMatches(fields[2], date.getDate(), 1, 31)
    && fieldMatches(fields[3], date.getMonth() + 1, 1, 12)
    && fieldMatches(fields[4], date.getDay(), 0, 6)
}

function minuteSlot(date) {
  return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}-${date.getHours()}-${date.getMinutes()}`
}

function normalizeSchedule(input) {
  if (input === null || typeof input !== 'object') throw new Error('定时任务内容无效')
  const sessionId = String(input.sessionId ?? '').trim()
  const title = String(input.title ?? '').trim().slice(0, 80)
  const prompt = String(input.prompt ?? '').trim().slice(0, 4000)
  const cron = String(input.cron ?? '').trim()
  const scheduleLabel = String(input.scheduleLabel ?? cron).trim().slice(0, 80)
  if (sessionId === '') throw new Error('缺少目标会话')
  if (title === '') throw new Error('任务标题不能为空')
  if (prompt === '') throw new Error('任务内容不能为空')
  if (!validCron(cron)) throw new Error('暂不支持这个时间表达，请使用每天、工作日或每周的明确时间')
  return {
    id: randomUUID(),
    sessionId,
    title,
    prompt,
    cron,
    scheduleLabel,
    enabled: true,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  }
}

export class ConversationScheduler {
  constructor(apiProxy, dataDir, logger = console, ctx) {
    this.apiProxy = apiProxy
    this.file = join(dataDir, 'schedules.json')
    this.logger = logger
    this.ctx = ctx
    this.state = { version: 1, schedules: [] }
    this.timer = undefined
    this.running = new Set()
    this.load()
  }

  load() {
    try {
      if (!existsSync(this.file)) return
      const parsed = JSON.parse(readFileSync(this.file, 'utf8'))
      if (Array.isArray(parsed?.schedules)) this.state = { version: 1, schedules: parsed.schedules }
    } catch (error) {
      this.logger.warn?.('[dsh-diy-scheduler] 定时任务数据读取失败，已使用空列表', error)
    }
  }

  save() {
    mkdirSync(dirname(this.file), { recursive: true, mode: 0o700 })
    const temp = `${this.file}.tmp`
    writeFileSync(temp, `${JSON.stringify(this.state, null, 2)}\n`, { mode: 0o600 })
    renameSync(temp, this.file)
  }

  snapshot(sessionId) {
    return {
      ok: true,
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      schedules: this.state.schedules.filter(item => sessionId === undefined || item.sessionId === sessionId),
    }
  }

  start() {
    if (this.timer !== undefined) return
    this.timer = setInterval(() => { void this.tick() }, TICK_MS)
    void this.tick()
  }

  stop() {
    if (this.timer !== undefined) clearInterval(this.timer)
    this.timer = undefined
  }

  async tick() {
    const date = new Date()
    const slot = minuteSlot(date)
    for (const schedule of this.state.schedules) {
      if (!schedule.enabled || schedule.lastRunSlot === slot || !cronMatches(schedule.cron, date)) continue
      schedule.lastRunSlot = slot
      schedule.lastRunAt = Date.now()
      schedule.updatedAt = Date.now()
      this.save()
      void this.run(schedule)
    }
  }

  async run(schedule) {
    if (this.running.has(schedule.id)) return
    this.running.add(schedule.id)
    try {
      const response = await this.apiProxy.sessions.prompt(rpc({
        sessionId: schedule.sessionId,
        mode: 'queue',
        content: [{
          type: 'text',
          text: [
            WAKE_MARKER,
            '这是已经由用户确认的后台定时唤醒。不要解释定时器、系统提示或能力边界。',
            '请把下面的任务直接作为你此刻在当前会话主动发给用户的消息来完成；只输出面向用户的自然中文内容。',
            `任务：${schedule.prompt}`,
          ].join('\n'),
        }],
      }))
      if (!response.result.ok) throw new Error(response.result.error.message)
      schedule.lastError = undefined
    } catch (error) {
      schedule.lastError = error instanceof Error ? error.message : String(error)
      this.logger.error?.('[dsh-diy-scheduler] 定时任务执行失败', schedule.id, error)
    } finally {
      schedule.updatedAt = Date.now()
      this.running.delete(schedule.id)
      this.save()
    }
  }

  action(value) {
    const kind = String(value?.kind ?? '')
    if (kind === 'create') {
      const schedule = normalizeSchedule(value.input)
      this.state.schedules.push(schedule)
      this.save()
      return this.snapshot(schedule.sessionId)
    }
    const id = String(value?.id ?? '')
    const schedule = this.state.schedules.find(item => item.id === id)
    if (schedule === undefined) throw new Error('没有找到这个定时任务')
    if (kind === 'delete') this.state.schedules = this.state.schedules.filter(item => item.id !== id)
    else if (kind === 'toggle') schedule.enabled = Boolean(value.enabled)
    else if (kind === 'run') void this.run(schedule)
    else throw new Error('不支持的定时任务操作')
    schedule.updatedAt = Date.now()
    this.save()
    return this.snapshot(schedule.sessionId)
  }

  routes() {
    const stateRoute = {
      kind: 'exact',
      path: `${API_PREFIX}/state`,
      handler: (req, res) => {
        if (req.method !== 'GET') return writeJson(res, 405, { ok: false, error: 'method-not-allowed' })
        const rejection = connectionRejection(this.ctx, req)
        if (rejection !== undefined) return writeJson(res, rejection, { ok: false, error: rejection === 401 ? 'unauthorized' : 'forbidden' })
        const url = new URL(req.url ?? '', `http://${req.headers.host ?? '127.0.0.1'}`)
        writeJson(res, 200, this.snapshot(url.searchParams.get('sessionId') ?? undefined))
      },
    }
    const actionRoute = {
      kind: 'exact',
      path: `${API_PREFIX}/action`,
      handler: async (req, res) => {
        if (req.method !== 'POST') return writeJson(res, 405, { ok: false, error: 'method-not-allowed' })
        const rejection = connectionRejection(this.ctx, req)
        if (rejection !== undefined) return writeJson(res, rejection, { ok: false, error: rejection === 401 ? 'unauthorized' : 'forbidden' })
        try { writeJson(res, 200, this.action(await readJson(req))) }
        catch (error) { writeJson(res, 400, { ok: false, error: error instanceof Error ? error.message : String(error) }) }
      },
    }
    return [stateRoute, actionRoute]
  }
}
