/** ChatGPT Codex subscription windows for the usage dashboard. */

const CODEX_KEY = 'llm-pi-ai/openai-codex'
const USAGE_URL = 'https://chatgpt.com/backend-api/wham/usage'
const TOKEN_URL = 'https://auth.openai.com/oauth/token'
const CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann'
const PLAN_LABEL = {
  free: 'Free',
  plus: 'Plus',
  pro: 'Pro',
  team: 'Team',
  business: 'Business',
  enterprise: 'Enterprise',
}

function objectOf(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value : undefined
}

function finiteNumber(value) {
  const next = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(next) ? next : undefined
}

function clampPercent(value) {
  const next = finiteNumber(value)
  return next === undefined ? undefined : Math.max(0, Math.min(100, Math.round(next)))
}

function resetAtMs(window) {
  const raw = finiteNumber(window.reset_at ?? window.resetAt ?? window.reset_time_ms ?? window.resetTimeMs)
  if (raw === undefined) {
    const after = finiteNumber(window.reset_after_seconds ?? window.resetAfterSeconds)
    return after === undefined ? undefined : Date.now() + after * 1000
  }
  return raw > 1e12 ? raw : raw * 1000
}

function windowSeconds(window) {
  return finiteNumber(window.limit_window_seconds ?? window.limitWindowSeconds ?? window.window_seconds)
}

/**
 * Name one Codex quota window from its duration, then from its id.
 * @param seconds - window length in seconds, if the backend sent one.
 * @param id - primary / weekly / five_hour key.
 */
export function windowLabel(seconds, id) {
  if (seconds !== undefined && seconds >= 500_000) return '周额度'
  if (seconds !== undefined && seconds >= 86_400) return `${Math.round(seconds / 86_400)} 日额度`
  if (seconds !== undefined && seconds >= 3_600) return `${Math.round(seconds / 3_600)} 小时额度`
  if (id === 'weekly' || id === 'secondary' || id === 'secondary_window') return '周额度'
  if (id === 'five_hour' || id === 'primary' || id === 'primary_window') return '5 小时额度'
  return '当前额度'
}

function resetsOf(source) {
  const raw = finiteNumber(
    source.resets_remaining
    ?? source.available_resets
    ?? source.resets_available
    ?? source.reset_credits
    ?? source.reset_count,
  )
  return raw === undefined ? undefined : Math.max(0, Math.round(raw))
}

function remainingOf(window) {
  const left = clampPercent(window.remaining_percent ?? window.percent_left ?? window.remainingPercent)
  if (left !== undefined) return left
  const used = clampPercent(window.used_percent ?? window.usedPercent)
  return used === undefined ? undefined : clampPercent(100 - used)
}

function windowView(id, raw) {
  const window = objectOf(raw)
  if (window === undefined) return undefined
  const remainingPercent = remainingOf(window)
  const resetAt = resetAtMs(window)
  const seconds = windowSeconds(window)
  const resets = resetsOf(window)
  if (remainingPercent === undefined && resetAt === undefined && resets === undefined && seconds === undefined) {
    return undefined
  }
  return {
    id,
    label: windowLabel(seconds, id),
    ...(remainingPercent === undefined ? {} : { remainingPercent }),
    ...(resetAt === undefined ? {} : { resetAt }),
    ...(seconds === undefined ? {} : { seconds }),
    ...(resets === undefined ? {} : { resets }),
  }
}

function pickWindows(rateLimit, body) {
  const named = [
    ['primary', rateLimit?.primary_window ?? rateLimit?.primary ?? body.five_hour ?? body.five_hour_rate_limit],
    ['weekly', rateLimit?.secondary_window ?? rateLimit?.secondary ?? body.weekly ?? body.weekly_rate_limit],
  ]
  return named.flatMap(([id, raw]) => {
    const view = windowView(id, raw)
    return view === undefined ? [] : [view]
  })
}

function planLabel(planId) {
  if (typeof planId !== 'string' || planId === '') return undefined
  const key = planId.toLowerCase()
  return PLAN_LABEL[key] ?? planId
}

/**
 * Restate one ChatGPT `/wham/usage` body as dashboard fields. Never keeps tokens.
 * @param body - JSON from the usage endpoint.
 */
export function parseCodexUsage(body) {
  const root = objectOf(body) ?? {}
  const rateLimit = objectOf(root.rate_limit ?? root.rateLimit)
  const credits = objectOf(root.credits)
  const planId = typeof (root.plan_type ?? root.planType ?? root.plan) === 'string'
    ? String(root.plan_type ?? root.planType ?? root.plan)
    : undefined
  const windows = pickWindows(rateLimit, root)
  const allowed = rateLimit?.allowed !== false
  const exhausted = rateLimit?.limit_reached === true || allowed === false
  const creditBalance = finiteNumber(credits?.balance)
  const resets = resetsOf(rateLimit ?? {}) ?? resetsOf(root)
  return {
    configured: true,
    ...(planId === undefined ? {} : { planId, plan: planLabel(planId) }),
    allowed,
    exhausted,
    windows,
    ...(resets === undefined ? {} : { resets }),
    ...(credits === undefined ? {} : {
      credits: {
        hasCredits: credits.has_credits === true || credits.unlimited === true || (creditBalance ?? 0) > 0,
        ...(creditBalance === undefined ? {} : { balance: creditBalance }),
        unlimited: credits.unlimited === true,
      },
    }),
    fetchedAt: Date.now(),
  }
}

function grantOf(record) {
  const payload = record?.kind === 'grant' ? objectOf(record.payload) : undefined
  if (payload === undefined) return undefined
  const access = typeof payload.access === 'string' && payload.access !== ''
    ? payload.access
    : typeof payload.access_token === 'string' ? payload.access_token : ''
  if (access === '') return undefined
  const refresh = typeof payload.refresh === 'string' ? payload.refresh
    : typeof payload.refresh_token === 'string' ? payload.refresh_token : undefined
  const accountId = typeof payload.accountId === 'string' && payload.accountId !== ''
    ? payload.accountId
    : typeof payload.account_id === 'string' ? payload.account_id : undefined
  return {
    access,
    ...(refresh === undefined || refresh === '' ? {} : { refresh }),
    ...(accountId === undefined || accountId === '' ? {} : { accountId }),
    expires: finiteNumber(payload.expires),
    payload,
  }
}

async function refreshGrant(grant, fetchImpl) {
  if (grant.refresh === undefined) return undefined
  const response = await fetchImpl(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: grant.refresh,
      client_id: CLIENT_ID,
    }),
  })
  let body = {}
  try { body = await response.json() } catch (parseError) { void parseError }
  if (!response.ok || typeof body.access_token !== 'string') return undefined
  return {
    access: body.access_token,
    refresh: typeof body.refresh_token === 'string' ? body.refresh_token : grant.refresh,
    expires: Date.now() + (finiteNumber(body.expires_in) ?? 3600) * 1000,
    accountId: grant.accountId,
  }
}

async function writeGrant(ctx, next) {
  if (typeof ctx.credentials.modifyRecord !== 'function') return
  await ctx.credentials.modifyRecord(CODEX_KEY, (current) => {
    const payload = current?.kind === 'grant' ? { ...objectOf(current.payload) } : {}
    return {
      kind: 'grant',
      payload: {
        ...payload,
        type: payload.type ?? 'oauth',
        access: next.access,
        refresh: next.refresh,
        ...(next.expires === undefined ? {} : { expires: next.expires }),
        ...(next.accountId === undefined ? {} : { accountId: next.accountId }),
      },
    }
  })
}

async function fetchUsage(grant, fetchImpl) {
  const headers = {
    accept: 'application/json',
    authorization: `Bearer ${grant.access}`,
    origin: 'https://chatgpt.com',
    referer: 'https://chatgpt.com/',
  }
  if (grant.accountId !== undefined) headers['chatgpt-account-id'] = grant.accountId
  return await fetchImpl(USAGE_URL, { headers })
}

/**
 * Read the stored Codex grant and the ChatGPT usage windows. Never returns secrets.
 * @param ctx - Host context with `credentials`.
 * @param fetchImpl - injectable `fetch` for tests.
 */
export async function readCodexUsage(ctx, fetchImpl = globalThis.fetch) {
  if (typeof ctx.credentials?.readRecord !== 'function') return { configured: false }
  let record
  try { record = await ctx.credentials.readRecord(CODEX_KEY) } catch (missing) {
    void missing
    return { configured: false }
  }
  let grant = grantOf(record)
  if (grant === undefined) return { configured: false }
  const stale = grant.expires !== undefined && grant.expires < Date.now() + 30_000
  if (stale) {
    const refreshed = await refreshGrant(grant, fetchImpl)
    if (refreshed !== undefined) {
      grant = refreshed
      try { await writeGrant(ctx, refreshed) } catch (persistError) { void persistError }
    }
  }
  let response = await fetchUsage(grant, fetchImpl)
  if (response.status === 401) {
    const refreshed = await refreshGrant(grant, fetchImpl)
    if (refreshed === undefined) return { configured: true, error: 'ChatGPT 登录已过期，请到设置重新登录。' }
    grant = refreshed
    try { await writeGrant(ctx, refreshed) } catch (persistError) { void persistError }
    response = await fetchUsage(grant, fetchImpl)
  }
  let body = {}
  try { body = await response.json() } catch (parseError) { void parseError }
  if (!response.ok) {
    return {
      configured: true,
      error: typeof body?.error?.message === 'string'
        ? body.error.message
        : `ChatGPT 套餐额度接口返回 ${response.status}`,
    }
  }
  return parseCodexUsage(body)
}
