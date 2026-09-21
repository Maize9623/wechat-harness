/** DeepSeek API key and ChatGPT Codex subscription status for the settings card. */

import { AuthorizationDeclinedError } from '@deepseek-ai/dsh-authorization'

const API_PATH = '/api/diy-model-access'
const KEY_REF = 'DEEPSEEK_API_KEY'
const CODEX_KEY = 'llm-pi-ai/openai-codex'
const CODEX_ROUTE = {
  displayName: 'ChatGPT Codex',
}

const login = {
  notice: undefined,
  prompt: undefined,
  resolvePrompt: undefined,
  error: undefined,
}

function serviceOf(ctx, name) {
  try {
    return typeof ctx.get === 'function' ? ctx.get(name) : ctx[name]
  } catch (missing) {
    void missing
    return undefined
  }
}

function deepseekView(info) {
  return {
    id: 'deepseek',
    label: 'DeepSeek API',
    configured: info?.configured === true,
    writable: info?.writable !== false,
  }
}

function noticeView(notice) {
  if (notice === undefined) return undefined
  return {
    message: String(notice.message ?? ''),
    ...(typeof notice.url === 'string' && notice.url !== '' ? { url: notice.url } : {}),
    ...(typeof notice.code === 'string' && notice.code !== '' ? { code: notice.code } : {}),
  }
}

function promptView(prompt) {
  if (prompt === undefined) return undefined
  const options = Array.isArray(prompt.options)
    ? prompt.options.map(option => ({
      id: String(option.id),
      label: String(option.label ?? option.id),
    }))
    : undefined
  return {
    kind: prompt.kind,
    message: prompt.message,
    ...(prompt.placeholder === undefined ? {} : { placeholder: prompt.placeholder }),
    ...(options === undefined ? {} : { options }),
  }
}

function deviceCodeAnswer(prompt) {
  if (prompt?.kind !== 'select' || !Array.isArray(prompt.options)) return undefined
  const device = prompt.options.find(option => option.id === 'device_code')
  return typeof device?.id === 'string' ? device.id : undefined
}

function accessView(deepseek, codex) {
  return {
    configured: deepseek.configured === true || codex.configured === true,
    writable: deepseek.writable !== false,
    canConfigure: deepseek.writable !== false,
    providerLabel: 'DeepSeek / Codex',
    channels: [deepseek, codex],
  }
}

async function describeDeepSeek(ctx) {
  try {
    return deepseekView(await ctx.credentials.describe(KEY_REF))
  } catch (missingKey) {
    void missingKey
    return deepseekView({ configured: false, writable: true })
  }
}

async function describeCodexRecord(ctx) {
  if (typeof ctx.credentials.describeRecord !== 'function') {
    return { configured: false, writable: true }
  }
  try {
    return await ctx.credentials.describeRecord(CODEX_KEY)
  } catch (missingRecord) {
    void missingRecord
    return { configured: false, writable: true }
  }
}

function authorizationOf(ctx) {
  return serviceOf(ctx, 'authorization')
}

function settingsOf(ctx) {
  return serviceOf(ctx, 'settings')
}

/**
 * Mount the official authorization seam so `llm-pi-ai` can register ChatGPT login.
 * @param ctx - Host context.
 */
export async function ensureAuthorization(ctx) {
  const existing = authorizationOf(ctx)
  if (existing !== undefined) return existing
  const { default: AuthorizationService } = await import('@deepseek-ai/dsh-authorization')
  await ctx.plugin(AuthorizationService)
  return authorizationOf(ctx)
}

async function enableCodexRoute(ctx) {
  const settings = settingsOf(ctx)
  if (settings === undefined || typeof settings.mutate !== 'function') {
    throw new Error('设置服务尚未加载，暂时不能启用 Codex 通道')
  }
  await settings.mutate('llm-pi-ai', [
    { op: 'set', path: ['providers', 'openai-codex'], value: CODEX_ROUTE },
  ])
}

async function disableCodexRoute(ctx) {
  const settings = settingsOf(ctx)
  if (settings === undefined || typeof settings.mutate !== 'function') return
  await settings.mutate('llm-pi-ai', [
    { op: 'unset', path: ['providers', 'openai-codex'] },
  ])
}

async function channelSnapshot(ctx) {
  const [deepseek, record] = await Promise.all([describeDeepSeek(ctx), describeCodexRecord(ctx)])
  const auth = authorizationOf(ctx)
  const inFlight = auth?.describe?.(CODEX_KEY)?.inFlight === true
  return accessView(deepseek, {
    id: 'codex',
    label: 'ChatGPT Codex 订阅',
    configured: record.configured === true,
    writable: record.writable !== false,
    inFlight,
    ...(noticeView(login.notice) === undefined ? {} : { notice: noticeView(login.notice) }),
    ...(promptView(login.prompt) === undefined ? {} : { prompt: promptView(login.prompt) }),
    ...(login.error === undefined ? {} : { error: login.error }),
  })
}

function startCodexLogin(ctx) {
  const auth = authorizationOf(ctx)
  if (auth === undefined) throw new Error('登录服务尚未就绪，请重启 WeChat Harness 后再试')
  if (auth.describe?.(CODEX_KEY)?.inFlight === true) return
  login.error = undefined
  login.notice = { message: '正在打开 ChatGPT 登录…' }
  const interaction = {
    notify(notice) {
      login.notice = notice
    },
    prompt(prompt) {
      const auto = deviceCodeAnswer(prompt)
      if (auto !== undefined) return Promise.resolve(auto)
      login.prompt = prompt
      return new Promise((resolve, reject) => {
        login.resolvePrompt = (value, declined) => {
          login.prompt = undefined
          login.resolvePrompt = undefined
          if (declined === true) reject(new AuthorizationDeclinedError())
          else resolve(value)
        }
      })
    },
  }
  void auth.begin({
    key: CODEX_KEY,
    method: 'oauth',
    interaction,
  }).then(async (outcome) => {
    login.prompt = undefined
    login.resolvePrompt = undefined
    if (outcome.status === 'authorized') {
      await enableCodexRoute(ctx)
      login.notice = { message: 'ChatGPT Codex 已登录，可在会话里切换到这条通道。' }
      return
    }
    login.notice = { message: '已取消 ChatGPT 登录。' }
  }).catch((cause) => {
    login.prompt = undefined
    login.resolvePrompt = undefined
    login.error = cause instanceof Error ? cause.message : 'ChatGPT 登录失败'
    login.notice = { message: login.error }
  })
}

function cancelCodexLogin(ctx) {
  const auth = authorizationOf(ctx)
  auth?.cancel?.(CODEX_KEY)
  if (login.resolvePrompt !== undefined) login.resolvePrompt('', true)
  login.prompt = undefined
  login.notice = { message: '已取消 ChatGPT 登录。' }
}

function answerCodexPrompt(value) {
  if (login.resolvePrompt === undefined) throw new Error('当前没有等待回答的登录问题')
  login.resolvePrompt(String(value ?? '').trim(), false)
}

async function logoutCodex(ctx) {
  cancelCodexLogin(ctx)
  if (typeof ctx.credentials.deleteRecord === 'function') await ctx.credentials.deleteRecord(CODEX_KEY)
  await disableCodexRoute(ctx)
  login.notice = { message: '已退出 ChatGPT Codex。DeepSeek API 仍可用。' }
}

function jsonError(message, status) {
  return Response.json({ ok: false, error: message }, { status })
}

/**
 * Register cookie-authenticated model-channel status, DeepSeek key rotation, and Codex login.
 * @param ctx - Host context that already provides `connection` and `credentials`.
 */
export function registerDiyModelAccessRoute(ctx) {
  login.notice = undefined
  login.prompt = undefined
  login.resolvePrompt = undefined
  login.error = undefined
  return ctx.connection.fetch.register({
    path: API_PATH,
    methods: ['GET', 'POST'],
    requestBody: 'buffered',
    fetch: async request => {
      try {
        if (request.method === 'GET') {
          return Response.json({ ok: true, access: await channelSnapshot(ctx) })
        }
        let body = {}
        try { body = await request.json() } catch (parseError) { void parseError }
        const action = typeof body?.action === 'string' ? body.action : ''
        if (action === 'codex-login') {
          await ensureAuthorization(ctx)
          startCodexLogin(ctx)
          return Response.json({ ok: true, access: await channelSnapshot(ctx) })
        }
        if (action === 'codex-cancel') {
          cancelCodexLogin(ctx)
          return Response.json({ ok: true, access: await channelSnapshot(ctx) })
        }
        if (action === 'codex-answer') {
          answerCodexPrompt(body?.value)
          return Response.json({ ok: true, access: await channelSnapshot(ctx) })
        }
        if (action === 'codex-logout') {
          await logoutCodex(ctx)
          return Response.json({ ok: true, access: await channelSnapshot(ctx) })
        }
        const apiKey = typeof body?.apiKey === 'string' ? body.apiKey.trim() : ''
        if (apiKey === '') return jsonError('API Key 不能为空', 400)
        await ctx.credentials.set(KEY_REF, apiKey)
        return Response.json({ ok: true, access: await channelSnapshot(ctx) })
      } catch (cause) {
        return jsonError(cause instanceof Error ? cause.message : '模型通道更新失败', 502)
      }
    },
  })
}
