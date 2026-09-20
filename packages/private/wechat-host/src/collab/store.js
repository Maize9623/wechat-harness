import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { randomBytes, randomUUID, scryptSync, timingSafeEqual, createHash } from 'node:crypto'

const STATE_VERSION = 3

export function now() {
  return Date.now()
}

export function makeId(prefix) {
  return `${prefix}_${randomUUID().replaceAll('-', '')}`
}

export function makeCode(bytes = 9) {
  return randomBytes(bytes).toString('base64url')
}

export function sha256(value) {
  return createHash('sha256').update(String(value)).digest('hex')
}

export function normalizeUsername(value) {
  return String(value ?? '').trim().toLowerCase().replace(/\s+/g, '')
}

export function hashPassword(password, salt = randomBytes(16).toString('hex')) {
  const hash = scryptSync(String(password), salt, 64).toString('hex')
  return { salt, hash }
}

export function verifyPassword(password, record) {
  if (!record?.salt || !record?.hash) return false
  const actual = scryptSync(String(password), record.salt, 64)
  const expected = Buffer.from(record.hash, 'hex')
  return actual.length === expected.length && timingSafeEqual(actual, expected)
}

function emptyState() {
  return {
    version: STATE_VERSION,
    users: {},
    sessions: {},
    conversations: {},
    rooms: {},
    invites: {},
    messages: [],
    proposals: {},
    runs: {},
    auditLog: [],
  }
}

function migrateState(input) {
  const state = input && typeof input === 'object' ? input : emptyState()
  const migrated = {
    ...emptyState(),
    ...state,
    version: STATE_VERSION,
    users: state.users ?? {},
    sessions: state.sessions ?? {},
    conversations: state.conversations ?? {},
    rooms: state.rooms ?? {},
    invites: state.invites ?? {},
    messages: Array.isArray(state.messages) ? state.messages : [],
    proposals: state.proposals ?? {},
    runs: state.runs ?? {},
    auditLog: Array.isArray(state.auditLog) ? state.auditLog : [],
  }
  const users = Object.values(migrated.users).sort((left, right) => Number(left?.createdAt ?? 0) - Number(right?.createdAt ?? 0))
  const hasHostOwner = users.some(user => user?.serverRole === 'host-owner')
  for (const user of users) {
    user.avatar ??= 'whale'
    user.serverRole ??= !hasHostOwner && user === users[0] ? 'host-owner' : 'user'
  }
  return migrated
}

export class CollabStore {
  constructor(dataDir) {
    this.dataDir = dataDir
    this.file = join(dataDir, 'state.json')
    mkdirSync(dataDir, { recursive: true, mode: 0o700 })
    this.state = existsSync(this.file)
      ? migrateState(JSON.parse(readFileSync(this.file, 'utf8')))
      : emptyState()
    this.cleanup()
    this.save()
  }

  save() {
    mkdirSync(dirname(this.file), { recursive: true, mode: 0o700 })
    const temp = `${this.file}.tmp`
    writeFileSync(temp, `${JSON.stringify(this.state, null, 2)}\n`, { mode: 0o600 })
    renameSync(temp, this.file)
  }

  cleanup(at = now()) {
    for (const [key, session] of Object.entries(this.state.sessions)) {
      if (!session || session.expiresAt <= at) delete this.state.sessions[key]
    }
    for (const [key, invite] of Object.entries(this.state.invites)) {
      if (!invite || invite.expiresAt <= at || invite.remainingUses <= 0) delete this.state.invites[key]
    }
  }

  transact(mutator) {
    this.cleanup()
    const value = mutator(this.state)
    this.save()
    return value
  }

  hasUsers() {
    return Object.keys(this.state.users).length > 0
  }

  createUser({ username, displayName, password, color = '#3478f6', avatar = 'whale', serverRole = 'user' }) {
    const handle = normalizeUsername(username)
    if (!/^[a-z0-9_\u4e00-\u9fff-]{2,24}$/u.test(handle)) {
      throw new Error('账号需为 2–24 位中文、字母、数字、下划线或短横线')
    }
    if (String(displayName ?? '').trim().length < 1 || String(displayName).trim().length > 32) {
      throw new Error('显示名称需为 1–32 个字符')
    }
    if (String(password ?? '').length < 8 || String(password).length > 128) {
      throw new Error('密码至少 8 位，最多 128 位')
    }
    if (Object.values(this.state.users).some(user => user.username === handle)) {
      throw new Error('账号已存在')
    }
    const user = {
      id: makeId('usr'),
      username: handle,
      displayName: String(displayName).trim(),
      color,
      avatar: ['whale', 'code', 'spark', 'folder', 'robot'].includes(String(avatar)) ? String(avatar) : 'whale',
      serverRole: serverRole === 'host-owner' ? 'host-owner' : 'user',
      password: hashPassword(password),
      createdAt: now(),
    }
    this.state.users[user.id] = user
    return user
  }

  createSession(userId) {
    const token = makeCode(32)
    const tokenHash = sha256(token)
    const session = {
      userId,
      csrf: makeCode(18),
      createdAt: now(),
      expiresAt: now() + 14 * 24 * 60 * 60 * 1000,
    }
    this.state.sessions[tokenHash] = session
    const user = this.state.users[userId]
    if (user) user.lastLoginAt = now()
    return { token, session }
  }

  authenticate(token) {
    if (!token) return undefined
    const session = this.state.sessions[sha256(token)]
    if (!session || session.expiresAt <= now()) return undefined
    const user = this.state.users[session.userId]
    return user && !user.disabledAt ? { user, session } : undefined
  }

  publicUser(user, includeServerRole = false) {
    return user && {
      id: user.id,
      username: user.username,
      displayName: user.displayName,
      color: user.color,
      avatar: user.avatar ?? 'whale',
      avatarView: user.avatarView,
      createdAt: user.createdAt,
      lastLoginAt: user.lastLoginAt,
      ...(includeServerRole ? { serverRole: user.serverRole ?? 'user', disabledAt: user.disabledAt } : {}),
    }
  }
}
