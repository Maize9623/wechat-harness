import type { SkillInstallResultView, SkillInventoryEntryView } from './types.ts'

const STORAGE_KEY = 'dsh-diy-lab.skill-install-friendly.v1'
export const SKILL_INSTALL_FRIENDLY_EVENT = 'diywx-skill-install-friendly'
export const COMPOSER_INSERT_EVENT = 'diywx-composer-insert'
export const SKILL_INSTALL_MARKER = '<<<DSH_DIY_SKILL_INSTALL>>>'
const SKILL_INSTALL_END = '<<<END_DSH_DIY_SKILL_INSTALL>>>'

const HTTP_URL = /https?:\/\/[^\s<>"'`）)】,，]+/iu
const SKILL_MARKDOWN = /^---\s*\n[\s\S]*?\bname\s*:\s*[a-z0-9]/u
const SKILL_HINT = /(?:安装|装上|装一下|接入|更新).{0,24}(?:skill|技能)|(?:skill|技能).{0,24}(?:安装|装上|接入|更新)|SKILL\.md|aihot-skill|npx skills add|skills add /iu
const SKILL_URL_HINT = /(?:SKILL\.md|aihot-skill|\/skills\/|install\.sh)/iu

/**
 * Whether pasted text should be treated as a skill install request.
 * @param text - composer draft.
 * @returns the same text when it is a skill link, install prompt, or SKILL.md; otherwise undefined.
 */
export function skillInstallSourceOf(text: string): string | undefined {
  const value = text.trim()
  if (value === '') return undefined
  if (SKILL_MARKDOWN.test(value) && /\bdescription\s*:/u.test(value)) return value
  const url = value.match(HTTP_URL)?.[0]
  if (url === undefined) return undefined
  if (SKILL_HINT.test(value) || SKILL_URL_HINT.test(url)) return value
  return undefined
}

/** Default on: paste a skill link in any session and the product installs it. */
export function skillInstallFriendlyEnabled(): boolean {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw === null) return true
    return raw !== '0' && raw !== 'false'
  } catch {
    return true
  }
}

/**
 * Persist the beginner skill-install switch.
 * @param enabled - whether a pasted skill link is installed by the product.
 */
export function writeSkillInstallFriendly(enabled: boolean): void {
  localStorage.setItem(STORAGE_KEY, enabled ? '1' : '0')
  window.dispatchEvent(new CustomEvent(SKILL_INSTALL_FRIENDLY_EVENT, { detail: enabled }))
}

export function skillSourceLabel(source: string): string {
  if (source === 'user-agents' || source === 'user-dsh') return '本机通用'
  if (source === 'project-agents' || source === 'project-dsh') return '当前工作区'
  if (source === 'bundled') return '内置'
  if (source === 'runtime') return '运行时'
  if (source === 'custom') return '自定义目录'
  return '其他'
}

/**
 * Infer a skill source from a SKILL.md path when the Host registry omits it.
 * @param path - absolute skill file path from the session catalog.
 */
export function skillSourceFromPath(path: string | undefined): string {
  if (path === undefined || path === '') return 'runtime'
  const normalized = path.replaceAll('\\', '/')
  if (/\/(?:office-(?:docx|pptx|xlsx)|office-skills|skill-office)\b/u.test(normalized)) return 'bundled'
  if (/(?:^|\/)(?:Users|home)\/[^/]+\/\.agents\/skills\//u.test(normalized)) return 'user-agents'
  if (/(?:^|\/)(?:Users|home)\/[^/]+\/\.dsh\/skills\//u.test(normalized)) return 'user-dsh'
  if (/\/\.agents\/skills\//u.test(normalized)) return 'project-agents'
  if (/\/\.dsh\/skills\//u.test(normalized)) return 'project-dsh'
  return 'runtime'
}

/**
 * Present one session-catalog skill in the inventory.
 * @param entry - user-invocable skill from `ctx.remote.skills.list`.
 */
export function skillViewFromSessionEntry(entry: {
  name: string
  description: string
  whenToUse?: string
  path?: string
  modelInvocable?: boolean
}): SkillInventoryEntryView {
  const source = skillSourceFromPath(entry.path)
  return {
    name: entry.name,
    description: entry.description,
    ...(entry.whenToUse === undefined || entry.whenToUse === '' ? {} : { whenToUse: entry.whenToUse }),
    source,
    sourceLabel: skillSourceLabel(source),
    ...(entry.path === undefined ? {} : { path: entry.path }),
    modelInvocable: entry.modelInvocable !== false,
    userInvocable: true,
  }
}

/**
 * Union two catalogs by name. Earlier entries win.
 * @param preferred - session or disk entries that should appear first.
 * @param extra - Host registry entries such as bundled office skills.
 */
export function mergeSkillInventory(
  preferred: readonly SkillInventoryEntryView[],
  extra: readonly SkillInventoryEntryView[],
): SkillInventoryEntryView[] {
  const seen = new Set<string>()
  const merged: SkillInventoryEntryView[] = []
  for (const skill of [...preferred, ...extra]) {
    if (seen.has(skill.name)) continue
    seen.add(skill.name)
    merged.push(skill)
  }
  return merged
}

/**
 * Hidden teaching block placed before the user-message marker after a successful install.
 * @param installed - host install result.
 * @returns model-only instructions; `visibleUserText` strips this wrapper.
 */
export function skillInstallTeachBlock(installed: SkillInstallResultView): string {
  const when = installed.whenToUse === undefined || installed.whenToUse.trim() === ''
    ? ''
    : `\n适用时机：${installed.whenToUse.trim()}`
  return [
    SKILL_INSTALL_MARKER,
    `微信壳已经把技能「${installed.name}」写到本机 ${installed.path}。这是给 Agent 看的说明书，不是插件，也不要再执行 install.sh、curl|bash 或任何安装脚本。`,
    `技能用途：${installed.description}${when}`,
    `请用简体中文教用户：这个技能做什么、什么时候用、可以怎么问、也可以在输入框输入 /${installed.name}。如果当前会话还没扫到新技能，告诉用户可以新开一个会话再试。不要复述本段标记。`,
    SKILL_INSTALL_END,
  ].join('\n')
}

/**
 * Insert the skill-install teaching block immediately before the user-message marker.
 * @param augmented - already wrapped session prompt.
 * @param installed - host install result.
 * @returns prompt the model sees; the visible bubble stays the typed line.
 */
export function insertSkillInstallTeach(augmented: string, installed: SkillInstallResultView): string {
  const teach = skillInstallTeachBlock(installed)
  const token = '<<<DSH_DIY_USER_MESSAGE>>>'
  const at = augmented.lastIndexOf(token)
  if (at < 0) return `${teach}\n${augmented}`
  return `${augmented.slice(0, at)}${teach}\n${augmented.slice(at)}`
}

async function requestSkillApi<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: { accept: 'application/json', ...(init?.headers ?? {}) },
  })
  const text = await response.text()
  let value: T & { error?: string } = {} as T & { error?: string }
  try {
    value = JSON.parse(text) as T & { error?: string }
  } catch (parseError) {
    void parseError
    if (response.status === 404) throw new Error('技能后台尚未生效，请重启 WeChat Harness 后再试')
    throw new Error(`技能接口返回异常（${response.status}）`)
  }
  if (!response.ok) throw new Error(value.error ?? '技能接口失败')
  return value
}

/**
 * Load the current skill catalog, including project skills when `cwd` is set.
 * @param cwd - current session workspace path.
 * @param sessionSkills - user-invocable skills from the open Session catalog.
 */
export async function fetchInstalledSkills(
  cwd?: string,
  sessionSkills: readonly SkillInventoryEntryView[] = [],
): Promise<readonly SkillInventoryEntryView[]> {
  const query = cwd === undefined || cwd.trim() === '' ? '' : `?cwd=${encodeURIComponent(cwd.trim())}`
  let host: SkillInventoryEntryView[] = []
  let hostError: Error | undefined
  try {
    const value = await requestSkillApi<{ skills?: readonly SkillInventoryEntryView[] }>(`/api/diy-skills${query}`)
    host = (value.skills ?? []).map(skill => ({
      ...skill,
      sourceLabel: skill.sourceLabel === undefined || skill.sourceLabel === ''
        ? skillSourceLabel(skill.source)
        : skill.sourceLabel,
    }))
  } catch (reason) {
    hostError = reason instanceof Error ? reason : new Error('技能清单读取失败')
  }
  const merged = mergeSkillInventory(sessionSkills, host)
  if (merged.length === 0 && hostError !== undefined) throw hostError
  return merged
}

/**
 * Install a skill from a pasted prompt, URL, or SKILL.md body.
 * @param source - composer text or inventory input.
 */
export async function installSkillFromComposer(source: string): Promise<SkillInstallResultView> {
  const value = await requestSkillApi<{ skill?: SkillInstallResultView }>('/api/diy-skills', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ source }),
  })
  if (value.skill === undefined) throw new Error('技能安装没有返回结果')
  return value.skill
}

/**
 * Ask the open conversation composer to insert a slash invocation.
 * @param name - kebab-case skill name.
 */
export function insertSkillCommand(name: string): void {
  window.dispatchEvent(new CustomEvent(COMPOSER_INSERT_EVENT, { detail: `/${name} ` }))
}
