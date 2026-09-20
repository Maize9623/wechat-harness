import { useState } from 'react'
import { Icon } from './icons.tsx'
import type { DshServiceView } from './types.ts'

interface ServiceManagerProps {
  services: readonly DshServiceView[]
  loading: boolean
  error?: string
  sessionTitle: (sessionId: string) => string | undefined
  onRefresh: () => Promise<void>
  onStop: (id: string) => Promise<void>
  onClose: () => void
}

function displayUrl(value: string): string {
  try {
    const url = new URL(value)
    if (!['127.0.0.1', 'localhost'].includes(location.hostname) && ['127.0.0.1', 'localhost'].includes(url.hostname)) {
      url.hostname = location.hostname
    }
    return url.href
  } catch {
    return value
  }
}

function startedAt(value: number): string {
  if (!Number.isFinite(value)) return '启动时间未知'
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).format(new Date(value))
}

export function ServiceManager({ services, loading, error, sessionTitle, onRefresh, onStop, onClose }: ServiceManagerProps) {
  const [busyId, setBusyId] = useState<string>()
  const [actionError, setActionError] = useState<string>()

  const stop = async (service: DshServiceView): Promise<void> => {
    if (!window.confirm(`关闭“${service.label}”？\n\n该服务对应的后台任务会被终止。`)) return
    setBusyId(service.id)
    setActionError(undefined)
    try {
      await onStop(service.id)
      await onRefresh()
    } catch (reason) {
      setActionError(reason instanceof Error ? reason.message : '服务关闭失败')
    } finally {
      setBusyId(undefined)
    }
  }

  return (
    <div className="diywx-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <section className="diywx-service-dialog" role="dialog" aria-modal="true" aria-label="运行服务">
        <header>
          <span className="diywx-service-heading">
            <i><Icon name="server" size={22} /></i>
            <span><strong>运行服务</strong><small>由 DSH 后台任务启动、当前仍在运行的服务</small></span>
          </span>
          <span className="diywx-service-head-actions">
            <button type="button" disabled={loading} onClick={() => { void onRefresh() }} aria-label="刷新服务">↻</button>
            <button type="button" onClick={onClose} aria-label="关闭">×</button>
          </span>
        </header>
        <div className="diywx-service-body">
          {(error ?? actionError) !== undefined && <p className="diywx-service-error">{error ?? actionError}</p>}
          {loading && services.length === 0 && <p className="diywx-service-empty"><span className="diywx-native-spinner" /> 正在读取运行服务…</p>}
          {!loading && services.length === 0 && <p className="diywx-service-empty">当前没有由 DSH 激活的运行服务。</p>}
          {services.map((service) => {
            const url = service.url === undefined ? undefined : displayUrl(service.url)
            const title = service.sessionId === undefined ? undefined : sessionTitle(service.sessionId)
            return (
              <article className="diywx-service-card" key={service.id} data-stopping={service.status === 'stopping' || undefined}>
                <span className="diywx-service-state" aria-label={service.status === 'stopping' ? '正在关闭' : '运行中'} />
                <div className="diywx-service-copy">
                  <strong>{service.label}</strong>
                  <small>{title === undefined ? '宿主后台任务' : `来源会话：${title}`} · {startedAt(service.startedAt)}</small>
                  <span>{url ?? (service.port === undefined ? '未识别到访问地址' : `端口 ${service.port}`)}</span>
                </div>
                <div className="diywx-service-actions">
                  {url !== undefined && <button type="button" onClick={() => { window.open(url, '_blank', 'noopener,noreferrer') }}>打开</button>}
                  <button
                    type="button"
                    data-danger
                    disabled={!service.canStop || busyId !== undefined || service.status === 'stopping'}
                    title={service.canStop ? '关闭这个后台服务' : '当前账号没有关闭权限'}
                    onClick={() => { void stop(service) }}
                  >{busyId === service.id || service.status === 'stopping' ? '关闭中…' : '关闭'}</button>
                </div>
              </article>
            )
          })}
        </div>
        <footer>Desktop 与群聊入口自身受到保护，不会出现在可关闭列表中。</footer>
      </section>
    </div>
  )
}
