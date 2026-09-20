import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DshServiceManager, serviceInternals } from '../services.js'
import { CollaborationServer } from './server.js'

function fakeContext() {
  const ownerAgent = { session: { id: 'session-owner' } }
  const rows = [
    { id: 'bash-1', kind: 'bash', label: 'node server.js --port 8080', ownerSession: 'session-owner', status: 'running', startedAt: 100, reported: false },
    { id: 'bash-2', kind: 'bash', label: 'python -m http.server 9090', status: 'running', startedAt: 200, reported: false },
    { id: 'bash-3', kind: 'bash', label: 'node host.js --port 3080', ownerSession: 'session-owner', status: 'running', startedAt: 300, reported: false },
    { id: 'subagent-1', kind: 'subagent', label: '后台代理', ownerSession: 'session-owner', status: 'running', startedAt: 400, reported: false },
    { id: 'bash-4', kind: 'bash', label: 'node finished.js --port 7070', ownerSession: 'session-owner', status: 'completed', startedAt: 500, reported: false },
  ]
  const killed = []
  return {
    ownerAgent,
    killed,
    ctx: {
      jobs: {
        list(caller) {
          if (caller === undefined) return rows.filter(row => row.ownerSession === undefined)
          if (caller === ownerAgent) return rows.filter(row => row.ownerSession === 'session-owner' || row.ownerSession === undefined)
          return []
        },
        kill(id, caller, reason) { killed.push({ id, caller, reason }); return 'requested' },
      },
      sessions: { list: () => [{ id: 'session-owner' }] },
      agents: { get: id => id === 'session-owner' ? ownerAgent : undefined },
    },
  }
}

test('service manager enumerates live DSH jobs once, infers addresses, and protects Harness ports', () => {
  const { ctx } = fakeContext()
  const manager = new DshServiceManager(ctx)
  assert.deepEqual(manager.list().map(service => service.id), ['bash-2', 'bash-1'])
  assert.equal(manager.list().find(service => service.id === 'bash-1').url, 'http://127.0.0.1:8080/')
  assert.equal(manager.list().find(service => service.id === 'bash-2').port, 9090)
  assert.throws(() => manager.stop('bash-3'), /Harness 自身服务不能/)
  assert.equal(serviceInternals.inferredPort('vite --host 0.0.0.0 --port=4173'), 4173)
})

test('service manager honors session ownership when stopping a job', () => {
  const { ctx, ownerAgent, killed } = fakeContext()
  const manager = new DshServiceManager(ctx)
  assert.throws(() => manager.stop('bash-1', new Set(['another-session'])), /无权关闭/)
  const stopped = manager.stop('bash-1', new Set(['session-owner']))
  assert.equal(stopped.status, 'stopping')
  assert.deepEqual(killed, [{ id: 'bash-1', caller: ownerAgent, reason: '用户从运行服务面板关闭' }])
})

test('room online state follows 3091 page presence and keeps an account online while any tab remains', async t => {
  const dataDir = mkdtempSync(join(tmpdir(), 'dsh-collab-presence-'))
  const server = new CollaborationServer({
    host: '127.0.0.1', port: 0, dataDir,
    allowedWorkspaces: [{ id: 'safe', label: '测试空间', path: dataDir }],
  }, { log() {}, error() {}, warn() {} })
  t.after(async () => { await server.stop(); rmSync(dataDir, { recursive: true, force: true }) })
  server.store.transact(state => {
    state.users.owner = { id: 'owner', username: 'owner', displayName: '群主', serverRole: 'host-owner' }
    state.users.member = { id: 'member', username: 'member', displayName: '成员', serverRole: 'member' }
    state.rooms.room = {
      id: 'room', name: '在线状态群', ownerId: 'owner', workspaceId: 'safe', createdAt: Date.now(),
      members: {
        owner: { role: 'owner', aiAccess: true, joinedAt: 1, lastReadAt: 1 },
        member: { role: 'member', aiAccess: true, joinedAt: 2, lastReadAt: 1 },
      },
      agent: { enabled: false, state: 'off', lastCheckpointAt: 1, proposalVersion: 0 },
    }
  })
  assert.equal(server.roomState(server.store.state.rooms.room, 'owner').users.member.online, false)
  server.setPresence('member', 'page_first', true)
  server.setPresence('member', 'page_second', true)
  assert.equal(server.roomState(server.store.state.rooms.room, 'owner').users.member.online, true)
  server.setPresence('member', 'page_first', false)
  assert.equal(server.roomState(server.store.state.rooms.room, 'owner').users.member.online, true)
  server.setPresence('member', 'page_second', false)
  assert.equal(server.roomState(server.store.state.rooms.room, 'owner').users.member.online, false)
})
