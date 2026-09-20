import { useEffect, useMemo, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import { Icon } from './icons.tsx'
import { MarkdownMessage } from './MarkdownMessage.tsx'
import { createClientId } from './clientId.ts'
import type { SubagentDetailView, SubagentTaskView } from './types.ts'
import { prepareVisualizationHtml, VISUALIZATION_STORAGE_EVENT } from './visualizationSandbox.ts'
import { BrowserPreview, PREVIEW_ESCAPE_EVENT, visiblePreviewEditor } from './browserPreview.tsx'
import { fitPreviewScale, PREVIEW_PAGE_HEIGHT, PREVIEW_PAGE_WIDTH } from './previewFit.ts'

export type ConversationSideTarget =
  | { kind: 'subagent'; task: SubagentTaskView }
  | { kind: 'browser'; url: string }
  | { kind: 'visualization'; title: string; html?: string; url?: string; path?: string }

export type SidePresentation = 'docked' | 'mini' | 'immersive'

interface ConversationSidePanelProps {
  target: ConversationSideTarget
  presentation?: SidePresentation
  onClose: () => void
  onPresentationChange?: (presentation: SidePresentation) => void
  onLoadSubagent?: (task: SubagentTaskView) => Promise<SubagentDetailView>
}

const SIDE_WIDTH_KEY = 'dsh-diy-lab.side-preview-width.v1'
const SIDE_INSET_KEY = 'dsh-diy-lab.side-preview-inset.v1'
const MINI_RECT_KEY = 'dsh-diy-lab.side-preview-mini.v1'
const MIN_SIDE_WIDTH = 280
const MIN_CHAT_WIDTH = 240
const DEFAULT_SIDE_WIDTH = 520
const MINI_DEFAULT = { width: 420, height: 292, right: 18, bottom: 96 }
const MINI_MIN_WIDTH = 240
const MINI_MIN_HEIGHT = 180

type MiniRect = { width: number; height: number; right: number; bottom: number }
type ResizeEdge = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw'

function readNumber(key: string, fallback: number): number {
  try {
    const value = Number(JSON.parse(localStorage.getItem(key) ?? 'null'))
    return Number.isFinite(value) ? value : fallback
  } catch {
    return fallback
  }
}

function writeJson(key: string, value: unknown): void {
  try { localStorage.setItem(key, JSON.stringify(value)) } catch { /* preview layout stays in memory */ }
}

function readMiniRect(): MiniRect {
  try {
    const value = JSON.parse(localStorage.getItem(MINI_RECT_KEY) ?? 'null') as Partial<MiniRect> | null
    if (value === null || typeof value !== 'object') return { ...MINI_DEFAULT }
    return {
      width: Number.isFinite(value.width) ? Number(value.width) : MINI_DEFAULT.width,
      height: Number.isFinite(value.height) ? Number(value.height) : MINI_DEFAULT.height,
      right: Number.isFinite(value.right) ? Number(value.right) : MINI_DEFAULT.right,
      bottom: Number.isFinite(value.bottom) ? Number(value.bottom) : MINI_DEFAULT.bottom,
    }
  } catch {
    return { ...MINI_DEFAULT }
  }
}

function conversationBox(element: HTMLElement): DOMRect {
  return element.closest('.diywx-conversation')?.getBoundingClientRect() ?? element.getBoundingClientRect()
}

function clampDocked(width: number, inset: number, room: number): { width: number; inset: number } {
  const safeInset = Math.max(0, Math.min(inset, Math.max(0, room - MIN_SIDE_WIDTH)))
  const maxWidth = Math.max(MIN_SIDE_WIDTH, room - MIN_CHAT_WIDTH - safeInset)
  return {
    inset: safeInset,
    width: Math.min(Math.max(MIN_SIDE_WIDTH, width), Math.max(MIN_SIDE_WIDTH, maxWidth)),
  }
}

function clampMini(rect: MiniRect, room: DOMRect): MiniRect {
  const maxWidth = Math.max(MINI_MIN_WIDTH, room.width - 24)
  const maxHeight = Math.max(MINI_MIN_HEIGHT, room.height - 88)
  const width = Math.min(Math.max(MINI_MIN_WIDTH, rect.width), maxWidth)
  const height = Math.min(Math.max(MINI_MIN_HEIGHT, rect.height), maxHeight)
  return {
    width,
    height,
    right: Math.min(Math.max(8, rect.right), Math.max(8, room.width - width - 8)),
    bottom: Math.min(Math.max(72, rect.bottom), Math.max(72, room.height - height - 16)),
  }
}

function withVisualizationWheelBridge(html: string, channel: string): string {
  const bridge = `<script>(function(){window.addEventListener('wheel',function(event){event.preventDefault();window.parent.postMessage({type:'diywx-visual-wheel',channel:${JSON.stringify(channel)},deltaY:event.deltaY},'*')},{passive:false});window.addEventListener('keydown',function(event){if(event.key!=='Escape')return;event.preventDefault();window.parent.postMessage({type:${JSON.stringify(PREVIEW_ESCAPE_EVENT)}},'*')},true)})()</script>`
  const bodyEnd = html.search(/<\/body\s*>/iu)
  return bodyEnd < 0 ? `${html}${bridge}` : `${html.slice(0, bodyEnd)}${bridge}${html.slice(bodyEnd)}`
}

function VisualizationPreview({ title, html, url, path, fillViewport = false }: {
  title: string
  html?: string
  url?: string
  path?: string
  fillViewport?: boolean
}) {
  const viewportRef = useRef<HTMLDivElement | null>(null)
  const iframeRef = useRef<HTMLIFrameElement | null>(null)
  const zoomChannelRef = useRef(createClientId('visual-wheel'))
  const centerAfterZoomRef = useRef(false)
  const dragRef = useRef<{ pointerId: number; x: number; y: number; left: number; top: number } | null>(null)
  const [size, setSize] = useState({ width: 0, height: 0 })
  const [revision, setRevision] = useState(0)
  const [zoom, setZoom] = useState(1)
  const [panMode, setPanMode] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [storageRevision, setStorageRevision] = useState(0)

  useEffect(() => {
    const refresh = (): void => { setStorageRevision(value => value + 1) }
    window.addEventListener(VISUALIZATION_STORAGE_EVENT, refresh)
    return () => { window.removeEventListener(VISUALIZATION_STORAGE_EVENT, refresh) }
  }, [])

  useEffect(() => {
    const element = viewportRef.current
    if (element === null) return
    const update = (): void => {
      const next = { width: element.clientWidth, height: element.clientHeight }
      setSize(current => current.width === next.width && current.height === next.height ? current : next)
    }
    update()
    const observer = new ResizeObserver(update)
    observer.observe(element)
    return () => { observer.disconnect() }
  }, [])

  const fitScale = fitPreviewScale(size.width, size.height)
  const scale = fillViewport ? 1 : Math.max(0.1, Math.min(2, fitScale * zoom))
  const scaledWidth = PREVIEW_PAGE_WIDTH * scale
  const scaledHeight = PREVIEW_PAGE_HEIGHT * scale
  const bridgedHtml = useMemo(() => html === undefined ? undefined : withVisualizationWheelBridge(prepareVisualizationHtml(html), zoomChannelRef.current), [html, storageRevision])

  const adjustZoom = (deltaY: number): void => {
    centerAfterZoomRef.current = true
    setZoom(value => Math.max(0.4, Math.min(4, value * (deltaY < 0 ? 1.12 : 1 / 1.12))))
  }

  useEffect(() => {
    const receiveWheel = (event: MessageEvent): void => {
      if (event.source !== iframeRef.current?.contentWindow) return
      const data = event.data as { type?: unknown; channel?: unknown; deltaY?: unknown } | null
      if (data?.type !== 'diywx-visual-wheel' || data.channel !== zoomChannelRef.current || typeof data.deltaY !== 'number') return
      adjustZoom(data.deltaY)
    }
    window.addEventListener('message', receiveWheel)
    return () => { window.removeEventListener('message', receiveWheel) }
  }, [])

  useEffect(() => {
    if (!centerAfterZoomRef.current) return
    centerAfterZoomRef.current = false
    const element = viewportRef.current
    if (element === null) return
    element.scrollLeft = Math.max(0, (element.scrollWidth - element.clientWidth) / 2)
    element.scrollTop = Math.max(0, (element.scrollHeight - element.clientHeight) / 2)
  }, [scale])

  const openIndependent = (): void => {
    if (url !== undefined) {
      window.open(url, '_blank', 'noopener,noreferrer')?.focus()
      return
    }
    if (html === undefined) return
    const blobUrl = URL.createObjectURL(new Blob([html], { type: 'text/html' }))
    const popup = window.open(blobUrl, '_blank', 'noopener,noreferrer')
    popup?.focus()
    window.setTimeout(() => { URL.revokeObjectURL(blobUrl) }, 60_000)
  }

  const startPan = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (!panMode || event.button !== 0) return
    const element = viewportRef.current
    if (element === null) return
    dragRef.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, left: element.scrollLeft, top: element.scrollTop }
    event.currentTarget.setPointerCapture(event.pointerId)
    setDragging(true)
  }

  const movePan = (event: ReactPointerEvent<HTMLDivElement>): void => {
    const start = dragRef.current
    const element = viewportRef.current
    if (start === null || element === null || start.pointerId !== event.pointerId) return
    element.scrollLeft = start.left - (event.clientX - start.x)
    element.scrollTop = start.top - (event.clientY - start.y)
  }

  const stopPan = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (dragRef.current?.pointerId !== event.pointerId) return
    dragRef.current = null
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
    setDragging(false)
  }

  return (
    <div className="diywx-browser-preview" data-fill={fillViewport || undefined}>
      <div className="diywx-side-browser-bar diywx-visualization-bar">
        <span aria-hidden="true">●</span>
        <strong className="diywx-side-visual-label" title={path ?? title}>{path ?? title}</strong>
        <button type="button" title={panMode ? '退出拖动画布' : '拖动画布'} aria-label={panMode ? '退出拖动画布' : '拖动画布'} data-active={panMode || undefined} onClick={() => { setPanMode(value => !value) }}>✋</button>
        <button type="button" title="刷新预览" aria-label="刷新可视化预览" onClick={() => { setRevision(value => value + 1) }}>↻</button>
        <button type="button" title="独立标签页打开" aria-label="独立打开可视化" onClick={openIndependent}>↗</button>
      </div>
      {!fillViewport && (
        <div className="diywx-browser-resolution">
          <span>整页缩略 {PREVIEW_PAGE_WIDTH} × {PREVIEW_PAGE_HEIGHT}</span>
          <button type="button" title="恢复适合窗口" onClick={() => { centerAfterZoomRef.current = true; setZoom(1) }}>{Math.round(scale * 100)}%</button>
        </div>
      )}
      <div
        ref={viewportRef}
        className="diywx-browser-viewport diywx-visualization-viewport"
        data-pan-mode={panMode || undefined}
        data-dragging={dragging || undefined}
        onWheel={(event) => { event.preventDefault(); adjustZoom(event.deltaY) }}
        onPointerDown={startPan}
        onPointerMove={movePan}
        onPointerUp={stopPan}
        onPointerCancel={stopPan}
      >
        {fillViewport ? (
          <iframe
            ref={iframeRef}
            key={revision}
            {...(bridgedHtml !== undefined ? { srcDoc: bridgedHtml } : { src: url })}
            title={`可视化预览 ${title}`}
            style={{ width: '100%', height: '100%' }}
            sandbox="allow-forms allow-modals allow-popups allow-scripts allow-downloads"
            referrerPolicy="no-referrer"
          />
        ) : (
          <div className="diywx-browser-stage">
            <div className="diywx-browser-canvas" style={{ width: scaledWidth, height: scaledHeight }}>
              <div className="diywx-browser-scaler" style={{ width: PREVIEW_PAGE_WIDTH, height: PREVIEW_PAGE_HEIGHT, transform: `scale(${scale})` }}>
                <iframe
                  ref={iframeRef}
                  key={revision}
                  {...(bridgedHtml !== undefined ? { srcDoc: bridgedHtml } : { src: url })}
                  title={`可视化预览 ${title}`}
                  style={{ width: PREVIEW_PAGE_WIDTH, height: PREVIEW_PAGE_HEIGHT }}
                  sandbox="allow-forms allow-modals allow-popups allow-scripts allow-downloads"
                  referrerPolicy="no-referrer"
                />
              </div>
            </div>
          </div>
        )}
      </div>
      <p className="diywx-browser-hint">滚轮等比例缩放；放大后可拖动滚动条，或开启 ✋ 后按住左键拖动画布。按 Esc 可退出沉浸模式。</p>
    </div>
  )
}

function SubagentPreview({ task, load }: { task: SubagentTaskView; load?: (task: SubagentTaskView) => Promise<SubagentDetailView> }) {
  const [detail, setDetail] = useState<SubagentDetailView | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const loadTask = async (): Promise<void> => {
    if (load === undefined) return
    setLoading(true)
    setError(null)
    try {
      setDetail(await load(task))
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '子 Agent 工作记录读取失败')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { void loadTask() }, [task.id, task.status])
  const messages = detail?.messages ?? []

  return (
    <div className="diywx-subagent-preview">
      <section className="diywx-subagent-summary">
        <div className="diywx-subagent-avatar"><Icon name="robot" size={22} /></div>
        <div><strong>{task.title}</strong><span>{task.mode === 'one-shot' ? '一次性任务' : '可继续协作的子 Agent'}</span></div>
        <em data-status={task.status}>{task.status === 'running' ? '工作中' : task.status === 'completed' ? '已完成' : '不可用'}</em>
      </section>
      <div className="diywx-subagent-preview-toolbar">
        <strong>工作记录</strong>
        <button type="button" disabled={loading} onClick={() => { void loadTask() }}>{loading ? '读取中…' : '刷新'}</button>
      </div>
      {error !== null && <div className="diywx-subagent-preview-error" role="alert">{error}</div>}
      {!loading && error === null && messages.length === 0 && <div className="diywx-subagent-preview-empty">暂时还没有可展示的工作记录</div>}
      <div className="diywx-subagent-transcript">
        {messages.map(message => (
          <article key={message.id} data-role={message.role}>
            <header><span>{message.role === 'user' ? '主 Agent' : '子 Agent'}</span>{message.time !== undefined && <time>{message.time}</time>}</header>
            {message.reasoning !== undefined && <small>思考摘要：{message.reasoning}</small>}
            {message.body !== '' && <MarkdownMessage text={message.body} />}
          </article>
        ))}
      </div>
      {detail?.hasMore && <p className="diywx-subagent-more">当前显示最近 50 条记录，较早内容仍保留在 Harness 中。</p>}
    </div>
  )
}

export function ConversationSidePanel({
  target,
  presentation = 'docked',
  onClose,
  onPresentationChange,
  onLoadSubagent,
}: ConversationSidePanelProps) {
  const panelRef = useRef<HTMLElement | null>(null)
  const lastRestingPresentation = useRef<Exclude<SidePresentation, 'immersive'>>('docked')
  const [sideWidth, setSideWidth] = useState(() => readNumber(SIDE_WIDTH_KEY, DEFAULT_SIDE_WIDTH))
  const [sideInset, setSideInset] = useState(() => readNumber(SIDE_INSET_KEY, 0))
  const [miniRect, setMiniRect] = useState(readMiniRect)
  const sideWidthRef = useRef(sideWidth)
  const sideInsetRef = useRef(sideInset)
  const miniRectRef = useRef(miniRect)
  sideWidthRef.current = sideWidth
  sideInsetRef.current = sideInset
  miniRectRef.current = miniRect
  const title = useMemo(() => target.kind === 'browser' ? '网页预览' : target.kind === 'visualization' ? '可视化预览' : '子 Agent 工作情况', [target])
  const canChangePresentation = onPresentationChange !== undefined && target.kind !== 'subagent'

  useEffect(() => {
    if (presentation !== 'immersive') lastRestingPresentation.current = presentation
  }, [presentation])

  useEffect(() => {
    const root = panelRef.current?.closest('.diywx-conversation')
    if (!(root instanceof HTMLElement)) return
    root.dataset.sidePresentation = presentation
    if (presentation === 'docked') {
      root.style.setProperty('--diywx-side-width', `${sideWidth}px`)
      root.style.setProperty('--diywx-side-inset', `${sideInset}px`)
    } else {
      root.style.removeProperty('--diywx-side-width')
      root.style.removeProperty('--diywx-side-inset')
    }
    return () => {
      delete root.dataset.sidePresentation
      root.style.removeProperty('--diywx-side-width')
      root.style.removeProperty('--diywx-side-inset')
    }
  }, [presentation, sideInset, sideWidth])

  useEffect(() => {
    const panel = panelRef.current
    const roomEl = panel?.closest('.diywx-conversation')
    if (!(panel instanceof HTMLElement) || !(roomEl instanceof HTMLElement) || presentation !== 'docked') return
    const apply = (): void => {
      const room = conversationBox(panel)
      if (room.width < MIN_SIDE_WIDTH + MIN_CHAT_WIDTH) return
      const next = clampDocked(sideWidthRef.current, sideInsetRef.current, room.width)
      setSideWidth(current => current === next.width ? current : next.width)
      setSideInset(current => current === next.inset ? current : next.inset)
    }
    apply()
    const observer = new ResizeObserver(apply)
    observer.observe(roomEl)
    return () => { observer.disconnect() }
  }, [presentation])

  useEffect(() => {
    if (presentation !== 'immersive') return
    const active = document.activeElement
    if (active instanceof HTMLElement) active.blur()
    panelRef.current?.querySelector<HTMLButtonElement>('.diywx-immersive-exit')?.focus()
  }, [presentation])

  useEffect(() => {
    if (presentation !== 'immersive' && presentation !== 'mini') return
    const exit = (): void => {
      if (presentation !== 'immersive' && visiblePreviewEditor()) return
      if (presentation === 'immersive') onPresentationChange?.(lastRestingPresentation.current)
      else onPresentationChange?.('docked')
    }
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      if (presentation !== 'immersive' && visiblePreviewEditor(event.target)) return
      event.preventDefault()
      exit()
    }
    const onCustom = (): void => { exit() }
    const onMessage = (event: MessageEvent): void => {
      const data = event.data as { type?: unknown } | null
      if (data?.type !== PREVIEW_ESCAPE_EVENT) return
      exit()
    }
    window.addEventListener('keydown', onKey, true)
    window.addEventListener(PREVIEW_ESCAPE_EVENT, onCustom)
    window.addEventListener('message', onMessage)
    return () => {
      window.removeEventListener('keydown', onKey, true)
      window.removeEventListener(PREVIEW_ESCAPE_EVENT, onCustom)
      window.removeEventListener('message', onMessage)
    }
  }, [onPresentationChange, presentation])

  const persistDocked = (width: number, inset: number): void => {
    writeJson(SIDE_WIDTH_KEY, width)
    writeJson(SIDE_INSET_KEY, inset)
  }

  const startDockedResize = (edge: 'e' | 'w', event: ReactPointerEvent<HTMLButtonElement>): void => {
    if (event.button !== 0) return
    event.preventDefault()
    const panel = panelRef.current
    if (panel === null) return
    const room = conversationBox(panel)
    const origin = { width: sideWidth, inset: sideInset, x: event.clientX }
    event.currentTarget.setPointerCapture(event.pointerId)
    const onMove = (move: PointerEvent): void => {
      if (move.pointerId !== event.pointerId) return
      const delta = move.clientX - origin.x
      const next = edge === 'w'
        ? clampDocked(origin.width - delta, origin.inset, room.width)
        : clampDocked(origin.width + delta, origin.inset - delta, room.width)
      setSideWidth(next.width)
      setSideInset(next.inset)
    }
    const onUp = (up: PointerEvent): void => {
      if (up.pointerId !== event.pointerId) return
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
      persistDocked(sideWidthRef.current, sideInsetRef.current)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
  }

  const startMiniResize = (edge: ResizeEdge, event: ReactPointerEvent<HTMLButtonElement>): void => {
    if (event.button !== 0) return
    event.preventDefault()
    const panel = panelRef.current
    if (panel === null) return
    const room = conversationBox(panel)
    const origin = { ...miniRect, x: event.clientX, y: event.clientY }
    event.currentTarget.setPointerCapture(event.pointerId)
    const onMove = (move: PointerEvent): void => {
      if (move.pointerId !== event.pointerId) return
      const dx = move.clientX - origin.x
      const dy = move.clientY - origin.y
      const next = { ...origin }
      if (edge.includes('w')) next.width = origin.width - dx
      if (edge.includes('e')) {
        next.width = origin.width + dx
        next.right = origin.right - dx
      }
      if (edge.includes('n')) next.height = origin.height - dy
      if (edge.includes('s')) {
        next.height = origin.height + dy
        next.bottom = origin.bottom - dy
      }
      setMiniRect(clampMini(next, room))
    }
    const onUp = (up: PointerEvent): void => {
      if (up.pointerId !== event.pointerId) return
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
      writeJson(MINI_RECT_KEY, miniRectRef.current)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
  }

  const startMiniMove = (event: ReactPointerEvent<HTMLElement>): void => {
    if (event.button !== 0 || presentation !== 'mini') return
    if (event.target instanceof HTMLElement && event.target.closest('button, input')) return
    event.preventDefault()
    const panel = panelRef.current
    if (panel === null) return
    const room = conversationBox(panel)
    const origin = { ...miniRect, x: event.clientX, y: event.clientY }
    const onMove = (move: PointerEvent): void => {
      if (move.pointerId !== event.pointerId) return
      setMiniRect(clampMini({
        ...origin,
        right: origin.right - (move.clientX - origin.x),
        bottom: origin.bottom + (move.clientY - origin.y),
      }, room))
    }
    const onUp = (up: PointerEvent): void => {
      if (up.pointerId !== event.pointerId) return
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
      writeJson(MINI_RECT_KEY, miniRectRef.current)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
  }

  const dockedStyle = presentation === 'docked'
    ? { width: sideWidth, right: sideInset }
    : presentation === 'mini'
      ? { width: miniRect.width, height: miniRect.height, right: miniRect.right, bottom: miniRect.bottom }
      : undefined

  return (
    <aside
      ref={panelRef}
      className="diywx-conversation-side"
      aria-label={title}
      data-presentation={presentation}
      data-immersive={presentation === 'immersive' || undefined}
      style={dockedStyle}
    >
      {presentation === 'docked' && (
        <header>
          <strong>{title}</strong>
          <div className="diywx-side-actions">
            {canChangePresentation && (
              <button
                type="button"
                title="小窗模式"
                aria-label="小窗模式"
                onClick={() => { onPresentationChange('mini') }}
              >
                <span>小窗</span>
              </button>
            )}
            {canChangePresentation && (
              <button
                type="button"
                title="进入沉浸模式"
                aria-label="进入沉浸模式"
                onClick={() => { onPresentationChange('immersive') }}
              >
                <span>沉浸模式</span>⛶
              </button>
            )}
            <button className="diywx-side-close" type="button" title="关闭右侧预览" aria-label="关闭右侧预览" onClick={onClose}><span>关闭</span>×</button>
          </div>
        </header>
      )}
      {presentation === 'mini' && canChangePresentation && (
        <div className="diywx-mini-bar" onPointerDown={startMiniMove}>
          <button
            className="diywx-mini-exit"
            type="button"
            title="退出小窗"
            aria-label="退出小窗"
            onPointerDown={(event) => { event.stopPropagation() }}
            onClick={() => { onPresentationChange('docked') }}
          >
            ×
          </button>
        </div>
      )}
      {presentation === 'immersive' && onPresentationChange !== undefined && (
        <div className="diywx-immersive-bar">
          <button className="diywx-immersive-exit" type="button" title="退出沉浸模式" aria-label="退出沉浸模式" onClick={() => { onPresentationChange(lastRestingPresentation.current) }}>
            ×
          </button>
        </div>
      )}
      {target.kind === 'browser'
        ? <BrowserPreview initialUrl={target.url} fillViewport />
        : target.kind === 'visualization'
          ? <VisualizationPreview title={target.title} fillViewport {...target.html === undefined ? {} : { html: target.html }} {...target.url === undefined ? {} : { url: target.url }} {...target.path === undefined ? {} : { path: target.path }} />
          : <SubagentPreview task={target.task} {...onLoadSubagent === undefined ? {} : { load: onLoadSubagent }} />}
      {presentation === 'docked' && (
        <>
          <button className="diywx-side-resizer" type="button" data-edge="w" aria-label="拖动调整预览左边界" onPointerDown={(event) => { startDockedResize('w', event) }} />
          <button className="diywx-side-resizer" type="button" data-edge="e" aria-label="拖动调整预览右边界" onPointerDown={(event) => { startDockedResize('e', event) }} />
        </>
      )}
      {presentation === 'mini' && (['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'] as const).map(edge => (
        <button key={edge} className="diywx-side-resizer" type="button" data-edge={edge} aria-label="拖动缩放小窗" onPointerDown={(event) => { startMiniResize(edge, event) }} />
      ))}
    </aside>
  )
}
