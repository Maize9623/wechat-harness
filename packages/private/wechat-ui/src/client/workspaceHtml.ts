import { htmlPathCandidates, resolveListedHtml } from './previewTarget.ts'

/** Workspace access used to resolve a chat HTML filename. */
export interface WorkspaceHtmlReader {
  /** Return file text, or undefined when that path is absent from the workspace. */
  read: (path: string) => Promise<string | undefined>
  /** File names in the Session workspace root. */
  listNames: () => Promise<readonly string[]>
}

/**
 * Read a chat-mentioned HTML file from the Session workspace.
 * @param requested - filename or href from the message.
 * @param io - workspace file access for the current Session.
 * @returns decoded HTML of the matching workspace file.
 */
export async function loadWorkspaceHtml(requested: string, io: WorkspaceHtmlReader): Promise<string> {
  for (const candidate of htmlPathCandidates(requested)) {
    const html = await io.read(candidate)
    if (html !== undefined) return html
  }
  const listed = await io.listNames()
  const resolved = resolveListedHtml(requested, listed)
  if (resolved !== undefined) {
    const html = await io.read(resolved)
    if (html !== undefined) return html
  }
  const name = requested.split(/[/\\]/u).at(-1) ?? requested
  const available = listed.filter(item => /\.html?$/iu.test(item))
  if (available.length === 0) throw new Error(`工作区里没有网页文件，无法打开 ${name}`)
  throw new Error(`工作区里没有 ${name}。可预览：${available.join('、')}`)
}
