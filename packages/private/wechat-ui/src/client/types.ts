import type { ReactNode } from 'react'

export type AvatarGlyph = 'whale' | 'code' | 'spark' | 'folder' | 'robot' | 'image' | 'group'

export interface AvatarView {
  glyph: AvatarGlyph
  color: string
  image?: string
  members?: readonly AvatarView[]
}

export interface SessionItemView {
  id: string
  title: string
  preview: string
  conversationPreview?: string
  time: string
  avatar?: AvatarView
  updatedAt?: number
  workspaceId?: string
  running?: boolean
  completed?: boolean
  /** True when the host has authoritative unread content for this session. */
  unread?: boolean
  usage?: TokenUsageView
}

export interface TokenUsageView {
  uncachedInputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
}

export interface SessionModelView {
  provider: string
  model: string
}

export interface UsageSampleView {
  time: number
  usage: TokenUsageView
  model?: SessionModelView
}

export interface SessionUsageHistoryView {
  samples: Readonly<Record<string, readonly UsageSampleView[]>>
  failures: readonly string[]
}

export interface WorkspaceGroupView {
  id: string
  title: string
  path: string
  sessionIds: readonly string[]
  virtual?: boolean
}

export interface NewSessionDraft {
  workspaceId?: string
  title?: string
  subtitle?: string
  avatar?: AvatarView
  visibility?: 'private' | 'shared'
  brief?: string
  passwordProtected?: boolean
  roomPassword?: string
  approvalMode?: 'unanimous' | 'admin' | 'auto'
  quietSeconds?: number
  agentEnabled?: boolean
  defaultAiAccess?: boolean
}

export interface ChatMessageView {
  id: string
  role: 'assistant' | 'user' | 'status'
  body: string
  /** True only for a message authored by a real participant in a multiplayer room. */
  human?: boolean
  images?: readonly ChatImageView[]
  files?: readonly ChatFileView[]
  reasoning?: string
  /** Original message timestamp used for WeChat-style time separators and exact-time reveal. */
  createdAt?: number
  time?: string
  pending?: boolean
  tool?: PluginToolView
  /** Optional multiplayer author metadata. Local one-to-one sessions omit these fields. */
  authorName?: string
  authorAvatar?: AvatarView
}

export interface ChatFileView {
  id: string
  name: string
  mediaType?: string
  size?: number
  extractedCharacters?: number
  truncated?: boolean
  downloadUrl?: string
}

export interface PluginToolView {
  callId: string
  toolName: string
  block: unknown
}

export interface PluginInventoryEntryView {
  entryId: string
  moduleName: string
  enabled: boolean
  fiberPhase: 'pending' | 'loading' | 'active' | 'failed' | 'unloading' | null
}

export interface ForwardTargetView {
  id: string
  title: string
  preview?: string
}

export interface SubagentTaskView {
  id: string
  title: string
  mode: 'one-shot' | 'continuable'
  status: 'running' | 'completed' | 'unavailable'
  hasChildren?: boolean
  updatedAt?: number
  toolCount?: number
}

export interface SubagentDetailView {
  id: string
  title: string
  mode: 'one-shot' | 'continuable'
  status: 'running' | 'completed' | 'unavailable'
  messages: readonly ChatMessageView[]
  hasMore?: boolean
}

export interface ChatImageView {
  id: string
  name?: string
  mediaType?: string
  width?: number
  height?: number
  /** Preview-only images already have a browser-consumable source. */
  src?: string
}

export interface ImageUploadLimitsView {
  maxImageBytes: number
  maxImagesPerMessage: number
  maxMessageImageBytes: number
  maxImagePixels: number
  maxImageDimension: number
  mediaTypes: readonly string[]
}

export interface QuestionOptionView {
  label: string
  description?: string
}

export interface QuestionItemView {
  id: string
  question: string
  header?: string
  detail?: string
  options?: readonly QuestionOptionView[]
  multiSelect?: boolean
}

export interface QuestionAnswerItemView {
  id: string
  selected: string[]
  custom?: string
}

export interface PendingQuestionView {
  key: string
  questions: readonly QuestionItemView[]
  canAnswer?: boolean
  answer: (answers: readonly QuestionAnswerItemView[]) => Promise<void>
  cancel: () => Promise<void>
}

export interface WorkspaceOptionView {
  id: string
  title: string
  path: string
  current?: boolean
}

export interface PresetOptionView {
  id: string
  name: string
  description?: string
  current?: boolean
}

export interface ModelOptionView {
  key: string
  provider: string
  providerName: string
  model: string
  name: string
  description?: string
  reasoningEffort?: string
  reasoningEfforts?: readonly {
    id: string
    name: string
    description?: string
  }[]
  current?: boolean
}

export interface ModelAccessView {
  configured: boolean
  writable: boolean
  canConfigure: boolean
  providerLabel?: string
}

export interface PermissionOptionView {
  value: string
  name: string
  description?: string
  current?: boolean
  dangerous?: boolean
}

export interface CommandOptionView {
  name: string
  description: string
  hint?: string
}

export interface BranchOptionView {
  name: string
  current?: boolean
}

export type CollaborationModeView = 'chat' | 'discussion' | 'execution' | 'application'

export interface CollaborationParticipantView {
  id: string
  name: string
  avatar: AvatarView
  aiMuted: boolean
  owner?: boolean
  online?: boolean
}

export interface DshServiceView {
  id: string
  kind: string
  label: string
  status: 'running' | 'stopping'
  startedAt: number
  sessionId?: string
  port?: number
  url?: string
  canStop: boolean
}

export interface CollaborationAppView {
  title: string
  html: string
  updatedAt?: number
}

export interface CollaborationDecisionView {
  key: string
  title: string
  summary: string
  conflict?: boolean
  confirmed: number
  required: number
  voters: readonly { id: string; name: string; confirmed: boolean }[]
  canDecide: boolean
  decided: boolean
  decide: (approve: boolean, reason?: string) => Promise<void> | void
}

export interface ConversationPaneProps {
  sessionId?: string
  avatar: AvatarView
  userAvatar: AvatarView
  title: string
  subtitle?: string
  workspace: string
  workspaceLabel?: string
  workspacePath?: string
  mode: string
  branch: string
  access: string
  model: string
  blank?: boolean
  workspaces?: readonly WorkspaceOptionView[]
  permissions?: readonly PermissionOptionView[]
  messages: readonly ChatMessageView[]
  hasMore?: boolean
  loadingOlder?: boolean
  onLoadOlder?: () => Promise<void> | void
  imageLimits?: ImageUploadLimitsView
  pendingQuestion?: PendingQuestionView
  running: boolean
  createdAt?: number
  updatedAt?: number
  totalTokens?: number
  disabled?: boolean
  onSend: (text: string, images?: readonly File[], files?: readonly File[]) => Promise<void> | void
  onLoadImage?: (image: ChatImageView) => Promise<string>
  forwardTargets?: readonly ForwardTargetView[]
  onForwardMessages?: (targetSessionId: string, sourceTitle: string, messages: readonly ChatMessageView[], merged: boolean) => Promise<void> | void
  subagents?: readonly SubagentTaskView[]
  onLoadSubagent?: (task: SubagentTaskView) => Promise<SubagentDetailView>
  onOpenPluginFile?: (path: string) => Promise<void> | void
  onReadWorkspaceHtml?: (path: string) => Promise<string>
  onCancel: () => Promise<void> | void
  onRenameTitle?: (title: string) => Promise<void>
  onRenameSubtitle?: (subtitle: string) => Promise<void> | void
  onPreviewAvatar?: () => void
  onDownloadWorkspace?: () => Promise<void> | void
  onOpenCollaboration?: () => void
  collaborationActive?: boolean
  collaborationMemberCount?: number
  collaborationMode?: CollaborationModeView
  collaborationCanManage?: boolean
  collaborationParticipants?: readonly CollaborationParticipantView[]
  collaborationApp?: CollaborationAppView
  collaborationDecision?: CollaborationDecisionView
  onChangeCollaborationMode?: (mode: CollaborationModeView) => Promise<void> | void
  onToggleCollaborationParticipant?: (userId: string, muted: boolean) => Promise<void> | void
  onAddWorkspace?: () => Promise<void> | void
  onStartWorkspace?: (id: string) => Promise<void> | void
  onOpenSettings?: (section?: string) => Promise<void> | void
  onLoadPresets?: () => Promise<readonly PresetOptionView[]>
  onSelectPreset?: (id: string) => Promise<void>
  onLoadBranches?: () => Promise<readonly BranchOptionView[]>
  onSwitchBranch?: (name: string) => Promise<void>
  onLoadCommands?: () => Promise<readonly CommandOptionView[]>
  onRunCommand?: (line: string) => Promise<string | undefined>
  onSelectPermission?: (value: string) => Promise<void>
  onLoadModels?: () => Promise<readonly ModelOptionView[]>
  onSelectModel?: (option: ModelOptionView) => Promise<void>
  onLoadModelAccess?: () => Promise<ModelAccessView>
  onSaveModelAccess?: (apiKey: string) => Promise<ModelAccessView | void>
}

export interface WechatShellFrameProps {
  sessions: readonly SessionItemView[]
  workspaces: readonly WorkspaceGroupView[]
  archivedSessionIds?: readonly string[]
  currentSessionId?: string
  workspaceCount: number
  standalone?: boolean
  multiplayerEnabled?: boolean
  onOpenSession: (id: string) => void
  onOpenSessionWindow: (id: string) => void
  onReorderSession: (workspaceId: string, sessionId: string, beforeSessionId?: string) => Promise<void> | void
  onNewSession: (draft: NewSessionDraft) => Promise<string>
  onAddWorkspace: () => Promise<void> | void
  onOpenTaskBoard: () => Promise<void> | void
  onOpenSettings: (section?: string) => Promise<void> | void
  onLoadSessionPreviews: (sessionIds: readonly string[]) => Promise<Readonly<Record<string, string>>>
  onLoadSessionModels: (sessionIds: readonly string[]) => Promise<Readonly<Record<string, SessionModelView>>>
  onLoadSessionUsage: (sessionIds: readonly string[], since?: number) => Promise<SessionUsageHistoryView>
  onLoadPlugins: () => Promise<readonly PluginInventoryEntryView[]>
  onLoadServices?: () => Promise<readonly DshServiceView[]>
  onStopService?: (id: string) => Promise<void>
  renderConversation: (
    avatar: AvatarView,
    userAvatar: AvatarView,
    subtitle: string | undefined,
    onSubtitleChange: (subtitle: string) => void,
    onAvatarPreview: () => void,
    workspaceLabel?: string,
  ) => ReactNode
}
