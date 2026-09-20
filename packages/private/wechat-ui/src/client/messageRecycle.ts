import type { ChatImageView, ChatMessageView } from './types.ts'

const MESSAGE_RECYCLE_STORAGE_KEY = 'dsh-diy-lab.message-recycle.v1'
export const MESSAGE_RECYCLE_EVENT = 'diywx-message-recycle'
export const MESSAGE_RECYCLE_DAYS = 30
const MESSAGE_RECYCLE_TTL = MESSAGE_RECYCLE_DAYS * 24 * 60 * 60 * 1000

export interface RecycledMessageRecord {
  key: string
  sessionId: string
  sessionTitle: string
  message: ChatMessageView
  deletedAt: number
  expiresAt: number
}

export interface MessageRecycleState {
  recycled: Readonly<Record<string, RecycledMessageRecord>>
  /** Purged ids stay tiny but prevent native history from making deleted rows reappear. */
  purged: Readonly<Record<string, number>>
}

const EMPTY_STATE: MessageRecycleState = { recycled: {}, purged: {} }

export function messageRecycleKey(sessionId: string, messageId: string): string {
  return `${sessionId}\u001f${messageId}`
}

function imageSnapshot(image: ChatImageView): ChatImageView {
  return {
    id: image.id,
    ...(image.name === undefined ? {} : { name: image.name }),
    ...(image.mediaType === undefined ? {} : { mediaType: image.mediaType }),
    ...(image.width === undefined ? {} : { width: image.width }),
    ...(image.height === undefined ? {} : { height: image.height }),
    ...(image.src === undefined || image.src.startsWith('blob:') || image.src.startsWith('data:') ? {} : { src: image.src }),
  }
}

function messageSnapshot(message: ChatMessageView): ChatMessageView {
  return {
    id: message.id,
    role: message.role,
    body: message.body,
    ...(message.images === undefined ? {} : { images: message.images.map(imageSnapshot) }),
    ...(message.time === undefined ? {} : { time: message.time }),
  }
}

function parseState(value: unknown): MessageRecycleState {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return EMPTY_STATE
  const candidate = value as { recycled?: unknown; purged?: unknown }
  const recycled: Record<string, RecycledMessageRecord> = {}
  if (candidate.recycled !== null && typeof candidate.recycled === 'object' && !Array.isArray(candidate.recycled)) {
    for (const [key, raw] of Object.entries(candidate.recycled as Record<string, unknown>)) {
      if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) continue
      const record = raw as Partial<RecycledMessageRecord>
      if (typeof record.sessionId !== 'string' || typeof record.sessionTitle !== 'string'
        || typeof record.deletedAt !== 'number' || typeof record.expiresAt !== 'number'
        || record.message === null || typeof record.message !== 'object') continue
      const message = record.message as Partial<ChatMessageView>
      if (typeof message.id !== 'string' || typeof message.body !== 'string'
        || (message.role !== 'assistant' && message.role !== 'user' && message.role !== 'status')) continue
      recycled[key] = { ...record, key, message: message as ChatMessageView } as RecycledMessageRecord
    }
  }
  const purged: Record<string, number> = {}
  if (candidate.purged !== null && typeof candidate.purged === 'object' && !Array.isArray(candidate.purged)) {
    for (const [key, purgedAt] of Object.entries(candidate.purged as Record<string, unknown>)) {
      if (typeof purgedAt === 'number' && Number.isFinite(purgedAt)) purged[key] = purgedAt
    }
  }
  return { recycled, purged }
}

function readState(): MessageRecycleState {
  try {
    return parseState(JSON.parse(localStorage.getItem(MESSAGE_RECYCLE_STORAGE_KEY) ?? '{}') as unknown)
  } catch {
    return EMPTY_STATE
  }
}

function persistState(state: MessageRecycleState, notify = true): MessageRecycleState {
  try { localStorage.setItem(MESSAGE_RECYCLE_STORAGE_KEY, JSON.stringify(state)) } catch { /* retain the in-memory operation */ }
  if (notify) window.dispatchEvent(new CustomEvent(MESSAGE_RECYCLE_EVENT, { detail: state }))
  return state
}

function expireState(state: MessageRecycleState, now = Date.now()): { state: MessageRecycleState; changed: boolean } {
  const recycled = { ...state.recycled }
  const purged = { ...state.purged }
  let changed = false
  for (const [key, record] of Object.entries(recycled)) {
    if (record.expiresAt > now) continue
    delete recycled[key]
    purged[key] = now
    changed = true
  }
  return { state: { recycled, purged }, changed }
}

export function loadMessageRecycleState(): MessageRecycleState {
  const expired = expireState(readState())
  if (expired.changed) persistState(expired.state, false)
  return expired.state
}

export function deleteChatMessages(sessionId: string, sessionTitle: string, messages: readonly ChatMessageView[]): MessageRecycleState {
  const now = Date.now()
  const current = loadMessageRecycleState()
  const recycled = { ...current.recycled }
  const purged = { ...current.purged }
  for (const message of messages) {
    const key = messageRecycleKey(sessionId, message.id)
    delete purged[key]
    recycled[key] = {
      key,
      sessionId,
      sessionTitle,
      message: messageSnapshot(message),
      deletedAt: now,
      expiresAt: now + MESSAGE_RECYCLE_TTL,
    }
  }
  return persistState({ recycled, purged })
}

export function restoreRecycledMessages(keys: readonly string[]): MessageRecycleState {
  const current = loadMessageRecycleState()
  const recycled = { ...current.recycled }
  const purged = { ...current.purged }
  for (const key of keys) {
    delete recycled[key]
    delete purged[key]
  }
  return persistState({ recycled, purged })
}

export function purgeRecycledMessages(keys: readonly string[]): MessageRecycleState {
  const now = Date.now()
  const current = loadMessageRecycleState()
  const recycled = { ...current.recycled }
  const purged = { ...current.purged }
  for (const key of keys) {
    delete recycled[key]
    purged[key] = now
  }
  return persistState({ recycled, purged })
}

export function emptyMessageRecycleBin(): MessageRecycleState {
  return purgeRecycledMessages(Object.keys(loadMessageRecycleState().recycled))
}

export function isChatMessageDeleted(state: MessageRecycleState, sessionId: string | undefined, messageId: string): boolean {
  if (sessionId === undefined) return false
  const key = messageRecycleKey(sessionId, messageId)
  return state.recycled[key] !== undefined || state.purged[key] !== undefined
}
