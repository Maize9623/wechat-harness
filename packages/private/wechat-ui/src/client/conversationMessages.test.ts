import assert from 'node:assert/strict'
import test from 'node:test'
import {
  firstOutlineTurnSeq,
  mergeLeadingUserMessages,
  messagesOf,
  needsLeadingUser,
  oldestEventSeq,
  userMessagesFromHistory,
} from './conversationMessages.ts'

const RULES = '<<<DSH_DIY_GLOBAL_RESPONSE_RULES>>>界面语言强制规则<<<END_DSH_DIY_GLOBAL_RESPONSE_RULES>>>\n<<<DSH_DIY_USER_MESSAGE>>>\n测试'

test('messagesOf keeps the opening user bubble when the window still has it', () => {
  const messages = messagesOf({
    nodes: [
      { kind: 'user', seq: 2, time: 1_700_000_000_000, content: [{ type: 'text', text: RULES }] },
      { kind: 'assistant', seq: 8, time: 1_700_000_060_000, blocks: [{ kind: 'text', text: '要做这个日历' }] },
    ],
    partial: null,
  })
  assert.equal(messages[0]?.role, 'user')
  assert.equal(messages[0]?.body, '测试')
  assert.equal(messages[1]?.role, 'assistant')
  assert.equal(messages[1]?.body, '要做这个日历')
})

test('messagesOf recovers a context node that still carries the typed user line', () => {
  const messages = messagesOf({
    nodes: [
      { kind: 'context', seq: 2, time: 1_700_000_000_000, content: [{ type: 'text', text: RULES }] },
      { kind: 'assistant', seq: 8, blocks: [{ kind: 'text', text: '要做这个日历' }] },
    ],
    partial: null,
  })
  assert.equal(messages[0]?.role, 'user')
  assert.equal(messages[0]?.body, '测试')
})

test('needsLeadingUser is true when the window starts on an assistant reply', () => {
  assert.equal(needsLeadingUser([]), false)
  assert.equal(needsLeadingUser([{ id: 'u', role: 'user', body: '测试' }]), false)
  assert.equal(needsLeadingUser([{ id: 'a', role: 'assistant', body: '要做这个日历' }]), true)
  assert.equal(needsLeadingUser([
    { id: 'a', role: 'assistant', body: '要做这个日历' },
    { id: 'u', role: 'user', body: '补充一句' },
  ]), true)
})

test('userMessagesFromHistory unwraps page records and skips non-user sources', () => {
  const messages = userMessagesFromHistory([
    {
      event: {
        type: 'user/message',
        seq: 4,
        time: 1_700_000_000_000,
        data: { source: { kind: 'plugin', plugin: 'compact' }, content: [{ type: 'text', text: '摘要' }] },
      },
    },
    {
      event: {
        type: 'user/message',
        seq: 2,
        time: 1_700_000_000_000,
        data: { source: { kind: 'user' }, content: [{ type: 'text', text: RULES }] },
      },
    },
    {
      event: {
        type: 'assistant/message',
        seq: 8,
        data: { message: { content: [{ type: 'text', text: '要做这个日历' }] } },
      },
    },
  ])
  assert.deepEqual(messages.map(message => ({ id: message.id, body: message.body })), [
    { id: 'history-user-2', body: '测试' },
  ])
})

test('mergeLeadingUserMessages prepends recovered users without duplicating a later window row', () => {
  const merged = mergeLeadingUserMessages(
    [{ id: 'assistant-8', role: 'assistant', body: '要做这个日历' }],
    [{ id: 'history-user-2', role: 'user', body: '测试' }],
  )
  assert.deepEqual(merged.map(message => message.body), ['测试', '要做这个日历'])
  assert.deepEqual(mergeLeadingUserMessages(
    [{ id: 'user-2', role: 'user', body: '测试' }, { id: 'assistant-8', role: 'assistant', body: '要做这个日历' }],
    [{ id: 'history-user-2', role: 'user', body: '测试' }],
  ).map(message => message.id), ['user-2', 'assistant-8'])
})

test('firstOutlineTurnSeq and oldestEventSeq read the paging cursors', () => {
  assert.equal(firstOutlineTurnSeq([{ turn: 1, seq: 0, prompt: RULES.slice(0, 50), response: '' }]), 0)
  assert.equal(firstOutlineTurnSeq({ turns: [{ turn: 1, seq: 3, prompt: '测试', response: '' }] }), 3)
  assert.equal(firstOutlineTurnSeq([]), undefined)
  assert.equal(oldestEventSeq([
    { event: { type: 'assistant/message', seq: 18 } },
    { event: { type: 'user/message', seq: 2 } },
    { type: 'tool/result', seq: 11 },
  ]), 2)
})
