import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { AvatarBadge } from './Avatar.tsx'
import { ForwardDialog } from './ForwardDialog.tsx'
import { ConversationSidePanel, type ConversationSideTarget, type SidePresentation } from './ConversationSidePanel.tsx'
import { createClientId } from './clientId.ts'
import { fileDataTransfer, installDocumentFileDrop } from './dropFiles.ts'
import { FILE_ACCEPT, MAX_FILE_BYTES, MAX_FILES_PER_MESSAGE, MAX_MESSAGE_FILE_BYTES } from './fileAttachments.ts'
import { Icon } from './icons.tsx'
import { MarkdownMessage } from './MarkdownMessage.tsx'
import type { MessagePreviewTarget } from './previewTarget.ts'
import { MessageImageGallery } from './MessageImageGallery.tsx'
import {
  deleteChatMessages,
  isChatMessageDeleted,
  loadMessageRecycleState,
  MESSAGE_RECYCLE_EVENT,
  type MessageRecycleState,
} from './messageRecycle.ts'
import { SessionPersonaDialog } from './SessionPersona.tsx'
import { loadSessionPersona, saveSessionPersona, type SessionPersona } from './persona.ts'
import { createConversationSchedule, parseScheduleIntent, type ScheduleIntent } from './scheduleIntent.ts'
import { prepareVisualizationHtml, VISUALIZATION_STORAGE_EVENT } from './visualizationSandbox.ts'
import type {
  AvatarView,
  BranchOptionView,
  ChatFileView,
  CollaborationDecisionView,
  CommandOptionView,
  ConversationPaneProps,
  ModelAccessView,
  ModelOptionView,
  PendingQuestionView,
  PermissionOptionView,
  PluginToolView,
  PresetOptionView,
  QuestionAnswerItemView,
  QuestionItemView,
  WorkspaceOptionView,
} from './types.ts'

const TOOL_ITEMS = [
  { id: 'workspace', icon: 'folder', label: '项目工作区' },
  { id: 'mode', icon: 'mode', label: '标准模式' },
  { id: 'branch', icon: 'branch', label: 'master 分支' },
  { id: 'command', icon: 'terminal', label: '添加命令' },
  { id: 'access', icon: 'shield', label: 'Full access' },
  { id: 'model', icon: 'model', label: '模型切换' },
] as const

type ToolMenuId = typeof TOOL_ITEMS[number]['id']

interface PendingImage {
  id: string
  file: File
  previewUrl: string
}

interface PendingFile {
  id: string
  file: File
}

interface MessageContextState {
  message: import('./types.ts').ChatMessageView
  copyText: string
  x: number
  y: number
}

const DEFAULT_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'] as const
const HUMAN_ONLY_STORAGE_KEY = 'diywx:collaboration-human-only'
const MESSAGE_TIME_GAP_MS = 5 * 60 * 1000

function loadHumanOnly(): boolean {
  try { return window.localStorage.getItem(HUMAN_ONLY_STORAGE_KEY) === '1' } catch { return false }
}

function saveHumanOnly(value: boolean): void {
  try { window.localStorage.setItem(HUMAN_ONLY_STORAGE_KEY, value ? '1' : '0') } catch {}
}

function bytesLabel(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.ceil(bytes / 1024)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function hasMessageRowContent(message: import('./types.ts').ChatMessageView): boolean {
  return message.body.trim() !== '' || (message.images?.length ?? 0) > 0 || (message.files?.length ?? 0) > 0 || message.tool !== undefined
}

function hasVisibleMessageContent(message: import('./types.ts').ChatMessageView): boolean {
  return hasMessageRowContent(message) || (message.reasoning?.trim() ?? '') !== ''
}

function messageTimeLabel(createdAt: number, exact = false): string {
  const date = new Date(createdAt)
  const today = new Date()
  const sameDay = date.getFullYear() === today.getFullYear()
    && date.getMonth() === today.getMonth()
    && date.getDate() === today.getDate()
  const yesterday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1)
  const isYesterday = date.getFullYear() === yesterday.getFullYear()
    && date.getMonth() === yesterday.getMonth()
    && date.getDate() === yesterday.getDate()
  const clock = date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
  if (sameDay) return exact ? `今天 ${clock}` : clock
  if (isYesterday) return `昨天 ${clock}`
  return date.toLocaleString('zh-CN', {
    ...(date.getFullYear() === today.getFullYear() ? {} : { year: 'numeric' as const }),
    month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit',
  })
}

function shouldShowTimeDivider(message: import('./types.ts').ChatMessageView, previous: import('./types.ts').ChatMessageView | undefined): boolean {
  if (message.createdAt === undefined || !Number.isFinite(message.createdAt)) return previous === undefined && message.time !== undefined
  if (previous === undefined) return true
  if (previous.createdAt === undefined || !Number.isFinite(previous.createdAt)) return false
  return message.createdAt - previous.createdAt >= MESSAGE_TIME_GAP_MS
}

function clipboardFiles(data: DataTransfer): File[] {
  const itemFiles = Array.from(data.items)
    .filter(item => item.kind === 'file')
    .map(item => item.getAsFile())
    .filter((file): file is File => file !== null)
  return itemFiles.length > 0 ? itemFiles : Array.from(data.files)
}

function fileExtension(name: string): string {
  const value = name.split('.').at(-1)?.trim().toUpperCase()
  return value === undefined || value === name.toUpperCase() ? 'FILE' : value.slice(0, 6)
}

function MessageFileList({ files, align }: { files: readonly ChatFileView[]; align: 'start' | 'end' }) {
  return <div className="diywx-message-files" data-align={align}>{files.map((file) => {
    const content = <>
      <span className="diywx-file-kind">{fileExtension(file.name)}</span>
      <span><strong>{file.name}</strong><small>{file.size === undefined ? '已读取附件' : `${bytesLabel(file.size)} · 已读取${file.truncated ? '（内容过长，已截取）' : ''}`}</small></span>
      {file.downloadUrl !== undefined && <Icon name="download" size={16} />}
    </>
    return file.downloadUrl === undefined
      ? <article key={file.id} className="diywx-message-file">{content}</article>
      : <a key={file.id} className="diywx-message-file" href={file.downloadUrl} download={file.name} title={`下载 ${file.name}`}>{content}</a>
  })}</div>
}

function profileDate(value: number | undefined): string {
  if (value === undefined || !Number.isFinite(value)) return '暂无记录'
  return new Date(value).toLocaleString('zh-CN', {
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  })
}

function tokenLabel(value: number | undefined): string {
  if (value === undefined || !Number.isFinite(value)) return '暂无统计'
  if (value < 1000) return `${Math.round(value)} tokens`
  if (value < 1_000_000) return `${(value / 1000).toFixed(value >= 10_000 ? 0 : 1)}K tokens`
  return `${(value / 1_000_000).toFixed(2)}M tokens`
}

async function writeClipboardText(value: string): Promise<void> {
  if (navigator.clipboard?.writeText !== undefined) {
    await navigator.clipboard.writeText(value)
    return
  }
  const textarea = document.createElement('textarea')
  textarea.value = value
  textarea.setAttribute('readonly', '')
  textarea.style.position = 'fixed'
  textarea.style.opacity = '0'
  document.body.append(textarea)
  textarea.select()
  const copied = document.execCommand('copy')
  textarea.remove()
  if (!copied) throw new Error('浏览器拒绝了剪贴板写入')
}

function PluginToolCard({ tool, openFile, openSide, openImmersive }: {
  tool: PluginToolView
  openFile?: (path: string) => Promise<void> | void
  openSide?: (target: ConversationSideTarget) => void
  openImmersive?: (target: ConversationSideTarget) => void
}) {
  const [storageRevision, setStorageRevision] = useState(0)
  useEffect(() => {
    const refresh = (): void => { setStorageRevision(value => value + 1) }
    window.addEventListener(VISUALIZATION_STORAGE_EVENT, refresh)
    return () => { window.removeEventListener(VISUALIZATION_STORAGE_EVENT, refresh) }
  }, [])
  const block = tool.block as { meta?: unknown }
  if (tool.toolName === 'render_ui' && block.meta !== null && typeof block.meta === 'object') {
    return (
      <div className="diywx-genui-bridge" data-chat-anchor-key={`call:${tool.callId}`}>
        <MarkdownMessage text={`\`\`\`dsh-ui\n${JSON.stringify(block.meta)}\n\`\`\``} />
      </div>
    )
  }
  if (tool.toolName === 'visualize_html') {
    const meta = block.meta as { html?: unknown; url?: unknown; path?: unknown; size?: unknown; truncated?: unknown } | undefined
    if (typeof meta?.html === 'string' || typeof meta?.url === 'string') {
      const title = typeof meta.path === 'string' ? meta.path.split(/[/\\]/u).at(-1) ?? '可视化预览' : '可视化预览'
      const sandboxHtml = typeof meta.html === 'string' ? prepareVisualizationHtml(meta.html) : undefined
      void storageRevision
      const previewTarget: ConversationSideTarget = { kind: 'visualization', title, ...(typeof meta.html === 'string' ? { html: meta.html } : {}), ...(typeof meta.url === 'string' ? { url: meta.url } : {}), ...(typeof meta.path === 'string' ? { path: meta.path } : {}) }
      const canOpenIndependent = typeof meta.url === 'string' || (typeof meta.path === 'string' && openFile !== undefined)
      const openIndependent = (): void => {
        if (typeof meta.url === 'string') {
          window.open(meta.url, '_blank', 'noopener,noreferrer')?.focus()
          return
        }
        if (typeof meta.path === 'string') void openFile?.(meta.path)
      }
      return (
        <section className="diywx-visualize-card" data-chat-anchor-key={`call:${tool.callId}`}>
          <header>
            <span><strong>{title}</strong>{typeof meta.path === 'string' && <small title={meta.path}>{meta.path}</small>}</span>
            {openSide !== undefined && <button type="button" onClick={() => { openSide(previewTarget) }}>右侧打开</button>}
            {openImmersive !== undefined && <button type="button" onClick={() => { openImmersive(previewTarget) }}>沉浸模式</button>}
            {canOpenIndependent && <button type="button" onClick={openIndependent}>独立打开</button>}
            {typeof meta.html === 'string' && <button type="button" onClick={() => { void navigator.clipboard.writeText(meta.html as string) }}>复制 HTML</button>}
          </header>
          {meta.truncated === true && <p>预览内容过大，当前显示的是插件截断后的安全版本。</p>}
          <iframe title={typeof meta.path === 'string' ? `预览 ${meta.path}` : '沙箱可视化预览'} sandbox="allow-scripts" referrerPolicy="no-referrer" {...(sandboxHtml !== undefined ? { srcDoc: sandboxHtml } : { src: meta.url as string })} />
        </section>
      )
    }
  }
  return <div className="diywx-plugin-tool-fallback">{tool.toolName} 已完成，但这条历史记录没有可重放的界面数据。</div>
}

interface QuestionDraft {
  selected: string[]
  custom: string
  skipped: boolean
}

function optionLabel(label: string): { text: string; recommended: boolean } {
  const suffix = /\s*(?:\((?:recommended|推荐)\)|（(?:recommended|推荐)）)\s*$/i
  return suffix.test(label)
    ? { text: label.replace(suffix, ''), recommended: true }
    : { text: label, recommended: false }
}

function PendingQuestionCard({ pending }: { pending: PendingQuestionView }) {
  const canAnswer = pending.canAnswer !== false
  const [index, setIndex] = useState(0)
  const [drafts, setDrafts] = useState<QuestionDraft[]>(() => pending.questions.map(() => ({
    selected: [], custom: '', skipped: false,
  })))
  const [busy, setBusy] = useState<'answer' | 'cancel' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const question = pending.questions[index] as QuestionItemView | undefined
  const draft = drafts[index]

  if (question === undefined || draft === undefined) return null

  const updateDraft = (update: (current: QuestionDraft) => QuestionDraft): void => {
    if (!canAnswer) return
    setDrafts(current => current.map((item, itemIndex) => itemIndex === index ? update(item) : item))
    setError(null)
  }

  const answered = (item: QuestionDraft): boolean => item.selected.length > 0 || item.custom.trim() !== ''
  const completed = (item: QuestionDraft): boolean => answered(item) || item.skipped

  const submitAll = async (values: QuestionDraft[]): Promise<void> => {
    const missing = values.findIndex(item => !completed(item))
    if (missing >= 0) {
      setIndex(missing)
      setError('请先回答这道问题，或选择跳过。')
      return
    }
    const answers: QuestionAnswerItemView[] = pending.questions.map((item, itemIndex) => {
      const value = values[itemIndex] as QuestionDraft
      if (value.skipped) return { id: item.id, selected: [] }
      const custom = value.custom.trim()
      return {
        id: item.id,
        selected: custom === '' || item.multiSelect === true ? value.selected : [],
        ...(custom === '' ? {} : { custom }),
      }
    })
    setBusy('answer')
    setError(null)
    try {
      await pending.answer(answers)
    } catch (reason) {
      setBusy(null)
      setError(reason instanceof Error ? reason.message : '回答发送失败，请重试')
    }
  }

  const continueQuestion = (): void => {
    if (!answered(draft)) {
      setError('请选择一个选项，或直接输入回答。')
      return
    }
    if (index < pending.questions.length - 1) {
      setIndex(current => current + 1)
      setError(null)
      return
    }
    void submitAll(drafts)
  }

  const skipQuestion = (): void => {
    const next = drafts.map((item, itemIndex) => itemIndex === index
      ? { selected: [], custom: '', skipped: true }
      : item)
    setDrafts(next)
    setError(null)
    if (index < pending.questions.length - 1) setIndex(current => current + 1)
    else void submitAll(next)
  }

  const cancelQuestion = async (): Promise<void> => {
    setBusy('cancel')
    setError(null)
    try {
      await pending.cancel()
    } catch (reason) {
      setBusy(null)
      setError(reason instanceof Error ? reason.message : '取消失败，请重试')
    }
  }

  return (
    <section className="diywx-question-card" aria-labelledby={`diywx-question-${pending.key}-${index}`}>
      <div className="diywx-question-head">
        <span>{question.header ?? 'DeepSeek 想确认一件事'}</span>
        <button
          type="button"
          className="diywx-question-close"
          disabled={busy !== null || !canAnswer}
          title="取消追问"
          aria-label="取消追问"
          onClick={() => { void cancelQuestion() }}
        >×</button>
      </div>
      <strong id={`diywx-question-${pending.key}-${index}`}>{question.question}</strong>
      {question.detail !== undefined && <p className="diywx-question-detail">{question.detail}</p>}
      {(question.options?.length ?? 0) > 0 && (
        <div className="diywx-question-options" role={question.multiSelect === true ? 'group' : 'radiogroup'}>
          {question.options?.map((option) => {
            const selected = draft.selected.includes(option.label)
            const display = optionLabel(option.label)
            return (
              <button
                type="button"
                key={option.label}
                role={question.multiSelect === true ? 'checkbox' : 'radio'}
                aria-checked={selected}
                className="diywx-question-option"
                data-selected={selected || undefined}
                disabled={busy !== null || !canAnswer}
                onClick={() => {
                  updateDraft(current => ({
                    ...current,
                    selected: question.multiSelect === true
                      ? current.selected.includes(option.label)
                        ? current.selected.filter(label => label !== option.label)
                        : [...current.selected, option.label]
                      : [option.label],
                    custom: question.multiSelect === true ? current.custom : '',
                    skipped: false,
                  }))
                }}
              >
                <span className="diywx-question-check">{selected ? '✓' : ''}</span>
                <span className="diywx-question-option-copy">
                  <span>{display.text}{display.recommended && <em>推荐</em>}</span>
                  {option.description !== undefined && <small>{option.description}</small>}
                </span>
              </button>
            )
          })}
        </div>
      )}
      <textarea
        className="diywx-question-input"
        autoFocus={(question.options?.length ?? 0) === 0}
        rows={2}
        disabled={busy !== null || !canAnswer}
        value={draft.custom}
        placeholder={(question.options?.length ?? 0) > 0 ? '也可以填写其他答案' : '请输入回答，例如：上海'}
        onChange={(event) => {
          const value = event.target.value
          updateDraft(current => ({
            ...current,
            selected: question.multiSelect === true ? current.selected : [],
            custom: value,
            skipped: false,
          }))
        }}
        onKeyDown={(event) => {
          if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return
          event.preventDefault()
          continueQuestion()
        }}
      />
      <div className="diywx-question-footer">
        <span>{index + 1} / {pending.questions.length}</span>
        <div>
          <button type="button" disabled={busy !== null || !canAnswer} onClick={skipQuestion}>跳过</button>
          <button
            type="button"
            className="diywx-question-submit"
            disabled={busy !== null || !canAnswer || !answered(draft)}
            onClick={continueQuestion}
          >
            {busy === 'answer' ? '正在提交…' : index === pending.questions.length - 1 ? '回答' : '下一题'}
          </button>
        </div>
      </div>
      {error !== null && <div className="diywx-question-error" role="alert">{error}</div>}
      {!canAnswer && <div className="diywx-question-readonly">所有群成员都能看到此追问；正在等待群主或管理员回答。</div>}
    </section>
  )
}

function CollaborationDecisionCard({ decision }: { decision: CollaborationDecisionView }) {
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState<'approve' | 'reject' | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setReason('')
    setBusy(null)
    setError(null)
  }, [decision.key])

  const submit = async (approve: boolean): Promise<void> => {
    setBusy(approve ? 'approve' : 'reject')
    setError(null)
    try {
      await decision.decide(approve, approve ? undefined : reason.trim())
    } catch (cause) {
      setBusy(null)
      setError(cause instanceof Error ? cause.message : '群内决策提交失败，请重试')
    }
  }

  return (
    <section className="diywx-question-card diywx-collaboration-decision" data-conflict={decision.conflict || undefined} aria-labelledby={`diywx-decision-${decision.key}`}>
      <div className="diywx-question-head">
        <span>{decision.conflict ? '发现分歧 · 请在群聊中决策' : '本轮需求确认'}</span>
        <small>{decision.confirmed}/{decision.required} 人已确认</small>
      </div>
      <strong id={`diywx-decision-${decision.key}`}>{decision.title}</strong>
      <p className="diywx-decision-summary">{decision.summary}</p>
      <div className="diywx-decision-voters" aria-label="本轮确认成员">
        {decision.voters.map(voter => <span key={voter.id} data-confirmed={voter.confirmed || undefined}>{voter.confirmed ? '✓' : '…'} {voter.name}</span>)}
      </div>
      {decision.canDecide && !decision.decided ? (
        <>
          <textarea
            className="diywx-question-input"
            rows={2}
            value={reason}
            disabled={busy !== null}
            placeholder="如果有异议，请写清楚要保留哪种方案；同意执行可直接点右侧按钮"
            onChange={(event) => { setReason(event.target.value) }}
          />
          <div className="diywx-question-footer diywx-decision-actions">
            <span>所有决策都留在本群记录中</span>
            <div>
              <button type="button" disabled={busy !== null} onClick={() => { void submit(false) }}>{busy === 'reject' ? '正在退回…' : '有异议，退回讨论'}</button>
              <button type="button" className="diywx-question-submit" disabled={busy !== null} onClick={() => { void submit(true) }}>{busy === 'approve' ? '正在确认…' : '同意执行'}</button>
            </div>
          </div>
        </>
      ) : (
        <div className="diywx-question-readonly">{decision.decided ? '你已确认，正在等待其他有表决权的成员。' : '你可以看到本轮分歧与结果，但不在本轮表决名单中。'}</div>
      )}
      {error !== null && <div className="diywx-question-error" role="alert">{error}</div>}
    </section>
  )
}

function ReasoningDisclosure({ text, pending = false }: { text: string; pending?: boolean }) {
  // A live reasoning block should look alive in the group chat. Completed
  // history remains collapsed so a long Agent run does not bury the human
  // conversation, while the currently streaming block is visible immediately.
  const [open, setOpen] = useState(pending)
  return (
    <div className="diywx-reasoning-wrap" data-open={open || undefined} data-pending={pending || undefined}>
      <button
        type="button"
        className="diywx-reasoning-toggle"
        aria-expanded={open}
        onClick={() => { setOpen(value => !value) }}
      >
        <Icon name="spark" size={12} />
        <span>{pending ? '正在思考' : '思考过程'}</span>
        <small>{open ? '收起' : '已隐藏 · 点击查看'}</small>
      </button>
      {open && <div className="diywx-reasoning">{text}</div>}
    </div>
  )
}

interface NativeToolPopoverProps {
  menu: ToolMenuId
  blank: boolean
  workspacePath?: string
  workspaces: readonly WorkspaceOptionView[]
  permissions: readonly PermissionOptionView[]
  onClose: () => void
  onInsertCommand: (line: string) => void
  onAddWorkspace?: () => Promise<void> | void
  onStartWorkspace?: (id: string) => Promise<void> | void
  onOpenSettings?: (section?: string) => Promise<void> | void
  onLoadPresets?: () => Promise<readonly PresetOptionView[]>
  onSelectPreset?: (id: string) => Promise<void>
  onLoadBranches?: () => Promise<readonly BranchOptionView[]>
  onSwitchBranch?: (name: string) => Promise<void>
  onLoadCommands?: () => Promise<readonly CommandOptionView[]>
  onSelectPermission?: (value: string) => Promise<void>
  onLoadModels?: () => Promise<readonly ModelOptionView[]>
  onSelectModel?: (option: ModelOptionView) => Promise<void>
  onLoadModelAccess?: () => Promise<ModelAccessView>
  onSaveModelAccess?: (apiKey: string) => Promise<ModelAccessView | void>
}

function NativeToolPopover({
  menu,
  blank,
  workspacePath,
  workspaces,
  permissions,
  onClose,
  onInsertCommand,
  onAddWorkspace,
  onStartWorkspace,
  onOpenSettings,
  onLoadPresets,
  onSelectPreset,
  onLoadBranches,
  onSwitchBranch,
  onLoadCommands,
  onSelectPermission,
  onLoadModels,
  onSelectModel,
  onLoadModelAccess,
  onSaveModelAccess,
}: NativeToolPopoverProps) {
  const [presets, setPresets] = useState<readonly PresetOptionView[]>([])
  const [branches, setBranches] = useState<readonly BranchOptionView[]>([])
  const [commands, setCommands] = useState<readonly CommandOptionView[]>([])
  const [models, setModels] = useState<readonly ModelOptionView[]>([])
  const [modelAccess, setModelAccess] = useState<ModelAccessView | null>(null)
  const [apiKeyDraft, setApiKeyDraft] = useState('')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [confirming, setConfirming] = useState<PermissionOptionView | null>(null)
  const item = TOOL_ITEMS.find(option => option.id === menu)
  const currentModel = models.find(option => option.current)
  const currentEffort = currentModel?.reasoningEfforts?.find(effort => effort.id === currentModel.reasoningEffort)

  useEffect(() => {
    let live = true
    setLoading(true)
    setError(null)
    const load = async (): Promise<void> => {
      try {
        if (menu === 'mode') setPresets(await onLoadPresets?.() ?? [])
        else if (menu === 'branch') setBranches(await onLoadBranches?.() ?? [])
        else if (menu === 'command') setCommands(await onLoadCommands?.() ?? [])
        else if (menu === 'model') {
          const [nextModels, nextAccess] = await Promise.all([
            onLoadModels?.() ?? Promise.resolve([]),
            onLoadModelAccess?.() ?? Promise.resolve(null),
          ])
          if (live) {
            setModels(nextModels)
            setModelAccess(nextAccess)
          }
        }
      } catch (reason) {
        if (live) setError(reason instanceof Error ? reason.message : '原生数据读取失败')
      } finally {
        if (live) setLoading(false)
      }
    }
    void load()
    return () => { live = false }
  }, [menu, onLoadBranches, onLoadCommands, onLoadModelAccess, onLoadModels, onLoadPresets])

  const act = async (key: string, action: () => Promise<void> | void, close = true): Promise<void> => {
    setBusy(key)
    setError(null)
    try {
      await action()
      if (close) onClose()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '操作失败，请重试')
    } finally {
      setBusy(null)
    }
  }

  const empty = (text: string) => <div className="diywx-native-empty">{text}</div>
  const row = (
    key: string,
    title: string,
    detail: string | undefined,
    current: boolean,
    action: () => Promise<void> | void,
    close = true,
  ) => (
    <button
      key={key}
      type="button"
      className="diywx-native-row"
      data-current={current || undefined}
      disabled={busy !== null}
      onClick={() => { void act(key, action, close) }}
    >
      <span className="diywx-native-check">{current ? '✓' : ''}</span>
      <span><strong>{title}</strong>{detail !== undefined && <small>{detail}</small>}</span>
      {busy === key && <i className="diywx-native-spinner" />}
    </button>
  )

  return (
    <section className="diywx-tool-popover" role="dialog" aria-label={item?.label ?? '原生功能'}>
      <header>
        <span><Icon name={item?.icon ?? 'spark'} size={17} />{item?.label}</span>
        <button type="button" aria-label="关闭" onClick={onClose}>×</button>
      </header>
      <div className="diywx-native-list">
        {confirming !== null ? (
          <div className="diywx-access-confirm">
            <strong>启用 Full access？</strong>
            <p>这会允许 Harness 在当前会话中执行高权限操作。请只在你信任当前任务时启用。</p>
            <div>
              <button type="button" onClick={() => { setConfirming(null) }}>取消</button>
              <button
                type="button"
                className="diywx-native-primary"
                disabled={busy !== null}
                onClick={() => { void act(confirming.value, async () => { await onSelectPermission?.(confirming.value) }) }}
              >我已了解，启用</button>
            </div>
          </div>
        ) : menu === 'workspace' ? (
          <>
            {workspaces.map(option => row(option.id, option.title, option.path, option.current === true, async () => { await onStartWorkspace?.(option.id) }))}
            {workspaces.length === 0 && empty('还没有工作区')}
            <button type="button" className="diywx-native-secondary" onClick={() => { void act('add-workspace', async () => { await onAddWorkspace?.() }) }}>
              <Icon name="folder-plus" size={15} />添加工作区
            </button>
          </>
        ) : menu === 'mode' ? (
          <>
            {!blank && <div className="diywx-native-hint">已有对话不能更换 Agent 模式；可在新会话中选择。</div>}
            {blank && presets.map(option => row(option.id, option.name, option.description, option.current === true, async () => { await onSelectPreset?.(option.id) }))}
            {blank && !loading && presets.length === 0 && empty('没有可用的 Agent 模式')}
            <button type="button" className="diywx-native-secondary" onClick={() => { void act('manage-mode', async () => { await onOpenSettings?.('agent-presets') }) }}>
              <Icon name="settings" size={15} />管理 Agent 模式
            </button>
          </>
        ) : menu === 'branch' ? (
          workspacePath === undefined || workspacePath === ''
            ? empty('当前会话没有工作区')
            : <>{branches.map(option => row(option.name, option.name, option.current ? '当前分支' : undefined, option.current === true, async () => { await onSwitchBranch?.(option.name) }))}{!loading && branches.length === 0 && empty('当前工作区不是 Git 仓库')}</>
        ) : menu === 'command' ? (
          <>{commands.map(option => (
            <button
              key={option.name}
              type="button"
              className="diywx-native-row diywx-command-row"
              onClick={() => { onInsertCommand(`/${option.name}${option.hint === undefined ? '' : ' '}`); onClose() }}
            >
              <span className="diywx-command-mark">/</span>
              <span><strong>{option.name}</strong><small>{option.description}{option.hint === undefined ? '' : ` · ${option.hint}`}</small></span>
            </button>
          ))}{!loading && commands.length === 0 && empty('当前会话没有可用命令')}</>
        ) : menu === 'access' ? (
          <>{permissions.map(option => row(option.value, option.name, option.description, option.current === true, async () => {
            if (option.dangerous === true && !option.current) { setConfirming(option); return }
            await onSelectPermission?.(option.value)
          }, !(option.dangerous === true && !option.current)))}{!loading && permissions.length === 0 && empty('当前 Harness 未提供权限切换')}</>
        ) : (
          <>
            {models.map((option) => {
              const selectedEffort = option.reasoningEfforts?.find(effort => effort.id === option.reasoningEffort)
              const detail = `${option.providerName}${option.current === true && selectedEffort !== undefined ? ` · ${selectedEffort.name}` : ''}`
              return row(option.key, option.name, detail, option.current === true, async () => { await onSelectModel?.(option) })
            })}
            {!loading && models.length === 0 && empty('没有可用模型')}
            {currentModel !== undefined && (currentModel.reasoningEfforts?.length ?? 0) > 0 && (
              <div className="diywx-effort-section">
                <div className="diywx-native-section-title"><span>推理强度</span><small>{currentEffort?.name ?? currentModel.reasoningEffort ?? '由模型决定'}</small></div>
                {currentModel.reasoningEfforts?.map(effort => row(
                  `effort:${currentModel.key}:${effort.id}`,
                  effort.name,
                  effort.description,
                  currentModel.reasoningEffort === effort.id,
                  async () => { await onSelectModel?.({ ...currentModel, reasoningEffort: effort.id }) },
                ))}
              </div>
            )}
            {modelAccess !== null && (
              <div className="diywx-model-access">
                <div className="diywx-native-section-title">
                  <span>{modelAccess.providerLabel ?? '模型服务'}</span>
                  <small data-configured={modelAccess.configured || undefined}>{modelAccess.configured ? '已安全接入' : '尚未接入'}</small>
                </div>
                {modelAccess.canConfigure ? (
                  <>
                    <p>仅宿主本机可更新 API Key。页面只能读取“是否已配置”，不会回显明文。</p>
                    <div className="diywx-model-key-row">
                      <input
                        type="password"
                        autoComplete="new-password"
                        value={apiKeyDraft}
                        placeholder={modelAccess.configured ? '输入新 Key 以替换现有配置' : '输入 DeepSeek API Key'}
                        aria-label="DeepSeek API Key"
                        disabled={busy !== null || !modelAccess.writable}
                        onChange={(event) => { setApiKeyDraft(event.target.value); setError(null) }}
                        onKeyDown={(event) => {
                          if (event.key !== 'Enter' || apiKeyDraft.trim() === '') return
                          event.preventDefault()
                          void act('save-model-key', async () => {
                            const next = await onSaveModelAccess?.(apiKeyDraft.trim())
                            setApiKeyDraft('')
                            if (next !== undefined) setModelAccess(next)
                            setModels(await onLoadModels?.() ?? [])
                          }, false)
                        }}
                      />
                      <button
                        type="button"
                        className="diywx-native-primary"
                        disabled={busy !== null || apiKeyDraft.trim() === '' || !modelAccess.writable}
                        onClick={() => {
                          void act('save-model-key', async () => {
                            const next = await onSaveModelAccess?.(apiKeyDraft.trim())
                            setApiKeyDraft('')
                            if (next !== undefined) setModelAccess(next)
                            setModels(await onLoadModels?.() ?? [])
                          }, false)
                        }}
                      >{busy === 'save-model-key' ? '保存中…' : modelAccess.configured ? '更新 Key' : '保存并启用'}</button>
                    </div>
                  </>
                ) : (
                  <p>{modelAccess.configured ? '模型凭据由宿主安全托管；局域网成员可以使用，但无法查看或修改明文。' : '请让宿主在本机打开群聊入口，并在这里配置模型凭据。'}</p>
                )}
              </div>
            )}
          </>
        )}
        {loading && <div className="diywx-native-loading"><i className="diywx-native-spinner" />正在读取 Harness…</div>}
        {error !== null && <div className="diywx-native-error" role="alert">{error}</div>}
      </div>
    </section>
  )
}

export function ConversationPane({
  sessionId,
  avatar,
  userAvatar,
  title,
  subtitle,
  workspace,
  workspaceLabel,
  workspacePath,
  mode,
  branch,
  access,
  model,
  blank = false,
  workspaces = [],
  permissions = [],
  messages,
  hasMore = false,
  loadingOlder = false,
  onLoadOlder,
  imageLimits,
  pendingQuestion,
  running,
  createdAt,
  updatedAt,
  totalTokens,
  disabled = false,
  onSend,
  onLoadImage,
  onOpenPluginFile,
  onReadWorkspaceHtml,
  forwardTargets = [],
  onForwardMessages,
  subagents = [],
  onLoadSubagent,
  onCancel,
  onRenameTitle,
  onRenameSubtitle,
  onPreviewAvatar,
  onDownloadWorkspace,
  onOpenCollaboration,
  collaborationActive = false,
  collaborationMemberCount,
  collaborationMode,
  collaborationCanManage = false,
  collaborationParticipants = [],
  collaborationApp,
  collaborationDecision,
  onChangeCollaborationMode,
  onToggleCollaborationParticipant,
  onAddWorkspace,
  onStartWorkspace,
  onOpenSettings,
  onLoadPresets,
  onSelectPreset,
  onLoadBranches,
  onSwitchBranch,
  onLoadCommands,
  onRunCommand,
  onSelectPermission,
  onLoadModels,
  onSelectModel,
  onLoadModelAccess,
  onSaveModelAccess,
}: ConversationPaneProps) {
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [menu, setMenu] = useState<ToolMenuId | null>(null)
  const [headMenu, setHeadMenu] = useState<'details' | null>(null)
  const [personaOpen, setPersonaOpen] = useState(false)
  const [persona, setPersona] = useState<SessionPersona>(() => loadSessionPersona(sessionId))
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [editingTitle, setEditingTitle] = useState(false)
  const [editingSubtitle, setEditingSubtitle] = useState(false)
  const [titleDraft, setTitleDraft] = useState(title)
  const [subtitleDraft, setSubtitleDraft] = useState(subtitle ?? '')
  const [renaming, setRenaming] = useState(false)
  const [pendingImages, setPendingImages] = useState<PendingImage[]>([])
  const [pendingFiles, setPendingFiles] = useState<PendingFile[]>([])
  const [recycleState, setRecycleState] = useState<MessageRecycleState>(loadMessageRecycleState)
  const [messageContext, setMessageContext] = useState<MessageContextState | null>(null)
  const [selectingMessages, setSelectingMessages] = useState(false)
  const [selectedMessageIds, setSelectedMessageIds] = useState<string[]>([])
  const [deleteSelection, setDeleteSelection] = useState<readonly import('./types.ts').ChatMessageView[] | null>(null)
  const [forwardSelection, setForwardSelection] = useState<readonly import('./types.ts').ChatMessageView[] | null>(null)
  const [sideTarget, setSideTarget] = useState<ConversationSideTarget | null>(null)
  const [sidePresentation, setSidePresentation] = useState<SidePresentation>('docked')
  const [profilePopover, setProfilePopover] = useState<{ left: number; top: number } | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const [followingTail, setFollowingTail] = useState(true)
  const [pendingSchedule, setPendingSchedule] = useState<ScheduleIntent | null>(null)
  const [savingSchedule, setSavingSchedule] = useState(false)
  const [collaborationBusy, setCollaborationBusy] = useState<string | null>(null)
  const [downloadBusy, setDownloadBusy] = useState(false)
  const [humanOnly, setHumanOnly] = useState(loadHumanOnly)
  const [revealedTimeId, setRevealedTimeId] = useState<string | null>(null)
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const imageFileRef = useRef<HTMLInputElement | null>(null)
  const documentFileRef = useRef<HTMLInputElement | null>(null)
  const pendingImagesRef = useRef<PendingImage[]>([])
  const followingTailRef = useRef(true)
  const toastTimerRef = useRef<number | null>(null)
  const humanOnlyActive = collaborationMode !== undefined && humanOnly
  const availableMessages = useMemo(() => messages.filter(message => !isChatMessageDeleted(recycleState, sessionId, message.id) && hasVisibleMessageContent(message)), [messages, recycleState, sessionId])
  const visibleMessages = useMemo(() => humanOnlyActive ? availableMessages.filter(message => message.human === true) : availableMessages, [availableMessages, humanOnlyActive])
  const selectableMessages = useMemo(() => visibleMessages.filter(message => message.role !== 'status' && message.pending !== true && message.tool === undefined), [visibleMessages])
  const selectedMessages = useMemo(() => selectableMessages.filter(message => selectedMessageIds.includes(message.id)), [selectableMessages, selectedMessageIds])
  const openSideTarget = (target: ConversationSideTarget): void => {
    setSideTarget(target)
    setSidePresentation(current => current === 'immersive' ? 'docked' : current)
  }
  const openImmersiveTarget = (target: ConversationSideTarget): void => {
    setSideTarget(target)
    setSidePresentation('immersive')
  }

  const openMessagePreview = (target: MessagePreviewTarget): void => {
    if (target.kind === 'browser') {
      openSideTarget({ kind: 'browser', url: target.url })
      return
    }
    if (onReadWorkspaceHtml === undefined) {
      void onOpenPluginFile?.(target.path)
      return
    }
    void onReadWorkspaceHtml(target.path).then((html) => {
      const title = target.path.split(/[/\\]/u).at(-1) ?? '网页预览'
      openSideTarget({ kind: 'visualization', title, html, path: target.path })
    }).catch((reason: unknown) => {
      showToast(reason instanceof Error ? reason.message : '本地网页读取失败')
    })
  }

  useEffect(() => { pendingImagesRef.current = pendingImages }, [pendingImages])

  useEffect(() => {
    const refresh = (): void => { setRecycleState(loadMessageRecycleState()) }
    window.addEventListener(MESSAGE_RECYCLE_EVENT, refresh)
    const timer = window.setInterval(refresh, 60 * 60 * 1000)
    return () => {
      window.removeEventListener(MESSAGE_RECYCLE_EVENT, refresh)
      window.clearInterval(timer)
    }
  }, [])

  useEffect(() => () => {
    pendingImagesRef.current.forEach((image) => { URL.revokeObjectURL(image.previewUrl) })
    if (toastTimerRef.current !== null) window.clearTimeout(toastTimerRef.current)
  }, [])

  useEffect(() => {
    setPendingImages((previous) => {
      previous.forEach((image) => { URL.revokeObjectURL(image.previewUrl) })
      return []
    })
    setPendingFiles([])
    setMessageContext(null)
    setSelectingMessages(false)
    setSelectedMessageIds([])
    setDeleteSelection(null)
    setForwardSelection(null)
    setSideTarget(null)
    setSidePresentation('docked')
    setProfilePopover(null)
    setPendingSchedule(null)
    setRevealedTimeId(null)
    followingTailRef.current = true
    setFollowingTail(true)
  }, [sessionId])

  useEffect(() => {
    if (!followingTailRef.current) return
    const element = scrollRef.current
    if (element !== null) element.scrollTop = element.scrollHeight
  }, [collaborationDecision?.confirmed, collaborationDecision?.key, pendingQuestion?.key, running, visibleMessages])

  useEffect(() => {
    setSelectedMessageIds(previous => previous.filter(id => selectableMessages.some(message => message.id === id)))
  }, [selectableMessages])

  useEffect(() => {
    if (messageContext === null && !selectingMessages) return
    const close = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      if (messageContext !== null) setMessageContext(null)
      else { setSelectingMessages(false); setSelectedMessageIds([]) }
    }
    window.addEventListener('keydown', close)
    return () => { window.removeEventListener('keydown', close) }
  }, [messageContext, selectingMessages])

  const awaitingAnswer = pendingQuestion !== undefined
  const hasStreamingMessage = visibleMessages.some(message => message.pending === true)
  const statusSubtitle = awaitingAnswer ? 'DeepSeek 等待你的回答' : running ? 'DeepSeek 正在处理…' : 'DeepSeek Harness'
  const visibleSubtitle = subtitle?.trim() || statusSubtitle
  const assistantAvatar: AvatarView = collaborationMode === undefined ? avatar : { glyph: 'whale', color: '#2f6bff' }

  const showToast = (text: string): void => {
    setToast(text)
    if (toastTimerRef.current !== null) window.clearTimeout(toastTimerRef.current)
    toastTimerRef.current = window.setTimeout(() => {
      setToast(null)
      toastTimerRef.current = null
    }, 1600)
  }

  const updateTailFollowing = (): void => {
    const element = scrollRef.current
    if (element === null) return
    const atTail = element.scrollHeight - element.scrollTop - element.clientHeight <= 72
    if (atTail === followingTailRef.current) return
    followingTailRef.current = atTail
    setFollowingTail(atTail)
  }

  const scrollToTail = (behavior: ScrollBehavior = 'smooth'): void => {
    followingTailRef.current = true
    setFollowingTail(true)
    const element = scrollRef.current
    if (element !== null) element.scrollTo({ top: element.scrollHeight, behavior })
  }

  const copyMessage = async (context: MessageContextState): Promise<void> => {
    setMessageContext(null)
    const text = context.copyText.trim()
    if (text === '') {
      showToast('这条消息没有可复制的文字')
      return
    }
    try {
      await writeClipboardText(text)
      showToast('已复制')
    } catch (reason) {
      setError(reason instanceof Error ? `复制失败：${reason.message}` : '复制失败，请检查剪贴板权限')
    }
  }

  useEffect(() => {
    if (!editingTitle) setTitleDraft(title)
  }, [editingTitle, title])

  useEffect(() => {
    if (!editingSubtitle) setSubtitleDraft(subtitle ?? '')
  }, [editingSubtitle, subtitle])

  useEffect(() => {
    setPersona(loadSessionPersona(sessionId))
    setPersonaOpen(false)
  }, [sessionId])

  const saveTitle = async (): Promise<void> => {
    const value = titleDraft.trim()
    if (value === title || onRenameTitle === undefined) { setEditingTitle(false); return }
    if (value === '') { setError('主标题不能为空'); return }
    setRenaming(true)
    setError(null)
    try {
      await onRenameTitle(value)
      setEditingTitle(false)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '标题修改失败')
    } finally {
      setRenaming(false)
    }
  }

  const saveSubtitle = async (): Promise<void> => {
    try {
      await onRenameSubtitle?.(subtitleDraft.trim())
      setEditingSubtitle(false)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '副标题修改失败')
    }
  }

  const clearPendingImages = (): void => {
    setPendingImages((previous) => {
      previous.forEach((image) => { URL.revokeObjectURL(image.previewUrl) })
      return []
    })
  }

  const clearPendingFiles = (): void => { setPendingFiles([]) }

  const addImageFiles = (files: readonly File[]): void => {
    if (files.length === 0 || disabled || awaitingAnswer) return
    const mediaTypes = imageLimits?.mediaTypes ?? DEFAULT_IMAGE_TYPES
    if (files.some(file => !mediaTypes.includes(file.type))) {
      setError('仅支持 PNG、JPG、WebP、GIF 图片')
      return
    }
    if (imageLimits !== undefined) {
      if (pendingImages.length + files.length > imageLimits.maxImagesPerMessage) {
        setError(`一条消息最多添加 ${imageLimits.maxImagesPerMessage} 张图片`)
        return
      }
      const oversized = files.find(file => file.size > imageLimits.maxImageBytes)
      if (oversized !== undefined) {
        setError(`“${oversized.name}”超过单张 ${bytesLabel(imageLimits.maxImageBytes)} 的限制`)
        return
      }
      const totalBytes = pendingImages.reduce((sum, image) => sum + image.file.size, 0) + files.reduce((sum, file) => sum + file.size, 0)
      if (totalBytes > imageLimits.maxMessageImageBytes) {
        setError(`本条消息的图片总大小不能超过 ${bytesLabel(imageLimits.maxMessageImageBytes)}`)
        return
      }
    }
    setError(null)
    setPendingImages(previous => [...previous, ...files.map(file => ({
      id: createClientId('pending-image'),
      file,
      previewUrl: URL.createObjectURL(file),
    }))])
  }

  const addDocumentFiles = (files: readonly File[]): void => {
    if (files.length === 0 || disabled || awaitingAnswer) return
    if (pendingFiles.length + files.length > MAX_FILES_PER_MESSAGE) {
      setError(`一条消息最多添加 ${MAX_FILES_PER_MESSAGE} 个文件`)
      return
    }
    const oversized = files.find(file => file.size > MAX_FILE_BYTES)
    if (oversized !== undefined) {
      setError(`“${oversized.name}”超过单个 ${bytesLabel(MAX_FILE_BYTES)} 的限制`)
      return
    }
    const totalBytes = pendingFiles.reduce((sum, item) => sum + item.file.size, 0) + files.reduce((sum, file) => sum + file.size, 0)
    if (totalBytes > MAX_MESSAGE_FILE_BYTES) {
      setError(`本条消息的文件总大小不能超过 ${bytesLabel(MAX_MESSAGE_FILE_BYTES)}`)
      return
    }
    setError(null)
    setPendingFiles(previous => [...previous, ...files.map(file => ({ id: createClientId('pending-file'), file }))])
  }

  const addDroppedFiles = (files: readonly File[]): void => {
    const images = files.filter(file => file.type.startsWith('image/') || /\.(?:png|jpe?g|webp|gif)$/iu.test(file.name))
    const documents = files.filter(file => !images.includes(file))
    if (images.length > 0) addImageFiles(images)
    if (documents.length > 0) addDocumentFiles(documents)
  }
  const addDroppedFilesRef = useRef(addDroppedFiles)
  addDroppedFilesRef.current = addDroppedFiles

  useEffect(() => {
    if (disabled || awaitingAnswer || personaOpen) return
    return installDocumentFileDrop((files) => { addDroppedFilesRef.current(files) })
  }, [awaitingAnswer, disabled, personaOpen])

  const submit = async (): Promise<void> => {
    const text = draft.trim()
    if ((text === '' && pendingImages.length === 0 && pendingFiles.length === 0) || disabled || busy) return
    if (text.startsWith('/') && (pendingImages.length > 0 || pendingFiles.length > 0)) {
      setError('命令消息暂不支持附件，请先移除附件或改为普通消息')
      return
    }
    if (pendingImages.length === 0 && pendingFiles.length === 0 && sessionId !== undefined) {
      const schedule = parseScheduleIntent(text)
      if (schedule !== undefined) {
        setPendingSchedule(schedule)
        setError(null)
        return
      }
    }
    setBusy(true)
    setError(null)
    setNotice(null)
    followingTailRef.current = true
    setFollowingTail(true)
    try {
      if (text.startsWith('/') && onRunCommand !== undefined) {
        const result = await onRunCommand(text)
        setNotice(result ?? '命令已交给 Harness 执行')
      } else {
        await onSend(text, pendingImages.map(image => image.file), pendingFiles.map(file => file.file))
      }
      setDraft('')
      clearPendingImages()
      clearPendingFiles()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '发送失败，请稍后重试')
    } finally {
      setBusy(false)
    }
  }

  const confirmSchedule = async (): Promise<void> => {
    if (pendingSchedule === null || sessionId === undefined || savingSchedule) return
    const schedule = pendingSchedule
    setSavingSchedule(true)
    setError(null)
    try {
      await createConversationSchedule({ ...schedule, sessionId })
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '定时任务创建失败，请稍后重试')
      setSavingSchedule(false)
      return
    }

    setDraft('')
    setPendingSchedule(null)
    setNotice(`已设置：${schedule.scheduleLabel}，会在当前会话主动发消息`)

    try {
      await onSend([
        '<<<DSH_DIY_SCHEDULE_CONFIRMED>>>',
        `微信式界面的后台调度器已经持久化该任务：${schedule.scheduleLabel}，目标是当前会话。`,
        '请只用简体中文简短确认已设置成功；不要再表示无法后台定时，也不要复述内部标记。',
        '<<<DSH_DIY_USER_MESSAGE>>>',
        schedule.original,
      ].join('\n'))
    } catch (reason) {
      setError(reason instanceof Error
        ? `定时任务已创建，但确认消息发送失败：${reason.message}`
        : '定时任务已创建，但确认消息发送失败')
    } finally {
      setSavingSchedule(false)
    }
  }

  const beginMessageSelection = (message: import('./types.ts').ChatMessageView): void => {
    setMessageContext(null)
    setSelectingMessages(true)
    setSelectedMessageIds([message.id])
  }

  const toggleMessageSelection = (messageId: string): void => {
    setSelectedMessageIds(previous => previous.includes(messageId)
      ? previous.filter(id => id !== messageId)
      : [...previous, messageId])
  }

  const recycleMessages = (selection: readonly import('./types.ts').ChatMessageView[]): void => {
    if (sessionId === undefined || selection.length === 0) return
    setRecycleState(deleteChatMessages(sessionId, title, selection))
    setDeleteSelection(null)
    setSelectingMessages(false)
    setSelectedMessageIds([])
    setNotice(selection.length === 1 ? '聊天记录已移入回收站，30 天内可恢复' : `${selection.length} 条聊天记录已移入回收站，30 天内可恢复`)
  }

  const showConversationProfile = (element: HTMLElement): void => {
    const rect = element.getBoundingClientRect()
    const width = 292
    const height = 300
    const gap = 10
    const left = rect.right + gap + width <= window.innerWidth
      ? rect.right + gap
      : Math.max(12, rect.left - width - gap)
    setProfilePopover({
      left,
      top: Math.max(12, Math.min(rect.top - 4, window.innerHeight - height - 12)),
    })
  }

  const changeCollaborationMode = async (value: NonNullable<ConversationPaneProps['collaborationMode']>): Promise<void> => {
    if (!collaborationCanManage || value === collaborationMode || collaborationBusy !== null) return
    setCollaborationBusy(`mode:${value}`)
    setError(null)
    try { await onChangeCollaborationMode?.(value) } catch (reason) {
      setError(reason instanceof Error ? reason.message : '群聊模式切换失败')
    } finally { setCollaborationBusy(null) }
  }

  const toggleCollaborationParticipant = async (userId: string, muted: boolean): Promise<void> => {
    if (!collaborationCanManage || collaborationBusy !== null) return
    setCollaborationBusy(`member:${userId}`)
    setError(null)
    try { await onToggleCollaborationParticipant?.(userId, muted) } catch (reason) {
      setError(reason instanceof Error ? reason.message : '成员 AI 状态修改失败')
    } finally { setCollaborationBusy(null) }
  }

  return (
    <div className="diywx-conversation" data-side-open={sideTarget !== null || undefined} {...sideTarget === null ? {} : { 'data-side-presentation': sidePresentation }} data-collaboration-mode={collaborationMode}>
      <header className="diywx-conversation-head">
        <div className="diywx-conversation-person">
          <button
            className="diywx-head-avatar"
            type="button"
            title="查看头像大图"
            aria-label="查看头像大图"
            onClick={() => { onPreviewAvatar?.() }}
          >
            <AvatarBadge avatar={avatar} size={36} />
          </button>
          <div>
            <div className="diywx-head-title-line">
              {editingTitle ? (
                <input
                  className="diywx-head-title-input"
                  autoFocus
                  value={titleDraft}
                  disabled={renaming}
                  onChange={(event) => { setTitleDraft(event.target.value) }}
                  onBlur={() => { void saveTitle() }}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') event.currentTarget.blur()
                    else if (event.key === 'Escape') { setTitleDraft(title); setEditingTitle(false) }
                  }}
                  aria-label="编辑会话主标题"
                />
              ) : (
                <button className="diywx-head-editable diywx-head-title" type="button" title="点击修改主标题" onClick={() => { setEditingTitle(true) }}>
                  <strong>{title}</strong><Icon name="edit" size={11} />
                </button>
              )}
              {workspaceLabel !== undefined && workspaceLabel.trim() !== '' && (
                <span className="diywx-head-workspace" title={`所属工作区：${workspaceLabel}`}>（{workspaceLabel}）</span>
              )}
            </div>
            {editingSubtitle ? (
              <input
                className="diywx-head-subtitle-input"
                autoFocus
                value={subtitleDraft}
                onChange={(event) => { setSubtitleDraft(event.target.value) }}
                onBlur={() => { void saveSubtitle() }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') event.currentTarget.blur()
                  else if (event.key === 'Escape') { setSubtitleDraft(subtitle ?? ''); setEditingSubtitle(false) }
                }}
                placeholder={statusSubtitle}
                aria-label="编辑会话副标题"
              />
            ) : (
              <button className="diywx-head-editable diywx-head-subtitle" type="button" title="点击修改副标题" onClick={() => { setSubtitleDraft(subtitle ?? ''); setEditingSubtitle(true) }}>
                <span>{visibleSubtitle}</span><Icon name="edit" size={9} />
              </button>
            )}
          </div>
        </div>
        <div className="diywx-head-actions">
          {collaborationMode !== undefined && (
            <button
              className="diywx-icon-button diywx-human-only-entry"
              data-active={humanOnlyActive || undefined}
              type="button"
              title={humanOnlyActive ? '显示全部消息（当前只看真人）' : '只看真人消息，隐藏 AI 回复、思考和状态'}
              aria-label={humanOnlyActive ? '显示全部消息' : '只看真人消息'}
              aria-pressed={humanOnlyActive}
              onClick={() => {
                const next = !humanOnly
                setHumanOnly(next)
                saveHumanOnly(next)
                setMessageContext(null)
                setSelectingMessages(false)
                setSelectedMessageIds([])
                showToast(next ? '已隐藏 AI 回复、思考和状态，只显示真人交流' : '已恢复显示全部消息')
              }}
            ><Icon name="people" size={21} /></button>
          )}
          {onDownloadWorkspace !== undefined && (
            <button
              className="diywx-icon-button"
              type="button"
              title="下载此会话的代码包"
              aria-label="下载此会话的代码包"
              disabled={downloadBusy}
              onClick={() => {
                setDownloadBusy(true)
                setError(null)
                Promise.resolve(onDownloadWorkspace()).catch((reason) => {
                  setError(reason instanceof Error ? reason.message : '代码包下载失败')
                }).finally(() => { setDownloadBusy(false) })
              }}
            ><Icon name="download" size={20} /></button>
          )}
          {onOpenCollaboration !== undefined && (
            <button
              className="diywx-icon-button diywx-collaboration-entry"
              data-active={collaborationActive || undefined}
              type="button"
              title={collaborationActive ? `多人会话${collaborationMemberCount === undefined ? '' : ` · ${collaborationMemberCount} 人`}` : '转为多人会话'}
              aria-label={collaborationActive ? '打开多人会话设置' : '转为多人会话'}
              onClick={onOpenCollaboration}
            ><Icon name="plus" size={21} />{collaborationActive && <span>{collaborationMemberCount ?? ''}</span>}</button>
          )}
          <button
            className="diywx-icon-button diywx-persona-entry"
            data-active={personaOpen || persona.enabled || undefined}
            type="button"
            title="会话专属提示词与记忆"
            aria-label="会话专属提示词与记忆"
            disabled={sessionId === undefined}
            onClick={() => { setHeadMenu(null); setPersonaOpen(true) }}
          ><Icon name="spark" size={20} />{persona.enabled && <span />}</button>
          <button className="diywx-icon-button" data-active={headMenu === 'details' || undefined} type="button" title="会话详情" aria-label="会话详情" onClick={() => { setHeadMenu(value => value === 'details' ? null : 'details') }}><Icon name="chat" size={21} /></button>
        </div>
        {headMenu !== null && (
          <section className="diywx-head-popover" role="dialog" aria-label="会话详情">
            <strong>会话详情</strong>
            <dl>
              <div><dt>工作区</dt><dd title={workspacePath}>{workspace}</dd></div>
              <div><dt>模式</dt><dd>{mode}</dd></div>
              <div><dt>分支</dt><dd>{branch}</dd></div>
              <div><dt>权限</dt><dd>{access}</dd></div>
              <div><dt>模型</dt><dd>{model}</dd></div>
            </dl>
          </section>
        )}
      </header>

      {collaborationMode !== undefined && (
        <section className="diywx-collaboration-modebar" aria-label="群聊工作模式与 AI 参与成员">
          <div className="diywx-collaboration-modes" role="radiogroup" aria-label="群聊工作模式">
            {([
              ['chat', '群聊模式', '成员自由聊天，AI 不回复、不收集、不执行'],
              ['discussion', '普通讨论', 'AI 像群成员一样择机交流，不改代码'],
              ['execution', '协作执行', '汇总需求、检查冲突、确认后执行'],
              ['application', '应用服务', '只执行群主应用指令，成员 @AI 才反馈'],
            ] as const).map(([value, label, detail]) => (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={collaborationMode === value}
                data-active={collaborationMode === value || undefined}
                disabled={!collaborationCanManage || collaborationBusy !== null}
                title={detail}
                onClick={() => { void changeCollaborationMode(value) }}
              ><strong>{label}</strong><small>{detail}</small></button>
            ))}
          </div>
          <div className="diywx-collaboration-participants" aria-label="成员 AI 参与状态">
            <span>{collaborationMode === 'chat' ? 'AI 已暂停' : 'AI 收集'}</span>
            {collaborationParticipants.map(participant => (
              <button
                key={participant.id}
                type="button"
                data-muted={participant.aiMuted || undefined}
                data-owner={participant.owner || undefined}
                data-online={participant.online || undefined}
                disabled={!collaborationCanManage || participant.owner || collaborationBusy !== null}
                title={participant.owner ? '群主始终参与 AI' : participant.aiMuted ? `点击让 ${participant.name} 参与 AI` : `点击将 ${participant.name} 设为对 AI 静默`}
                onClick={() => { void toggleCollaborationParticipant(participant.id, !participant.aiMuted) }}
              ><span className="diywx-participant-avatar"><AvatarBadge avatar={participant.avatar} size={22} /><i /></span><span>{participant.name}</span><em>{participant.online ? '在线' : '离线'} · {participant.owner ? '群主' : participant.aiMuted ? '静默' : '参与'}</em></button>
            ))}
            {collaborationApp !== undefined && <button className="diywx-collaboration-app" type="button" onClick={() => { openSideTarget({ kind: 'visualization', title: collaborationApp.title, html: collaborationApp.html }) }}><Icon name="spark" size={14} />打开群应用</button>}
          </div>
        </section>
      )}

      <div
        ref={scrollRef}
        className="diywx-message-area"
        onScroll={updateTailFollowing}
        onClick={(event) => {
          if ((event.target as HTMLElement).closest('.diywx-message-bubble') === null) setRevealedTimeId(null)
        }}
      >
        {hasMore && onLoadOlder !== undefined && (
          <div className="diywx-load-older">
            <button
              type="button"
              disabled={loadingOlder || disabled}
              onClick={() => { void onLoadOlder() }}
            >{loadingOlder ? '正在加载更早的聊天记录…' : '加载更早的聊天记录'}</button>
          </div>
        )}
        {visibleMessages.length === 0 && (
          <div className="diywx-chat-welcome">
            {humanOnlyActive ? <Icon name="people" size={42} /> : <AvatarBadge avatar={avatar} size={58} className="diywx-welcome-avatar" />}
            <strong>{humanOnlyActive ? '当前还没有真人群聊消息' : disabled ? '选择或创建一个会话' : '现在，可以像聊天一样开始工作'}</strong>
            <span>{humanOnlyActive ? '关闭右上角的只看真人开关，即可恢复 AI 回复、思考和状态' : disabled ? '从左侧会话列表进入工作区' : '把你的想法告诉我'}</span>
          </div>
        )}
        {visibleMessages.map((message, index) => {
          const rowVisible = hasMessageRowContent(message)
          const selectable = rowVisible && message.role !== 'status' && message.pending !== true && message.tool === undefined
          const selected = selectedMessageIds.includes(message.id)
          const dividerVisible = shouldShowTimeDivider(message, visibleMessages[index - 1])
          const dividerLabel = message.createdAt === undefined ? message.time : messageTimeLabel(message.createdAt)
          const exactTime = message.createdAt === undefined ? message.time : messageTimeLabel(message.createdAt, true)
          return (
            <Fragment key={message.id}>
              {dividerVisible && dividerLabel !== undefined && <time className="diywx-time-divider">{dividerLabel}</time>}
              <div
                className={`diywx-message-group diywx-${message.role}`}
                data-pending={message.pending || undefined}
                data-selecting={selectingMessages && selectable || undefined}
                data-selected={selected || undefined}
                onContextMenu={(event) => {
                  if (!selectable) return
                  event.preventDefault()
                  event.stopPropagation()
                  const bubble = event.currentTarget.querySelector<HTMLElement>('.diywx-message-bubble')
                  const copyBubble = bubble?.cloneNode(true) as HTMLElement | undefined
                  copyBubble?.querySelectorAll('.diywx-inline-preview').forEach((element) => { element.remove() })
                  setMessageContext({
                    message,
                    copyText: copyBubble?.innerText.trim() ?? message.body.trim(),
                    x: Math.min(event.clientX, window.innerWidth - 180),
                    y: Math.min(event.clientY, window.innerHeight - 220),
                  })
                }}
              >
                {selectingMessages && selectable && (
                  <button
                    type="button"
                    className="diywx-message-select"
                    data-selected={selected || undefined}
                    aria-label={selected ? '取消选择这条消息' : '选择这条消息'}
                    aria-pressed={selected}
                    onClick={() => { toggleMessageSelection(message.id) }}
                  >{selected ? '✓' : ''}</button>
                )}
                {message.role === 'assistant' && message.reasoning !== undefined && (
                  <div className="diywx-message-reasoning">
                    <ReasoningDisclosure text={message.reasoning} pending={message.pending === true} />
                  </div>
                )}
                {rowVisible && <div className={`diywx-message-row diywx-${message.role}`} data-pending={message.pending || undefined}>
                  {message.role === 'assistant' && (
                    <button
                      type="button"
                      className="diywx-message-avatar-button"
                      title="查看会话简介"
                      aria-label="查看会话简介"
                      onClick={(event) => { showConversationProfile(event.currentTarget) }}
                    ><AvatarBadge avatar={message.authorAvatar ?? assistantAvatar} size={36} /></button>
                  )}
                  <div className="diywx-message-stack">
                    {message.role === 'assistant' && message.authorName !== undefined && <small className="diywx-message-author">{message.authorName}</small>}
                    {message.tool !== undefined && (
                      <div className="diywx-plugin-tool-surface" data-chat-anchor-key={`call:${message.tool.callId}`}>
                        <PluginToolCard
                          tool={message.tool}
                          openSide={openSideTarget}
                          openImmersive={openImmersiveTarget}
                          {...onOpenPluginFile === undefined ? {} : { openFile: onOpenPluginFile }}
                        />
                      </div>
                    )}
                    {message.images !== undefined && message.images.length > 0 && (
                      <MessageImageGallery
                        images={message.images}
                        align={message.role === 'user' ? 'end' : 'start'}
                        {...onLoadImage === undefined ? {} : { onLoadImage }}
                      />
                    )}
                    {message.files !== undefined && message.files.length > 0 && (
                      <MessageFileList files={message.files} align={message.role === 'user' ? 'end' : 'start'} />
                    )}
                    {message.body !== '' && <div
                      className="diywx-message-bubble"
                      title={exactTime === undefined ? undefined : '点击查看发送时间'}
                      onClick={(event) => {
                        if ((event.target as HTMLElement).closest('a, button, input, textarea, select') !== null) return
                        setRevealedTimeId(current => current === message.id ? null : message.id)
                      }}
                    ><MarkdownMessage text={message.body} onPreview={openMessagePreview} /></div>}
                    {revealedTimeId === message.id && exactTime !== undefined && <time className="diywx-message-exact-time">{exactTime}</time>}
                  </div>
                  {message.role === 'user' && <AvatarBadge avatar={userAvatar} size={36} className="diywx-user-avatar" />}
                </div>}
              </div>
            </Fragment>
          )
        })}
        {!humanOnlyActive && subagents.length > 0 && (
          <section className="diywx-subagent-section" aria-label={`${subagents.length} 个子 Agent`}>
            <header><span><Icon name="branch" size={16} />{subagents.length} 个子 Agent</span><small>不会占用左侧会话列表</small></header>
            <div className="diywx-subagent-grid">
              {subagents.map((task, index) => (
                <button
                  type="button"
                  className="diywx-subagent-card"
                  key={task.id}
                  data-status={task.status}
                  onClick={() => { openSideTarget({ kind: 'subagent', task }) }}
                >
                  <span className="diywx-subagent-card-avatar"><Icon name="robot" size={17} /></span>
                  <span className="diywx-subagent-card-index">{String(index + 1).padStart(2, '0')}</span>
                  <strong>{task.title}</strong>
                  <small>{task.status === 'running' ? '正在工作，点击查看实时进度' : task.status === 'completed' ? '任务已完成，点击查看结果' : '记录暂时不可用'}</small>
                  <span className="diywx-subagent-card-meta"><i />{task.mode === 'one-shot' ? '一次性任务' : '可继续协作'}{task.hasChildren ? ' · 含下级 Agent' : ''}</span>
                </button>
              ))}
            </div>
          </section>
        )}
        {!humanOnlyActive && collaborationDecision !== undefined && (
          <div className="diywx-message-row diywx-assistant diywx-question-row">
            <button type="button" className="diywx-message-avatar-button" title="查看会话简介" onClick={(event) => { showConversationProfile(event.currentTarget) }}><AvatarBadge avatar={assistantAvatar} size={36} /></button>
            <CollaborationDecisionCard key={collaborationDecision.key} decision={collaborationDecision} />
          </div>
        )}
        {!humanOnlyActive && pendingQuestion !== undefined && (
          <div className="diywx-message-row diywx-assistant diywx-question-row">
            <button type="button" className="diywx-message-avatar-button" title="查看会话简介" onClick={(event) => { showConversationProfile(event.currentTarget) }}><AvatarBadge avatar={assistantAvatar} size={36} /></button>
            <PendingQuestionCard key={pendingQuestion.key} pending={pendingQuestion} />
          </div>
        )}
        {!humanOnlyActive && running && !awaitingAnswer && !hasStreamingMessage && (
          <div className="diywx-message-row diywx-assistant">
            <button type="button" className="diywx-message-avatar-button" title="查看会话简介" onClick={(event) => { showConversationProfile(event.currentTarget) }}><AvatarBadge avatar={assistantAvatar} size={36} /></button>
            <div className="diywx-typing" aria-label="DeepSeek 正在输入"><i /><i /><i /></div>
          </div>
        )}
      </div>

      {!followingTail && (
        <button className="diywx-scroll-tail-button" type="button" title="回到底部并恢复自动跟随" onClick={() => { scrollToTail() }}>
          <Icon name="chevron" size={15} />回到底部
        </button>
      )}

      {selectingMessages && (
        <div className="diywx-message-selection-bar" role="toolbar" aria-label="多选聊天记录操作">
          <button type="button" onClick={() => { setSelectingMessages(false); setSelectedMessageIds([]) }}>取消</button>
          <span>已选择 {selectedMessages.length} 条</span>
          <button type="button" disabled={selectedMessages.length === 0} data-danger onClick={() => { setDeleteSelection(selectedMessages) }}><Icon name="trash" size={16} />删除</button>
          <button type="button" disabled={selectedMessages.length === 0 || onForwardMessages === undefined} data-primary onClick={() => { setForwardSelection(selectedMessages) }}><Icon name="forward" size={16} />{selectedMessages.length > 1 ? '合并转发' : '转发'}</button>
        </div>
      )}

      <footer className="diywx-composer-wrap">
        {error !== null && <div className="diywx-compose-error" role="alert">{error}</div>}
        {notice !== null && <div className="diywx-compose-notice" role="status">{notice}</div>}
        <div
          className="diywx-composer"
          data-disabled={disabled || awaitingAnswer || undefined}
          data-has-attachments={pendingImages.length > 0 || pendingFiles.length > 0 || undefined}
          onDragOver={(event) => {
            if (disabled || awaitingAnswer) return
            const data = fileDataTransfer(event)
            if (data === null) return
            event.preventDefault()
            data.dropEffect = 'copy'
          }}
          onDrop={(event) => {
            if (disabled || awaitingAnswer) return
            const data = fileDataTransfer(event)
            if (data === null) return
            event.preventDefault()
            addDroppedFiles([...data.files])
          }}
        >
          {pendingImages.length > 0 && (
            <div className="diywx-attachment-rail" aria-label={`待发送图片 ${pendingImages.length} 张`}>
              {pendingImages.map(image => (
                <article key={image.id} title={`${image.file.name} · ${bytesLabel(image.file.size)}`}>
                  <img src={image.previewUrl} alt={image.file.name} />
                  <button
                    type="button"
                    title={`移除 ${image.file.name}`}
                    aria-label={`移除图片 ${image.file.name}`}
                    onClick={() => {
                      URL.revokeObjectURL(image.previewUrl)
                      setPendingImages(previous => previous.filter(candidate => candidate.id !== image.id))
                    }}
                  >×</button>
                  <small>{image.file.name}</small>
                </article>
              ))}
            </div>
          )}
          {pendingFiles.length > 0 && (
            <div className="diywx-pending-file-rail" aria-label={`待发送文件 ${pendingFiles.length} 个`}>
              {pendingFiles.map(item => (
                <article key={item.id} title={`${item.file.name} · ${bytesLabel(item.file.size)}`}>
                  <span className="diywx-file-kind">{fileExtension(item.file.name)}</span>
                  <span><strong>{item.file.name}</strong><small>{bytesLabel(item.file.size)}</small></span>
                  <button type="button" title={`移除 ${item.file.name}`} aria-label={`移除文件 ${item.file.name}`} onClick={() => { setPendingFiles(previous => previous.filter(candidate => candidate.id !== item.id)) }}>×</button>
                </article>
              ))}
            </div>
          )}
          <input
            ref={imageFileRef}
            className="diywx-file-input"
            type="file"
            accept={(imageLimits?.mediaTypes ?? DEFAULT_IMAGE_TYPES).join(',')}
            multiple
            onChange={(event) => {
              addImageFiles(Array.from(event.currentTarget.files ?? []))
              event.currentTarget.value = ''
            }}
          />
          <input
            ref={documentFileRef}
            className="diywx-file-input"
            type="file"
            accept={FILE_ACCEPT}
            multiple
            onChange={(event) => {
              addDocumentFiles(Array.from(event.currentTarget.files ?? []))
              event.currentTarget.value = ''
            }}
          />
          <textarea
            value={draft}
            disabled={disabled || awaitingAnswer}
            placeholder={disabled ? '请先选择一个会话' : awaitingAnswer ? '请先回答上方的问题' : '给我发消息…'}
            onChange={(event) => { setDraft(event.target.value) }}
            onPaste={(event) => {
              if (disabled || awaitingAnswer) return
              const files = clipboardFiles(event.clipboardData)
              if (files.length === 0) return
              addDroppedFiles(files)
              if (event.clipboardData.getData('text/plain') === '') event.preventDefault()
            }}
            onKeyDown={(event) => {
              if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return
              event.preventDefault()
              void submit()
            }}
            aria-label="消息输入框"
          />
          <div className="diywx-composer-toolbar">
            <div className="diywx-toolbar-left">
              <button
                type="button"
                className="diywx-tool-button diywx-attachment-button"
                data-tip="上传图片"
                data-active={pendingImages.length > 0 || undefined}
                aria-label="上传图片附件"
                disabled={disabled || awaitingAnswer || busy}
                onClick={() => { imageFileRef.current?.click() }}
              >
                <Icon name="image" size={19} />
                {pendingImages.length > 0 && <small>{pendingImages.length}</small>}
              </button>
              <button
                type="button"
                className="diywx-tool-button diywx-attachment-button"
                data-tip="上传文件"
                data-active={pendingFiles.length > 0 || undefined}
                aria-label="上传文件附件"
                disabled={disabled || awaitingAnswer || busy}
                onClick={() => { documentFileRef.current?.click() }}
              >
                <Icon name="file" size={19} />
                {pendingFiles.length > 0 && <small>{pendingFiles.length}</small>}
              </button>
              {TOOL_ITEMS.filter(item => item.id !== 'workspace' && item.id !== 'mode').map(item => (
                <button
                  key={item.id}
                  type="button"
                  className="diywx-tool-button"
                  data-tip={item.label}
                  data-active={menu === item.id || undefined}
                  aria-label={item.label}
                  onClick={() => { setMenu(current => current === item.id ? null : item.id) }}
                >
                  <Icon name={item.icon} size={19} />
                </button>
              ))}
            </div>
            <button
              type="button"
              className="diywx-send-button"
              disabled={disabled || awaitingAnswer || (!running && draft.trim() === '' && pendingImages.length === 0 && pendingFiles.length === 0) || busy}
              title={running ? '停止' : '发送'}
              aria-label={running ? '停止' : '发送'}
              onClick={() => { if (running) void onCancel(); else void submit() }}
            >
              <Icon name={running ? 'stop' : 'send'} size={19} />
            </button>
          </div>
          {menu !== null && (
            <NativeToolPopover
              key={menu}
              menu={menu}
              blank={blank}
              {...workspacePath === undefined ? {} : { workspacePath }}
              workspaces={workspaces}
              permissions={permissions}
              onClose={() => { setMenu(null) }}
              onInsertCommand={setDraft}
              {...onAddWorkspace === undefined ? {} : { onAddWorkspace }}
              {...onStartWorkspace === undefined ? {} : { onStartWorkspace }}
              {...onOpenSettings === undefined ? {} : { onOpenSettings }}
              {...onLoadPresets === undefined ? {} : { onLoadPresets }}
              {...onSelectPreset === undefined ? {} : { onSelectPreset }}
              {...onLoadBranches === undefined ? {} : { onLoadBranches }}
              {...onSwitchBranch === undefined ? {} : { onSwitchBranch }}
              {...onLoadCommands === undefined ? {} : { onLoadCommands }}
              {...onSelectPermission === undefined ? {} : { onSelectPermission }}
              {...onLoadModels === undefined ? {} : { onLoadModels }}
              {...onSelectModel === undefined ? {} : { onSelectModel }}
              {...onLoadModelAccess === undefined ? {} : { onLoadModelAccess }}
              {...onSaveModelAccess === undefined ? {} : { onSaveModelAccess }}
            />
          )}
        </div>
      </footer>
      {personaOpen && sessionId !== undefined && (
        <SessionPersonaDialog
          sessionTitle={title}
          value={persona}
          onSave={(value) => { saveSessionPersona(sessionId, value); setPersona(value) }}
          onClose={() => { setPersonaOpen(false) }}
        />
      )}
      {messageContext !== null && (
        <div className="diywx-context-scrim" onPointerDown={(event) => { if (event.target === event.currentTarget) setMessageContext(null) }}>
          <div
            className="diywx-session-context diywx-message-context"
            role="menu"
            aria-label="聊天记录操作"
            style={{ left: messageContext.x, top: messageContext.y }}
            onContextMenu={(event) => { event.preventDefault() }}
          >
            <button type="button" role="menuitem" onClick={() => { void copyMessage(messageContext) }}>复制</button>
            <button type="button" role="menuitem" disabled={onForwardMessages === undefined} onClick={() => { setForwardSelection([messageContext.message]); setMessageContext(null) }}>转发</button>
            <button type="button" role="menuitem" onClick={() => { beginMessageSelection(messageContext.message) }}>多选</button>
            <span className="diywx-context-separator" />
            <button className="diywx-context-danger" type="button" role="menuitem" onClick={() => { setDeleteSelection([messageContext.message]); setMessageContext(null) }}>删除</button>
          </div>
        </div>
      )}
      {deleteSelection !== null && (
        <div className="diywx-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setDeleteSelection(null) }}>
          <section className="diywx-delete-dialog" role="alertdialog" aria-modal="true" aria-label="删除聊天记录">
            <strong>删除{deleteSelection.length > 1 ? `这 ${deleteSelection.length} 条` : '这条'}聊天记录？</strong>
            <p>删除后会进入聊天记录回收站，并保留 30 天；期间可以随时恢复。</p>
            <div>
              <button type="button" onClick={() => { setDeleteSelection(null) }}>取消</button>
              <button className="diywx-danger-button" type="button" onClick={() => { recycleMessages(deleteSelection) }}>移入回收站</button>
            </div>
          </section>
        </div>
      )}
      {forwardSelection !== null && (
        <ForwardDialog
          messages={forwardSelection}
          targets={forwardTargets}
          onClose={() => { setForwardSelection(null) }}
          onForward={async (targetSessionId) => {
            if (onForwardMessages === undefined) throw new Error('当前 Harness 暂时无法转发')
            await onForwardMessages(targetSessionId, title, forwardSelection, forwardSelection.length > 1)
            const target = forwardTargets.find(candidate => candidate.id === targetSessionId)
            setNotice(`已转发到“${target?.title ?? '目标会话'}”`)
            setSelectingMessages(false)
            setSelectedMessageIds([])
          }}
        />
      )}
      {sideTarget !== null && (
        <ConversationSidePanel
          target={sideTarget}
          presentation={sidePresentation}
          {...sideTarget.kind === 'subagent' ? {} : { onPresentationChange: setSidePresentation }}
          onClose={() => { setSideTarget(null); setSidePresentation('docked') }}
          {...onLoadSubagent === undefined ? {} : { onLoadSubagent }}
        />
      )}
      {profilePopover !== null && (
        <div className="diywx-profile-popover-scrim" onPointerDown={(event) => { if (event.target === event.currentTarget) setProfilePopover(null) }}>
          <section
            className="diywx-conversation-profile"
            role="dialog"
            aria-label="会话简介"
            style={{ left: profilePopover.left, top: profilePopover.top }}
          >
            <header>
              <button
                type="button"
                className="diywx-profile-avatar-button"
                title="更换会话头像"
                aria-label="更换会话头像"
                onClick={() => {
                  setProfilePopover(null)
                  onPreviewAvatar?.()
                }}
              >
                <AvatarBadge avatar={assistantAvatar} size={60} />
                <span className="diywx-profile-avatar-edit"><Icon name="edit" size={10} /></span>
              </button>
              <span><strong>{title}</strong><small>{visibleSubtitle}</small></span>
              <button className="diywx-profile-close" type="button" title="关闭" aria-label="关闭会话简介" onClick={() => { setProfilePopover(null) }}>×</button>
            </header>
            <dl>
              <div><dt>创建时间</dt><dd>{profileDate(createdAt)}</dd></div>
              <div><dt>最近交互</dt><dd>{profileDate(updatedAt)}</dd></div>
              <div><dt>总消耗</dt><dd>{tokenLabel(totalTokens)}</dd></div>
            </dl>
          </section>
        </div>
      )}
      {pendingSchedule !== null && (
        <div className="diywx-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !savingSchedule) setPendingSchedule(null) }}>
          <section className="diywx-schedule-dialog" role="dialog" aria-modal="true" aria-label="确认定时任务">
            <header>
              <span className="diywx-schedule-icon"><Icon name="board" size={20} /></span>
              <span><strong>确认定时任务</strong><small>识别到你希望我在这个会话主动发消息</small></span>
              <button type="button" aria-label="关闭" disabled={savingSchedule} onClick={() => { setPendingSchedule(null) }}>×</button>
            </header>
            <div className="diywx-schedule-summary">
              <div><span>时间</span><strong>{pendingSchedule.scheduleLabel}</strong></div>
              <div><span>会话</span><strong>{title}</strong></div>
              <div><span>内容</span><strong>{pendingSchedule.prompt}</strong></div>
            </div>
            <p><Icon name="shield" size={14} />只投递到当前会话；后台唤醒指令不会显示在聊天记录里。任务会同时登记到任务看板。</p>
            <footer>
              <button type="button" disabled={savingSchedule} onClick={() => { setPendingSchedule(null) }}>取消</button>
              <button type="button" data-primary disabled={savingSchedule} onClick={() => { void confirmSchedule() }}>{savingSchedule ? '正在保存…' : '确认并启用'}</button>
            </footer>
          </section>
        </div>
      )}
      {toast !== null && <div className="diywx-toast" role="status" aria-live="polite">{toast}</div>}
    </div>
  )
}
