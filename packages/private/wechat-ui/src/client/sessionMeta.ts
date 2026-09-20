const AUTO_METADATA_STORAGE_KEY = 'dsh-diy-lab.auto-session-metadata.v1'
export const SESSION_SUBTITLE_STORAGE_KEY = 'dsh-diy-lab.session-subtitles.v1'
export const SESSION_SUBTITLE_EVENT = 'diywx-session-subtitle'

export interface PendingAutoMetadata {
  title: boolean
  subtitle: boolean
}

function readRecord<T>(key: string): Record<string, T> {
  try {
    const value = JSON.parse(localStorage.getItem(key) ?? '{}') as unknown
    return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, T> : {}
  } catch {
    return {}
  }
}

function writeRecord(key: string, value: Record<string, unknown>): void {
  try { localStorage.setItem(key, JSON.stringify(value)) } catch { /* keep session creation usable without persistence */ }
}

export function registerAutoMetadata(sessionId: string, value: PendingAutoMetadata): void {
  const records = readRecord<PendingAutoMetadata>(AUTO_METADATA_STORAGE_KEY)
  if (!value.title && !value.subtitle) delete records[sessionId]
  else records[sessionId] = value
  writeRecord(AUTO_METADATA_STORAGE_KEY, records)
}

export function pendingAutoMetadata(sessionId: string): PendingAutoMetadata | undefined {
  return readRecord<PendingAutoMetadata>(AUTO_METADATA_STORAGE_KEY)[sessionId]
}

export function clearAutoMetadata(sessionId: string): void {
  const records = readRecord<PendingAutoMetadata>(AUTO_METADATA_STORAGE_KEY)
  delete records[sessionId]
  writeRecord(AUTO_METADATA_STORAGE_KEY, records)
}

function shorten(value: string, limit: number): string {
  const characters = Array.from(value)
  return characters.length <= limit ? value : `${characters.slice(0, limit).join('')}…`
}

export function generatedMetadata(text: string): { title: string; subtitle: string } {
  const normalized = text.replace(/\s+/gu, ' ').trim()
  const firstClause = normalized.split(/[。！？!?；;：:\n]/u)[0]?.trim() || normalized
  const title = shorten(firstClause || '新会话', 18)
  const excerpt = shorten(normalized || title, 38)
  return {
    title,
    subtitle: excerpt === title ? `关于「${title}」的对话` : excerpt,
  }
}

export function storeGeneratedSubtitle(sessionId: string, subtitle: string): void {
  const records = readRecord<string>(SESSION_SUBTITLE_STORAGE_KEY)
  records[sessionId] = subtitle
  writeRecord(SESSION_SUBTITLE_STORAGE_KEY, records)
  window.dispatchEvent(new CustomEvent(SESSION_SUBTITLE_EVENT, { detail: { sessionId, subtitle } }))
}
