/** Chat text that can open the conversation side preview. */
export type MessagePreviewTarget =
  | { kind: 'browser'; url: string }
  | { kind: 'html'; path: string }

/** Markdown token for a relative or bare HTML filename, including CJK names. */
export const LOCAL_HTML_TOKEN = String.raw`(?:\.{0,2}/)?(?:[\p{L}\p{N}._-]+/)*[\p{L}\p{N}._-]+\.html?`

function httpHref(value: string): string | undefined {
  const normalized = value.startsWith('www.') ? `https://${value}` : value
  try {
    const url = new URL(normalized)
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : undefined
  } catch {
    return undefined
  }
}

function unwrapPath(value: string): string {
  return value.trim()
    .replace(/^<+/u, '')
    .replace(/>+$/u, '')
    .replace(/^['"「『]+/u, '')
    .replace(/['"」』]+$/u, '')
}

function basename(path: string): string {
  return path.split(/[/\\]/u).at(-1) ?? path
}

function isAbsoluteOsPath(path: string): boolean {
  return path.startsWith('/') || /^[A-Za-z]:[\\/]/u.test(path)
}

/**
 * Workspace HTML path mentioned in chat. Public http(s) pages stay browser targets.
 * @param value - raw markdown href, backtick, or filename.
 * @returns the cleaned path, or undefined when the token is not a local HTML file.
 */
export function localHtmlPath(value: string): string | undefined {
  let candidate = unwrapPath(value)
  if (candidate.startsWith('file://')) {
    try {
      candidate = decodeURIComponent(new URL(candidate).pathname)
    } catch {
      return undefined
    }
  }
  if (candidate.includes('\0') || candidate.includes('\n')) return undefined
  if (/^(?:javascript|data):/iu.test(candidate)) return undefined
  if (candidate.includes('://')) return undefined
  const path = candidate.split(/[?#]/u)[0] ?? ''
  if (!new RegExp(`^${LOCAL_HTML_TOKEN}$`, 'u').test(path) && !isAbsoluteOsPath(path)) return undefined
  if (!/\.html?$/iu.test(path)) return undefined
  return path
}

/**
 * Workspace-relative names to try before listing the session root.
 * @param path - raw chat href or filename.
 * @returns relative paths and the basename, never an outside Desktop path.
 */
export function htmlPathCandidates(path: string): string[] {
  const clean = localHtmlPath(path) ?? unwrapPath(path)
  const name = basename(clean)
  const candidates: string[] = []
  if (clean !== '' && !isAbsoluteOsPath(clean)) candidates.push(clean)
  if (name !== '' && /\.html?$/iu.test(name) && !candidates.includes(name)) candidates.push(name)
  return candidates
}

/**
 * Map a chat filename onto a listed workspace HTML file when names differ.
 * @param requested - chat href or filename.
 * @param listed - workspace root file names.
 * @returns the matching name, or the only HTML file in that list.
 */
export function resolveListedHtml(requested: string, listed: readonly string[]): string | undefined {
  const html = listed.filter(name => /\.html?$/iu.test(name))
  const wanted = basename(localHtmlPath(requested) ?? requested).toLowerCase()
  const exact = html.find(name => name.toLowerCase() === wanted)
  if (exact !== undefined) return exact
  return html.length === 1 ? html[0] : undefined
}

/**
 * Side-preview target for one chat token.
 * @param value - markdown href or visible filename.
 * @param label - markdown link text, used when the href is an outside path.
 * @returns a browser URL or a workspace HTML path.
 */
export function previewTargetOf(value: string, label?: string): MessagePreviewTarget | undefined {
  const href = httpHref(unwrapPath(value))
  if (href !== undefined) return { kind: 'browser', url: href }
  const fromValue = localHtmlPath(value)
  const fromLabel = label === undefined ? undefined : localHtmlPath(label)
  const relative = [fromValue, fromLabel].find(path => path !== undefined && !isAbsoluteOsPath(path))
  if (relative !== undefined) return { kind: 'html', path: relative }
  const absolute = fromValue ?? fromLabel
  if (absolute === undefined) return undefined
  return { kind: 'html', path: basename(absolute) }
}
