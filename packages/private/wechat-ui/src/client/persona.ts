export type PersonaMode = 'standard' | 'growth'

export interface SessionPersona {
  enabled: boolean
  mode: PersonaMode
  name: string
  goal: string
  prompt: string
  skills: string
  memory: string
  autoGrow: boolean
  growth: string[]
}

export interface ImportedPersona {
  name?: string
  goal?: string
  prompt?: string
  skills?: string
  memory?: string
  mode?: PersonaMode
}

const PERSONA_STORAGE_KEY = 'dsh-diy-lab.session-personas.v1'
const USER_MESSAGE_MARKER = '\n<<<DSH_DIY_USER_MESSAGE>>>\n'
const USER_MESSAGE_MARKER_TOKEN = '<<<DSH_DIY_USER_MESSAGE>>>'
const SCHEDULED_WAKE_MARKER = '<<<DSH_DIY_SCHEDULED_WAKE>>>'

/**
 * Whether stored text is an overlay-wrapped human prompt, not a Host context injection.
 * @param text - stored user/message or context text.
 * @returns true when the DIY user-message marker is present.
 */
export function isWrappedUserPrompt(text: string): boolean {
  return text.includes(USER_MESSAGE_MARKER_TOKEN)
}

const CHINESE_RESPONSE_RULES = [
  '<<<DSH_DIY_GLOBAL_RESPONSE_RULES>>>',
  '界面语言强制规则：所有会展示给用户的自然语言内容必须使用简体中文。',
  '这包括思考摘要、执行计划、工具调用前后的说明、错误分析、自我修正、校验失败后的重试说明和最终答复；不要用英文叙述执行过程。',
  '代码、命令、文件路径、API/模型/组件字段、专有名词以及用户明确要求保留的外语原文不翻译。工具返回英文时，应先用中文概括后再继续，不要把英文原样当作可见回复。',
  '<<<END_DSH_DIY_GLOBAL_RESPONSE_RULES>>>',
].join('\n')

export const EMPTY_PERSONA: SessionPersona = {
  enabled: false,
  mode: 'standard',
  name: '我的 AI 助理',
  goal: '',
  prompt: '',
  skills: '',
  memory: '',
  autoGrow: true,
  growth: [],
}

function frontMatterValue(source: string, key: string): string {
  const match = new RegExp(`^${key}\\s*:\\s*(.+)$`, 'imu').exec(source)?.[1]?.trim() ?? ''
  return match.replace(/^['"]|['"]$/gu, '').trim()
}

function sectionKind(title: string): keyof Pick<ImportedPersona, 'goal' | 'prompt' | 'skills' | 'memory'> {
  const value = title.trim().toLowerCase()
  if (/(?:长期)?目标|使命|用途|goal|objective|mission|purpose/u.test(value)) return 'goal'
  if (/记忆|背景|偏好|约定|memory|background|context|preference/u.test(value)) return 'memory'
  if (/skill|技能|规则|工作方式|工作流|能力|工具|instruction|workflow|rule|tool|capabilit/u.test(value)) return 'skills'
  return 'prompt'
}

/** Parse a user-selected persona/skill document as text only; never install or execute it. */
export function importPersonaDocument(fileName: string, input: string): ImportedPersona {
  const normalized = String(input ?? '').replaceAll('\r\n', '\n').replaceAll('\r', '\n').replace(/^\uFEFF/u, '')
  const front = /^---\s*\n([\s\S]*?)\n---\s*(?:\n|$)/u.exec(normalized)
  const frontMatter = front?.[1] ?? ''
  const body = (front ? normalized.slice(front[0].length) : normalized).trim().slice(0, 80_000)
  const firstTitle = /^#\s+(.+)$/mu.exec(body)?.[1]?.trim() ?? ''
  const importedName = frontMatterValue(frontMatter, 'name') || firstTitle || fileName.replace(/\.(?:md|markdown|txt)$/iu, '')
  const description = frontMatterValue(frontMatter, 'description')
  const sections: Record<'goal' | 'prompt' | 'skills' | 'memory', string[]> = { goal: [], prompt: [], skills: [], memory: [] }
  const heading = /^#{1,6}\s+(.+)$/gmu
  const matches = [...body.matchAll(heading)]
  const preface = body.slice(0, matches[0]?.index ?? body.length).replace(/^#\s+.+$/mu, '').trim()
  if (preface) sections.prompt.push(preface)
  for (let index = 0; index < matches.length; index += 1) {
    const match = matches[index]
    if (match === undefined) continue
    const start = (match.index ?? 0) + match[0].length
    const end = matches[index + 1]?.index ?? body.length
    const content = body.slice(start, end).trim()
    if (content) sections[sectionKind(match[1] ?? '')].push(content)
  }
  const skillDocument = /^skill\.md$/iu.test(fileName.trim()) || /^(?:skill|技能)\b/iu.test(frontMatterValue(frontMatter, 'name'))
  if (matches.length === 0 && body) sections[skillDocument ? 'skills' : 'prompt'].push(body)
  if (skillDocument && body && sections.skills.length === 0) sections.skills.push(body)
  const memory = sections.memory.join('\n\n').trim()
  return {
    ...(importedName ? { name: importedName.slice(0, 40) } : {}),
    ...(sections.goal.length > 0 || description ? { goal: sections.goal.join('\n\n').trim() || description } : {}),
    ...(sections.prompt.length > 0 || description ? { prompt: sections.prompt.join('\n\n').trim() || description } : {}),
    ...(sections.skills.length > 0 ? { skills: sections.skills.join('\n\n').trim() } : {}),
    ...(memory ? { memory, mode: 'growth' } : {}),
  }
}

function readAll(): Record<string, SessionPersona> {
  try {
    const value = JSON.parse(localStorage.getItem(PERSONA_STORAGE_KEY) ?? '{}') as unknown
    return value !== null && typeof value === 'object' ? value as Record<string, SessionPersona> : {}
  } catch {
    return {}
  }
}

export function loadSessionPersona(sessionId: string | undefined): SessionPersona {
  if (sessionId === undefined) return { ...EMPTY_PERSONA }
  const stored = readAll()[sessionId]
  return stored === undefined
    ? { ...EMPTY_PERSONA }
    : { ...EMPTY_PERSONA, ...stored, growth: Array.isArray(stored.growth) ? stored.growth : [] }
}

export function saveSessionPersona(sessionId: string, persona: SessionPersona): void {
  const all = readAll()
  all[sessionId] = { ...persona, growth: persona.growth.slice(-20) }
  localStorage.setItem(PERSONA_STORAGE_KEY, JSON.stringify(all))
}

export function augmentSessionPrompt(sessionId: string, userText: string, attachmentContext = ''): string {
  const persona = loadSessionPersona(sessionId)
  const attachmentBlock = attachmentContext.trim() === '' ? '' : `\n\n${attachmentContext.trim()}`
  if (!persona.enabled) return `${CHINESE_RESPONSE_RULES}${attachmentBlock}${USER_MESSAGE_MARKER}${userText}`
  let growth = persona.growth
  if (persona.mode === 'growth' && persona.autoGrow && userText.trim().length >= 4) {
    const entry = userText.trim().replace(/\s+/g, ' ').slice(0, 180)
    growth = [...growth.filter(item => item !== entry), entry].slice(-20)
    saveSessionPersona(sessionId, { ...persona, growth })
  }
  const blocks = [
    '<<<DSH_DIY_SESSION_CONTEXT>>>',
    '以下内容是本会话独享的长期设定。只在当前会话中遵循，不要把它传播到其他会话。',
    persona.name.trim() === '' ? '' : `角色名称：${persona.name.trim()}`,
    persona.goal.trim() === '' ? '' : `长期目标：\n${persona.goal.trim()}`,
    persona.prompt.trim() === '' ? '' : `通用提示词：\n${persona.prompt.trim()}`,
    persona.skills.trim() === '' ? '' : `Skill 与工作规则：\n${persona.skills.trim()}`,
    persona.mode !== 'growth' || persona.memory.trim() === '' ? '' : `长期记忆：\n${persona.memory.trim()}`,
    persona.mode !== 'growth' || growth.length === 0 ? '' : `成长足迹（最近的用户意图，仅作偏好参考）：\n- ${growth.slice(-6).join('\n- ')}`,
    '<<<END_DSH_DIY_SESSION_CONTEXT>>>',
  ].filter(Boolean)
  return `${CHINESE_RESPONSE_RULES}\n\n${blocks.join('\n\n')}${attachmentBlock}${USER_MESSAGE_MARKER}${userText}`
}

const DIY_WRAPPER = /<<<DSH_DIY_(?:GLOBAL_RESPONSE_RULES|SESSION_CONTEXT|FILE_META|SKILL_INSTALL)>>>[\s\S]*?(?:<<<END_DSH_DIY_(?:GLOBAL_RESPONSE_RULES|SESSION_CONTEXT|FILE_META|SKILL_INSTALL)>>>|$)/gu

/**
 * Recover the human-typed line from a stored user prompt.
 * The overlay wraps prompts with response rules; a clipped preview may lose the end marker.
 * @param text - stored user/message text, or a turn-outline preview of it.
 * @returns the typed line, or empty when the prompt is a scheduled wake or only wrappers.
 */
export function visibleUserText(text: string): string {
  if (text.trimStart().startsWith(SCHEDULED_WAKE_MARKER)) return ''
  const marker = text.lastIndexOf(USER_MESSAGE_MARKER_TOKEN)
  const raw = marker < 0 ? text : text.slice(marker + USER_MESSAGE_MARKER_TOKEN.length).trimStart()
  return raw.replace(DIY_WRAPPER, '').trim()
}
