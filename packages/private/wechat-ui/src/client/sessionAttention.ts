/** Official Session-status facts the WeChat list and question card can render. */

import { useSyncExternalStore } from 'react'
import type { Context } from '@deepseek-ai/cordis'
import type { SessionStatus } from '@deepseek-ai/dsh-client-ui-session/client'
import type { PendingQuestionView, QuestionItemView } from './types.ts'

export interface SessionAttention {
  unread: boolean
  completed: boolean
  awaitingQuestion: boolean
  pendingQuestion?: PendingQuestionView
}

interface AttentionSnapshot {
  byId: Readonly<Record<string, SessionAttention>>
  revision: number
}

const listeners = new Set<() => void>()
let snapshot: AttentionSnapshot = { byId: {}, revision: 0 }

function emit(next: Readonly<Record<string, SessionAttention>>): void {
  snapshot = { byId: next, revision: snapshot.revision + 1 }
  for (const listener of listeners) listener()
}

function questionItemView(value: unknown): QuestionItemView | undefined {
  if (value === null || typeof value !== 'object') return undefined
  const item = value as Record<string, unknown>
  if (typeof item.id !== 'string' || typeof item.question !== 'string') return undefined
  const options = Array.isArray(item.options)
    ? item.options.flatMap((option) => {
      if (option === null || typeof option !== 'object') return []
      const row = option as { label?: unknown; description?: unknown }
      if (typeof row.label !== 'string') return []
      return [{
        label: row.label,
        ...(typeof row.description === 'string' ? { description: row.description } : {}),
      }]
    })
    : undefined
  return {
    id: item.id,
    question: item.question,
    ...(typeof item.header === 'string' ? { header: item.header } : {}),
    ...(typeof item.detail === 'string' ? { detail: item.detail } : {}),
    ...(options === undefined || options.length === 0 ? {} : { options }),
    ...(item.multiSelect === true ? { multiSelect: true } : {}),
  }
}

function pendingQuestionViewOf(value: unknown): PendingQuestionView | undefined {
  if (value === null || typeof value !== 'object') return undefined
  const pending = value as {
    key?: unknown
    questions?: unknown
    answer?: unknown
    cancel?: unknown
  }
  if (typeof pending.key !== 'string' || !Array.isArray(pending.questions)) return undefined
  if (typeof pending.answer !== 'function' || typeof pending.cancel !== 'function') return undefined
  const questions = pending.questions.flatMap((item) => {
    const view = questionItemView(item)
    return view === undefined ? [] : [view]
  })
  if (questions.length === 0) return undefined
  return {
    key: pending.key,
    questions,
    canAnswer: true,
    answer: async (answers) => {
      await pending.answer({ answers })
    },
    cancel: async () => {
      await pending.cancel()
    },
  }
}

function attentionFromStatus(status: SessionStatus): SessionAttention {
  const pendingQuestion = pendingQuestionViewOf(status.pendingInteraction)
  return {
    unread: status.completionUnread === true || pendingQuestion !== undefined,
    completed: status.completionUnread === true,
    awaitingQuestion: pendingQuestion !== undefined,
    ...(pendingQuestion === undefined ? {} : { pendingQuestion }),
  }
}

/**
 * Mirror official Session-status into the WeChat list and question card.
 * @param ctx - overlay context that already provides `uiSession`.
 * @returns disposer for the status subscription.
 */
export function bindSessionAttention(ctx: Context): () => void {
  const publish = (): void => {
    const next: Record<string, SessionAttention> = {}
    for (const [id, status] of ctx.uiSession.sessionStatus.getSnapshot()) {
      next[String(id)] = attentionFromStatus(status)
    }
    emit(next)
  }
  publish()
  return ctx.uiSession.sessionStatus.subscribe(publish)
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

/**
 * Official completion, unread, and pending-question facts keyed by Session id.
 * @returns the current attention map.
 */
export function useSessionAttentionMap(): Readonly<Record<string, SessionAttention>> {
  return useSyncExternalStore(subscribe, () => snapshot.byId)
}

/**
 * Official attention for one Session.
 * @param sessionId - Session identity, or absence while no chat is bound.
 * @returns attention for that Session, if any.
 */
export function useSessionAttention(sessionId?: string): SessionAttention | undefined {
  const map = useSessionAttentionMap()
  return sessionId === undefined ? undefined : map[sessionId]
}
