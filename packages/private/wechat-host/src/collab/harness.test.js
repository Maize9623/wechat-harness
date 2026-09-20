import assert from 'node:assert/strict'
import test from 'node:test'
import { createServer } from 'node:http'
import { HarnessBridge } from './harness.js'

test('Harness event stream reconnects and replays a pending native question', async t => {
  const previousWebSocket = globalThis.WebSocket
  let connections = 0
  class FakeWebSocket extends EventTarget {
    constructor() {
      super()
      connections += 1
      const connection = connections
      queueMicrotask(() => {
        this.dispatchEvent(new Event('open'))
        if (connection === 1) {
          const closed = new Event('close')
          Object.defineProperty(closed, 'code', { value: 1006 })
          this.dispatchEvent(closed)
          return
        }
        this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify({
          rpcId: 'question-after-reconnect',
          payload: {
            type: 'question/requested', sessionId: 'reconnect-session',
            questions: [{ id: 'continue', question: '请确认继续方向' }],
          },
        }) }))
      })
    }

    close() {}
  }
  globalThis.WebSocket = FakeWebSocket
  t.after(() => { globalThis.WebSocket = previousWebSocket })

  const bridge = new HarnessBridge({ baseUrl: 'http://127.0.0.1:3080', logger: { warn() {} } })
  const controller = new AbortController()
  let disconnects = 0
  let resolveQuestion
  const question = new Promise(resolve => { resolveQuestion = resolve })
  const watching = bridge.watchSession('reconnect-session', {
    disconnect: () => { disconnects += 1 },
    question: pending => {
      resolveQuestion(pending)
      controller.abort()
    },
  }, controller.signal)

  const pending = await question
  await watching
  assert.equal(connections, 2)
  assert.equal(disconnects, 1)
  assert.equal(pending.key, 'question-after-reconnect')
  assert.equal(pending.questions[0].question, '请确认继续方向')
})

test('private history keeps reasoning and tool lifecycle in native order', () => {
  const bridge = new HarnessBridge({ baseUrl: 'http://127.0.0.1:0' })
  const messages = bridge.historyMessages({ events: [
    { event: { type: 'user/message', seq: 1, time: 10, data: { source: { kind: 'user' }, content: [{ type: 'text', text: '请创建文件' }] } } },
    { event: { type: 'assistant/message', seq: 2, time: 20, data: { message: { content: [{ type: 'reasoning', text: '先确认目标路径。' }, { type: 'text', text: '我先创建文件。' }, { type: 'tool-call' }] } } } },
    { event: { type: 'tool/call', seq: 3, time: 30, data: { callId: 'call-1', name: 'write' } } },
    { event: { type: 'tool/result', seq: 4, time: 40, data: { message: { source: { kind: 'tool', callId: 'call-1' }, content: [{ type: 'tool-result', toolCallId: 'call-1', isError: false }] } } } },
    { event: { type: 'assistant/message', seq: 5, time: 50, data: { message: { content: [{ type: 'text', text: '文件已创建。' }] } } } },
  ] })

  assert.deepEqual(messages.map(message => message.role), ['user', 'assistant', 'status', 'status', 'assistant'])
  assert.equal(messages[1].reasoning, '先确认目标路径。')
  assert.equal(messages[2].text, '正在使用写入文件…')
  assert.equal(messages[3].text, '工具执行完成：写入文件')
})

test('complete private history follows every Harness history page in chronological order', async () => {
  const bridge = new HarnessBridge({ baseUrl: 'http://127.0.0.1:0' })
  const requests = []
  bridge.rpc = async (method, payload) => {
    assert.equal(method, 'session.history')
    requests.push(payload)
    const seqs = payload.beforeSeq === undefined ? [3, 4] : [1, 2]
    return {
      hasMore: payload.beforeSeq === undefined,
      events: seqs.map(seq => ({ event: {
        type: 'user/message', seq, time: seq * 10,
        data: { source: { kind: 'user' }, content: [{ type: 'text', text: `消息 ${seq}` }] },
      } })),
    }
  }

  const messages = await bridge.historyAll('session-all', 2)
  assert.deepEqual(messages.map(message => message.text), ['消息 1', '消息 2', '消息 3', '消息 4'])
  assert.deepEqual(requests, [
    { sessionId: 'session-all', maxMessages: 2 },
    { sessionId: 'session-all', maxMessages: 2, beforeSeq: 3 },
  ])
})

test('failed tool result is labeled and ask-user lifecycle stays out of status pills', () => {
  const bridge = new HarnessBridge({ baseUrl: 'http://127.0.0.1:0' })
  const messages = bridge.historyMessages({ events: [
    { event: { type: 'tool/call', seq: 1, time: 10, data: { callId: 'question-1', name: 'ask_user_question' } } },
    { event: { type: 'tool/result', seq: 2, time: 20, data: { message: { source: { kind: 'tool', callId: 'question-1' }, content: [{ type: 'tool-result', toolCallId: 'question-1', isError: false }] } } } },
    { event: { type: 'tool/call', seq: 3, time: 30, data: { callId: 'call-2', name: 'bash' } } },
    { event: { type: 'tool/result', seq: 4, time: 40, data: { message: { source: { kind: 'tool', callId: 'call-2' }, content: [{ type: 'tool-result', toolCallId: 'call-2', isError: true }] } } } },
  ] })

  assert.deepEqual(messages.map(message => message.text), ['正在使用命令行…', '工具执行失败：命令行'])
})

test('visualize_html history keeps the replayable iframe payload but removes the host path', () => {
  const bridge = new HarnessBridge({ baseUrl: 'http://127.0.0.1:0' })
  const messages = bridge.historyMessages({ events: [
    { event: { type: 'tool/call', seq: 1, time: 10, data: { callId: 'visual-1', name: 'visualize_html' } } },
    { event: { type: 'tool/result', seq: 2, time: 20, data: {
      meta: { html: '<!doctype html><button>开始游戏</button>', path: '/private/host/game-inline.html', size: 42, truncated: false },
      message: { source: { kind: 'tool', callId: 'visual-1' }, content: [{ type: 'tool-result', toolCallId: 'visual-1', content: [], isError: false }] },
    } } },
  ] })

  const toolMessage = messages.find(message => message.role === 'tool')
  assert.equal(toolMessage.tool.toolName, 'visualize_html')
  assert.equal(toolMessage.tool.block.meta.path, 'game-inline.html')
  assert.equal(toolMessage.tool.block.meta.html, '<!doctype html><button>开始游戏</button>')
  assert.equal(messages.some(message => message.text === '工具执行完成：visualize_html'), true)
})

test('internal permission acknowledgements stay local while later replies remain visible', () => {
  const bridge = new HarnessBridge({ baseUrl: 'http://127.0.0.1:0' })
  const messages = bridge.historyMessages({ events: [
    { event: { type: 'user/message', seq: 1, time: 10, data: { source: { kind: 'user' }, content: [{ type: 'text', text: '/permission workspace-write' }] } } },
    { event: { type: 'assistant/message', seq: 2, time: 20, data: { message: { content: [{ type: 'reasoning', text: '用户输入了 /permission workspace-write。' }, { type: 'text', text: 'Workspace 写权限已开启，我可以修改文件。' }] } } } },
    { event: { type: 'user/message', seq: 3, time: 30, data: { source: { kind: 'user' }, content: [{ type: 'text', text: '继续完成斗地主。' }] } } },
    { event: { type: 'assistant/message', seq: 4, time: 40, data: { message: { content: [{ type: 'reasoning', text: '继续检查逻辑。' }, { type: 'text', text: '我继续修复游戏。' }] } } } },
    { event: { type: 'tool/call', seq: 5, time: 50, data: { callId: 'read-after-permission', name: 'read' } } },
  ] })

  assert.deepEqual(messages.map(message => message.text), ['继续完成斗地主。', '我继续修复游戏。', '正在使用读取文件…'])
  assert.equal(messages[1].reasoning, '继续检查逻辑。')
})

test('3091 question answers are returned through the native Harness response channel without exposing internals', async t => {
  let received
  const server = createServer(async (req, res) => {
    const chunks = []
    for await (const chunk of req) chunks.push(chunk)
    received = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ accepted: true }))
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(() => { server.close() })
  const address = server.address()
  const bridge = new HarnessBridge({ baseUrl: `http://127.0.0.1:${address.port}` })
  await bridge.respondQuestion({
    rpcId: 'native-question-1', sessionId: 'session-private-1',
    answers: [{ id: 'style', selected: ['科技感'], custom: '深色' }],
  })
  assert.equal(received.type, 'client-response')
  assert.equal(received.rpcId, 'native-question-1')
  assert.equal(received.result.value.sessionId, 'session-private-1')
  assert.deepEqual(received.result.value.answer.answers, [{ id: 'style', selected: ['科技感'], custom: '深色' }])
})

test('live Harness chunks become ordered reasoning, reply, and tool-status steps for 3091', async () => {
  const bridge = new HarnessBridge({ baseUrl: 'http://127.0.0.1:0', enabled: true })
  bridge.ensureRoutableModel = async () => ({ routable: true })
  let historyCalls = 0
  bridge.rpc = async method => {
    if (method === 'session.history') {
      historyCalls += 1
      return { events: [] }
    }
    if (method === 'session.prompt') return {}
    if (method === 'session.list') return { items: [{ sessionId: 'live-session', running: false }] }
    throw new Error(`unexpected rpc: ${method}`)
  }
  bridge.watchSession = async (_sessionId, handlers, signal) => {
    handlers.open()
    handlers.event({ seq: 1, type: 'assistant/chunk', data: { chunk: { type: 'reasoning-delta', text: '先检查代码。' } } })
    handlers.event({ seq: 2, type: 'assistant/chunk', data: { chunk: { type: 'text-delta', text: '我先读取关键文件。' } } })
    handlers.event({ seq: 3, type: 'assistant/message', data: { message: { content: [{ type: 'reasoning', text: '先检查代码。' }, { type: 'text', text: '我先读取关键文件。' }] } } })
    handlers.event({ seq: 4, type: 'tool/call', data: { callId: 'read-1', name: 'read' } })
    handlers.event({ seq: 5, type: 'tool/result', data: { message: { source: { callId: 'read-1' }, content: [{ type: 'tool-result', toolCallId: 'read-1', isError: false }] } } })
    await new Promise(resolve => signal.addEventListener('abort', resolve, { once: true }))
  }
  const snapshots = []
  const result = await bridge.executeSession({ sessionId: 'live-session', prompt: '测试', onProgress: progress => { snapshots.push(progress) } })
  assert.ok(historyCalls >= 2)
  assert.deepEqual(result.steps.map(step => step.kind), ['assistant', 'status', 'status'])
  assert.equal(result.steps[0].reasoning, '先检查代码。')
  assert.equal(result.steps[0].text, '我先读取关键文件。')
  assert.equal(result.steps[1].text, '正在使用读取文件…')
  assert.equal(result.steps[2].text, '工具执行完成：读取文件')
  assert.ok(snapshots.some(snapshot => snapshot.steps?.some(step => step.kind === 'assistant')))
})

test('live group bridge starts after the internal permission preamble', async () => {
  const bridge = new HarnessBridge({ baseUrl: 'http://127.0.0.1:0', enabled: true })
  bridge.ensureRoutableModel = async () => ({ routable: true })
  bridge.rpc = async method => {
    if (method === 'session.history') return { events: [] }
    if (method === 'session.prompt') return {}
    if (method === 'session.list') return { items: [{ sessionId: 'group-session', running: false }] }
    throw new Error(`unexpected rpc: ${method}`)
  }
  bridge.watchSession = async (_sessionId, handlers, signal) => {
    handlers.open()
    handlers.event({ seq: 1, type: 'assistant/chunk', data: { chunk: { type: 'reasoning-delta', text: '用户输入了 /permission workspace-write。' } } })
    handlers.event({ seq: 2, type: 'assistant/message', data: { message: { content: [{ type: 'text', text: 'Workspace 写权限已开启，我可以修改文件。' }] } } })
    handlers.event({ seq: 3, type: 'user/message', data: { source: { kind: 'user' }, content: [{ type: 'text', text: '真正的群聊需求' }] } })
    handlers.event({ seq: 4, type: 'assistant/chunk', data: { chunk: { type: 'reasoning-delta', text: '处理真正需求。' } } })
    handlers.event({ seq: 5, type: 'assistant/message', data: { message: { content: [{ type: 'reasoning', text: '处理真正需求。' }, { type: 'text', text: '这是群聊真正需要看到的回复。' }] } } })
    await new Promise(resolve => signal.addEventListener('abort', resolve, { once: true }))
  }
  const result = await bridge.executeSession({
    sessionId: 'group-session', prompt: '真正的群聊需求', ignorePermissionPreamble: true,
  })
  assert.equal(result.steps.length, 1)
  assert.equal(result.steps[0].reasoning, '处理真正需求。')
  assert.equal(result.steps[0].text, '这是群聊真正需要看到的回复。')
})
