import { useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from 'react'
import { AvatarBadge, AvatarEditor, AvatarPreview, defaultAvatar } from './Avatar.tsx'
import { Icon } from './icons.tsx'
import { MessageRecycleBin } from './MessageRecycleBin.tsx'
import { PluginCenter } from './PluginCenter.tsx'
import { SkillInventory } from './SkillInventory.tsx'
import { ServiceManager } from './ServiceManager.tsx'
import { loadMessageRecycleState, MESSAGE_RECYCLE_EVENT, type MessageRecycleState } from './messageRecycle.ts'
import { NewSessionDialog } from './NewSessionDialog.tsx'
import { registerAutoMetadata, SESSION_SUBTITLE_EVENT, SESSION_SUBTITLE_STORAGE_KEY } from './sessionMeta.ts'
import { sessionRowPreview } from './sessionListPreview.ts'
import { UsageDashboard } from './UsageDashboard.tsx'
import type { AvatarView, DshServiceView, SessionItemView, SessionModelView, WechatShellFrameProps, WorkspaceGroupView } from './types.ts'

const AVATAR_STORAGE_KEY = 'dsh-diy-lab.session-avatars.v1'
const USER_AVATAR_STORAGE_KEY = 'dsh-diy-lab.user-avatar.v1'
const USER_PROFILE_STORAGE_KEY = 'dsh-diy-lab.user-profile.v1'
const NOTE_STORAGE_KEY = 'dsh-diy-lab.pinned-note.v1'
const PINNED_STORAGE_KEY = 'dsh-diy-lab.pinned-sessions.v1'
const ARCHIVED_STORAGE_KEY = 'dsh-diy-lab.archived-sessions.v1'
const HIDDEN_STORAGE_KEY = 'dsh-diy-lab.hidden-sessions.v1'
const SESSION_ORDER_STORAGE_KEY = 'dsh-diy-lab.session-order.v1'
const RAIL_ORDER_STORAGE_KEY = 'dsh-diy-lab.rail-order.v1'
const HIDDEN_RAIL_STORAGE_KEY = 'dsh-diy-lab.hidden-rail-items.v1'
const UNREAD_STORAGE_KEY = 'dsh-diy-lab.manual-unread-sessions.v1'
const SESSION_VIEW_STORAGE_KEY = 'dsh-diy-lab.session-view.v1'
const SESSION_PANEL_COLLAPSED_STORAGE_KEY = 'dsh-diy-lab.session-panel-collapsed.v1'
const SESSION_PANEL_WIDTH_STORAGE_KEY = 'dsh-diy-lab.session-panel-width.v1'
const SESSION_PANEL_COLLAPSED_WIDTH = 78
const SESSION_PANEL_MIN_EXPANDED = 240
const SESSION_PANEL_MAX_WIDTH = 440
const SESSION_PANEL_DEFAULT_WIDTH = 322
const SESSION_PANEL_COLLAPSE_THRESHOLD = 200
const SESSION_PANEL_RESIZE_STEP = 16
const UNGROUPED_ID = '__ungrouped__'
const DEFAULT_USER_AVATAR: AvatarView = { color: '#2f6bff', glyph: 'whale' }

const RAIL_ITEMS = [
  { id: 'conversation', icon: 'chat', label: '当前对话' },
  { id: 'archived', icon: 'archive', label: '已归档会话' },
  { id: 'skills', icon: 'skill', label: '技能清单' },
  { id: 'message-trash', icon: 'trash', label: '聊天记录回收站' },
  { id: 'services', icon: 'server', label: '运行服务' },
  { id: 'tasks', icon: 'board', label: '任务看板' },
  { id: 'workspace', icon: 'folder-plus', label: '添加工作区' },
  { id: 'mode', icon: 'mode', label: '模式切换' },
  { id: 'model', icon: 'model', label: '模型切换' },
  { id: 'plugin-settings', icon: 'settings', label: '插件管理' },
  { id: 'plugins', icon: 'plugin', label: '插件商店' },
  { id: 'web-ui', icon: 'code', label: 'Web UI 插件' },
  { id: 'skins', icon: 'palette', label: '皮肤中心' },
  { id: 'pet', icon: 'pet', label: '宠物' },
] as const

type RailItem = typeof RAIL_ITEMS[number]
type RailId = RailItem['id']
type SessionView = 'workspace' | 'recent'

interface SessionGroup {
  id: string
  title: string
  path?: string
  workspaceId?: string
  virtual?: boolean
  sessions: SessionItemView[]
}

interface ContextMenuState {
  session: SessionItemView
  x: number
  y: number
}

interface SessionProfileState {
  session: SessionItemView
  left: number
  top: number
}

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    return raw === null ? fallback : JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

function writeJson(key: string, value: unknown): void {
  try { localStorage.setItem(key, JSON.stringify(value)) } catch { /* keep the current in-memory customization */ }
}

/**
 * Clamp the session list to the collapsed avatar column or the expanded range.
 * @param width - Pointer or keyboard width in CSS pixels.
 * @returns 78 when dragged through the collapse threshold, otherwise 240–440.
 */
function normalizeSessionPanelWidth(width: number): number {
  if (!Number.isFinite(width)) return SESSION_PANEL_DEFAULT_WIDTH
  const next = Math.round(width)
  if (next <= SESSION_PANEL_COLLAPSE_THRESHOLD) return SESSION_PANEL_COLLAPSED_WIDTH
  return Math.min(SESSION_PANEL_MAX_WIDTH, Math.max(SESSION_PANEL_MIN_EXPANDED, next))
}

function loadSessionPanelWidth(): number {
  const stored = readJson<unknown>(SESSION_PANEL_WIDTH_STORAGE_KEY, null)
  if (typeof stored === 'number') return normalizeSessionPanelWidth(stored)
  return readJson<boolean>(SESSION_PANEL_COLLAPSED_STORAGE_KEY, false)
    ? SESSION_PANEL_COLLAPSED_WIDTH
    : SESSION_PANEL_DEFAULT_WIDTH
}

function persistSessionPanelWidth(width: number): void {
  writeJson(SESSION_PANEL_WIDTH_STORAGE_KEY, width)
  writeJson(SESSION_PANEL_COLLAPSED_STORAGE_KEY, width <= SESSION_PANEL_COLLAPSED_WIDTH)
}

function loadAvatars(): Record<string, AvatarView> {
  return readJson<Record<string, AvatarView>>(AVATAR_STORAGE_KEY, {})
}

function loadUserAvatar(): AvatarView {
  return readJson<AvatarView>(USER_AVATAR_STORAGE_KEY, DEFAULT_USER_AVATAR)
}

function loadSubtitles(): Record<string, string> {
  return readJson<Record<string, string>>(SESSION_SUBTITLE_STORAGE_KEY, {})
}

function loadRailOrder(): RailId[] {
  const known = new Set<RailId>(RAIL_ITEMS.map(item => item.id))
  const stored = readJson<string[]>(RAIL_ORDER_STORAGE_KEY, []).filter((id): id is RailId => known.has(id as RailId))
  const next = [...stored]
  for (const item of RAIL_ITEMS) {
    if (next.includes(item.id)) continue
    if (item.id === 'skills') {
      const after = next.indexOf('archived')
      next.splice(after >= 0 ? after + 1 : next.length, 0, item.id)
      continue
    }
    next.push(item.id)
  }
  return next
}

function skillCwdOf(sessionId: string | undefined, workspaces: readonly WorkspaceGroupView[]): string | undefined {
  if (sessionId === undefined) return undefined
  const workspace = workspaces.find(item => item.sessionIds.includes(sessionId))
  if (workspace === undefined || workspace.virtual === true) return undefined
  if (!workspace.path.startsWith('/') && !/^[A-Za-z]:[\\/]/u.test(workspace.path)) return undefined
  return workspace.path
}

function timeLabel(value: string): string {
  return value.length > 5 ? value.slice(-5) : value
}

function sessionTimeLabel(session: SessionItemView): string {
  const explicit = String(session.time ?? '').trim()
  if (explicit !== '') return timeLabel(explicit)
  if (session.updatedAt === undefined || !Number.isFinite(session.updatedAt)) return '—'
  const date = new Date(session.updatedAt)
  const today = new Date()
  if (date.toDateString() === today.toDateString()) {
    return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
  }
  return `${date.getMonth() + 1}/${date.getDate()}`
}

function profileDate(value: number | undefined): string {
  if (value === undefined || !Number.isFinite(value)) return '暂无记录'
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  }).format(new Date(value))
}

function profileTokens(session: SessionItemView): string {
  const usage = session.usage
  if (usage === undefined) return '0 tokens'
  const total = usage.uncachedInputTokens + usage.outputTokens + usage.cacheReadTokens + usage.cacheWriteTokens
  return `${total.toLocaleString('zh-CN')} tokens`
}

function loadSessionView(): SessionView {
  return readJson<string>(SESSION_VIEW_STORAGE_KEY, 'workspace') === 'recent' ? 'recent' : 'workspace'
}

function syncLocalCollaborationUi(payload: unknown): void {
  window.dispatchEvent(new CustomEvent('diywx-ui-profile-change', { detail: payload }))
  void fetch('http://127.0.0.1:3191/api/local-ui-sync', {
    method: 'POST',
    mode: 'cors',
    headers: {
      'content-type': 'application/json',
      'x-dsh-ui-sync': 'v1',
    },
    body: JSON.stringify(payload),
  }).catch(() => {
    // Group chat sidecar is optional. Local Desktop chat must remain usable when it is off.
  })
}

export function WechatShellFrame({
  sessions,
  workspaces,
  archivedSessionIds = [],
  currentSessionId,
  workspaceCount,
  standalone = false,
  multiplayerEnabled = false,
  onOpenSession,
  onOpenSessionWindow,
  onReorderSession,
  onNewSession,
  onAddWorkspace,
  onOpenTaskBoard,
  onOpenSettings,
  onLoadSessionPreviews,
  onLoadSessionModels,
  onLoadSessionUsage,
  onLoadPlugins,
  onLoadSkills,
  onInstallSkill,
  onLoadServices,
  onStopService,
  renderConversation,
}: WechatShellFrameProps) {
  const [query, setQuery] = useState('')
  const [note, setNote] = useState(() => localStorage.getItem(NOTE_STORAGE_KEY) ?? '下一步：把常用工作流变成像聊天一样简单')
  const [editingNote, setEditingNote] = useState(false)
  const [avatars, setAvatars] = useState<Record<string, AvatarView>>(loadAvatars)
  const [userAvatar, setUserAvatar] = useState<AvatarView>(loadUserAvatar)
  const [userProfile, setUserProfile] = useState<{ name: string; signature: string }>(() => readJson(USER_PROFILE_STORAGE_KEY, {
    name: '我',
    signature: '把复杂的事情，聊着做完。',
  }))
  const [editingAvatar, setEditingAvatar] = useState<SessionItemView | null>(null)
  const [viewingAvatar, setViewingAvatar] = useState<SessionItemView | null>(null)
  const [editingUserAvatar, setEditingUserAvatar] = useState(false)
  const [subtitles, setSubtitles] = useState<Record<string, string>>(loadSubtitles)
  const [pinnedIds, setPinnedIds] = useState<string[]>(() => readJson(PINNED_STORAGE_KEY, []))
  const [localArchivedIds, setLocalArchivedIds] = useState<string[]>(() => readJson(ARCHIVED_STORAGE_KEY, []))
  const [hiddenIds, setHiddenIds] = useState<string[]>(() => readJson(HIDDEN_STORAGE_KEY, []))
  const [sessionOrders, setSessionOrders] = useState<Record<string, string[]>>(() => readJson(SESSION_ORDER_STORAGE_KEY, {}))
  const [railOrder, setRailOrder] = useState<RailId[]>(loadRailOrder)
  const [hiddenRailIds, setHiddenRailIds] = useState<string[]>(() => readJson(HIDDEN_RAIL_STORAGE_KEY, []))
  const [manualUnreadIds, setManualUnreadIds] = useState<string[]>(() => readJson(UNREAD_STORAGE_KEY, []))
  // A completed/idle session that already existed when the page opened is a
  // baseline, not a new notification. Removing these ids while a run is active
  // lets the existing completion badge still fire for runs observed in this
  // browser session without recreating every badge after a refresh.
  const [acknowledgedCompletedIds, setAcknowledgedCompletedIds] = useState<string[]>(() => sessions
    .filter(session => session.completed === true)
    .map(session => session.id))
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({})
  const [toast, setToast] = useState<string | null>(null)
  const [rail, setRail] = useState<RailId | 'settings'>('conversation')
  const [draggedRail, setDraggedRail] = useState<RailId | null>(null)
  const [draggedSession, setDraggedSession] = useState<{ id: string; groupId: string } | null>(null)
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null)
  const [sessionProfile, setSessionProfile] = useState<SessionProfileState | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<SessionItemView | null>(null)
  const [railTooltip, setRailTooltip] = useState<{ label: string; top: number } | null>(null)
  const [usageOpen, setUsageOpen] = useState(false)
  const [usageModels, setUsageModels] = useState<Readonly<Record<string, SessionModelView>>>({})
  const [usageLoading, setUsageLoading] = useState(false)
  const [usageError, setUsageError] = useState<string | undefined>()
  const [newSessionOpen, setNewSessionOpen] = useState(false)
  const [sessionView, setSessionView] = useState<SessionView>(loadSessionView)
  const [sessionPanelWidth, setSessionPanelWidth] = useState(loadSessionPanelWidth)
  const [sessionPanelResizing, setSessionPanelResizing] = useState(false)
  const sessionPanelWidthRef = useRef(sessionPanelWidth)
  const sessionPanelResizeRef = useRef<{ pointerId: number; left: number } | null>(null)
  const sessionPanelCollapsed = sessionPanelWidth <= SESSION_PANEL_COLLAPSED_WIDTH
  sessionPanelWidthRef.current = sessionPanelWidth

  const applySessionPanelWidth = (width: number, persist: boolean): void => {
    const next = normalizeSessionPanelWidth(width)
    sessionPanelWidthRef.current = next
    setSessionPanelWidth(next)
    if (persist) persistSessionPanelWidth(next)
  }
  const [conversationPreviews, setConversationPreviews] = useState<Readonly<Record<string, string>>>({})
  const [messageRecycle, setMessageRecycle] = useState<MessageRecycleState>(loadMessageRecycleState)
  const [messageRecycleOpen, setMessageRecycleOpen] = useState(false)
  const [pluginCenterOpen, setPluginCenterOpen] = useState(false)
  const [skillInventoryOpen, setSkillInventoryOpen] = useState(false)
  const skillCwd = skillCwdOf(currentSessionId, workspaces)
  const [serviceManagerOpen, setServiceManagerOpen] = useState(false)
  const [services, setServices] = useState<readonly DshServiceView[]>([])
  const [servicesLoading, setServicesLoading] = useState(false)
  const [servicesError, setServicesError] = useState<string>()
  const [railPointer, setRailPointer] = useState<{ id: RailId; pointerId: number; startY: number; moved: boolean } | null>(null)
  const suppressRailClick = useRef(false)
  const loadServicesRef = useRef(onLoadServices)
  const stopServiceRef = useRef(onStopService)

  useEffect(() => { loadServicesRef.current = onLoadServices }, [onLoadServices])
  useEffect(() => { stopServiceRef.current = onStopService }, [onStopService])

  const refreshServices = async (visible = true): Promise<void> => {
    const load = loadServicesRef.current
    if (load === undefined) return
    if (visible) setServicesLoading(true)
    try {
      setServices(await load())
      setServicesError(undefined)
    } catch (reason) {
      if (visible) setServicesError(reason instanceof Error ? reason.message : '运行服务读取失败')
    } finally {
      if (visible) setServicesLoading(false)
    }
  }

  useEffect(() => {
    if (loadServicesRef.current === undefined) return
    void refreshServices(false)
    const timer = window.setInterval(() => { void refreshServices(false) }, 7000)
    return () => { window.clearInterval(timer) }
  }, [])

  useEffect(() => {
    if (toast === null) return
    const timer = window.setTimeout(() => { setToast(null) }, 2500)
    return () => { window.clearTimeout(timer) }
  }, [toast])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      syncLocalCollaborationUi({
        ...(localStorage.getItem(USER_AVATAR_STORAGE_KEY) !== null ? { userAvatar } : {}),
        ...(localStorage.getItem(USER_PROFILE_STORAGE_KEY) !== null ? { userProfile } : {}),
        sessionAvatars: avatars,
        subtitles,
        ...(localStorage.getItem(NOTE_STORAGE_KEY) !== null ? { pinnedNote: note } : {}),
        ...(localStorage.getItem(HIDDEN_RAIL_STORAGE_KEY) !== null ? { hiddenRailIds } : {}),
        ...(localStorage.getItem(RAIL_ORDER_STORAGE_KEY) !== null ? { railOrder } : {}),
        ...(localStorage.getItem(PINNED_STORAGE_KEY) !== null ? { pinnedSessionIds: pinnedIds } : {}),
        ...(localStorage.getItem(SESSION_VIEW_STORAGE_KEY) !== null ? { sessionView } : {}),
      })
    }, 800)
    return () => { window.clearTimeout(timer) }
  }, [avatars, hiddenRailIds, note, pinnedIds, railOrder, sessionView, subtitles, userAvatar, userProfile])

  const previewRefreshKey = sessions.map(session => `${session.id}:${session.updatedAt ?? 0}`).join('|')
  useEffect(() => {
    if (sessions.length === 0) return
    let live = true
    void onLoadSessionPreviews(sessions.map(session => session.id)).then((previews) => {
      if (live) setConversationPreviews(previews)
    }).catch(() => { /* keep the host status preview when history is temporarily unavailable */ })
    return () => { live = false }
  // Hosts may pass an inline loader. Its changing function identity is not
  // session data and used to create repeated LAN fetch/render loops.
  }, [previewRefreshKey])

  useEffect(() => {
    if (contextMenu === null) return
    const close = (event: KeyboardEvent): void => { if (event.key === 'Escape') setContextMenu(null) }
    window.addEventListener('keydown', close)
    return () => { window.removeEventListener('keydown', close) }
  }, [contextMenu])

  useEffect(() => {
    const update = (event: Event): void => {
      const detail = (event as CustomEvent<string[]>).detail
      setHiddenRailIds(Array.isArray(detail) ? detail : readJson(HIDDEN_RAIL_STORAGE_KEY, []))
    }
    window.addEventListener('diywx-rail-visibility', update)
    return () => { window.removeEventListener('diywx-rail-visibility', update) }
  }, [])

  useEffect(() => {
    const refresh = (): void => { setMessageRecycle(loadMessageRecycleState()) }
    window.addEventListener(MESSAGE_RECYCLE_EVENT, refresh)
    const timer = window.setInterval(refresh, 60 * 60 * 1000)
    return () => {
      window.removeEventListener(MESSAGE_RECYCLE_EVENT, refresh)
      window.clearInterval(timer)
    }
  }, [])

  useEffect(() => {
    const update = (event: Event): void => {
      const detail = (event as CustomEvent<unknown>).detail
      if (detail === null || typeof detail !== 'object') return
      const value = detail as { sessionId?: unknown; subtitle?: unknown }
      if (typeof value.sessionId !== 'string' || typeof value.subtitle !== 'string') return
      setSubtitles(previous => ({ ...previous, [value.sessionId as string]: value.subtitle as string }))
    }
    window.addEventListener(SESSION_SUBTITLE_EVENT, update)
    return () => { window.removeEventListener(SESSION_SUBTITLE_EVENT, update) }
  }, [])

  const nativeArchived = useMemo(() => new Set(archivedSessionIds), [archivedSessionIds])
  const archived = useMemo(() => new Set([...archivedSessionIds, ...localArchivedIds]), [archivedSessionIds, localArchivedIds])
  const pinned = useMemo(() => new Set(pinnedIds), [pinnedIds])
  const hidden = useMemo(() => new Set(hiddenIds), [hiddenIds])
  const manualUnread = useMemo(() => new Set(manualUnreadIds), [manualUnreadIds])
  const acknowledgedCompleted = useMemo(() => new Set(acknowledgedCompletedIds), [acknowledgedCompletedIds])
  const unread = useMemo(() => new Set(sessions
    .filter(session => session.unread === true || manualUnread.has(session.id) || (session.completed === true && !acknowledgedCompleted.has(session.id)))
    .map(session => session.id)), [acknowledgedCompleted, manualUnread, sessions])
  const showArchived = rail === 'archived'

  useEffect(() => {
    setAcknowledgedCompletedIds(previous => previous.filter(id => sessions.find(session => session.id === id)?.completed === true))
  }, [sessions])

  const currentCompleted = currentSessionId === undefined
    ? false
    : sessions.find(session => session.id === currentSessionId)?.completed === true
  useEffect(() => {
    if (currentSessionId === undefined) return
    setManualUnreadIds((previous) => {
      if (!previous.includes(currentSessionId)) return previous
      const next = previous.filter(id => id !== currentSessionId)
      writeJson(UNREAD_STORAGE_KEY, next)
      return next
    })
    if (currentCompleted) {
      setAcknowledgedCompletedIds(previous => [...new Set([...previous, currentSessionId])])
    }
  }, [currentCompleted, currentSessionId])

  const filtered = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase()
    return sessions.filter((session) => {
      if (hidden.has(session.id) || archived.has(session.id) !== showArchived) return false
      if (normalized === '') return true
      return `${session.title} ${subtitles[session.id] ?? ''} ${conversationPreviews[session.id] ?? session.preview}`.toLocaleLowerCase().includes(normalized)
    })
  }, [archived, conversationPreviews, hidden, query, sessions, showArchived, subtitles])

  const locallyHiddenSessions = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase()
    return sessions
      .filter(session => hidden.has(session.id))
      .filter(session => normalized === '' || `${session.title} ${subtitles[session.id] ?? ''} ${conversationPreviews[session.id] ?? session.preview}`.toLocaleLowerCase().includes(normalized))
      .sort((left, right) => (right.updatedAt ?? 0) - (left.updatedAt ?? 0))
  }, [conversationPreviews, hidden, query, sessions, subtitles])

  const groups = useMemo<SessionGroup[]>(() => {
    const available = new Map(filtered.map(session => [session.id, session]))
    const order = (groupId: string, ids: readonly string[]): SessionItemView[] => {
      const base = [...ids, ...filtered.filter(session => (session.workspaceId ?? UNGROUPED_ID) === groupId).map(session => session.id)]
      const stored = sessionOrders[groupId] ?? []
      const orderedIds = [...stored, ...base].filter((id, index, all) => all.indexOf(id) === index && available.has(id))
      const rows = orderedIds.map(id => available.get(id)).filter((session): session is SessionItemView => session !== undefined)
      return [...rows.filter(session => pinned.has(session.id)), ...rows.filter(session => !pinned.has(session.id))]
    }
    const next: SessionGroup[] = []
    for (const workspace of workspaces) {
      const rows = order(workspace.id, workspace.sessionIds)
      if (rows.length > 0) next.push({
        id: workspace.id,
        title: workspace.title,
        path: workspace.path,
        workspaceId: workspace.id,
        ...(workspace.virtual === undefined ? {} : { virtual: workspace.virtual }),
        sessions: rows,
      })
    }
    const ungrouped = order(UNGROUPED_ID, filtered.filter(session => session.workspaceId === undefined).map(session => session.id))
    if (ungrouped.length > 0) next.push({ id: UNGROUPED_ID, title: '未归属工作区', sessions: ungrouped })
    return next
  }, [filtered, pinned, sessionOrders, workspaces])

  const recentSessions = useMemo(() => {
    const nativeOrder = new Map(sessions.map((session, index) => [session.id, index]))
    return [...filtered].sort((left, right) => {
      const pinOrder = Number(pinned.has(right.id)) - Number(pinned.has(left.id))
      if (pinOrder !== 0) return pinOrder
      const freshness = (right.updatedAt ?? 0) - (left.updatedAt ?? 0)
      return freshness !== 0 ? freshness : (nativeOrder.get(left.id) ?? 0) - (nativeOrder.get(right.id) ?? 0)
    })
  }, [filtered, pinned, sessions])

  const avatarOf = (id: string): AvatarView => sessions.find(session => session.id === id)?.avatar ?? avatars[id] ?? defaultAvatar(id)
  const currentAvatar = avatarOf(currentSessionId ?? 'new-session')
  const currentSession = sessions.find(session => session.id === currentSessionId)
  const currentWorkspaceLabel = currentSession?.workspaceId === undefined
    ? undefined
    : workspaces.find(workspace => workspace.id === currentSession.workspaceId)?.title
  const archivedCount = sessions.filter(session => !hidden.has(session.id) && archived.has(session.id)).length
  const unreadCount = sessions.filter(session => !hidden.has(session.id) && !archived.has(session.id) && unread.has(session.id)).length
  const recycledMessageCount = Object.keys(messageRecycle.recycled).length
  const orderedRailItems = railOrder
    .map(id => RAIL_ITEMS.find(item => item.id === id))
    .filter((item): item is RailItem => item !== undefined && !hiddenRailIds.includes(item.id))

  const showRailTooltip = (element: HTMLElement, label: string): void => {
    const rect = element.getBoundingClientRect()
    setRailTooltip({ label, top: rect.top + rect.height / 2 })
  }

  const updateAvatar = (id: string, avatar: AvatarView): void => {
    setAvatars((previous) => {
      const next = { ...previous, [id]: avatar }
      writeJson(AVATAR_STORAGE_KEY, next)
      return next
    })
  }

  const updateUserAvatar = (avatar: AvatarView): void => {
    setUserAvatar(avatar)
    writeJson(USER_AVATAR_STORAGE_KEY, avatar)
  }

  const updateUserProfile = (profile: { name: string; signature: string }): void => {
    setUserProfile(profile)
    writeJson(USER_PROFILE_STORAGE_KEY, profile)
  }

  const updateSubtitle = (id: string, subtitle: string): void => {
    setSubtitles((previous) => {
      const next = { ...previous }
      const normalized = subtitle.trim()
      if (normalized === '') delete next[id]
      else next[id] = normalized
      writeJson(SESSION_SUBTITLE_STORAGE_KEY, next)
      return next
    })
  }

  const createSession = async (draft: Parameters<typeof onNewSession>[0]): Promise<void> => {
    const sessionId = await onNewSession(draft)
    registerAutoMetadata(sessionId, {
      title: draft.title === undefined || draft.title.trim() === '',
      subtitle: draft.subtitle === undefined || draft.subtitle.trim() === '',
    })
    if (draft.avatar !== undefined) updateAvatar(sessionId, draft.avatar)
    if (draft.subtitle !== undefined) updateSubtitle(sessionId, draft.subtitle)
    setRail('conversation')
    setNewSessionOpen(false)
  }

  const activateRail = (item: RailItem): void => {
    setRail(item.id)
    if (item.id === 'conversation' || item.id === 'archived') return
    if (item.id === 'message-trash') {
      setMessageRecycleOpen(true)
      return
    }
    if (item.id === 'services') {
      setServiceManagerOpen(true)
      void refreshServices()
      return
    }
    if (item.id === 'tasks') {
      void Promise.resolve(onOpenTaskBoard()).catch((reason) => {
        setToast(reason instanceof Error ? reason.message : '任务看板暂时无法打开')
      })
      return
    }
    if (item.id === 'workspace') {
      void Promise.resolve(onAddWorkspace()).catch(() => { setToast('添加工作区失败，请稍后重试') })
      return
    }
    if (item.id === 'skills') {
      setSkillInventoryOpen(true)
      return
    }
    if (item.id === 'plugin-settings') {
      setPluginCenterOpen(true)
      return
    }
    const sections: Partial<Record<RailId, string>> = {
      mode: 'agent-presets',
      model: 'models',
      plugins: 'market',
      'web-ui': 'web-ui-plugins',
      skins: 'skin-center',
      pet: 'pet',
    }
    void Promise.resolve(onOpenSettings(sections[item.id])).catch((reason) => {
      setToast(reason instanceof Error ? reason.message : `${item.label}暂时无法打开`)
    })
  }

  const reorderRail = (targetId: RailId, sourceId = draggedRail): void => {
    if (sourceId === null || sourceId === targetId) return
    setRailOrder((previous) => {
      const without = previous.filter(id => id !== sourceId)
      const at = without.indexOf(targetId)
      if (at < 0) return previous
      const next = [...without.slice(0, at), sourceId, ...without.slice(at)]
      writeJson(RAIL_ORDER_STORAGE_KEY, next)
      return next
    })
  }

  const openUsage = (): void => {
    setUsageOpen(true)
    const ids = sessions.map(session => session.id)
    if (ids.length === 0) return
    setUsageLoading(true)
    setUsageError(undefined)
    void onLoadSessionModels(ids).then((value) => {
      setUsageModels(value)
    }).catch((reason) => {
      setUsageError(reason instanceof Error ? reason.message : '模型信息读取失败')
    }).finally(() => { setUsageLoading(false) })
  }

  const reorderSession = (groupId: string, beforeSessionId?: string): void => {
    if (draggedSession === null) return
    if (draggedSession.groupId !== groupId) {
      setToast('会话只能在当前工作区标签内排序')
      return
    }
    const group = groups.find(candidate => candidate.id === groupId)
    if (group === undefined) return
    const source = group.sessions.find(session => session.id === draggedSession.id)
    const target = beforeSessionId === undefined ? undefined : group.sessions.find(session => session.id === beforeSessionId)
    if (source === undefined || source.id === target?.id) return
    if (target !== undefined && pinned.has(source.id) !== pinned.has(target.id)) {
      setToast('置顶会话和普通会话分别排序')
      return
    }
    const without = group.sessions.map(session => session.id).filter(id => id !== source.id)
    const at = beforeSessionId === undefined ? without.length : without.indexOf(beforeSessionId)
    const next = [...without.slice(0, at), source.id, ...without.slice(at)]
    setSessionOrders((previous) => {
      const value = { ...previous, [groupId]: next }
      writeJson(SESSION_ORDER_STORAGE_KEY, value)
      return value
    })
    if (group.workspaceId !== undefined && group.virtual !== true) {
      void Promise.resolve(onReorderSession(group.workspaceId, source.id, beforeSessionId)).catch((reason) => {
        setToast(reason instanceof Error ? reason.message : '工作区内排序失败')
      })
    }
  }

  const setPinned = (sessionId: string, value: boolean): void => {
    setPinnedIds((previous) => {
      const next = value ? [...new Set([...previous, sessionId])] : previous.filter(id => id !== sessionId)
      writeJson(PINNED_STORAGE_KEY, next)
      return next
    })
  }

  const setLocallyArchived = (sessionId: string, value: boolean): void => {
    if (!value && nativeArchived.has(sessionId)) {
      setToast('这是 Harness 原生归档；当前原生版本尚未提供恢复接口')
      return
    }
    setLocalArchivedIds((previous) => {
      const next = value ? [...new Set([...previous, sessionId])] : previous.filter(id => id !== sessionId)
      writeJson(ARCHIVED_STORAGE_KEY, next)
      return next
    })
  }

  const setUnread = (sessionId: string, value: boolean): void => {
    setManualUnreadIds((previous) => {
      const next = value ? [...new Set([...previous, sessionId])] : previous.filter(id => id !== sessionId)
      writeJson(UNREAD_STORAGE_KEY, next)
      return next
    })
    if (!value) setAcknowledgedCompletedIds(previous => [...new Set([...previous, sessionId])])
  }

  const openSession = (sessionId: string): void => {
    setUnread(sessionId, false)
    onOpenSession(sessionId)
  }

  const openContextMenu = (event: React.MouseEvent, session: SessionItemView): void => {
    event.preventDefault()
    event.stopPropagation()
    setContextMenu({
      session,
      x: Math.min(event.clientX, window.innerWidth - 224),
      y: Math.min(event.clientY, window.innerHeight - 310),
    })
  }

  const conversationLine = (session: SessionItemView): string => sessionRowPreview({
    fallback: session.preview,
    conversationPreview: conversationPreviews[session.id] ?? session.conversationPreview,
  })

  const renderSession = (session: SessionItemView, group: SessionGroup, pinnedCopy = false) => {
    const active = session.id === currentSessionId
    const avatar = avatarOf(session.id)
    const preview = conversationLine(session)
    const normalizedPreview = String(preview ?? '').replace(/\s+/gu, ' ').trim()
    const previewCharacters = Array.from(normalizedPreview)
    const compactPreview = previewCharacters.length > 24
      ? `${previewCharacters.slice(0, 24).join('')}…`
      : normalizedPreview
    const visibleTime = sessionTimeLabel(session)
    return (
      <div
        key={session.id}
        className="diywx-session-item"
        role="option"
        tabIndex={0}
        aria-selected={active}
        data-active={active || undefined}
        data-dragging={draggedSession?.id === session.id || undefined}
        draggable={!showArchived && !pinnedCopy && sessionView === 'workspace'}
        data-pinned-copy={pinnedCopy || undefined}
        onClick={() => { openSession(session.id) }}
        onContextMenu={(event) => { openContextMenu(event, session) }}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault()
            openSession(session.id)
          } else if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
            event.preventDefault()
            const rect = event.currentTarget.getBoundingClientRect()
            setContextMenu({ session, x: rect.left + 42, y: rect.top + 42 })
          }
        }}
        onDragStart={(event) => {
          event.dataTransfer.effectAllowed = 'move'
          event.dataTransfer.setData('text/plain', session.id)
          setDraggedSession({ id: session.id, groupId: group.id })
        }}
        onDragEnd={() => { setDraggedSession(null) }}
        onDragOver={(event) => {
          if (draggedSession === null) return
          event.preventDefault()
          event.dataTransfer.dropEffect = 'move'
        }}
        onDrop={(event) => {
          event.preventDefault()
          reorderSession(group.id, session.id)
          setDraggedSession(null)
        }}
      >
        <button
          className="diywx-avatar-action"
          type="button"
          title={sessionPanelCollapsed ? `打开会话：${session.title}` : '查看会话简介'}
          aria-label={sessionPanelCollapsed ? `打开会话：${session.title}` : `查看会话简介：${session.title}`}
          onClick={(event) => {
            event.stopPropagation()
            if (sessionPanelCollapsed) {
              openSession(session.id)
              return
            }
            const rect = event.currentTarget.getBoundingClientRect()
            const width = 292
            const height = 250
            const left = rect.right + 10 + width <= window.innerWidth ? rect.right + 10 : Math.max(12, rect.left - width - 10)
            setSessionProfile({ session, left, top: Math.max(12, Math.min(rect.top - 4, window.innerHeight - height - 12)) })
          }}
        >
          <AvatarBadge avatar={avatar} size={46} />
        </button>
        <span className="diywx-session-copy">
          <span className="diywx-session-title-row">
            {pinned.has(session.id) && <span className="diywx-session-pin"><Icon name="pin" size={11} /></span>}
            <strong>{session.title}</strong>
            <span className="diywx-session-time" title={`最近更新：${visibleTime}`}>{visibleTime}</span>
          </span>
          <span className="diywx-session-preview">
            {session.running && <span className="diywx-running-dot" />}
            <span className="diywx-session-preview-text" title={normalizedPreview}>{compactPreview}</span>
          </span>
        </span>
        {unread.has(session.id) && <span className="diywx-unread-dot" aria-label="未读消息" />}
      </div>
    )
  }

  const onSessionPanelResizeStart = (event: PointerEvent<HTMLDivElement>): void => {
    if (event.button !== 0) return
    event.preventDefault()
    const panel = event.currentTarget.closest('.diywx-session-panel')
    const left = panel?.getBoundingClientRect().left ?? event.currentTarget.getBoundingClientRect().left
    sessionPanelResizeRef.current = { pointerId: event.pointerId, left }
    setSessionPanelResizing(true)
    try { event.currentTarget.setPointerCapture(event.pointerId) } catch (captureError) {
      // Window listeners still track the drag when capture is unavailable.
      void captureError
    }
    const onMove = (move: globalThis.PointerEvent): void => {
      if (sessionPanelResizeRef.current?.pointerId !== move.pointerId) return
      applySessionPanelWidth(move.clientX - left, false)
    }
    const onUp = (up: globalThis.PointerEvent): void => {
      if (sessionPanelResizeRef.current?.pointerId !== up.pointerId) return
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
      sessionPanelResizeRef.current = null
      setSessionPanelResizing(false)
      persistSessionPanelWidth(sessionPanelWidthRef.current)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
  }

  const onSessionPanelResizeKey = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === 'ArrowLeft') {
      event.preventDefault()
      applySessionPanelWidth(sessionPanelWidthRef.current - SESSION_PANEL_RESIZE_STEP, true)
    } else if (event.key === 'ArrowRight') {
      event.preventDefault()
      applySessionPanelWidth(sessionPanelWidthRef.current + SESSION_PANEL_RESIZE_STEP, true)
    } else if (event.key === 'Home') {
      event.preventDefault()
      applySessionPanelWidth(SESSION_PANEL_COLLAPSED_WIDTH, true)
    } else if (event.key === 'End') {
      event.preventDefault()
      applySessionPanelWidth(SESSION_PANEL_MAX_WIDTH, true)
    }
  }

  return (
    <main
      className="diywx-shell"
      data-testid="wechat-shell"
      data-standalone={standalone || undefined}
      data-session-panel-collapsed={sessionPanelCollapsed || undefined}
      data-session-panel-resizing={sessionPanelResizing || undefined}
      style={{ '--diywx-session-panel-width': `${sessionPanelWidth}px` } as CSSProperties}
    >
      <nav className="diywx-rail" aria-label="功能导航">
        <div className="diywx-rail-titlebar" aria-hidden="true" />
        <button
          className="diywx-brand-avatar"
          type="button"
          title="DIY 我的头像"
          aria-label={`编辑 ${userProfile.name || '我的'} 的资料`}
          data-tip={userProfile.name || '我的资料'}
          onMouseEnter={(event) => { showRailTooltip(event.currentTarget, userProfile.name || '我的资料') }}
          onMouseLeave={() => { setRailTooltip(null) }}
          onFocus={(event) => { showRailTooltip(event.currentTarget, userProfile.name || '我的资料') }}
          onBlur={() => { setRailTooltip(null) }}
          onClick={() => { setEditingUserAvatar(true) }}
        >
          <AvatarBadge avatar={userAvatar} size={46} />
          <span className="diywx-brand-edit-dot"><Icon name="edit" size={9} /></span>
        </button>
        <div className="diywx-rail-stack">
          {orderedRailItems.map(item => (
            <button
              key={item.id}
              className="diywx-rail-button"
              type="button"
              data-rail-id={item.id}
              data-active={rail === item.id || undefined}
              data-dragging={draggedRail === item.id || undefined}
              data-tip={item.label}
              aria-label={item.label}
              onMouseEnter={(event) => { showRailTooltip(event.currentTarget, item.label) }}
              onMouseLeave={() => { setRailTooltip(null) }}
              onFocus={(event) => { showRailTooltip(event.currentTarget, item.label) }}
              onBlur={() => { setRailTooltip(null) }}
              onClick={() => {
                if (suppressRailClick.current) { suppressRailClick.current = false; return }
                activateRail(item)
              }}
              onPointerDown={(event) => {
                if (event.button !== 0) return
                event.currentTarget.setPointerCapture(event.pointerId)
                setRailPointer({ id: item.id, pointerId: event.pointerId, startY: event.clientY, moved: false })
              }}
              onPointerMove={(event) => {
                if (railPointer?.id !== item.id || railPointer.pointerId !== event.pointerId) return
                const moved = railPointer.moved || Math.abs(event.clientY - railPointer.startY) > 5
                if (!moved) return
                if (!railPointer.moved) {
                  suppressRailClick.current = true
                  setDraggedRail(item.id)
                  setRailPointer({ ...railPointer, moved: true })
                }
                const target = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>('[data-rail-id]')?.dataset.railId as RailId | undefined
                if (target !== undefined) reorderRail(target, item.id)
              }}
              onPointerUp={(event) => {
                if (railPointer?.pointerId !== event.pointerId) return
                setRailPointer(null)
                window.setTimeout(() => { setDraggedRail(null) }, 0)
                window.setTimeout(() => { suppressRailClick.current = false }, 250)
              }}
              onPointerCancel={() => { setRailPointer(null); setDraggedRail(null) }}
            >
              <Icon name={item.icon} size={22} />
              {item.id === 'conversation' && unreadCount > 0 && <span className="diywx-rail-badge">{unreadCount > 99 ? '99+' : unreadCount}</span>}
              {item.id === 'archived' && archivedCount > 0 && <span className="diywx-rail-badge" data-neutral>{archivedCount > 99 ? '99+' : archivedCount}</span>}
              {item.id === 'message-trash' && recycledMessageCount > 0 && <span className="diywx-rail-badge" data-neutral>{recycledMessageCount > 99 ? '99+' : recycledMessageCount}</span>}
              {item.id === 'services' && services.length > 0 && <span className="diywx-rail-badge" data-neutral>{services.length > 99 ? '99+' : services.length}</span>}
            </button>
          ))}
        </div>
        {!hiddenRailIds.includes('usage') && (
          <button
            className="diywx-rail-button diywx-usage-button"
            type="button"
            data-tip="用量与费用"
            aria-label="用量与费用"
            onMouseEnter={(event) => { showRailTooltip(event.currentTarget, '用量与费用') }}
            onMouseLeave={() => { setRailTooltip(null) }}
            onFocus={(event) => { showRailTooltip(event.currentTarget, '用量与费用') }}
            onBlur={() => { setRailTooltip(null) }}
            onClick={openUsage}
          >
            <Icon name="usage" size={21} />
            <small>今日</small>
          </button>
        )}
        <button
          className="diywx-rail-button diywx-settings-button"
          type="button"
          data-tip="通用设置"
          aria-label="通用设置"
          onMouseEnter={(event) => { showRailTooltip(event.currentTarget, '通用设置') }}
          onMouseLeave={() => { setRailTooltip(null) }}
          onFocus={(event) => { showRailTooltip(event.currentTarget, '通用设置') }}
          onBlur={() => { setRailTooltip(null) }}
          onClick={() => {
            setRail('settings')
            void Promise.resolve(onOpenSettings('general')).catch((reason) => {
              setToast(reason instanceof Error ? reason.message : '设置暂时无法打开')
            })
          }}
        >
          <Icon name="settings" size={22} />
        </button>
      </nav>
      {railTooltip !== null && <span className="diywx-rail-floating-tip" style={{ top: railTooltip.top }}>{railTooltip.label}</span>}

      <aside className="diywx-session-panel">
        <div className="diywx-search-row">
          <label className="diywx-search-box">
            <Icon name="search" size={17} />
            <input value={query} onChange={(event) => { setQuery(event.target.value) }} placeholder="搜索会话" aria-label="搜索会话" />
          </label>
          <button className="diywx-new-button" type="button" title="新会话" aria-label="新会话" onClick={() => { setNewSessionOpen(true) }}>
            <Icon name="plus" size={23} />
          </button>
        </div>

        {!hiddenRailIds.includes('pinned-note') && <section className="diywx-pinned-note" aria-label="置顶提醒">
          <span className="diywx-note-icon"><Icon name="pin" size={16} /></span>
          {editingNote
            ? <input
              autoFocus
              value={note}
              onChange={(event) => { setNote(event.target.value) }}
              onBlur={() => {
                setEditingNote(false)
                try { localStorage.setItem(NOTE_STORAGE_KEY, note) } catch { /* local preview keeps the in-memory note */ }
              }}
              onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur() }}
              aria-label="编辑置顶提醒"
            />
            : <button type="button" onClick={() => { setEditingNote(true) }}>{note}</button>}
          <button className="diywx-note-edit" type="button" title="编辑置顶提醒" aria-label="编辑置顶提醒" onClick={() => { setEditingNote(true) }}>
            <Icon name="edit" size={15} />
          </button>
        </section>}

        <div className="diywx-session-meta">
          <span>{showArchived
            ? '已归档会话'
            : sessionView === 'workspace'
              ? workspaceCount > 0 ? `${workspaceCount} 个工作区` : '工作区视图'
              : `${filtered.length} 个会话`}</span>
          <button
            className="diywx-view-toggle"
            type="button"
            title={sessionView === 'workspace' ? '切换到会话视图' : '切换到工作区视图'}
            aria-label={sessionView === 'workspace' ? '切换到会话视图' : '切换到工作区视图'}
            data-view={sessionView}
            onClick={() => {
              const next = sessionView === 'workspace' ? 'recent' : 'workspace'
              setSessionView(next)
              writeJson(SESSION_VIEW_STORAGE_KEY, next)
            }}
          ><Icon name={sessionView === 'workspace' ? 'list' : 'folder'} size={16} /></button>
        </div>

        <div className="diywx-session-list" role="listbox" aria-label={showArchived ? '已归档会话' : '会话列表'}>
          {sessionView === 'workspace' && !showArchived && filtered.some(session => pinned.has(session.id)) && (
            <section className="diywx-pinned-conversations" aria-label="置顶会话">
              <div className="diywx-pinned-group-label"><Icon name="pin" size={14} /><span>置顶会话</span><small>{filtered.filter(session => pinned.has(session.id)).length}</small></div>
              <div className="diywx-group-rows">
                {pinnedIds
                  .map(id => filtered.find(session => session.id === id))
                  .filter((session): session is SessionItemView => session !== undefined)
                  .map(session => renderSession(session, { id: '__pinned__', title: '置顶会话', sessions: [] }, true))}
              </div>
            </section>
          )}
          {sessionView === 'workspace' && groups.map(group => (
            <section className="diywx-session-group" key={group.id} data-collapsed={collapsedGroups[group.id] || undefined}>
              <button
                className="diywx-group-label"
                type="button"
                title={group.path}
                onClick={() => { setCollapsedGroups(previous => ({ ...previous, [group.id]: !previous[group.id] })) }}
              >
                <Icon name={group.id === UNGROUPED_ID ? 'chat' : 'folder'} size={14} />
                <span>{group.title}</span>
                <small>{group.sessions.length}</small>
                <span className="diywx-group-chevron"><Icon name="chevron" size={13} /></span>
              </button>
              {!collapsedGroups[group.id] && (
                <div className="diywx-group-rows">
                  {group.sessions.map(session => renderSession(session, group))}
                  {!showArchived && draggedSession?.groupId === group.id && (
                    <div
                      className="diywx-group-drop-end"
                      onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = 'move' }}
                      onDrop={(event) => {
                        event.preventDefault()
                        reorderSession(group.id)
                        setDraggedSession(null)
                      }}
                    >移到末尾</div>
                  )}
                </div>
              )}
            </section>
          ))}
          {sessionView === 'recent' && (
            <section className="diywx-recent-session-list" aria-label="按最近活动排列的会话">
              {recentSessions.map(session => renderSession(session, { id: '__recent__', title: '最近会话', sessions: recentSessions }))}
            </section>
          )}
          {showArchived && locallyHiddenSessions.length > 0 && (
            <section className="diywx-hidden-recovery" aria-label="已从界面移除的会话">
              <div className="diywx-hidden-recovery-title">
                <span>已从界面移除</span>
                <small>{locallyHiddenSessions.length}</small>
              </div>
              {locallyHiddenSessions.map(session => (
                <div className="diywx-hidden-recovery-row" key={session.id}>
                  <AvatarBadge avatar={avatarOf(session.id)} size={36} />
                  <span>
                    <strong>{session.title}</strong>
                    <small>{conversationLine(session)}</small>
                  </span>
                  <button type="button" onClick={() => {
                    setHiddenIds((previous) => {
                      const next = previous.filter(id => id !== session.id)
                      writeJson(HIDDEN_STORAGE_KEY, next)
                      return next
                    })
                    setToast('会话已恢复显示')
                  }}>恢复</button>
                </div>
              ))}
            </section>
          )}
          {filtered.length === 0 && (!showArchived || locallyHiddenSessions.length === 0) && <div className="diywx-empty-list">{showArchived ? '还没有归档或本地隐藏的会话' : '没有找到相关会话'}</div>}
        </div>
        {!standalone && (
          <div
            className="diywx-session-panel-resizer"
            role="separator"
            aria-orientation="vertical"
            aria-label="拖动调整会话列表宽度"
            aria-valuemin={SESSION_PANEL_COLLAPSED_WIDTH}
            aria-valuemax={SESSION_PANEL_MAX_WIDTH}
            aria-valuenow={sessionPanelWidth}
            tabIndex={0}
            onPointerDown={onSessionPanelResizeStart}
            onKeyDown={onSessionPanelResizeKey}
          />
        )}
      </aside>

      <section className="diywx-workspace">{renderConversation(
        currentAvatar,
        userAvatar,
        currentSessionId === undefined ? undefined : subtitles[currentSessionId],
        (subtitle) => { if (currentSessionId !== undefined) updateSubtitle(currentSessionId, subtitle) },
        () => { if (currentSession !== undefined) setViewingAvatar(currentSession) },
        sessionView === 'recent' ? currentWorkspaceLabel : undefined,
      )}</section>

      {sessionProfile !== null && (
        <div className="diywx-profile-popover-scrim" onPointerDown={(event) => { if (event.target === event.currentTarget) setSessionProfile(null) }}>
          <section
            className="diywx-conversation-profile"
            role="dialog"
            aria-label={`${sessionProfile.session.title}会话简介`}
            style={{ left: sessionProfile.left, top: sessionProfile.top }}
          >
            <header>
              <button
                type="button"
                className="diywx-profile-avatar-button"
                title="查看头像大图"
                onClick={() => { setViewingAvatar(sessionProfile.session); setSessionProfile(null) }}
              >
                <AvatarBadge avatar={avatarOf(sessionProfile.session.id)} size={60} />
              </button>
              <span><strong>{sessionProfile.session.title}</strong><small>{conversationLine(sessionProfile.session)}</small></span>
              <button className="diywx-profile-close" type="button" title="关闭" onClick={() => { setSessionProfile(null) }}>×</button>
            </header>
            <dl>
              <div><dt>创建时间</dt><dd>暂无记录</dd></div>
              <div><dt>最近交互</dt><dd>{profileDate(sessionProfile.session.updatedAt)}</dd></div>
              <div><dt>总消耗</dt><dd>{profileTokens(sessionProfile.session)}</dd></div>
            </dl>
          </section>
        </div>
      )}

      {contextMenu !== null && (
        <div className="diywx-context-scrim" onPointerDown={(event) => { if (event.target === event.currentTarget) setContextMenu(null) }}>
          <div
            className="diywx-session-context"
            role="menu"
            aria-label={`${contextMenu.session.title}的会话操作`}
            style={{ left: contextMenu.x, top: contextMenu.y }}
            onContextMenu={(event) => { event.preventDefault() }}
          >
            <button type="button" role="menuitem" onClick={() => {
              setPinned(contextMenu.session.id, !pinned.has(contextMenu.session.id))
              setContextMenu(null)
            }}>{pinned.has(contextMenu.session.id) ? '取消置顶' : '置顶'}</button>
            <button type="button" role="menuitem" onClick={() => {
              setUnread(contextMenu.session.id, !unread.has(contextMenu.session.id))
              setContextMenu(null)
            }}>{unread.has(contextMenu.session.id) ? '标为已读' : '标为未读'}</button>
            <button
              type="button"
              role="menuitem"
              disabled={archived.has(contextMenu.session.id) && nativeArchived.has(contextMenu.session.id)}
              title={nativeArchived.has(contextMenu.session.id) ? '当前 Harness 原生版本尚未提供恢复接口' : undefined}
              onClick={() => {
                setLocallyArchived(contextMenu.session.id, !archived.has(contextMenu.session.id))
                setContextMenu(null)
              }}
            >{archived.has(contextMenu.session.id) ? '取消归档' : '归档'}</button>
            <span className="diywx-context-separator" />
            <button type="button" role="menuitem" onClick={() => {
              try { onOpenSessionWindow(contextMenu.session.id) } catch (reason) {
                setToast(reason instanceof Error ? reason.message : '独立窗口打开失败')
              }
              setContextMenu(null)
            }}>独立窗口显示</button>
            <span className="diywx-context-separator" />
            <button className="diywx-context-danger" type="button" role="menuitem" onClick={() => {
              setDeleteTarget(contextMenu.session)
              setContextMenu(null)
            }}>删除</button>
          </div>
        </div>
      )}

      {deleteTarget !== null && (
        <div className="diywx-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setDeleteTarget(null) }}>
          <section className="diywx-delete-dialog" role="dialog" aria-modal="true" aria-label="删除会话">
            <strong>删除“{deleteTarget.title}”？</strong>
            <p>当前 Harness 尚未提供永久删除接口。这里仅从新 UI 中隐藏会话并保留底层日志，之后可在“已归档会话”中恢复。</p>
            <div>
              <button type="button" onClick={() => { setDeleteTarget(null) }}>取消</button>
              <button className="diywx-danger-button" type="button" onClick={() => {
                setHiddenIds((previous) => {
                  const next = [...new Set([...previous, deleteTarget.id])]
                  writeJson(HIDDEN_STORAGE_KEY, next)
                  return next
                })
                setDeleteTarget(null)
                setToast('已从界面移除，可在“已归档会话”中恢复')
              }}>删除</button>
            </div>
          </section>
        </div>
      )}

      {toast !== null && <div className="diywx-toast" role="status">{toast}</div>}
      {usageOpen && (
        <UsageDashboard
          sessions={sessions}
          models={usageModels}
          loading={usageLoading}
          loadUsage={onLoadSessionUsage}
          {...(usageError === undefined ? {} : { error: usageError })}
          onClose={() => { setUsageOpen(false) }}
        />
      )}
      {newSessionOpen && (
        <NewSessionDialog
          workspaces={workspaces.filter(workspace => workspace.virtual !== true)}
          onCreate={createSession}
          onClose={() => { setNewSessionOpen(false) }}
          multiplayerEnabled={multiplayerEnabled}
        />
      )}
      {messageRecycleOpen && (
        <MessageRecycleBin onClose={() => { setMessageRecycleOpen(false); setRail('conversation') }} />
      )}
      {pluginCenterOpen && (
        <PluginCenter load={onLoadPlugins} onClose={() => { setPluginCenterOpen(false); setRail('conversation') }} />
      )}
      {skillInventoryOpen && (
        <SkillInventory
          {...skillCwd === undefined ? {} : { cwd: skillCwd }}
          {...currentSessionId === undefined ? {} : { sessionId: currentSessionId }}
          load={onLoadSkills ?? (async () => { throw new Error('当前窗口还不能读取技能清单') })}
          {...(onInstallSkill === undefined ? {} : { install: onInstallSkill })}
          onClose={() => { setSkillInventoryOpen(false); setRail('conversation') }}
        />
      )}
      {serviceManagerOpen && (
        <ServiceManager
          services={services}
          loading={servicesLoading}
          {...(servicesError === undefined ? {} : { error: servicesError })}
          sessionTitle={id => sessions.find(session => session.id === id)?.title}
          onRefresh={refreshServices}
          onStop={async (id) => {
            const stop = stopServiceRef.current
            if (stop === undefined) throw new Error('当前入口暂不支持关闭服务')
            await stop(id)
          }}
          onClose={() => { setServiceManagerOpen(false); setRail('conversation') }}
        />
      )}
      {editingAvatar !== null && (
        <AvatarEditor
          avatar={avatarOf(editingAvatar.id)}
          title={editingAvatar.title}
          onChange={(avatar) => { updateAvatar(editingAvatar.id, avatar) }}
          onClose={() => { setEditingAvatar(null) }}
        />
      )}
      {viewingAvatar !== null && (
        <AvatarPreview
          avatar={avatarOf(viewingAvatar.id)}
          title={viewingAvatar.title}
          onEdit={() => { setEditingAvatar(viewingAvatar); setViewingAvatar(null) }}
          onClose={() => { setViewingAvatar(null) }}
        />
      )}
      {editingUserAvatar && (
        <AvatarEditor
          avatar={userAvatar}
          title={userProfile.name || '我'}
          heading="我的资料"
          imageHint={multiplayerEnabled ? '图片会保存到当前测试账号，并同步显示给同一群聊的成员；建议小于 1.5 MB。' : '图片仅保存在这个浏览器中，建议小于 1.5 MB。'}
          profile={{ ...userProfile, onChange: updateUserProfile }}
          onChange={updateUserAvatar}
          onClose={() => { setEditingUserAvatar(false) }}
        />
      )}
    </main>
  )
}
