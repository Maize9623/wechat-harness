const AVATARS = ['whale', 'code', 'spark', 'folder', 'robot']
const AVATAR_COLORS = ['#2f6bff', '#7958d8', '#0e9f8a', '#e66a3c', '#d14c7b', '#3b7c96']
const AVATAR_PATHS = {
  whale: '<path d="M48.84 10.05c-.52-.26-.74.23-1.04.48-1.1 1.17-2.07 1.65-3.04 1.57-1.67-.1-3.1.44-4.35 1.74-.27-1.61-1.16-2.57-2.52-3.18-1.65-.74-2.02-1.55-2.54-2.93-.11-.33-.22-.66-.59-.72-.4-.07-.56.28-.71.57-1.86 3.47-.82 7.74 2.85 10.76.28.19.35.38.26.66l-.53 1.71c-.11.37-.28.45-.67.29-3.7-1.58-5.86-5.16-8.73-7.48-.45-.34-.91-.66-1.38-.97-1.99-1.97.26-3.58.78-3.78.54-.2.19-.89-1.57-.88-2.38.01-4.45 1.14-6.35 1.69-7.4-1.44-13.04.78-16.87 6.17C-.98 19.11-.32 28.73 8.07 38.88c6.3 5.32 15.26 6.32 23.03.58 2.9 1.47 7.75.78 7.02.55 1.48-.32 1.38-1.72.84-1.98-4.34-2.06-3.38-1.22-4.25-1.9 4.49-5.42 7.09-10.77 6.83-16.14-.01-.35.07-.49.46-.53 4.72-.55 7.81-3.1 8.17-8.21.04-.47-.01-.96-.5-1.2ZM24.33 37.84c-4.21-3.38-6.25-4.49-7.09-4.44-.79.05-.65.97-.48 1.57.18.59.42 1 .75 1.52.23.34.39.86-.23 1.24-1.35.86-3.71-.29-3.82-.35C7.93 34.06 4.5 28.15 4.2 21.37c-.04-.79.19-1.07.96-1.22 6.27-1.18 11.2 1.1 14.1 5.63 4.36 4.4 5.87 9.3 11.22 13.33-1.61.18-4.31.22-6.15-1.27Zm2.02-13.24a.63.63 0 1 1 1.23 0 .63.63 0 0 1-1.23 0Zm6.26 3.28c-2.14.9-3.5-.24-3.91-1.75-.31-1.56.65-1.8-.45-2.71-.61-.52-1.35-.36-1.9-.57-.22-.11-.4-.39-.23-.73.66-1.3 2.54-.59 3.93 1.21 1.24 1.47 2.36 3.75 2.56 4.55Z"/>',
  code: '<path d="m9 6-6 6 6 6M15 6l6 6-6 6"/>',
  spark: '<path d="m12 2 1.6 5.4L19 9l-5.4 1.6L12 16l-1.6-5.4L5 9l5.4-1.6ZM18.5 15l.8 2.7L22 18.5l-2.7.8-.8 2.7-.8-2.7-2.7-.8 2.7-.8Z"/>',
  folder: '<path d="M3 6h7l2 2h9v11H3Z"/>',
  robot: '<rect x="4" y="7" width="16" height="12" rx="3"/><path d="M12 3v4M8 12h.01M16 12h.01M8 16h8"/>',
}

const state = {
  bootstrap: null,
  user: null,
  csrf: '',
  conversations: [],
  rooms: [],
  current: null,
  conversationData: null,
  roomData: null,
  events: null,
  countdown: null,
  query: '',
}

const $ = selector => document.querySelector(selector)
const $$ = selector => [...document.querySelectorAll(selector)]

function node(tag, className, text) {
  const element = document.createElement(tag)
  if (className) element.className = className
  if (text !== undefined) element.textContent = text
  return element
}

function toast(message, kind = '') {
  const element = $('#toast')
  element.textContent = message
  element.className = `toast show ${kind}`
  clearTimeout(toast.timer)
  toast.timer = setTimeout(() => { element.className = 'toast' }, 3_200)
}

async function api(path, options = {}) {
  const headers = { ...(options.headers ?? {}) }
  if (options.body !== undefined) headers['content-type'] = 'application/json'
  if (state.csrf && (options.method ?? 'GET') !== 'GET') headers['x-csrf-token'] = state.csrf
  const response = await fetch(path, {
    ...options,
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  })
  const body = await response.json().catch(() => ({ ok: false, error: `HTTP ${response.status}` }))
  if (!response.ok || body.ok === false) throw new Error(body.error ?? '操作失败')
  return body
}

function avatarGlyph(value) {
  const glyph = value && typeof value === 'object' ? value.glyph : value
  return AVATARS.includes(glyph) ? glyph : 'whale'
}

function avatarSvg(glyph) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  svg.setAttribute('viewBox', glyph === 'whale' ? '0 0 50 50' : '0 0 24 24')
  svg.setAttribute('aria-hidden', 'true')
  if (glyph === 'whale') {
    svg.classList.add('whale-mark')
    svg.setAttribute('fill', 'currentColor')
  } else {
    svg.setAttribute('fill', 'none')
    svg.setAttribute('stroke', 'currentColor')
    svg.setAttribute('stroke-width', '1.8')
    svg.setAttribute('stroke-linecap', 'round')
    svg.setAttribute('stroke-linejoin', 'round')
  }
  svg.innerHTML = AVATAR_PATHS[glyph] ?? AVATAR_PATHS.whale
  return svg
}

function paintAvatar(element, avatar, color = '#3478f6') {
  element.replaceChildren()
  const view = avatar && typeof avatar === 'object' ? avatar : null
  element.style.background = view?.color || color
  if (view?.glyph === 'image' && typeof view.image === 'string' && view.image.startsWith('data:image/')) {
    const image = document.createElement('img')
    image.src = view.image
    image.alt = ''
    element.append(image)
    return
  }
  element.append(avatarSvg(avatarGlyph(view ?? avatar)))
}

function currentUserAvatar() { return state.bootstrap?.ui?.userAvatar ?? state.user?.avatarView ?? state.user?.avatar }

function initials(name) {
  const chars = [...String(name || 'AI').trim()]
  return chars.slice(0, 2).join('').toUpperCase()
}

function timeLabel(value) {
  if (!Number(value)) return ''
  return new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit' }).format(new Date(value))
}

function dateTimeLabel(value) {
  if (!Number(value)) return '未知'
  return new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(value))
}

function tokenLabel(value) {
  const count = typeof value === 'number'
    ? value
    : Number(value?.totalTokens ?? value?.total ?? (Number(value?.inputTokens ?? 0) + Number(value?.outputTokens ?? 0)))
  if (!Number.isFinite(count) || count <= 0) return '尚无统计'
  return count > 10_000 ? `${(count / 10_000).toFixed(1)} 万` : count.toLocaleString('zh-CN')
}

function currentIs(kind) { return state.current?.kind === kind }
function isManager() { return ['owner', 'admin'].includes(state.roomData?.room?.role) }

function hydrateAvatarOptions() {
  $$('[data-avatar-options]').forEach((container, containerIndex) => {
    container.replaceChildren()
    for (const value of AVATARS) {
      const label = node('label', 'avatar-option')
      const input = document.createElement('input')
      input.type = 'radio'
      input.name = 'avatar'
      input.value = value
      input.checked = value === 'whale'
      const preview = node('span')
      preview.style.background = AVATAR_COLORS[containerIndex % AVATAR_COLORS.length]
      preview.append(avatarSvg(value))
      label.append(input, preview)
      container.append(label)
    }
    container.dataset.index = String(containerIndex)
  })
  $$('[data-avatar-colors]').forEach(container => {
    container.replaceChildren()
    for (const color of AVATAR_COLORS) {
      const label = node('label', 'avatar-color')
      label.style.background = color
      const input = document.createElement('input')
      input.type = 'radio'
      input.name = 'color'
      input.value = color
      input.checked = color === AVATAR_COLORS[0]
      label.append(input)
      container.append(label)
    }
  })
}

function fillWorkspaceSelects() {
  for (const select of [$('#workspaceSelect'), $('#promoteWorkspaceSelect')]) {
    select.replaceChildren(...(state.bootstrap?.workspaces ?? []).map(workspace => {
      const option = node('option', '', workspace.label)
      option.value = workspace.id
      return option
    }))
  }
}

async function bootstrap() {
  const params = new URLSearchParams(location.search)
  const setup = params.get('setup') ?? ''
  const data = await api(`/api/bootstrap${setup ? `?setup=${encodeURIComponent(setup)}` : ''}`)
  state.bootstrap = data
  state.user = data.user
  state.csrf = data.csrf ?? ''
  state.conversations = data.conversations ?? []
  state.rooms = data.rooms ?? []
  if (data.user) showApp(params.get('invite'))
  else showAuth(data, setup, params.get('invite'))
}

function showAuth(data, setupToken, inviteCode) {
  $('#appView').classList.add('hidden')
  $('#authView').classList.remove('hidden')
  if (data.setupRequired) {
    $('#loginForm').classList.add('hidden')
    $('#registerForm').classList.add('hidden')
    $('.auth-tabs').classList.add('hidden')
    $('#setupForm').classList.remove('hidden')
    $('#setupForm [name="token"]').value = data.setupTokenAccepted ? setupToken : ''
    if (!data.setupTokenAccepted) toast('请使用本机控制台显示的首次设置链接', 'error')
    return
  }
  if (inviteCode) {
    $('[data-auth-tab="register"]').click()
    $('#registerForm [name="inviteCode"]').value = inviteCode
  }
}

function showApp(inviteCode) {
  $('#authView').classList.add('hidden')
  $('#appView').classList.remove('hidden')
  paintAvatar($('#railAvatar'), currentUserAvatar(), state.user.color)
  const note = state.bootstrap?.ui?.pinnedNote
  if (typeof note === 'string' && note.trim()) $('#pinnedNote b').textContent = note
  fillWorkspaceSelects()
  renderSessionList()
  if (!state.current) {
    const first = allSessions()[0]
    if (first) void openSession(first.kind, first.id)
  }
  if (inviteCode) {
    showInviteDialog('accept')
    $('#acceptCodeInput').value = inviteCode
  }
}

function allSessions() {
  return [
    ...state.conversations.map(value => ({ ...value, kind: 'private' })),
    ...state.rooms.map(value => ({ ...value, title: value.name, subtitle: value.brief || '多人会话', kind: 'shared' })),
  ].sort((left, right) => Number(right.updatedAt ?? right.createdAt ?? 0) - Number(left.updatedAt ?? left.createdAt ?? 0))
}

function renderSessionList() {
  const list = $('#sessionList')
  list.replaceChildren()
  const normalized = state.query.trim().toLocaleLowerCase()
  const rows = allSessions().filter(item => normalized === '' || `${item.title ?? item.name ?? ''} ${item.subtitle ?? item.brief ?? ''}`.toLocaleLowerCase().includes(normalized))
  $('#sessionCount').textContent = `${rows.length} 个会话`
  if (rows.length === 0) {
    const empty = node('div', 'muted', '还没有会话。点右上角 ＋，选择创建私人会话或多人会话。')
    empty.style.padding = '26px 12px'
    list.append(empty)
    return
  }
  for (const item of rows) {
    const active = state.current?.kind === item.kind && state.current.id === item.id
    const button = node('button', `room-row${active ? ' active' : ''}`)
    button.type = 'button'
    button.addEventListener('click', () => openSession(item.kind, item.id))
    const avatar = node('span', 'avatar')
    if (item.kind === 'private') paintAvatar(avatar, item.avatarView ?? item.avatar, '#3478f6')
    else {
      avatar.textContent = initials(item.name)
      avatar.style.background = 'linear-gradient(135deg,#26b797,#2f6bff)'
    }
    button.append(avatar)
    const copy = node('span', 'room-copy')
    const titleRow = node('span', 'list-title')
    titleRow.append(node('b', '', item.title || item.name))
    if (item.kind === 'shared') titleRow.append(node('em', 'visibility-chip shared', '多人'))
    copy.append(titleRow)
    const status = item.kind === 'shared' && item.agent?.enabled ? `AI ${agentStateText(item.agent.state)}` : item.subtitle
    copy.append(node('small', '', status || '开始新的对话'))
    button.append(copy)
    const side = node('span', 'list-side')
    side.append(node('small', '', timeLabel(item.updatedAt ?? item.createdAt)))
    if (item.unread > 0) side.append(node('span', 'unread', item.unread > 99 ? '99+' : String(item.unread)))
    button.append(side)
    list.append(button)
  }
}

function agentStateText(value) {
  return ({ off: '未参与', idle: '待命', collecting: '正在听大家说', awaiting: '等待确认', running: '正在工作', error: '需要检查' })[value] ?? '待命'
}

async function openSession(kind, id) {
  if (state.events) state.events.close()
  state.events = null
  state.current = { kind, id }
  state.conversationData = null
  state.roomData = null
  closeDetails()
  $('#sessionCard').classList.add('hidden')
  renderSessionList()
  try {
    if (kind === 'private') {
      state.conversationData = await api(`/api/conversations/${encodeURIComponent(id)}`)
      renderPrivate()
    } else {
      state.roomData = await api(`/api/rooms/${encodeURIComponent(id)}`)
      const index = state.rooms.findIndex(room => room.id === id)
      if (index >= 0) state.rooms[index] = { ...state.rooms[index], ...state.roomData.room, unread: 0 }
      renderRoom()
      connectEvents(id)
    }
  } catch (error) { toast(error.message, 'error') }
}

function setChatActions({ promote = false, force = false, invite = false, details = false } = {}) {
  $('#promoteButton').classList.toggle('hidden', !promote)
  $('#forceProposalButton').classList.toggle('hidden', !force)
  $('#inviteButton').classList.toggle('hidden', !invite)
  $('#detailsButton').classList.toggle('hidden', !details)
}

function renderPrivate() {
  const data = state.conversationData
  if (!data) return
  const conversation = data.conversation
  $('#emptyRoom').classList.add('hidden')
  $('#composer').classList.remove('hidden')
  $('#agentBanner').classList.add('hidden')
  setChatActions({ promote: true })
  paintAvatar($('#sessionBadge'), conversation.avatarView ?? conversation.avatar, '#3478f6')
  paintAvatar($('#emptyAvatar'), conversation.avatarView ?? conversation.avatar, '#3478f6')
  $('#sessionTitle').textContent = conversation.title
  $('#sessionSubtitle').textContent = conversation.subtitle
  $('#composerHint').textContent = '私人会话：只有你的账号可以查看'
  $('#composer textarea').placeholder = '把你的想法告诉我…'
  renderPrivateTimeline(data.messages ?? [])
  renderSessionList()
}

function renderPrivateTimeline(messages) {
  const scroller = $('#messageScroller')
  const stick = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 140
  const timeline = $('#timeline')
  timeline.replaceChildren()
  for (const message of messages) timeline.append(renderPrivateMessage(message))
  if (stick) requestAnimationFrame(() => { scroller.scrollTop = scroller.scrollHeight })
}

function renderPrivateMessage(message) {
  const mine = message.role === 'user'
  const wrapper = node('article', `message ${mine ? 'mine' : 'agent'}`)
  const avatar = node('span', 'message-avatar')
  if (mine) paintAvatar(avatar, currentUserAvatar(), state.user.color)
  else paintAvatar(avatar, state.conversationData.conversation.avatarView ?? state.conversationData.conversation.avatar, '#3478f6')
  wrapper.append(avatar)
  const body = node('div', 'message-body')
  const meta = node('div', 'message-meta')
  meta.append(node('span', '', mine ? state.user.displayName : state.conversationData.conversation.title), node('span', '', timeLabel(message.createdAt)))
  body.append(meta, node('div', 'bubble', message.text))
  wrapper.append(body)
  return wrapper
}

function connectEvents(roomId) {
  const source = new EventSource(`/api/rooms/${encodeURIComponent(roomId)}/events`)
  const refresh = () => {
    if (state.current?.kind !== 'shared' || state.current.id !== roomId) return
    void refreshRoom(false)
  }
  for (const type of ['state', 'message', 'proposal', 'run', 'members', 'agent', 'settings']) source.addEventListener(type, refresh)
  source.addEventListener('closed', () => void refreshBootstrap())
  state.events = source
}

async function refreshBootstrap(openFirst = false) {
  const data = await api('/api/bootstrap')
  state.bootstrap = data
  state.user = data.user
  state.csrf = data.csrf ?? state.csrf
  state.conversations = data.conversations ?? []
  state.rooms = data.rooms ?? []
  renderSessionList()
  if (openFirst) {
    const first = allSessions()[0]
    if (first) await openSession(first.kind, first.id)
  }
}

async function refreshRoom(showErrors = true) {
  if (!currentIs('shared')) return
  try {
    state.roomData = await api(`/api/rooms/${encodeURIComponent(state.current.id)}`)
    const index = state.rooms.findIndex(room => room.id === state.current.id)
    if (index >= 0) state.rooms[index] = { ...state.rooms[index], ...state.roomData.room, unread: 0 }
    renderRoom()
  } catch (error) {
    if (showErrors) toast(error.message, 'error')
  }
}

function renderRoom() {
  const data = state.roomData
  if (!data) return
  $('#emptyRoom').classList.add('hidden')
  $('#composer').classList.remove('hidden')
  setChatActions({ force: isManager() && data.room.agent.enabled, invite: isManager(), details: true })
  $('#sessionBadge').textContent = initials(data.room.name)
  $('#sessionBadge').style.background = 'linear-gradient(135deg,#26b797,#2f6bff)'
  $('#sessionTitle').textContent = data.room.name
  $('#sessionSubtitle').textContent = `多人 · ${data.workspace.label} · ${Object.keys(data.members).length} 人`
  $('#composerHint').textContent = data.room.aiAccess ? '你的消息可进入下一轮 AI 协作候选' : '你可以聊天，但当前发言不会影响 AI 执行'
  $('#composer textarea').placeholder = '给大家发消息…'
  renderAgentBanner()
  renderRoomTimeline()
  renderDetails()
  renderSessionList()
}

function approvalLabel(mode) {
  return ({ unanimous: '全员确认', admin: '管理员确认', auto: '静默后自动响应' })[mode] ?? '全员确认'
}

function renderAgentBanner() {
  const agent = state.roomData.room.agent
  const banner = $('#agentBanner')
  if (!agent.enabled && !['running', 'awaiting'].includes(agent.state)) {
    banner.classList.add('hidden')
    clearInterval(state.countdown)
    return
  }
  banner.classList.remove('hidden')
  const paint = () => {
    banner.replaceChildren(node('span', `agent-dot${['running', 'collecting'].includes(agent.state) ? ' busy' : ''}`))
    let text = `AI ${agentStateText(agent.state)}`
    if (agent.state === 'collecting' && agent.silenceUntil) text += ` · ${Math.max(0, Math.ceil((agent.silenceUntil - Date.now()) / 1_000))} 秒内无人继续发言后整理`
    if (agent.state === 'running') text += ' · 新需求会排入下一轮，不会插入正在执行的任务'
    banner.append(node('span', '', text))
  }
  paint()
  clearInterval(state.countdown)
  state.countdown = setInterval(paint, 1_000)
}

function renderRoomTimeline() {
  const scroller = $('#messageScroller')
  const stick = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 140
  const timeline = $('#timeline')
  timeline.replaceChildren()
  const items = [
    ...state.roomData.messages.map(value => ({ type: 'message', at: value.createdAt, value })),
    ...state.roomData.proposals.map(value => ({ type: 'proposal', at: value.createdAt + 1, value })),
  ].sort((left, right) => left.at - right.at)
  for (const item of items) timeline.append(item.type === 'message' ? renderRoomMessage(item.value) : renderProposal(item.value))
  if (stick) requestAnimationFrame(() => { scroller.scrollTop = scroller.scrollHeight })
}

function renderRoomMessage(message) {
  const historicalUser = message.kind === 'history-user'
  const historicalAssistant = message.kind === 'history-assistant'
  const mine = message.userId === state.user.id && !historicalUser
  const user = message.userId ? state.roomData.users[message.userId] : null
  const wrapper = node('article', `message ${mine ? 'mine' : ''} ${message.kind ?? ''}`)
  if (message.kind !== 'system') {
    const avatar = node('span', 'message-avatar')
    if (message.kind === 'agent' || historicalAssistant) paintAvatar(avatar, 'whale', '#3478f6')
    else paintAvatar(avatar, user?.avatarView ?? user?.avatar ?? 'whale', user?.color ?? '#789')
    wrapper.append(avatar)
  }
  const body = node('div', 'message-body')
  if (message.kind !== 'system') {
    const meta = node('div', 'message-meta')
    const name = historicalAssistant ? '旧会话 AI' : historicalUser ? `${user?.displayName ?? '会话主人'} · 旧会话` : message.kind === 'agent' ? '共享 AI' : (user?.displayName ?? '已离开成员')
    meta.append(node('span', '', name), node('span', '', timeLabel(message.createdAt)))
    if (message.kind === 'chat' && message.aiEligible) meta.append(node('span', 'ai-chip', '可参与 AI'))
    body.append(meta)
  }
  body.append(node('div', 'bubble', message.text))
  wrapper.append(body)
  return wrapper
}

function renderProposal(proposal) {
  const card = node('article', 'proposal-card')
  const head = node('div', 'proposal-head')
  head.append(node('h3', '', `AI 本轮协作提示词 · v${proposal.version}`), node('span', 'status-pill', ({ awaiting: '等待确认', approved: '已批准', rejected: '已退回' })[proposal.status] ?? proposal.status))
  card.append(head)
  if (proposal.conflictWarning) card.append(node('div', 'conflict', '检测到潜在分歧：本轮已强制切换为有执行权成员全员确认，AI 不会先选边。'))
  card.append(node('pre', '', proposal.prompt))
  const confirmed = Object.keys(proposal.confirmations ?? {}).length
  card.append(node('p', 'muted', proposal.eligibleVoterIds.length ? `已确认 ${confirmed}/${proposal.eligibleVoterIds.length} · ${approvalLabel(proposal.approvalMode)}` : '静默确认模式：已自动进入沙盒执行。'))
  if (proposal.status === 'awaiting' && proposal.eligibleVoterIds.includes(state.user.id) && !proposal.confirmations[state.user.id]) {
    const actions = node('div', 'proposal-actions')
    const reject = node('button', 'danger', '有分歧，退回')
    reject.type = 'button'
    reject.addEventListener('click', async () => {
      const reason = prompt('请简短说明需要讨论或修改的地方（可留空）：') ?? ''
      try { await api(`/api/rooms/${state.current.id}/proposals/${proposal.id}/decision`, { method: 'POST', body: { approve: false, reason } }); await refreshRoom() } catch (error) { toast(error.message, 'error') }
    })
    const approve = node('button', 'primary', '确认本轮')
    approve.type = 'button'
    approve.addEventListener('click', async () => {
      try { await api(`/api/rooms/${state.current.id}/proposals/${proposal.id}/decision`, { method: 'POST', body: { approve: true } }); await refreshRoom() } catch (error) { toast(error.message, 'error') }
    })
    actions.append(reject, approve)
    card.append(actions)
  }
  return card
}

function renderDetails() {
  const data = state.roomData
  const manageable = isManager()
  $('#executionBadge').textContent = data.executionEnabled ? '沙盒执行已开' : '仅协商演示'
  $('#agentToggle').checked = data.room.agent.enabled
  $('#agentToggle').disabled = !manageable
  $('#roomBrief').value = data.room.brief ?? ''
  $('#roomBrief').disabled = !manageable
  $('#approvalMode').value = data.room.approvalMode ?? 'unanimous'
  $('#approvalMode').disabled = !manageable
  $('#quietSeconds').value = data.room.quietSeconds ?? 30
  $('#quietSeconds').disabled = !manageable
  $('#quietValue').textContent = `${data.room.quietSeconds ?? 30} 秒`
  $('#saveSettingsButton').classList.toggle('hidden', !manageable)
  $('#memberCount').textContent = `${Object.keys(data.members).length} 人`
  $('#workspaceLabel').textContent = `白名单空间：${data.workspace.label}`
  $('#historyShareLabel').textContent = ({
    'from-now': '旧会话：未共享，从转为多人后开始',
    summary: '旧会话：仅共享群主确认的摘要',
    'full-history': `旧会话：群主确认共享了 ${data.room.sharedHistoryCount ?? 0} 条可见历史`,
  })[data.room.shareMode ?? 'from-now']
  const owner = data.room.role === 'owner'
  $('#ownerDangerZone').classList.toggle('hidden', !owner)
  $('#privatizeButton').disabled = Object.keys(data.members).length !== 1 || ['running', 'awaiting'].includes(data.room.agent.state)
  renderMembers()
}

function renderMembers() {
  const list = $('#memberList')
  list.replaceChildren()
  const actorRole = state.roomData.room.role
  for (const [userId, member] of Object.entries(state.roomData.members)) {
    const user = state.roomData.users[userId]
    const row = node('div', 'member-row')
    const avatar = node('span', 'message-avatar')
    paintAvatar(avatar, user?.avatarView ?? user?.avatar, user?.color)
    row.append(avatar)
    const copy = node('span', 'member-name')
    copy.append(node('b', '', `${user?.displayName ?? '成员'}${userId === state.user.id ? '（我）' : ''}`), node('small', '', ({ owner: '群主', admin: '管理员', member: '成员', observer: '只读成员' })[member.role] ?? member.role))
    row.append(copy)
    const controls = node('span', 'member-controls')
    const canManage = actorRole === 'owner' || (actorRole === 'admin' && member.role !== 'admin' && member.role !== 'owner' && userId !== state.user.id)
    const ai = node('button', `mini-button${member.aiAccess ? ' on' : ''}`, member.aiAccess ? 'AI 有效' : '仅聊天')
    ai.type = 'button'
    ai.disabled = !canManage
    ai.addEventListener('click', () => updateMember(userId, { aiAccess: !member.aiAccess }))
    controls.append(ai)
    if (actorRole === 'owner' && member.role !== 'owner') {
      const role = node('button', 'mini-button', member.role === 'admin' ? '降为成员' : '设管理员')
      role.type = 'button'
      role.addEventListener('click', () => updateMember(userId, { role: member.role === 'admin' ? 'member' : 'admin' }))
      controls.append(role)
    }
    if (canManage && member.role !== 'owner') {
      const remove = node('button', 'mini-button danger-text', '移除')
      remove.type = 'button'
      remove.addEventListener('click', () => removeMember(userId, user?.displayName))
      controls.append(remove)
    }
    row.append(controls)
    list.append(row)
  }
}

async function updateMember(userId, body) {
  try { await api(`/api/rooms/${state.current.id}/members/${userId}`, { method: 'PATCH', body }); await refreshRoom() } catch (error) { toast(error.message, 'error') }
}

async function removeMember(userId, name) {
  if (!confirm(`确定将“${name ?? '该成员'}”移出当前多人会话吗？`)) return
  try { await api(`/api/rooms/${state.current.id}/members/${userId}`, { method: 'DELETE', body: {} }); await refreshRoom() } catch (error) { toast(error.message, 'error') }
}

function openDetails() { $('#detailsPane').classList.remove('hidden'); $('#appView').classList.add('details-open') }
function closeDetails() { $('#detailsPane').classList.add('hidden'); $('#appView').classList.remove('details-open') }

function showSessionCard() {
  if (!state.current) return
  const card = $('#sessionCard')
  card.replaceChildren()
  const value = currentIs('private') ? state.conversationData?.conversation : state.roomData?.room
  if (!value) return
  const avatar = node('span', 'profile-avatar')
  if (currentIs('private')) paintAvatar(avatar, value.avatarView ?? value.avatar, '#3478f6')
  else { avatar.textContent = initials(value.name); avatar.style.background = 'linear-gradient(135deg,#26b797,#2f6bff)' }
  const copy = node('div', 'profile-copy')
  copy.append(node('h3', '', value.title ?? value.name), node('p', '', currentIs('private') ? value.subtitle : (value.brief || '多人会话')))
  const facts = node('dl', 'profile-facts')
  const pairs = currentIs('private') ? [
    ['创建时间', dateTimeLabel(value.createdAt)], ['最近交互', dateTimeLabel(value.updatedAt)], ['Token 总量', tokenLabel(value.tokenUsage)], ['可见范围', '仅自己'],
  ] : [['创建时间', dateTimeLabel(value.createdAt)], ['成员', `${value.memberCount} 人`], ['可见范围', '当前群成员']]
  for (const [term, description] of pairs) facts.append(node('dt', '', term), node('dd', '', description))
  card.append(avatar, copy, facts)
  card.classList.toggle('hidden')
}

function setSelectedAvatar(form, avatar) {
  const input = form.querySelector(`[name="avatar"][value="${avatar}"]`)
  if (input) input.checked = true
}

function openProfile() {
  const avatar = currentUserAvatar()
  $('#profileForm [name="displayName"]').value = state.user.displayName
  setSelectedAvatar($('#profileForm'), avatarGlyph(avatar))
  const color = avatar && typeof avatar === 'object' ? avatar.color : state.user.color
  const colorInput = $('#profileForm').querySelector(`[name="color"][value="${color}"]`)
  if (colorInput) colorInput.checked = true
  $('#profileForm [name="avatarImage"]').value = ''
  $('#profileDialog').showModal()
}

function openSettings() { $('#settingsDialog').showModal() }

function imageData(file) {
  if (!(file instanceof File) || file.size === 0) return Promise.resolve(undefined)
  if (!file.type.startsWith('image/')) return Promise.reject(new Error('请选择图片文件'))
  if (file.size > 1_500_000) return Promise.reject(new Error('头像图片请控制在 1.5 MB 以内'))
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.addEventListener('load', () => resolve(typeof reader.result === 'string' ? reader.result : undefined))
    reader.addEventListener('error', () => reject(new Error('头像图片读取失败')))
    reader.readAsDataURL(file)
  })
}

function toggleCreateFields() {
  const visibility = $('#newConversationForm [name="visibility"]:checked').value
  $('#sharedCreateFields').classList.toggle('hidden', visibility !== 'shared')
  $$('.mode-card').forEach(card => card.classList.toggle('active', card.querySelector('input').checked))
}

function toggleShareFields() {
  const mode = $('#promoteForm [name="shareMode"]:checked').value
  $('#shareSummaryField').classList.toggle('hidden', mode !== 'summary')
  $('#fullHistoryConfirm').classList.toggle('hidden', mode !== 'full-history')
}

function showInviteDialog(mode) {
  $('#codeDialog').showModal()
  $('#codeResult').classList.add('hidden')
  $('#codeCreateView').classList.toggle('hidden', mode !== 'create')
  $('#codeAcceptView').classList.toggle('hidden', mode !== 'accept')
  $('#codeDialogTitle').textContent = mode === 'create' ? '安全邀请同事' : '加入多人会话'
  $('#codeDialogEyebrow').textContent = mode === 'create' ? '仅当前会话有效' : '输入同事发来的邀请信息'
}

$$('[data-auth-tab]').forEach(button => button.addEventListener('click', () => {
  $$('[data-auth-tab]').forEach(tab => tab.classList.toggle('active', tab === button))
  $('#loginForm').classList.toggle('hidden', button.dataset.authTab !== 'login')
  $('#registerForm').classList.toggle('hidden', button.dataset.authTab !== 'register')
}))

$$('[data-close-dialog]').forEach(button => button.addEventListener('click', () => button.closest('dialog').close()))
$('#newConversationForm').addEventListener('change', event => { if (event.target.name === 'visibility') toggleCreateFields() })
$('#promoteForm').addEventListener('change', event => { if (event.target.name === 'shareMode') toggleShareFields() })

$('#loginForm').addEventListener('submit', async event => {
  event.preventDefault()
  try { await api('/api/login', { method: 'POST', body: Object.fromEntries(new FormData(event.currentTarget)) }); await bootstrap() } catch (error) { toast(error.message, 'error') }
})

$('#registerForm').addEventListener('submit', async event => {
  event.preventDefault()
  try {
    const result = await api('/api/register', { method: 'POST', body: Object.fromEntries(new FormData(event.currentTarget)) })
    history.replaceState({}, '', '/')
    await bootstrap()
    await openSession('shared', result.roomId)
  } catch (error) { toast(error.message, 'error') }
})

$('#setupForm').addEventListener('submit', async event => {
  event.preventDefault()
  try { await api('/api/setup', { method: 'POST', body: Object.fromEntries(new FormData(event.currentTarget)) }); history.replaceState({}, '', '/'); await bootstrap() } catch (error) { toast(error.message, 'error') }
})

async function logout() {
  try { await api('/api/logout', { method: 'POST', body: {} }); location.reload() } catch (error) { toast(error.message, 'error') }
}

$('#logoutButton').addEventListener('click', logout)

$('#railAvatar').addEventListener('click', openProfile)
$('#profileForm').addEventListener('submit', async event => {
  event.preventDefault()
  try {
    const form = event.currentTarget
    const file = form.elements.avatarImage.files?.[0]
    const image = await imageData(file)
    const glyph = form.elements.avatar.value
    const color = form.elements.color.value
    const result = await api('/api/profile', { method: 'PATCH', body: {
      displayName: form.elements.displayName.value,
      avatar: glyph,
      color,
      avatarView: image ? { glyph: 'image', color, image } : { glyph, color },
    } })
    state.user = result.user
    state.bootstrap.ui = { ...(state.bootstrap.ui ?? {}), userAvatar: result.user.avatarView }
    paintAvatar($('#railAvatar'), currentUserAvatar(), state.user.color)
    $('#profileDialog').close()
    toast('个人资料已保存')
  } catch (error) { toast(error.message, 'error') }
})

$('#newConversationButton').addEventListener('click', () => { $('#newConversationDialog').showModal(); toggleCreateFields() })
$('#sessionSearch').addEventListener('input', event => {
  state.query = event.target.value
  renderSessionList()
})
$('#sessionViewButton').addEventListener('click', () => {
  toast('当前已按最近交互排列；工作区视图会继续沿用本机 Harness 的分组')
})
$('#pinnedNote').addEventListener('click', () => toast('置顶备注请在本机 Harness 编辑，会自动安全同步到这里'))
$('#pluginButton').addEventListener('click', () => $('#pluginDialog').showModal())
$('#pluginRailButton').addEventListener('click', () => $('#pluginDialog').showModal())
$('#taskRailButton').addEventListener('click', () => toast('可以直接说“每天 9 点在这个会话问候我”，确认后会进入任务看板'))
$('#settingsRailButton').addEventListener('click', openSettings)
$('#settingsProfileButton').addEventListener('click', () => { $('#settingsDialog').close(); openProfile() })
$('#settingsJoinButton').addEventListener('click', () => { $('#settingsDialog').close(); showInviteDialog('accept') })
$('#settingsLogoutButton').addEventListener('click', logout)
for (const [id, label] of [
  ['attachmentButton', '附件会按当前会话的可见范围发送'],
  ['modeButton', '多人 AI 模式请在右上角会话详情中设置'],
  ['branchButton', '分支与子 Agent 会显示在当前对话中'],
  ['terminalButton', '命令仍由本机 Harness 在白名单工作区执行'],
  ['permissionButton', '权限由会话群主或管理员控制'],
]) {
  $(`#${id}`).addEventListener('click', () => toast(label))
}
$('#newConversationForm').addEventListener('submit', async event => {
  event.preventDefault()
  const body = Object.fromEntries(new FormData(event.currentTarget))
  body.agentEnabled = Boolean(event.currentTarget.elements.agentEnabled?.checked)
  if (body.visibility === 'shared') body.name = body.title || '新的多人会话'
  try {
    const result = await api('/api/conversations', { method: 'POST', body })
    $('#newConversationDialog').close()
    event.currentTarget.reset()
    toggleCreateFields()
    if (result.kind === 'room') state.rooms.unshift(result.room)
    else state.conversations.unshift(result.conversation)
    await openSession(result.kind === 'room' ? 'shared' : 'private', result.kind === 'room' ? result.room.id : result.conversation.id)
    if (result.kind === 'room') showInviteDialog('create')
  } catch (error) { toast(error.message, 'error') }
})

$('#promoteButton').addEventListener('click', () => {
  const conversation = state.conversationData?.conversation
  if (!conversation) return
  $('#promoteForm [name="name"]').value = conversation.title
  $('#promoteDialog').showModal()
  toggleShareFields()
})

$('#promoteForm').addEventListener('submit', async event => {
  event.preventDefault()
  const body = Object.fromEntries(new FormData(event.currentTarget))
  body.confirmFullHistory = event.currentTarget.elements.confirmFullHistory.checked
  try {
    const result = await api(`/api/conversations/${state.current.id}/promote`, { method: 'POST', body })
    state.rooms.unshift(result.room)
    $('#promoteDialog').close()
    await openSession('shared', result.room.id)
    showInviteDialog('create')
  } catch (error) { toast(error.message, 'error') }
})

$('#composer').addEventListener('submit', async event => {
  event.preventDefault()
  const textarea = event.currentTarget.elements.text
  const text = textarea.value.trim()
  if (!text || !state.current) return
  textarea.value = ''
  textarea.disabled = true
  try {
    if (currentIs('private')) {
      $('#sessionSubtitle').textContent = 'AI 正在处理…'
      await api(`/api/conversations/${state.current.id}/messages`, { method: 'POST', body: { text } })
      state.conversationData = await api(`/api/conversations/${state.current.id}`)
      const index = state.conversations.findIndex(row => row.id === state.current.id)
      if (index >= 0) state.conversations[index] = { ...state.conversations[index], ...state.conversationData.conversation }
      renderPrivate()
    } else {
      await api(`/api/rooms/${state.current.id}/messages`, { method: 'POST', body: { text } })
      await refreshRoom()
    }
  } catch (error) { textarea.value = text; toast(error.message, 'error') }
  finally { textarea.disabled = false; textarea.focus() }
})

$('#composer textarea').addEventListener('keydown', event => {
  if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); $('#composer').requestSubmit() }
})

$('#sessionBadge').addEventListener('click', event => { event.stopPropagation(); showSessionCard() })
$('#sessionCard').addEventListener('click', event => event.stopPropagation())
document.addEventListener('click', () => $('#sessionCard').classList.add('hidden'))

$('#detailsButton').addEventListener('click', openDetails)
$('#closeDetails').addEventListener('click', closeDetails)
$('#agentToggle').addEventListener('change', async event => {
  try { await api(`/api/rooms/${state.current.id}/agent`, { method: 'POST', body: { enabled: event.target.checked } }); await refreshRoom() } catch (error) { event.target.checked = !event.target.checked; toast(error.message, 'error') }
})
$('#quietSeconds').addEventListener('input', event => { $('#quietValue').textContent = `${event.target.value} 秒` })
$('#saveSettingsButton').addEventListener('click', async () => {
  try {
    await api(`/api/rooms/${state.current.id}/settings`, { method: 'PATCH', body: { brief: $('#roomBrief').value, approvalMode: $('#approvalMode').value, quietSeconds: Number($('#quietSeconds').value) } })
    toast('协作规则已保存')
    await refreshRoom()
  } catch (error) { toast(error.message, 'error') }
})
$('#forceProposalButton').addEventListener('click', async () => {
  try { const result = await api(`/api/rooms/${state.current.id}/propose`, { method: 'POST', body: {} }); if (!result.proposal) toast('当前没有可整理的授权消息'); await refreshRoom() } catch (error) { toast(error.message, 'error') }
})

$('#privatizeButton').addEventListener('click', async () => {
  if (!confirm('确认撤销当前会话的所有邀请码，并把它收回为只有你可见的私人会话吗？')) return
  try {
    const result = await api(`/api/rooms/${state.current.id}/privatize`, { method: 'POST', body: {} })
    state.rooms = state.rooms.filter(room => room.id !== state.current.id)
    state.conversations.unshift(result.conversation)
    closeDetails()
    await openSession('private', result.conversation.id)
    toast('已收回为私人会话')
  } catch (error) { toast(error.message, 'error') }
})

$('#inviteButton').addEventListener('click', () => showInviteDialog('create'))
$('#joinButton').addEventListener('click', () => showInviteDialog('accept'))
$('#createCodeButton').addEventListener('click', async () => {
  try {
    const result = await api(`/api/rooms/${state.current.id}/invites`, { method: 'POST', body: { hours: 24, uses: 10 } })
    const link = `${location.origin}/?invite=${encodeURIComponent(result.code)}`
    $('#inviteCodeText').textContent = result.code
    $('#inviteLinkText').textContent = link
    $('#codeResult').classList.remove('hidden')
    $('#codeCreateView').classList.add('hidden')
  } catch (error) { toast(error.message, 'error') }
})
$('#copyCodeButton').addEventListener('click', async () => {
  const text = `邀请你加入多人 Harness 会话\n邀请码：${$('#inviteCodeText').textContent}\n入口：${$('#inviteLinkText').textContent}`
  await navigator.clipboard.writeText(text)
  toast('邀请信息已复制')
})
$('#acceptCodeButton').addEventListener('click', async () => {
  try {
    const result = await api('/api/invites/accept', { method: 'POST', body: { inviteCode: $('#acceptCodeInput').value, roomPassword: $('#acceptRoomPassword').value } })
    state.rooms.unshift(result.room)
    $('#codeDialog').close()
    history.replaceState({}, '', '/')
    await openSession('shared', result.room.id)
  } catch (error) { toast(error.message, 'error') }
})

hydrateAvatarOptions()
bootstrap().catch(error => { showAuth({ setupRequired: false }, '', null); toast(`无法连接服务：${error.message}`, 'error') })
