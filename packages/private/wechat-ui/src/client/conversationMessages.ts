/** Build the WeChat transcript from the official chat window plus earlier history. */

import { isWrappedUserPrompt, visibleUserText } from './persona.ts'
import { fileViewsFromPrompt } from './fileAttachments.ts'
import type { ChatImageView, ChatMessageView } from './types.ts'

const RICH_TOOL_NAMES = new Set(['render_ui', 'visualize_html'])

/** One assembled conversation node as the WeChat transcript reads it. */
export interface TranscriptNode {
  readonly kind: string
  readonly seq: number
  readonly time?: number
  readonly content?: readonly unknown[]
  readonly blocks?: readonly { kind: string; text?: string; attachment?: unknown; name?: string }[]
  readonly call?: { name?: string } | null
  readonly callId?: string
  readonly isError?: boolean
  readonly name?: string | null
  readonly args?: string | null
  readonly outcome?: { kind?: string; text?: string } | null
  readonly message?: string
  readonly type?: string
}

/** Streaming assistant tail from the official chat window. */
export interface TranscriptPartial {
  readonly turn: number
  readonly step: number
  readonly blocks: NonNullable<TranscriptNode['blocks']>
}

/** Official chat `legacy` slice. */
export interface TranscriptSnapshot {
  readonly nodes: readonly TranscriptNode[]
  readonly partial: TranscriptPartial | null
}

function messageClock(time: number | undefined): string | undefined {
  return time === undefined
    ? undefined
    : new Date(time).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
}

function imageView(attachment: unknown): ChatImageView | undefined {
  const value = attachment as {
    attachmentId?: unknown
    name?: unknown
    mediaType?: unknown
    width?: unknown
    height?: unknown
  }
  if (typeof value.attachmentId !== 'string') return undefined
  return {
    id: value.attachmentId,
    ...(typeof value.name === 'string' ? { name: value.name } : {}),
    ...(typeof value.mediaType === 'string' ? { mediaType: value.mediaType } : {}),
    ...(typeof value.width === 'number' ? { width: value.width } : {}),
    ...(typeof value.height === 'number' ? { height: value.height } : {}),
  }
}

function userParts(content: readonly unknown[]): { body: string; images: ChatImageView[]; files: ReturnType<typeof fileViewsFromPrompt> } {
  const text: string[] = []
  const images: ChatImageView[] = []
  for (const block of content) {
    if (typeof block === 'string' && block.trim() !== '') {
      text.push(block)
      continue
    }
    const value = block as { type?: string; text?: string; attachment?: unknown }
    if ((value.type === 'text' || value.type === 'reasoning') && typeof value.text === 'string') text.push(value.text)
    else if (value.type === 'image') {
      const image = imageView(value.attachment)
      if (image !== undefined) images.push(image)
    }
  }
  const body = text.join('\n').trim()
  return { body, images, files: fileViewsFromPrompt(body) }
}

function assistantParts(blocks: readonly { kind: string; text?: string; attachment?: unknown; name?: string }[]): {
  answer: string
  reasoning: string
  images: ChatImageView[]
  toolStatuses: string[]
} {
  const answer: string[] = []
  const reasoning: string[] = []
  const images: ChatImageView[] = []
  const toolStatuses: string[] = []
  for (const block of blocks) {
    if (block.kind === 'text' && typeof block.text === 'string') answer.push(block.text)
    else if (block.kind === 'reasoning' && typeof block.text === 'string') reasoning.push(block.text)
    else if (block.kind === 'image') {
      const image = imageView(block.attachment)
      if (image !== undefined) images.push(image)
    }
    else if (block.kind === 'tool-call' && block.name !== 'ask_user_question') {
      toolStatuses.push(`正在使用 ${block.name ?? 'tool'}…`)
    }
  }
  return {
    answer: answer.join('\n').trim(),
    reasoning: reasoning.join('\n').trim(),
    images,
    toolStatuses,
  }
}

function appendAssistantStep(
  messages: ChatMessageView[],
  blocks: readonly { kind: string; text?: string; attachment?: unknown; name?: string }[],
  id: string,
  pending = false,
  createdAt?: number,
): void {
  const parts = assistantParts(blocks)
  if (parts.answer !== '' || parts.reasoning !== '' || parts.images.length > 0) {
    messages.push({
      id,
      role: 'assistant',
      body: parts.answer,
      ...(parts.images.length === 0 ? {} : { images: parts.images }),
      ...(parts.reasoning === '' ? {} : { reasoning: parts.reasoning }),
      ...(pending ? { pending: true } : {}),
      ...(createdAt === undefined ? {} : { createdAt }),
    })
  }
  parts.toolStatuses.forEach((body, index) => {
    messages.push({ id: `${id}-tool-${index}`, role: 'status', body, ...(pending ? { pending: true } : {}), ...(createdAt === undefined ? {} : { createdAt }) })
  })
}

function permissionModeLabel(value: string | undefined): string | undefined {
  if (value === 'danger-full-access') return '完全访问模式'
  if (value === 'workspace-write') return '工作区可写'
  if (value === 'read-only') return '只读'
  if (value === 'auto') return '自动批准'
  return undefined
}

function permissionValueOf(args: string, text: string | undefined): string | undefined {
  const fromArgs = args.split(/\s+/u).find(part => part !== '')
  if (fromArgs !== undefined) return fromArgs
  return text?.match(/(?:preset|current preset)\s+(\S+)/u)?.[1]
}

function commandStatus(node: TranscriptNode): string {
  const name = node.name ?? 'command'
  const args = typeof node.args === 'string' ? node.args.trim() : ''
  const outcome = node.outcome
  const settled = outcome !== null && outcome !== undefined
  const failed = settled && outcome.kind === 'error'
  const text = settled && typeof outcome.text === 'string' ? outcome.text : undefined
  if (name === 'permission') {
    const label = permissionModeLabel(permissionValueOf(args, text))
    if (!settled) return label === undefined ? '正在切换批准模式…' : `正在切换为${label}`
    if (failed) return '批准模式切换失败'
    if (args === '' && text !== undefined && text.startsWith('current preset')) {
      return label === undefined ? '已查看当前批准模式' : `当前是${label}`
    }
    return label === undefined ? '已切换批准模式' : `已切换为${label}`
  }
  if (!settled) return `正在执行 ${name}…`
  if (failed) return text === undefined || text.trim() === '' ? `${name} 未完成` : text
  return text === undefined || text.trim() === '' ? `${name} 已完成` : text
}

function statusText(node: TranscriptNode): string {
  switch (node.kind) {
    case 'tool-result': return `${node.isError === true ? '工具执行失败' : '工具执行完成'}：${node.call?.name ?? node.callId}`
    case 'command': return commandStatus(node)
    case 'turn-error': return `出现错误：${node.message ?? ''}`
    case 'turn-max-tokens': return '本次回答已达到长度上限'
    case 'model-retry': return '模型正在自动重试'
    case 'compaction': return '较早的对话已整理为摘要'
    case 'context': return '已完成会话初始化'
    case 'unknown': return `收到 ${node.type ?? node.kind} 事件`
    default: return ''
  }
}

function userMessageFromParts(
  id: string,
  content: readonly unknown[],
  time: number | undefined,
): ChatMessageView | undefined {
  const parts = userParts(content)
  const body = visibleUserText(parts.body)
  if (body === '' && parts.images.length === 0 && parts.files.length === 0) return undefined
  return {
    id,
    role: 'user',
    body,
    ...(parts.images.length === 0 ? {} : { images: parts.images }),
    ...(parts.files.length === 0 ? {} : { files: parts.files }),
    ...(time === undefined ? {} : { createdAt: time }),
    ...(messageClock(time) === undefined ? {} : { time: messageClock(time) }),
  }
}

/**
 * Project the official chat window into WeChat bubbles.
 * @param snapshot - `views.get('chat')?.legacy`, when the Session is open.
 * @returns chronological bubbles for the currently loaded window.
 */
export function messagesOf(snapshot: TranscriptSnapshot | undefined): ChatMessageView[] {
  if (snapshot === undefined) return []
  const messages: ChatMessageView[] = []
  for (const node of snapshot.nodes) {
    if (node.kind === 'user' || node.kind === 'steering') {
      const message = userMessageFromParts(`${node.kind}-${node.seq}`, node.content ?? [], node.time)
      if (message !== undefined) messages.push(message)
      continue
    }
    if (node.kind === 'assistant') {
      appendAssistantStep(messages, node.blocks ?? [], `assistant-${node.seq}`, false, node.time)
      continue
    }
    if (node.kind === 'tool-result' && node.call !== null && node.call !== undefined && RICH_TOOL_NAMES.has(node.call.name ?? '')) {
      messages.push({
        id: `plugin-tool-${node.callId}-${node.seq}`,
        role: 'assistant',
        body: '',
        tool: { callId: node.callId ?? String(node.seq), toolName: node.call.name ?? 'tool', block: node },
        createdAt: node.time,
      })
      continue
    }
    if (node.kind === 'context') {
      const raw = userParts(node.content ?? []).body
      if (isWrappedUserPrompt(raw)) {
        const recovered = userMessageFromParts(`context-${node.seq}`, node.content ?? [], node.time)
        if (recovered !== undefined) messages.push(recovered)
      }
      continue
    }
    const body = statusText(node)
    if (body !== '') messages.push({ id: `${node.kind}-${node.seq}`, role: 'status', body, createdAt: node.time })
  }
  if (snapshot.partial !== null) {
    appendAssistantStep(
      messages,
      snapshot.partial.blocks,
      `partial-${snapshot.partial.turn}-${snapshot.partial.step}`,
      true,
    )
  }
  return messages
}

function historyText(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content.flatMap((block) => {
    if (typeof block === 'string') return [block]
    const value = block as { type?: unknown; text?: unknown }
    return value.type === 'text' && typeof value.text === 'string' ? [value.text] : []
  }).join('\n').trim()
}

/**
 * Oldest durable seq in a history page, used as the next `beforeSeq`.
 * @param entries - `session.page` records or raw events.
 * @returns that seq, when the page has at least one numbered event.
 */
export function oldestEventSeq(entries: readonly unknown[]): number | undefined {
  let oldest: number | undefined
  for (const entry of entries) {
    const event = entry !== null && typeof entry === 'object' && 'event' in entry
      ? (entry as { event?: unknown }).event
      : entry
    const seq = event !== null && typeof event === 'object' ? (event as { seq?: unknown }).seq : undefined
    if (typeof seq === 'number' && Number.isFinite(seq) && (oldest === undefined || seq < oldest)) oldest = seq
  }
  return oldest
}

/**
 * Recover opening user bubbles from a history page that precedes the loaded window.
 * @param entries - `session.page` / `sessions.history` records.
 * @returns user bubbles in chronological order.
 */
export function userMessagesFromHistory(entries: readonly unknown[]): ChatMessageView[] {
  const messages: ChatMessageView[] = []
  const events = entries
    .map((entry) => {
      if (entry !== null && typeof entry === 'object' && 'event' in entry) return (entry as { event?: unknown }).event
      return entry
    })
    .filter((event): event is { type: string; seq: number; time?: number; data: Record<string, unknown> } => {
      if (event === null || typeof event === 'undefined' || typeof event !== 'object') return false
      const value = event as { type?: unknown; seq?: unknown; data?: unknown }
      return typeof value.type === 'string' && typeof value.seq === 'number' && value.data !== null && typeof value.data === 'object'
    })
    .sort((left, right) => left.seq - right.seq)
  for (const event of events) {
    if (event.type !== 'user/message') continue
    const source = event.data.source as { kind?: unknown } | undefined
    if (source?.kind !== 'user') continue
    const message = userMessageFromParts(`history-user-${event.seq}`, Array.isArray(event.data.content) ? event.data.content : [], event.time)
    if (message !== undefined) messages.push(message)
    else {
      const body = visibleUserText(historyText(event.data.content))
      if (body !== '') {
        messages.push({
          id: `history-user-${event.seq}`,
          role: 'user',
          body,
          ...(event.time === undefined ? {} : { createdAt: event.time }),
          ...(messageClock(event.time) === undefined ? {} : { time: messageClock(event.time) }),
        })
      }
    }
  }
  return messages
}

/**
 * Whether the loaded window is missing the opening human bubble.
 * @param messages - bubbles already projected from the official window.
 * @returns true when an assistant (or other) row appears before any user row.
 */
export function needsLeadingUser(messages: readonly ChatMessageView[]): boolean {
  if (messages.length === 0) return false
  const firstAssistant = messages.findIndex(message => message.role === 'assistant')
  const firstUser = messages.findIndex(message => message.role === 'user')
  if (firstUser === -1) return true
  return firstAssistant !== -1 && firstUser > firstAssistant
}

/**
 * Prepend recovered opening user bubbles without duplicating a later-loaded window row.
 * @param displayed - bubbles from the official window.
 * @param leading - bubbles recovered from an earlier history page.
 * @returns window bubbles with any missing opening user rows in front.
 */
export function mergeLeadingUserMessages(
  displayed: readonly ChatMessageView[],
  leading: readonly ChatMessageView[],
): ChatMessageView[] {
  if (leading.length === 0) return [...displayed]
  const ids = new Set(displayed.map(message => message.id))
  const bodies = new Set(displayed.filter(message => message.role === 'user').map(message => message.body))
  const extra = leading.filter(message => !ids.has(message.id) && (message.body === '' || !bodies.has(message.body)))
  return extra.length === 0 ? [...displayed] : [...extra, ...displayed]
}

/**
 * First turn/start seq from the whole-log outline, used to page the opening prompt back in.
 * @param outline - `turnOutline` projection view or fold state.
 * @returns that seq, when the outline has a started turn.
 */
export function firstOutlineTurnSeq(outline: unknown): number | undefined {
  const turns = Array.isArray(outline)
    ? outline
    : outline !== null && typeof outline === 'object' && Array.isArray((outline as { turns?: unknown }).turns)
      ? (outline as { turns: readonly unknown[] }).turns
      : undefined
  const first = turns?.[0]
  if (first === null || typeof first !== 'object') return undefined
  const seq = (first as { seq?: unknown }).seq
  return typeof seq === 'number' && Number.isFinite(seq) ? seq : undefined
}
