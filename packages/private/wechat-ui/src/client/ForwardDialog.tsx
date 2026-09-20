import { useMemo, useState } from 'react'
import { Icon } from './icons.tsx'
import type { ChatMessageView, ForwardTargetView } from './types.ts'

function previewOf(message: ChatMessageView): string {
  const text = message.body.replace(/\s+/gu, ' ').trim()
  return text !== '' ? text.slice(0, 72) : `[图片 ${message.images?.length ?? 0} 张]`
}

export function ForwardDialog({
  messages,
  targets,
  onForward,
  onClose,
}: {
  messages: readonly ChatMessageView[]
  targets: readonly ForwardTargetView[]
  onForward: (targetSessionId: string) => Promise<void>
  onClose: () => void
}) {
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const filtered = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase()
    return normalized === '' ? targets : targets.filter(target => `${target.title} ${target.preview ?? ''}`.toLocaleLowerCase().includes(normalized))
  }, [query, targets])

  const submit = async (): Promise<void> => {
    if (selected === null || busy) return
    setBusy(true)
    setError(null)
    try {
      await onForward(selected)
      onClose()
    } catch (reason) {
      setBusy(false)
      setError(reason instanceof Error ? reason.message : '转发失败，请重试')
    }
  }

  return (
    <div className="diywx-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onClose() }}>
      <section className="diywx-forward-dialog" role="dialog" aria-modal="true" aria-label={messages.length > 1 ? `合并转发 ${messages.length} 条消息` : '转发消息'}>
        <header>
          <div>
            <strong>{messages.length > 1 ? `合并转发 ${messages.length} 条消息` : '转发消息'}</strong>
            <span>{messages.length > 1 ? '这些消息会合并成一条聊天记录' : previewOf(messages[0] as ChatMessageView)}</span>
          </div>
          <button type="button" aria-label="关闭转发窗口" disabled={busy} onClick={onClose}>×</button>
        </header>
        <label className="diywx-forward-search">
          <Icon name="search" size={17} />
          <input value={query} onChange={(event) => { setQuery(event.target.value) }} placeholder="搜索会话" aria-label="搜索转发目标会话" />
        </label>
        <div className="diywx-forward-targets" role="radiogroup" aria-label="选择转发目标">
          {filtered.map(target => (
            <button
              type="button"
              role="radio"
              aria-checked={selected === target.id}
              data-selected={selected === target.id || undefined}
              key={target.id}
              onClick={() => { setSelected(target.id); setError(null) }}
            >
              <span className="diywx-forward-target-avatar">{Array.from(target.title)[0] ?? '会'}</span>
              <span><strong>{target.title}</strong><small>{target.preview ?? '继续这个会话'}</small></span>
              <i>{selected === target.id ? '✓' : ''}</i>
            </button>
          ))}
          {filtered.length === 0 && <div className="diywx-forward-empty">没有找到其他会话</div>}
        </div>
        {error !== null && <div className="diywx-forward-error" role="alert">{error}</div>}
        <footer>
          <button type="button" disabled={busy} onClick={onClose}>取消</button>
          <button type="button" data-primary disabled={selected === null || busy} onClick={() => { void submit() }}>{busy ? '正在转发…' : '转发'}</button>
        </footer>
      </section>
    </div>
  )
}
