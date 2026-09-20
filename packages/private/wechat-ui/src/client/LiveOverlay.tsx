import { useEffect, useState } from 'react'
import type { PropsRenderSlots, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { useSessionAttentionMap } from './sessionAttention.ts'
import { sessionFallbackPreview, sessionOutlinePreview } from './sessionListPreview.ts'
import { WechatShellFrame } from './WechatShell.tsx'
import type { AvatarView, NewSessionDraft, SessionItemView, SessionModelView, TokenUsageView, WechatShellFrameProps, WorkspaceGroupView } from './types.ts'
import { readLocalUiMode } from './uiMode.ts'
import './slots.ts'

const SELECTED_SESSION_EVENT = 'diywx-selected-session'

/**
 * Tell the overlay which Session is open so the list highlight and header avatar match it.
 * @param id - Session id selected from the overlay list, a new-session flow, or the official restored chat slot.
 */
export function notifySelectedSession(id: string): void {
  window.dispatchEvent(new CustomEvent(SELECTED_SESSION_EVENT, { detail: id }))
}

function persistedOfficialSessionId(): string | undefined {
  try {
    const raw = localStorage.getItem('dsh.sessions.current')
    if (raw === null) return undefined
    const value = JSON.parse(raw) as { sessionId?: unknown }
    return typeof value.sessionId === 'string' && value.sessionId !== '' ? value.sessionId : undefined
  } catch {
    return undefined
  }
}

const COLLAB_GROUP_WORKSPACE_ID = '__diywx_groups__'
const COLLAB_PRIVATE_WORKSPACE_ID = '__diywx_private__'
const COLLAB_PRIVATE_TITLE_PREFIX = '群聊私聊 · '

function synchronizedWorkspaceId(title: string): string | undefined {
  if (title.startsWith('群聊 · ')) return COLLAB_GROUP_WORKSPACE_ID
  if (title.startsWith(COLLAB_PRIVATE_TITLE_PREFIX)) return COLLAB_PRIVATE_WORKSPACE_ID
  return undefined
}

export interface LiveOverlayInjected {
  currentSessionId?: string
  openSession: (id: string) => void
  openSessionWindow: (id: string) => void
  reorderSession: (workspaceId: string, sessionId: string, beforeSessionId?: string) => Promise<void>
  newSession: (draft: NewSessionDraft) => Promise<string>
  addWorkspace: () => Promise<void>
  openTaskBoard: () => Promise<void>
  openSettings: (section?: string) => Promise<void>
  loadSessionPreviews: WechatShellFrameProps['onLoadSessionPreviews']
  loadSessionModels: (sessionIds: readonly string[]) => Promise<Readonly<Record<string, SessionModelView>>>
  loadSessionUsage: WechatShellFrameProps['onLoadSessionUsage']
  loadPlugins: WechatShellFrameProps['onLoadPlugins']
}

type LiveOverlayProps =
  & PropsRuntime<'shell.overlay'>
  & PropsRenderSlots<'diy.wechat.chat'>
  & LiveOverlayInjected

/** Keep the plugin mounted in native mode so its settings switch remains
 * available, while leaving the original Harness shell completely uncovered. */
export function LocalUiOverlay(props: LiveOverlayProps) {
  if (readLocalUiMode() === 'native') return null
  return <LiveOverlay {...props} />
}

function sessionTime(updatedAt: number): string {
  const date = new Date(updatedAt)
  const today = new Date()
  if (date.toDateString() === today.toDateString()) {
    return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
  }
  return `${date.getMonth() + 1}/${date.getDate()}`
}

function tokenUsageViewOf(value: unknown): TokenUsageView | undefined {
  if (value === null || typeof value !== 'object') return undefined
  const raw = value as Record<string, unknown>
  const buckets = raw.totals !== null && typeof raw.totals === 'object'
    ? raw.totals as Record<string, unknown>
    : raw
  const uncached = buckets.uncachedInputTokens ?? buckets.inputTokens
  const output = buckets.outputTokens
  const cacheRead = buckets.cacheReadTokens ?? 0
  const cacheWrite = buckets.cacheWriteTokens ?? 0
  if (![uncached, output, cacheRead, cacheWrite].every(item => typeof item === 'number' && Number.isFinite(item) && item >= 0)) {
    return undefined
  }
  return {
    uncachedInputTokens: uncached as number,
    outputTokens: output as number,
    cacheReadTokens: cacheRead as number,
    cacheWriteTokens: cacheWrite as number,
  }
}

export function LiveOverlay({
  useSessions,
  useWorkspaces,
  renderSlot,
  currentSessionId: selectedSessionId,
  openSession,
  openSessionWindow,
  reorderSession,
  newSession,
  addWorkspace,
  openTaskBoard,
  openSettings,
  loadSessionPreviews,
  loadSessionModels,
  loadSessionUsage,
  loadPlugins,
}: LiveOverlayProps) {
  const sessionState = useSessions(state => state)
  const workspaceState = useWorkspaces(state => state)
  const [openedSessionId, setOpenedSessionId] = useState(selectedSessionId ?? persistedOfficialSessionId())
  const standaloneSessionId = new URLSearchParams(window.location.search).get('diywxSession') ?? undefined
  const standalone = new URLSearchParams(window.location.search).get('diywxStandalone') === '1'
  useEffect(() => {
    const sync = (event: Event): void => {
      const id = (event as CustomEvent<string>).detail
      if (typeof id === 'string' && id !== '') setOpenedSessionId(id)
    }
    window.addEventListener(SELECTED_SESSION_EVENT, sync)
    return () => { window.removeEventListener(SELECTED_SESSION_EVENT, sync) }
  }, [])
  useEffect(() => {
    if (selectedSessionId !== undefined) setOpenedSessionId(selectedSessionId)
  }, [selectedSessionId])
  useEffect(() => {
    if (standaloneSessionId === undefined || !sessionState.ids.includes(standaloneSessionId as never)) return
    if (selectedSessionId !== standaloneSessionId) openSession(standaloneSessionId)
  }, [openSession, selectedSessionId, sessionState.ids, standaloneSessionId])
  const attention = useSessionAttentionMap()
  const membership = new Map<string, string>()
  for (const workspace of workspaceState.items) {
    for (const sessionId of workspace.sessionIds) membership.set(sessionId, workspace.workspaceId)
  }
  const visibleSessionIds = sessionState.ids.filter(id => sessionState.byId[id]?.origin !== 'subagent')
  const currentSessionId = standaloneSessionId ?? openedSessionId ?? selectedSessionId
  const sessions: SessionItemView[] = visibleSessionIds.map((id) => {
    const summary = sessionState.byId[id]
    const title = summary?.displayTitle ?? summary?.title ?? id
    const workspaceId = synchronizedWorkspaceId(title) ?? membership.get(id)
    const projectionValues = (summary as unknown as { projectionValues?: { tokenUsage?: unknown; turnOutline?: unknown } } | undefined)?.projectionValues
    const rawUsage = projectionValues?.tokenUsage
    const validUsage = tokenUsageViewOf(rawUsage)
    const conversationPreview = sessionOutlinePreview(projectionValues?.turnOutline)
    const row = attention[id]
    return {
      id,
      title,
      preview: sessionFallbackPreview({
        running: summary?.running,
        blank: summary?.blank,
        awaitingQuestion: row?.awaitingQuestion,
      }),
      ...(conversationPreview === undefined ? {} : { conversationPreview }),
      time: sessionTime(summary?.updatedAt ?? Date.now()),
      updatedAt: summary?.updatedAt ?? Date.now(),
      ...(workspaceId === undefined ? {} : { workspaceId }),
      ...(summary?.running === undefined ? {} : { running: summary.running }),
      ...(row?.completed === true ? { completed: true } : {}),
      ...(row?.unread === true ? { unread: true } : {}),
      ...(validUsage === undefined ? {} : { usage: validUsage }),
    }
  })
  const synchronizedSessionIds = new Set(sessions
    .filter(session => session.workspaceId === COLLAB_GROUP_WORKSPACE_ID || session.workspaceId === COLLAB_PRIVATE_WORKSPACE_ID)
    .map(session => session.id))
  const groupSessionIds = sessions.filter(session => session.workspaceId === COLLAB_GROUP_WORKSPACE_ID).map(session => session.id)
  const privateSessionIds = sessions.filter(session => session.workspaceId === COLLAB_PRIVATE_WORKSPACE_ID).map(session => session.id)
  const workspaces: WorkspaceGroupView[] = [
    ...workspaceState.items.map(workspace => ({
      id: workspace.workspaceId,
      title: workspace.title,
      path: workspace.path,
      sessionIds: workspace.sessionIds.filter((id: (typeof sessionState.ids)[number]) => sessionState.byId[id]?.origin !== 'subagent' && !synchronizedSessionIds.has(id)),
    })),
    ...(groupSessionIds.length === 0 ? [] : [{
      id: COLLAB_GROUP_WORKSPACE_ID,
      title: '群聊',
      path: '本机 Desktop 群聊入口同步的多人会话',
      sessionIds: groupSessionIds,
      virtual: true,
    }]),
    ...(privateSessionIds.length === 0 ? [] : [{
      id: COLLAB_PRIVATE_WORKSPACE_ID,
      title: '同事私聊',
      path: '其他账号在本机群聊入口创建的私人会话',
      sessionIds: privateSessionIds,
      virtual: true,
    }]),
  ]
  return (
    <WechatShellFrame
      sessions={sessions}
      workspaces={workspaces}
      archivedSessionIds={workspaceState.archivedSessionIds}
      {...(currentSessionId === undefined ? {} : { currentSessionId })}
      workspaceCount={workspaces.length}
      standalone={standalone}
      onOpenSession={openSession}
      onOpenSessionWindow={openSessionWindow}
      onReorderSession={reorderSession}
      onNewSession={newSession}
      onAddWorkspace={addWorkspace}
      onOpenTaskBoard={openTaskBoard}
      onOpenSettings={openSettings}
      onLoadSessionPreviews={loadSessionPreviews}
      onLoadSessionModels={loadSessionModels}
      onLoadSessionUsage={loadSessionUsage}
      onLoadPlugins={loadPlugins}
      onLoadServices={async () => {
        const response = await fetch('/api/diy-services', { headers: { accept: 'application/json' } })
        const text = await response.text()
        let value: { services?: import('./types.ts').DshServiceView[]; error?: string } = {}
        try { value = JSON.parse(text) as typeof value } catch {
          if (response.status === 404) throw new Error('运行服务后台尚未生效，请重启 DSH 后再试')
          throw new Error(`运行服务接口返回异常（${response.status}）`)
        }
        if (!response.ok || value.services === undefined) throw new Error(value.error ?? '运行服务读取失败')
        return value.services
      }}
      onStopService={async (id) => {
        const response = await fetch(`/api/diy-services/${encodeURIComponent(id)}/stop`, { method: 'POST' })
        const text = await response.text()
        let value: { error?: string } = {}
        try { value = JSON.parse(text) as typeof value } catch {
          if (response.status === 404) throw new Error('运行服务后台尚未生效，请重启 DSH 后再试')
          throw new Error(`服务关闭接口返回异常（${response.status}）`)
        }
        if (!response.ok) throw new Error(value.error ?? '服务关闭失败')
      }}
      renderConversation={(avatar: AvatarView, userAvatar: AvatarView, subtitle, onSubtitleChange, onAvatarPreview, workspaceLabel) => renderSlot('diy.wechat.chat', {
        avatar,
        userAvatar,
        ...(subtitle === undefined ? {} : { subtitle }),
        ...(workspaceLabel === undefined ? {} : { workspaceLabel }),
        onSubtitleChange,
        onAvatarPreview,
      })}
    />
  )
}
