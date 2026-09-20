import { FormEvent, useCallback, useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { AvatarBadge } from '../../../wechat-ui/src/client/Avatar.tsx'
import { ConversationPane } from '../../../wechat-ui/src/client/ConversationPane.tsx'
import { WechatShellFrame } from '../../../wechat-ui/src/client/WechatShell.tsx'
import { encodedFile } from '../../../wechat-ui/src/client/fileAttachments.ts'
import type {
  AvatarView,
  ChatFileView,
  ChatImageView,
  ChatMessageView,
  CollaborationDecisionView,
  CollaborationModeView,
  DshServiceView,
  ModelAccessView,
  ModelOptionView,
  NewSessionDraft,
  PendingQuestionView,
  PluginToolView,
  QuestionItemView,
  SessionItemView,
  SessionUsageHistoryView,
  WorkspaceGroupView,
} from '../../../wechat-ui/src/client/types.ts'

const AVATAR_STORAGE_KEY = 'dsh-diy-lab.session-avatars.v1'
const USER_AVATAR_STORAGE_KEY = 'dsh-diy-lab.user-avatar.v1'
const USER_PROFILE_STORAGE_KEY = 'dsh-diy-lab.user-profile.v1'
const HIDDEN_RAIL_STORAGE_KEY = 'dsh-diy-lab.hidden-rail-items.v1'
const RAIL_ORDER_STORAGE_KEY = 'dsh-diy-lab.rail-order.v1'
const PINNED_STORAGE_KEY = 'dsh-diy-lab.pinned-sessions.v1'
const NOTE_STORAGE_KEY = 'dsh-diy-lab.pinned-note.v1'
const SESSION_VIEW_STORAGE_KEY = 'dsh-diy-lab.session-view.v1'

const OPTIONAL_RAIL_ITEMS = [
  ['task-board', '任务看板'], ['workspace', '添加工作区'], ['mode', '模式切换'],
  ['model', '模型切换'], ['plugins', '插件'], ['plugin-market', '插件商店'],
  ['skins', '皮肤中心'], ['pet', '宠物'], ['archived', '已归档会话'],
  ['message-trash', '聊天回收站'], ['usage', '用量统计'],
  ['services', '运行服务'],
] as const

interface PublicUser {
  id: string
  username: string
  displayName: string
  avatar: string
  color: string
  avatarView?: AvatarView
  serverRole?: string
  disabledAt?: number
  createdAt: number
  lastLoginAt?: number
  online?: boolean
}

interface AdminUser extends PublicUser {
  conversationCount: number
  roomCount: number
}

interface ConversationSummary {
  id: string
  title: string
  subtitle: string
  avatarView?: AvatarView
  createdAt: number
  updatedAt: number
  running: boolean
  workspaceId?: string
  workspaceLabel: string
  tokenUsage: number
}

interface RoomSummary {
  id: string
  name: string
  brief: string
  workspaceId: string
  createdAt: number
  updatedAt: number
  memberCount: number
  avatarView?: AvatarView
  role: 'owner' | 'admin' | 'member' | 'observer'
  aiAccess: boolean
  unread: number
  agent: { enabled: boolean; state: string; silenceUntil?: number }
  collaborationMode: CollaborationModeView
  passwordProtected: boolean
  modelSelection?: { provider: string; model: string; reasoningEffort?: string }
}

interface BootstrapState {
  ok: boolean
  setupRequired: boolean
  setupTokenAccepted: boolean
  user: PublicUser | null
  ui: Record<string, unknown>
  csrf?: string
  rooms: RoomSummary[]
  conversations: ConversationSummary[]
  workspaces: Array<{ id: string; label: string }>
  executionEnabled: boolean
  clientVersion: string
}

interface PrivateDetail {
  kind: 'private'
  conversation: ConversationSummary
  messages: Array<{ id?: string; role?: 'user' | 'assistant' | 'status' | 'tool'; text?: string; reasoning?: string; tool?: PluginToolView; files?: ChatFileView[]; createdAt?: number }>
  pendingQuestion?: { key: string; questions: QuestionItemView[]; canAnswer: boolean }
  progress?: { reasoning?: string; text?: string; statuses?: string[]; steps?: ProgressStep[]; updatedAt?: number }
}

interface RoomMessage {
  id: string
  kind: string
  userId: string | null
  text: string
  createdAt: number
  reasoning?: string
  progressStatuses?: string[]
  tool?: PluginToolView
  images?: Array<{ id: string; name?: string; mediaType?: string; size?: number }>
  files?: ChatFileView[]
}

interface RoomDetail {
  kind: 'room'
  room: RoomSummary & { ownerId?: string; approvalMode?: string; quietSeconds?: number }
  members: Record<string, { role: string; aiAccess: boolean; joinedAt: number }>
  users: Record<string, PublicUser>
  messages: RoomMessage[]
  proposals: Array<{ id: string; status: string; prompt: string; decisionSummary?: string; conflictWarning?: boolean; confirmations: Record<string, number>; eligibleVoterIds: string[] }>
  runs: Array<{ id: string; status: string; output?: string; error?: string }>
  workspace: { id: string; label: string }
  executionEnabled: boolean
  app?: { title: string; html: string; updatedAt?: number }
  pendingQuestion?: { key: string; questions: QuestionItemView[]; canAnswer: boolean }
  progress?: { runId: string; reasoning?: string; text?: string; statuses?: string[]; steps?: ProgressStep[]; updatedAt?: number }
}

interface ProgressStep {
  id: string
  kind: 'assistant' | 'status' | 'tool'
  text?: string
  reasoning?: string
  pending?: boolean
  tool?: PluginToolView
}

type DetailState = PrivateDetail | RoomDetail

function sessionKey(kind: 'private' | 'room', id: string): string {
  return `${kind}:${id}`
}

function parseSessionKey(value: string): { kind: 'private' | 'room'; id: string } | undefined {
  if (value.startsWith('private:')) return { kind: 'private', id: value.slice(8) }
  if (value.startsWith('room:')) return { kind: 'room', id: value.slice(5) }
  return undefined
}

function avatarOf(user?: PublicUser | null): AvatarView {
  return user?.avatarView ?? { glyph: (['whale', 'code', 'spark', 'folder', 'robot'].includes(user?.avatar ?? '') ? user?.avatar : 'whale') as AvatarView['glyph'], color: user?.color ?? '#2f6bff' }
}

function formatTime(value: number): string {
  const date = new Date(value)
  const today = new Date()
  return date.toDateString() === today.toDateString()
    ? date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
    : `${date.getMonth() + 1}/${date.getDate()}`
}

function proposalDecisionCopy(proposal: RoomDetail['proposals'][number]): string {
  if (proposal.decisionSummary?.trim()) return proposal.decisionSummary.trim()
  const marker = '以下是具有 AI 执行权成员按时间顺序提交、且已经本轮全员确认的原始需求：'
  const markerAt = proposal.prompt.indexOf(marker)
  if (markerAt < 0) return '本轮需求已经整理，请由有表决权的群成员确认后继续。'
  const tail = proposal.prompt.slice(markerAt + marker.length).trim()
  const endAt = tail.indexOf('\n\n先按确认后的共同需求')
  const transcript = (endAt < 0 ? tail : tail.slice(0, endAt)).trim()
  return `AI 已把本轮准备执行的群聊意见整理如下：\n${transcript}\n\n请确认是否把以上内容合并为本轮执行需求。`
}

function proposalHasExplicitConflict(proposal: RoomDetail['proposals'][number], summary: string): boolean {
  return proposal.conflictWarning === true
    && /不同意|反对|不赞成|有分歧|有冲突|相反|不能同时|互斥|二选一|别按.+(?:说|方案|做)|不要按.+(?:说|方案|做)|推翻.+(?:意见|方案|需求)|撤回.+(?:意见|方案|需求)/u.test(summary)
}

async function api<T>(path: string, init: RequestInit = {}, csrf?: string): Promise<T> {
  const headers = new Headers(init.headers)
  if (init.body !== undefined && !headers.has('content-type')) headers.set('content-type', 'application/json')
  if (csrf !== undefined) headers.set('x-csrf-token', csrf)
  const response = await fetch(path, { ...init, headers, credentials: 'same-origin' })
  const payload = await response.json() as T & { error?: string }
  if (!response.ok) throw new Error(payload.error ?? `请求失败（${response.status}）`)
  return payload
}

function base64Bytes(bytes: Uint8Array): string {
  let binary = ''
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000))
  }
  return btoa(binary)
}

async function encodedRoomImage(file: File): Promise<{ mediaType: string; data: string; name: string }> {
  return {
    mediaType: file.type,
    data: base64Bytes(new Uint8Array(await file.arrayBuffer())),
    name: file.name || '截图.png',
  }
}

function writeJson(key: string, value: unknown): void {
  try { localStorage.setItem(key, JSON.stringify(value)) } catch { /* browser profile remains usable in memory */ }
}

function applyServerUi(state: BootstrapState): void {
  if (state.user === null) return
  const uiAvatar = state.ui.userAvatar as AvatarView | undefined
  writeJson(USER_AVATAR_STORAGE_KEY, uiAvatar ?? avatarOf(state.user))
  const profile = state.ui.profile as { name?: string; signature?: string } | undefined
  writeJson(USER_PROFILE_STORAGE_KEY, {
    name: profile?.name?.trim() || state.user.displayName,
    signature: profile?.signature?.trim() || '把复杂的事情，聊着做完。',
  })
  if (Array.isArray(state.ui.hiddenRailIds)) writeJson(HIDDEN_RAIL_STORAGE_KEY, state.ui.hiddenRailIds)
  if (Array.isArray(state.ui.railOrder)) writeJson(RAIL_ORDER_STORAGE_KEY, state.ui.railOrder)
  if (Array.isArray(state.ui.pinnedSessionIds)) writeJson(PINNED_STORAGE_KEY, state.ui.pinnedSessionIds)
  if (typeof state.ui.pinnedNote === 'string') writeJson(NOTE_STORAGE_KEY, state.ui.pinnedNote)
  if (state.ui.sessionView === 'workspace' || state.ui.sessionView === 'recent') writeJson(SESSION_VIEW_STORAGE_KEY, state.ui.sessionView)
  const avatars: Record<string, AvatarView> = {}
  for (const conversation of state.conversations) {
    if (conversation.avatarView !== undefined) avatars[sessionKey('private', conversation.id)] = conversation.avatarView
  }
  writeJson(AVATAR_STORAGE_KEY, avatars)
}

function AuthScreen({ bootstrap, refresh }: { bootstrap: BootstrapState; refresh: () => Promise<void> }) {
  const query = new URLSearchParams(location.search)
  const inviteCode = query.get('invite') ?? ''
  const setupToken = query.get('setup') ?? ''
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [avatar, setAvatar] = useState<AvatarView>({ glyph: 'whale', color: '#2f6bff' })

  const submit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault()
    setBusy(true)
    setError('')
    const data = new FormData(event.currentTarget)
    const payload = Object.fromEntries(data.entries())
    try {
      if (bootstrap.setupRequired) {
        await api('/api/setup', { method: 'POST', body: JSON.stringify({ ...payload, token: setupToken, avatar: avatar.glyph, color: avatar.color }) })
      } else {
        await api('/api/login', { method: 'POST', body: JSON.stringify({ ...payload, ...(inviteCode ? { inviteCode } : {}) }) })
      }
      await refresh()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '登录失败')
      setBusy(false)
    }
  }

  const setupAllowed = bootstrap.setupRequired && bootstrap.setupTokenAccepted
  return (
    <main className="collab-auth-shell">
      <section className="collab-auth-card">
        <AvatarBadge avatar={avatar} size={62} />
        <span className="collab-auth-kicker">DeepSeek Harness</span>
        <h1>{bootstrap.setupRequired ? '初始化本机主人账号' : inviteCode ? '登录后加入多人会话' : '登录你的 Harness'}</h1>
        <p>{bootstrap.setupRequired
          ? '主人账号可看到这台电脑原有的私人会话；同事账号只会看到自己加入的多人会话。'
          : inviteCode ? '使用宿主管理员发放的测试账号登录。私人会话仍只属于你，只有加入的多人会话会共享。' : '账号由宿主管理员统一发放；私人会话与多人会话按账号和成员权限隔离。'}</p>
        {bootstrap.setupRequired && !setupAllowed
          ? <div className="collab-auth-warning">首次初始化只能通过终端给出的本机安全链接完成。</div>
          : <form onSubmit={(event) => { void submit(event) }}>
            <label><span>账号</span><input name="username" required minLength={2} maxLength={24} autoComplete="username" placeholder="例如 gene（以后登录使用）" /></label>
            {bootstrap.setupRequired && <label><span>昵称</span><input name="displayName" required maxLength={32} placeholder="聊天气泡旁显示的名字" /></label>}
            {bootstrap.setupRequired && (
              <fieldset><legend>头像</legend><div className="collab-auth-avatars">{(['whale', 'code', 'spark', 'folder', 'robot'] as const).map(glyph => (
                <button key={glyph} type="button" data-selected={avatar.glyph === glyph || undefined} onClick={() => { setAvatar({ ...avatar, glyph }) }}><AvatarBadge avatar={{ ...avatar, glyph }} size={38} /></button>
              ))}</div></fieldset>
            )}
            <label><span>密码</span><input name="password" type="password" required minLength={8} maxLength={128} autoComplete={bootstrap.setupRequired ? 'new-password' : 'current-password'} placeholder="至少 8 位，仅保存在这台电脑" /></label>
            {inviteCode !== '' && <label><span>群聊密码（若群主设置）</span><input name="roomPassword" type="password" autoComplete="off" placeholder="没有则留空" /></label>}
            {error !== '' && <div className="collab-auth-error">{error}</div>}
            <button className="collab-primary" type="submit" disabled={busy}>{busy ? '正在处理…' : bootstrap.setupRequired ? '完成安全初始化' : inviteCode ? '登录并加入' : '登录'}</button>
          </form>}
        {!bootstrap.setupRequired && <small className="collab-auth-disclosure">测试期间，宿主最高管理员可导出本服务器保存的账号会话与交互记录；无法读取你电脑上的其他文件或其他服务数据。</small>}
      </section>
    </main>
  )
}

function SettingsDialog({ user, csrf, onClose, logout }: { user: PublicUser; csrf?: string; onClose: () => void; logout: () => Promise<void> }) {
  const [hiddenRailIds, setHiddenRailIds] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem(HIDDEN_RAIL_STORAGE_KEY) ?? '[]') as string[] } catch { return [] }
  })
  const [adminUsers, setAdminUsers] = useState<AdminUser[]>([])
  const [adminError, setAdminError] = useState('')
  const hostOwner = user.serverRole === 'host-owner'
  const loadUsers = async (): Promise<void> => {
    if (!hostOwner) return
    try {
      const result = await api<{ users: AdminUser[] }>('/api/admin/users')
      setAdminUsers(result.users)
      setAdminError('')
    } catch (reason) { setAdminError(reason instanceof Error ? reason.message : '测试账号读取失败') }
  }
  useEffect(() => { void loadUsers() }, [hostOwner])

  const toggleRail = async (id: string): Promise<void> => {
    const next = hiddenRailIds.includes(id) ? hiddenRailIds.filter(item => item !== id) : [...hiddenRailIds, id]
    setHiddenRailIds(next)
    writeJson(HIDDEN_RAIL_STORAGE_KEY, next)
    window.dispatchEvent(new CustomEvent('diywx-rail-visibility', { detail: next }))
    try {
      await api('/api/profile', { method: 'PATCH', body: JSON.stringify({ ui: { hiddenRailIds: next } }) }, csrf)
    } catch (reason) { setAdminError(reason instanceof Error ? reason.message : '菜单设置保存失败') }
  }
  const issueAccount = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault()
    const form = event.currentTarget
    setAdminError('')
    try {
      await api('/api/admin/users', { method: 'POST', body: JSON.stringify(Object.fromEntries(new FormData(form).entries())) }, csrf)
      form.reset()
      await loadUsers()
    } catch (reason) { setAdminError(reason instanceof Error ? reason.message : '测试账号发放失败') }
  }
  const toggleAccount = async (target: AdminUser): Promise<void> => {
    try {
      await api(`/api/admin/users/${target.id}`, { method: 'PATCH', body: JSON.stringify({ disabled: target.disabledAt === undefined }) }, csrf)
      await loadUsers()
    } catch (reason) { setAdminError(reason instanceof Error ? reason.message : '账号状态修改失败') }
  }
  const resetPassword = async (target: AdminUser): Promise<void> => {
    const password = window.prompt(`为 @${target.username} 设置新密码（至少 8 位）`)
    if (password === null) return
    try {
      await api(`/api/admin/users/${target.id}/reset-password`, { method: 'POST', body: JSON.stringify({ password }) }, csrf)
      window.alert('密码已重置，该账号需要重新登录。')
    } catch (reason) { setAdminError(reason instanceof Error ? reason.message : '密码重置失败') }
  }
  const exportAccount = async (target: AdminUser): Promise<void> => {
    try {
      const headers = new Headers()
      if (csrf !== undefined) headers.set('x-csrf-token', csrf)
      const response = await fetch(`/api/admin/users/${target.id}/export`, { headers, credentials: 'same-origin' })
      if (!response.ok) throw new Error((await response.json() as { error?: string }).error ?? '导出失败')
      const url = URL.createObjectURL(await response.blob())
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = `harness-test-${target.username}.json`
      anchor.click()
      URL.revokeObjectURL(url)
    } catch (reason) { setAdminError(reason instanceof Error ? reason.message : '测试数据导出失败') }
  }
  return (
    <div className="diywx-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <section className="collab-simple-dialog collab-settings-dialog">
        <header><span><strong>通用设置</strong><small>账号与局域网隐私</small></span><button type="button" onClick={onClose}>×</button></header>
        <div className="collab-settings-profile"><AvatarBadge avatar={avatarOf(user)} size={54} /><span><strong>{user.displayName}</strong><small>@{user.username}</small></span></div>
        <div className="collab-privacy-note"><strong>内容隔离已开启</strong><p>私人会话只属于当前账号；多人会话只对群成员开放。宿主配置、凭据和其他会话不会经局域网接口提供。</p></div>
        <section className="collab-settings-section">
          <strong>左侧菜单</strong><small>只显示你需要的功能，设置会跟随当前账号。</small>
          <div className="collab-rail-options">{OPTIONAL_RAIL_ITEMS.map(([id, label]) => (
            <label key={id}><input type="checkbox" checked={!hiddenRailIds.includes(id)} onChange={() => { void toggleRail(id) }} /><span>{label}</span></label>
          ))}</div>
        </section>
        {hostOwner && <section className="collab-settings-section collab-admin-section">
          <strong>测试账号管理</strong><small>仅本机“大白”最高管理员可发号、停用、重置密码和导出本服务器上的测试记录。</small>
          <form className="collab-issue-form" onSubmit={(event) => { void issueAccount(event) }}>
            <input name="username" required minLength={2} maxLength={24} placeholder="登录账号" />
            <input name="displayName" required maxLength={32} placeholder="显示昵称" />
            <input name="password" type="password" required minLength={8} maxLength={128} placeholder="初始密码（至少 8 位）" />
            <button className="collab-primary" type="submit">发放测试账号</button>
          </form>
          <div className="collab-admin-users">{adminUsers.map(target => (
            <div key={target.id}>
              <AvatarBadge avatar={avatarOf(target)} size={34} />
              <span><strong>{target.displayName}{target.serverRole === 'host-owner' ? '（最高管理员）' : ''}</strong><small>@{target.username} · {target.conversationCount} 个私人会话 · {target.roomCount} 个多人会话</small></span>
              {target.serverRole !== 'host-owner' && <div><button type="button" onClick={() => { void toggleAccount(target) }}>{target.disabledAt === undefined ? '停用' : '启用'}</button><button type="button" onClick={() => { void resetPassword(target) }}>重置密码</button><button type="button" onClick={() => { void exportAccount(target) }}>下载测试数据</button></div>}
            </div>
          ))}</div>
        </section>}
        {adminError !== '' && <div className="collab-auth-error collab-settings-error">{adminError}</div>}
        <footer><button type="button" onClick={() => { void logout() }}>退出登录</button><button className="collab-primary" type="button" onClick={onClose}>完成</button></footer>
      </section>
    </div>
  )
}

function PromoteDialog({ conversation, workspaces, csrf, done, onClose }: { conversation: ConversationSummary; workspaces: BootstrapState['workspaces']; csrf?: string; done: (roomId: string) => Promise<void>; onClose: () => void }) {
  const [mode, setMode] = useState<'from-now' | 'summary' | 'full-history'>('from-now')
  const [passwordProtected, setPasswordProtected] = useState(false)
  const [roomPassword, setRoomPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const submit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault()
    if (passwordProtected && roomPassword.trim() === '') {
      setError('启用进群密码后，请填写密码')
      return
    }
    setBusy(true)
    setError('')
    const data = Object.fromEntries(new FormData(event.currentTarget).entries())
    try {
      const result = await api<{ room: RoomSummary }>(`/api/conversations/${conversation.id}/promote`, {
        method: 'POST',
        body: JSON.stringify({ ...data, passwordProtected, ...(passwordProtected ? { roomPassword } : {}), shareMode: mode, confirmFullHistory: mode === 'full-history', agentEnabled: true }),
      }, csrf)
      await done(result.room.id)
    } catch (reason) { setError(reason instanceof Error ? reason.message : '转换失败'); setBusy(false) }
  }
  return (
    <div className="diywx-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onClose() }}>
      <section className="collab-simple-dialog collab-promote-dialog">
        <header><span><strong>转为多人会话</strong><small>原来的微信式聊天界面不会改变</small></span><button type="button" onClick={onClose}>×</button></header>
        <form onSubmit={(event) => { void submit(event) }}>
          <label><span>群聊名称</span><input name="name" required defaultValue={conversation.title} /></label>
          <label><span>协作工作区</span><select name="workspaceId" required defaultValue={conversation.workspaceId ?? workspaces[0]?.id}>{workspaces.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
          <label><span>群聊说明</span><input name="brief" defaultValue={conversation.subtitle} /></label>
          <label className="diywx-new-session-switch"><input type="checkbox" checked={passwordProtected} onChange={(event) => { setPasswordProtected(event.target.checked); if (!event.target.checked) setRoomPassword(''); setError('') }} /><span><strong>启用进群密码</strong><small>默认关闭，避免浏览器自动填入账号密码</small></span></label>
          {passwordProtected && <label><span>进群密码</span><input type="password" value={roomPassword} autoComplete="new-password" maxLength={64} onChange={(event) => { setRoomPassword(event.target.value); setError('') }} /></label>}
          <fieldset><legend>旧聊天开放范围</legend>
            <label className="collab-radio"><input type="radio" checked={mode === 'from-now'} onChange={() => { setMode('from-now') }} /><span><strong>只从现在开始</strong><small>以前的私人内容不共享</small></span></label>
            <label className="collab-radio"><input type="radio" checked={mode === 'summary'} onChange={() => { setMode('summary') }} /><span><strong>只共享确认后的摘要</strong><small>你自己填写允许同事看到的进度</small></span></label>
            <label className="collab-radio"><input type="radio" checked={mode === 'full-history'} onChange={() => { setMode('full-history') }} /><span><strong>共享全部可见聊天历史</strong><small>仅在你明确确认后执行；系统指令、凭据和其他会话仍不共享</small></span></label>
          </fieldset>
          {mode === 'summary' && <label><span>共享摘要</span><textarea name="shareContext" required rows={4} placeholder="只写愿意公开给群成员的上下文" /></label>}
          {error !== '' && <div className="collab-auth-error">{error}</div>}
          <footer><button type="button" disabled={busy} onClick={onClose}>取消</button><button className="collab-primary" type="submit" disabled={busy}>{busy ? '正在转换…' : '确认并生成邀请入口'}</button></footer>
        </form>
      </section>
    </div>
  )
}

function RoomDialog({ detail, me, csrf, reload, privatized, onClose }: { detail: RoomDetail; me: PublicUser; csrf?: string; reload: () => Promise<void>; privatized: (conversationId: string) => Promise<void>; onClose: () => void }) {
  const [invite, setInvite] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const [approvalMode, setApprovalMode] = useState(detail.room.approvalMode ?? 'unanimous')
  const [quietSeconds, setQuietSeconds] = useState(detail.room.quietSeconds ?? 30)
  const [passwordProtected, setPasswordProtected] = useState(detail.room.passwordProtected)
  const [roomPassword, setRoomPassword] = useState('')
  const canManage = ['owner', 'admin'].includes(detail.members[me.id]?.role ?? '')
  const isOwner = detail.members[me.id]?.role === 'owner'
  const createInvite = async (): Promise<void> => {
    try {
      const result = await api<{ code: string }>(`/api/rooms/${detail.room.id}/invites`, { method: 'POST', body: JSON.stringify({ hours: 24, uses: 10 }) }, csrf)
      const url = new URL(location.href)
      url.search = ''
      url.searchParams.set('invite', result.code)
      setInvite(url.toString())
      await navigator.clipboard?.writeText(url.toString())
    } catch (reason) { setError(reason instanceof Error ? reason.message : '邀请创建失败') }
  }
  const toggleAgent = async (): Promise<void> => {
    try {
      await api(`/api/rooms/${detail.room.id}/agent`, { method: 'POST', body: JSON.stringify({ enabled: !detail.room.agent.enabled }) }, csrf)
      await reload()
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Agent 设置失败') }
  }
  const saveSettings = async (): Promise<void> => {
    if (passwordProtected && !detail.room.passwordProtected && roomPassword.trim() === '') {
      setError('启用进群密码后，请填写新密码')
      return
    }
    setBusy(true)
    setError('')
    setNotice('')
    try {
      const result = await api<{ room: RoomSummary & { approvalMode?: string; quietSeconds?: number } }>(`/api/rooms/${detail.room.id}/settings`, {
        method: 'PATCH',
        body: JSON.stringify({ approvalMode, quietSeconds, passwordProtected, ...(roomPassword.trim() === '' ? {} : { roomPassword }) }),
      }, csrf)
      setApprovalMode(result.room.approvalMode ?? approvalMode)
      setQuietSeconds(result.room.quietSeconds ?? quietSeconds)
      setPasswordProtected(result.room.passwordProtected)
      setRoomPassword('')
      setNotice(['running', 'question'].includes(detail.room.agent.state)
        ? '协作规则已保存；当前执行继续使用已确认规则，新设置从下一轮收集开始生效。'
        : '协作规则已保存，将从下一轮消息收集开始生效。')
      await reload()
    } catch (reason) { setError(reason instanceof Error ? reason.message : '协作规则保存失败') }
    setBusy(false)
  }
  const updateMember = async (userId: string, patch: { role?: string; aiAccess?: boolean }): Promise<void> => {
    setBusy(true)
    setError('')
    try {
      await api(`/api/rooms/${detail.room.id}/members/${userId}`, { method: 'PATCH', body: JSON.stringify(patch) }, csrf)
      await reload()
    } catch (reason) { setError(reason instanceof Error ? reason.message : '成员权限修改失败') }
    setBusy(false)
  }
  const removeMember = async (userId: string): Promise<void> => {
    if (!window.confirm('确认将这位成员移出多人会话？')) return
    setBusy(true)
    setError('')
    try {
      await api(`/api/rooms/${detail.room.id}/members/${userId}`, { method: 'DELETE' }, csrf)
      await reload()
    } catch (reason) { setError(reason instanceof Error ? reason.message : '移除成员失败') }
    setBusy(false)
  }
  const proposeNow = async (): Promise<void> => {
    setBusy(true)
    setError('')
    try {
      await api(`/api/rooms/${detail.room.id}/propose`, { method: 'POST', body: '{}' }, csrf)
      await reload()
    } catch (reason) { setError(reason instanceof Error ? reason.message : '暂时没有可整理的需求') }
    setBusy(false)
  }
  const privatize = async (): Promise<void> => {
    if (!window.confirm('确认收回为私人会话？收回后邀请链接失效，只有你能继续看到。')) return
    setBusy(true)
    setError('')
    try {
      const result = await api<{ conversation: ConversationSummary }>(`/api/rooms/${detail.room.id}/privatize`, { method: 'POST', body: '{}' }, csrf)
      await privatized(result.conversation.id)
    } catch (reason) { setError(reason instanceof Error ? reason.message : '收回私人会话失败') }
    setBusy(false)
  }
  return (
    <div className="diywx-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <section className="collab-simple-dialog collab-room-dialog">
        <header><span><strong>{detail.room.name}</strong><small>{detail.room.memberCount} 人 · 多人会话</small></span><button type="button" onClick={onClose}>×</button></header>
        <div className="collab-room-summary"><AvatarBadge avatar={{ glyph: 'whale', color: '#2f6bff' }} size={52} /><span><strong>{detail.room.brief || '一起聊天，也一起做事'}</strong><small>{detail.workspace.label} · Agent {detail.room.agent.enabled ? '已开启' : '已关闭'}</small></span></div>
        {canManage && <div className="collab-room-actions"><button type="button" disabled={busy} onClick={() => { void createInvite() }}>生成邀请链接</button><button type="button" disabled={busy} onClick={() => { void toggleAgent() }}>{detail.room.agent.enabled ? '关闭 Agent' : '开启 Agent'}</button><button type="button" disabled={busy || !detail.room.agent.enabled} onClick={() => { void proposeNow() }}>立即整理本轮需求</button></div>}
        {invite !== '' && <label><span>邀请链接（已复制）</span><input readOnly value={invite} onFocus={(event) => { event.currentTarget.select() }} /></label>}
        {canManage && <section className="collab-room-rules">
          <strong>Agent 协作规则</strong>
          <div><label><span>执行确认</span><select value={approvalMode} onChange={(event) => { setApprovalMode(event.target.value) }}><option value="unanimous">有执行权成员全员确认</option><option value="admin">群主或管理员确认</option><option value="auto">无冲突时自动执行</option></select></label><label><span>静默等待（秒）</span><input type="number" min={5} max={120} value={quietSeconds} onChange={(event) => { setQuietSeconds(Number(event.target.value)) }} /></label></div>
          <label className="diywx-new-session-switch"><input type="checkbox" checked={passwordProtected} onChange={(event) => { setPasswordProtected(event.target.checked); if (!event.target.checked) setRoomPassword(''); setError('') }} /><span><strong>启用进群密码</strong><small>{detail.room.passwordProtected ? '当前已启用；关闭并保存即可清除误设密码' : '当前未启用'}</small></span></label>
          {passwordProtected && <label><span>{detail.room.passwordProtected ? '更换密码（留空则保持不变）' : '设置进群密码'}</span><input type="password" value={roomPassword} maxLength={64} autoComplete="new-password" onChange={(event) => { setRoomPassword(event.target.value); setError('') }} /></label>}
          <button type="button" disabled={busy} onClick={() => { void saveSettings() }}>保存协作规则</button>
        </section>}
        <div className="collab-member-list">{Object.entries(detail.members).map(([id, member]) => {
          const user = detail.users[id]
          const manageable = canManage && member.role !== 'owner' && !(detail.members[me.id]?.role === 'admin' && member.role === 'admin')
          const online = id === me.id || user?.online === true
          return <div key={id}><AvatarBadge avatar={avatarOf(user)} size={34} /><span><strong>{user?.displayName ?? '成员'}{id === me.id ? '（我）' : ''}</strong><small>{online ? '🟢 在线' : '⚪ 离线'} · {member.role === 'owner' ? '群主' : member.role === 'admin' ? '管理员' : member.role === 'observer' ? '旁听成员' : '成员'} · {member.aiAccess ? '参与 AI 收集' : '对 AI 静默（消息仍正常显示）'}</small></span>{manageable && <span className="collab-member-controls"><select aria-label={`设置 ${user?.displayName ?? '成员'} 的角色`} value={member.role} disabled={busy} onChange={(event) => { void updateMember(id, { role: event.target.value }) }}><option value="member">成员</option><option value="observer">旁听</option>{isOwner && <option value="admin">管理员</option>}</select><button type="button" disabled={busy} onClick={() => { void updateMember(id, { aiAccess: !member.aiAccess }) }}>{member.aiAccess ? '设为对 AI 静默' : '恢复参与 AI'}</button><button className="collab-danger" type="button" disabled={busy} onClick={() => { void removeMember(id) }}>移出</button></span>}</div>
        })}</div>
        {notice !== '' && <div className="collab-settings-notice" role="status">{notice}</div>}
        {error !== '' && <div className="collab-auth-error">{error}</div>}
        <footer><span className="collab-room-security">🔒 只共享本群被授权的内容</span>{isOwner && Object.keys(detail.members).length === 1 && <button type="button" disabled={busy} onClick={() => { void privatize() }}>收回为私人会话</button>}<button className="collab-primary" type="button" onClick={onClose}>完成</button></footer>
      </section>
    </div>
  )
}

function App() {
  const [bootstrap, setBootstrap] = useState<BootstrapState | null>(null)
  const [selectedId, setSelectedId] = useState<string | undefined>(() => new URLSearchParams(location.search).get('session') ?? undefined)
  const [detail, setDetail] = useState<DetailState | null>(null)
  const [loading, setLoading] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [collaborationOpen, setCollaborationOpen] = useState(false)
  const [error, setError] = useState('')
  const [clock, setClock] = useState(() => Date.now())
  const [presenceRevision, setPresenceRevision] = useState(0)
  const [optimisticPrivate, setOptimisticPrivate] = useState<{ conversationId: string; id: string; text: string; files: ChatFileView[]; createdAt: number } | null>(null)
  const initializedFor = useRef<string | null>(null)
  const syncedConversations = useRef<Record<string, string>>({})
  const loadedClientVersion = useRef<string | null>(null)
  const handledInvite = useRef<string | null>(null)

  const refresh = async (): Promise<void> => {
    const state = await api<BootstrapState>(`/api/bootstrap${location.search}`)
    if (loadedClientVersion.current !== null && loadedClientVersion.current !== state.clientVersion) {
      location.reload()
      return
    }
    loadedClientVersion.current = state.clientVersion
    if (state.user !== null && initializedFor.current !== state.user.id) {
      applyServerUi(state)
      initializedFor.current = state.user.id
    }
    setBootstrap(state)
    if (state.user !== null && selectedId === undefined) {
      const first = state.rooms[0] ? sessionKey('room', state.rooms[0].id) : state.conversations[0] ? sessionKey('private', state.conversations[0].id) : undefined
      setSelectedId(first)
    }
  }

  useEffect(() => { void refresh().catch((reason) => { setError(reason instanceof Error ? reason.message : '页面加载失败') }) }, [])

  useEffect(() => {
    if (bootstrap?.user === null || bootstrap?.user === undefined || bootstrap.csrf === undefined) return
    const storageKey = 'dsh-collab.presence-client.v1'
    let clientId = sessionStorage.getItem(storageKey)
    if (!clientId) {
      clientId = `page_${typeof crypto.randomUUID === 'function' ? crypto.randomUUID().replaceAll('-', '') : `${Date.now()}_${Math.random().toString(36).slice(2)}`}`
      sessionStorage.setItem(storageKey, clientId)
    }
    const send = async (active: boolean, keepalive = false): Promise<boolean> => {
      try {
        const response = await fetch('/api/presence', {
          method: 'POST', credentials: 'same-origin', keepalive,
          headers: { 'content-type': 'application/json', 'x-csrf-token': bootstrap.csrf! },
          body: JSON.stringify({ clientId, active }),
        })
        return response.ok
      } catch { return false }
    }
    void send(true).then((ok) => { if (ok) setPresenceRevision(value => value + 1) })
    const timer = window.setInterval(() => { void send(true) }, 12_000)
    const leave = (): void => { void send(false, true) }
    const restore = (): void => { void send(true).then((ok) => { if (ok) setPresenceRevision(value => value + 1) }) }
    window.addEventListener('pagehide', leave)
    window.addEventListener('pageshow', restore)
    return () => {
      window.clearInterval(timer)
      window.removeEventListener('pagehide', leave)
      window.removeEventListener('pageshow', restore)
      leave()
    }
  }, [bootstrap?.user?.id, bootstrap?.csrf])

  useEffect(() => {
    const inviteCode = new URLSearchParams(location.search).get('invite')?.trim() ?? ''
    if (bootstrap?.user === null || bootstrap?.user === undefined || inviteCode === '' || handledInvite.current === inviteCode) return
    handledInvite.current = inviteCode
    void (async () => {
      try {
        let roomPassword = ''
        let result: { room: RoomSummary }
        try {
          result = await api('/api/invites/accept', {
            method: 'POST', body: JSON.stringify({ inviteCode, roomPassword }),
          }, bootstrap.csrf)
        } catch (cause) {
          if (!(cause instanceof Error) || !cause.message.includes('群聊密码错误')) throw cause
          roomPassword = window.prompt('这个群聊设置了进群密码，请输入密码') ?? ''
          if (roomPassword === '') throw new Error('未输入群聊密码，暂未加入新群')
          result = await api('/api/invites/accept', {
            method: 'POST', body: JSON.stringify({ inviteCode, roomPassword }),
          }, bootstrap.csrf)
        }
        const url = new URL(location.href)
        url.searchParams.delete('invite')
        history.replaceState(null, '', url)
        setSelectedId(sessionKey('room', result.room.id))
        await refresh()
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : '加入新群聊失败')
      }
    })()
  }, [bootstrap?.user?.id, bootstrap?.csrf])

  useEffect(() => {
    if (!bootstrap?.rooms.some(room => room.agent.state === 'collecting')) return
    const timer = window.setInterval(() => { setClock(Date.now()) }, 500)
    return () => { window.clearInterval(timer) }
  }, [bootstrap?.rooms])

  const loadDetail = async (key = selectedId): Promise<void> => {
    if (bootstrap?.user === null || key === undefined) { setDetail(null); return }
    const target = parseSessionKey(key)
    if (target === undefined) return
    setLoading(true)
    try {
      if (target.kind === 'private') {
        const value = await api<Omit<PrivateDetail, 'kind'>>(`/api/conversations/${target.id}`)
        setDetail({ ...value, kind: 'private' })
      } else {
        const value = await api<Omit<RoomDetail, 'kind'>>(`/api/rooms/${target.id}`)
        setDetail({ ...value, kind: 'room' })
        // GET /api/rooms/:id marks this room as read on the server. Mirror that
        // immediately in the bootstrap summary so switching away cannot revive
        // a stale badge before the next bootstrap refresh.
        setBootstrap(current => current === null ? current : {
          ...current,
          rooms: current.rooms.map(room => room.id === target.id ? { ...room, unread: 0 } : room),
        })
      }
      setError('')
    } catch (reason) { setError(reason instanceof Error ? reason.message : '会话读取失败') }
    setLoading(false)
  }

  useEffect(() => { void loadDetail() }, [selectedId, bootstrap?.csrf, presenceRevision])

  useEffect(() => {
    const target = selectedId === undefined ? undefined : parseSessionKey(selectedId)
    const privateRunning = detail?.kind === 'private' && detail.conversation.id === target?.id && detail.conversation.running
    if ((!loading && !privateRunning) || target?.kind !== 'private' || bootstrap?.user === null || bootstrap?.user === undefined) return
    let cancelled = false
    const poll = async (): Promise<void> => {
      try {
        const value = await api<Omit<PrivateDetail, 'kind'>>(`/api/conversations/${target.id}`)
        if (!cancelled) setDetail({ ...value, kind: 'private' })
      } catch {
        // The foreground send request owns user-facing errors. A transient
        // history poll failure must not replace it or stop the Agent run.
      }
    }
    const timer = window.setInterval(() => { void poll() }, 1_400)
    void poll()
    return () => { cancelled = true; window.clearInterval(timer) }
  }, [loading, selectedId, bootstrap?.user?.id, detail?.kind === 'private' ? detail.conversation.running : false])

  useEffect(() => {
    const target = selectedId === undefined ? undefined : parseSessionKey(selectedId)
    if (target?.kind !== 'room' || bootstrap?.user === null) return
    const events = new EventSource(`/api/rooms/${target.id}/events`)
    const reload = (): void => { void refresh(); void loadDetail(selectedId) }
    events.addEventListener('message', reload)
    events.addEventListener('state', reload)
    events.addEventListener('proposal', reload)
    events.addEventListener('run', reload)
    events.addEventListener('members', reload)
    events.addEventListener('settings', reload)
    events.addEventListener('agent', reload)
    events.addEventListener('mode', reload)
    events.addEventListener('progress', reload)
    events.addEventListener('question', reload)
    return () => { events.close() }
  }, [selectedId, bootstrap?.user?.id])

  useEffect(() => {
    if (bootstrap?.user === null || bootstrap?.user === undefined) return
    const handler = (event: Event): void => {
      const payload = (event as CustomEvent<Record<string, unknown>>).detail ?? {}
      const profile = payload.userProfile as { name?: string } | undefined
      const userAvatar = payload.userAvatar as AvatarView | undefined
      if (profile !== undefined || userAvatar !== undefined) {
        const nextAvatar = userAvatar ?? avatarOf(bootstrap.user)
        void api('/api/profile', { method: 'PATCH', body: JSON.stringify({ displayName: profile?.name?.trim() || bootstrap.user?.displayName, avatarView: nextAvatar, avatar: nextAvatar.glyph === 'image' ? 'robot' : nextAvatar.glyph, color: nextAvatar.color }) }, bootstrap.csrf).then(refresh).catch(() => {})
      }
      const ui = {
        ...(Array.isArray(payload.hiddenRailIds) ? { hiddenRailIds: payload.hiddenRailIds } : {}),
        ...(Array.isArray(payload.railOrder) ? { railOrder: payload.railOrder } : {}),
        ...(Array.isArray(payload.pinnedSessionIds) ? { pinnedSessionIds: payload.pinnedSessionIds } : {}),
        ...(typeof payload.pinnedNote === 'string' ? { pinnedNote: payload.pinnedNote } : {}),
        ...(payload.sessionView === 'workspace' || payload.sessionView === 'recent' ? { sessionView: payload.sessionView } : {}),
      }
      if (Object.keys(ui).length > 0) void api('/api/profile', { method: 'PATCH', body: JSON.stringify({ ui }) }, bootstrap.csrf).catch(() => {})
      const avatars = payload.sessionAvatars as Record<string, AvatarView> | undefined
      const subtitles = payload.subtitles as Record<string, string> | undefined
      for (const conversation of bootstrap.conversations) {
        const key = sessionKey('private', conversation.id)
        const avatarView = avatars?.[key]
        const subtitle = subtitles?.[key]
        const signature = JSON.stringify({ avatarView, subtitle })
        if ((avatarView === undefined && subtitle === undefined) || syncedConversations.current[key] === signature) continue
        syncedConversations.current[key] = signature
        void api(`/api/conversations/${conversation.id}`, { method: 'PATCH', body: JSON.stringify({ avatarView, subtitle }) }, bootstrap.csrf).catch(() => {})
      }
    }
    window.addEventListener('diywx-ui-profile-change', handler)
    return () => { window.removeEventListener('diywx-ui-profile-change', handler) }
  }, [bootstrap?.user?.id, bootstrap?.csrf, bootstrap?.conversations])

  const roomImageRoomId = detail?.kind === 'room' ? detail.room.id : undefined
  const loadRoomImage = useCallback(async (image: ChatImageView): Promise<string> => {
    if (roomImageRoomId === undefined) throw new Error('图片不属于当前群聊')
    const response = await fetch(`/api/rooms/${roomImageRoomId}/attachments/${encodeURIComponent(image.id)}`, { credentials: 'same-origin' })
    if (!response.ok) throw new Error(`图片加载失败（${response.status}）`)
    return URL.createObjectURL(await response.blob())
  }, [roomImageRoomId])

  if (bootstrap === null) return <div className="collab-loading">正在打开 Harness…</div>
  if (bootstrap.user === null) return <AuthScreen bootstrap={bootstrap} refresh={refresh} />

  const sessions: SessionItemView[] = [
    ...bootstrap.rooms.map((room) => {
      const id = sessionKey('room', room.id)
      return { id, title: room.name, preview: room.brief || `${room.memberCount} 人多人会话`, time: formatTime(room.updatedAt), updatedAt: room.updatedAt, workspaceId: room.workspaceId, ...(room.avatarView === undefined ? {} : { avatar: room.avatarView }), running: ['running', 'question'].includes(room.agent.state), completed: room.agent.state === 'idle', unread: room.unread > 0 && selectedId !== id }
    }),
    ...bootstrap.conversations.map(conversation => ({ id: sessionKey('private', conversation.id), title: conversation.title, preview: conversation.subtitle, time: formatTime(conversation.updatedAt), updatedAt: conversation.updatedAt, ...(conversation.workspaceId === undefined ? {} : { workspaceId: conversation.workspaceId }), running: conversation.running, usage: { uncachedInputTokens: conversation.tokenUsage ?? 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 } })),
  ]
  const workspaces: WorkspaceGroupView[] = bootstrap.workspaces.map(workspace => ({ id: workspace.id, title: workspace.label, path: workspace.label, sessionIds: sessions.filter(session => session.workspaceId === workspace.id).map(session => session.id) }))
  const messages: ChatMessageView[] = detail?.kind === 'private'
    ? detail.messages.map((message, index) => ({
      id: message.id ?? `private-${index}`,
      role: message.role === 'user' ? 'user' : message.role === 'status' ? 'status' : 'assistant', body: message.text ?? '',
      ...(message.reasoning ? { reasoning: message.reasoning } : {}), ...(message.tool ? { tool: message.tool } : {}),
      ...(message.files?.length ? { files: message.files.map(file => ({ ...file, downloadUrl: `/api/conversations/${detail.conversation.id}/files/${encodeURIComponent(file.id)}` })) } : {}),
      ...(message.createdAt ? { createdAt: message.createdAt, time: formatTime(message.createdAt) } : {}),
    }))
    : detail?.kind === 'room'
      ? detail.messages.map((message) => {
        if (message.kind === 'system' || message.kind === 'agent-status') return { id: message.id, role: 'status', body: message.text, createdAt: message.createdAt, time: formatTime(message.createdAt) }
        if (message.kind === 'agent-tool' && message.tool) return {
          id: message.id, role: 'assistant', body: '', tool: message.tool,
          createdAt: message.createdAt, time: formatTime(message.createdAt), authorName: detail.room.name,
          authorAvatar: { glyph: 'whale', color: '#2f6bff' } as AvatarView,
        }
        const author = message.userId === null ? undefined : detail.users[message.userId]
        const own = message.userId === bootstrap.user?.id && message.kind !== 'agent' && message.kind !== 'history-assistant'
        return {
          id: message.id,
          role: own ? 'user' : 'assistant',
          body: message.text,
          ...(message.images?.length ? { images: message.images } : {}),
          ...(message.files?.length ? { files: message.files.map(file => ({ ...file, downloadUrl: `/api/rooms/${detail.room.id}/files/${encodeURIComponent(file.id)}` })) } : {}),
          ...(['chat', 'history-user'].includes(message.kind) ? { human: true } : {}),
          ...(message.reasoning || message.progressStatuses?.length
            ? { reasoning: [message.reasoning, ...(message.progressStatuses ?? [])].filter(Boolean).join('\n') }
            : {}),
          createdAt: message.createdAt,
          time: formatTime(message.createdAt),
          ...(!own ? { authorName: message.kind === 'agent' || message.kind === 'history-assistant' ? detail.room.name : author?.displayName ?? '成员', authorAvatar: message.kind === 'agent' || message.kind === 'history-assistant' ? { glyph: 'whale', color: '#2f6bff' } as AvatarView : avatarOf(author) } : {}),
        } as ChatMessageView
      })
      : []
  if (detail?.kind === 'room' && detail.room.agent.state === 'collecting') {
    const remaining = Math.max(0, Math.ceil((Number(detail.room.agent.silenceUntil ?? clock) - clock) / 1_000))
    const body = detail.room.collaborationMode === 'chat'
      ? '群聊模式中 AI 完全静默；切换到 AI 模式后的首轮需求会一次性参考这段群聊'
      : detail.room.collaborationMode === 'discussion'
        ? remaining > 0 ? `AI 正在像群成员一样观察讨论；还剩 ${remaining} 秒后自主判断是否发言` : '静默倒计时结束，AI 正在判断是否参与讨论'
        : detail.room.collaborationMode === 'application'
          ? remaining > 0 ? `应用服务已收到有效指令；还剩 ${remaining} 秒后处理` : '静默倒计时结束，应用服务正在处理指令'
          : remaining > 0 ? `正在等待群内继续发言；还剩 ${remaining} 秒后整理本轮需求` : '静默倒计时结束，正在整理本轮需求'
    messages.push({ id: `room-state:${detail.room.id}:collecting`, role: 'status', body })
  }
  if (detail?.kind === 'room' && detail.progress !== undefined) {
    if ((detail.progress.steps?.length ?? 0) > 0) {
      for (const step of detail.progress.steps ?? []) {
        messages.push(step.kind === 'status'
          ? { id: `room-progress:${detail.progress.runId}:${step.id}`, role: 'status', body: step.text ?? '' }
          : step.kind === 'tool' && step.tool
            ? { id: `room-progress:${detail.progress.runId}:${step.id}`, role: 'assistant', body: '', tool: step.tool, authorName: detail.room.name, authorAvatar: { glyph: 'whale', color: '#2f6bff' } }
            : {
              id: `room-progress:${detail.progress.runId}:${step.id}`,
              role: 'assistant', body: step.text ?? '',
              ...(step.reasoning ? { reasoning: step.reasoning } : {}),
              pending: step.pending !== false,
              authorName: detail.room.name,
              authorAvatar: { glyph: 'whale', color: '#2f6bff' },
            })
      }
    } else {
      const reasoning = [detail.progress.reasoning, ...(detail.progress.statuses ?? [])].filter(Boolean).join('\n')
      messages.push({
        id: `room-progress:${detail.progress.runId}`,
        role: 'assistant',
        body: detail.progress.text?.trim() || '正在处理本轮协作需求…',
        ...(reasoning ? { reasoning } : {}),
        pending: true,
        authorName: detail.room.name,
        authorAvatar: { glyph: 'whale', color: '#2f6bff' },
      })
    }
  }
  if (detail?.kind === 'private' && detail.progress !== undefined) {
    if ((detail.progress.steps?.length ?? 0) > 0) {
      for (const step of detail.progress.steps ?? []) {
        messages.push(step.kind === 'status'
          ? { id: `private-progress:${detail.conversation.id}:${step.id}`, role: 'status', body: step.text ?? '' }
          : step.kind === 'tool' && step.tool
            ? { id: `private-progress:${detail.conversation.id}:${step.id}`, role: 'assistant', body: '', tool: step.tool }
            : { id: `private-progress:${detail.conversation.id}:${step.id}`, role: 'assistant', body: step.text ?? '', ...(step.reasoning ? { reasoning: step.reasoning } : {}), pending: step.pending !== false })
      }
    } else {
      const reasoning = [detail.progress.reasoning, ...(detail.progress.statuses ?? [])].filter(Boolean).join('\n')
      messages.push({
        id: `private-progress:${detail.conversation.id}`,
        role: 'assistant',
        body: detail.progress.text?.trim() || '正在处理你的需求…',
        ...(reasoning ? { reasoning } : {}),
        pending: true,
      })
    }
  }
  if (detail?.kind === 'private' && optimisticPrivate?.conversationId === detail.conversation.id) {
    const alreadyVisible = detail.messages.some(message => message.role === 'user' && message.text === optimisticPrivate.text && Number(message.createdAt ?? 0) >= optimisticPrivate.createdAt - 5_000)
    if (!alreadyVisible) messages.push({ id: optimisticPrivate.id, role: 'user', body: optimisticPrivate.text, ...(optimisticPrivate.files.length ? { files: optimisticPrivate.files } : {}), createdAt: optimisticPrivate.createdAt, time: formatTime(optimisticPrivate.createdAt) })
  }
  const current = selectedId === undefined ? undefined : sessions.find(session => session.id === selectedId)
  const send = async (text: string, images: readonly File[] = [], files: readonly File[] = []): Promise<void> => {
    if (selectedId === undefined) return
    const target = parseSessionKey(selectedId)
    if (target === undefined) return
    if (target.kind === 'private' && images.length > 0) throw new Error('3091 私人会话的图片发送仍在接入；当前请在群聊中发送，或使用本机 3080 私人会话')
    setLoading(true)
    if (target.kind === 'private') setOptimisticPrivate({
      conversationId: target.id, id: `optimistic-${Date.now()}`, text,
      files: files.map((file, index) => ({ id: `pending-${index}`, name: file.name, mediaType: file.type, size: file.size })),
      createdAt: Date.now(),
    })
    try {
      if (target.kind === 'private') await api(`/api/conversations/${target.id}/messages`, {
        method: 'POST', body: JSON.stringify({ text, ...(files.length > 0 ? { files: await Promise.all(files.map(encodedFile)) } : {}) }),
      }, bootstrap.csrf)
      else await api(`/api/rooms/${target.id}/messages`, {
        method: 'POST',
        body: JSON.stringify({ text, ...(images.length > 0 ? { images: await Promise.all(images.map(encodedRoomImage)) } : {}), ...(files.length > 0 ? { files: await Promise.all(files.map(encodedFile)) } : {}) }),
      }, bootstrap.csrf)
      await refresh()
      await loadDetail(selectedId)
    } finally {
      setOptimisticPrivate(null)
      setLoading(false)
    }
  }

  const newSession = async (draft: NewSessionDraft): Promise<string> => {
    const workspaceId = draft.workspaceId ?? (draft.visibility === 'shared' ? bootstrap.workspaces[0]?.id : undefined)
    const result = await api<{ kind: 'room' | 'conversation'; room?: RoomSummary; conversation?: ConversationSummary }>('/api/conversations', {
      method: 'POST',
      body: JSON.stringify({ ...draft, workspaceId, avatarView: draft.avatar, name: draft.title || '多人协作', title: draft.title || '新会话' }),
    }, bootstrap.csrf)
    await refresh()
    const key = result.kind === 'room' ? sessionKey('room', result.room!.id) : sessionKey('private', result.conversation!.id)
    setSelectedId(key)
    return key
  }

  const selectedPrivate = detail?.kind === 'private' ? detail.conversation : undefined
  const selectedRoom = detail?.kind === 'room' ? detail : undefined
  const pendingProposal = selectedRoom?.proposals.find(proposal => proposal.status === 'awaiting')
  const pendingDecisionSummary = pendingProposal === undefined ? '' : proposalDecisionCopy(pendingProposal)
  const pendingDecisionConflict = pendingProposal === undefined ? false : proposalHasExplicitConflict(pendingProposal, pendingDecisionSummary)
  const collaborationDecision: CollaborationDecisionView | undefined = selectedRoom === undefined || pendingProposal === undefined || bootstrap.user === null
    ? undefined
    : {
      key: pendingProposal.id,
      title: pendingDecisionConflict ? '这些意见不能直接视为同一方案，请先在群里确认取舍' : '请确认 AI 整理的本轮需求是否准确',
      summary: pendingDecisionSummary,
      conflict: pendingDecisionConflict,
      confirmed: pendingProposal.eligibleVoterIds.filter(id => pendingProposal.confirmations[id] !== undefined).length,
      required: pendingProposal.eligibleVoterIds.length,
      voters: pendingProposal.eligibleVoterIds.map(id => ({
        id,
        name: selectedRoom.users[id]?.displayName ?? '成员',
        confirmed: pendingProposal.confirmations[id] !== undefined,
      })),
      canDecide: pendingProposal.eligibleVoterIds.includes(bootstrap.user.id),
      decided: pendingProposal.confirmations[bootstrap.user.id] !== undefined,
      decide: async (approve, reason) => {
        await api(`/api/rooms/${selectedRoom.room.id}/proposals/${pendingProposal.id}/decision`, {
          method: 'POST', body: JSON.stringify({ approve, ...(reason ? { reason } : {}) }),
        }, bootstrap.csrf)
        await refresh()
        await loadDetail(selectedId)
      },
    }
  const selectedCreatedAt = selectedPrivate?.createdAt ?? selectedRoom?.room.createdAt
  const selectedUpdatedAt = selectedPrivate?.updatedAt ?? selectedRoom?.room.updatedAt
  const loadUsage = async (): Promise<SessionUsageHistoryView> => ({ samples: {}, failures: [] })
  const pendingSource = selectedRoom?.pendingQuestion ?? (detail?.kind === 'private' ? detail.pendingQuestion : undefined)
  const pendingQuestion: PendingQuestionView | undefined = pendingSource === undefined
    ? undefined
    : {
      key: pendingSource.key,
      questions: pendingSource.questions,
      canAnswer: pendingSource.canAnswer,
      answer: async (answers) => {
        const path = selectedRoom !== undefined
          ? `/api/rooms/${selectedRoom.room.id}/questions/${encodeURIComponent(pendingSource.key)}/answer`
          : `/api/conversations/${selectedPrivate!.id}/questions/${encodeURIComponent(pendingSource.key)}/answer`
        await api(path, {
          method: 'POST', body: JSON.stringify({ answers }),
        }, bootstrap.csrf)
        await refresh()
        await loadDetail(selectedId)
      },
      cancel: async () => {
        const path = selectedRoom !== undefined
          ? `/api/rooms/${selectedRoom.room.id}/questions/${encodeURIComponent(pendingSource.key)}/answer`
          : `/api/conversations/${selectedPrivate!.id}/questions/${encodeURIComponent(pendingSource.key)}/answer`
        await api(path, {
          method: 'POST', body: JSON.stringify({ cancel: true }),
        }, bootstrap.csrf)
        await refresh()
        await loadDetail(selectedId)
      },
    }

  return (
    <>
      <WechatShellFrame
        sessions={sessions}
        workspaces={workspaces}
        {...selectedId === undefined ? {} : { currentSessionId: selectedId }}
        workspaceCount={workspaces.length}
        multiplayerEnabled
        onOpenSession={setSelectedId}
        onOpenSessionWindow={(id) => { const url = new URL(location.href); url.searchParams.set('session', id); window.open(url, '_blank', 'noopener,noreferrer') }}
        onReorderSession={() => {}}
        onNewSession={newSession}
        onAddWorkspace={() => { setSettingsOpen(true) }}
        onOpenTaskBoard={() => { setSettingsOpen(true) }}
        onOpenSettings={() => { setSettingsOpen(true) }}
        onLoadSessionPreviews={async ids => Object.fromEntries(await Promise.all(ids.map(async (id) => {
          const target = parseSessionKey(id)
          if (target === undefined) return [id, ''] as const
          try {
            if (target.kind === 'private') {
              const value = await api<Omit<PrivateDetail, 'kind'>>(`/api/conversations/${target.id}`)
              const latest = [...value.messages].reverse().find(message => message.role !== 'status' && String(message.text ?? '').trim() !== '')
              return [id, latest?.text ?? value.conversation.subtitle] as const
            }
            // Reading a room detail also marks it as read. Do not clear group
            // unread badges merely to refresh a sidebar preview.
            return [id, sessions.find(session => session.id === id)?.preview ?? ''] as const
          } catch { return [id, sessions.find(session => session.id === id)?.preview ?? ''] as const }
        })))}
        onLoadSessionModels={async ids => Object.fromEntries(await Promise.all(ids.map(async (id) => {
          const target = parseSessionKey(id)
          if (target?.kind === 'room') {
            const room = bootstrap.rooms.find(candidate => candidate.id === target.id)
            return [id, { provider: room?.modelSelection?.provider ?? 'DeepSeek', model: room?.modelSelection?.model ?? '待选择' }] as const
          }
          if (target?.kind !== 'private') return [id, { provider: 'DeepSeek', model: '待选择' }] as const
          try {
            const value = await api<{ current?: { provider?: string; model?: string } }>(`/api/conversations/${target.id}/models`)
            return [id, { provider: value.current?.provider ?? 'DeepSeek', model: value.current?.model ?? '待选择' }] as const
          } catch { return [id, { provider: 'DeepSeek', model: '待选择' }] as const }
        }))) }
        onLoadSessionUsage={loadUsage}
        onLoadPlugins={async () => []}
        onLoadServices={async () => (await api<{ services: DshServiceView[] }>('/api/services')).services}
        onStopService={async (id) => {
          await api(`/api/services/${encodeURIComponent(id)}/stop`, { method: 'POST', body: '{}' }, bootstrap.csrf)
        }}
        renderConversation={(avatar, userAvatar, subtitle, onSubtitleChange, onAvatarPreview, workspaceLabel) => (
          <ConversationPane
            {...selectedId === undefined ? {} : { sessionId: selectedId }}
            avatar={avatar}
            userAvatar={userAvatar}
            title={current?.title ?? '新会话'}
            {...subtitle !== undefined ? { subtitle } : current?.preview !== undefined ? { subtitle: current.preview } : {}}
            workspace={workspaceLabel ?? (selectedRoom?.workspace.label ?? selectedPrivate?.workspaceLabel ?? '私人空间')}
            {...workspaceLabel === undefined ? {} : { workspaceLabel }}
            mode={selectedRoom ? selectedRoom.room.collaborationMode === 'chat' ? '群聊模式' : selectedRoom.room.collaborationMode === 'discussion' ? '普通讨论' : selectedRoom.room.collaborationMode === 'application' ? '应用服务' : '协作执行' : '标准模式'}
            branch="master"
            access={selectedRoom ? selectedRoom.room.collaborationMode === 'chat' ? 'AI 已暂停' : selectedRoom.room.collaborationMode === 'discussion' ? 'Read Only' : selectedRoom.room.aiAccess ? '参与 AI 收集' : '对 AI 静默' : 'Workspace Write'}
            model={selectedRoom?.room.modelSelection?.model ?? (selectedRoom ? '待选择' : 'DeepSeek')}
            messages={messages}
            imageLimits={{
              maxImageBytes: 5 * 1024 * 1024,
              maxImagesPerMessage: 4,
              maxMessageImageBytes: 12 * 1024 * 1024,
              maxImagePixels: 40_000_000,
              maxImageDimension: 16_384,
              mediaTypes: ['image/png', 'image/jpeg', 'image/webp', 'image/gif'],
            }}
            onLoadImage={loadRoomImage}
            {...pendingQuestion === undefined ? {} : { pendingQuestion }}
            running={loading || Boolean(current?.running)}
            {...selectedCreatedAt === undefined ? {} : { createdAt: selectedCreatedAt }}
            {...selectedUpdatedAt === undefined ? {} : { updatedAt: selectedUpdatedAt }}
            totalTokens={selectedPrivate?.tokenUsage ?? 0}
            disabled={current === undefined}
            onSend={send}
            onCancel={() => {
              if (selectedPrivate === undefined && selectedRoom === undefined) return
              void (async () => {
                try {
                  const path = selectedPrivate !== undefined
                    ? `/api/conversations/${selectedPrivate.id}/cancel`
                    : `/api/rooms/${selectedRoom!.room.id}/cancel`
                  await api(path, { method: 'POST', body: '{}' }, bootstrap.csrf)
                  setLoading(false)
                  await refresh()
                  await loadDetail(selectedId)
                } catch (cause) {
                  setError(cause instanceof Error ? cause.message : String(cause))
                }
              })()
            }}
            onRenameTitle={async (title) => { if (selectedPrivate) { await api(`/api/conversations/${selectedPrivate.id}`, { method: 'PATCH', body: JSON.stringify({ title }) }, bootstrap.csrf); await refresh() } }}
            onRenameSubtitle={async (value) => { onSubtitleChange(value); if (selectedPrivate) { await api(`/api/conversations/${selectedPrivate.id}`, { method: 'PATCH', body: JSON.stringify({ subtitle: value }) }, bootstrap.csrf); await refresh() } }}
            onPreviewAvatar={onAvatarPreview}
            {...selectedPrivate === undefined ? {} : {
              onDownloadWorkspace: async () => {
                const response = await fetch(`/api/conversations/${selectedPrivate.id}/download`, { credentials: 'same-origin' })
                if (!response.ok) {
                  const payload = await response.json().catch(() => ({})) as { error?: string }
                  throw new Error(payload.error ?? `代码包下载失败（${response.status}）`)
                }
                const blob = await response.blob()
                const url = URL.createObjectURL(blob)
                const link = document.createElement('a')
                link.href = url
                link.download = `${selectedPrivate.title.replace(/[^\p{L}\p{N}._-]+/gu, '-').slice(0, 48) || 'workspace'}.zip`
                document.body.append(link)
                link.click()
                link.remove()
                window.setTimeout(() => { URL.revokeObjectURL(url) }, 1_000)
              },
            }}
            onOpenCollaboration={() => { setCollaborationOpen(true) }}
            collaborationActive={selectedRoom !== undefined}
            {...selectedRoom === undefined ? {} : { collaborationMemberCount: selectedRoom.room.memberCount }}
            {...selectedRoom === undefined ? {} : {
              collaborationMode: selectedRoom.room.collaborationMode,
              ...(collaborationDecision === undefined ? {} : { collaborationDecision }),
              collaborationCanManage: selectedRoom.room.ownerId === bootstrap.user?.id,
              collaborationParticipants: Object.entries(selectedRoom.members).map(([id, member]) => ({
                id,
                name: selectedRoom.users[id]?.displayName ?? '成员',
                avatar: avatarOf(selectedRoom.users[id]),
                aiMuted: !member.aiAccess,
                owner: id === selectedRoom.room.ownerId,
                online: id === bootstrap.user?.id || selectedRoom.users[id]?.online === true,
              })),
              ...(selectedRoom.app === undefined ? {} : { collaborationApp: selectedRoom.app }),
              onChangeCollaborationMode: async (nextMode: CollaborationModeView) => {
                await api(`/api/rooms/${selectedRoom.room.id}/mode`, { method: 'PATCH', body: JSON.stringify({ mode: nextMode }) }, bootstrap.csrf)
                await refresh()
                await loadDetail(selectedId)
              },
              onToggleCollaborationParticipant: async (userId: string, muted: boolean) => {
                await api(`/api/rooms/${selectedRoom.room.id}/members/${userId}`, { method: 'PATCH', body: JSON.stringify({ aiAccess: !muted }) }, bootstrap.csrf)
                await refresh()
                await loadDetail(selectedId)
              },
            }}
            onOpenSettings={() => { setSettingsOpen(true) }}
            onLoadPresets={async () => []}
            onLoadBranches={async () => [{ name: 'master', current: true }]}
            onLoadCommands={async () => []}
            onLoadModels={async () => {
              const path = selectedPrivate !== undefined
                ? `/api/conversations/${selectedPrivate.id}/models`
                : selectedRoom !== undefined
                  ? `/api/rooms/${selectedRoom.room.id}/models`
                  : undefined
              if (path === undefined) return []
              const value = await api<{ models: ModelOptionView[] }>(path)
              return value.models
            }}
            onSelectModel={async (option) => {
              const path = selectedPrivate !== undefined
                ? `/api/conversations/${selectedPrivate.id}/model`
                : selectedRoom !== undefined
                  ? `/api/rooms/${selectedRoom.room.id}/model`
                  : undefined
              if (path === undefined) return
              await api(path, {
                method: 'POST',
                body: JSON.stringify({ provider: option.provider, model: option.model, reasoningEffort: option.reasoningEffort }),
              }, bootstrap.csrf)
              await refresh()
            }}
            onLoadModelAccess={async () => {
              const value = await api<{ access: ModelAccessView }>('/api/model-access')
              return value.access
            }}
            onSaveModelAccess={async (apiKey) => {
              const value = await api<{ access: ModelAccessView }>('/api/model-access', {
                method: 'POST', body: JSON.stringify({ apiKey }),
              }, bootstrap.csrf)
              return value.access
            }}
          />
        )}
      />
      {settingsOpen && <SettingsDialog user={bootstrap.user} {...bootstrap.csrf === undefined ? {} : { csrf: bootstrap.csrf }} onClose={() => { setSettingsOpen(false) }} logout={async () => { await api('/api/logout', { method: 'POST', body: '{}' }, bootstrap.csrf); setSettingsOpen(false); await refresh() }} />}
      {collaborationOpen && selectedPrivate && <PromoteDialog conversation={selectedPrivate} workspaces={bootstrap.workspaces} {...bootstrap.csrf === undefined ? {} : { csrf: bootstrap.csrf }} onClose={() => { setCollaborationOpen(false) }} done={async (roomId) => { setCollaborationOpen(false); await refresh(); setSelectedId(sessionKey('room', roomId)) }} />}
      {collaborationOpen && selectedRoom && <RoomDialog detail={selectedRoom} me={bootstrap.user} {...bootstrap.csrf === undefined ? {} : { csrf: bootstrap.csrf }} onClose={() => { setCollaborationOpen(false) }} reload={async () => { await refresh(); await loadDetail(selectedId) }} privatized={async (conversationId) => { setCollaborationOpen(false); await refresh(); setSelectedId(sessionKey('private', conversationId)) }} />}
      {error !== '' && <div className="collab-global-error">{error}<button type="button" onClick={() => { setError('') }}>×</button></div>}
    </>
  )
}

createRoot(document.getElementById('root')!).render(<App />)
