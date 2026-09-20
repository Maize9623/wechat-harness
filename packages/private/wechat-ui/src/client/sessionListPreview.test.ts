import assert from 'node:assert/strict'
import test from 'node:test'
import { sessionFallbackPreview, sessionOutlinePreview, sessionRowPreview } from './sessionListPreview.ts'

test('sessionFallbackPreview never mentions a workspace path', () => {
  assert.equal(sessionFallbackPreview({ awaitingQuestion: true }), '等待你的回答')
  assert.equal(sessionFallbackPreview({ running: true }), 'DeepSeek 正在处理…')
  assert.equal(sessionFallbackPreview({ blank: true }), '开始新的对话')
  assert.equal(sessionFallbackPreview({}), '继续上次的对话')
})

test('sessionRowPreview prefers the latest message over a status line', () => {
  assert.equal(sessionRowPreview({
    fallback: 'DeepSeek 正在处理…',
    conversationPreview: '已经写好了登录页',
  }), '已经写好了登录页')
  assert.equal(sessionRowPreview({ fallback: '继续上次的对话' }), '继续上次的对话')
})

test('sessionOutlinePreview uses the latest reply, or the latest prompt while a turn is open', () => {
  assert.equal(sessionOutlinePreview([
    { turn: 1, seq: 1, prompt: '你好', response: '我是助手' },
    { turn: 2, seq: 8, prompt: '打开计算器', response: '' },
  ]), '打开计算器')
  assert.equal(sessionOutlinePreview({
    turns: [{ turn: 1, seq: 1, prompt: '你好', response: '产品和结论都是真的' }],
    draft: '',
  }), '产品和结论都是真的')
  assert.equal(sessionOutlinePreview([]), undefined)
})

test('sessionOutlinePreview strips markdown heading marks from the latest reply', () => {
  assert.equal(sessionOutlinePreview([
    { turn: 1, seq: 1, prompt: '算一下', response: '## 结论：计算器打开了，结果是 27' },
  ]), '结论：计算器打开了，结果是 27')
})
