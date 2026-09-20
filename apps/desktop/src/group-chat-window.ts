/** Isolated WeChat group-chat sidecar opened as a second Desktop window. */
export const GROUP_CHAT_PORT = 3191

function groupChatLoopback(url: URL): boolean {
  if (url.protocol !== 'http:') return false
  if (url.hostname !== '127.0.0.1' && url.hostname !== 'localhost') return false
  if (url.port !== String(GROUP_CHAT_PORT)) return false
  return url.username === '' && url.password === ''
}

/**
 * Admit in-window navigation on the loopback group-chat sidecar.
 * @param value - candidate navigation URL.
 * @returns whether the group-chat window may stay on this URL.
 */
export function isGroupChatWindowNavigation(value: string): boolean {
  try {
    return groupChatLoopback(new URL(value))
  } catch {
    return false
  }
}

/**
 * Admit only the loopback group-chat entry. LAN URLs stay out of this window.
 * @param value - candidate window-open URL.
 * @returns whether Desktop should load it in the group-chat window.
 */
export function isGroupChatWindowUrl(value: string): boolean {
  try {
    const url = new URL(value)
    if (!groupChatLoopback(url)) return false
    if (url.pathname !== '/' && url.pathname !== '') return false
    if (url.hash !== '') return false
    for (const key of url.searchParams.keys()) {
      if (key !== 'setup' && key !== 'session') return false
    }
    const setup = url.searchParams.get('setup')
    return setup === null || /^[A-Za-z0-9_-]+$/u.test(setup)
  } catch {
    return false
  }
}
