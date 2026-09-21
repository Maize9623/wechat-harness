/** List installed Agent Skills and install a SKILL.md bundle without running scripts. */

import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join, posix } from 'node:path'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'

const API_PATH = '/api/diy-skills'
const SKILL_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u
const HTTP_URL = /^https?:\/\//iu
const URL_IN_TEXT = /https?:\/\/[^\s<>"'`）)】,，]+/giu
const RELATIVE_REF = /\((?:\.\.?\/)?([A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*)\)/gu
const BLOCKED_FILE = /\.(?:sh|bash|zsh|ps1|command|exe|bat|cmd|msi)$/iu
const ACTOR_RE = /--actor(?:\s+|=)([0-9a-f][0-9a-f-]{18,46}[0-9a-f])/iu
const MAX_FILE_BYTES = 256_000
const MAX_FILES = 16
const MAX_FETCHES = 8
const FETCH_TIMEOUT_MS = 15_000
const BROWSER_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
const nodeFetch = globalThis.fetch.bind(globalThis)
const COMMON_COMPANIONS = [
  'LICENSE',
  'agents/openai.yaml',
  'references/api.md',
  'references/sync.md',
  'references/errors.md',
]

/**
 * Directory that official skill-filesystem scans as `user-agents`.
 * @returns absolute `~/.agents/skills` (or `$DSH_AGENTS_HOME/skills`).
 */
export function userAgentsSkillRoot() {
  return join(process.env.DSH_AGENTS_HOME ?? join(homedir(), '.agents'), 'skills')
}

function sourceLabelOf(source) {
  if (source === 'user-agents' || source === 'user-dsh') return '本机通用'
  if (source === 'project-agents' || source === 'project-dsh') return '当前工作区'
  if (source === 'bundled') return '内置'
  if (source === 'runtime') return '运行时'
  if (source === 'custom') return '自定义目录'
  return '其他'
}

function skillView(entry) {
  return {
    name: entry.name,
    description: entry.description,
    ...(entry.whenToUse === undefined ? {} : { whenToUse: entry.whenToUse }),
    source: entry.source,
    sourceLabel: sourceLabelOf(entry.source),
    ...(entry.path === undefined ? {} : { path: entry.path }),
    modelInvocable: entry.invocation?.modelInvocable !== false,
    userInvocable: entry.invocation?.userInvocable !== false,
  }
}

/**
 * Parse Agent Skill frontmatter. Description must be a single YAML scalar line.
 * @param text - SKILL.md contents.
 * @returns name, description, optional whenToUse, and the original markdown.
 */
export function parseSkillMarkdown(text) {
  const normalized = String(text ?? '').replaceAll('\r\n', '\n').replaceAll('\r', '\n').replace(/^\uFEFF/u, '')
  const match = /^---\s*\n([\s\S]*?)\n---\s*(?:\n|$)/u.exec(normalized)
  if (match === null) return undefined
  const data = {}
  for (const line of match[1].split('\n')) {
    const pair = /^([A-Za-z][A-Za-z0-9_-]*)\s*:\s*(.*)$/u.exec(line)
    if (pair === null) continue
    data[pair[1]] = pair[2].trim().replace(/^['"]|['"]$/gu, '')
  }
  const name = data.name
  const description = data.description
  if (typeof name !== 'string' || !SKILL_NAME.test(name) || typeof description !== 'string' || description === '') {
    return undefined
  }
  return {
    name,
    description,
    ...(typeof data.whenToUse === 'string' && data.whenToUse !== '' ? { whenToUse: data.whenToUse } : {}),
    markdown: normalized,
  }
}

function skillsOf(ctx) {
  try {
    return typeof ctx.get === 'function' ? ctx.get('skills') : undefined
  } catch (missingSkills) {
    void missingSkills
    return undefined
  }
}

async function listDiskSkills(root, source) {
  let names
  try {
    names = await readdir(root)
  } catch (missingRoot) {
    void missingRoot
    return []
  }
  const skills = []
  for (const entry of names) {
    const candidate = join(root, entry)
    let raw
    let path
    try {
      const info = await stat(candidate)
      if (info.isFile() && /\.md$/iu.test(entry)) {
        path = candidate
        raw = await readFile(candidate, 'utf8')
      } else if (info.isDirectory()) {
        path = join(candidate, 'SKILL.md')
        raw = await readFile(path, 'utf8')
      } else {
        continue
      }
    } catch (missingSkill) {
      void missingSkill
      continue
    }
    const parsed = parseSkillMarkdown(raw)
    if (parsed === undefined) continue
    skills.push(skillView({ ...parsed, source, path, invocation: { modelInvocable: true, userInvocable: true } }))
  }
  return skills
}

function projectRootOf(cwd) {
  return typeof cwd === 'string' && cwd.trim() !== '' ? cwd.trim() : undefined
}

/**
 * Read user and project skill directories with Node fs.
 * @param options.cwd - session workspace path; scanned as project skill roots.
 * @param options.userAgentsRoot - override `~/.agents/skills` for tests.
 * @param options.userDshRoot - override `$DSH_HOME/skills` for tests.
 * @returns disk entries in official rank order: project, then user.
 */
async function listDiskCatalog(options = {}) {
  const cwd = projectRootOf(options.cwd)
  const userAgentsRoot = options.userAgentsRoot ?? userAgentsSkillRoot()
  const userDshRoot = options.userDshRoot ?? join(resolveDshHome(), 'skills')
  const [projectDsh, projectAgents, userDsh, userAgents] = await Promise.all([
    cwd === undefined ? [] : listDiskSkills(join(cwd, '.dsh/skills'), 'project-dsh'),
    cwd === undefined ? [] : listDiskSkills(join(cwd, '.agents/skills'), 'project-agents'),
    listDiskSkills(userDshRoot, 'user-dsh'),
    listDiskSkills(userAgentsRoot, 'user-agents'),
  ])
  return [...projectDsh, ...projectAgents, ...userDsh, ...userAgents]
}

async function listRegistrySkills(skills, cwd) {
  if (skills === undefined) return []
  try {
    const listed = await skills.list(cwd === undefined ? {} : { cwd })
    return listed.map(entry => skillView(entry))
  } catch (registryFailed) {
    void registryFailed
    return []
  }
}

function mergeSkillViews(groups) {
  const seen = new Set()
  const merged = []
  for (const skill of groups.flat()) {
    if (seen.has(skill.name)) continue
    seen.add(skill.name)
    merged.push(skill)
  }
  return merged
}

/**
 * List skills the current Desktop can see.
 * Always unions a Node scan of user/project skill directories with the Host
 * `ctx.skills` registry when that service is present.
 * @param options.skills - optional official `ctx.skills` registry.
 * @param options.cwd - session workspace path so project skills are included.
 * @param options.userAgentsRoot - override `~/.agents/skills` for tests.
 * @param options.userDshRoot - override `$DSH_HOME/skills` for tests.
 * @returns catalog entries with Chinese source labels.
 */
export async function listInstalledSkills(options = {}) {
  const cwd = projectRootOf(options.cwd)
  const [disk, registry] = await Promise.all([
    listDiskCatalog({ ...options, ...(cwd === undefined ? {} : { cwd }) }),
    listRegistrySkills(options.skills, cwd),
  ])
  return mergeSkillViews([disk, registry])
}

function urlsIn(text) {
  return [...String(text).matchAll(URL_IN_TEXT)].map(match => match[0].replace(/[)#.,，]+$/u, ''))
}

function firstUrl(text) {
  return urlsIn(text)[0]
}

function actorIdOf(text) {
  const match = ACTOR_RE.exec(text)
  return match?.[1]?.toLowerCase()
}

function toRawGithub(url) {
  const blob = /^https:\/\/github\.com\/([^/]+)\/([^/]+)\/blob\/([^/]+)\/(.+)$/u.exec(url)
  if (blob !== null) return `https://raw.githubusercontent.com/${blob[1]}/${blob[2]}/${blob[3]}/${blob[4]}`
  const tree = /^https:\/\/github\.com\/([^/]+)\/([^/]+)\/(?:tree|raw)\/([^/]+)\/(.+)$/u.exec(url)
  if (tree !== null) return `https://raw.githubusercontent.com/${tree[1]}/${tree[2]}/${tree[3]}/${tree[4]}`
  return url
}

function parentDirectory(url) {
  return url.replace(/\/[^/]*$/u, '')
}

function looksLikeFilePath(url) {
  return /\.[A-Za-z0-9]{1,8}$/u.test(new URL(url).pathname)
}

/**
 * Resolve a pasted skill page or README into SKILL.md locations.
 * Never append `/SKILL.md` onto an existing filename such as `README.md`.
 * @param url - http(s) URL taken from the install prompt.
 * @returns absolute candidate URLs, official mirrors first for known hosts.
 */
export function skillSourceCandidates(url) {
  const raw = toRawGithub(url.replace(/[)#.,，]+$/u, ''))
  let parsed
  try {
    parsed = new URL(raw)
  } catch (invalidUrl) {
    void invalidUrl
    return []
  }
  const withoutQuery = `${parsed.origin}${parsed.pathname}`.replace(/\/$/u, '')
  const candidates = []
  if (/aihot\.(?:news|virxact\.com)/iu.test(withoutQuery)) {
    candidates.push(
      'https://aihot.news/aihot-skill/SKILL.md',
      'https://aihot.virxact.com/aihot-skill/SKILL.md',
    )
  }
  if (/\/SKILL\.md$/iu.test(withoutQuery)) candidates.push(withoutQuery)
  else if (looksLikeFilePath(withoutQuery)) {
    candidates.push(`${parentDirectory(withoutQuery)}/SKILL.md`, withoutQuery)
  } else {
    candidates.push(`${withoutQuery}/SKILL.md`, withoutQuery)
  }
  if (/aihot\.(?:news|virxact\.com)|aihot-skill|\/aihot(?:\/|$)/iu.test(withoutQuery)) {
    candidates.push('https://raw.githubusercontent.com/KKKKhazix/khazix-skills/master/aihot/SKILL.md')
  }
  return [...new Set(candidates)]
}

function extractSkillUrls(text, baseUrl) {
  const found = []
  for (const href of urlsIn(text)) {
    if (/SKILL\.md(?:[?#]|$)/iu.test(href)) found.push(href)
  }
  for (const match of text.matchAll(/(?:href|src)=["']([^"']*SKILL\.md[^"']*)["']|\((?:\.\.?\/)?(SKILL\.md)\)/giu)) {
    const relative = match[1] ?? match[2]
    if (relative === undefined) continue
    try {
      found.push(new URL(relative, baseUrl).href)
    } catch (invalidRelative) {
      void invalidRelative
    }
  }
  return found
}

function assertSafeUrl(url) {
  let parsed
  try {
    parsed = new URL(url)
  } catch (invalidUrl) {
    void invalidUrl
    throw new Error('技能地址无效')
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('只能从 http(s) 地址安装技能')
  }
  if (parsed.username !== '' || parsed.password !== '') {
    throw new Error('技能地址不能带账号口令')
  }
}

function assertSafeRelative(relative) {
  const normalized = posix.normalize(relative.replaceAll('\\', '/'))
  if (normalized.startsWith('../') || normalized.startsWith('/') || normalized === '..' || BLOCKED_FILE.test(normalized)) {
    throw new Error(`拒绝写入技能附带文件：${relative}`)
  }
  return normalized
}

async function fetchText(url, fetchImpl) {
  assertSafeUrl(url)
  const response = await fetchImpl(url, {
    redirect: 'follow',
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    headers: {
      accept: 'text/markdown, text/plain, */*',
      'user-agent': BROWSER_UA,
    },
  })
  if (!response.ok) throw new Error(`${url} 返回 ${response.status}`)
  const bytes = Number(response.headers.get('content-length') ?? 0)
  if (bytes > MAX_FILE_BYTES) throw new Error('技能文件过大')
  const text = await response.text()
  if (text.length > MAX_FILE_BYTES) throw new Error('技能文件过大')
  return { url: response.url || url, text, contentType: response.headers.get('content-type') ?? '' }
}

function looksLikeHtml(contentType, text) {
  return /text\/html/iu.test(contentType) || /^\s*<(?:!doctype|html|body)\b/iu.test(text)
}

function companionPathsFrom(markdown) {
  const found = new Set(COMMON_COMPANIONS)
  for (const match of markdown.matchAll(RELATIVE_REF)) {
    if (match[1] !== undefined) found.add(match[1])
  }
  return [...found].filter(path => {
    try {
      assertSafeRelative(path)
      return !/SKILL\.md$/iu.test(path)
    } catch (blockedCompanion) {
      void blockedCompanion
      return false
    }
  }).slice(0, MAX_FILES - 1)
}

function baseUrlOf(skillUrl) {
  return skillUrl.replace(/\/SKILL\.md(?:[?#].*)?$/iu, '/')
}

async function resolveSkillMarkdown(source, fetchImpl) {
  const parsed = parseSkillMarkdown(source)
  if (parsed !== undefined) return { ...parsed, sourceUrl: undefined }
  const seed = firstUrl(source)
  if (seed === undefined || !HTTP_URL.test(seed)) {
    throw new Error('请粘贴技能链接，或整份带 name / description 的 SKILL.md')
  }
  const queue = skillSourceCandidates(seed)
  const seen = new Set()
  const errors = []
  for (const candidate of queue) {
    if (seen.has(candidate) || seen.size >= MAX_FETCHES) continue
    seen.add(candidate)
    try {
      const fetched = await fetchText(candidate, fetchImpl)
      const skill = looksLikeHtml(fetched.contentType, fetched.text) ? undefined : parseSkillMarkdown(fetched.text)
      if (skill !== undefined) return { ...skill, sourceUrl: fetched.url }
      for (const extra of extractSkillUrls(fetched.text, fetched.url)) {
        if (!seen.has(extra)) queue.push(extra)
      }
      errors.push(`${candidate} 不是带 name / description 的 SKILL.md`)
    } catch (cause) {
      errors.push(cause instanceof Error ? cause.message : '读取技能失败')
    }
  }
  throw new Error(`读不到技能文件。${errors.slice(0, 3).join('；')}。也可以把 SKILL.md 全文直接贴过来。`)
}

async function fetchCompanions(skillUrl, markdown, fetchImpl) {
  const base = baseUrlOf(skillUrl)
  const files = []
  for (const relative of companionPathsFrom(markdown)) {
    try {
      const fetched = await fetchText(new URL(relative, base).href, fetchImpl)
      if (looksLikeHtml(fetched.contentType, fetched.text)) continue
      files.push({ relative, text: fetched.text })
    } catch (missingCompanion) {
      void missingCompanion
    }
  }
  return files
}

/**
 * Write a skill bundle under `~/.agents/skills/<name>`. Never executes install.sh.
 * @param source - pasted prompt, URL, or SKILL.md text.
 * @param options.fetch - injectable `fetch` for tests.
 * @param options.root - override the user-agents skill root.
 * @returns installed name, description, path, and written relative files.
 */
export async function installSkillFromSource(source, options = {}) {
  const fetchImpl = options.fetch ?? nodeFetch
  const root = options.root ?? userAgentsSkillRoot()
  const text = String(source ?? '').trim()
  if (text === '') throw new Error('请粘贴技能链接或 SKILL.md')
  const resolved = await resolveSkillMarkdown(text, fetchImpl)
  const actorId = actorIdOf(text)
  const companions = resolved.sourceUrl === undefined
    ? []
    : await fetchCompanions(resolved.sourceUrl, resolved.markdown, fetchImpl)
  const target = join(root, resolved.name)
  let created = true
  try {
    await stat(join(target, 'SKILL.md'))
    created = false
  } catch (missingExisting) {
    void missingExisting
  }
  await mkdir(target, { recursive: true, mode: 0o755 })
  const written = ['SKILL.md']
  await writeFile(join(target, 'SKILL.md'), resolved.markdown, { encoding: 'utf8', mode: 0o644 })
  if (actorId !== undefined) {
    await writeFile(join(target, '.aihot-actor-id'), `${actorId}\n`, { encoding: 'utf8', mode: 0o600 })
    written.push('.aihot-actor-id')
  }
  for (const file of companions) {
    const relative = assertSafeRelative(file.relative)
    const dest = join(target, ...relative.split('/'))
    await mkdir(dirname(dest), { recursive: true, mode: 0o755 })
    await writeFile(dest, file.text, { encoding: 'utf8', mode: 0o644 })
    written.push(relative)
  }
  return {
    name: resolved.name,
    description: resolved.description,
    ...(resolved.whenToUse === undefined ? {} : { whenToUse: resolved.whenToUse }),
    path: join(target, 'SKILL.md'),
    files: written,
    created,
  }
}

function jsonError(message, status) {
  return Response.json({ ok: false, error: message }, { status })
}

/**
 * Register cookie-authenticated skill catalog and beginner install on Connection's `/api` channel.
 * @param ctx - Host context that already provides `connection`.
 * @param options.fetch - injectable `fetch` for tests.
 * @param options.userAgentsRoot - override the user-agents skill root for tests.
 * @param options.userDshRoot - override the user-dsh skill root for tests.
 */
export function registerDiySkillRoute(ctx, options = {}) {
  const fetchImpl = options.fetch ?? nodeFetch
  return ctx.connection.fetch.register({
    path: API_PATH,
    methods: ['GET', 'POST'],
    requestBody: 'buffered',
    fetch: async request => {
      try {
        if (request.method === 'GET') {
          const cwd = new URL(request.url).searchParams.get('cwd') ?? undefined
          const skills = await listInstalledSkills({
            skills: skillsOf(ctx),
            ...(cwd === undefined || cwd.trim() === '' ? {} : { cwd: cwd.trim() }),
            ...(options.userAgentsRoot === undefined ? {} : { userAgentsRoot: options.userAgentsRoot }),
            ...(options.userDshRoot === undefined ? {} : { userDshRoot: options.userDshRoot }),
          })
          return Response.json({ ok: true, skills })
        }
        let body = {}
        try { body = await request.json() } catch (parseError) { void parseError }
        const source = typeof body?.source === 'string' ? body.source : typeof body?.markdown === 'string' ? body.markdown : ''
        const installed = await installSkillFromSource(source, { fetch: fetchImpl })
        return Response.json({ ok: true, skill: installed })
      } catch (cause) {
        return jsonError(cause instanceof Error ? cause.message : '技能操作失败', 400)
      }
    },
  })
}
