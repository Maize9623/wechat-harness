/**
 * Format a Codex window reset timestamp for the usage dialog.
 * @param resetAt - epoch milliseconds.
 * @param now - clock used to decide whether the year is needed.
 */
export function formatResetAt(resetAt: number | undefined, now = Date.now()): string {
  if (resetAt === undefined || !Number.isFinite(resetAt)) return '重置时间未知'
  const date = new Date(resetAt)
  const includeYear = date.getFullYear() !== new Date(now).getFullYear()
  return `${new Intl.DateTimeFormat('zh-CN', {
    ...(includeYear ? { year: 'numeric' as const } : {}),
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date)} 刷新`
}

/**
 * Remaining window copy, e.g. `剩余 77%`.
 * @param remainingPercent - 0–100.
 */
export function formatRemaining(remainingPercent: number | undefined): string {
  return remainingPercent === undefined ? '剩余未知' : `剩余 ${remainingPercent}%`
}

/**
 * Instant-reset count when the backend reports one.
 * @param resets - remaining paid or complimentary resets.
 */
export function formatResets(resets: number | undefined): string | undefined {
  return resets === undefined ? undefined : `可用重置 ${resets} 次`
}
