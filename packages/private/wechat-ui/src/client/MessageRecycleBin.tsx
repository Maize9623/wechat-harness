import { useEffect, useMemo, useState } from 'react'
import { Icon } from './icons.tsx'
import {
  emptyMessageRecycleBin,
  loadMessageRecycleState,
  MESSAGE_RECYCLE_DAYS,
  MESSAGE_RECYCLE_EVENT,
  purgeRecycledMessages,
  restoreRecycledMessages,
  type MessageRecycleState,
} from './messageRecycle.ts'

function remainingLabel(expiresAt: number): string {
  const days = Math.max(1, Math.ceil((expiresAt - Date.now()) / (24 * 60 * 60 * 1000)))
  return `${days} 天后自动删除`
}

function messagePreview(body: string, imageCount: number): string {
  const text = body.replace(/\s+/gu, ' ').trim()
  if (text !== '') return text.slice(0, 110)
  return imageCount > 0 ? `[图片 ${imageCount} 张]` : '[空消息]'
}

export function MessageRecycleBin({ onClose }: { onClose: () => void }) {
  const [state, setState] = useState<MessageRecycleState>(loadMessageRecycleState)
  const [confirmClear, setConfirmClear] = useState(false)

  useEffect(() => {
    const refresh = (): void => { setState(loadMessageRecycleState()) }
    window.addEventListener(MESSAGE_RECYCLE_EVENT, refresh)
    const timer = window.setInterval(refresh, 60 * 60 * 1000)
    return () => {
      window.removeEventListener(MESSAGE_RECYCLE_EVENT, refresh)
      window.clearInterval(timer)
    }
  }, [])

  const records = useMemo(() => Object.values(state.recycled).sort((left, right) => right.deletedAt - left.deletedAt), [state])

  return (
    <div className="diywx-modal-backdrop diywx-recycle-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <section className="diywx-recycle-dialog" role="dialog" aria-modal="true" aria-label="聊天记录回收站">
        <header>
          <div>
            <strong><Icon name="trash" size={20} />聊天记录回收站</strong>
            <span>删除的消息保留 {MESSAGE_RECYCLE_DAYS} 天，期间可以恢复。</span>
          </div>
          <button type="button" aria-label="关闭聊天记录回收站" onClick={onClose}>×</button>
        </header>
        <div className="diywx-recycle-toolbar">
          <span>{records.length === 0 ? '回收站为空' : `${records.length} 条聊天记录`}</span>
          {records.length > 0 && <button type="button" onClick={() => { setConfirmClear(true) }}>清空回收站</button>}
        </div>
        <div className="diywx-recycle-list">
          {records.map(record => (
            <article key={record.key} className="diywx-recycle-row">
              <span className="diywx-recycle-role" data-role={record.message.role}>{record.message.role === 'user' ? '我' : 'AI'}</span>
              <div>
                <strong>{record.sessionTitle}</strong>
                <p>{messagePreview(record.message.body, record.message.images?.length ?? 0)}</p>
                <small>{new Date(record.deletedAt).toLocaleString('zh-CN')} · {remainingLabel(record.expiresAt)}</small>
              </div>
              <div className="diywx-recycle-actions">
                <button type="button" onClick={() => { setState(restoreRecycledMessages([record.key])) }}>恢复</button>
                <button type="button" data-danger onClick={() => { setState(purgeRecycledMessages([record.key])) }}>立即删除</button>
              </div>
            </article>
          ))}
          {records.length === 0 && (
            <div className="diywx-recycle-empty">
              <Icon name="trash" size={38} />
              <strong>这里还没有删除的聊天记录</strong>
              <span>在消息上点击右键，即可删除或多选管理。</span>
            </div>
          )}
        </div>
      </section>
      {confirmClear && (
        <section className="diywx-recycle-confirm" role="alertdialog" aria-modal="true" aria-label="确认清空聊天记录回收站">
          <strong>清空全部聊天记录？</strong>
          <p>清空后无法从新 UI 恢复。</p>
          <div>
            <button type="button" onClick={() => { setConfirmClear(false) }}>取消</button>
            <button type="button" data-danger onClick={() => { setState(emptyMessageRecycleBin()); setConfirmClear(false) }}>确认清空</button>
          </div>
        </section>
      )}
    </div>
  )
}
