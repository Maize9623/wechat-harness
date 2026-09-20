import assert from 'node:assert/strict'
import test from 'node:test'
import { fetchGroupChatEntry, GROUP_CHAT_WINDOW_NAME, launchGroupChatWindow, openGroupChatWindow } from './groupChatEntry.ts'

test('fetchGroupChatEntry returns the sidecar URL when it is listening', async () => {
  const url = await fetchGroupChatEntry(async () => Response.json({
    ok: true,
    running: true,
    url: 'http://127.0.0.1:3191/?setup=abc',
  }))
  assert.equal(url, 'http://127.0.0.1:3191/?setup=abc')
})

test('fetchGroupChatEntry keeps the single-user window usable when the sidecar is down', async () => {
  await assert.rejects(
    () => fetchGroupChatEntry(async () => Response.json({ ok: false, running: false, error: 'down' }, { status: 503 })),
    /down/u,
  )
})

test('openGroupChatWindow reuses one named Desktop window', () => {
  const calls: Array<[string, string]> = []
  openGroupChatWindow('http://127.0.0.1:3191/', (href, target) => {
    calls.push([href, target])
    return {} as Window
  })
  assert.deepEqual(calls, [['http://127.0.0.1:3191/', GROUP_CHAT_WINDOW_NAME]])
})

test('openGroupChatWindow treats a blocked window.open as success', () => {
  openGroupChatWindow('http://127.0.0.1:3191/', () => null)
})

test('launchGroupChatWindow prefers the Desktop shell IPC', async () => {
  const opened: string[] = []
  ;(globalThis as { dshDesktop?: { groupChat: { open: (url: string) => Promise<void> } } }).dshDesktop = {
    groupChat: { open: async (url) => { opened.push(url) } },
  }
  await launchGroupChatWindow('http://127.0.0.1:3191/')
  assert.deepEqual(opened, ['http://127.0.0.1:3191/'])
  delete (globalThis as { dshDesktop?: unknown }).dshDesktop
})

test('launchGroupChatWindow still succeeds when Desktop IPC rejects after opening', async () => {
  const opened: string[] = []
  ;(globalThis as { dshDesktop?: { groupChat: { open: (url: string) => Promise<void> } } }).dshDesktop = {
    groupChat: { open: async () => { throw new Error('invoke rejected') } },
  }
  await launchGroupChatWindow('http://127.0.0.1:3191/', (href, target) => {
    opened.push(`${target}:${href}`)
    return null
  })
  assert.deepEqual(opened, [`${GROUP_CHAT_WINDOW_NAME}:http://127.0.0.1:3191/`])
  delete (globalThis as { dshDesktop?: unknown }).dshDesktop
})
