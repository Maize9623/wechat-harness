/** Session-list second-line copy that never falls back to a workspace path. */

/**
 * Status line used before conversation history has been loaded.
 * @param input - live Session flags from the official catalog.
 * @returns a short Chinese status string.
 */
export function sessionFallbackPreview(input: {
  running?: boolean
  blank?: boolean
  awaitingQuestion?: boolean
}): string {
  if (input.awaitingQuestion === true) return '等待你的回答'
  if (input.running === true) return 'DeepSeek 正在处理…'
  if (input.blank === true) return '开始新的对话'
  return '继续上次的对话'
}

/**
 * Latest turn reply, or that turn's user prompt when no reply has landed yet.
 * @param outline - `turnOutline` projection view or fold state.
 * @returns compact preview text.
 */
export function sessionOutlinePreview(outline: unknown): string | undefined {
  const turns = Array.isArray(outline)
    ? outline
    : outline !== null && typeof outline === 'object' && Array.isArray((outline as { turns?: unknown }).turns)
      ? (outline as { turns: readonly unknown[] }).turns
      : undefined
  if (turns === undefined || turns.length === 0) return undefined
  const last = turns[turns.length - 1]
  if (last === null || typeof last !== 'object') return undefined
  const row = last as { response?: unknown; prompt?: unknown }
  return compactPreview(typeof row.response === 'string' ? row.response : undefined)
    ?? compactPreview(typeof row.prompt === 'string' ? row.prompt : undefined)
}

/**
 * Second line of a Session row: latest message text, then a status line.
 * @param input - status fallback plus optional history text.
 * @returns compact preview text.
 */
export function sessionRowPreview(input: {
  fallback: string
  conversationPreview?: string
}): string {
  const conversation = compactPreview(input.conversationPreview)
  if (conversation !== undefined) return conversation
  return input.fallback
}

function compactPreview(value: string | undefined): string | undefined {
  if (value === undefined) return undefined
  const text = value
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/\[([^\]]+)]\([^\s)]+\)/g, '$1')
    .replace(/^\s{0,3}(?:#{1,6}|[-+*>])\s*/gm, '')
    .replace(/[*_~`]/g, '')
    .replace(/\s+/gu, ' ')
    .trim()
  return text === '' ? undefined : text
}
