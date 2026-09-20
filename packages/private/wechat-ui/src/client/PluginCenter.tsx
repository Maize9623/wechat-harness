import { useEffect, useMemo, useState } from 'react'
import { Icon } from './icons.tsx'
import type { PluginInventoryEntryView } from './types.ts'

interface PluginCenterProps {
  load: () => Promise<readonly PluginInventoryEntryView[]>
  onClose: () => void
}

const CURATED = [
  { match: '@changfenhuang/dsh-genui', name: 'Generative UI 组件', description: '把模型输出的 dsh-ui JSON 渲染成表格、图表、表单、时间线、Diff、Mermaid 与 ECharts 等可信组件。', tag: '已安装 · 自动显示' },
  { match: 'dsh-visualize', name: '沙箱可视化', description: '在隔离 iframe 中运行 HTML、ECharts 与 Three.js，适合宽卡片、临时数据探索和交互模拟器。', tag: '已安装 · 自动显示' },
  { match: 'dsh-context', name: '上下文与 Token 分析', description: '查看会话上下文组成、历史压缩与 token 占用，帮助判断上下文为什么变长。', tag: '已安装 · 按需使用' },
] as const

const EVALUATED = [
  ['deepseek-harness-genui', 'Mini-app 工作室', '暂缓：与 dsh-genui 同时注册 Loader ID “genui”，会阻止 Harness 启动；本轮保留组件生态更完整的 dsh-genui。'],
  ['dsh-univer-office', 'Office 产物编辑', '暂缓：当前发布版锁定旧版 Harness core，直接安装会造成依赖冲突。'],
  ['MCP Apps / MCP-UI', '开放 UI 协议', '协议储备：等待当前 Harness 暴露完整 ui:// Host 与双向消息接口后再接入。'],
  ['A2UI', '声明式安全 UI', '暂缓：目前没有稳定的 DSH 适配器，能力与已安装 Generative UI 大量重叠。'],
  ['dsh-routing-suite', '模型与思考路由', '未安装：会修改全局 Agent 预设，和当前每会话模型、推理强度及人格记忆产生重叠。'],
  ['DSH-better-sidebar', '增强侧栏与文件终端', '未安装：会接管侧栏和右侧工作区，与当前微信式布局及子 Agent/浏览器预览冲突。'],
  ['dsh-TUI', '终端界面', '未安装：这是终端专用 TUI，不作用于当前 Web 微信式界面。'],
] as const

function displayName(entry: PluginInventoryEntryView): string {
  const curated = CURATED.find(item => entry.moduleName.includes(item.match))
  if (curated !== undefined) return curated.name
  return entry.moduleName.replace(/^@[^/]+\//u, '').replace(/^dsh-(?:client-|host-|ui-)?/u, '').replace(/[-_]+/gu, ' ')
}

function descriptionOf(entry: PluginInventoryEntryView): string {
  const curated = CURATED.find(item => entry.moduleName.includes(item.match))
  if (curated !== undefined) return curated.description
  const name = entry.moduleName.toLowerCase()
  if (name.includes('session-title')) return '根据首条消息生成或维护会话标题。'
  if (name.includes('session')) return '提供会话创建、状态、历史或生命周期能力。'
  if (name.includes('llm') || name.includes('model')) return '提供模型接入、选择、重试或请求处理能力。'
  if (name.includes('agent')) return '提供 Agent 运行、预设、子 Agent 或任务协作能力。'
  if (name.includes('tool')) return '提供工具注册、调用、结果处理或工具界面能力。'
  if (name.includes('settings')) return '提供配置文件或设置界面能力。'
  if (name.includes('credential')) return '在本机安全管理模型或服务凭据。'
  if (name.includes('timer') || name.includes('job')) return '提供计时、后台任务或本地任务调度能力。'
  if (name.includes('api') || name.includes('gateway') || name.includes('remote')) return '连接浏览器与 Harness Host 的 API/远程调用基础设施。'
  if (name.includes('typert') || name.includes('registry') || name.includes('include')) return 'Harness 内部模块加载、类型注册或组合基础设施。'
  if (name.includes('hmr')) return '开发时热更新支持；生产使用通常无需直接操作。'
  if (name.includes('web') || name.includes('browser')) return '提供网页访问、Web UI 或浏览器相关能力。'
  if (name.includes('file') || name.includes('fs')) return '提供文件读取、写入、选择或路径处理能力。'
  return 'Harness 运行所需的基础模块；通常由系统自动启用，无需手动操作。'
}

function phaseLabel(entry: PluginInventoryEntryView): string {
  if (!entry.enabled) return '已停用'
  if (entry.fiberPhase === 'active') return '运行中'
  if (entry.fiberPhase === 'failed') return '加载失败'
  if (entry.fiberPhase === 'loading' || entry.fiberPhase === 'pending') return '加载中'
  if (entry.fiberPhase === 'unloading') return '正在停用'
  return '已启用'
}

export function PluginCenter({ load, onClose }: PluginCenterProps) {
  const [entries, setEntries] = useState<readonly PluginInventoryEntryView[]>([])
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const refresh = async (): Promise<void> => {
    setLoading(true)
    setError(null)
    try { setEntries(await load()) }
    catch (reason) { setError(reason instanceof Error ? reason.message : '插件列表读取失败') }
    finally { setLoading(false) }
  }
  useEffect(() => { void refresh() }, [load])

  const filtered = useMemo(() => {
    const keyword = query.trim().toLowerCase()
    const sorted = [...entries].sort((left, right) => {
      const leftCurated = CURATED.some(item => left.moduleName.includes(item.match)) ? 0 : 1
      const rightCurated = CURATED.some(item => right.moduleName.includes(item.match)) ? 0 : 1
      return leftCurated - rightCurated || displayName(left).localeCompare(displayName(right), 'zh-CN')
    })
    if (keyword === '') return sorted
    return sorted.filter(entry => `${entry.moduleName} ${displayName(entry)} ${descriptionOf(entry)}`.toLowerCase().includes(keyword))
  }, [entries, query])

  return (
    <div className="diywx-modal-backdrop diywx-plugin-center-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <section className="diywx-plugin-center" role="dialog" aria-modal="true" aria-label="插件管理">
        <header>
          <span><Icon name="plugin" size={22} /><span><strong>插件管理</strong><small>已把技术名称翻译成普通人能看懂的用途</small></span></span>
          <div><button type="button" onClick={() => { void refresh() }}>刷新</button><button type="button" aria-label="关闭插件管理" onClick={onClose}>×</button></div>
        </header>
        <div className="diywx-plugin-search"><Icon name="search" size={18} /><input value={query} onChange={(event) => { setQuery(event.target.value) }} placeholder="搜索插件名称或功能" /></div>
        <div className="diywx-plugin-scroll">
          <section className="diywx-plugin-section">
            <div className="diywx-plugin-section-title"><strong>当前部署</strong><span>{entries.length} 个模块</span></div>
            {loading && <div className="diywx-plugin-empty">正在读取 Harness 的真实插件状态…</div>}
            {error !== null && <div className="diywx-plugin-error" role="alert">{error}</div>}
            {!loading && error === null && (
              <div className="diywx-plugin-grid">
                {filtered.map((entry) => {
                  const curated = CURATED.find(item => entry.moduleName.includes(item.match))
                  return (
                    <article key={entry.entryId} data-curated={curated !== undefined || undefined}>
                      <div className="diywx-plugin-card-head"><span><i data-phase={entry.fiberPhase ?? undefined} />{displayName(entry)}</span><em>{phaseLabel(entry)}</em></div>
                      <p>{descriptionOf(entry)}</p>
                      <footer><code>{entry.moduleName}</code>{curated !== undefined && <span>{curated.tag}</span>}</footer>
                    </article>
                  )
                })}
                {filtered.length === 0 && <div className="diywx-plugin-empty">没有找到匹配的插件</div>}
              </div>
            )}
          </section>
          <section className="diywx-plugin-section diywx-plugin-evaluated">
            <div className="diywx-plugin-section-title"><strong>本轮评估但未安装</strong><span>避免冲突与重复</span></div>
            <div className="diywx-plugin-grid">
              {EVALUATED.map(([id, name, description]) => <article key={id}><div className="diywx-plugin-card-head"><span>{name}</span><em data-deferred>暂缓</em></div><p>{description}</p><footer><code>{id}</code></footer></article>)}
            </div>
          </section>
        </div>
      </section>
    </div>
  )
}
