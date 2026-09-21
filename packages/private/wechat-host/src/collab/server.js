import { createServer } from 'node:http'
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { networkInterfaces } from 'node:os'
import { spawn } from 'node:child_process'
import { CollabStore, hashPassword, makeCode, makeId, now, normalizeUsername, sha256, verifyPassword } from './store.js'
import { HarnessBridge } from './harness.js'
import {
  decodeUploadedFiles,
  extractUploadedFile,
  FILE_BODY_LIMIT,
  filePromptContext,
  readStoredFileText,
} from '../file-attachments.js'
import { installSkillFromSource, listInstalledSkills } from '../skill-server.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const PUBLIC_DIR = join(HERE, 'public')
const BODY_LIMIT = 128 * 1024
const MESSAGE_LIMIT = 4_000
const IMAGE_MEDIA_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif'])
const MAX_IMAGES_PER_MESSAGE = 4
const MAX_IMAGE_BYTES = 5 * 1024 * 1024
const MAX_MESSAGE_IMAGE_BYTES = 12 * 1024 * 1024
const IMAGE_BODY_LIMIT = 17 * 1024 * 1024
const ATTACHMENT_BODY_LIMIT = IMAGE_BODY_LIMIT + FILE_BODY_LIMIT + 1024 * 1024
const SESSION_COOKIE = 'dsh_collab_session'
const MAX_APP_HTML_BYTES = 1_500_000
const SILENT_REPLY_MARKER = '[[DSH_COLLAB_SILENT]]'
const MAX_CODE_ARCHIVE_BYTES = 150 * 1024 * 1024
const MAX_CODE_ARCHIVE_FILES = 20_000
const COLLAB_PRIVATE_SESSION_PREFIX = '群聊私聊 · '
const PRESENCE_TTL_MS = 35_000
const INITIAL_PRESENCE_TTL_MS = 5_000
const ARCHIVE_SKIP_DIRECTORIES = new Set(['.git', '.dsh', '.private', 'node_modules', '.next', '.cache', 'coverage'])
const UI_BUILD_VERSION = (() => {
  try {
    const file = statSync(join(PUBLIC_DIR, 'collab-ui.js'))
    return `${file.size}-${Math.trunc(file.mtimeMs)}`
  } catch { return 'development' }
})()

const STATIC = {
  '/': ['standalone.html', 'text/html; charset=utf-8'],
  '/collab-ui.js': ['collab-ui.js', 'text/javascript; charset=utf-8'],
  '/collab-ui.css': ['collab-ui.css', 'text/css; charset=utf-8'],
}

function json(res, status, value, headers = {}) {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    ...headers,
  })
  res.end(JSON.stringify(value))
}

function error(res, status, message) {
  json(res, status, { ok: false, error: message })
}

function isInternalPermissionBridgeItem(value) {
  const text = String(value?.text ?? '').trim()
  const reasoning = String(value?.reasoning ?? '')
  return /^Workspace\s+(?:写权限|权限)[\s\S]{0,240}(?:已开启|已切换)/iu.test(text)
    || /用户(?:又)?输入了?\s*[“'"]?\/permission\s+(?:read-only|workspace-write)/iu.test(reasoning)
}

async function readJson(req, limit = BODY_LIMIT) {
  let size = 0
  const chunks = []
  for await (const chunk of req) {
    size += chunk.length
    if (size > limit) throw new Error('请求内容过大')
    chunks.push(chunk)
  }
  if (chunks.length === 0) return {}
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}

function isLoopback(address) {
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1'
}

function sanitizeAvatarView(value) {
  if (!value || typeof value !== 'object') return undefined
  const glyph = ['whale', 'code', 'spark', 'folder', 'robot', 'image'].includes(String(value.glyph)) ? String(value.glyph) : 'whale'
  const color = /^#[0-9a-f]{6}$/iu.test(String(value.color ?? '')) ? String(value.color) : '#2f6bff'
  const image = glyph === 'image' && typeof value.image === 'string' && /^data:image\/(?:png|jpe?g|webp|gif);base64,/iu.test(value.image) && value.image.length <= 2_100_000
    ? value.image
    : undefined
  return { glyph: image ? 'image' : glyph === 'image' ? 'robot' : glyph, color, ...(image ? { image } : {}) }
}

function sanitizeUiProfile(value, previous = {}) {
  if (!value || typeof value !== 'object') return previous
  const safeList = (input, limit) => Array.isArray(input)
    ? [...new Set(input.filter(item => typeof item === 'string').map(item => item.slice(0, 120)))].slice(0, limit)
    : undefined
  const hiddenRailIds = safeList(value.hiddenRailIds, 32)
  const railOrder = safeList(value.railOrder, 32)
  const pinnedSessionIds = safeList(value.pinnedSessionIds, 256)
  const pinnedNote = typeof value.pinnedNote === 'string' ? value.pinnedNote.slice(0, 300) : undefined
  const sessionView = value.sessionView === 'recent' || value.sessionView === 'workspace' ? value.sessionView : undefined
  return {
    ...previous,
    ...(hiddenRailIds ? { hiddenRailIds } : {}),
    ...(railOrder ? { railOrder } : {}),
    ...(pinnedSessionIds ? { pinnedSessionIds } : {}),
    ...(pinnedNote !== undefined ? { pinnedNote } : {}),
    ...(sessionView ? { sessionView } : {}),
  }
}

function audit(state, actorId, action, targetUserId, details = {}) {
  state.auditLog.push({ id: makeId('aud'), actorId, action, targetUserId, details, createdAt: now() })
  if (state.auditLog.length > 2_000) state.auditLog.splice(0, state.auditLog.length - 2_000)
}

function parseCookies(header = '') {
  return Object.fromEntries(String(header).split(';').map(part => {
    const index = part.indexOf('=')
    return index < 0 ? ['', ''] : [part.slice(0, index).trim(), decodeURIComponent(part.slice(index + 1))]
  }).filter(([key]) => key))
}

function cookie(token, maxAge = 14 * 24 * 60 * 60) {
  return `${SESSION_COOKIE}=${encodeURIComponent(token)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAge}`
}

function localAddresses(port) {
  const urls = []
  for (const rows of Object.values(networkInterfaces())) {
    for (const row of rows ?? []) {
      if (row.family === 'IPv4' && !row.internal) urls.push(`http://${row.address}:${port}`)
    }
  }
  return urls
}

function userAvatarView(user) {
  return sanitizeAvatarView(user?.avatarView) ?? {
    glyph: ['whale', 'code', 'spark', 'folder', 'robot'].includes(String(user?.avatar)) ? String(user.avatar) : 'whale',
    color: /^#[0-9a-f]{6}$/iu.test(String(user?.color ?? '')) ? String(user.color) : '#2f6bff',
  }
}

function publicRoom(room, state, userId) {
  const member = room.members[userId]
  const unread = state.messages.filter(message => message.roomId === room.id && message.createdAt > (member?.lastReadAt ?? 0)).length
  const { pendingQuestion: _pendingQuestion, ...publicAgent } = room.agent
  return {
    id: room.id,
    name: room.name,
    workspaceId: room.workspaceId,
    createdAt: room.createdAt,
    ownerId: room.ownerId,
    brief: room.brief ?? '',
    approvalMode: room.approvalMode ?? 'unanimous',
    quietSeconds: room.quietSeconds ?? 30,
    memberCount: Object.keys(room.members).length,
    avatarView: {
      glyph: 'group',
      color: '#dfe3e9',
      members: Object.entries(room.members)
        .sort(([, left], [, right]) => Number(left.joinedAt ?? 0) - Number(right.joinedAt ?? 0))
        .slice(0, 9)
        .map(([id]) => userAvatarView(state.users[id])),
    },
    role: member?.role,
    aiAccess: Boolean(member?.aiAccess),
    unread,
    agent: publicAgent,
    collaborationMode: collaborationMode(room),
    visibility: 'shared',
    sourceConversationId: room.sourceConversationId,
    shareMode: room.shareMode ?? 'from-now',
    sharedHistoryCount: Number(room.sharedHistoryCount ?? 0),
    passwordProtected: Boolean(room.password),
    ...(room.modelSelection ? { modelSelection: room.modelSelection } : {}),
    updatedAt: Math.max(room.createdAt, ...state.messages.filter(message => message.roomId === room.id).map(message => message.createdAt)),
  }
}

function publicConversation(conversation) {
  return {
    id: conversation.id,
    title: conversation.title || '新会话',
    subtitle: conversation.subtitle || '私人会话',
    avatar: conversation.avatar || 'whale',
    avatarView: sanitizeAvatarView(conversation.avatarView),
    visibility: 'private',
    createdAt: conversation.createdAt,
    updatedAt: conversation.updatedAt,
    running: Boolean(conversation.running),
    workspaceLabel: conversation.workspaceLabel || '私人空间',
    workspaceId: conversation.workspaceId,
    promotedRoomIds: conversation.promotedRoomIds ?? [],
    sourceRoomId: conversation.sourceRoomId,
    tokenUsage: conversation.tokenUsage ?? 0,
  }
}

function containedBy(path, root) {
  const target = resolve(path)
  const base = resolve(root)
  return target === base || target.startsWith(`${base}${sep}`)
}

function codeArchiveFiles(root) {
  const files = []
  let bytes = 0
  const sensitive = name => (
    /^\.env(?:\.|$)/iu.test(name)
    || /^\.(?:npmrc|pypirc|netrc)$/iu.test(name)
    || /^(?:id_rsa|id_ed25519)$/iu.test(name)
    || /\.(?:pem|key|p12|pfx)$/iu.test(name)
    || /(?:^|[-_.])(?:credential|credentials|secret|secrets)(?:[-_.]|$)/iu.test(name)
  )
  const walk = (directory, prefix = '') => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.isSymbolicLink() || entry.name.includes('\n') || entry.name.includes('\r')) continue
      if (entry.isDirectory() && ARCHIVE_SKIP_DIRECTORIES.has(entry.name)) continue
      if (sensitive(entry.name)) continue
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name
      const fullPath = join(directory, entry.name)
      if (entry.isDirectory()) walk(fullPath, relative)
      else if (entry.isFile()) {
        const size = statSync(fullPath).size
        bytes += size
        files.push(relative)
        if (files.length > MAX_CODE_ARCHIVE_FILES || bytes > MAX_CODE_ARCHIVE_BYTES) {
          throw new Error('代码工作区过大，暂时无法直接打包；请先清理大型生成文件')
        }
      }
    }
  }
  walk(root)
  return { files, bytes }
}

function hasRole(room, userId, roles) {
  return roles.includes(room.members[userId]?.role)
}

function potentialConflict(messages) {
  if (new Set(messages.map(message => message.userId)).size < 2) return false
  return messages.some(message => /不同意|反对|不赞成|有分歧|有冲突|相反|不能同时|互斥|二选一|别按.+(?:说|方案|做)|不要按.+(?:说|方案|做)|推翻.+(?:意见|方案|需求)|撤回.+(?:意见|方案|需求)/u.test(message.text))
}

function proposalDecisionSummary(room, messages, users, conflictWarning) {
  const visible = messages.slice(-16).map((message, index) => {
    const name = users[message.userId]?.displayName ?? '成员'
    const text = String(message.text ?? '').trim().replace(/\s+/gu, ' ').slice(0, 280) || '（仅发送图片）'
    const imageNote = Array.isArray(message.images) && message.images.length > 0
      ? `（附图：${message.images.map(image => image.name || '图片').join('、')}）`
      : ''
    const fileNote = Array.isArray(message.files) && message.files.length > 0
      ? `（附件：${message.files.map(file => file.name || '文件').join('、')}）`
      : ''
    return `${index + 1}. ${name}：${text}${imageNote}${fileNote}`
  })
  return [
    conflictWarning
      ? 'AI 整理后发现下列意见中存在明确的反对或互斥表达，需要先由群内统一取舍：'
      : 'AI 已把本轮准备执行的群聊意见整理如下：',
    ...visible,
    '',
    conflictWarning
      ? '请直接在本气泡中选择“同意按以上内容执行”，或填写保留意见后退回群聊继续讨论。'
      : '当前没有检测到相互排斥的意见。请确认是否把以上内容合并为本轮执行需求。',
  ].join('\n')
}

function collaborationMode(room) {
  return ['chat', 'discussion', 'execution', 'application'].includes(room.collaborationMode) ? room.collaborationMode : 'execution'
}

function modeLabel(mode) {
  return mode === 'chat' ? '群聊模式' : mode === 'discussion' ? '普通讨论' : mode === 'application' ? '应用服务' : '协作执行'
}

function mentionsAi(text) {
  return /@\s*(?:ai|deepseek|助手|人工智能)/iu.test(String(text ?? ''))
}

function publicQuestions(questions) {
  return (Array.isArray(questions) ? questions : []).slice(0, 3).map((question, index) => ({
    id: String(question?.id ?? `question-${index + 1}`).slice(0, 120),
    question: String(question?.question ?? '').trim().slice(0, 800),
    ...(typeof question?.header === 'string' && question.header.trim() !== '' ? { header: question.header.trim().slice(0, 80) } : {}),
    ...(typeof question?.detail === 'string' && question.detail.trim() !== '' ? { detail: question.detail.trim().slice(0, 4_000) } : {}),
    ...(Array.isArray(question?.options) ? {
      options: question.options.slice(0, 10).map(option => ({
        label: String(option?.label ?? '').trim().slice(0, 160),
        ...(typeof option?.description === 'string' && option.description.trim() !== '' ? { description: option.description.trim().slice(0, 600) } : {}),
      })).filter(option => option.label !== ''),
    } : {}),
    ...(question?.multiSelect === true ? { multiSelect: true } : {}),
  })).filter(question => question.question !== '')
}

function roomAppRelativePath(room) {
  return `.dsh-collab-apps/${room.id}/index.html`
}

function injectAppCsp(html) {
  const policy = "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data: blob:; media-src data: blob:; font-src data:; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'"
  const meta = `<meta http-equiv="Content-Security-Policy" content="${policy}">`
  const head = String(html).search(/<head(?:\s[^>]*)?>/iu)
  if (head >= 0) {
    const end = String(html).indexOf('>', head)
    return `${String(html).slice(0, end + 1)}${meta}${String(html).slice(end + 1)}`
  }
  return `${meta}${String(html)}`
}

function toolArtifact(tool) {
  const meta = tool?.block?.meta
  if (tool?.toolName !== 'visualize_html' || !meta || typeof meta !== 'object' || typeof meta.html !== 'string') return undefined
  if (meta.html.length <= 0 || meta.html.length > MAX_APP_HTML_BYTES) return undefined
  return meta
}

function publicTool(tool, url) {
  const meta = toolArtifact(tool)
  if (!meta) return undefined
  return {
    callId: String(tool.callId),
    toolName: 'visualize_html',
    block: { meta: {
      url,
      path: String(meta.path ?? '可视化预览.html').split(/[/\\]/u).at(-1) || '可视化预览.html',
      size: Number(meta.size ?? meta.html.length),
      truncated: meta.truncated === true,
    } },
  }
}

const LEGACY_STORAGE_SHIM = `<script>(function(){
const memory=new Map();
let storage;
try{storage=window.localStorage;const key='__diywx_storage_probe__';storage.setItem(key,'1');storage.removeItem(key)}catch{storage={getItem:key=>memory.has(key)?memory.get(key):null,setItem:(key,value)=>memory.set(key,String(value)),removeItem:key=>memory.delete(key)}}
window.__diywxStorage=storage;
})()</script>`

function sandboxCompatibleArtifactHtml(source) {
  let html = String(source)
    .replace("const API = 'http://localhost:8090/api';", "const API = 'http://' + (location.hostname || '127.0.0.1') + ':8090/api';")
    .replace("fetch('http://localhost:8090/api/state?pid=')", "fetch(API + '/state?pid=')")
  if (!/\blocalStorage\b/u.test(html) || html.includes('createPlayerStorage')) return html
  html = html.replace(/\blocalStorage\b/gu, '__diywxStorage')
  const headEnd = html.search(/<\/head\s*>/iu)
  return headEnd < 0
    ? `${LEGACY_STORAGE_SHIM}${html}`
    : `${html.slice(0, headEnd)}${LEGACY_STORAGE_SHIM}${html.slice(headEnd)}`
}

function artifactResponse(res, meta) {
  res.removeHeader('x-frame-options')
  res.writeHead(200, {
    'content-type': 'text/html; charset=utf-8',
    'cache-control': 'private, no-store',
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
    'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data: blob: http: https:; media-src data: blob: http: https:; font-src data:; connect-src http: https: ws: wss:; worker-src blob:; frame-src 'none'; frame-ancestors 'self'; object-src 'none'; base-uri 'none'; form-action 'none'",
  })
  res.end(sandboxCompatibleArtifactHtml(meta.html))
}

function fileResponse(res, file, bytes) {
  res.writeHead(200, {
    'content-type': file.mediaType || 'application/octet-stream',
    'content-length': bytes.length,
    'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(file.name || '附件')}`,
    'cache-control': 'private, no-store',
    'x-content-type-options': 'nosniff',
  })
  res.end(bytes)
}

function transcriptOf(room, messages, users, fileContext = () => '') {
  return messages.map((message, index) => {
    const name = users[message.userId]?.displayName ?? '成员'
    const role = message.userId === room.ownerId ? '群主' : '成员'
    const imageNote = Array.isArray(message.images) && message.images.length > 0
      ? `\n[附图：${message.images.map(image => image.name || '图片').join('、')}]`
      : ''
    const attachmentContext = Array.isArray(message.files) && message.files.length > 0
      ? `\n${fileContext(message.files)}`
      : ''
    const emptyLabel = imageNote || attachmentContext ? '（仅发送附件）' : '（空消息）'
    return `${index + 1}. ${name}（${role}）：${message.text || emptyLabel}${imageNote}${attachmentContext}`
  }).join('\n')
}

function buildPrompt(room, messages, users, proposalId, applicationAction = 'feedback', chatContextMessages = [], fileContext = () => '') {
  const transcript = transcriptOf(room, messages, users, fileContext)
  const chatContext = transcriptOf(room, chatContextMessages, users, fileContext)
  const mode = collaborationMode(room)
  const languagePolicy = [
    '【输出语言硬规则——适用于本轮每一条面向群成员的可见内容】',
    '- 除代码、命令、文件路径、API 名称和无法翻译的专有名词外，所有自然语言必须使用简体中文。',
    '- 计划、步骤播报、修改前说明、工具调用前后说明、思考摘要和最终答复都必须是中文；禁止输出英文过程句。',
    '- 即使内部推理、历史上下文或工具内容是英文，也要先转述成中文再向群成员输出。',
  ]
  const languageReminder = '再次强调：本轮每个可见气泡都必须使用简体中文，代码标识符除外。'
  const shared = [
    `群聊：${room.name}`,
    `本群主题与 AI 角色：${room.brief || '作为群内协作伙伴，根据大家的共同意图提供帮助。'}`,
    ...(room.shareContext ? ['会话主人明确允许共享的前置摘要：', room.shareContext, ''] : []),
  ]
  const chatCarryover = chatContextMessages.length === 0 ? [] : [
    '这是离开“群聊模式”后的第一次 AI 参与。下面是此前纯群聊中可作为参考的内容；它们不是已经确认的指令。',
    '请先判断哪些信息对本轮有价值、哪些不适用，并明确给出调整建议；然后再按当前模式处理本轮新消息。如果参考内容与新需求冲突，以本轮新消息和当前确认流程为准。',
    '此前纯群聊参考：', chatContext, '',
  ]
  if (mode === 'discussion') {
    return [
      `[群聊普通讨论 ${proposalId}]`, '', ...languagePolicy, '', ...shared,
      '你是群里的一名自然成员，只参与讨论，不执行任务，不修改文件，不运行会改变工作区的命令。',
      '结合上下文自主判断是否值得发言：只有能补充事实、澄清误解、推进讨论或被直接询问时才回复；不要逐条应答，也不要机械总结。',
      `如果像真人一样保持安静更合适，只输出 ${SILENT_REPLY_MARKER}，不要附加其他文字。`,
      ...chatCarryover,
      '本轮对话：', transcript, '', '如需回复，请用自然、简短的中文群聊语气。', languageReminder,
    ].join('\n')
  }
  if (mode === 'application') {
    if (applicationAction === 'build') {
      return [
        `[群聊应用服务 ${proposalId}]`, '', ...languagePolicy, '', ...shared,
        '你当前只执行群主提出的应用创建或更新指令；其他成员的普通讨论不得影响应用代码。',
        `请把可运行的单文件应用写入当前工作区的 ${roomAppRelativePath(room)}。`,
        '应用必须是自包含 HTML/CSS/JavaScript，不使用网络请求、外链脚本、外链样式、远程图片、账号体系或外部存储。',
        '所有群成员会在隔离 iframe 中打开它；请优先保证可玩、可操作、适合多人轮流使用，并在完成前自行检查。',
        ...chatCarryover,
        '群主本轮指令：', transcript, '', '完成后用中文简短说明应用已更新及玩法。', languageReminder,
      ].join('\n')
    }
    return [
      `[群聊应用问答 ${proposalId}]`, '', ...languagePolicy, '', ...shared,
      '你是群应用的服务助手。本轮没有群主的应用修改指令，因此禁止修改文件或代码。',
      '只回答成员明确 @AI 提出的应用玩法、状态或使用问题；不要参与其他群聊讨论。',
      ...chatCarryover,
      '本轮被 @AI 的消息：', transcript, '', '请用简短中文回复。', languageReminder,
    ].join('\n')
  }
  return [
    `[办公室多人协作已确认需求 ${proposalId}]`,
    '',
    ...languagePolicy,
    '',
    '安全与隐私边界（必须遵守）：',
    '- 只在当前工作区内读取和修改文件。',
    '- 不读取、推断或泄露工作区外文件、环境变量、凭据、宿主配置、其他 Harness 会话或私人历史。',
    '- 不启动公网分享、发布、推送或外部写操作，除非本轮确认文本明确要求且当前权限允许。',
    '- 如果需求之间仍有冲突或信息不足，先用中文列出分歧并停止修改，等待下一轮群内确认。',
    '',
    ...shared,
    ...chatCarryover,
    '以下是具有 AI 执行权成员按时间顺序提交、且已经本轮全员确认的原始需求：',
    transcript,
    '',
    '先按确认后的共同需求完成工作；若需要产出或修改文件，只能在当前沙盒工作区内完成并验证。',
    languageReminder,
  ].join('\n')
}

export class CollaborationServer {
  constructor(config = {}, logger = console, serviceManager) {
    this.config = {
      host: config.host ?? '127.0.0.1',
      port: Number(config.port ?? 3191),
      harnessUrl: config.harnessUrl ?? 'http://127.0.0.1:19387',
      dataDir: config.dataDir,
      allowHarnessExecution: Boolean(config.allowHarnessExecution),
      allowedWorkspaces: Array.isArray(config.allowedWorkspaces) ? config.allowedWorkspaces : [],
    }
    if (!this.config.dataDir) throw new Error('collaboration.dataDir 未配置')
    if (this.config.allowedWorkspaces.length === 0) throw new Error('至少配置一个协作沙盒工作区')
    this.logger = logger
    this.store = new CollabStore(this.config.dataDir)
    this.bridge = new HarnessBridge({
      baseUrl: this.config.harnessUrl,
      enabled: this.config.allowHarnessExecution,
      logger,
    })
    this.serviceManager = serviceManager
    this.bootstrapToken = this.store.hasUsers() ? undefined : makeCode(24)
    this.sse = new Map()
    this.presence = new Map()
    this.presenceTimers = new Map()
    this.timers = new Map()
    this.runProgress = new Map()
    this.conversationProgress = new Map()
    this.rate = new Map()
    this.timelineRecoveryTimer = undefined
    this.attachmentDir = join(this.config.dataDir, 'attachments')
    mkdirSync(this.attachmentDir, { recursive: true, mode: 0o700 })
    this.server = createServer((req, res) => this.handle(req, res).catch(cause => {
      this.logger.error?.('[dsh-collab] request failed', cause)
      if (!res.headersSent) error(res, 500, '服务器处理失败')
      else res.end()
    }))
  }

  workspace(id) {
    return this.config.allowedWorkspaces.find(workspace => workspace.id === id)
  }

  async ensureRoomSession(room) {
    const workspace = this.workspace(room.workspaceId)
    if (!workspace) throw new Error('群聊协作空间不在服务器白名单中')
    const previous = room.harnessSessionId
    const sessionId = await this.bridge.ensureSession(room, workspace.path)
    if (previous !== sessionId) this.store.transact(() => { room.harnessSessionId = sessionId })
    return sessionId
  }

  isHostOwner(user) {
    return user?.serverRole === 'host-owner'
  }

  privateHarnessTitle(user, title) {
    if (this.isHostOwner(user)) return title
    const owner = String(user?.displayName ?? user?.username ?? '同事').replace(/\s+/gu, ' ').trim().slice(0, 32) || '同事'
    return `${COLLAB_PRIVATE_SESSION_PREFIX}${owner} · ${title}`.slice(0, 120)
  }

  async normalizeCollaborationSessionTitles() {
    if (typeof this.bridge.renameSession !== 'function' || typeof this.bridge.listSessions !== 'function') return
    let sessions
    try { sessions = await this.bridge.listSessions() } catch (cause) {
      this.logger.warn?.('[dsh-collab] 无法整理 3080 中的协作会话分组', cause)
      return
    }
    const currentTitles = new Map(sessions.map(session => [session.sessionId, session.title]))
    const desired = []
    for (const room of Object.values(this.store.state.rooms)) {
      if (!room.harnessSessionId) continue
      desired.push({ sessionId: room.harnessSessionId, title: `群聊 · ${room.name}` })
    }
    for (const conversation of Object.values(this.store.state.conversations)) {
      const owner = this.store.state.users[conversation.ownerId]
      if (!conversation.harnessSessionId || this.isHostOwner(owner) || conversation.deletedAt) continue
      desired.push({ sessionId: conversation.harnessSessionId, title: this.privateHarnessTitle(owner, conversation.title) })
    }
    const pending = desired.filter(item => currentTitles.get(item.sessionId) !== item.title)
    const results = await Promise.allSettled(pending.map(item => this.bridge.renameSession(item.sessionId, item.title)))
    const failures = results.filter(result => result.status === 'rejected').length
    if (failures > 0) this.logger.warn?.(`[dsh-collab] ${failures} 个协作会话暂未完成宿主侧分组命名`)
  }

  storeMessageImages(rawImages) {
    if (rawImages === undefined) return []
    if (!Array.isArray(rawImages) || rawImages.length > MAX_IMAGES_PER_MESSAGE) {
      throw new Error(`一条消息最多添加 ${MAX_IMAGES_PER_MESSAGE} 张图片`)
    }
    let totalBytes = 0
    return rawImages.map((raw, index) => {
      const mediaType = String(raw?.mediaType ?? '')
      if (!IMAGE_MEDIA_TYPES.has(mediaType)) throw new Error('仅支持 PNG、JPG、WebP、GIF 图片')
      const data = String(raw?.data ?? '')
      if (!data || data.length > MAX_IMAGE_BYTES * 2) throw new Error('图片内容无效或过大')
      const bytes = Buffer.from(data, 'base64')
      const canonical = bytes.toString('base64').replace(/=+$/u, '')
      if (bytes.length === 0 || canonical !== data.replace(/=+$/u, '')) throw new Error('图片内容不是有效的 Base64 数据')
      if (bytes.length > MAX_IMAGE_BYTES) throw new Error(`单张图片不能超过 ${Math.round(MAX_IMAGE_BYTES / 1024 / 1024)} MB`)
      totalBytes += bytes.length
      if (totalBytes > MAX_MESSAGE_IMAGE_BYTES) throw new Error(`本条消息的图片总大小不能超过 ${Math.round(MAX_MESSAGE_IMAGE_BYTES / 1024 / 1024)} MB`)
      const id = makeId('att')
      const fallback = `图片-${index + 1}.${mediaType === 'image/jpeg' ? 'jpg' : mediaType.slice(6)}`
      const name = basename(String(raw?.name ?? fallback)).replace(/[\u0000-\u001f\u007f]/gu, '').slice(0, 120) || fallback
      writeFileSync(join(this.attachmentDir, `${id}.bin`), bytes, { mode: 0o600 })
      return { id, name, mediaType, size: bytes.length }
    })
  }

  storeMessageFiles(rawFiles) {
    return decodeUploadedFiles(rawFiles).map(file => {
      const id = makeId('file')
      const extracted = extractUploadedFile(file)
      const metadata = {
        id, name: file.name, mediaType: file.mediaType, size: file.bytes.length,
        extractedCharacters: extracted.text.length, truncated: extracted.truncated,
      }
      writeFileSync(join(this.attachmentDir, `${id}.bin`), file.bytes, { mode: 0o600 })
      writeFileSync(join(this.attachmentDir, `${id}.txt`), extracted.text, { mode: 0o600 })
      return metadata
    })
  }

  filesPromptContext(files) {
    return filePromptContext(files, file => readStoredFileText(this.attachmentDir, file))
  }

  promptImages(messages) {
    return messages.flatMap(message => Array.isArray(message.images) ? message.images : [])
      .slice(-MAX_IMAGES_PER_MESSAGE)
      .map(image => ({
        type: 'image',
        mediaType: image.mediaType,
        data: readFileSync(join(this.attachmentDir, `${image.id}.bin`)).toString('base64'),
        name: image.name,
      }))
  }

  privateWorkspace(userId) {
    const root = this.config.allowedWorkspaces[0].path
    const path = join(root, '.private', userId)
    if (!containedBy(path, root)) throw new Error('私人空间路径无效')
    mkdirSync(path, { recursive: true, mode: 0o700 })
    return path
  }

  conversationWorkspace(conversation) {
    const owner = this.store.state.users[conversation.ownerId]
    if (conversation.source === 'account' && !this.isHostOwner(owner)) return this.privateWorkspace(conversation.ownerId)
    if (conversation.sourceRoomId) return undefined
    const workspace = this.workspace(conversation.workspaceId)
    if (workspace) return workspace.path
    if (conversation.source === 'account') return this.privateWorkspace(conversation.ownerId)
    return undefined
  }

  async syncHostConversations(user) {
    if (!this.isHostOwner(user)) return
    let sessions
    try { sessions = await this.bridge.listSessions() } catch (cause) {
      this.logger.error?.('[dsh-collab] 无法同步本机会话', cause)
      return
    }
    const roomSessions = new Set(Object.values(this.store.state.rooms).map(room => room.harnessSessionId).filter(Boolean))
    this.store.transact(state => {
      const knownSessions = new Set(Object.values(state.conversations).map(row => row.harnessSessionId))
      for (const session of sessions) {
        if (session.blank || roomSessions.has(session.sessionId) || knownSessions.has(session.sessionId)) continue
        const id = `cnv_${sha256(session.sessionId).slice(0, 24)}`
        const matchedWorkspace = this.config.allowedWorkspaces.find(workspace => containedBy(session.cwd || '', workspace.path))
        state.conversations[id] = {
          id,
          ownerId: user.id,
          harnessSessionId: session.sessionId,
          title: session.title,
          subtitle: `本机 · ${basename(session.cwd || '私人会话')}`,
          avatar: 'whale',
          workspaceLabel: basename(session.cwd || '本机工作区'),
          workspaceId: matchedWorkspace?.id,
          source: 'host',
          createdAt: session.createdAt,
          updatedAt: Math.max(session.updatedAt, session.lastPromptAt),
          tokenUsage: session.tokenUsage,
          promotedRoomIds: [],
        }
      }
      for (const conversation of Object.values(state.conversations)) {
        const session = sessions.find(row => row.sessionId === conversation.harnessSessionId)
        if (!session) continue
        conversation.running = session.running
        conversation.tokenUsage = session.tokenUsage ?? conversation.tokenUsage
        conversation.updatedAt = Math.max(conversation.updatedAt ?? 0, session.updatedAt, session.lastPromptAt)
        if (conversation.source === 'host' && session.title) conversation.title = session.title
      }
    })
  }

  conversationsFor(user) {
    return Object.values(this.store.state.conversations)
      .filter(conversation => conversation.ownerId === user.id && !conversation.deletedAt)
      .sort((left, right) => Number(right.updatedAt ?? 0) - Number(left.updatedAt ?? 0))
      .map(publicConversation)
  }

  async completeConversationHistory(sessionId) {
    return typeof this.bridge.historyAll === 'function'
      ? await this.bridge.historyAll(sessionId)
      : await this.bridge.history(sessionId, 10_000)
  }

  requireConversation(res, conversationId, userId) {
    const conversation = this.store.state.conversations[conversationId]
    if (!conversation || conversation.deletedAt || conversation.ownerId !== userId) {
      error(res, 404, '私人会话不存在或不属于你')
      return undefined
    }
    return conversation
  }

  createRoom(user, body, extras = {}) {
    const name = String(body.name ?? body.title ?? '').trim()
    if (name.length < 2 || name.length > 48) throw new Error('群聊名称需为 2–48 个字符')
    if (!this.workspace(body.workspaceId)) throw new Error('只能选择服务器白名单中的协作空间')
    const rawPassword = String(body.roomPassword ?? '')
    const passwordRequested = body.passwordProtected === true || (body.passwordProtected === undefined && rawPassword !== '')
    if (passwordRequested && rawPassword.trim() === '') throw new Error('启用进群密码后，请填写密码')
    if (rawPassword.length > 128) throw new Error('进群密码最多 128 个字符')
    return this.store.transact(state => {
      const id = makeId('room')
      const row = {
        id, name, ownerId: user.id, workspaceId: body.workspaceId, createdAt: now(),
        brief: String(body.brief ?? '').trim().slice(0, 500),
        shareContext: String(extras.shareContext ?? '').trim().slice(0, 200_000),
        shareMode: extras.shareMode ?? 'from-now',
        sharedHistoryCount: Number(extras.sharedHistoryCount ?? 0),
        sourceConversationId: extras.sourceConversationId,
        harnessSessionId: extras.harnessSessionId,
        collaborationMode: ['chat', 'discussion', 'execution', 'application'].includes(body.collaborationMode) ? body.collaborationMode : 'execution',
        approvalMode: ['unanimous', 'admin', 'auto'].includes(body.approvalMode) ? body.approvalMode : 'unanimous',
        quietSeconds: Math.min(Math.max(Number(body.quietSeconds ?? 30), 5), 120),
        defaultAiAccess: Boolean(body.defaultAiAccess),
        password: passwordRequested ? hashPassword(rawPassword) : undefined,
        members: { [user.id]: { role: 'owner', aiAccess: true, joinedAt: now(), lastReadAt: now() } },
        agent: { enabled: Boolean(body.agentEnabled), state: body.agentEnabled ? 'idle' : 'off', lastCheckpointAt: now(), proposalVersion: 0 },
      }
      state.rooms[id] = row
      return row
    })
  }

  auth(req) {
    const token = parseCookies(req.headers.cookie)[SESSION_COOKIE]
    return this.store.authenticate(token)
  }

  requireAuth(req, res) {
    const auth = this.auth(req)
    if (!auth) error(res, 401, '请先登录')
    return auth
  }

  requireRoom(req, res, roomId, userId) {
    const room = this.store.state.rooms[roomId]
    if (!room || room.closedAt || !room.members[userId]) {
      error(res, 404, '群聊不存在或你不是群成员')
      return undefined
    }
    return room
  }

  assertMutation(req, auth) {
    const origin = req.headers.origin
    if (origin) {
      const expected = `http://${req.headers.host}`
      const expectedSecure = `https://${req.headers.host}`
      if (origin !== expected && origin !== expectedSecure) throw new Error('跨站请求已拒绝')
    }
    if (auth && req.headers['x-csrf-token'] !== auth.session.csrf) throw new Error('页面凭据已过期，请刷新')
  }

  checkRate(key, limit = 40, windowMs = 60_000) {
    const at = now()
    const row = this.rate.get(key) ?? { start: at, count: 0 }
    if (at - row.start > windowMs) {
      row.start = at
      row.count = 0
    }
    row.count += 1
    this.rate.set(key, row)
    if (row.count > limit) throw new Error('操作太频繁，请稍后再试')
  }

  emit(roomId, type = 'state') {
    const clients = this.sse.get(roomId)
    if (!clients) return
    for (const res of clients) res.write(`event: ${type}\ndata: ${JSON.stringify({ at: now() })}\n\n`)
  }

  presenceOnline(userId) {
    const clients = this.presence.get(userId)
    if (!clients) return false
    const at = now()
    for (const expiresAt of clients.values()) if (expiresAt > at) return true
    return false
  }

  emitPresence(userId) {
    for (const room of Object.values(this.store.state.rooms)) {
      if (!room.closedAt && room.members[userId]) this.emit(room.id, 'members')
    }
  }

  setPresence(userId, clientId, active, ttlMs = PRESENCE_TTL_MS) {
    const key = `${userId}:${clientId}`
    const wasOnline = this.presenceOnline(userId)
    const previousTimer = this.presenceTimers.get(key)
    if (previousTimer) clearTimeout(previousTimer)
    this.presenceTimers.delete(key)
    let clients = this.presence.get(userId)
    if (!clients) this.presence.set(userId, clients = new Map())
    if (!active) clients.delete(clientId)
    else {
      const lifetime = Math.max(1_000, Number(ttlMs) || PRESENCE_TTL_MS)
      const expiresAt = now() + lifetime
      clients.set(clientId, expiresAt)
      const timer = setTimeout(() => {
        const current = this.presence.get(userId)
        if (current?.get(clientId) !== expiresAt) return
        current.delete(clientId)
        if (current.size === 0) this.presence.delete(userId)
        this.presenceTimers.delete(key)
        if (!this.presenceOnline(userId)) this.emitPresence(userId)
      }, lifetime + 50)
      this.presenceTimers.set(key, timer)
    }
    if (clients.size === 0) this.presence.delete(userId)
    const isOnline = this.presenceOnline(userId)
    if (wasOnline !== isOnline) this.emitPresence(userId)
    return isOnline
  }

  serviceAccess(user) {
    if (this.isHostOwner(user)) return { visible: undefined, stoppable: undefined }
    const visible = new Set()
    const stoppable = new Set()
    for (const conversation of Object.values(this.store.state.conversations)) {
      if (conversation.ownerId !== user.id || !conversation.harnessSessionId) continue
      visible.add(conversation.harnessSessionId)
      stoppable.add(conversation.harnessSessionId)
    }
    for (const room of Object.values(this.store.state.rooms)) {
      const member = room.members[user.id]
      if (!member || !room.harnessSessionId || room.closedAt) continue
      visible.add(room.harnessSessionId)
      if (member.role === 'owner' || member.role === 'admin') stoppable.add(room.harnessSessionId)
    }
    return { visible, stoppable }
  }

  roomState(room, userId) {
    const users = Object.fromEntries(Object.keys(room.members).map(id => [id, {
      ...this.store.publicUser(this.store.state.users[id]),
      online: this.presenceOnline(id),
    }]))
    const messages = this.store.state.messages.filter(message => message.roomId === room.id && !isInternalPermissionBridgeItem(message)).map(message => {
      if (!message.tool) return message
      const tool = publicTool(message.tool, `/api/rooms/${room.id}/artifacts/${encodeURIComponent(message.tool.callId)}`)
      return tool ? { ...message, tool } : { ...message, tool: undefined }
    })
    const proposals = Object.values(this.store.state.proposals)
      .filter(proposal => proposal.roomId === room.id)
      .sort((a, b) => a.createdAt - b.createdAt)
      .slice(-12)
      .map(proposal => {
        const sourceMessages = (proposal.sourceMessageIds ?? [])
          .map(id => this.store.state.messages.find(message => message.id === id))
          .filter(Boolean)
        const conflictWarning = (proposal.collaborationMode ?? collaborationMode(room)) === 'execution' && potentialConflict(sourceMessages)
        return {
          ...proposal,
          conflictWarning,
          decisionSummary: proposalDecisionSummary(room, sourceMessages, this.store.state.users, conflictWarning),
        }
      })
    const runs = Object.values(this.store.state.runs)
      .filter(run => run.roomId === room.id)
      .sort((a, b) => a.startedAt - b.startedAt)
      .slice(-12)
      .map(run => ({
        ...run,
        ...(Array.isArray(run.steps) ? { steps: run.steps.filter(step => !isInternalPermissionBridgeItem(step)) } : {}),
      }))
    let app
    const rawProgress = room.agent.activeRunId ? this.runProgress.get(room.agent.activeRunId) : undefined
    const progress = rawProgress ? {
      ...rawProgress,
      steps: rawProgress.steps?.filter(step => !isInternalPermissionBridgeItem(step)).map(step => {
        if (!step.tool) return step
        const tool = publicTool(step.tool, `/api/rooms/${room.id}/artifacts/${encodeURIComponent(step.tool.callId)}`)
        return tool ? { ...step, tool } : { ...step, tool: undefined }
      }),
    } : undefined
    if (room.app?.relativePath) {
      try {
        const workspace = this.workspace(room.workspaceId)
        const path = resolve(workspace.path, room.app.relativePath)
        if (!containedBy(path, workspace.path)) throw new Error('群应用路径越界')
        const size = statSync(path).size
        if (size <= 0 || size > MAX_APP_HTML_BYTES) throw new Error('群应用文件大小无效')
        app = {
          title: room.app.title || `${room.name} · 群应用`,
          html: injectAppCsp(readFileSync(path, 'utf8')),
          updatedAt: room.app.updatedAt,
        }
      } catch { /* a missing or invalid app stays unavailable without leaking host paths */ }
    }
    return {
      room: publicRoom(room, this.store.state, userId),
      members: room.members,
      users,
      messages,
      proposals,
      runs,
      workspace: { id: room.workspaceId, label: this.workspace(room.workspaceId)?.label ?? '协作沙盒' },
      executionEnabled: this.config.allowHarnessExecution,
      ...(app ? { app } : {}),
      ...(room.agent.pendingQuestion ? {
        pendingQuestion: {
          key: room.agent.pendingQuestion.key,
          questions: room.agent.pendingQuestion.questions,
          canAnswer: hasRole(room, userId, ['owner', 'admin']),
        },
      } : {}),
      ...(progress ? { progress } : {}),
    }
  }

  scheduleProposal(room) {
    if (!room.agent.enabled || ['running', 'question', 'awaiting'].includes(room.agent.state)) return
    if (collaborationMode(room) === 'chat') {
      room.agent.state = 'idle'
      room.agent.silenceUntil = undefined
      return
    }
    const previous = this.timers.get(room.id)
    if (previous) clearTimeout(previous)
    room.agent.state = 'collecting'
    const quietMs = Math.min(Math.max(Number(room.quietSeconds ?? 30), 5), 120) * 1_000
    room.agent.silenceUntil = now() + quietMs
    const timer = setTimeout(() => {
      this.timers.delete(room.id)
      try { this.createProposal(room.id) } catch (cause) { this.logger.error?.('[dsh-collab] proposal failed', cause) }
    }, quietMs)
    this.timers.set(room.id, timer)
  }

  candidateMessages(room) {
    if (collaborationMode(room) === 'chat') return []
    const checkpoint = room.agent.lastCheckpointAt ?? 0
    const mode = collaborationMode(room)
    return this.store.state.messages.filter(message => (
      message.roomId === room.id
      && message.kind === 'chat'
      && message.createdAt > checkpoint
      && message.aiEligible
      && room.members[message.userId]?.aiAccess
      && (mode !== 'application' || message.userId === room.ownerId || mentionsAi(message.text))
    ))
  }

  createProposal(roomId) {
    const proposal = this.store.transact(state => {
      const room = state.rooms[roomId]
      if (!room?.agent.enabled || ['running', 'question'].includes(room.agent.state)) return undefined
      if (collaborationMode(room) === 'chat') {
        room.agent.state = 'idle'
        room.agent.silenceUntil = undefined
        return undefined
      }
      const messages = this.candidateMessages(room)
      if (messages.length === 0) {
        room.agent.state = 'idle'
        room.agent.silenceUntil = undefined
        return undefined
      }
      const mode = collaborationMode(room)
      const pendingChatIds = new Set(Array.isArray(room.pendingChatMessageIds) ? room.pendingChatMessageIds : [])
      const chatContextMessages = state.messages.filter(message => (
        pendingChatIds.has(message.id)
        && message.roomId === room.id
        && message.kind === 'chat'
        && message.aiEligible
        && room.members[message.userId]?.aiAccess
      ))
      const ownerMessages = mode === 'application' ? messages.filter(message => message.userId === room.ownerId) : []
      const sourceMessages = mode === 'application' && ownerMessages.length > 0 ? ownerMessages : messages
      const applicationAction = mode === 'application' && ownerMessages.length > 0 ? 'build' : 'feedback'
      const conflictWarning = mode === 'execution' && potentialConflict(sourceMessages)
      const allVoters = Object.entries(room.members)
        .filter(([, member]) => member.aiAccess && member.role !== 'observer')
        .map(([userId]) => userId)
      if (allVoters.length === 0) throw new Error('当前没有具备 AI 执行权的成员')
      const approvalMode = mode === 'execution'
        ? conflictWarning ? 'unanimous' : (room.approvalMode ?? 'unanimous')
        : 'auto'
      const voters = approvalMode === 'auto'
        ? []
        : approvalMode === 'admin'
          ? allVoters.filter(userId => ['owner', 'admin'].includes(room.members[userId]?.role))
          : allVoters
      const id = makeId('prp')
      const row = {
        id,
        roomId,
        version: (room.agent.proposalVersion ?? 0) + 1,
        status: 'awaiting',
        prompt: buildPrompt(room, sourceMessages, state.users, id, applicationAction, chatContextMessages, files => this.filesPromptContext(files)),
        sourceMessageIds: sourceMessages.map(message => message.id),
        ...(chatContextMessages.length > 0 ? { chatContextMessageIds: chatContextMessages.map(message => message.id) } : {}),
        eligibleVoterIds: voters,
        confirmations: {},
        rejections: {},
        conflictWarning,
        decisionSummary: proposalDecisionSummary(room, sourceMessages, state.users, conflictWarning),
        approvalMode,
        collaborationMode: mode,
        permission: mode === 'execution' || (mode === 'application' && applicationAction === 'build') ? 'workspace-write' : 'read-only',
        ...(mode === 'application' ? { applicationAction } : {}),
        createdAt: now(),
      }
      state.proposals[id] = row
      room.agent.proposalVersion = row.version
      room.agent.activeProposalId = id
      room.agent.state = 'awaiting'
      room.agent.silenceUntil = undefined
      room.pendingChatMessageIds = undefined
      return row
    })
    this.emit(roomId, 'proposal')
    if (proposal?.eligibleVoterIds.length === 0) this.maybeExecute(roomId, proposal.id)
    return proposal
  }

  maybeExecute(roomId, proposalId) {
    const proposal = this.store.state.proposals[proposalId]
    if (!proposal || proposal.status !== 'awaiting') return
    if (!proposal.eligibleVoterIds.every(userId => proposal.confirmations[userId])) return
    const run = this.store.transact(state => {
      const room = state.rooms[roomId]
      const current = state.proposals[proposalId]
      current.status = 'approved'
      const id = makeId('run')
      const row = { id, roomId, proposalId, status: 'running', startedAt: now() }
      state.runs[id] = row
      room.agent.state = 'running'
      room.agent.activeRunId = id
      return row
    })
    this.emit(roomId, 'run')
    void this.executeRun(run.id)
  }

  async executeRun(runId) {
    const run = this.store.state.runs[runId]
    const room = this.store.state.rooms[run.roomId]
    const proposal = this.store.state.proposals[run.proposalId]
    const workspace = this.workspace(room.workspaceId)
    try {
      const result = await this.bridge.execute({
        room,
        workspacePath: workspace.path,
        prompt: proposal.prompt,
        images: this.promptImages(proposal.sourceMessageIds.map(id => this.store.state.messages.find(message => message.id === id)).filter(Boolean)),
        permission: proposal.permission,
        onProgress: progress => {
          if (this.store.state.runs[runId]?.status === 'cancelled') return
          this.runProgress.set(runId, { runId, ...progress })
          this.emit(room.id, 'progress')
        },
        onQuestion: pending => {
          const questions = publicQuestions(pending.questions)
          if (questions.length === 0) return
          this.store.transact(state => {
            const currentRoom = state.rooms[run.roomId]
            if (currentRoom?.agent.activeRunId !== runId) return
            currentRoom.agent.state = 'question'
            currentRoom.agent.pendingQuestion = {
              key: makeId('qst'),
              rpcId: pending.key,
              sessionId: pending.sessionId,
              runId,
              questions,
              createdAt: now(),
            }
          })
          this.emit(room.id, 'question')
        },
        onQuestionResolved: resolved => {
          this.store.transact(state => {
            const currentRoom = state.rooms[run.roomId]
            if ((currentRoom?.agent.pendingQuestion?.rpcId ?? currentRoom?.agent.pendingQuestion?.key) !== resolved.key) return
            currentRoom.agent.pendingQuestion = undefined
            if (currentRoom.agent.activeRunId === runId) currentRoom.agent.state = 'running'
          })
          this.emit(room.id, 'question')
        },
      })
      if (this.store.state.runs[runId]?.status === 'cancelled') {
        this.runProgress.delete(runId)
        this.emit(room.id, 'run')
        return
      }
      let app
      if (proposal.collaborationMode === 'application' && proposal.applicationAction === 'build') {
        const relativePath = roomAppRelativePath(room)
        const path = resolve(workspace.path, relativePath)
        try {
          if (!containedBy(path, workspace.path)) throw new Error('群应用路径越界')
          const size = statSync(path).size
          if (size <= 0 || size > MAX_APP_HTML_BYTES) throw new Error('群应用文件大小无效')
          const html = readFileSync(path, 'utf8')
          if (!/<(?:html|body|script|style|canvas|div)\b/iu.test(html)) throw new Error('群应用不是有效 HTML')
          app = { relativePath, title: `${room.name} · 群应用`, updatedAt: now() }
        } catch { /* the Agent response still returns even if no valid app artifact was produced */ }
      }
      this.store.transact(state => {
        const currentRun = state.runs[runId]
        const currentRoom = state.rooms[run.roomId]
        currentRun.status = 'completed'
        currentRun.finishedAt = now()
        currentRun.output = result.text
        currentRun.reasoning = result.reasoning
        currentRun.statuses = result.statuses
        currentRun.steps = result.steps
        currentRun.timelineComplete = true
        currentRun.dryRun = Boolean(result.dryRun)
        currentRun.harnessSessionId = result.sessionId
        const source = proposal.sourceMessageIds.map(id => state.messages.find(message => message.id === id)).filter(Boolean)
        currentRoom.agent.lastCheckpointAt = Math.max(currentRoom.agent.lastCheckpointAt ?? 0, ...source.map(message => message.createdAt))
        currentRoom.agent.state = 'idle'
        currentRoom.agent.activeProposalId = undefined
        currentRoom.agent.activeRunId = undefined
        currentRoom.agent.pendingQuestion = undefined
        if (app) currentRoom.app = app
        if (!String(result.text).includes(SILENT_REPLY_MARKER)) {
          const visibleSteps = Array.isArray(result.steps)
            ? result.steps.filter(step => step?.kind === 'status' || (step?.kind === 'tool' && step?.tool) || ((step?.text || step?.reasoning) && !String(step?.text ?? '').includes(SILENT_REPLY_MARKER)))
            : []
          if (visibleSteps.length > 0) {
            const createdAt = now()
            for (const [index, step] of visibleSteps.entries()) {
              state.messages.push({
                id: makeId('msg'), roomId: room.id,
                kind: step.kind === 'status' ? 'agent-status' : step.kind === 'tool' ? 'agent-tool' : 'agent', userId: null,
                text: String(step.text ?? ''),
                ...(step.reasoning ? { reasoning: String(step.reasoning) } : {}),
                ...(step.tool ? { tool: step.tool } : {}),
                aiEligible: false, createdAt: createdAt + index, runId,
              })
            }
          } else {
            state.messages.push({
              id: makeId('msg'), roomId: room.id, kind: 'agent', userId: null,
              text: result.text, reasoning: result.reasoning,
              progressStatuses: result.statuses,
              aiEligible: false, createdAt: now(), runId,
            })
          }
        }
        if (app) state.messages.push({
          id: makeId('msg'), roomId: room.id, kind: 'system', userId: null,
          text: '群应用已更新，所有成员都可以从会话模式栏打开。', aiEligible: false, createdAt: now(), runId,
        })
      })
    } catch (cause) {
      if (this.store.state.runs[runId]?.status === 'cancelled') {
        this.runProgress.delete(runId)
        this.emit(room.id, 'run')
        return
      }
      this.store.transact(state => {
        const currentRun = state.runs[runId]
        const currentRoom = state.rooms[run.roomId]
        currentRun.status = 'error'
        currentRun.finishedAt = now()
        currentRun.error = cause instanceof Error ? cause.message : String(cause)
        currentRoom.agent.state = 'error'
        currentRoom.agent.activeRunId = undefined
        currentRoom.agent.pendingQuestion = undefined
        state.messages.push({
          id: makeId('msg'), roomId: room.id, kind: 'agent', userId: null,
          text: `执行失败：${currentRun.error}`, aiEligible: false, createdAt: now(), runId,
        })
      })
    }
    this.runProgress.delete(runId)
    this.emit(room.id, 'run')
    if (room.agent.enabled && this.candidateMessages(room).length > 0) {
      this.store.transact(() => this.scheduleProposal(room))
      this.emit(room.id, 'state')
    }
  }

  async recoverMissingRunTimelines() {
    if (!this.config.allowHarnessExecution) return
    const candidates = Object.values(this.store.state.runs)
      .filter(run => run.status === 'completed' && run.harnessSessionId && run.timelineComplete !== true)
      .sort((left, right) => Number(left.finishedAt ?? left.startedAt ?? 0) - Number(right.finishedAt ?? right.startedAt ?? 0))
    for (const candidate of candidates) {
      const proposal = this.store.state.proposals[candidate.proposalId]
      if (!proposal) continue
      try {
        const history = await this.bridge.rpc('session.history', { sessionId: candidate.harnessSessionId, maxMessages: 200 })
        const entries = Array.isArray(history?.events) ? history.events : []
        const promptEntry = entries.find(entry => {
          const event = entry?.event
          return event?.type === 'user/message'
            && this.bridge.contentText(event.data?.content).includes(proposal.id)
        })
        const promptSeq = Number(promptEntry?.event?.seq ?? -1)
        if (promptSeq < 0) continue
        const nextPrompt = entries.find(entry => {
          const event = entry?.event
          return Number(event?.seq ?? -1) > promptSeq && event?.type === 'user/message'
        })
        const endSeq = Number(nextPrompt?.event?.seq ?? Number.POSITIVE_INFINITY)
        const timeline = this.bridge.historyMessages({
          events: entries.filter(entry => {
            const seq = Number(entry?.event?.seq ?? -1)
            return seq > promptSeq && seq < endSeq
          }),
        }).filter(message => (
          (message.role === 'assistant' || message.role === 'status' || message.role === 'tool')
          && (message.text || message.reasoning || message.tool)
          && !String(message.text ?? '').includes(SILENT_REPLY_MARKER)
        )).slice(-160)
        if (timeline.length === 0) continue
        const recovered = this.store.transact(state => {
          const run = state.runs[candidate.id]
          if (!run || run.status !== 'completed' || run.timelineComplete === true) return 0
          const steps = timeline.map(message => ({
            id: message.id,
            kind: message.role === 'status' ? 'status' : message.role === 'tool' ? 'tool' : 'assistant',
            text: String(message.text ?? ''),
            ...(message.reasoning ? { reasoning: String(message.reasoning) } : {}),
            ...(message.tool ? { tool: message.tool } : {}),
            ...(message.role === 'assistant' ? { pending: false } : {}),
          }))
          run.steps = steps
          run.timelineComplete = true
          run.statuses = steps.filter(step => step.kind === 'status').map(step => step.text)
          const assistantSteps = steps.filter(step => step.kind === 'assistant')
          if (assistantSteps.length > 0) {
            run.output = assistantSteps.at(-1).text || run.output
            run.reasoning = assistantSteps.map(step => step.reasoning ?? '').filter(Boolean).join('\n')
          }
          let insertionIndex = state.messages.findIndex(message => message.runId === run.id && ['agent', 'agent-status', 'agent-tool'].includes(message.kind))
          if (insertionIndex < 0) insertionIndex = state.messages.length
          const existing = state.messages.filter(message => message.runId === run.id && ['agent', 'agent-status', 'agent-tool'].includes(message.kind))
          const createdAt = Number(existing[0]?.createdAt ?? run.finishedAt ?? now())
          state.messages = state.messages.filter(message => !(message.runId === run.id && ['agent', 'agent-status', 'agent-tool'].includes(message.kind)))
          state.messages.splice(Math.min(insertionIndex, state.messages.length), 0, ...steps.map((step, index) => ({
            id: makeId('msg'), roomId: run.roomId,
            kind: step.kind === 'status' ? 'agent-status' : step.kind === 'tool' ? 'agent-tool' : 'agent', userId: null,
            text: step.text,
            ...(step.reasoning ? { reasoning: step.reasoning } : {}),
            ...(step.tool ? { tool: step.tool } : {}),
            aiEligible: false, createdAt: createdAt + index, runId: run.id,
          })))
          return steps.length
        })
        if (recovered > 0) {
          this.logger.log?.(`[dsh-collab] 已从 Harness 历史补回群聊运行时间线：${recovered} 项`)
          this.emit(candidate.roomId, 'run')
        }
      } catch (cause) {
        this.logger.warn?.('[dsh-collab] 群聊运行时间线补回失败，保留原有最终回复', cause)
      }
    }
  }

  async start() {
    await this.recoverInterruptedExecutions()
    await this.normalizeCollaborationSessionTitles()
    await new Promise((resolve, reject) => {
      this.server.once('error', reject)
      this.server.listen(this.config.port, this.config.host, () => {
        this.server.off('error', reject)
        resolve()
      })
    })
    const address = this.server.address()
    const port = typeof address === 'object' && address ? address.port : this.config.port
    this.logger.log?.(`[dsh-collab] 办公室协作入口已启动：本机 http://127.0.0.1:${port}`)
    for (const url of localAddresses(port)) this.logger.log?.(`[dsh-collab] 局域网入口：${url}`)
    if (this.bootstrapToken) {
      this.logger.log?.(`[dsh-collab] 首次管理员设置（仅本机打开）：http://127.0.0.1:${port}/?setup=${this.bootstrapToken}`)
    }
    this.logger.log?.(`[dsh-collab] Harness 执行桥：${this.config.allowHarnessExecution ? '已启用（仅白名单沙盒）' : '未启用（仅协商演示）'}`)
    this.timelineRecoveryTimer = setTimeout(() => {
      this.timelineRecoveryTimer = undefined
      void this.recoverMissingRunTimelines()
    }, 1_500)
    return port
  }

  /**
   * Loopback URL for the Desktop group-chat window.
   * @returns first-run setup URL when no host owner exists yet.
   */
  entryUrl() {
    const port = this.config.port
    return this.bootstrapToken === undefined
      ? `http://127.0.0.1:${port}/`
      : `http://127.0.0.1:${port}/?setup=${this.bootstrapToken}`
  }

  /**
   * Live listen state for the settings launch button.
   * @returns whether 3191 is accepting connections and the loopback URL.
   */
  entryView() {
    return {
      running: this.server.listening === true,
      url: this.entryUrl(),
      firstSetup: this.bootstrapToken !== undefined,
    }
  }

  async recoverInterruptedExecutions() {
    const sessionIds = new Set()
    let recoveredRooms = 0
    let recoveredConversations = 0
    this.store.transact(state => {
      for (const run of Object.values(state.runs)) {
        if (run.status !== 'running') continue
        const room = state.rooms[run.roomId]
        run.status = 'cancelled'
        run.finishedAt = now()
        run.error = '服务重启后已结束上一轮中断的执行'
        if (run.harnessSessionId) sessionIds.add(run.harnessSessionId)
        if (!room) continue
        if (room.harnessSessionId) sessionIds.add(room.harnessSessionId)
        const proposal = state.proposals[run.proposalId]
        if (proposal && proposal.status !== 'completed') proposal.status = 'cancelled'
        const source = (proposal?.sourceMessageIds ?? []).map(id => state.messages.find(message => message.id === id)).filter(Boolean)
        room.agent.lastCheckpointAt = Math.max(room.agent.lastCheckpointAt ?? 0, ...source.map(message => message.createdAt))
        room.agent.state = room.agent.enabled ? 'idle' : 'off'
        room.agent.activeRunId = undefined
        room.agent.activeProposalId = undefined
        room.agent.pendingQuestion = undefined
        room.agent.silenceUntil = undefined
        state.messages.push({
          id: makeId('msg'), roomId: room.id, kind: 'system', userId: null,
          text: '上一轮中断的 AI 执行已自动结束，可以继续发送新消息。', aiEligible: false, createdAt: now(), runId: run.id,
        })
        recoveredRooms += 1
      }
      for (const conversation of Object.values(state.conversations)) {
        if (!conversation.running) continue
        if (conversation.harnessSessionId) sessionIds.add(conversation.harnessSessionId)
        conversation.running = false
        conversation.pendingQuestion = undefined
        conversation.updatedAt = now()
        delete conversation.activeRunToken
        recoveredConversations += 1
      }
    })
    if (this.config.allowHarnessExecution) {
      await Promise.allSettled([...sessionIds].map(sessionId => this.bridge.cancelSession(sessionId)))
    }
    if (recoveredRooms || recoveredConversations) {
      this.logger.log?.(`[dsh-collab] 已回收中断执行：${recoveredRooms} 个群聊，${recoveredConversations} 个私人会话`)
    }
  }

  async stop() {
    if (this.timelineRecoveryTimer) clearTimeout(this.timelineRecoveryTimer)
    this.timelineRecoveryTimer = undefined
    for (const timer of this.timers.values()) clearTimeout(timer)
    this.timers.clear()
    for (const timer of this.presenceTimers.values()) clearTimeout(timer)
    this.presenceTimers.clear()
    this.presence.clear()
    for (const clients of this.sse.values()) for (const res of clients) res.end()
    this.sse.clear()
    await new Promise(resolve => this.server.close(() => resolve()))
  }

  async handle(req, res) {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`)
    const method = req.method ?? 'GET'
    const origin = String(req.headers.origin ?? '')
    const localUiOrigin = origin === 'http://127.0.0.1:19387' || origin === 'http://localhost:19387' || origin.startsWith('dsh-app://')
    res.setHeader('x-content-type-options', 'nosniff')
    res.setHeader('referrer-policy', 'no-referrer')
    res.setHeader('x-frame-options', 'DENY')
    res.setHeader('content-security-policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; connect-src 'self'; frame-src 'self' http: https: blob:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'")

    if (localUiOrigin && url.pathname === '/api/local-ui-sync') {
      res.setHeader('access-control-allow-origin', origin)
      res.setHeader('access-control-allow-methods', 'POST, OPTIONS')
      res.setHeader('access-control-allow-headers', 'content-type, x-dsh-ui-sync')
      res.setHeader('access-control-max-age', '600')
      res.setHeader('vary', 'Origin')
    }

    if (method === 'OPTIONS' && url.pathname === '/api/local-ui-sync') {
      if (!localUiOrigin || !isLoopback(req.socket.remoteAddress)) return error(res, 403, '仅允许本机界面同步')
      res.writeHead(204)
      res.end()
      return
    }

    if (method === 'POST' && url.pathname === '/api/local-ui-sync') {
      if (!localUiOrigin || !isLoopback(req.socket.remoteAddress) || req.headers['x-dsh-ui-sync'] !== 'v1') {
        return error(res, 403, '仅允许本机 Desktop 界面同步')
      }
      const owner = Object.values(this.store.state.users).find(user => user.serverRole === 'host-owner')
      if (!owner) return error(res, 409, '请先完成宿主账号初始化')
      const body = await readJson(req, 12 * 1024 * 1024)
      const userAvatar = sanitizeAvatarView(body.userAvatar)
      const hasUserProfile = body.userProfile && typeof body.userProfile === 'object'
      const hasPinnedNote = typeof body.pinnedNote === 'string'
      const sessionAvatars = body.sessionAvatars && typeof body.sessionAvatars === 'object' ? body.sessionAvatars : {}
      const subtitles = body.subtitles && typeof body.subtitles === 'object' ? body.subtitles : {}
      const safeStringList = value => Array.isArray(value) ? value.filter(item => typeof item === 'string').slice(0, 80) : []
      let syncedConversations = 0
      this.store.transact(state => {
        if (userAvatar) owner.avatarView = userAvatar
        owner.uiProfile = {
          ...(owner.uiProfile ?? {}),
          ...(userAvatar ? { userAvatar } : {}),
          ...(hasUserProfile ? { profile: {
            name: String(body.userProfile?.name ?? '').trim().slice(0, 28),
            signature: String(body.userProfile?.signature ?? '').trim().slice(0, 64),
          } } : {}),
          ...(hasPinnedNote ? { pinnedNote: body.pinnedNote.slice(0, 160) } : {}),
          ...(Array.isArray(body.hiddenRailIds) ? { hiddenRailIds: safeStringList(body.hiddenRailIds) } : {}),
          ...(Array.isArray(body.railOrder) ? { railOrder: safeStringList(body.railOrder) } : {}),
          ...(Array.isArray(body.pinnedSessionIds) ? { pinnedSessionIds: safeStringList(body.pinnedSessionIds) } : {}),
          ...(body.sessionView === 'recent' || body.sessionView === 'workspace' ? { sessionView: body.sessionView } : {}),
          syncedAt: now(),
        }
        for (const conversation of Object.values(state.conversations)) {
          if (conversation.ownerId !== owner.id || !conversation.harnessSessionId) continue
          const avatar = sanitizeAvatarView(sessionAvatars[conversation.harnessSessionId])
          const subtitle = typeof subtitles[conversation.harnessSessionId] === 'string' ? subtitles[conversation.harnessSessionId].trim().slice(0, 120) : ''
          if (avatar) conversation.avatarView = avatar
          if (subtitle) conversation.subtitle = subtitle
          if (avatar || subtitle) syncedConversations += 1
        }
      })
      json(res, 200, { ok: true, syncedConversations })
      return
    }

    if (method === 'GET' && STATIC[url.pathname]) {
      const [file, contentType] = STATIC[url.pathname]
      res.writeHead(200, { 'content-type': contentType, 'cache-control': 'no-store' })
      res.end(readFileSync(join(PUBLIC_DIR, file)))
      return
    }

    if (method === 'GET' && url.pathname === '/api/bootstrap') {
      const auth = this.auth(req)
      if (auth) this.setPresence(auth.user.id, `bootstrap_${sha256(auth.session.csrf).slice(0, 24)}`, true, INITIAL_PRESENCE_TTL_MS)
      if (auth) await this.syncHostConversations(auth.user)
      const rooms = auth ? Object.values(this.store.state.rooms)
        .filter(room => !room.closedAt && room.members[auth.user.id])
        .map(room => publicRoom(room, this.store.state, auth.user.id)) : []
      json(res, 200, {
        ok: true,
        setupRequired: !this.store.hasUsers(),
        setupTokenAccepted: Boolean(this.bootstrapToken && url.searchParams.get('setup') === this.bootstrapToken),
        user: auth ? this.store.publicUser(auth.user, true) : null,
        ui: auth?.user?.uiProfile ?? {},
        csrf: auth?.session.csrf,
        rooms,
        conversations: auth ? this.conversationsFor(auth.user) : [],
        workspaces: this.config.allowedWorkspaces.map(({ id, label }) => ({ id, label })),
        executionEnabled: this.config.allowHarnessExecution,
        clientVersion: UI_BUILD_VERSION,
      })
      return
    }

    if (method === 'POST' && url.pathname === '/api/setup') {
      this.assertMutation(req)
      this.checkRate(`setup:${req.socket.remoteAddress}`, 8)
      if (this.store.hasUsers()) return error(res, 409, '管理员已经设置')
      const body = await readJson(req)
      if (!this.bootstrapToken || body.token !== this.bootstrapToken) return error(res, 403, '首次设置令牌无效')
      const result = this.store.transact(() => {
        const user = this.store.createUser({ ...body, serverRole: 'host-owner' })
        const session = this.store.createSession(user.id)
        return { user, ...session }
      })
      this.bootstrapToken = undefined
      this.setPresence(result.user.id, `login_${sha256(result.session.csrf).slice(0, 24)}`, true, INITIAL_PRESENCE_TTL_MS)
      json(res, 200, { ok: true, user: this.store.publicUser(result.user, true), csrf: result.session.csrf }, { 'set-cookie': cookie(result.token) })
      return
    }

    if (method === 'POST' && url.pathname === '/api/login') {
      this.assertMutation(req)
      this.checkRate(`login:${req.socket.remoteAddress}`, 12)
      const body = await readJson(req)
      const handle = normalizeUsername(body.username)
      const user = Object.values(this.store.state.users).find(candidate => candidate.username === handle)
      if (!user || !verifyPassword(body.password, user.password)) return error(res, 401, '账号或密码错误')
      if (user.disabledAt) return error(res, 403, '测试账号已被宿主停用')
      const inviteCode = String(body.inviteCode ?? '').trim()
      let invite
      let invitedRoom
      if (inviteCode) {
        invite = this.store.state.invites[sha256(inviteCode)]
        if (!invite || invite.expiresAt <= now() || invite.remainingUses <= 0) return error(res, 403, '邀请码无效或已过期')
        invitedRoom = this.store.state.rooms[invite.roomId]
        if (!invitedRoom || invitedRoom.closedAt) return error(res, 403, '群聊已关闭')
        if (invitedRoom.password && !verifyPassword(body.roomPassword, invitedRoom.password)) return error(res, 403, '群聊密码错误')
      }
      const result = this.store.transact(state => {
        let roomId
        if (invite && invitedRoom) {
          const room = state.rooms[invite.roomId]
          if (!room.members[user.id]) {
            room.members[user.id] = { role: 'member', aiAccess: Boolean(room.defaultAiAccess), joinedAt: now(), lastReadAt: 0 }
            invite.remainingUses -= 1
          }
          roomId = room.id
        }
        const session = this.store.createSession(user.id)
        return { ...session, roomId }
      })
      this.setPresence(user.id, `login_${sha256(result.session.csrf).slice(0, 24)}`, true, INITIAL_PRESENCE_TTL_MS)
      if (result.roomId) this.emit(result.roomId, 'members')
      json(res, 200, { ok: true, user: this.store.publicUser(user, true), csrf: result.session.csrf, roomId: result.roomId }, { 'set-cookie': cookie(result.token) })
      return
    }

    if (method === 'POST' && url.pathname === '/api/register') {
      return error(res, 403, '账号由宿主最高管理员统一发放，请向管理员索取账号和初始密码')
      return
    }

    const auth = this.requireAuth(req, res)
    if (!auth) return

    if (method === 'POST' && url.pathname === '/api/presence') {
      this.assertMutation(req, auth)
      const body = await readJson(req)
      const clientId = String(body.clientId ?? '').trim()
      if (!/^[a-zA-Z0-9_-]{8,80}$/u.test(clientId)) return error(res, 400, '页面标识无效')
      const online = this.setPresence(auth.user.id, clientId, body.active !== false)
      json(res, 200, { ok: true, online })
      return
    }

    if (method === 'GET' && url.pathname === '/api/diy-skills') {
      const cwd = url.searchParams.get('cwd') ?? undefined
      const skills = await listInstalledSkills(cwd === undefined || cwd.trim() === '' ? {} : { cwd: cwd.trim() })
      json(res, 200, { ok: true, skills })
      return
    }

    if (method === 'POST' && url.pathname === '/api/diy-skills') {
      this.assertMutation(req, auth)
      const body = await readJson(req)
      try {
        const skill = await installSkillFromSource(String(body.source ?? body.markdown ?? ''))
        json(res, 200, { ok: true, skill })
      } catch (cause) {
        error(res, 400, cause instanceof Error ? cause.message : '技能安装失败')
      }
      return
    }

    if (method === 'GET' && url.pathname === '/api/services') {
      const access = this.serviceAccess(auth.user)
      const all = this.serviceManager?.list?.() ?? []
      const services = all
        .filter(service => access.visible === undefined || (service.sessionId !== undefined && access.visible.has(service.sessionId)))
        .map(service => ({
          ...service,
          canStop: access.stoppable === undefined || (service.sessionId !== undefined && access.stoppable.has(service.sessionId)),
        }))
      json(res, 200, { ok: true, services })
      return
    }

    const stopServiceMatch = /^\/api\/services\/([^/]+)\/stop$/u.exec(url.pathname)
    if (method === 'POST' && stopServiceMatch) {
      this.assertMutation(req, auth)
      if (!this.serviceManager) return error(res, 503, '宿主服务管理尚未接入')
      const access = this.serviceAccess(auth.user)
      try {
        const service = this.serviceManager.stop(decodeURIComponent(stopServiceMatch[1]), access.stoppable)
        json(res, 200, { ok: true, service })
      } catch (cause) {
        error(res, 409, cause instanceof Error ? cause.message : '服务关闭失败')
      }
      return
    }

    if (method === 'POST' && url.pathname === '/api/logout') {
      this.assertMutation(req, auth)
      const token = parseCookies(req.headers.cookie)[SESSION_COOKIE]
      this.store.transact(state => { delete state.sessions[sha256(token)] })
      json(res, 200, { ok: true }, { 'set-cookie': cookie('', 0) })
      return
    }

    if (url.pathname === '/api/model-access') {
      const canConfigure = this.isHostOwner(auth.user) && isLoopback(req.socket.remoteAddress)
      if (method === 'GET') {
        let status
        try { status = await this.bridge.credentialStatus() } catch (cause) {
          return error(res, 502, cause instanceof Error ? cause.message : '模型通道状态读取失败')
        }
        json(res, 200, { ok: true, access: { ...status, canConfigure, providerLabel: 'DeepSeek' } })
        return
      }
      if (method === 'POST') {
        this.assertMutation(req, auth)
        if (!canConfigure) return error(res, 403, 'API Key 只能由宿主最高管理员在本机配置')
        this.checkRate(`${auth.user.id}:model-access`, 8)
        const body = await readJson(req)
        const apiKey = String(body.apiKey ?? '').trim()
        if (apiKey.length < 16 || apiKey.length > 512) return error(res, 400, '请输入有效的 DeepSeek API Key')
        let status
        try { status = await this.bridge.setCredential(apiKey) } catch (cause) {
          return error(res, 502, cause instanceof Error ? cause.message : 'DeepSeek Key 保存失败')
        }
        this.store.transact(state => { audit(state, auth.user.id, 'update-model-credential', auth.user.id, { provider: 'DeepSeek' }) })
        json(res, 200, { ok: true, access: { ...status, canConfigure: true, providerLabel: 'DeepSeek' } })
        return
      }
      return error(res, 405, '不支持的请求方式')
    }

    if (method === 'GET' && url.pathname === '/api/admin/users') {
      if (!this.isHostOwner(auth.user)) return error(res, 403, '只有宿主最高管理员可以管理测试账号')
      const users = Object.values(this.store.state.users)
        .sort((left, right) => Number(left.createdAt ?? 0) - Number(right.createdAt ?? 0))
        .map(user => ({
          ...this.store.publicUser(user, true),
          conversationCount: Object.values(this.store.state.conversations).filter(row => row.ownerId === user.id && !row.deletedAt).length,
          roomCount: Object.values(this.store.state.rooms).filter(room => !room.closedAt && room.members[user.id]).length,
        }))
      json(res, 200, { ok: true, users })
      return
    }

    if (method === 'POST' && url.pathname === '/api/admin/users') {
      this.assertMutation(req, auth)
      if (!this.isHostOwner(auth.user)) return error(res, 403, '只有宿主最高管理员可以发放测试账号')
      const body = await readJson(req, 2_200_000)
      let user
      try {
        user = this.store.transact(state => {
          const created = this.store.createUser({ ...body, serverRole: 'user' })
          const avatarView = sanitizeAvatarView(body.avatarView)
          if (avatarView) {
            created.avatar = avatarView.glyph === 'image' ? 'robot' : avatarView.glyph
            created.color = avatarView.color
            created.avatarView = avatarView
          }
          audit(state, auth.user.id, 'issue-test-account', created.id, { username: created.username })
          return created
        })
      } catch (cause) {
        return error(res, 400, cause instanceof Error ? cause.message : '测试账号创建失败')
      }
      json(res, 200, { ok: true, user: this.store.publicUser(user, true) })
      return
    }

    const adminUserMatch = /^\/api\/admin\/users\/([^/]+)(?:\/(reset-password|export))?$/.exec(url.pathname)
    if (adminUserMatch) {
      if (!this.isHostOwner(auth.user)) return error(res, 403, '只有宿主最高管理员可以管理测试账号')
      const target = this.store.state.users[adminUserMatch[1]]
      const action = adminUserMatch[2] ?? ''
      if (!target) return error(res, 404, '测试账号不存在')
      if (target.serverRole === 'host-owner' && (method !== 'GET' || action !== 'export')) return error(res, 403, '最高管理员账号不可停用或重置')

      if (method === 'PATCH' && action === '') {
        this.assertMutation(req, auth)
        const body = await readJson(req)
        this.store.transact(state => {
          if (body.disabled) {
            target.disabledAt = now()
            for (const [key, session] of Object.entries(state.sessions)) if (session.userId === target.id) delete state.sessions[key]
          } else {
            delete target.disabledAt
          }
          audit(state, auth.user.id, body.disabled ? 'disable-test-account' : 'enable-test-account', target.id)
        })
        json(res, 200, { ok: true, user: this.store.publicUser(target, true) })
        return
      }

      if (method === 'POST' && action === 'reset-password') {
        this.assertMutation(req, auth)
        const body = await readJson(req)
        const password = String(body.password ?? '')
        if (password.length < 8 || password.length > 128) return error(res, 400, '密码至少 8 位，最多 128 位')
        this.store.transact(state => {
          target.password = hashPassword(password)
          for (const [key, session] of Object.entries(state.sessions)) if (session.userId === target.id) delete state.sessions[key]
          audit(state, auth.user.id, 'reset-test-password', target.id)
        })
        json(res, 200, { ok: true })
        return
      }

      if (method === 'GET' && action === 'export') {
        const conversations = Object.values(this.store.state.conversations).filter(row => row.ownerId === target.id)
        const histories = await Promise.all(conversations.map(async conversation => {
          try {
            return { conversation: publicConversation(conversation), messages: await this.completeConversationHistory(conversation.harnessSessionId) }
          } catch (cause) {
            return { conversation: publicConversation(conversation), messages: [], readError: cause instanceof Error ? cause.message : String(cause) }
          }
        }))
        const rooms = Object.values(this.store.state.rooms).filter(room => room.members[target.id]).map(room => ({
          room: publicRoom(room, this.store.state, target.id),
          membership: room.members[target.id],
          messages: this.store.state.messages.filter(message => message.roomId === room.id),
          proposals: Object.values(this.store.state.proposals).filter(proposal => proposal.roomId === room.id),
          runs: Object.values(this.store.state.runs).filter(run => run.roomId === room.id),
        }))
        const payload = {
          exportedAt: now(),
          scope: '仅包含这台宿主服务器保存的 Harness 测试数据，不包含测试者电脑上的其他文件或其他应用数据',
          user: this.store.publicUser(target, true),
          conversations: histories,
          rooms,
        }
        this.store.transact(state => { audit(state, auth.user.id, 'export-test-data', target.id, { conversations: histories.length, rooms: rooms.length }) })
        const safeName = target.username.replace(/[^a-z0-9_-]/giu, '_')
        json(res, 200, payload, { 'content-disposition': `attachment; filename="harness-test-${safeName}.json"` })
        return
      }
    }

    if (method === 'PATCH' && url.pathname === '/api/profile') {
      this.assertMutation(req, auth)
      const body = await readJson(req, 2_200_000)
      const hasDisplayName = body.displayName !== undefined
      const displayName = hasDisplayName ? String(body.displayName ?? '').trim() : auth.user.displayName
      if (displayName.length < 1 || displayName.length > 32) return error(res, 400, '显示名称需为 1–32 个字符')
      const hasAvatar = body.avatar !== undefined || body.avatarView !== undefined
      const avatar = body.avatar === undefined ? auth.user.avatar : String(body.avatar)
      if (hasAvatar && !['whale', 'code', 'spark', 'folder', 'robot'].includes(avatar)) return error(res, 400, '请选择有效头像')
      const color = /^#[0-9a-f]{6}$/iu.test(String(body.color ?? '')) ? String(body.color) : auth.user.color
      const avatarView = hasAvatar ? (sanitizeAvatarView(body.avatarView) ?? { glyph: avatar, color }) : auth.user.avatarView
      this.store.transact(() => {
        auth.user.displayName = displayName
        if (hasAvatar) {
          auth.user.avatar = avatar
          auth.user.color = color
          auth.user.avatarView = avatarView
        }
        auth.user.uiProfile = sanitizeUiProfile(body.ui, {
          ...(auth.user.uiProfile ?? {}),
          ...(hasAvatar && avatarView ? { userAvatar: avatarView } : {}),
        })
      })
      for (const room of Object.values(this.store.state.rooms)) {
        if (room.members[auth.user.id]) this.emit(room.id, 'members')
      }
      json(res, 200, { ok: true, user: this.store.publicUser(auth.user, true) })
      return
    }

    if (method === 'POST' && url.pathname === '/api/conversations') {
      this.assertMutation(req, auth)
      const body = await readJson(req)
      if (body.visibility === 'shared') {
        let room
        try { room = this.createRoom(auth.user, body) } catch (cause) { return error(res, 400, cause.message) }
        json(res, 200, { ok: true, kind: 'room', room: publicRoom(room, this.store.state, auth.user.id) })
        return
      }
      const title = String(body.title ?? '').trim().slice(0, 48) || '新会话'
      const subtitle = String(body.subtitle ?? '').trim().slice(0, 80) || '私人会话'
      const selectedWorkspace = this.workspace(body.workspaceId)
      const hostWorkspace = this.isHostOwner(auth.user) ? selectedWorkspace : undefined
      const workspacePath = hostWorkspace
        ? hostWorkspace.path
        : this.privateWorkspace(auth.user.id)
      let harnessSessionId
      try { harnessSessionId = await this.bridge.createSession({ workspacePath, title: this.privateHarnessTitle(auth.user, title) }) } catch (cause) {
        return error(res, 502, cause instanceof Error ? cause.message : 'Harness 会话创建失败')
      }
      const conversation = this.store.transact(state => {
        const id = makeId('cnv')
        const row = {
          id, ownerId: auth.user.id, harnessSessionId, title, subtitle,
          avatar: String(body.avatar ?? 'whale'),
          avatarView: sanitizeAvatarView(body.avatarView),
          workspaceLabel: hostWorkspace?.label ?? '私人沙盒',
          workspaceId: hostWorkspace?.id,
          source: 'account',
          createdAt: now(), updatedAt: now(), promotedRoomIds: [],
        }
        state.conversations[id] = row
        return row
      })
      json(res, 200, { ok: true, kind: 'conversation', conversation: publicConversation(conversation) })
      return
    }

    const conversationMatch = /^\/api\/conversations\/([^/]+)(?:\/(.*))?$/.exec(url.pathname)
    if (conversationMatch) {
      const conversationId = conversationMatch[1]
      const action = conversationMatch[2] ?? ''
      const conversation = this.requireConversation(res, conversationId, auth.user.id)
      if (!conversation) return
      if (method === 'GET' && action.startsWith('artifacts/')) {
        const callId = decodeURIComponent(action.slice('artifacts/'.length))
        let messages
        try { messages = await this.completeConversationHistory(conversation.harnessSessionId) } catch (cause) {
          return error(res, 502, cause instanceof Error ? cause.message : '可视化预览读取失败')
        }
        const meta = toolArtifact(messages.find(message => message.tool?.callId === callId)?.tool)
        if (!meta) return error(res, 404, '可视化预览不存在或已过期')
        artifactResponse(res, meta)
        return
      }
      const conversationFileMatch = /^files\/(file_[a-f0-9]{32})$/u.exec(action)
      if (method === 'GET' && conversationFileMatch) {
        const fileId = conversationFileMatch[1]
        let messages
        try { messages = await this.completeConversationHistory(conversation.harnessSessionId) } catch {
          return error(res, 502, '附件授权记录暂时无法读取')
        }
        const file = messages.flatMap(message => Array.isArray(message.files) ? message.files : []).find(candidate => candidate.id === fileId)
        if (!file) return error(res, 404, '附件不存在或无权查看')
        let bytes
        try { bytes = readFileSync(join(this.attachmentDir, `${fileId}.bin`)) } catch { return error(res, 404, '附件文件已不存在') }
        fileResponse(res, file, bytes)
        return
      }
      if (method === 'GET' && action === '') {
        let messages
        try { messages = await this.completeConversationHistory(conversation.harnessSessionId) } catch (cause) {
          return error(res, 502, cause instanceof Error ? cause.message : '私人会话读取失败')
        }
        messages = messages.map(message => {
          if (!message.tool) return message
          const tool = publicTool(message.tool, `/api/conversations/${conversation.id}/artifacts/${encodeURIComponent(message.tool.callId)}`)
          return tool ? { ...message, tool } : { ...message, tool: undefined }
        })
        if (conversation.sourceRoomId) {
          const shared = this.store.state.messages.filter(message => message.roomId === conversation.sourceRoomId).map(message => ({
            id: message.id,
            role: message.kind === 'agent' ? 'assistant' : 'user',
            text: message.text,
            createdAt: message.createdAt,
          }))
          messages = [...shared, ...messages].sort((left, right) => left.createdAt - right.createdAt)
        }
        json(res, 200, {
          ok: true,
          conversation: publicConversation(conversation),
          messages,
          ...(conversation.pendingQuestion ? {
            pendingQuestion: {
              key: conversation.pendingQuestion.key,
              questions: conversation.pendingQuestion.questions,
              canAnswer: true,
            },
          } : {}),
          ...(this.conversationProgress.has(conversation.id)
            ? { progress: this.conversationProgress.get(conversation.id) }
            : {}),
        })
        return
      }
      if (method === 'GET' && action === 'models') {
        let directory
        try { directory = await this.bridge.sessionModels(conversation.harnessSessionId) } catch (cause) {
          return error(res, 502, cause instanceof Error ? cause.message : '模型目录读取失败')
        }
        json(res, 200, {
          ok: true,
          models: this.bridge.modelOptions(directory),
          current: directory?.current ?? null,
          routable: Boolean(directory?.routable),
        })
        return
      }
      if (method === 'GET' && action === 'download') {
        const workspacePath = this.conversationWorkspace(conversation)
        if (!workspacePath) return error(res, 409, '这个会话没有可安全导出的授权代码工作区')
        const allowedRoot = this.config.allowedWorkspaces.find(workspace => containedBy(workspacePath, workspace.path))?.path
        if (!allowedRoot || !containedBy(workspacePath, allowedRoot)) return error(res, 403, '代码工作区不在服务器授权范围内')
        let archive
        try { archive = codeArchiveFiles(workspacePath) } catch (cause) {
          return error(res, 413, cause instanceof Error ? cause.message : '代码工作区无法打包')
        }
        if (archive.files.length === 0) return error(res, 409, '当前工作区还没有可下载的代码文件')
        const safeName = String(conversation.title || 'workspace').replace(/[^\p{L}\p{N}._-]+/gu, '-').slice(0, 48) || 'workspace'
        this.store.transact(state => {
          audit(state, auth.user.id, 'download-private-workspace', auth.user.id, { conversationId, fileCount: archive.files.length, bytes: archive.bytes })
        })
        const child = spawn('/usr/bin/zip', ['-q', '-', '-@'], { cwd: workspacePath, stdio: ['pipe', 'pipe', 'pipe'] })
        let stderr = ''
        child.stderr.setEncoding('utf8')
        child.stderr.on('data', chunk => { stderr = `${stderr}${chunk}`.slice(-2_000) })
        child.once('error', cause => {
          if (!res.headersSent) error(res, 500, `代码打包启动失败：${cause.message}`)
          else res.destroy(cause)
        })
        res.writeHead(200, {
          'content-type': 'application/zip',
          'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(`${safeName}.zip`)}`,
          'cache-control': 'no-store',
          'x-content-type-options': 'nosniff',
        })
        child.stdout.pipe(res)
        child.stdin.end(`${archive.files.join('\n')}\n`)
        child.once('close', code => {
          if (code !== 0) {
            this.logger.error?.('[dsh-collab] 代码包生成失败', { code, stderr })
            if (!res.destroyed) res.destroy(new Error('代码包生成失败'))
          }
        })
        return
      }
      this.assertMutation(req, auth)
      this.checkRate(`${auth.user.id}:conversation:${action}`)
      if (method === 'PATCH' && action === '') {
        const body = await readJson(req, 2_200_000)
        const avatarView = sanitizeAvatarView(body.avatarView)
        this.store.transact(() => {
          if (typeof body.title === 'string' && body.title.trim()) conversation.title = body.title.trim().slice(0, 48)
          if (typeof body.subtitle === 'string') conversation.subtitle = body.subtitle.trim().slice(0, 120) || '私人会话'
          if (avatarView) conversation.avatarView = avatarView
          conversation.updatedAt = now()
        })
        if (typeof body.title === 'string' && body.title.trim() && typeof this.bridge.renameSession === 'function') {
          try { await this.bridge.renameSession(conversation.harnessSessionId, this.privateHarnessTitle(auth.user, conversation.title)) } catch (cause) {
            this.logger.warn?.('[dsh-collab] 私人会话已改名，但宿主 3080 标题暂未同步', cause)
          }
        }
        json(res, 200, { ok: true, conversation: publicConversation(conversation) })
        return
      }
      if (method === 'POST' && action === 'cancel') {
        const pending = conversation.pendingQuestion
        const wasRunning = Boolean(conversation.running)
        this.store.transact(() => {
          conversation.running = false
          conversation.pendingQuestion = undefined
          conversation.updatedAt = now()
          delete conversation.activeRunToken
        })
        this.conversationProgress.delete(conversation.id)
        if (wasRunning) {
          const requests = [this.bridge.cancelSession(conversation.harnessSessionId)]
          if (pending) requests.push(this.bridge.respondQuestion({
            rpcId: pending.rpcId ?? pending.key,
            sessionId: pending.sessionId,
            answers: [],
            cancel: true,
          }))
          await Promise.allSettled(requests)
        }
        json(res, 200, { ok: true, cancelled: wasRunning })
        return
      }
      if (method === 'POST' && action === 'messages') {
        const body = await readJson(req, ATTACHMENT_BODY_LIMIT)
        const text = String(body.text ?? '').trim()
        if (text.length > MESSAGE_LIMIT) return error(res, 400, `消息文字最多 ${MESSAGE_LIMIT} 个字符`)
        if (conversation.running) return error(res, 409, '当前私人会话仍在执行或等待你的回答')
        let files
        try { files = this.storeMessageFiles(body.files) } catch (cause) {
          return error(res, 400, cause instanceof Error ? cause.message : '文件上传失败')
        }
        if (!text && files.length === 0) return error(res, 400, '请输入消息或至少添加一个文件')
        const prompt = [
          this.filesPromptContext(files),
          '<<<DSH_DIY_USER_MESSAGE>>>',
          text,
        ].filter(Boolean).join('\n')
        const runToken = makeId('crun')
        this.store.transact(() => {
          conversation.running = true
          conversation.activeRunToken = runToken
          conversation.updatedAt = now()
          conversation.pendingQuestion = undefined
        })
        let result
        try {
          result = await this.bridge.executeSession({
            sessionId: conversation.harnessSessionId,
            prompt,
            onProgress: progress => {
              if (conversation.activeRunToken !== runToken) return
              this.conversationProgress.set(conversation.id, { ...progress })
            },
            onQuestion: pending => {
              const questions = publicQuestions(pending.questions)
              if (questions.length === 0) return
              this.store.transact(() => {
                if (conversation.activeRunToken !== runToken) return
                conversation.pendingQuestion = {
                  key: makeId('qst'),
                  rpcId: pending.key,
                  sessionId: pending.sessionId,
                  questions,
                  createdAt: now(),
                }
              })
            },
            onQuestionResolved: resolved => {
              this.store.transact(() => {
                if (conversation.activeRunToken !== runToken) return
                if ((conversation.pendingQuestion?.rpcId ?? conversation.pendingQuestion?.key) === resolved.key) conversation.pendingQuestion = undefined
              })
            },
          })
        } catch (cause) {
          if (conversation.activeRunToken !== runToken) {
            this.conversationProgress.delete(conversation.id)
            json(res, 200, { ok: true, cancelled: true, conversation: publicConversation(conversation) })
            return
          }
          this.store.transact(() => {
            conversation.running = false
            conversation.pendingQuestion = undefined
            conversation.updatedAt = now()
            delete conversation.activeRunToken
          })
          this.conversationProgress.delete(conversation.id)
          return error(res, 502, cause instanceof Error ? cause.message : 'Agent 执行失败')
        }
        if (conversation.activeRunToken !== runToken) {
          this.conversationProgress.delete(conversation.id)
          json(res, 200, { ok: true, cancelled: true, conversation: publicConversation(conversation) })
          return
        }
        this.store.transact(() => {
          conversation.running = false
          conversation.pendingQuestion = undefined
          conversation.updatedAt = now()
          delete conversation.activeRunToken
        })
        this.conversationProgress.delete(conversation.id)
        json(res, 200, { ok: true, answer: result.text, conversation: publicConversation(conversation) })
        return
      }
      const privateQuestionMatch = /^questions\/([^/]+)\/answer$/.exec(action)
      if (method === 'POST' && privateQuestionMatch) {
        const key = privateQuestionMatch[1]
        const pending = conversation.pendingQuestion
        if (!pending || pending.key !== key || !conversation.running) return error(res, 404, '这条私人会话追问已结束或不存在')
        const body = await readJson(req)
        const cancel = body.cancel === true
        const answers = Array.isArray(body.answers) ? body.answers.slice(0, 3).map(answer => ({
          id: String(answer?.id ?? '').slice(0, 120),
          selected: Array.isArray(answer?.selected) ? answer.selected.slice(0, 10).map(value => String(value).slice(0, 160)) : [],
          ...(typeof answer?.custom === 'string' && answer.custom.trim() !== '' ? { custom: answer.custom.trim().slice(0, 4_000) } : {}),
        })) : []
        if (!cancel && answers.length !== pending.questions.length) return error(res, 400, '请完整回答本轮 Agent 追问')
        try {
          await this.bridge.respondQuestion({ rpcId: pending.rpcId ?? pending.key, sessionId: pending.sessionId, answers, cancel })
        } catch (cause) {
          return error(res, 409, cause instanceof Error ? cause.message : 'Agent 追问回答失败')
        }
        this.store.transact(() => {
          if (conversation.pendingQuestion?.key === key) conversation.pendingQuestion = undefined
        })
        json(res, 200, { ok: true })
        return
      }
      if (method === 'POST' && action === 'model') {
        const body = await readJson(req)
        const provider = String(body.provider ?? '').trim()
        const model = String(body.model ?? '').trim()
        const reasoningEffort = String(body.reasoningEffort ?? '').trim()
        if (!provider || !model || provider.length > 120 || model.length > 160) return error(res, 400, '请选择有效模型')
        let directory
        try {
          directory = await this.bridge.selectSessionModel(conversation.harnessSessionId, {
            provider,
            model,
            ...(reasoningEffort ? { reasoningEffort } : {}),
          })
        } catch (cause) {
          return error(res, 502, cause instanceof Error ? cause.message : '模型切换失败')
        }
        json(res, 200, { ok: true, models: this.bridge.modelOptions(directory), current: directory?.current ?? null })
        return
      }
      if (method === 'POST' && action === 'promote') {
        const body = await readJson(req)
        const shareMode = ['from-now', 'summary', 'full-history'].includes(body.shareMode) ? body.shareMode : 'from-now'
        let sharedHistory = []
        let shareContext = shareMode === 'summary' ? String(body.shareContext ?? '').trim() : ''
        if (shareMode === 'summary' && !shareContext) return error(res, 400, '选择共享摘要时请填写允许同事看到的摘要')
        if (shareMode === 'full-history') {
          if (body.confirmFullHistory !== true) return error(res, 400, '请先确认共享全部可见聊天历史')
          try { sharedHistory = await this.bridge.history(conversation.harnessSessionId, 500) } catch (cause) {
            return error(res, 502, cause instanceof Error ? cause.message : '旧会话历史读取失败')
          }
          const transcript = sharedHistory.map(message => `${message.role === 'user' ? '会话主人' : 'AI'}：${message.text}`).join('\n\n')
          const maxContext = 200_000
          shareContext = transcript.length > maxContext
            ? `【历史较长，仅保留最后 ${maxContext.toLocaleString('zh-CN')} 个字符】\n${transcript.slice(-maxContext)}`
            : transcript
        }
        let room
        try {
          room = this.createRoom(auth.user, {
            ...body,
            name: body.name || conversation.title,
          }, {
            sourceConversationId: conversation.id,
            shareContext,
            shareMode,
            sharedHistoryCount: sharedHistory.length,
          })
        } catch (cause) { return error(res, 400, cause.message) }
        this.store.transact(state => {
          conversation.promotedRoomIds ??= []
          conversation.promotedRoomIds.push(room.id)
          for (const oldMessage of sharedHistory) {
            state.messages.push({
              id: makeId('msg'), roomId: room.id,
              kind: oldMessage.role === 'user' ? 'history-user' : 'history-assistant',
              userId: oldMessage.role === 'user' ? auth.user.id : null,
              text: oldMessage.text, aiEligible: false,
              createdAt: Number(oldMessage.createdAt || now()), historical: true,
            })
          }
          state.messages.push({
            id: makeId('msg'), roomId: room.id, kind: 'system', userId: auth.user.id,
            text: shareMode === 'summary'
              ? `会话主人将私人会话发布为多人协作，并共享了经过确认的进度摘要：\n${shareContext}`
              : shareMode === 'full-history'
                ? `会话主人已确认共享 ${sharedHistory.length} 条可见聊天历史。隐藏系统指令、凭据与其他会话仍不公开。`
                : '会话主人将私人会话发布为多人协作；此前私人内容不会向群成员公开。',
            aiEligible: false, createdAt: now(),
          })
        })
        json(res, 200, { ok: true, room: publicRoom(room, this.store.state, auth.user.id) })
        return
      }
      return error(res, 404, '私人会话接口不存在')
    }

    if (method === 'POST' && url.pathname === '/api/invites/accept') {
      this.assertMutation(req, auth)
      const body = await readJson(req)
      const invite = this.store.state.invites[sha256(String(body.inviteCode ?? '').trim())]
      if (!invite || invite.expiresAt <= now() || invite.remainingUses <= 0) return error(res, 403, '邀请码无效或已过期')
      const invitedRoom = this.store.state.rooms[invite.roomId]
      if (!invitedRoom || invitedRoom.closedAt) return error(res, 403, '群聊已关闭')
      if (invitedRoom.password && !verifyPassword(body.roomPassword, invitedRoom.password)) return error(res, 403, '群聊密码错误')
      const room = this.store.transact(state => {
        const targetRoom = state.rooms[invite.roomId]
        if (!targetRoom.members[auth.user.id]) {
          targetRoom.members[auth.user.id] = { role: 'member', aiAccess: Boolean(targetRoom.defaultAiAccess), joinedAt: now(), lastReadAt: 0 }
          invite.remainingUses -= 1
        }
        return targetRoom
      })
      this.emit(room.id, 'members')
      json(res, 200, { ok: true, room: publicRoom(room, this.store.state, auth.user.id) })
      return
    }

    if (method === 'POST' && url.pathname === '/api/rooms') {
      this.assertMutation(req, auth)
      const body = await readJson(req)
      let room
      try { room = this.createRoom(auth.user, body) } catch (cause) { return error(res, 400, cause.message) }
      json(res, 200, { ok: true, room: publicRoom(room, this.store.state, auth.user.id) })
      return
    }

    const roomMatch = /^\/api\/rooms\/([^/]+)(?:\/(.*))?$/.exec(url.pathname)
    if (!roomMatch) return error(res, 404, '接口不存在')
    const roomId = roomMatch[1]
    const action = roomMatch[2] ?? ''
    const room = this.requireRoom(req, res, roomId, auth.user.id)
    if (!room) return

    if (method === 'GET' && action.startsWith('artifacts/')) {
      const callId = decodeURIComponent(action.slice('artifacts/'.length))
      const storedTool = this.store.state.messages.find(message => message.roomId === room.id && message.tool?.callId === callId)?.tool
      const liveTool = [...this.runProgress.values()]
        .filter(progress => this.store.state.runs[progress.runId]?.roomId === room.id)
        .flatMap(progress => progress.steps ?? [])
        .find(step => step.tool?.callId === callId)?.tool
      const meta = toolArtifact(storedTool ?? liveTool)
      if (!meta) return error(res, 404, '可视化预览不存在或已过期')
      artifactResponse(res, meta)
      return
    }

    const attachmentMatch = /^attachments\/(att_[a-f0-9]{32})$/u.exec(action)
    if (method === 'GET' && attachmentMatch) {
      const attachmentId = attachmentMatch[1]
      const image = this.store.state.messages
        .filter(message => message.roomId === room.id)
        .flatMap(message => Array.isArray(message.images) ? message.images : [])
        .find(candidate => candidate.id === attachmentId)
      if (!image) return error(res, 404, '图片不存在或无权查看')
      let bytes
      try { bytes = readFileSync(join(this.attachmentDir, `${attachmentId}.bin`)) } catch { return error(res, 404, '图片文件已不存在') }
      res.writeHead(200, {
        'content-type': image.mediaType,
        'content-length': bytes.length,
        'cache-control': 'private, no-store',
        'x-content-type-options': 'nosniff',
        'content-disposition': 'inline',
      })
      res.end(bytes)
      return
    }

    const roomFileMatch = /^files\/(file_[a-f0-9]{32})$/u.exec(action)
    if (method === 'GET' && roomFileMatch) {
      const fileId = roomFileMatch[1]
      const file = this.store.state.messages
        .filter(message => message.roomId === room.id)
        .flatMap(message => Array.isArray(message.files) ? message.files : [])
        .find(candidate => candidate.id === fileId)
      if (!file) return error(res, 404, '附件不存在或无权查看')
      let bytes
      try { bytes = readFileSync(join(this.attachmentDir, `${fileId}.bin`)) } catch { return error(res, 404, '附件文件已不存在') }
      fileResponse(res, file, bytes)
      return
    }

    if (method === 'GET' && action === '') {
      this.store.transact(() => { room.members[auth.user.id].lastReadAt = now() })
      json(res, 200, { ok: true, ...this.roomState(room, auth.user.id) })
      return
    }

    if (method === 'GET' && action === 'events') {
      const presenceClientId = `events_${makeId('page')}`
      this.setPresence(auth.user.id, presenceClientId, true)
      res.writeHead(200, {
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-cache, no-transform',
        connection: 'keep-alive',
      })
      res.write(`event: ready\ndata: ${JSON.stringify({ at: now() })}\n\n`)
      const clients = this.sse.get(roomId) ?? new Set()
      clients.add(res)
      this.sse.set(roomId, clients)
      const heartbeat = setInterval(() => {
        res.write(': keepalive\n\n')
        this.setPresence(auth.user.id, presenceClientId, true)
      }, 20_000)
      req.on('close', () => {
        clearInterval(heartbeat)
        this.setPresence(auth.user.id, presenceClientId, false)
        clients.delete(res)
        if (clients.size === 0) this.sse.delete(roomId)
      })
      return
    }

    if (method === 'GET' && action === 'models') {
      let directory
      try {
        const sessionId = await this.ensureRoomSession(room)
        directory = await this.bridge.sessionModels(sessionId)
        this.store.transact(() => {
          const current = directory?.current
          room.modelSelection = current?.provider && current?.model
            ? {
                provider: String(current.provider),
                model: String(current.model),
                ...(current.reasoningEffort ? { reasoningEffort: String(current.reasoningEffort) } : {}),
              }
            : undefined
        })
      } catch (cause) {
        return error(res, 502, cause instanceof Error ? cause.message : '群聊模型目录读取失败')
      }
      json(res, 200, {
        ok: true,
        models: this.bridge.modelOptions(directory),
        current: directory?.current ?? null,
        routable: Boolean(directory?.routable),
      })
      return
    }

    this.assertMutation(req, auth)
    this.checkRate(`${auth.user.id}:${action}`)

    if (method === 'POST' && action === 'cancel') {
      if (!hasRole(room, auth.user.id, ['owner', 'admin'])) return error(res, 403, '只有群主或管理员可以停止群聊 AI 执行')
      const runId = room.agent.activeRunId
      const run = runId ? this.store.state.runs[runId] : undefined
      const pending = room.agent.pendingQuestion
      const proposal = run ? this.store.state.proposals[run.proposalId] : undefined
      const wasRunning = Boolean(run && ['running', 'question'].includes(room.agent.state))
      if (wasRunning) {
        this.store.transact(state => {
          run.status = 'cancelled'
          run.finishedAt = now()
          run.error = `${auth.user.displayName} 停止了本轮执行`
          if (proposal) proposal.status = 'cancelled'
          const source = (proposal?.sourceMessageIds ?? []).map(id => state.messages.find(message => message.id === id)).filter(Boolean)
          room.agent.lastCheckpointAt = Math.max(room.agent.lastCheckpointAt ?? 0, ...source.map(message => message.createdAt))
          room.agent.state = room.agent.enabled ? 'idle' : 'off'
          room.agent.activeRunId = undefined
          room.agent.activeProposalId = undefined
          room.agent.pendingQuestion = undefined
          room.agent.silenceUntil = undefined
          state.messages.push({
            id: makeId('msg'), roomId, kind: 'system', userId: auth.user.id,
            text: `${auth.user.displayName} 停止了本轮 AI 执行。`, aiEligible: false, createdAt: now(), runId,
          })
        })
        this.runProgress.delete(runId)
        const requests = [this.bridge.cancelSession(run.harnessSessionId ?? room.harnessSessionId)]
        if (pending) requests.push(this.bridge.respondQuestion({
          rpcId: pending.rpcId ?? pending.key,
          sessionId: pending.sessionId,
          answers: [],
          cancel: true,
        }))
        await Promise.allSettled(requests)
        this.emit(roomId, 'run')
      }
      json(res, 200, { ok: true, cancelled: wasRunning })
      return
    }

    if (method === 'POST' && action === 'privatize') {
      if (room.ownerId !== auth.user.id) return error(res, 403, '只有群主可以把多人会话收回为私人会话')
      if (Object.keys(room.members).some(userId => userId !== auth.user.id)) return error(res, 409, '请先移除其他成员，再收回为私人会话')
      if (['running', 'question', 'awaiting'].includes(room.agent.state)) return error(res, 409, 'AI 仍在执行、追问或等待确认，请完成本轮后再收回')
      let harnessSessionId = room.harnessSessionId
      if (!harnessSessionId) {
        try {
          harnessSessionId = await this.bridge.createSession({
            workspacePath: this.workspace(room.workspaceId).path,
            title: room.name,
          })
        } catch (cause) { return error(res, 502, cause instanceof Error ? cause.message : 'Harness 会话创建失败') }
      }
      const conversation = this.store.transact(state => {
        const id = makeId('cnv')
        const row = {
          id, ownerId: auth.user.id, harnessSessionId,
          title: room.name, subtitle: '由多人会话收回', avatar: 'whale',
          workspaceLabel: this.workspace(room.workspaceId)?.label ?? '私人空间',
          source: 'privatized-room', sourceRoomId: room.id,
          createdAt: room.createdAt, updatedAt: now(), promotedRoomIds: [],
        }
        state.conversations[id] = row
        room.closedAt = now()
        room.closedBy = auth.user.id
        room.privatizedConversationId = id
        room.agent.enabled = false
        room.agent.state = 'off'
        for (const [key, invite] of Object.entries(state.invites)) {
          if (invite.roomId === room.id) delete state.invites[key]
        }
        return row
      })
      const timer = this.timers.get(room.id)
      if (timer) clearTimeout(timer)
      this.timers.delete(room.id)
      this.emit(roomId, 'closed')
      json(res, 200, { ok: true, conversation: publicConversation(conversation) })
      return
    }

    if (method === 'PATCH' && action === 'mode') {
      if (room.ownerId !== auth.user.id) return error(res, 403, '只有群主可以切换群聊工作模式')
      if (['running', 'question'].includes(room.agent.state)) return error(res, 409, 'AI 正在执行或等待群聊回答，请在本轮完成后切换模式')
      const body = await readJson(req)
      const nextMode = String(body.mode ?? '')
      if (!['chat', 'discussion', 'execution', 'application'].includes(nextMode)) return error(res, 400, '请选择有效的群聊工作模式')
      const timer = this.timers.get(room.id)
      if (timer) clearTimeout(timer)
      this.timers.delete(room.id)
      this.store.transact(state => {
        const previousMode = collaborationMode(room)
        const currentProposal = state.proposals[room.agent.activeProposalId]
        if (currentProposal?.status === 'awaiting') currentProposal.status = 'cancelled'
        if (previousMode !== nextMode && nextMode === 'chat') room.chatModeStartedAt = now() - 1
        if (previousMode === 'chat' && nextMode !== 'chat') {
          const captured = state.messages
            .filter(message => message.roomId === roomId && message.kind === 'chat' && message.createdAt > Number(room.chatModeStartedAt ?? 0))
            .map(message => message.id)
          room.pendingChatMessageIds = [...new Set([...(room.pendingChatMessageIds ?? []), ...captured])].slice(-500)
          room.chatModeStartedAt = undefined
        }
        room.collaborationMode = nextMode
        room.agent.enabled = true
        room.agent.state = 'idle'
        room.agent.activeProposalId = undefined
        room.agent.silenceUntil = undefined
        room.agent.lastCheckpointAt = Math.max(
          room.agent.lastCheckpointAt ?? 0,
          ...state.messages.filter(message => message.roomId === roomId && message.kind === 'chat').map(message => message.createdAt),
        )
        state.messages.push({
          id: makeId('msg'), roomId, kind: 'system', userId: auth.user.id,
          text: `群主已切换为“${modeLabel(nextMode)}”模式。`, aiEligible: false, createdAt: now(),
        })
      })
      this.emit(roomId, 'mode')
      json(res, 200, { ok: true, room: publicRoom(room, this.store.state, auth.user.id) })
      return
    }

    if (method === 'PATCH' && action === 'settings') {
      if (!hasRole(room, auth.user.id, ['owner', 'admin'])) return error(res, 403, '只有群主或管理员可以修改协作规则')
      const body = await readJson(req)
      const passwordText = String(body.roomPassword ?? '')
      if (passwordText.length > 128) return error(res, 400, '进群密码最多 128 个字符')
      if (body.passwordProtected === true && !room.password && passwordText.trim() === '') {
        return error(res, 400, '启用进群密码后，请填写新密码')
      }
      this.store.transact(() => {
        if (typeof body.name === 'string' && body.name.trim().length >= 2 && body.name.trim().length <= 48) room.name = body.name.trim()
        if (typeof body.brief === 'string') room.brief = body.brief.trim().slice(0, 500)
        if (['unanimous', 'admin', 'auto'].includes(body.approvalMode)) room.approvalMode = body.approvalMode
        if (Number.isFinite(Number(body.quietSeconds))) room.quietSeconds = Math.min(Math.max(Number(body.quietSeconds), 5), 120)
        if (body.passwordProtected === false) room.password = undefined
        else if (body.passwordProtected === true && passwordText.trim() !== '') room.password = hashPassword(passwordText)
      })
      this.emit(roomId, 'settings')
      json(res, 200, { ok: true, room: publicRoom(room, this.store.state, auth.user.id) })
      return
    }

    const questionAnswerMatch = /^questions\/([^/]+)\/answer$/.exec(action)
    if (method === 'POST' && questionAnswerMatch) {
      if (!hasRole(room, auth.user.id, ['owner', 'admin'])) return error(res, 403, '只有群主或管理员可以回答 Agent 的执行追问')
      const key = questionAnswerMatch[1]
      const pending = room.agent.pendingQuestion
      if (!pending || pending.key !== key || pending.runId !== room.agent.activeRunId) return error(res, 404, '这条执行追问已结束或不存在')
      const body = await readJson(req)
      const cancel = body.cancel === true
      const answers = Array.isArray(body.answers) ? body.answers.slice(0, 3).map(answer => ({
        id: String(answer?.id ?? '').slice(0, 120),
        selected: Array.isArray(answer?.selected) ? answer.selected.slice(0, 10).map(value => String(value).slice(0, 160)) : [],
        ...(typeof answer?.custom === 'string' && answer.custom.trim() !== '' ? { custom: answer.custom.trim().slice(0, 4_000) } : {}),
      })) : []
      if (!cancel && answers.length !== pending.questions.length) return error(res, 400, '请完整回答本轮 Agent 追问')
      try {
        await this.bridge.respondQuestion({
          rpcId: pending.rpcId ?? pending.key,
          sessionId: pending.sessionId,
          answers,
          cancel,
        })
      } catch (cause) {
        return error(res, 409, cause instanceof Error ? cause.message : 'Agent 追问回答失败')
      }
      this.store.transact(() => {
        if (room.agent.pendingQuestion?.key !== key) return
        room.agent.pendingQuestion = undefined
        if (room.agent.activeRunId) room.agent.state = 'running'
      })
      this.emit(roomId, 'question')
      json(res, 200, { ok: true })
      return
    }

    if (method === 'POST' && action === 'messages') {
      const body = await readJson(req, ATTACHMENT_BODY_LIMIT)
      const text = String(body.text ?? '').trim()
      let images
      try { images = this.storeMessageImages(body.images) } catch (cause) {
        return error(res, 400, cause instanceof Error ? cause.message : '图片上传失败')
      }
      let files
      try { files = this.storeMessageFiles(body.files) } catch (cause) {
        return error(res, 400, cause instanceof Error ? cause.message : '文件上传失败')
      }
      if ((!text && images.length === 0 && files.length === 0) || text.length > MESSAGE_LIMIT) return error(res, 400, `消息文字最多 ${MESSAGE_LIMIT} 个字符，或至少添加一个附件`)
      const message = this.store.transact(state => {
        const currentRoom = state.rooms[roomId]
        const member = currentRoom.members[auth.user.id]
        const createdAt = Math.max(now(), Number(currentRoom.agent.lastCheckpointAt ?? 0) + 1)
        const row = {
          id: makeId('msg'), roomId, kind: 'chat', userId: auth.user.id, text,
          ...(images.length > 0 ? { images } : {}),
          ...(files.length > 0 ? { files } : {}),
          aiEligible: Boolean(member.aiAccess), createdAt,
        }
        state.messages.push(row)
        const mode = collaborationMode(currentRoom)
        const relevantToMode = mode !== 'chat' && (mode !== 'application' || auth.user.id === currentRoom.ownerId || mentionsAi(text))
        if (row.aiEligible && relevantToMode && currentRoom.agent.enabled && !['running', 'question', 'awaiting'].includes(currentRoom.agent.state)) {
          this.scheduleProposal(currentRoom)
        }
        return row
      })
      this.emit(roomId, 'message')
      json(res, 200, { ok: true, message })
      return
    }

    if (method === 'POST' && action === 'model') {
      if (!hasRole(room, auth.user.id, ['owner', 'admin'])) return error(res, 403, '只有群主或管理员可以切换群聊模型')
      const body = await readJson(req)
      const provider = String(body.provider ?? '').trim()
      const model = String(body.model ?? '').trim()
      const reasoningEffort = String(body.reasoningEffort ?? '').trim()
      if (!provider || !model || provider.length > 120 || model.length > 160) return error(res, 400, '请选择有效模型')
      let directory
      try {
        const sessionId = await this.ensureRoomSession(room)
        directory = await this.bridge.selectSessionModel(sessionId, {
          provider,
          model,
          ...(reasoningEffort ? { reasoningEffort } : {}),
        })
      } catch (cause) {
        return error(res, 502, cause instanceof Error ? cause.message : '群聊模型切换失败')
      }
      this.store.transact(() => {
        const current = directory?.current
        room.modelSelection = current?.provider && current?.model
          ? {
              provider: String(current.provider),
              model: String(current.model),
              ...(current.reasoningEffort ? { reasoningEffort: String(current.reasoningEffort) } : {}),
            }
          : { provider, model, ...(reasoningEffort ? { reasoningEffort } : {}) }
      })
      this.emit(roomId, 'settings')
      json(res, 200, { ok: true, models: this.bridge.modelOptions(directory), current: directory?.current ?? null })
      return
    }

    if (method === 'POST' && action === 'invites') {
      if (!hasRole(room, auth.user.id, ['owner', 'admin'])) return error(res, 403, '只有群主或管理员可以邀请')
      const body = await readJson(req)
      const code = makeCode(8)
      const invite = this.store.transact(state => {
        const row = {
          roomId, createdBy: auth.user.id, createdAt: now(),
          expiresAt: now() + Math.min(Math.max(Number(body.hours ?? 24), 1), 168) * 60 * 60 * 1000,
          remainingUses: Math.min(Math.max(Number(body.uses ?? 10), 1), 50),
        }
        state.invites[sha256(code)] = row
        return row
      })
      json(res, 200, { ok: true, code, expiresAt: invite.expiresAt, remainingUses: invite.remainingUses })
      return
    }

    if (method === 'POST' && action === 'agent') {
      if (!hasRole(room, auth.user.id, ['owner', 'admin'])) return error(res, 403, '只有群主或管理员可以切换 Agent')
      const body = await readJson(req)
      this.store.transact(() => {
        room.agent.enabled = Boolean(body.enabled)
        if (!room.agent.enabled) {
          const timer = this.timers.get(room.id)
          if (timer) clearTimeout(timer)
          this.timers.delete(room.id)
          if (!['running', 'question', 'awaiting'].includes(room.agent.state)) room.agent.state = 'off'
          room.agent.silenceUntil = undefined
        } else if (!['running', 'question', 'awaiting'].includes(room.agent.state)) {
          this.scheduleProposal(room)
        }
      })
      this.emit(roomId, 'agent')
      json(res, 200, { ok: true, agent: room.agent })
      return
    }

    if (method === 'POST' && action === 'propose') {
      if (!hasRole(room, auth.user.id, ['owner', 'admin'])) return error(res, 403, '只有群主或管理员可以立即整理')
      const timer = this.timers.get(room.id)
      if (timer) clearTimeout(timer)
      this.timers.delete(room.id)
      const proposal = this.createProposal(roomId)
      json(res, 200, { ok: true, proposal })
      return
    }

    const decisionMatch = /^proposals\/([^/]+)\/decision$/.exec(action)
    if (method === 'POST' && decisionMatch) {
      const proposalId = decisionMatch[1]
      const proposal = this.store.state.proposals[proposalId]
      if (!proposal || proposal.roomId !== roomId || proposal.status !== 'awaiting') return error(res, 404, '待确认提示词不存在')
      if (!proposal.eligibleVoterIds.includes(auth.user.id)) return error(res, 403, '你不在本轮确认人名单中')
      const body = await readJson(req)
      this.store.transact(state => {
        const current = state.proposals[proposalId]
        if (body.approve) {
          current.confirmations[auth.user.id] = now()
          delete current.rejections[auth.user.id]
        } else {
          current.rejections[auth.user.id] = { at: now(), reason: String(body.reason ?? '').trim().slice(0, 300) }
          current.status = 'rejected'
          room.agent.state = room.agent.enabled ? 'collecting' : 'off'
          room.agent.activeProposalId = undefined
          state.messages.push({
            id: makeId('msg'), roomId, kind: 'system', userId: auth.user.id,
            text: `${auth.user.displayName} 退回了本轮提示词${current.rejections[auth.user.id].reason ? `：${current.rejections[auth.user.id].reason}` : ''}`,
            aiEligible: false, createdAt: now(),
          })
        }
      })
      this.emit(roomId, 'proposal')
      if (body.approve) this.maybeExecute(roomId, proposalId)
      else if (room.agent.enabled) this.store.transact(() => this.scheduleProposal(room))
      json(res, 200, { ok: true })
      return
    }

    const memberMatch = /^members\/([^/]+)$/.exec(action)
    if (memberMatch && method === 'PATCH') {
      if (!hasRole(room, auth.user.id, ['owner', 'admin'])) return error(res, 403, '只有群主或管理员可以调整成员权限')
      const targetId = memberMatch[1]
      const target = room.members[targetId]
      if (!target) return error(res, 404, '成员不存在')
      const actorRole = room.members[auth.user.id].role
      if (target.role === 'owner') return error(res, 403, '不能修改群主权限')
      if (actorRole === 'admin' && (targetId === auth.user.id || target.role === 'admin')) return error(res, 403, '管理员不能修改自己或其他管理员')
      const body = await readJson(req)
      if (actorRole !== 'owner' && body.role === 'admin') return error(res, 403, '只有群主可以设置管理员')
      let rebuildProposal = false
      this.store.transact(state => {
        if (typeof body.aiAccess === 'boolean') target.aiAccess = body.aiAccess
        if (body.role && ['admin', 'member', 'observer'].includes(body.role)) target.role = body.role
        const activeProposal = state.proposals[room.agent.activeProposalId]
        if (typeof body.aiAccess === 'boolean' && activeProposal?.status === 'awaiting') {
          activeProposal.status = 'cancelled'
          room.agent.state = room.agent.enabled ? 'idle' : 'off'
          room.agent.activeProposalId = undefined
          rebuildProposal = true
        }
      })
      if (rebuildProposal && room.agent.enabled && this.candidateMessages(room).length > 0) this.store.transact(() => this.scheduleProposal(room))
      this.emit(roomId, 'members')
      json(res, 200, { ok: true })
      return
    }

    if (memberMatch && method === 'DELETE') {
      if (!hasRole(room, auth.user.id, ['owner', 'admin'])) return error(res, 403, '只有群主或管理员可以移除成员')
      const targetId = memberMatch[1]
      if (targetId === room.ownerId) return error(res, 403, '不能移除群主')
      const target = room.members[targetId]
      if (!target) return error(res, 404, '成员不存在')
      const actorRole = room.members[auth.user.id].role
      if (actorRole === 'admin' && (targetId === auth.user.id || target.role === 'admin')) return error(res, 403, '管理员不能移除自己或其他管理员')
      this.store.transact(() => { delete room.members[targetId] })
      this.emit(roomId, 'members')
      json(res, 200, { ok: true })
      return
    }

    error(res, 404, '接口不存在')
  }
}
