import type { EventItem } from './entities'
import { parseDate, parseDateTime } from './date'

export interface Countdown {
  /** 距离目标还有多少毫秒；已过期为负 */
  remainingMs: number
  expired: boolean
  days: number
  hours: number
  minutes: number
  /** 直接可显示的中文文案 */
  text: string
}

const MINUTE = 60 * 1000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

/** 这条日程的“关键时刻”：时间段看开始，待办看截止，全天看当天零点。 */
export function targetOf(event: EventItem): Date | null {
  const value = event.kind === 'todo' ? event.dueAt : event.startAt
  if (!value) return null
  try {
    return value.includes('T') ? parseDateTime(value) : parseDate(value)
  } catch {
    return null
  }
}

function pad2(value: number): string {
  return value < 10 ? `0${value}` : String(value)
}

/** 把剩余时间换算成天数/小时/分钟与一句中文。 */
export function countdownTo(target: Date, now: Date): Countdown {
  const remainingMs = target.getTime() - now.getTime()
  const expired = remainingMs < 0
  const abs = Math.abs(remainingMs)
  const days = Math.floor(abs / DAY)
  const hours = Math.floor((abs % DAY) / HOUR)
  const minutes = Math.floor((abs % HOUR) / MINUTE)

  let text: string
  if (expired) {
    text = days >= 1 ? `已过 ${days} 天` : '已过期'
  } else if (days >= 1) {
    text = `还有 ${days} 天${hours > 0 ? ` ${hours} 小时` : ''}`
  } else if (hours >= 1) {
    text = `还有 ${hours} 小时 ${pad2(minutes)} 分`
  } else {
    text = `还有 ${Math.max(minutes, 1)} 分钟`
  }

  return { remainingMs, expired, days, hours, minutes, text }
}

export interface CountdownItem {
  event: EventItem
  target: Date
  countdown: Countdown
  /** 日期描述，例如 6月1日 09:00 */
  whenText: string
}

/** 挑出重要事项，按时间排序（已过期的排在后面）。 */
export function importantCountdowns(events: EventItem[], now: Date, limit = 3): CountdownItem[] {
  const items: CountdownItem[] = []
  for (const event of events) {
    if (!event.important) continue
    if (event.done) continue
    const target = targetOf(event)
    if (!target) continue
    const value = event.kind === 'todo' ? event.dueAt : event.startAt
    const hasTime = Boolean(value && value.includes('T'))
    items.push({
      event,
      target,
      countdown: countdownTo(target, now),
      whenText: `${target.getMonth() + 1}月${target.getDate()}日${
        hasTime ? ` ${pad2(target.getHours())}:${pad2(target.getMinutes())}` : ' 全天'
      }`,
    })
  }

  return items
    .sort((a, b) => {
      if (a.countdown.expired !== b.countdown.expired) return a.countdown.expired ? 1 : -1
      return a.countdown.remainingMs - b.countdown.remainingMs
    })
    .slice(0, limit)
}
