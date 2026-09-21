import { useEffect, useMemo, useState } from 'react'
import { Icon } from './icons.tsx'
import { formatRemaining, formatResetAt, formatResets } from './usageFormat.ts'
import type {
  SessionItemView,
  SessionModelView,
  SessionUsageHistoryView,
  TokenUsageView,
  UsageSampleView,
} from './types.ts'

interface KeyUsageView {
  configured: boolean
  error?: string
  keyRef?: string
  available?: boolean
  currency?: string
  totalBalance?: number
  grantedBalance?: number
  toppedUpBalance?: number
}

interface CodexWindowView {
  id: string
  label: string
  remainingPercent?: number
  resetAt?: number
  resets?: number
}

interface CodexUsageView {
  configured: boolean
  error?: string
  plan?: string
  allowed?: boolean
  exhausted?: boolean
  windows?: readonly CodexWindowView[]
  resets?: number
  credits?: { hasCredits?: boolean; balance?: number; unlimited?: boolean }
}

interface UsageDashboardProps {
  sessions: readonly SessionItemView[]
  models: Readonly<Record<string, SessionModelView>>
  loading: boolean
  error?: string
  loadUsage: (sessionIds: readonly string[], since?: number) => Promise<SessionUsageHistoryView>
  onClose: () => void
}

type UsageRange = 'today' | 'week' | 'month' | 'all'

interface PricedUsage {
  cost?: number
  complete: boolean
  label: string
  detail: string
}

const ONE_MILLION = 1_000_000
const EMPTY_USAGE: TokenUsageView = { uncachedInputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 }
const RANGE_OPTIONS: ReadonlyArray<{ id: UsageRange; label: string }> = [
  { id: 'today', label: '今天' },
  { id: 'week', label: '近 7 天' },
  { id: 'month', label: '本月' },
  { id: 'all', label: '全部' },
]

function addUsage(left: TokenUsageView, right: TokenUsageView): TokenUsageView {
  return {
    uncachedInputTokens: left.uncachedInputTokens + right.uncachedInputTokens,
    outputTokens: left.outputTokens + right.outputTokens,
    cacheReadTokens: left.cacheReadTokens + right.cacheReadTokens,
    cacheWriteTokens: left.cacheWriteTokens + right.cacheWriteTokens,
  }
}

function totalTokens(usage: TokenUsageView): number {
  return usage.uncachedInputTokens + usage.outputTokens + usage.cacheReadTokens + usage.cacheWriteTokens
}

function formatTokens(value: number): string {
  return new Intl.NumberFormat('zh-CN').format(value)
}

export function compactTokens(value: number): string {
  if (value >= ONE_MILLION) return `${(value / ONE_MILLION).toFixed(value >= 10 * ONE_MILLION ? 0 : 1)}m`
  if (value >= 1000) return `${(value / 1000).toFixed(value >= 10_000 ? 0 : 1)}k`
  return String(value)
}

function deepSeekPrice(model: SessionModelView | undefined, usage: TokenUsageView): PricedUsage {
  if (model === undefined) return { complete: false, label: '模型待识别', detail: '读取到模型后才会计算费用' }
  const provider = model.provider.toLocaleLowerCase()
  if (provider.includes('codex') || provider.includes('chatgpt')) {
    return { complete: false, label: model.model, detail: '消耗 ChatGPT 套餐额度，见上方剩余百分比' }
  }
  if (!provider.includes('deepseek')) {
    return { complete: false, label: model.model, detail: '当前尚未配置这个 Provider 的价格表' }
  }
  const id = model.model.toLocaleLowerCase()
  const isPro = id.includes('v4-pro')
  const isFlash = id.includes('flash') || id === 'deepseek-chat' || id === 'deepseek-reasoner'
  if (!isPro && !isFlash) return { complete: false, label: model.model, detail: 'DeepSeek 旧模型未套用当前价格，避免误报' }
  const inputMiss = isPro ? 3 : 1
  const cacheHit = isPro ? 0.025 : 0.02
  const output = isPro ? 6 : 2
  const missTokens = usage.uncachedInputTokens + usage.cacheWriteTokens
  const cost = (missTokens * inputMiss + usage.cacheReadTokens * cacheHit + usage.outputTokens * output) / ONE_MILLION
  return {
    cost,
    complete: true,
    label: isPro ? 'DeepSeek V4 Pro' : 'DeepSeek V4 Flash',
    detail: `未命中 ¥${inputMiss} · 命中 ¥${cacheHit} · 输出 ¥${output} / 百万 token`,
  }
}

function priceSamples(samples: readonly UsageSampleView[], fallback: SessionModelView | undefined): PricedUsage {
  const prices = samples.map(sample => deepSeekPrice(sample.model ?? fallback, sample.usage))
  const known = prices.filter((price): price is PricedUsage & { cost: number } => price.cost !== undefined)
  const labels = [...new Set(prices.map(price => price.label))]
  const details = [...new Set(prices.map(price => price.detail))]
  return {
    ...(known.length === 0 ? {} : { cost: known.reduce((sum, price) => sum + price.cost, 0) }),
    complete: prices.length > 0 && known.length === prices.length,
    label: labels.length <= 1 ? labels[0] ?? '模型待识别' : `${labels.length} 个模型`,
    detail: details.length <= 1 ? details[0] ?? '没有可计价的模型调用' : '按每次调用实际模型分别计价',
  }
}

function formatCost(value: number): string {
  if (value === 0) return '¥0.00'
  if (value < 0.01) return `¥${value.toFixed(4)}`
  return `¥${value.toFixed(2)}`
}

function sinceFor(range: UsageRange): number | undefined {
  const now = new Date()
  if (range === 'all') return undefined
  if (range === 'month') return new Date(now.getFullYear(), now.getMonth(), 1).getTime()
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  if (range === 'week') start.setDate(start.getDate() - 6)
  return start.getTime()
}

function currencySymbol(currency: string | undefined): string {
  return currency === 'USD' ? '$' : '¥'
}

function formatBalance(value: number, currency: string | undefined): string {
  const symbol = currencySymbol(currency)
  if (value === 0) return `${symbol}0.00`
  if (value < 0.01) return `${symbol}${value.toFixed(4)}`
  return `${symbol}${value.toFixed(2)}`
}

async function loadChannelUsage(): Promise<{ deepseek?: KeyUsageView; codex?: CodexUsageView }> {
  const response = await fetch('/api/diy-usage', { headers: { accept: 'application/json' } })
  const body = await response.json() as {
    ok?: boolean
    deepseek?: KeyUsageView
    codex?: CodexUsageView
    usage?: KeyUsageView
    error?: string
  }
  if (!response.ok || body.ok !== true) {
    throw new Error(body.error ?? '官方用量读取失败')
  }
  return {
    deepseek: body.deepseek ?? body.usage,
    ...(body.codex === undefined ? {} : { codex: body.codex }),
  }
}

function CodexQuota({ usage, loading }: { usage?: CodexUsageView; loading: boolean }) {
  const windows = usage?.windows ?? []
  const plan = usage?.plan ?? 'ChatGPT'
  const status = usage?.exhausted === true ? '已用尽' : '正常'
  return (
    <section className="diywx-usage-codex" aria-label="ChatGPT Codex 套餐">
      <header>
        <strong>ChatGPT Codex 套餐</strong>
        <small>{loading
          ? '正在读取…'
          : usage?.configured !== true
            ? (usage?.error ?? '未登录。到设置登录 ChatGPT 后可查看剩余额度。')
            : usage.error === undefined
              ? `${plan} · ${status}`
              : usage.error}</small>
      </header>
      {usage?.configured === true && usage.error === undefined && (
        <div className="diywx-usage-codex-windows">
          {windows.map(window => (
            <article key={window.id}>
              <span>{window.label}</span>
              <strong>{formatRemaining(window.remainingPercent)}</strong>
              <small>{[formatResetAt(window.resetAt), formatResets(window.resets)].filter(Boolean).join(' · ')}</small>
            </article>
          ))}
          {windows.length === 0 && (
            <article>
              <span>套餐额度</span>
              <strong>{status}</strong>
              <small>{formatResets(usage.resets) ?? '官方未返回分窗口剩余'}</small>
            </article>
          )}
        </div>
      )}
    </section>
  )
}

export function UsageDashboard({ sessions, models, loading, error, loadUsage, onClose }: UsageDashboardProps) {
  const [range, setRange] = useState<UsageRange>('today')
  const [history, setHistory] = useState<SessionUsageHistoryView>({ samples: {}, failures: [] })
  const [historyLoading, setHistoryLoading] = useState(true)
  const [historyError, setHistoryError] = useState<string | undefined>()
  const [keyUsage, setKeyUsage] = useState<KeyUsageView | undefined>()
  const [codexUsage, setCodexUsage] = useState<CodexUsageView | undefined>()
  const [keyLoading, setKeyLoading] = useState(true)
  const [keyError, setKeyError] = useState<string | undefined>()
  const sessionIdsKey = sessions.map(session => session.id).join('\u0000')

  useEffect(() => {
    let active = true
    setKeyLoading(true)
    setKeyError(undefined)
    void loadChannelUsage().then((value) => {
      if (!active) return
      setKeyUsage(value.deepseek)
      setCodexUsage(value.codex)
      if (value.deepseek?.error !== undefined) setKeyError(value.deepseek.error)
    }).catch((reason) => {
      if (active) setKeyError(reason instanceof Error ? reason.message : '官方用量读取失败')
    }).finally(() => { if (active) setKeyLoading(false) })
    return () => { active = false }
  }, [])

  useEffect(() => {
    let active = true
    setHistoryLoading(true)
    setHistoryError(undefined)
    setHistory({ samples: {}, failures: [] })
    const sessionIds = sessionIdsKey === '' ? [] : sessionIdsKey.split('\u0000')
    void loadUsage(sessionIds, sinceFor(range)).then((value) => {
      if (active) setHistory(value)
    }).catch((reason) => {
      if (active) setHistoryError(reason instanceof Error ? reason.message : '用量历史读取失败')
    }).finally(() => { if (active) setHistoryLoading(false) })
    return () => { active = false }
  }, [loadUsage, range, sessionIdsKey])

  const rows = useMemo(() => {
    const since = sinceFor(range)
    return sessions.map((session) => {
      const recorded = history.samples[session.id] ?? []
      const fallback = recorded.length === 0 && session.usage !== undefined
        && (since === undefined || (session.updatedAt ?? 0) >= since)
        ? [{ time: session.updatedAt ?? 0, usage: session.usage, ...(models[session.id] === undefined ? {} : { model: models[session.id] }) }]
        : []
      const samples = recorded.length > 0 ? recorded : fallback
      const usage = samples.reduce((sum, sample) => addUsage(sum, sample.usage), EMPTY_USAGE)
      return { session, samples, usage, priced: priceSamples(samples, models[session.id]) }
    }).filter(row => totalTokens(row.usage) > 0)
      .sort((left, right) => totalTokens(right.usage) - totalTokens(left.usage))
  }, [history.samples, models, range, sessions])
  const totals = rows.reduce<TokenUsageView>((sum, row) => addUsage(sum, row.usage), EMPTY_USAGE)
  const pricedRows = rows.filter((row): row is typeof row & { priced: PricedUsage & { cost: number } } => row.priced.cost !== undefined)
  const estimatedCost = pricedRows.reduce((sum, row) => sum + row.priced.cost, 0)
  const fullyPriced = rows.length > 0 && rows.every(row => row.priced.complete)
  const promptTokens = totals.uncachedInputTokens + totals.cacheReadTokens + totals.cacheWriteTokens
  const cacheRate = promptTokens === 0 ? 0 : totals.cacheReadTokens / promptTokens
  const busy = loading || historyLoading || keyLoading
  const rangeLabel = RANGE_OPTIONS.find(option => option.id === range)?.label ?? '今天'
  const combinedError = keyError ?? historyError ?? error
  const keyReady = keyUsage?.configured === true
  const keyBalance = keyUsage?.totalBalance ?? 0

  return (
    <div className="diywx-modal-backdrop diywx-usage-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <section className="diywx-usage-dialog" role="dialog" aria-modal="true" aria-label="用量与费用">
        <header>
          <span className="diywx-usage-heading"><span><Icon name="usage" size={20} /></span><span><strong>用量与费用</strong><small>DeepSeek 官方余额、ChatGPT Codex 套餐剩余，以及本机会话 token</small></span></span>
          <button type="button" aria-label="关闭用量与费用" onClick={onClose}>×</button>
        </header>
        <nav className="diywx-usage-ranges" aria-label="统计时间范围">
          {RANGE_OPTIONS.map(option => <button type="button" key={option.id} data-active={range === option.id || undefined} onClick={() => { setRange(option.id) }}>{option.label}</button>)}
        </nav>
        <div className="diywx-usage-cards" aria-busy={busy}>
          <article>
            <span>当前 Key 余额</span>
            <strong>{keyLoading ? '读取中…' : keyReady ? formatBalance(keyBalance, keyUsage?.currency) : '未配置'}</strong>
            <small>{keyReady
              ? `${keyUsage?.available === true ? '可继续调用' : '余额不足'} · 赠送 ${formatBalance(keyUsage?.grantedBalance ?? 0, keyUsage?.currency)} · 充值 ${formatBalance(keyUsage?.toppedUpBalance ?? 0, keyUsage?.currency)}`
              : '只查询本机 DEEPSEEK_API_KEY'}</small>
          </article>
          <article><span>{rangeLabel} Token</span><strong>{historyLoading ? '读取中…' : formatTokens(totalTokens(totals))}</strong><small>{rows.length} 个有用量的会话</small></article>
          <article><span>本机预估费用</span><strong>{historyLoading ? '计算中…' : formatCost(estimatedCost)}</strong><small>{fullyPriced ? '按 Flash / Pro 官方价估算，不是账单扣款' : `${pricedRows.length}/${rows.length} 个会话可部分或完整计价`}</small></article>
        </div>
        <CodexQuota usage={codexUsage} loading={keyLoading} />
        <div className="diywx-usage-breakdown" aria-label="Token 构成">
          <span><i data-color="miss" />输入未命中 <strong>{formatTokens(totals.uncachedInputTokens + totals.cacheWriteTokens)}</strong></span>
          <span><i data-color="cache" />缓存命中 <strong>{formatTokens(totals.cacheReadTokens)}</strong></span>
          <span><i data-color="output" />模型输出 <strong>{formatTokens(totals.outputTokens)}</strong></span>
        </div>
        <div className="diywx-usage-table-wrap">
          <table className="diywx-usage-table">
            <thead><tr><th>会话</th><th>模型与计费</th><th>输入 / 缓存 / 输出</th><th>预估费用</th></tr></thead>
            <tbody>
              {rows.map(({ session, usage, priced }) => (
                <tr key={session.id}>
                  <td><strong>{session.title}</strong><small>{session.workspaceId === undefined ? '未归属工作区' : '工作区会话'}</small></td>
                  <td><strong>{priced.label}</strong><small>{priced.detail}</small></td>
                  <td><strong>{formatTokens(usage.uncachedInputTokens + usage.cacheWriteTokens)} / {formatTokens(usage.cacheReadTokens)} / {formatTokens(usage.outputTokens)}</strong><small>共 {formatTokens(totalTokens(usage))} token</small></td>
                  <td>{priced.cost === undefined ? <span className="diywx-usage-unpriced">暂不可计价</span> : <strong>{priced.complete ? '' : '约 '}{formatCost(priced.cost)}</strong>}</td>
                </tr>
              ))}
              {!historyLoading && rows.length === 0 && <tr><td className="diywx-usage-empty" colSpan={4}>{rangeLabel}还没有当前 Key 在本机留下的 token 用量。</td></tr>}
              {historyLoading && <tr><td className="diywx-usage-empty" colSpan={4}>正在读取会话用量明细…</td></tr>}
            </tbody>
          </table>
        </div>
        {(combinedError !== undefined || history.failures.length > 0) && <p className="diywx-usage-error">部分数据读取失败：{combinedError ?? history.failures.slice(0, 2).join('；')}</p>}
        <footer>
          <p><strong>计价说明</strong> DeepSeek 余额来自官方 <code>/user/balance</code>。Codex 剩余百分比、刷新时间和可用重置来自当前 ChatGPT 登录，不是这把 DeepSeek Key。本机 token 与预估费用只按 Flash / Pro 官方价估算；Codex 会话不编造人民币费用。官方账单以平台扣款为准。</p>
          <a href="https://api-docs.deepseek.com/zh-cn/quick_start/pricing" target="_blank" rel="noopener noreferrer">查看 DeepSeek 官方价格 ↗</a>
        </footer>
      </section>
    </div>
  )
}
