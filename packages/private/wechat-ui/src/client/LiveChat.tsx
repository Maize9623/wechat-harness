import { useEffect, useMemo, useRef, useState } from 'react'
import type { SessionSnapshot } from '@deepseek-ai/dsh-api-session-controller/client'
import type { ConversationSnapshot } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-chat/client'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { ConversationPane } from './ConversationPane.tsx'
import {
  firstOutlineTurnSeq,
  mergeLeadingUserMessages,
  messagesOf,
  needsLeadingUser,
  type TranscriptSnapshot,
} from './conversationMessages.ts'
import { notifySelectedSession } from './LiveOverlay.tsx'
import { useSessionAttention } from './sessionAttention.ts'
import { sessionFallbackPreview } from './sessionListPreview.ts'
import type {
  BranchOptionView,
  ChatImageView,
  ChatMessageView,
  CommandOptionView,
  ForwardTargetView,
  ImageUploadLimitsView,
  ModelAccessView,
  ModelOptionView,
  PendingQuestionView,
  PermissionOptionView,
  PresetOptionView,
  SubagentDetailView,
  SubagentTaskView,
  TokenUsageView,
} from './types.ts'
import './slots.ts'

export interface LiveChatInjected {
  sendMessage: (text: string, images?: readonly File[], files?: readonly File[]) => Promise<void>
  loadOlder: () => Promise<void>
  /** Page the Session window back through this seq so the opening turn is in view. */
  loadThrough: (seq: number) => Promise<void>
  /** Read user/message rows that precede the currently loaded window. */
  loadHistoryBefore: (beforeSeq: number) => Promise<readonly ChatMessageView[]>
  loadImage: (image: ChatImageView) => Promise<string>
  openPluginFile: (path: string) => Promise<void>
  readWorkspaceHtml: (path: string) => Promise<string>
  cancelMessage: () => Promise<void>
  renameSession: (title: string) => Promise<void>
  addWorkspace: () => Promise<void>
  startWorkspace: (id: string) => Promise<void>
  openSettings: (section?: string) => Promise<void>
  loadPresets: () => Promise<readonly PresetOptionView[]>
  selectPreset: (id: string) => Promise<void>
  loadBranches: () => Promise<readonly BranchOptionView[]>
  switchBranch: (name: string) => Promise<void>
  loadCommands: () => Promise<readonly CommandOptionView[]>
  runCommand: (line: string) => Promise<string | undefined>
  selectPermission: (value: string) => Promise<void>
  loadModels: () => Promise<readonly ModelOptionView[]>
  selectModel: (option: ModelOptionView) => Promise<void>
  loadModelAccess: () => Promise<ModelAccessView>
  saveModelAccess: (apiKey: string) => Promise<ModelAccessView>
  forwardMessages: (targetSessionId: string, sourceTitle: string, messages: readonly ChatMessageView[], merged: boolean) => Promise<void>
  refreshSubagents: () => Promise<void>
  setSubagentsVisible: (visible: boolean) => void
  loadSubagent: (task: SubagentTaskView) => Promise<SubagentDetailView>
}

type LiveChatProps = PropsRuntime<'diy.wechat.chat'> & LiveChatInjected & {
  useConversation?: (selector: (snapshot: ConversationSnapshot) => ConversationSnapshot) => ConversationSnapshot | undefined
}

const FALLBACK_PERMISSION_OPTIONS = [
  { value: 'workspace-write', name: '工作区可写' },
  { value: 'danger-full-access', name: '完全访问' },
] as const

interface PermissionProjectionView {
  currentValue?: string
  options?: ReadonlyArray<{ value: string; name: string; description?: string }>
}

function permissionLabel(value: string, name?: string): string {
  if (name !== undefined && name.trim() !== '') return name
  if (value === 'workspace-write') return '工作区可写'
  if (value === 'danger-full-access') return '完全访问'
  if (value === 'read-only') return '只读'
  return value
}

/**
 * Map the session permissions projection to picker rows.
 * The projection publishes only `currentValue`; selectable options live on the
 * process catalog and are absent from a newly opened session.
 */
function permissionOptionsOf(projection: PermissionProjectionView | undefined): PermissionOptionView[] {
  const catalog = projection?.options
  const rows = Array.isArray(catalog) && catalog.length > 0
    ? catalog
    : [...FALLBACK_PERMISSION_OPTIONS]
  return rows
    .filter(option => option.value !== 'custom')
    .map(option => ({
      value: option.value,
      name: permissionLabel(option.value, option.name),
      ...('description' in option && option.description !== undefined ? { description: option.description } : {}),
      ...(option.value === projection?.currentValue ? { current: true } : {}),
      ...(option.value === 'danger-full-access' ? { dangerous: true } : {}),
    }))
}

function basename(path: string | undefined): string {
  if (path === undefined || path === '') return '工作区'
  return path.replace(/[/\\]+$/, '').split(/[/\\]/).at(-1) ?? path
}

function pendingQuestionOf(attention: ReturnType<typeof useSessionAttention>): PendingQuestionView | undefined {
  return attention?.pendingQuestion
}

export function LiveChat({
  avatar,
  userAvatar,
  subtitle,
  workspaceLabel,
  onSubtitleChange,
  onAvatarPreview,
  sessionId,
  useSession,
  useSessions,
  useWorkspaces,
  useProjection,
  useConversation,
  sendMessage,
  loadOlder,
  loadThrough,
  loadHistoryBefore,
  loadImage,
  openPluginFile,
  readWorkspaceHtml,
  cancelMessage,
  renameSession,
  addWorkspace,
  startWorkspace,
  openSettings,
  loadPresets,
  selectPreset,
  loadBranches,
  switchBranch,
  loadCommands,
  runCommand,
  selectPermission,
  loadModels,
  selectModel,
  loadModelAccess,
  saveModelAccess,
  forwardMessages,
  refreshSubagents,
  setSubagentsVisible,
  loadSubagent,
}: LiveChatProps) {
  const session = useSession(value => value) as SessionSnapshot | undefined
  const conversation = useConversation?.(value => value)
  const legacy = conversation?.views.get('chat')?.legacy
  const sessionState = useSessions(state => state)
  const summary = sessionId === undefined ? undefined : sessionState.byId[sessionId]
  const workspaceItems = useWorkspaces(state => state.items) ?? []
  const permissionProjection = (useProjection as unknown as (key: string) => unknown)('permissions') as PermissionProjectionView | undefined
  const imageLimits = (useProjection as unknown as (key: string) => unknown)('imageLimits') as ImageUploadLimitsView | undefined
  const tokenUsage = (useProjection as unknown as (key: string) => unknown)('tokenUsage') as Partial<TokenUsageView> | undefined
  const turnOutline = (useProjection as unknown as (key: string) => unknown)('turnOutline')
  const [branch, setBranch] = useState('Git 分支')
  const [leadingUser, setLeadingUser] = useState<readonly ChatMessageView[]>([])
  const historyAttempted = useRef<string | undefined>(undefined)
  const windowMessages = useMemo(() => messagesOf(legacy as TranscriptSnapshot | undefined), [legacy])
  const messages = useMemo(() => mergeLeadingUserMessages(windowMessages, leadingUser), [leadingUser, windowMessages])
  const missingLeadingUser = needsLeadingUser(windowMessages)
  const attention = useSessionAttention(sessionId === undefined ? undefined : String(sessionId))
  const pendingQuestion = useMemo(() => pendingQuestionOf(attention), [attention])

  useEffect(() => {
    if (sessionId === undefined) return
    notifySelectedSession(String(sessionId))
  }, [sessionId])
  useEffect(() => {
    historyAttempted.current = undefined
    setLeadingUser([])
  }, [sessionId])
  useEffect(() => {
    if (!missingLeadingUser) setLeadingUser([])
  }, [missingLeadingUser])
  useEffect(() => {
    if (sessionId === undefined || session?.hasMore !== true || session.loadingOlder) return
    if (missingLeadingUser && firstOutlineTurnSeq(turnOutline) !== undefined) return
    void loadOlder()
  }, [loadOlder, missingLeadingUser, sessionId, session?.hasMore, session?.loadingOlder, turnOutline])
  useEffect(() => {
    const seq = firstOutlineTurnSeq(turnOutline)
    if (seq === undefined || !missingLeadingUser || session?.loadingOlder || session?.hasMore !== true) return
    void loadThrough(seq)
  }, [loadThrough, missingLeadingUser, session?.hasMore, session?.loadingOlder, turnOutline])
  useEffect(() => {
    const id = sessionId === undefined ? undefined : String(sessionId)
    const before = legacy?.nodes[0]?.seq
    if (id === undefined || before === undefined || !missingLeadingUser || leadingUser.length > 0) return
    if (session === undefined || session.hasMore === true) return
    if (historyAttempted.current === id) return
    historyAttempted.current = id
    let live = true
    void loadHistoryBefore(before).then((rows) => {
      if (live) setLeadingUser(rows)
    }).catch(() => {
      if (live) {
        historyAttempted.current = undefined
        setLeadingUser([])
      }
    })
    return () => { live = false }
  }, [leadingUser.length, legacy?.nodes, loadHistoryBefore, missingLeadingUser, session?.hasMore, sessionId])
  const lastAssistant = legacy?.nodes.findLast(node => node.kind === 'assistant')
  const model = lastAssistant?.kind === 'assistant'
    ? lastAssistant.requestConfig?.model ?? lastAssistant.providerMetadata?.model ?? 'DeepSeek'
    : 'DeepSeek'
  const workspaces = useMemo(() => workspaceItems.map(item => ({
    id: String(item.workspaceId),
    title: item.title,
    path: item.path,
    ...(item.path === summary?.cwd ? { current: true } : {}),
  })), [summary?.cwd, workspaceItems])
  const permissions = useMemo(() => permissionOptionsOf(permissionProjection), [permissionProjection])
  const sessionIds = sessionState.ids ?? []
  const access = permissions.find(option => option.current)?.name ?? permissionProjection?.currentValue ?? '访问权限'
  const totalTokens = tokenUsage === undefined ? undefined : [
    tokenUsage.uncachedInputTokens,
    tokenUsage.outputTokens,
    tokenUsage.cacheReadTokens,
    tokenUsage.cacheWriteTokens,
  ].reduce((sum: number, value) => sum + (typeof value === 'number' && Number.isFinite(value) ? value : 0), 0)
  const rawSummary = summary as unknown as { createdAt?: number; updatedAt?: number } | undefined
  const firstNodeTime = legacy?.nodes.find(node => typeof node.time === 'number')?.time
  const createdAt = rawSummary?.createdAt ?? firstNodeTime
  const forwardTargets = useMemo<ForwardTargetView[]>(() => sessionIds
    .filter(id => id !== sessionId && sessionState.byId[id]?.origin !== 'subagent')
    .map((id) => {
      const target = sessionState.byId[id]
      return {
        id: String(id),
        title: target?.displayTitle ?? String(id),
        preview: sessionFallbackPreview({
          running: target?.running,
          blank: target?.blank,
          awaitingQuestion: target?.pendingInteraction === 'question',
        }),
      }
    }), [sessionId, sessionIds, sessionState.byId])
  const subagents = useMemo<SubagentTaskView[]>(() => {
    if (sessionId === undefined) return []
    const catalog = sessionState.subagentsByParent[sessionId] as unknown as {
      entries?: Array<
        | { kind: 'diagnostic'; id: string }
        | { kind: 'child'; id: string; label?: string; mode: 'one-shot' | 'continuable'; activity: 'running' | 'inactive'; hasChildren?: boolean }
      >
    } | undefined
    return (catalog?.entries ?? []).map((entry) => {
      if (entry.kind === 'diagnostic') return {
        id: String(entry.id),
        title: '无法读取的子 Agent',
        mode: 'one-shot' as const,
        status: 'unavailable' as const,
      }
      const child = sessionState.byId[entry.id as keyof typeof sessionState.byId]
      return {
        id: String(entry.id),
        title: entry.label?.trim() || child?.displayTitle || '子 Agent',
        mode: entry.mode,
        status: entry.activity === 'running' ? 'running' as const : 'completed' as const,
        ...(entry.hasChildren ? { hasChildren: true } : {}),
        ...(child?.updatedAt === undefined ? {} : { updatedAt: child.updatedAt }),
      }
    })
  }, [sessionId, sessionState.byId, sessionState.subagentsByParent])

  useEffect(() => {
    if (sessionId === undefined) return
    setSubagentsVisible(true)
    void refreshSubagents().catch(() => {})
    return () => { setSubagentsVisible(false) }
  }, [refreshSubagents, sessionId, setSubagentsVisible])

  useEffect(() => {
    let live = true
    void loadBranches().then((options) => {
      if (live) setBranch(options.find(option => option.current)?.name ?? 'Git 分支')
    }).catch(() => { if (live) setBranch('Git 分支') })
    return () => { live = false }
  }, [loadBranches, summary?.cwd])

  const switchCurrentBranch = async (name: string): Promise<void> => {
    await switchBranch(name)
    setBranch(name)
  }
  return (
    <ConversationPane
      {...sessionId === undefined ? {} : { sessionId: String(sessionId) }}
      avatar={avatar}
      userAvatar={userAvatar}
      title={summary?.displayTitle ?? '新会话'}
      {...subtitle === undefined ? {} : { subtitle }}
      workspace={basename(summary?.cwd)}
      {...workspaceLabel === undefined ? {} : { workspaceLabel }}
      {...summary?.cwd === undefined ? {} : { workspacePath: summary.cwd }}
      mode={summary?.agentPreset ?? '标准模式'}
      branch={branch}
      access={access}
      model={model}
      blank={summary?.blank ?? false}
      workspaces={workspaces}
      permissions={permissions}
      messages={messages}
      hasMore={session?.hasMore === true}
      loadingOlder={session?.loadingOlder === true}
      onLoadOlder={loadOlder}
      {...imageLimits === undefined ? {} : { imageLimits }}
      {...pendingQuestion === undefined ? {} : { pendingQuestion }}
      running={session?.running ?? false}
      {...createdAt === undefined ? {} : { createdAt }}
      {...rawSummary?.updatedAt === undefined ? {} : { updatedAt: rawSummary.updatedAt }}
      {...totalTokens === undefined ? {} : { totalTokens }}
      disabled={sessionId === undefined || session?.removed === true}
      onSend={sendMessage}
      onLoadImage={loadImage}
      onOpenPluginFile={openPluginFile}
      onReadWorkspaceHtml={readWorkspaceHtml}
      forwardTargets={forwardTargets}
      onForwardMessages={forwardMessages}
      subagents={subagents}
      onLoadSubagent={loadSubagent}
      onCancel={cancelMessage}
      onRenameTitle={renameSession}
      onRenameSubtitle={async (value) => { onSubtitleChange(value) }}
      onPreviewAvatar={onAvatarPreview}
      onAddWorkspace={addWorkspace}
      onStartWorkspace={startWorkspace}
      onOpenSettings={openSettings}
      onLoadPresets={loadPresets}
      onSelectPreset={selectPreset}
      onLoadBranches={loadBranches}
      onSwitchBranch={switchCurrentBranch}
      onLoadCommands={loadCommands}
      onRunCommand={runCommand}
      onSelectPermission={selectPermission}
      onLoadModels={loadModels}
      onSelectModel={selectModel}
      onLoadModelAccess={loadModelAccess}
      onSaveModelAccess={saveModelAccess}
    />
  )
}
