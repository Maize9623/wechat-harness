import type { Context } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { resolveWorkspacePath } from '@deepseek-ai/dsh-util-workspace-path'
import { resolveSlotLabel } from '@deepseek-ai/dsh-client-ui-slots'
import type { SessionReference } from '@deepseek-ai/dsh-api-session-controller/client'
import type {} from '@deepseek-ai/dsh-api-workspace-files/remote'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'

declare module '@deepseek-ai/dsh-api-session-controller/client' {
  interface SessionReferenceSourceMap {
    wechatOverlay: unknown
  }
}
import { loadWorkspaceHtml } from './workspaceHtml.ts'
import { userMessagesFromHistory, oldestEventSeq } from './conversationMessages.ts'
import { LiveChat, type LiveChatInjected } from './LiveChat.tsx'
import { LocalUiOverlay, notifySelectedSession, type LiveOverlayInjected } from './LiveOverlay.tsx'
import { bindSessionAttention } from './sessionAttention.ts'
import { augmentSessionPrompt, visibleUserText } from './persona.ts'
import { filePromptContext, uploadLocalFiles } from './fileAttachments.ts'
import { clearAutoMetadata, generatedMetadata, pendingAutoMetadata, storeGeneratedSubtitle } from './sessionMeta.ts'
import { readLocalUiMode, switchLocalUiMode, type LocalUiMode } from './uiMode.ts'
import {
  COMPOSER_FEATURE_ITEMS,
  DEFAULT_HIDDEN_COMPOSER_FEATURES,
  readHiddenComposerFeatures,
  writeHiddenComposerFeatures,
} from './composerVisibility.ts'
import { fetchGroupChatEntry, launchGroupChatWindow } from './groupChatEntry.ts'
import {
  fetchInstalledSkills,
  insertSkillInstallTeach,
  installSkillFromComposer,
  skillInstallFriendlyEnabled,
  skillInstallSourceOf,
  skillViewFromSessionEntry,
  writeSkillInstallFriendly,
} from './skillInstall.ts'
import { autoCodexPromptAnswer, shouldShowCodexTextPrompt } from './codexLogin.ts'
import type {
  BranchOptionView,
  ChatMessageView,
  ChatImageView,
  CommandOptionView,
  ModelAccessView,
  ModelOptionView,
  NewSessionDraft,
  PresetOptionView,
  SessionModelView,
  SessionUsageHistoryView,
  SubagentDetailView,
  SubagentTaskView,
  TokenUsageView,
  UsageSampleView,
} from './types.ts'

type SupportedImageMediaType = 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif'

const SUPPORTED_IMAGE_TYPES = new Set<SupportedImageMediaType>(['image/png', 'image/jpeg', 'image/webp', 'image/gif'])

function decodeWorkspaceText(data: string): string {
  const binary = atob(data)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index)
  return new TextDecoder().decode(bytes)
}

function base64Bytes(bytes: Uint8Array): string {
  let binary = ''
  const chunkSize = 0x8000
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize))
  }
  return btoa(binary)
}

async function encodedImage(file: File): Promise<{ type: 'image'; mediaType: SupportedImageMediaType; data: string; name: string }> {
  if (!SUPPORTED_IMAGE_TYPES.has(file.type as SupportedImageMediaType)) throw new Error('仅支持 PNG、JPG、WebP、GIF 图片')
  return {
    type: 'image',
    mediaType: file.type as SupportedImageMediaType,
    data: base64Bytes(new Uint8Array(await file.arrayBuffer())),
    name: file.name,
  }
}

function friendlyPromptError(error: { code: string; message: string; details?: Record<string, unknown> }): string {
  if (error.code !== 'attachment-error') return error.message
  const reason = typeof error.details?.reason === 'string' ? error.details.reason : ''
  if (reason === 'MODEL_DOES_NOT_SUPPORT_IMAGES') return '当前模型不支持图片，请切换到 Vision 模型后重试'
  if (reason === 'SUBAGENT_IMAGE_UNSUPPORTED') return '子智能体会话暂不支持图片'
  if (reason === 'TOO_MANY_IMAGES') return '本条消息的图片数量超过限制'
  if (reason === 'IMAGE_TOO_LARGE' || reason === 'IMAGES_TOO_LARGE') return '图片文件过大，请压缩或减少图片后重试'
  if (reason === 'IMAGE_TOO_MANY_PIXELS' || reason === 'IMAGE_DIMENSION_TOO_LARGE') return '图片分辨率过大，请缩小后重试'
  if (reason === 'INVALID_IMAGE' || reason === 'IMAGE_TYPE_MISMATCH') return '图片格式或内容无效，请重新选择图片'
  return error.message
}

function bubblePreview(content: unknown): string | undefined {
  if (!Array.isArray(content)) return undefined
  const text = content.flatMap((block) => {
    const value = block as { type?: unknown; text?: unknown }
    return value.type === 'text' && typeof value.text === 'string' ? [value.text] : []
  }).join('\n')
  const hasImage = content.some(block => (block as { type?: unknown }).type === 'image')
  const visible = visibleUserText(text)
    .replace(/```[\s\S]*?```/g, ' [代码] ')
    .replace(/\[([^\]]+)]\([^\s)]+\)/g, '$1')
    .replace(/^\s{0,3}(?:#{1,6}|[-+*>])\s*/gm, '')
    .replace(/[*_~`]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  if (visible !== '') return visible.slice(0, 96)
  return hasImage ? '[图片]' : undefined
}

function latestBubblePreview(entries: readonly unknown[]): string | undefined {
  const events = entries
    .map((entry) => {
      if (entry !== null && typeof entry === 'object' && 'event' in entry) return (entry as { event?: unknown }).event
      return entry
    })
    .filter((event): event is { type: string; seq: number; data: Record<string, unknown> } => {
      if (event === null || typeof event !== 'object') return false
      const value = event as { type?: unknown; seq?: unknown; data?: unknown }
      return typeof value.type === 'string' && typeof value.seq === 'number' && value.data !== null && typeof value.data === 'object'
    })
    .sort((left, right) => right.seq - left.seq)
  for (const event of events) {
    if (event.type === 'assistant/message') {
      const message = event.data.message as { content?: unknown } | undefined
      const preview = bubblePreview(message?.content)
      if (preview !== undefined) return preview
    }
  }
  for (const event of events) {
    if (event.type === 'user/message') {
      const source = event.data.source as { kind?: unknown } | undefined
      if (source?.kind !== 'user') continue
      const preview = bubblePreview(event.data.content)
      if (preview !== undefined) return preview
    }
  }
  return undefined
}

function historyText(content: unknown, includeReasoning = false): string {
  if (!Array.isArray(content)) return ''
  return content.flatMap((block) => {
    const value = block as { type?: unknown; text?: unknown }
    if (value.type === 'text' && typeof value.text === 'string') return [value.text]
    if (includeReasoning && value.type === 'reasoning' && typeof value.text === 'string') return [value.text]
    return []
  }).join('\n').trim()
}

function subagentHistoryMessages(entries: readonly unknown[]): ChatMessageView[] {
  const messages: ChatMessageView[] = []
  const events = entries
    .map(entry => (entry as { event?: unknown }).event)
    .filter((event): event is { type: string; seq: number; time?: number; data: Record<string, unknown> } => {
      if (event === null || typeof event !== 'object') return false
      const value = event as { type?: unknown; seq?: unknown; data?: unknown }
      return typeof value.type === 'string' && typeof value.seq === 'number' && value.data !== null && typeof value.data === 'object'
    })
    .sort((left, right) => left.seq - right.seq)
  for (const event of events) {
    const time = typeof event.time === 'number'
      ? new Date(event.time).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
      : undefined
    if (event.type === 'user/message') {
      const body = visibleUserText(historyText(event.data.content))
      if (body !== '') messages.push({ id: `subagent-user-${event.seq}`, role: 'user', body, ...(time === undefined ? {} : { time }) })
      continue
    }
    if (event.type === 'assistant/message') {
      const message = event.data.message as { content?: unknown } | undefined
      const body = historyText(message?.content)
      const reasoning = historyText(message?.content, true).replace(body, '').trim()
      if (body !== '' || reasoning !== '') messages.push({
        id: `subagent-assistant-${event.seq}`,
        role: 'assistant',
        body,
        ...(reasoning === '' ? {} : { reasoning }),
        ...(time === undefined ? {} : { time }),
      })
    }
  }
  return messages
}

function forwardedMessageText(sourceTitle: string, messages: readonly ChatMessageView[], merged: boolean): string {
  const rows = messages.map((message) => {
    const speaker = message.role === 'user' ? '我' : message.role === 'assistant' ? sourceTitle : '系统'
    const body = message.body.trim() || (message.images?.length ? `[图片 ${message.images.length} 张]` : '[空消息]')
    return `**${speaker}${message.time === undefined ? '' : ` · ${message.time}`}**\n\n${body}`
  })
  const heading = merged || messages.length > 1
    ? `【合并转发 · ${sourceTitle} · ${messages.length} 条】`
    : `【转发自「${sourceTitle}」】`
  return `${heading}\n\n${rows.join('\n\n---\n\n')}`
}
import './slots.ts'
import './wechat-ui.css'

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => { window.setTimeout(resolve, ms) })
}

async function waitFor<T extends Element>(find: () => T | null): Promise<T | null> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const found = find()
    if (found !== null) return found
    await sleep(35)
  }
  return null
}

function settingsLabel(ctx: Context, section: string): string | undefined {
  const entries = (ctx.slots as unknown as { entries: (name: string) => Array<{ options: { id?: string; label?: Parameters<typeof resolveSlotLabel>[0] } }> })
    .entries('settings.section')
  const entry = entries.find(candidate => candidate.options.id === section)
  return entry === undefined ? undefined : resolveSlotLabel(entry.options.label)
}

const HIDDEN_RAIL_STORAGE_KEY = 'dsh-diy-lab.hidden-rail-items.v1'
const OPTIONAL_RAIL_ITEMS = [
  ['pinned-note', '置顶备注'],
  ['usage', '用量与费用'],
  ['message-trash', '聊天记录回收站'],
  ['skills', '技能清单'],
  ['services', '运行服务'],
  ['tasks', '任务看板'],
  ['workspace', '添加工作区'],
  ['mode', '模式切换'],
  ['model', '模型切换'],
  ['plugin-settings', '插件管理'],
  ['plugins', '插件商店'],
  ['web-ui', 'Web UI 插件'],
  ['skins', '皮肤中心'],
  ['pet', '宠物'],
] as const

function readHiddenRailItems(): string[] {
  try {
    const value = JSON.parse(localStorage.getItem(HIDDEN_RAIL_STORAGE_KEY) ?? '[]') as unknown
    return Array.isArray(value) ? value.filter(item => typeof item === 'string') : []
  } catch {
    return []
  }
}

function writeHiddenRailItems(items: string[]): void {
  localStorage.setItem(HIDDEN_RAIL_STORAGE_KEY, JSON.stringify(items))
  window.dispatchEvent(new CustomEvent('diywx-rail-visibility', { detail: items }))
}

function uiModeCard(): HTMLElement {
  const current = readLocalUiMode()
  const card = document.createElement('section')
  card.dataset.diywxSettingsDecoration = 'ui-mode'
  card.className = 'diywx-settings-ui-card'
  const heading = document.createElement('div')
  const title = document.createElement('strong')
  title.textContent = '界面模式'
  const hint = document.createElement('p')
  hint.textContent = '只切换 Desktop 的显示界面；会话、工作区、权限和聊天记录继续使用同一份 Harness 数据。'
  heading.append(title, hint)
  const choices = document.createElement('div')
  choices.className = 'diywx-settings-ui-choices'
  const modes: Array<{ mode: LocalUiMode; title: string; hint: string; icon: string }> = [
    { mode: 'wechat', title: '微信式 UI', hint: '当前插件界面', icon: '▦' },
    { mode: 'native', title: '原生 DSH UI', hint: '经典 Harness 界面', icon: '◇' },
  ]
  for (const option of modes) {
    const button = document.createElement('button')
    button.type = 'button'
    button.dataset.mode = option.mode
    button.setAttribute('aria-pressed', String(current === option.mode))
    if (current === option.mode) button.classList.add('is-active')
    const icon = document.createElement('span')
    icon.className = 'diywx-settings-ui-icon'
    icon.textContent = option.icon
    const copy = document.createElement('span')
    const name = document.createElement('strong')
    name.textContent = option.title
    const description = document.createElement('small')
    description.textContent = option.hint
    copy.append(name, description)
    const state = document.createElement('i')
    state.textContent = current === option.mode ? '当前' : '切换'
    button.append(icon, copy, state)
    button.addEventListener('click', () => { switchLocalUiMode(option.mode) })
    choices.append(button)
  }
  card.append(heading, choices)
  return card
}

function collabCard(): HTMLElement {
  const card = document.createElement('section')
  card.dataset.diywxSettingsDecoration = 'collab'
  card.className = 'diywx-settings-ui-card diywx-settings-collab-card'
  const heading = document.createElement('div')
  const title = document.createElement('strong')
  title.textContent = '群聊版'
  const hint = document.createElement('p')
  hint.textContent = '和当前这个单机窗口同时运行。群聊走独立入口 3191，房间和登录数据分开，模型共用主窗口已接入的通道。'
  heading.append(title, hint)
  const row = document.createElement('div')
  row.className = 'diywx-settings-collab-row'
  const button = document.createElement('button')
  button.type = 'button'
  button.textContent = '启动群聊版'
  const status = document.createElement('small')
  status.className = 'diywx-settings-collab-status'
  const launch = async (): Promise<void> => {
    if (button.disabled) return
    button.disabled = true
    status.textContent = '正在打开…'
    status.dataset.kind = 'pending'
    try {
      await launchGroupChatWindow(await fetchGroupChatEntry())
      status.textContent = '已在独立窗口打开，这个单机窗口不用关。'
      status.dataset.kind = 'ok'
    } catch (cause) {
      status.textContent = cause instanceof Error ? cause.message : '群聊窗口未能打开'
      status.dataset.kind = 'error'
    } finally {
      button.disabled = false
    }
  }
  button.addEventListener('click', () => { void launch() })
  row.append(button)
  card.append(heading, row, status)
  return card
}

function settingsScrollArea(dialog: HTMLElement): HTMLElement | null {
  const candidates = Array.from(dialog.querySelectorAll<HTMLElement>('div')).filter((element) => {
    const style = getComputedStyle(element)
    const rect = element.getBoundingClientRect()
    return (style.overflowY === 'auto' || style.overflowY === 'scroll') && rect.width > 360 && rect.height > 180
  })
  return candidates.sort((left, right) => right.getBoundingClientRect().width - left.getBoundingClientRect().width)[0] ?? null
}

function visibilityCard(options: {
  decoration: string
  title: string
  hint: string
  resetLabel: string
  resetHidden?: readonly string[]
  items: ReadonlyArray<readonly [string, string]>
  readHidden: () => string[]
  writeHidden: (items: string[]) => void
}): HTMLElement {
  const card = document.createElement('section')
  card.dataset.diywxSettingsDecoration = options.decoration
  card.className = 'diywx-settings-rail-card'
  const heading = document.createElement('div')
  heading.className = 'diywx-settings-rail-heading'
  const copy = document.createElement('div')
  const strong = document.createElement('strong')
  strong.textContent = options.title
  const hint = document.createElement('p')
  hint.textContent = options.hint
  copy.append(strong, hint)
  const reset = document.createElement('button')
  reset.type = 'button'
  reset.textContent = options.resetLabel
  heading.append(copy, reset)
  const grid = document.createElement('div')
  grid.className = 'diywx-settings-rail-grid'
  const render = (): void => {
    const hidden = new Set(options.readHidden())
    grid.replaceChildren()
    for (const [id, itemLabel] of options.items) {
      const row = document.createElement('label')
      const name = document.createElement('span')
      name.textContent = itemLabel
      const input = document.createElement('input')
      input.type = 'checkbox'
      input.checked = !hidden.has(id)
      input.addEventListener('change', () => {
        const next = new Set(options.readHidden())
        if (input.checked) next.delete(id)
        else next.add(id)
        options.writeHidden([...next])
      })
      row.append(name, input)
      grid.append(row)
    }
  }
  reset.addEventListener('click', () => { options.writeHidden([...(options.resetHidden ?? [])]); render() })
  render()
  card.append(heading, grid)
  return card
}

function modelAccessCard(): HTMLElement {
  const card = document.createElement('section')
  card.dataset.diywxSettingsDecoration = 'model-access'
  card.className = 'diywx-settings-ui-card diywx-settings-model-card'
  const heading = document.createElement('div')
  const title = document.createElement('strong')
  title.textContent = '模型通道'
  const status = document.createElement('small')
  status.className = 'diywx-settings-model-status'
  heading.append(title, status)
  const hint = document.createElement('p')
  hint.className = 'diywx-settings-channel-copy'
  hint.textContent = '同一个会话可以在 DeepSeek API 和 ChatGPT Codex 订阅之间切换。这里只管理登录，不回显密钥。'
  const deepseekTitle = document.createElement('div')
  deepseekTitle.className = 'diywx-settings-channel-title'
  deepseekTitle.innerHTML = '<strong>DeepSeek API</strong><small data-channel="deepseek">读取中…</small>'
  const form = document.createElement('div')
  form.className = 'diywx-settings-model-form'
  const input = document.createElement('input')
  input.type = 'password'
  input.autocomplete = 'new-password'
  input.setAttribute('aria-label', 'DeepSeek API Key')
  const button = document.createElement('button')
  button.type = 'button'
  form.append(input, button)
  const codexTitle = document.createElement('div')
  codexTitle.className = 'diywx-settings-channel-title'
  codexTitle.innerHTML = '<strong>ChatGPT Codex 订阅</strong><small data-channel="codex">读取中…</small>'
  const codexHint = document.createElement('p')
  codexHint.className = 'diywx-settings-channel-copy'
  const idleHint = '登录后消耗的是 ChatGPT 套餐额度，不是 DeepSeek 余额。点登录后会给出设备码，在浏览器里确认即可。'
  const signedHint = '已登录。会话里切换到 Codex 后消耗 ChatGPT 套餐额度，不是 DeepSeek 余额。'
  const pendingHint = '在浏览器里打开验证页，输入上面的设备码即可。'
  codexHint.textContent = idleHint
  const notice = document.createElement('div')
  notice.className = 'diywx-settings-codex-notice'
  notice.hidden = true
  const promptBox = document.createElement('div')
  promptBox.className = 'diywx-settings-model-form'
  promptBox.hidden = true
  const promptInput = document.createElement('input')
  promptInput.setAttribute('aria-label', 'ChatGPT 登录补充信息')
  const promptButton = document.createElement('button')
  promptButton.type = 'button'
  promptButton.textContent = '继续'
  const promptChoices = document.createElement('div')
  promptChoices.className = 'diywx-settings-channel-actions'
  promptChoices.hidden = true
  promptBox.append(promptInput, promptButton)
  const actions = document.createElement('div')
  actions.className = 'diywx-settings-channel-actions'
  const loginButton = document.createElement('button')
  loginButton.type = 'button'
  const cancelButton = document.createElement('button')
  cancelButton.type = 'button'
  cancelButton.textContent = '取消登录'
  const logoutButton = document.createElement('button')
  logoutButton.type = 'button'
  logoutButton.textContent = '退出 Codex'
  actions.append(loginButton, cancelButton, logoutButton)
  const error = document.createElement('p')
  error.className = 'diywx-settings-model-error'
  error.hidden = true
  card.append(heading, hint, deepseekTitle, form, codexTitle, codexHint, notice, promptBox, promptChoices, actions, error)
  let current: ModelAccessView | null = null
  let answeredPrompt: string | undefined
  stopModelAccessPoll()

  const render = (access: ModelAccessView | null, message?: string): void => {
    current = access
    const deepseek = channelOf(access, 'deepseek')
    const codex = channelOf(access, 'codex')
    const signed = [deepseek?.configured === true ? 'DeepSeek' : undefined, codex?.configured === true ? 'Codex' : undefined]
      .filter((item): item is string => item !== undefined)
    status.textContent = access === null
      ? (message === undefined ? '正在读取…' : '读取失败')
      : signed.length === 0 ? '尚未接入任何通道' : `已接入 ${signed.join(' / ')}`
    if (signed.length > 0) status.dataset.configured = ''
    else delete status.dataset.configured
    const deepseekStatus = deepseekTitle.querySelector('small')
    if (deepseekStatus !== null) deepseekStatus.textContent = deepseek?.configured === true ? '已接入' : '未接入'
    const codexStatus = codexTitle.querySelector('small')
    if (codexStatus !== null) {
      codexStatus.textContent = codex?.inFlight === true ? '正在登录…' : codex?.configured === true ? '已登录' : '未登录'
    }
    const writable = access?.canConfigure === true && access.writable
    input.hidden = !writable
    button.hidden = !writable
    input.disabled = !writable
    input.placeholder = deepseek?.configured === true ? '输入新 Key 以替换现有配置' : '输入 DeepSeek API Key'
    button.textContent = deepseek?.configured === true ? '更新 Key' : '保存 DeepSeek'
    button.disabled = !writable || input.value.trim() === ''
    const noticeText = codex?.error ?? codex?.notice?.message
    notice.hidden = noticeText === undefined || noticeText === ''
    notice.replaceChildren()
    if (noticeText !== undefined && noticeText !== '') {
      const line = document.createElement('p')
      line.textContent = noticeText
      notice.append(line)
    }
    if (codex?.notice?.code !== undefined && codex.notice.code !== '') {
      const code = document.createElement('code')
      code.textContent = codex.notice.code
      notice.append(code)
    }
    if (codex?.notice?.url !== undefined && codex.notice.url !== '') {
      const link = document.createElement('a')
      link.href = codex.notice.url
      link.target = '_blank'
      link.rel = 'noreferrer'
      link.textContent = '打开 ChatGPT 验证页'
      notice.append(link)
    }
    const autoAnswer = autoCodexPromptAnswer(codex?.prompt)
    const selectOptions = codex?.inFlight === true && codex.prompt?.kind === 'select'
      ? (codex.prompt.options ?? [])
      : []
    const promptKey = codex?.inFlight === true && codex.prompt !== undefined
      ? `${codex.prompt.kind}:${codex.prompt.message}`
      : undefined
    if (promptKey === undefined) answeredPrompt = undefined
    promptBox.hidden = !shouldShowCodexTextPrompt(codex)
    codexHint.textContent = codex?.inFlight === true
      ? pendingHint
      : codex?.configured === true ? signedHint : idleHint
    promptChoices.hidden = selectOptions.length === 0 || autoAnswer !== undefined
    promptChoices.replaceChildren()
    for (const option of selectOptions) {
      const choice = document.createElement('button')
      choice.type = 'button'
      choice.textContent = option.label
      choice.addEventListener('click', () => { void post({ action: 'codex-answer', value: option.id }, choice, '提交中…') })
      promptChoices.append(choice)
    }
    promptInput.placeholder = codex?.prompt?.placeholder ?? codex?.prompt?.message ?? '按提示填写'
    promptInput.value = ''
    if (autoAnswer !== undefined && promptKey !== undefined && answeredPrompt !== promptKey) {
      answeredPrompt = promptKey
      void post({ action: 'codex-answer', value: autoAnswer }, promptButton, '正在连接…')
    }
    loginButton.textContent = codex?.configured === true ? '重新登录 ChatGPT' : '登录 ChatGPT'
    loginButton.hidden = !writable || codex?.inFlight === true
    loginButton.disabled = !writable || codex?.inFlight === true
    cancelButton.hidden = !writable || codex?.inFlight !== true
    cancelButton.disabled = !writable
    logoutButton.hidden = !writable || codex?.configured !== true
    logoutButton.disabled = !writable
    error.hidden = message === undefined
    error.textContent = message ?? ''
    stopModelAccessPoll()
    if (codex?.inFlight === true) modelAccessPoll = setInterval(() => { void refresh() }, 1200)
  }

  const refresh = async (): Promise<void> => {
    try { render(await requestModelAccess()) }
    catch (cause) { render(current, cause instanceof Error ? cause.message : '模型通道读取失败') }
  }

  const post = async (body: Record<string, string>, busy: HTMLButtonElement, busyText: string): Promise<void> => {
    const previous = busy.textContent
    busy.disabled = true
    busy.textContent = busyText
    try {
      render(await requestModelAccess(body))
    } catch (cause) {
      render(current, cause instanceof Error ? cause.message : '模型通道更新失败')
    } finally {
      busy.textContent = previous ?? busyText
    }
  }

  const save = async (): Promise<void> => {
    const apiKey = input.value.trim()
    if (apiKey === '') return
    try {
      const next = await requestModelAccess({ apiKey })
      input.value = ''
      render(next)
    } catch (cause) {
      render(current, cause instanceof Error ? cause.message : 'DeepSeek Key 保存失败')
    }
  }

  input.addEventListener('input', () => {
    button.disabled = input.value.trim() === ''
    error.hidden = true
  })
  input.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' || input.value.trim() === '') return
    event.preventDefault()
    void save()
  })
  button.addEventListener('click', () => { void save() })
  loginButton.addEventListener('click', () => { void post({ action: 'codex-login' }, loginButton, '正在登录…') })
  cancelButton.addEventListener('click', () => { void post({ action: 'codex-cancel' }, cancelButton, '取消中…') })
  logoutButton.addEventListener('click', () => { void post({ action: 'codex-logout' }, logoutButton, '退出中…') })
  promptButton.addEventListener('click', () => {
    const value = promptInput.value.trim()
    if (value === '') return
    void post({ action: 'codex-answer', value }, promptButton, '提交中…')
  })
  render(null)
  void refresh()
  return card
}

function skillInstallCard(): HTMLElement {
  const card = document.createElement('section')
  card.dataset.diywxSettingsDecoration = 'skill-install'
  card.className = 'diywx-settings-ui-card diywx-settings-skill-card'
  const heading = document.createElement('div')
  const title = document.createElement('strong')
  title.textContent = '技能安装'
  const hint = document.createElement('p')
  hint.textContent = '技能是给 Agent 的说明书，和插件不是一类东西。打开后，把技能页上的链接发给任意会话，产品会写到本机 ~/.agents/skills，再教你怎么用；不会执行 install.sh。'
  heading.append(title, hint)
  const row = document.createElement('label')
  row.className = 'diywx-settings-skill-toggle'
  const name = document.createElement('span')
  name.textContent = '粘贴技能链接后自动安装'
  const input = document.createElement('input')
  input.type = 'checkbox'
  input.checked = skillInstallFriendlyEnabled()
  input.addEventListener('change', () => { writeSkillInstallFriendly(input.checked) })
  row.append(name, input)
  card.append(heading, row)
  return card
}

function decorateSettingsDialog(dialog: HTMLElement, section: string, label: string): void {
  dialog.querySelectorAll('[data-diywx-settings-decoration]').forEach((node) => { node.remove() })
  const title = document.createElement('strong')
  title.dataset.diywxSettingsDecoration = 'title'
  title.className = 'diywx-settings-page-title'
  title.textContent = label
  dialog.append(title)
  if (section !== 'general') return
  const options = settingsScrollArea(dialog)
  if (options === null) return
  const collab = collabCard()
  options.prepend(collab)
  options.prepend(uiModeCard())
  const model = modelAccessCard()
  collab.after(model)
  model.after(skillInstallCard())
  options.append(visibilityCard({
    decoration: 'rail',
    title: '左侧功能栏',
    hint: '只显示你需要的功能入口；当前对话、已归档会话和通用设置会始终保留。',
    resetLabel: '全部显示',
    items: OPTIONAL_RAIL_ITEMS,
    readHidden: readHiddenRailItems,
    writeHidden: writeHiddenRailItems,
  }))
  options.append(visibilityCard({
    decoration: 'composer',
    title: '会话功能栏',
    hint: '勾选输入区要露出的按钮。会话命令是斜杠命令入口，一般用不到，默认隐藏。',
    resetLabel: '恢复默认',
    resetHidden: DEFAULT_HIDDEN_COMPOSER_FEATURES,
    items: COMPOSER_FEATURE_ITEMS.map(item => [item.id, item.label] as const),
    readHidden: readHiddenComposerFeatures,
    writeHidden: (items) => { writeHiddenComposerFeatures(items) },
  }))
}

function isGeneralSettingsDialog(dialog: HTMLElement): boolean {
  const text = dialog.textContent ?? ''
  return (text.includes('Agent 预设') || text.includes('Agent Preset'))
    && (text.includes('权限') || text.includes('Permission'))
    && (text.includes('外观') || text.includes('Appearance'))
}

function installNativeUiModeSetting(): () => void {
  let queued = false
  const render = (): void => {
    queued = false
    if (readLocalUiMode() !== 'native') return
    for (const dialog of document.querySelectorAll<HTMLElement>('[role="dialog"][aria-modal="true"]')) {
      if (!isGeneralSettingsDialog(dialog)) continue
      const options = settingsScrollArea(dialog)
      if (options === null) continue
      if (options.querySelector('[data-diywx-settings-decoration="ui-mode"]') === null) options.prepend(uiModeCard())
      if (options.querySelector('[data-diywx-settings-decoration="collab"]') === null) {
        const uiCard = options.querySelector('[data-diywx-settings-decoration="ui-mode"]')
        if (uiCard?.nextSibling !== null && uiCard?.nextSibling !== undefined) uiCard.parentElement?.insertBefore(collabCard(), uiCard.nextSibling)
        else options.append(collabCard())
      }
    }
  }
  const schedule = (): void => {
    if (queued) return
    queued = true
    queueMicrotask(render)
  }
  const observer = new MutationObserver(schedule)
  observer.observe(document.body, { childList: true, subtree: true, characterData: true })
  schedule()
  return () => { observer.disconnect() }
}

async function openNativeSettings(ctx: Context, section = 'general'): Promise<void> {
  const trigger = Array.from(document.querySelectorAll<HTMLButtonElement>('button[aria-haspopup="dialog"][aria-expanded]'))
    .find(button => button.closest('.diywx-shell') === null)
  if (trigger === undefined) throw new Error('Harness 原生设置尚未加载')
  trigger.click()
  const dialog = await waitFor(() => document.querySelector<HTMLElement>('[role="dialog"][aria-modal="true"]'))
  if (dialog === null) throw new Error('Harness 设置面板打开失败')
  document.documentElement.dataset.diywxSettingsOpen = 'true'
  const observer = new MutationObserver(() => {
    if (!document.body.contains(dialog)) {
      delete document.documentElement.dataset.diywxSettingsOpen
      observer.disconnect()
    }
  })
  observer.observe(document.body, { childList: true, subtree: true })

  const label = settingsLabel(ctx, section)
  if (label === undefined) {
    if (section !== 'general') throw new Error('这个原生功能尚未安装')
    decorateSettingsDialog(dialog, section, '通用设置')
    return
  }
  const target = Array.from(dialog.querySelectorAll<HTMLButtonElement>('nav button'))
    .find(button => button.textContent?.trim() === label.trim())
  if (target === undefined) throw new Error(`没有找到“${label}”设置页`)
  target.click()
  await sleep(35)
  decorateSettingsDialog(dialog, section, label)
}

async function openNativeTaskBoard(): Promise<void> {
  if (document.documentElement.hasAttribute('data-dsh-taskboard-active')) return
  const trigger = document.querySelector<HTMLElement>('[data-dsh-taskboard-entry]')
  if (trigger === null) throw new Error('任务看板插件尚未加载')
  trigger.click()
  const view = await waitFor(() => document.querySelector<HTMLElement>('[data-dsh-taskboard-view]'))
  if (view === null) throw new Error('任务看板打开失败')
}

async function postNative<T>(path: string, payload: Record<string, unknown>): Promise<T> {
  const response = await fetch(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  })
  const value = await response.json() as { ok?: boolean; value?: T; error?: { message?: string } }
  if (value.ok !== true || value.value === undefined) throw new Error(value.error?.message ?? '原生服务调用失败')
  return value.value
}

interface UsageHistoryEvent {
  type: string
  seq: number
  time: number
  data: Record<string, unknown>
}

function tokenUsageOf(value: unknown): TokenUsageView | undefined {
  if (value === null || typeof value !== 'object') return undefined
  const raw = value as Record<string, unknown>
  const input = raw.inputTokens ?? raw.uncachedInputTokens
  const output = raw.outputTokens
  const cacheRead = raw.cacheReadTokens ?? 0
  const cacheWrite = raw.cacheWriteTokens ?? 0
  if (![input, output, cacheRead, cacheWrite].every(item => typeof item === 'number' && Number.isFinite(item) && item >= 0)) return undefined
  return {
    uncachedInputTokens: input as number,
    outputTokens: output as number,
    cacheReadTokens: cacheRead as number,
    cacheWriteTokens: cacheWrite as number,
  }
}

function modelOf(value: unknown): SessionModelView | undefined {
  if (value === null || typeof value !== 'object') return undefined
  const raw = value as Record<string, unknown>
  return typeof raw.provider === 'string' && raw.provider !== '' && typeof raw.model === 'string' && raw.model !== ''
    ? { provider: raw.provider, model: raw.model }
    : undefined
}

interface SessionPageRemote {
  page: (request: {
    address: { kind: 'session'; sessionId: SessionId }
    throughSeq: number
    maxMessages: number
    beforeSeq?: number
  }) => Promise<{
    ok: boolean
    value?: { records: readonly unknown[]; hasMore: boolean }
    error?: { message?: string }
  }>
}

async function requestModelAccess(body?: Record<string, string>): Promise<ModelAccessView> {
  const response = await fetch('/api/diy-model-access', {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      accept: 'application/json',
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  const text = await response.text()
  let value: { ok?: boolean; access?: ModelAccessView; error?: string } = {}
  try { value = JSON.parse(text) as typeof value } catch {
    throw new Error(`模型通道接口返回异常（${response.status}）`)
  }
  if (!response.ok || value.access === undefined) throw new Error(value.error ?? '模型通道读取失败')
  return value.access
}

function channelOf(access: ModelAccessView | null, id: 'deepseek' | 'codex') {
  return access?.channels?.find(channel => channel.id === id)
}

let modelAccessPoll: ReturnType<typeof setInterval> | undefined

function stopModelAccessPoll(): void {
  if (modelAccessPoll === undefined) return
  clearInterval(modelAccessPoll)
  modelAccessPoll = undefined
}

function sessionRemoteOf(ctx: Context): SessionPageRemote | undefined {
  try {
    const remote = ctx.get('remote.session') as SessionPageRemote | undefined
    if (remote?.page !== undefined) return remote
  } catch (missingRemoteSession) {
    void missingRemoteSession
  }
  try {
    const fallback = (ctx.remote as { session?: SessionPageRemote } | undefined)?.session
    return fallback?.page === undefined ? undefined : fallback
  } catch (missingRemoteProxy) {
    void missingRemoteProxy
    return undefined
  }
}

async function loadUsageHistory(
  sessionIds: readonly string[],
  since: number | undefined,
  page: (sessionId: string, beforeSeq?: number) => Promise<{ events: readonly unknown[]; hasMore: boolean }>,
): Promise<SessionUsageHistoryView> {
  const failures: string[] = []
  const entries = await Promise.all(sessionIds.map(async (sessionId) => {
    try {
      const collected: UsageHistoryEvent[] = []
      let beforeSeq: number | undefined
      for (let pageIndex = 0; pageIndex < 200; pageIndex += 1) {
        const response = await page(sessionId, beforeSeq)
        const events = response.events
          .map(entry => (entry as { event?: unknown }).event)
          .filter((event): event is UsageHistoryEvent => event !== null && typeof event === 'object'
            && typeof (event as UsageHistoryEvent).seq === 'number'
            && typeof (event as UsageHistoryEvent).time === 'number'
            && typeof (event as UsageHistoryEvent).type === 'string')
        collected.push(...events)
        if (!response.hasMore || events.length === 0) break
        const oldestSeq = Math.min(...events.map(event => event.seq))
        const oldestTime = Math.min(...events.map(event => event.time))
        if (since !== undefined && oldestTime < since) break
        if (beforeSeq !== undefined && oldestSeq >= beforeSeq) break
        beforeSeq = oldestSeq
      }

      const sorted = collected.sort((left, right) => left.seq - right.seq)
      const modelByStep = new Map<string, SessionModelView>()
      const samplesByStep = new Map<string, UsageSampleView & { seq: number }>()
      let currentStep: string | undefined
      for (const event of sorted) {
        const turn = event.data.turn
        const step = event.data.step
        if (event.type === 'step/start' && typeof turn === 'number' && typeof step === 'number') currentStep = `${turn}:${step}`
        if (event.type === 'step/end' && currentStep === `${turn}:${step}`) currentStep = undefined
        if (event.type === 'request/header' && currentStep !== undefined) {
          const header = event.data.header as { config?: unknown } | undefined
          const model = modelOf(header?.config)
          if (model !== undefined) modelByStep.set(currentStep, model)
        }
        if (typeof turn !== 'number' || typeof step !== 'number') continue
        const key = `${turn}:${step}`
        let usage: TokenUsageView | undefined
        let model = modelByStep.get(key)
        if (event.type === 'assistant/chunk') {
          const chunk = event.data.chunk as { type?: unknown; usage?: unknown } | undefined
          if (chunk?.type === 'usage') usage = tokenUsageOf(chunk.usage)
        } else if (event.type === 'assistant/message') {
          usage = tokenUsageOf(event.data.usage)
          const message = event.data.message as { source?: unknown } | undefined
          model = modelOf(message?.source) ?? model
        }
        if (usage !== undefined) samplesByStep.set(key, {
          seq: event.seq,
          time: event.time,
          usage,
          ...(model === undefined ? {} : { model }),
        })
      }
      const samples = [...samplesByStep.values()]
        .filter(sample => since === undefined || sample.time >= since)
        .sort((left, right) => left.time - right.time)
        .map(({ seq: _seq, ...sample }) => sample)
      return [sessionId, samples] as const
    } catch (reason) {
      failures.push(`${sessionId}: ${reason instanceof Error ? reason.message : '历史记录读取失败'}`)
      return [sessionId, []] as const
    }
  }))
  return { samples: Object.fromEntries(entries), failures }
}

export const inject = ['slots', 'sessions', 'workspaces', 'connection', 'uiWorkspace', 'uiSession', 'remote', 'remote.session', 'remote.commands', 'remote.skills', 'remote.pluginInventory', 'remote.workspaceFiles']

const PRODUCT_TITLE = 'WeChat Harness'

function installProductTitle(): () => void {
  const rewrite = (): void => {
    const next = document.title
      .replaceAll('DSH 本地构建', PRODUCT_TITLE)
      .replaceAll('DSH Local Build', PRODUCT_TITLE)
      .replaceAll('DeepSeek Harness', PRODUCT_TITLE)
    if (next !== document.title) document.title = next
  }
  const node = document.querySelector('title') ?? document.head
  const observer = new MutationObserver(rewrite)
  observer.observe(node, { subtree: true, childList: true, characterData: true })
  rewrite()
  return () => { observer.disconnect() }
}

const OFFICIAL_CURRENT_SESSION_KEY = 'dsh.sessions.current'

function persistedOfficialSessionId(): string | undefined {
  try {
    const raw = localStorage.getItem(OFFICIAL_CURRENT_SESSION_KEY)
    if (raw === null) return undefined
    const value = JSON.parse(raw) as { sessionId?: unknown }
    return typeof value.sessionId === 'string' && value.sessionId !== '' ? value.sessionId : undefined
  } catch {
    return undefined
  }
}

function mostRecentVisibleSession(snapshot: {
  ids: readonly SessionId[]
  byId: Record<SessionId, { origin?: string; updatedAt?: number }>
}): string | undefined {
  let selected: string | undefined
  let selectedTime = Number.NEGATIVE_INFINITY
  for (const id of snapshot.ids) {
    const summary = snapshot.byId[id]
    if (summary.origin === 'subagent') continue
    const time = summary.updatedAt ?? 0
    if (time >= selectedTime) {
      selected = String(id)
      selectedTime = time
    }
  }
  return selected
}

/** Register the reversible full-screen UI overlay and its session-aware chat body. */
export function apply(ctx: Context): void {
  let selectedSessionId: string | undefined
  let retained: SessionReference | undefined
  const selectSession = (id: string): SessionReference => {
    const sessionId = id as SessionId
    selectedSessionId = id
    notifySelectedSession(id)
    if (retained?.sessionId !== sessionId) {
      retained?.release()
      retained = ctx.sessions.retain(sessionId, { source: 'wechatOverlay' })
    }
    ctx.uiWorkspace.openSession(sessionId)
    if (retained === undefined) throw new Error('会话引用创建失败')
    return retained
  }
  ctx.effect(() => () => {
    retained?.release()
    retained = undefined
  }, 'ainfinity-wechat: retain')
  ctx.effect(() => {
    const restore = (): void => {
      if (selectedSessionId !== undefined) return
      const snapshot = ctx.sessions.list.getSnapshot()
      if (snapshot.phase !== 'ready') return
      const saved = persistedOfficialSessionId()
      const candidate = saved !== undefined && snapshot.byId[saved as SessionId] !== undefined
        ? saved
        : mostRecentVisibleSession(snapshot)
      if (candidate !== undefined) selectSession(candidate)
    }
    const dispose = ctx.sessions.list.subscribe(restore)
    restore()
    return dispose
  }, 'ainfinity-wechat: restore current session')

  const addWorkspace = async (): Promise<void> => {
    const path = await ctx.uiWorkspace.pickDirectory()
    if (path === null || path.trim() === '') return
    const workspace = await ctx.workspaces.create({ path: path.trim() })
    ctx.uiWorkspace.startSession(workspace.workspaceId)
  }

  ctx.effect(installNativeUiModeSetting, 'ainfinity-wechat: native UI mode setting')
  ctx.effect(installProductTitle, 'ainfinity-wechat: product title')
  ctx.effect(() => bindSessionAttention(ctx), 'ainfinity-wechat: session attention')

  ctx.effect(() => ctx.slots.inject('shell.overlay', function* () {
    yield ctx.slots.register({
      name: 'shell.overlay',
      id: 'ainfinity-wechat-shell',
      order: -1000,
      children: {
        'diy.wechat.chat': { kind: 'single', scope: 'session-maybe' },
      },
      inject: (): LiveOverlayInjected => ({
        ...(selectedSessionId === undefined ? {} : { currentSessionId: selectedSessionId }),
        openSession: selectSession,
        openSessionWindow: (id) => {
          const url = new URL(window.location.href)
          url.searchParams.set('diywxSession', id)
          url.searchParams.set('diywxStandalone', '1')
          const popup = window.open(url, `diywx-session-${id}`, 'popup=yes,width=1120,height=760')
          if (popup === null) throw new Error('浏览器阻止了独立窗口，请允许此站点打开弹窗')
          popup.focus()
        },
        reorderSession: async (workspaceId, sessionId, beforeSessionId) => {
          if (beforeSessionId === undefined) await ctx.workspaces.insertSessionBefore(workspaceId as never, sessionId as SessionId)
          else await ctx.workspaces.insertSessionBefore(workspaceId as never, sessionId as SessionId, beforeSessionId as SessionId)
        },
        newSession: async (draft: NewSessionDraft) => {
          const sessionId = await ctx.sessions.create(
            draft.workspaceId === undefined ? {} : { workspaceId: draft.workspaceId as never },
          )
          const reference = selectSession(String(sessionId))
          await reference.ready
          if (draft.title !== undefined && draft.title.trim() !== '') {
            const session = reference.binding.session
            const renamed = await session.rename(draft.title.trim())
            if (!renamed.ok) throw new Error(renamed.error.message)
          }
          return String(sessionId)
        },
        addWorkspace,
        openTaskBoard: openNativeTaskBoard,
        openSettings: async (section) => { await openNativeSettings(ctx, section) },
        loadSessionPreviews: async (sessionIds) => {
          const sessionRemote = sessionRemoteOf(ctx)
          const rows = await Promise.all(sessionIds.map(async (sessionId) => {
            try {
              if (sessionRemote === undefined) return undefined
              const result = await sessionRemote.page({
                address: { kind: 'session', sessionId: sessionId as SessionId },
                throughSeq: -1,
                maxMessages: 24,
              })
              if (!result.ok || result.value === undefined) return undefined
              const preview = latestBubblePreview(result.value.records)
              return preview === undefined ? undefined : [sessionId, preview] as const
            } catch {
              return undefined
            }
          }))
          return Object.fromEntries(rows.filter((row): row is NonNullable<typeof row> => row !== undefined))
        },
        loadSessionModels: async (sessionIds) => {
          const snapshot = ctx.sessions.list.getSnapshot()
          return Object.fromEntries(sessionIds.flatMap((sessionId) => {
            const selection = (snapshot.byId[sessionId] as {
              projectionValues?: { modelSelection?: { next?: SessionModelView | null; lastUsed?: SessionModelView | null } }
            } | undefined)?.projectionValues?.modelSelection
            const current = selection?.next ?? selection?.lastUsed
            if (current === null || current === undefined) return []
            if (typeof current.provider !== 'string' || typeof current.model !== 'string') return []
            return [[sessionId, { provider: current.provider, model: current.model }] as const]
          }))
        },
        loadSessionUsage: async (sessionIds: readonly string[], since?: number) => {
          const sessionRemote = sessionRemoteOf(ctx)
          if (sessionRemote === undefined) return { samples: {}, failures: [] }
          return await loadUsageHistory(sessionIds, since, async (sessionId, beforeSeq) => {
            const result = await sessionRemote.page({
              address: { kind: 'session', sessionId: sessionId as SessionId },
              throughSeq: -1,
              maxMessages: 100,
              ...(beforeSeq === undefined ? {} : { beforeSeq }),
            })
            if (!result.ok || result.value === undefined) {
              throw new Error(result.error?.message ?? '会话用量分页失败')
            }
            return { events: result.value.records, hasMore: result.value.hasMore }
          })
        },
        loadPlugins: async () => {
          const result = await ctx.remote.pluginInventory.list()
          if (!result.ok) throw new Error(result.error.message)
          return result.value.entries.map(entry => ({
            entryId: String(entry.entryId),
            moduleName: entry.moduleName,
            enabled: entry.enabled,
            fiberPhase: entry.fiberPhase,
          }))
        },
        loadSkills: async (cwd, sessionId) => {
          let sessionSkills: ReturnType<typeof skillViewFromSessionEntry>[] = []
          if (sessionId !== undefined && sessionId.trim() !== '') {
            try {
              const result = await ctx.remote.skills.list({ sessionId: sessionId as SessionId })
              if (result.ok) sessionSkills = result.value.skills.map(skillViewFromSessionEntry)
            } catch (sessionCatalogFailed) {
              void sessionCatalogFailed
            }
          }
          return fetchInstalledSkills(cwd, sessionSkills)
        },
        installSkill: installSkillFromComposer,
      }),
    }, LocalUiOverlay)

    yield ctx.slots.register({
      name: 'diy.wechat.chat',
      inject: (sessionId: SessionId | undefined): LiveChatInjected => ({
        loadOlder: async () => {
          if (sessionId === undefined) return
          await ctx.sessions.binding(sessionId)?.session.loadOlder()
        },
        loadThrough: async (seq) => {
          if (sessionId === undefined) return
          await ctx.sessions.binding(sessionId)?.session.loadThrough(seq as never)
        },
        loadHistoryBefore: async (beforeSeq) => {
          if (sessionId === undefined) return []
          const sessionRemote = sessionRemoteOf(ctx)
          if (sessionRemote === undefined) return []
          const collected: ChatMessageView[] = []
          let cursor = beforeSeq
          for (let pageIndex = 0; pageIndex < 40; pageIndex += 1) {
            const result = await sessionRemote.page({
              address: { kind: 'session', sessionId },
              throughSeq: -1,
              maxMessages: 50,
              beforeSeq: cursor,
            })
            if (!result.ok || result.value === undefined) break
            collected.unshift(...userMessagesFromHistory(result.value.records))
            if (!result.value.hasMore || result.value.records.length === 0) break
            const oldest = oldestEventSeq(result.value.records)
            if (oldest === undefined || oldest >= cursor) break
            cursor = oldest
          }
          return collected
        },
        refreshSubagents: async () => {
          if (sessionId === undefined) return
          await ctx.sessions.refreshSubagents(sessionId)
        },
        setSubagentsVisible: (visible) => {
          if (sessionId !== undefined) ctx.sessions.setSubagentCatalogOpen(sessionId, visible)
        },
        loadSubagent: async (task: SubagentTaskView): Promise<SubagentDetailView> => {
          if (sessionId === undefined) throw new Error('请先选择父会话')
          if (task.status === 'unavailable') return { ...task, messages: [] }
          const response = await ctx.get('connection').api.subagents.history({
            parentSessionId: sessionId,
            childSessionId: task.id as SessionId,
            mode: task.mode,
            maxMessages: 50,
          })
          if (!response.result.ok) throw new Error(response.result.error.message)
          return {
            id: task.id,
            title: task.title,
            mode: task.mode,
            status: task.status,
            messages: subagentHistoryMessages(response.result.value.events),
            ...(response.result.value.hasMore ? { hasMore: true } : {}),
          }
        },
        loadImage: async (image: ChatImageView) => {
          if (sessionId === undefined) throw new Error('请先选择一个会话')
          const session = ctx.sessions.binding(sessionId)?.session
          if (session === undefined) throw new Error('会话仍在连接，请稍后重试')
          const result = await session.readAttachment(image.id as never)
          if (!result.ok) throw new Error(result.error.message)
          const bytes = Uint8Array.from(result.value.data)
          return URL.createObjectURL(new Blob([bytes.buffer], { type: result.value.attachment.mediaType }))
        },
        openPluginFile: async (path) => {
          const cwd = sessionId === undefined ? undefined : ctx.sessions.list.getSnapshot().byId[sessionId]?.cwd
          const resolved = resolveWorkspacePath(cwd, path)
          const opener = ctx.get('remote') as { files?: { open?: (target: string) => Promise<void> } } | undefined
          if (opener?.files?.open === undefined) {
            window.open(`file://${resolved}`)
            return
          }
          await opener.files.open(resolved)
        },
        readWorkspaceHtml: async (path) => {
          if (sessionId === undefined) throw new Error('请先选择一个会话')
          const files = ctx.remote.workspaceFiles
          const signal = new AbortController().signal
          return loadWorkspaceHtml(path, {
            read: async (candidate) => {
              const result = await files.readAll(sessionId, candidate, signal)
              if (result.ok) return decodeWorkspaceText(result.value.data)
              if (
                result.error.code === 'workspace-file/not-found'
                || result.error.code === 'workspace-file/outside-workspace'
              ) return undefined
              throw new Error(result.error.message)
            },
            listNames: async () => {
              const listing = await files.list(sessionId, '.', signal)
              if (!listing.ok) throw new Error(listing.error.message)
              return listing.value.entries
                .filter(entry => entry.type === 'file')
                .map(entry => entry.name)
            },
          })
        },
        sendMessage: async (text, images = [], files = []) => {
          if (sessionId === undefined) throw new Error('请先选择一个会话')
          const session = ctx.sessions.binding(sessionId)?.session
          if (session === undefined) throw new Error('会话仍在连接，请稍后重试')
          const pendingMetadata = pendingAutoMetadata(String(sessionId))
          const generated = pendingMetadata === undefined ? undefined : generatedMetadata(text.trim() || [...images, ...files].map(file => file.name).join(' ') || '附件对话')
          if (pendingMetadata?.title === true && generated !== undefined) {
            const renamed = await session.rename(generated.title)
            if (!renamed.ok) console.warn('[diy-wechat] 首条消息自动命名失败，将由 Harness 使用默认标题', renamed.error)
          }
          const uploadedFiles = files.length === 0 ? [] : await uploadLocalFiles(files)
          const installed = skillInstallFriendlyEnabled() && skillInstallSourceOf(text) !== undefined
            ? await installSkillFromComposer(text)
            : undefined
          const augmented = augmentSessionPrompt(String(sessionId), text, filePromptContext(uploadedFiles))
          const promptText = installed === undefined ? augmented : insertSkillInstallTeach(augmented, installed)
          const content = [
            ...(promptText.trim() === '' ? [] : [{ type: 'text' as const, text: promptText }]),
            ...await Promise.all(images.map(encodedImage)),
          ]
          if (content.length === 0) throw new Error('请输入消息或添加图片')
          const result = await session.prompt(content, 'queue')
          if (!result.ok) throw new Error(friendlyPromptError(result.error))
          if (pendingMetadata?.subtitle === true && generated !== undefined) storeGeneratedSubtitle(String(sessionId), generated.subtitle)
          if (pendingMetadata !== undefined) clearAutoMetadata(String(sessionId))
        },
        forwardMessages: async (targetSessionId, sourceTitle, messages, merged) => {
          if (sessionId === undefined) throw new Error('请先选择来源会话')
          if (String(sessionId) === targetSessionId) throw new Error('不能转发到当前会话')
          if (messages.length === 0) throw new Error('请先选择要转发的聊天记录')
          const source = ctx.sessions.binding(sessionId)?.session
          const targetId = targetSessionId as SessionId
          const target = ctx.sessions.binding(targetId)?.session
          if (source === undefined) throw new Error('来源会话仍在连接，请稍后重试')
          if (target === undefined) throw new Error('目标会话仍在连接，请稍后重试')

          const text = forwardedMessageText(sourceTitle, messages, merged)
          const pendingMetadata = pendingAutoMetadata(targetSessionId)
          const generated = pendingMetadata === undefined ? undefined : generatedMetadata(text)
          if (pendingMetadata?.title === true && generated !== undefined) {
            const renamed = await target.rename(generated.title)
            if (!renamed.ok) console.warn('[diy-wechat] 转发首条消息自动命名失败', renamed.error)
          }

          const forwardedImages: Array<{ type: 'image'; mediaType: SupportedImageMediaType; data: string; name: string }> = []
          for (const image of messages.flatMap(message => message.images ?? [])) {
            const loaded = await source.readAttachment(image.id as never)
            if (!loaded.ok) throw new Error(`图片“${image.name ?? '附件'}”读取失败：${loaded.error.message}`)
            const attachment = loaded.value.attachment as { mediaType: string; name?: string }
            if (!SUPPORTED_IMAGE_TYPES.has(attachment.mediaType as SupportedImageMediaType)) throw new Error('转发内容包含暂不支持的图片格式')
            forwardedImages.push({
              type: 'image',
              mediaType: attachment.mediaType as SupportedImageMediaType,
              data: base64Bytes(Uint8Array.from(loaded.value.data)),
              name: image.name ?? attachment.name ?? '转发图片',
            })
          }

          const augmented = augmentSessionPrompt(targetSessionId, text)
          const result = await target.prompt([
            { type: 'text', text: augmented },
            ...forwardedImages,
          ], 'queue')
          if (!result.ok) throw new Error(friendlyPromptError(result.error))
          if (pendingMetadata?.subtitle === true && generated !== undefined) storeGeneratedSubtitle(targetSessionId, generated.subtitle)
          if (pendingMetadata !== undefined) clearAutoMetadata(targetSessionId)
        },
        cancelMessage: async () => {
          if (sessionId === undefined) return
          const session = ctx.sessions.binding(sessionId)?.session
          if (session === undefined) return
          const result = await session.cancel()
          if (!result.ok) throw new Error(result.error.message)
        },
        renameSession: async (title) => {
          if (sessionId === undefined) throw new Error('请先选择会话')
          const normalized = title.trim()
          if (normalized === '') throw new Error('主标题不能为空')
          const session = ctx.sessions.binding(sessionId)?.session
          if (session === undefined) throw new Error('会话仍在连接，请稍后重试')
          const result = await session.rename(normalized)
          if (!result.ok) throw new Error(result.error.message)
        },
        addWorkspace,
        startWorkspace: async (id) => { ctx.uiWorkspace.startSession(id as never) },
        openSettings: async (section) => { await openNativeSettings(ctx, section) },
        loadPresets: async (): Promise<readonly PresetOptionView[]> => {
          const connection = ctx.get('connection')
          const response = await connection.api.agentPresets.list({})
          if (!response.result.ok) throw new Error(response.result.error.message)
          const summary = sessionId === undefined ? undefined : ctx.sessions.list.getSnapshot().byId[sessionId]
          return response.result.value.presets
            .filter((preset: { broken?: string }) => preset.broken === undefined)
            .map((preset: { id: string; name?: string; description?: string; isDefault: boolean }) => ({
              id: preset.id,
              name: preset.name ?? preset.id,
              ...(preset.description === undefined ? {} : { description: preset.description }),
              ...(preset.id === summary?.agentPreset || (summary?.agentPreset === undefined && preset.isDefault) ? { current: true } : {}),
            }))
        },
        selectPreset: async (id) => {
          if (sessionId === undefined) throw new Error('请先创建会话')
          const summary = ctx.sessions.list.getSnapshot().byId[sessionId]
          if (summary?.blank !== true) throw new Error('已有对话不能更换 Agent 模式，请新建会话')
          const response = await ctx.get('connection').api.agentPresets.select({ sessionId, agentPreset: id })
          if (!response.result.ok) throw new Error(response.result.error.message)
          ctx.sessions.noteAgentPreset(sessionId, response.result.value.agentPreset)
        },
        loadBranches: async (): Promise<readonly BranchOptionView[]> => {
          if (sessionId === undefined) return []
          const cwd = ctx.sessions.list.getSnapshot().byId[sessionId]?.cwd
          if (cwd === undefined || cwd === '') return []
          const view = await postNative<{ branches: Array<{ name: string; current: boolean }> }>('/git/branches', { path: cwd })
          return view.branches.map(branch => ({ name: branch.name, ...(branch.current ? { current: true } : {}) }))
        },
        switchBranch: async (name) => {
          if (sessionId === undefined) throw new Error('请先选择会话')
          const cwd = ctx.sessions.list.getSnapshot().byId[sessionId]?.cwd
          if (cwd === undefined || cwd === '') throw new Error('当前会话没有工作区')
          await postNative<{ branch: string }>('/git/switch', { path: cwd, branch: name })
        },
        loadCommands: async (): Promise<readonly CommandOptionView[]> => {
          if (sessionId === undefined) return []
          const result = await ctx.remote.commands.list(sessionId)
          if (!result.ok) throw new Error(result.error.message)
          return result.value.map(command => ({
            name: command.name,
            description: command.description,
            ...(command.input?.hint === undefined ? {} : { hint: command.input.hint }),
          }))
        },
        runCommand: async (line) => {
          if (sessionId === undefined) throw new Error('请先选择会话')
          const session = ctx.sessions.binding(sessionId)?.session
          if (session === undefined) throw new Error('会话仍在连接，请稍后重试')
          const result = await session.command(line)
          if (!result.ok) throw new Error(result.error.message)
          if (!result.value.matched) throw new Error(`Harness 不认识命令：${line.split(/\s/, 1)[0] ?? line}`)
          return '命令已执行，结果会显示在对话中'
        },
        selectPermission: async (value) => {
          if (sessionId === undefined) throw new Error('请先选择会话')
          const session = ctx.sessions.binding(sessionId)?.session
          if (session === undefined) throw new Error('会话仍在连接，请稍后重试')
          const result = await session.command(`/permission ${value}`)
          if (!result.ok) throw new Error(result.error.message)
          if (!result.value.matched) throw new Error('当前 Harness 不支持权限切换')
        },
        loadModels: async (): Promise<readonly ModelOptionView[]> => {
          if (sessionId === undefined) return []
          const resolver = (ctx as unknown as { get: (name: string) => unknown }).get('modelDirectories') as {
            directoryFor: (id: SessionId) => {
              load: () => Promise<{
                current: { provider: string; model: string; reasoningEffort?: string }
                groups: Array<{ id: string; name: string; models: Array<{ id: string; name: string; description?: string; reasoning?: { defaultEffort?: string; efforts: Array<{ id: string; name: string; description?: string }> } }> }>
              }>
              select: (selection: { provider: string; model: string; reasoningEffort?: string }) => Promise<void>
            }
          } | undefined
          if (resolver === undefined) throw new Error('模型选择服务尚未加载')
          const view = await resolver.directoryFor(sessionId).load()
          return view.groups.flatMap(group => group.models.map((model) => {
            const current = view.current.provider === group.id && view.current.model === model.id
            const reasoningEffort = current
              ? view.current.reasoningEffort ?? model.reasoning?.defaultEffort
              : model.reasoning?.defaultEffort
            return {
              key: `${group.id}:${model.id}`,
              provider: group.id,
              providerName: group.name,
              model: model.id,
              name: model.name,
              ...(model.description === undefined ? {} : { description: model.description }),
              ...(reasoningEffort === undefined ? {} : { reasoningEffort }),
              ...(model.reasoning === undefined ? {} : { reasoningEfforts: model.reasoning.efforts }),
              ...(current ? { current: true } : {}),
            }
          }))
        },
        selectModel: async (option) => {
          if (sessionId === undefined) throw new Error('请先选择会话')
          const resolver = (ctx as unknown as { get: (name: string) => unknown }).get('modelDirectories') as {
            directoryFor: (id: SessionId) => { select: (selection: { provider: string; model: string; reasoningEffort?: string }) => Promise<void> }
          } | undefined
          if (resolver === undefined) throw new Error('模型选择服务尚未加载')
          await resolver.directoryFor(sessionId).select({
            provider: option.provider,
            model: option.model,
            ...(option.reasoningEffort === undefined ? {} : { reasoningEffort: option.reasoningEffort }),
          })
        },
      }),
    }, LiveChat)
  }), 'ainfinity-wechat: WeChat-style shell overlay')
}
