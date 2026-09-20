import { createClientId } from './clientId.ts'

export interface ScheduleIntent {
  original: string
  title: string
  prompt: string
  cron: string
  scheduleLabel: string
}

const CHINESE_DIGITS: Record<string, number> = {
  零: 0, 〇: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5,
  六: 6, 七: 7, 八: 8, 九: 9, 十: 10,
}

function numberOf(value: string): number | undefined {
  if (/^\d+$/u.test(value)) return Number(value)
  if (value === '十') return 10
  if (value.startsWith('十')) return 10 + (CHINESE_DIGITS[value.slice(1)] ?? 0)
  if (value.endsWith('十')) return (CHINESE_DIGITS[value.slice(0, -1)] ?? 0) * 10
  if (value.includes('十')) {
    const [left = '', right = ''] = value.split('十')
    return (CHINESE_DIGITS[left] ?? 0) * 10 + (CHINESE_DIGITS[right] ?? 0)
  }
  return CHINESE_DIGITS[value]
}

function normalizeHour(hour: number, period: string): number {
  if ((period === '下午' || period === '晚上') && hour < 12) return hour + 12
  if (period === '中午' && hour < 11) return hour + 12
  if (period === '凌晨' && hour === 12) return 0
  if ((period === '早上' || period === '上午') && hour === 12) return 0
  return hour
}

const WEEKDAY: Record<string, number> = { 日: 0, 天: 0, 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6 }

export function parseScheduleIntent(text: string): ScheduleIntent | undefined {
  const normalized = text.trim()
  if (normalized === '' || !/(?:每天|每日|工作日|周一到周五|每周|定时|每天都|每晚|每早)/u.test(normalized)) return undefined
  const time = /(?:(凌晨|早上|上午|中午|下午|晚上)\s*)?([0-9]{1,2}|[零〇一二两三四五六七八九十]{1,3})\s*(?:点|时)(?:\s*([0-9]{1,2}|半)\s*分?)?/u.exec(normalized)
  if (time === null) return undefined
  const hourText = time[2]
  if (hourText === undefined) return undefined
  const rawHour = numberOf(hourText)
  const rawMinute = time[3] === '半' ? 30 : time[3] === undefined ? 0 : Number(time[3])
  if (rawHour === undefined || rawMinute < 0 || rawMinute > 59) return undefined
  const hour = normalizeHour(rawHour, time[1] ?? '')
  if (hour < 0 || hour > 23) return undefined

  let week = '*'
  let periodLabel = '每天'
  if (/(?:工作日|周一到周五)/u.test(normalized)) {
    week = '1-5'
    periodLabel = '每个工作日'
  } else {
    const weekly = /每周([一二三四五六日天])/u.exec(normalized)
    if (weekly !== null) {
      const day = weekly[1]
      const weekday = day === undefined ? undefined : WEEKDAY[day]
      if (day === undefined || weekday === undefined) return undefined
      week = String(weekday)
      periodLabel = `每周${day}`
    }
  }
  const clock = `${String(hour).padStart(2, '0')}:${String(rawMinute).padStart(2, '0')}`
  const prompt = normalized
    .replace(/^(?:请|你能|可以|麻烦)?\s*/u, '')
    .replace(/(?:以后|从现在开始)?\s*(?:每天|每日|每天都|每早|每晚|工作日|周一到周五|每周[一二三四五六日天])[^，。！？]*?(?:点|时)(?:\s*(?:[0-9]{1,2}|半)\s*分?)?(?:的时候|时)?/u, '')
    .replace(/^(?:主动)?(?:再)?/u, '')
    .trim()
  return {
    original: normalized,
    title: prompt === '' ? '定时会话提醒' : prompt.replace(/[。！？]+$/u, '').slice(0, 32),
    prompt: prompt === '' ? normalized : prompt,
    cron: `${rawMinute} ${hour} * * ${week}`,
    scheduleLabel: `${periodLabel} ${clock}`,
  }
}

interface CreateScheduleInput extends ScheduleIntent {
  sessionId: string
}

export async function createConversationSchedule(input: CreateScheduleInput): Promise<void> {
  const response = await fetch('/api/diy-schedules/action', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      kind: 'create',
      input: {
        sessionId: input.sessionId,
        title: input.title,
        prompt: input.prompt,
        cron: input.cron,
        scheduleLabel: input.scheduleLabel,
      },
    }),
  })
  const body = await response.json() as { ok?: boolean; error?: string }
  if (!response.ok || body.ok !== true) throw new Error(body.error ?? '定时任务创建失败')

  // Keep the existing native task board useful as the visible ledger. It is
  // deliberately not armed there: the conversation scheduler owns delivery
  // back into the original chat, so the native runner must not open a duplicate session.
  try {
    await fetch('/api/task-board/action', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        requestId: createClientId('schedule-request'),
        action: {
          kind: 'create',
          id: createClientId('schedule-task'),
          input: {
            title: `⏰ ${input.title}`,
            description: `${input.scheduleLabel} · 回到原会话主动发送（由微信会话调度器执行）`,
            prompt: input.prompt,
          },
        },
      }),
    })
  } catch {
    // The actual schedule is already durable; an unavailable board must not
    // turn a successful schedule into a false failure.
  }
}
