/** Target name reused so Settings opens one group-chat Desktop window. */
export const GROUP_CHAT_WINDOW_NAME = 'diywx-collab'

interface DesktopGroupChatApi {
  open: (url: string) => Promise<void>
}

function desktopGroupChat(): DesktopGroupChatApi | undefined {
  const desktop = (globalThis as { dshDesktop?: { groupChat?: { open?: (url: string) => Promise<void> } } }).dshDesktop
  const open = desktop?.groupChat?.open
  return typeof open === 'function' ? { open } : undefined
}

/**
 * Read the live 3191 launch URL from the Desktop Host.
 * @param fetchImpl - same-origin fetch, injectable in tests.
 * @returns loopback group-chat URL, including a first-run setup token when needed.
 */
export async function fetchGroupChatEntry(fetchImpl: typeof fetch = fetch): Promise<string> {
  const response = await fetchImpl('/api/diy-collab-entry', { headers: { accept: 'application/json' } })
  const body = await response.json() as { ok?: boolean; running?: boolean; url?: string; error?: string }
  if (body.ok !== true || body.running !== true || typeof body.url !== 'string' || body.url === '') {
    throw new Error(body.error ?? '群聊入口还没起来，单机聊天不受影响')
  }
  return body.url
}

/**
 * Open the group-chat sidecar in a second Desktop window.
 * Electron denies `window.open` after the shell creates that window, so a null
 * handle is success when the Desktop IPC path is unavailable.
 * @param url - loopback URL from {@link fetchGroupChatEntry}.
 * @param openWindow - `window.open`, injectable in tests.
 */
export function openGroupChatWindow(
  url: string,
  openWindow: (href: string, target: string) => Window | null = (href, target) => window.open(href, target),
): void {
  openWindow(url, GROUP_CHAT_WINDOW_NAME)
}

/**
 * Open the group-chat sidecar through Desktop IPC when the shell owns the window.
 * Electron may reject the invoke after the shell already created that window;
 * fall back to `window.open` and treat a null handle as success.
 * @param url - loopback URL from {@link fetchGroupChatEntry}.
 * @param openWindow - `window.open`, injectable in tests.
 */
export async function launchGroupChatWindow(
  url: string,
  openWindow?: (href: string, target: string) => Window | null,
): Promise<void> {
  const desktop = desktopGroupChat()
  if (desktop !== undefined) {
    try {
      await desktop.open(url)
    } catch (invokeRejected) {
      // Electron can reject the invoke after the shell already created the window.
      void invokeRejected
      openGroupChatWindow(url, openWindow)
    }
    return
  }
  openGroupChatWindow(url, openWindow)
}
