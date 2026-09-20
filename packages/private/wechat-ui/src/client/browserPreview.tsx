import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { fitPreviewScale, PREVIEW_PAGE_HEIGHT, PREVIEW_PAGE_WIDTH } from './previewFit.ts'

const PREVIEW_PARTITION = 'persist:diywx-preview'
const PREVIEW_ESCAPE = 'diywx-preview-escape'

export const PREVIEW_ESCAPE_EVENT = 'diywx-escape'

interface PreviewWebviewElement extends HTMLElement {
  src: string
  getURL?: () => string
  setZoomFactor?: (factor: number) => void
}

type GuestFailEvent = Event & { errorCode?: number; isMainFrame?: boolean }
type GuestNavigateEvent = Event & { url?: string }

function desktopPreviewGuest(): boolean {
  return navigator.userAgent.includes('Electron')
}

function browseProxyUrl(url: string): string {
  return `/api/diy-browse?url=${encodeURIComponent(url)}`
}

function openIndependent(url: string): void {
  window.open(url, '_blank', 'noopener,noreferrer')?.focus()
}

function PreviewGuest({
  useWebview,
  frameSrc,
  revision,
  url,
  fillViewport,
  scale,
  viewportSize,
  onReady,
  onFail,
  onNavigate,
  webviewRef,
  iframeRef,
}: {
  useWebview: boolean
  frameSrc: string
  revision: number
  url: string
  fillViewport: boolean
  scale: number
  viewportSize: { width: number; height: number }
  onReady: () => void
  onFail: (event?: Event) => void
  onNavigate: (event: Event) => void
  webviewRef: { current: PreviewWebviewElement | null }
  iframeRef: { current: HTMLIFrameElement | null }
}): ReactNode {
  // Electron webview keeps the guest viewport at the first used size; a %
  // height taken on the first paint (often ~150px) never follows the panel.
  const guestStyle: CSSProperties = fillViewport
    ? { display: 'flex', width: Math.max(1, viewportSize.width), height: Math.max(1, viewportSize.height) }
    : useWebview
      ? { width: PREVIEW_PAGE_WIDTH * scale, height: PREVIEW_PAGE_HEIGHT * scale }
      : { width: PREVIEW_PAGE_WIDTH, height: PREVIEW_PAGE_HEIGHT }

  useEffect(() => {
    const webview = webviewRef.current
    if (webview === null) return
    webview.addEventListener('did-stop-loading', onReady)
    webview.addEventListener('did-fail-load', onFail)
    webview.addEventListener('did-navigate', onNavigate)
    webview.addEventListener('did-navigate-in-page', onNavigate)
    return () => {
      webview.removeEventListener('did-stop-loading', onReady)
      webview.removeEventListener('did-fail-load', onFail)
      webview.removeEventListener('did-navigate', onNavigate)
      webview.removeEventListener('did-navigate-in-page', onNavigate)
    }
  }, [frameSrc, onFail, onNavigate, onReady, revision, useWebview, webviewRef])

  useEffect(() => {
    const webview = webviewRef.current
    if (webview === null) return
    const zoom = fillViewport ? 1 : scale
    const applyZoom = (): void => {
      try { webview.setZoomFactor?.(zoom) } catch (zoomError) { void zoomError }
    }
    applyZoom()
    webview.addEventListener('dom-ready', applyZoom)
    return () => { webview.removeEventListener('dom-ready', applyZoom) }
  }, [fillViewport, scale, revision, useWebview, webviewRef])

  useEffect(() => {
    const webview = webviewRef.current
    if (webview === null || !fillViewport) return
    webview.style.width = `${Math.max(1, viewportSize.width)}px`
    webview.style.height = `${Math.max(1, viewportSize.height)}px`
  }, [fillViewport, useWebview, viewportSize.height, viewportSize.width, webviewRef])

  useEffect(() => {
    if (useWebview) return
    const frame = iframeRef.current
    if (frame === null) return
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      window.dispatchEvent(new CustomEvent(PREVIEW_ESCAPE_EVENT, { detail: PREVIEW_ESCAPE }))
    }
    const attach = (): void => {
      try { frame.contentWindow?.addEventListener('keydown', onKey, true) } catch { /* cross-origin guest */ }
    }
    attach()
    frame.addEventListener('load', attach)
    return () => {
      frame.removeEventListener('load', attach)
      try { frame.contentWindow?.removeEventListener('keydown', onKey, true) } catch { /* guest navigated */ }
    }
  }, [frameSrc, iframeRef, revision, useWebview])

  if (useWebview) {
    return (
      <webview
        ref={(element) => { webviewRef.current = element as PreviewWebviewElement | null }}
        key={`${frameSrc}-${revision}`}
        src={frameSrc}
        title={`网页预览 ${url}`}
        partition={PREVIEW_PARTITION}
        allowpopups="on"
        webpreferences="contextIsolation=yes, sandbox=yes, javascript=yes"
        style={guestStyle}
      />
    )
  }
  return (
    <iframe
      ref={iframeRef}
      key={`${frameSrc}-${revision}`}
      src={frameSrc}
      title={`网页预览 ${url}`}
      style={guestStyle}
      sandbox="allow-forms allow-modals allow-popups allow-same-origin allow-scripts allow-downloads"
      onLoad={onReady}
      onError={onFail}
    />
  )
}

export function BrowserPreview({
  initialUrl,
  fillViewport = false,
}: {
  initialUrl: string
  fillViewport?: boolean
}) {
  const viewportRef = useRef<HTMLDivElement | null>(null)
  const iframeRef = useRef<HTMLIFrameElement | null>(null)
  const webviewRef = useRef<PreviewWebviewElement | null>(null)
  const [size, setSize] = useState({ width: 0, height: 0 })
  const [url, setUrl] = useState(initialUrl)
  const [draft, setDraft] = useState(initialUrl)
  const [revision, setRevision] = useState(0)
  const electronGuest = desktopPreviewGuest()
  const useWebview = electronGuest && fillViewport
  const [frameSrc, setFrameSrc] = useState(() => useWebview ? initialUrl : browseProxyUrl(initialUrl))
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const scale = fillViewport ? 1 : fitPreviewScale(size.width, size.height)

  useEffect(() => {
    setUrl(initialUrl)
    setDraft(initialUrl)
    setFrameSrc(useWebview ? initialUrl : browseProxyUrl(initialUrl))
    setError(null)
    setLoading(true)
  }, [initialUrl, useWebview])

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

  useEffect(() => {
    setFrameSrc(useWebview ? url : browseProxyUrl(url))
  }, [url, useWebview, revision])

  const onReady = (): void => { setLoading(false) }
  const onFail = (event?: Event): void => {
    const failed = event as GuestFailEvent | undefined
    if (failed?.isMainFrame === false) return
    setLoading(false)
    setError('这个页面无法在预览里打开，可改用独立标签页。')
  }
  const onNavigate = (event: Event): void => {
    const webview = webviewRef.current
    const next = (event as GuestNavigateEvent).url ?? webview?.getURL?.()
    if (typeof next !== 'string' || next === '') return
    setUrl(next)
    setDraft(next)
  }

  const applyUrl = (): void => {
    try {
      const parsed = new URL(draft.trim())
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return
      setUrl(parsed.href)
      setDraft(parsed.href)
      setFrameSrc(useWebview ? parsed.href : browseProxyUrl(parsed.href))
      setError(null)
      setLoading(true)
      setRevision(value => value + 1)
    } catch {
      return
    }
  }

  const sized = size.width > 0 && size.height > 0
  const guest = (
    <PreviewGuest
      useWebview={useWebview}
      frameSrc={frameSrc}
      revision={revision}
      url={url}
      fillViewport={fillViewport}
      scale={scale}
      viewportSize={size}
      onReady={onReady}
      onFail={onFail}
      onNavigate={onNavigate}
      webviewRef={webviewRef}
      iframeRef={iframeRef}
    />
  )

  return (
    <div className="diywx-browser-preview" data-fill={fillViewport || undefined}>
      <form className="diywx-side-browser-bar" onSubmit={(event) => { event.preventDefault(); applyUrl() }}>
        <span aria-hidden="true">{loading ? '○' : '●'}</span>
        <input value={draft} onChange={(event) => { setDraft(event.target.value) }} aria-label="预览网址" spellCheck={false} />
        <button type="button" title="刷新预览" aria-label="刷新预览" onClick={() => { setError(null); setLoading(true); setRevision(value => value + 1) }}>↻</button>
        <button type="button" title="独立标签页打开" aria-label="独立标签页打开" onClick={() => { openIndependent(url) }}>↗</button>
      </form>
      {!fillViewport && (
        <div className="diywx-browser-resolution">
          <span>整页缩略 {PREVIEW_PAGE_WIDTH} × {PREVIEW_PAGE_HEIGHT}</span>
          <span>{Math.round(scale * 100)}%</span>
        </div>
      )}
      <div ref={viewportRef} className="diywx-browser-viewport">
        {fillViewport ? (sized ? guest : null) : (
          <div className="diywx-browser-stage">
            <div
              className="diywx-browser-canvas"
              style={{ width: PREVIEW_PAGE_WIDTH * scale, height: PREVIEW_PAGE_HEIGHT * scale }}
            >
              {useWebview ? guest : (
                <div
                  className="diywx-browser-scaler"
                  style={{ width: PREVIEW_PAGE_WIDTH, height: PREVIEW_PAGE_HEIGHT, transform: `scale(${scale})` }}
                >
                  {guest}
                </div>
              )}
            </div>
          </div>
        )}
        {error !== null && (
          <div className="diywx-browser-blocked" role="alert">
            <strong>无法嵌入这个网页</strong>
            <p>{error}</p>
            <div>
              <button type="button" onClick={() => { setError(null); setFrameSrc(browseProxyUrl(url)); setRevision(value => value + 1) }}>改用预览通道</button>
              <button type="button" onClick={() => { openIndependent(url) }}>独立打开</button>
            </div>
          </div>
        )}
      </div>
      <p className="diywx-browser-hint">
        预览按当前窗口显示页面，拖动边界会跟着重排。部分网站禁止嵌入；打不开时用独立标签页。按 Esc 可退出沉浸模式。
      </p>
    </div>
  )
}

function visibleEditingField(target: EventTarget | null = document.activeElement): boolean {
  if (!(target instanceof HTMLElement)) return false
  if (target.closest('input, textarea, select, [contenteditable="true"]') === null) return false
  const style = getComputedStyle(target)
  if (style.display === 'none' || style.visibility === 'hidden') return false
  return target.getClientRects().length > 0
}

/**
 * True when a visible text field currently owns keyboard input.
 * @param target - event target or the active element.
 */
export function visiblePreviewEditor(target: EventTarget | null = document.activeElement): boolean {
  return visibleEditingField(target)
}

/**
 * Forward an Escape key from the overlay or an embedded preview guest.
 * @param event - capture-phase keyboard event.
 * @returns whether the overlay should leave the current preview presentation.
 */
export function dispatchPreviewEscape(event: KeyboardEvent): boolean {
  if (event.key !== 'Escape') return false
  if (visibleEditingField(event.target)) return false
  event.preventDefault()
  window.dispatchEvent(new CustomEvent(PREVIEW_ESCAPE_EVENT, { detail: PREVIEW_ESCAPE }))
  return true
}
