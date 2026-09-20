import { fileMetadataFromPrompt } from '../file-attachments.js'

const WAIT_INTERVAL_MS = 1_500
const RUN_TIMEOUT_MS = 15 * 60 * 1000
const PROGRESS_TEXT_LIMIT = 160_000
const VISUAL_HTML_LIMIT = 1_500_000
const EVENT_STREAM_RECONNECT_MIN_MS = 350
const EVENT_STREAM_RECONNECT_MAX_MS = 4_000

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function waitForReconnect(ms, signal) {
  return new Promise(resolve => {
    let timer
    const finish = () => {
      if (timer !== undefined) clearTimeout(timer)
      signal.removeEventListener('abort', finish)
      resolve()
    }
    timer = setTimeout(finish, ms)
    signal.addEventListener('abort', finish, { once: true })
  })
}

function isRecord(value) {
  return typeof value === 'object' && value !== null
}

function appendProgress(previous, delta) {
  const next = `${previous}${String(delta ?? '')}`
  return next.length <= PROGRESS_TEXT_LIMIT ? next : next.slice(next.length - PROGRESS_TEXT_LIMIT)
}

const PERMISSION_COMMAND_PATTERN = /^\/permission\s+(?:read-only|workspace-write)\s*$/iu
const PERMISSION_ACK_PATTERN = /^Workspace\s+(?:写权限|权限)[\s\S]{0,240}(?:已开启|已切换)/iu

function isPermissionCommand(text) {
  return PERMISSION_COMMAND_PATTERN.test(String(text ?? '').trim())
}

function isPermissionAcknowledgement(text) {
  return PERMISSION_ACK_PATTERN.test(String(text ?? '').trim())
}

function toolLabel(name) {
  const value = String(name ?? '').trim()
  return value === 'bash' ? '命令行'
    : value === 'read' ? '读取文件'
      : value === 'write' ? '写入文件'
        : value === 'edit' ? '修改文件'
          : value === 'apply_patch' ? '应用代码修改'
            : value === 'ask_user_question' ? '向群聊提问'
              : value || '工具'
}

function richTool(event, name, callId) {
  if (name !== 'visualize_html') return undefined
  const meta = event?.data?.meta
  if (!isRecord(meta) || typeof meta.html !== 'string' || meta.html.length === 0 || meta.html.length > VISUAL_HTML_LIMIT) return undefined
  const rawPath = typeof meta.path === 'string' ? meta.path : ''
  const safePath = rawPath.replace(/[/\\]+$/u, '').split(/[/\\]/u).at(-1) || '可视化预览.html'
  return {
    callId: String(callId || `visual-${event?.seq ?? Date.now()}`),
    toolName: 'visualize_html',
    block: {
      meta: {
        html: meta.html,
        path: safePath,
        size: Number(meta.size ?? meta.html.length),
        truncated: meta.truncated === true,
      },
    },
  }
}

export class HarnessBridge {
  constructor({ baseUrl, enabled = false, logger = console }) {
    this.baseUrl = String(baseUrl).replace(/\/$/, '')
    this.enabled = enabled
    this.logger = logger
    this.activeExecutions = new Map()
  }

  async rpc(method, payload) {
    const response = await fetch(`${this.baseUrl}/api/${method}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        type: 'client-request',
        rpcId: `collab-${Date.now()}-${Math.random().toString(16).slice(2)}`,
        method,
        payload,
      }),
    })
    if (!response.ok) throw new Error(`${method} HTTP ${response.status}`)
    const body = await response.json()
    if (!body?.result?.ok) {
      throw new Error(body?.result?.error?.message ?? `${method} 执行失败`)
    }
    return body.result.value
  }

  async respondQuestion({ rpcId, sessionId, answers, cancel = false }) {
    const result = cancel
      ? { ok: false, error: { code: 'cancelled', message: '群聊取消了这次追问', details: {} } }
      : {
          ok: true,
          value: {
            sessionId,
            answer: { answers: answers.map(answer => ({
              id: String(answer.id),
              selected: Array.isArray(answer.selected) ? answer.selected.map(String) : [],
              ...(typeof answer.custom === 'string' && answer.custom.trim() !== '' ? { custom: answer.custom.trim() } : {}),
            })) },
          },
        }
    const response = await fetch(`${this.baseUrl}/api/respond`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'client-response', rpcId, result }),
    })
    if (!response.ok) throw new Error(`追问回答 HTTP ${response.status}`)
    const receipt = await response.json()
    if (!receipt?.accepted) throw new Error(`追问回答未被 Harness 接受：${receipt?.reason ?? 'unknown'}`)
    return receipt
  }

  async watchSession(sessionId, handlers, signal) {
    const url = new URL('/api/events.mux', this.baseUrl)
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
    const dispatch = frame => {
      const payload = frame?.payload
      if (!payload || payload.sessionId !== sessionId) return
      if (payload.type === 'session/event') handlers.event?.(payload.event)
      else if (payload.type === 'question/requested') handlers.question?.({
        key: String(frame.rpcId),
        sessionId,
        questions: Array.isArray(payload.questions) ? payload.questions : [],
      })
      else if (payload.type === 'question/resolved') handlers.questionResolved?.({
        key: String(payload.questionRpcId),
        outcome: payload.outcome,
      })
    }
    let reconnectDelay = EVENT_STREAM_RECONNECT_MIN_MS
    while (!signal.aborted) {
      try {
        await new Promise((resolve, reject) => {
          const socket = new WebSocket(url)
          let opened = false
          let settled = false
          const cleanup = () => {
            signal.removeEventListener('abort', abort)
            socket.removeEventListener('open', open)
            socket.removeEventListener('message', message)
            socket.removeEventListener('close', close)
            socket.removeEventListener('error', failure)
          }
          const finish = cause => {
            if (settled) return
            settled = true
            cleanup()
            if (cause) reject(cause)
            else resolve()
          }
          const abort = () => {
            try { socket.close() } catch { /* already closed */ }
            finish()
          }
          const open = () => {
            opened = true
            reconnectDelay = EVENT_STREAM_RECONNECT_MIN_MS
            handlers.open?.()
          }
          const message = event => {
            try { dispatch(JSON.parse(String(event.data))) } catch { /* ignore malformed or forward-compatible frames */ }
          }
          const close = event => {
            if (signal.aborted) finish()
            else finish(new Error(`Harness 实时事件流意外关闭（${event.code || 'unknown'}）`))
          }
          const failure = () => finish(new Error(opened ? 'Harness 实时事件流发生错误' : 'Harness 实时事件流连接失败'))
          if (signal.aborted) { abort(); return }
          signal.addEventListener('abort', abort, { once: true })
          socket.addEventListener('open', open, { once: true })
          socket.addEventListener('message', message)
          socket.addEventListener('close', close, { once: true })
          socket.addEventListener('error', failure, { once: true })
        })
      } catch (cause) {
        if (signal.aborted) return
        handlers.disconnect?.(cause)
        this.logger.warn?.('[dsh-collab] Harness 实时事件流中断，正在自动重连', cause)
        await waitForReconnect(reconnectDelay, signal)
        reconnectDelay = Math.min(EVENT_STREAM_RECONNECT_MAX_MS, reconnectDelay * 2)
      }
    }
  }

  async credentialStatus(ref = 'DEEPSEEK_API_KEY') {
    const result = await this.rpc('credentials.describe', { refs: [ref] })
    const credential = result?.credentials?.[ref] ?? {}
    return {
      configured: Boolean(credential.configured),
      writable: Boolean(credential.writable),
    }
  }

  async setCredential(value, ref = 'DEEPSEEK_API_KEY') {
    await this.rpc('credentials.set', { ref, value })
    return await this.credentialStatus(ref)
  }

  async sessionModels(sessionId) {
    return await this.rpc('session.models', { sessionId })
  }

  modelOptions(directory) {
    const current = directory?.current ?? {}
    const options = []
    for (const group of directory?.groups ?? []) {
      for (const model of group?.models ?? []) {
        const efforts = model?.reasoning?.efforts ?? []
        const isCurrent = group.id === current.provider && model.id === current.model
        options.push({
          key: `${group.id}:${model.id}`,
          provider: String(group.id),
          providerName: String(group.name ?? group.id),
          model: String(model.id),
          name: String(model.name ?? model.id),
          ...(typeof model.description === 'string' ? { description: model.description } : {}),
          ...(efforts.length > 0 ? {
            reasoningEffort: isCurrent
              ? String(current.reasoningEffort ?? model.reasoning?.defaultEffort ?? efforts[0]?.id ?? '')
              : String(model.reasoning?.defaultEffort ?? efforts[0]?.id ?? ''),
            reasoningEfforts: efforts.map(effort => ({
              id: String(effort.id),
              name: String(effort.name ?? effort.id),
              ...(typeof effort.description === 'string' ? { description: effort.description } : {}),
            })),
          } : {}),
          ...(isCurrent ? { current: true } : {}),
        })
      }
    }
    return options
  }

  async selectSessionModel(sessionId, selection) {
    await this.rpc('session.selectModel', {
      sessionId,
      provider: selection.provider,
      model: selection.model,
      ...(selection.reasoningEffort ? { reasoningEffort: selection.reasoningEffort } : {}),
    })
    return await this.sessionModels(sessionId)
  }

  async cancelSession(sessionId) {
    const active = this.activeExecutions.get(sessionId)
    if (active) {
      active.cancelled = true
      active.controller.abort()
    }
    if (!this.enabled) return
    await this.rpc('session.cancel', { sessionId })
  }

  async ensureRoutableModel(sessionId) {
    const directory = await this.sessionModels(sessionId)
    if (directory?.routable === true) return directory
    const options = this.modelOptions(directory)
    const preferred = options.find(option => option.provider === 'deepseek-official') ?? options[0]
    if (!preferred) throw new Error('没有可用模型；请由宿主在模型切换中配置 DeepSeek API Key')
    return await this.selectSessionModel(sessionId, preferred)
  }

  async ensureSession(room, workspacePath) {
    if (room.harnessSessionId) return room.harnessSessionId
    const created = await this.rpc('session.create', { cwd: workspacePath })
    const sessionId = created.sessionId
    await this.rpc('session.rename', { sessionId, title: `群聊 · ${room.name}` })
    await this.ensureRoutableModel(sessionId)
    room.harnessSessionId = sessionId
    return sessionId
  }

  async setSessionPermission(sessionId, permission) {
    const value = ['read-only', 'workspace-write'].includes(permission) ? permission : 'read-only'
    await this.rpc('session.prompt', {
      sessionId,
      mode: 'queue',
      content: [{ type: 'text', text: `/permission ${value}` }],
      clientTimeZone: 'Asia/Shanghai',
    })
  }

  async listSessions() {
    const listing = await this.rpc('session.list', {})
    return (listing?.items ?? []).filter(item => item && item.origin !== 'subagent').map(item => ({
      sessionId: item.sessionId,
      title: String(item.projections?.values?.title ?? '').trim() || '新会话',
      cwd: item.cwd,
      running: Boolean(item.running),
      blank: Boolean(item.blank),
      createdAt: Number(item.createdAt ?? item.updatedAt ?? Date.now()),
      updatedAt: Number(item.updatedAt ?? Date.now()),
      lastPromptAt: Number(item.projections?.values?.sessionListMetadata?.lastPromptAt ?? 0),
      tokenUsage: item.projections?.values?.tokenUsage ?? null,
    }))
  }

  async createSession({ workspacePath, title }) {
    const created = await this.rpc('session.create', { cwd: workspacePath })
    if (title) await this.rpc('session.rename', { sessionId: created.sessionId, title })
    await this.rpc('session.prompt', {
      sessionId: created.sessionId,
      mode: 'queue',
      content: [{ type: 'text', text: '/permission workspace-write' }],
      clientTimeZone: 'Asia/Shanghai',
    })
    await this.ensureRoutableModel(created.sessionId)
    return created.sessionId
  }

  async renameSession(sessionId, title) {
    await this.rpc('session.rename', { sessionId, title })
  }

  async forkSession(sessionId) {
    const forked = await this.rpc('session.fork', { sessionId })
    return forked.sessionId
  }

  historyMessages(history) {
    const messages = []
    const toolNames = new Map()
    let internalPermissionTurn = false
    for (const entry of history?.events ?? []) {
      const event = entry?.event
      if (event?.type === 'user/message' && event.data?.source?.kind === 'user') {
        const rawText = this.contentText(event.data?.content)
        if (isPermissionCommand(rawText)) {
          internalPermissionTurn = true
          continue
        }
        internalPermissionTurn = false
        const text = this.visibleUserText(rawText)
        const files = fileMetadataFromPrompt(rawText)
        if (text || files.length > 0) messages.push({
          id: `user-${event.seq}`, role: 'user', text,
          ...(files.length > 0 ? { files } : {}),
          createdAt: Number(event.time ?? 0),
        })
      }
      if (event?.type === 'assistant/message') {
        const text = this.contentText(event.data?.message?.content)
        const reasoning = this.reasoningText(event.data?.message?.content)
        if (internalPermissionTurn || isPermissionAcknowledgement(text)) continue
        if (text || reasoning) messages.push({
          id: `assistant-${event.seq}`,
          role: 'assistant',
          text,
          ...(reasoning ? { reasoning } : {}),
          createdAt: Number(event.time ?? 0),
        })
      }
      if (event?.type === 'tool/call') {
        if (internalPermissionTurn) continue
        const name = String(event.data?.name ?? '').trim() || '工具'
        const callId = String(event.data?.callId ?? '').trim()
        if (callId) toolNames.set(callId, name)
        if (name !== 'ask_user_question') messages.push({
          id: `tool-call-${event.seq}`,
          role: 'status',
          text: `正在使用${toolLabel(name)}…`,
          createdAt: Number(event.time ?? 0),
        })
      }
      if (event?.type === 'tool/result') {
        if (internalPermissionTurn) continue
        const block = Array.isArray(event.data?.message?.content)
          ? event.data.message.content.find(item => item?.type === 'tool-result')
          : undefined
        const callId = String(event.data?.message?.source?.callId ?? block?.toolCallId ?? '').trim()
        const name = toolNames.get(callId) ?? '工具'
        const tool = richTool(event, name, callId)
        if (tool) messages.push({
          id: `tool-view-${event.seq}`,
          role: 'tool',
          text: '',
          tool,
          createdAt: Number(event.time ?? 0),
        })
        if (name !== 'ask_user_question') messages.push({
          id: `tool-result-${event.seq}`,
          role: 'status',
          text: `工具执行${block?.isError === true ? '失败' : '完成'}：${toolLabel(name)}`,
          createdAt: Number(event.time ?? 0),
        })
      }
    }
    return messages
  }

  contentText(content) {
    return Array.isArray(content)
      ? content.filter(block => block?.type === 'text' && typeof block.text === 'string').map(block => block.text).join('\n').trim()
      : ''
  }

  reasoningText(content) {
    return Array.isArray(content)
      ? content.filter(block => block?.type === 'reasoning' && typeof block.text === 'string').map(block => block.text).join('\n').trim()
      : ''
  }

  visibleUserText(text) {
    const marker = '<<<DSH_DIY_USER_MESSAGE>>>'
    const index = String(text ?? '').lastIndexOf(marker)
    if (index >= 0) return String(text).slice(index + marker.length).trim()
    return String(text ?? '')
      .replace(/<<<DSH_DIY_GLOBAL_RESPONSE_RULES>>>[\s\S]*?<<<END_DSH_DIY_GLOBAL_RESPONSE_RULES>>>\s*/gu, '')
      .replace(/<<<DSH_DIY_SESSION_CONTEXT>>>[\s\S]*?<<<END_DSH_DIY_SESSION_CONTEXT>>>\s*/gu, '')
      .replace(/<<<DSH_DIY_USER_MESSAGE>>>\s*/gu, '')
      .trim()
  }

  async history(sessionId, maxMessages = 80) {
    const history = await this.rpc('session.history', { sessionId, maxMessages })
    return this.historyMessages(history)
  }

  async historyAll(sessionId, pageMessages = 100) {
    const pages = []
    let beforeSeq
    let previousBoundary
    while (true) {
      const history = await this.rpc('session.history', {
        sessionId,
        maxMessages: pageMessages,
        ...(beforeSeq === undefined ? {} : { beforeSeq }),
      })
      const events = Array.isArray(history?.events) ? history.events : []
      pages.unshift(events)
      if (history?.hasMore !== true || events.length === 0) break
      const boundary = Number(events[0]?.event?.seq)
      if (!Number.isInteger(boundary) || boundary < 0 || boundary === previousBoundary) break
      previousBoundary = boundary
      beforeSeq = boundary
    }
    return this.historyMessages({ events: pages.flat() })
  }

  extractAssistantText(history, afterSeq = -1) {
    let answer = ''
    for (const entry of history?.events ?? []) {
      const event = entry?.event
      if (event?.type !== 'assistant/message' || Number(event.seq ?? -1) <= afterSeq) continue
      const content = event?.data?.message?.content
      if (!Array.isArray(content)) continue
      const text = content
        .filter(block => isRecord(block) && block.type === 'text' && typeof block.text === 'string')
        .map(block => block.text)
        .join('\n')
        .trim()
      if (text && !isPermissionAcknowledgement(text)) answer = text
    }
    return answer
  }

  async executeSession({ sessionId, prompt, images = [], onProgress, onQuestion, onQuestionResolved, ignorePermissionPreamble = false }) {
    if (!this.enabled) {
      return { dryRun: true, text: '当前处于仅协商模式，Harness 执行桥尚未开启。', sessionId }
    }
    await this.ensureRoutableModel(sessionId)
    const before = await this.rpc('session.history', { sessionId, maxMessages: 1 })
    const beforeSeq = Math.max(-1, ...(before?.events ?? []).map(entry => Number(entry?.event?.seq ?? -1)))
    const startedAt = Date.now()
    const controller = new AbortController()
    const execution = { controller, cancelled: false }
    this.activeExecutions.set(sessionId, execution)
    const progress = { reasoning: '', text: '', statuses: [], steps: [], updatedAt: startedAt }
    const toolNames = new Map()
    let activeAssistant
    let processedSeq = beforeSeq
    let streamHealthy = false
    let lastStreamEventAt = 0
    let stepSerial = 0
    let progressTimer
    let streamOpened
    let promptStarted = !ignorePermissionPreamble
    const opened = new Promise(resolve => { streamOpened = resolve })
    const publish = immediate => {
      const send = () => {
        progressTimer = undefined
        progress.updatedAt = Date.now()
        onProgress?.({
          reasoning: progress.reasoning,
          text: progress.text,
          statuses: [...progress.statuses],
          steps: progress.steps.map(step => ({ ...step })),
          updatedAt: progress.updatedAt,
        })
      }
      if (immediate) {
        if (progressTimer) clearTimeout(progressTimer)
        send()
      } else if (!progressTimer) progressTimer = setTimeout(send, 280)
    }
    const trimSteps = () => {
      if (progress.steps.length > 160) progress.steps.splice(0, progress.steps.length - 160)
    }
    const addStatus = value => {
      if (progress.statuses.at(-1) === value) return
      activeAssistant = undefined
      progress.statuses.push(value)
      if (progress.statuses.length > 80) progress.statuses.splice(0, progress.statuses.length - 80)
      progress.steps.push({ id: `status-${++stepSerial}`, kind: 'status', text: value })
      trimSteps()
      publish(true)
    }
    const addTool = tool => {
      if (!tool) return
      activeAssistant = undefined
      progress.steps.push({ id: `tool-${++stepSerial}`, kind: 'tool', text: '', tool })
      trimSteps()
      publish(true)
    }
    const assistantStep = event => {
      if (!activeAssistant) {
        activeAssistant = { id: `assistant-${event.seq ?? ++stepSerial}`, kind: 'assistant', text: '', reasoning: '', pending: true }
        progress.steps.push(activeAssistant)
        trimSteps()
      }
      return activeAssistant
    }
    const consumeEvent = event => {
      const seq = Number(event?.seq ?? -1)
      if (seq <= processedSeq) return
      processedSeq = seq
      lastStreamEventAt = Date.now()
      if (event?.type === 'user/message' && event.data?.source?.kind === 'user') {
        const text = this.contentText(event.data?.content)
        if (!isPermissionCommand(text)) {
          promptStarted = true
          activeAssistant = undefined
        }
        return
      }
      if (!promptStarted) return
      if (event?.type === 'assistant/chunk') {
        const chunk = event.data?.chunk
        if (chunk?.type === 'reasoning-delta' && typeof chunk.text === 'string') {
          const step = assistantStep(event)
          step.reasoning = appendProgress(step.reasoning, chunk.text)
          progress.reasoning = appendProgress(progress.reasoning, chunk.text)
          publish(false)
        } else if (chunk?.type === 'text-delta' && typeof chunk.text === 'string') {
          const step = assistantStep(event)
          step.text = appendProgress(step.text, chunk.text)
          progress.text = appendProgress(progress.text, chunk.text)
          publish(false)
        }
      } else if (event?.type === 'assistant/message') {
        const text = this.contentText(event.data?.message?.content)
        const reasoning = this.reasoningText(event.data?.message?.content)
        if (text || reasoning) {
          const hadActive = activeAssistant !== undefined
          const step = assistantStep(event)
          const hadStepText = step.text.trim() !== ''
          const hadStepReasoning = step.reasoning.trim() !== ''
          if (text) step.text = text
          if (reasoning) step.reasoning = reasoning
          step.pending = false
          if (text && (!hadActive || !hadStepText)) progress.text = appendProgress(progress.text, text)
          if (reasoning && (!hadActive || !hadStepReasoning)) progress.reasoning = appendProgress(progress.reasoning, reasoning)
          publish(true)
        }
        activeAssistant = undefined
      } else if (event?.type === 'tool/call') {
        const callId = String(event.data?.callId ?? '')
        const name = String(event.data?.name ?? '')
        if (callId) toolNames.set(callId, name)
        if (name !== 'ask_user_question') addStatus(`正在使用${toolLabel(name)}…`)
      } else if (event?.type === 'tool/result') {
        const content = event.data?.message?.content
        const block = Array.isArray(content) ? content.find(item => item?.type === 'tool-result') : undefined
        const callId = String(event.data?.message?.source?.callId ?? block?.toolCallId ?? '')
        const name = toolNames.get(callId) ?? '工具'
        addTool(richTool(event, name, callId))
        if (name !== 'ask_user_question') addStatus(`${block?.isError === true ? '工具执行失败' : '工具执行完成'}：${toolLabel(name)}`)
      } else if (event?.type === 'step/end') {
        activeAssistant = undefined
      }
    }
    const watcher = this.watchSession(sessionId, {
      open: () => { streamHealthy = true; streamOpened() },
      disconnect: () => { streamHealthy = false },
      event: event => {
        consumeEvent(event)
      },
      question: pending => {
        addStatus('等待在 3091 会话中回答…')
        onQuestion?.(pending)
      },
      questionResolved: resolved => {
        addStatus(resolved.outcome === 'answered' ? '群聊追问已回答，Agent 继续执行。' : '群聊追问已取消。')
        onQuestionResolved?.(resolved)
      },
    }, controller.signal).catch(cause => {
      streamHealthy = false
      if (!controller.signal.aborted) this.logger.warn?.('[dsh-collab] Harness 实时事件流中断，继续等待最终结果', cause)
      streamOpened()
    })
    await Promise.race([opened, delay(2_000)])
    await this.rpc('session.prompt', {
      sessionId,
      mode: 'queue',
      content: [{ type: 'text', text: prompt }, ...images],
      clientTimeZone: 'Asia/Shanghai',
    })
    let observedRunning = false
    try {
      while (Date.now() - startedAt < RUN_TIMEOUT_MS) {
        if (execution.cancelled) throw new Error('Agent 执行已取消')
        await delay(WAIT_INTERVAL_MS)
        if (execution.cancelled) throw new Error('Agent 执行已取消')
        let history
        if (!streamHealthy || Date.now() - lastStreamEventAt > 4_000) {
          history = await this.rpc('session.history', { sessionId, maxMessages: 6 })
          for (const entry of history?.events ?? []) consumeEvent(entry?.event)
        }
        const listing = await this.rpc('session.list', {})
        const row = listing?.items?.find(item => item.sessionId === sessionId)
        if (row?.running) observedRunning = true
        if (row && !row.running) {
          history = history ?? await this.rpc('session.history', { sessionId, maxMessages: 30 })
          for (const entry of history?.events ?? []) consumeEvent(entry?.event)
          const historyText = this.extractAssistantText(history, beforeSeq)
          const text = progress.text.trim() || historyText
          if (observedRunning || text) {
            publish(true)
            return {
              dryRun: false,
              text: text || 'Agent 已完成本轮任务，但没有返回可显示的文字。',
              reasoning: progress.reasoning.trim(),
              statuses: [...progress.statuses],
              steps: progress.steps.map(step => ({ ...step, pending: false })),
              sessionId,
            }
          }
        }
      }
      throw new Error('Agent 执行超过 15 分钟，已停止等待。')
    } finally {
      if (progressTimer) clearTimeout(progressTimer)
      controller.abort()
      await watcher
      if (this.activeExecutions.get(sessionId) === execution) this.activeExecutions.delete(sessionId)
    }
  }

  async execute({ room, workspacePath, prompt, images = [], permission = 'workspace-write', onProgress, onQuestion, onQuestionResolved }) {
    if (!this.enabled) {
      return {
        dryRun: true,
        text: '办公室测试当前处于“仅协商”模式：需求已全员确认，但服务器未开放 Harness 执行桥。',
      }
    }
    const sessionId = await this.ensureSession(room, workspacePath)
    await this.setSessionPermission(sessionId, permission)
    return await this.executeSession({ sessionId, prompt, images, onProgress, onQuestion, onQuestionResolved, ignorePermissionPreamble: true })
  }
}
