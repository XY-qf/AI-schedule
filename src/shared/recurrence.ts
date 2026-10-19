import type { EventItem, ExceptionAction, RepeatFreq } from './entities'
import { addDays, addMonths, daysInMonth, formatDate, parseDate, startOfWeekMonday } from './date'

export interface RecRule {
  id: string
  freq: RepeatFreq
  /** 自定义间隔的天/周数 */
  intervalValue: number | null
  intervalUnit: 'day' | 'week' | null
  /** 每周的哪几天（1=周一 … 7=周日） */
  byWeekdays: number[] | null
  /** 到此日期为止（含） */
  untilDate: string | null
  /** 生成的总次数上限 */
  maxCount: number | null
}

export interface SeriesException {
  id: string
  seriesId: string
  /** 原本应该出现的日期 */
  originalDate: string
  action: ExceptionAction
  startAt: string | null
  endAt: string | null
  title: string | null
  location: string | null
  people: string | null
  note: string | null
  done: boolean | null
}

export interface Occurrence {
  /** 系列（母日程）id */
  seriesId: string
  /** 这一次原本的日期 */
  originalDate: string
  startAt: string | null
  endAt: string | null
  /** 待办类（只有截止时间）的截止时刻 */
  dueAt: string | null
  title: string | null
  location: string | null
  people: string | null
  note: string | null
  done: boolean | null
  isException: boolean
  exceptionId: string | null
}

const MAX_ITERATIONS = 4000

function weekdayOf(date: string): number {
  const d = parseDate(date)
  const wd = d.getDay()
  return wd === 0 ? 7 : wd
}

function dayOffset(startAt: string | null, endAt: string | null): number {
  if (!startAt || !endAt) return 0
  const a = parseDate(startAt.slice(0, 10))
  const b = parseDate(endAt.slice(0, 10))
  return Math.round((b.getTime() - a.getTime()) / 86400000)
}

function shiftDateTime(date: string, time: string | null, plusDays = 0): string | null {
  if (time === null) return null
  const base = date.includes('T') ? date.slice(0, 10) : date
  const target = addDays(parseDate(base), plusDays)
  return `${formatDate(target)}T${time}`
}

/**
 * 由母日程 + 规则生成一段区间内的发生实例。
 * 例外优先于规则：被跳过的不出现，被修改的用修改后的内容替换。
 */
export function expandOccurrences(
  master: EventItem,
  rule: RecRule,
  exceptions: SeriesException[],
  rangeStart: string,
  rangeEnd: string,
): Occurrence[] {
  // 待办（只有截止时间）没有 startAt，用截止日期当锚点，否则勾了重复就整个消失
  const isTodo = master.kind === 'todo'
  const anchorAt = master.startAt ?? master.dueAt
  if (!anchorAt) return []

  const startDate = anchorAt.slice(0, 10)
  const startTime = isTodo || master.kind === 'allDay' ? null : anchorAt.slice(11, 16)
  const endTime = isTodo || master.kind === 'allDay' ? null : (master.endAt?.slice(11, 16) ?? null)
  const endOffset = dayOffset(master.startAt, master.endAt)
  const isAllDay = master.kind === 'allDay'
  const dueTime = isTodo && anchorAt.includes('T') ? anchorAt.slice(11, 16) : null

  const byDay = new Map<string, SeriesException>()
  for (const exception of exceptions) {
    if (exception.seriesId === master.id) byDay.set(exception.originalDate, exception)
  }

  const candidates: string[] = []
  const countCap = rule.maxCount ?? Number.POSITIVE_INFINITY
  const until = rule.untilDate ?? null

  const push = (date: string): boolean => {
    if (until && date > until) return false
    candidates.push(date)
    return candidates.length < countCap
  }

  const weekdays =
    rule.byWeekdays && rule.byWeekdays.length > 0 ? [...rule.byWeekdays].sort() : [weekdayOf(startDate)]

  if (rule.freq === 'daily' || (rule.freq === 'custom' && rule.intervalUnit === 'day')) {
    const step = Math.max(1, rule.intervalValue ?? 1)
    let cursor = parseDate(startDate)
    let guard = 0
    while (guard < MAX_ITERATIONS) {
      const date = formatDate(cursor)
      if (date > rangeEnd) break
      if (!push(date)) break
      cursor = addDays(cursor, step)
      guard += 1
    }
  } else if (rule.freq === 'weekly' || rule.freq === 'biweekly') {
    const stepWeeks = rule.freq === 'biweekly' ? 2 : 1
    // 从“开始日期所在周的周一”起算，保证 byWeekdays 的周内偏移正确
    let weekStart = startOfWeekMonday(parseDate(startDate))
    let guard = 0
    while (guard < MAX_ITERATIONS) {
      if (formatDate(weekStart) > rangeEnd) break
      for (const wd of weekdays) {
        const date = formatDate(addDays(weekStart, wd - 1))
        if (date < startDate) continue
        if (date > rangeEnd) break
        if (!push(date)) return finish()
      }
      weekStart = addDays(weekStart, 7 * stepWeeks)
      guard += 1
    }
  } else if (rule.freq === 'custom' && rule.intervalUnit === 'week') {
    const stepWeeks = Math.max(1, rule.intervalValue ?? 1)
    let weekStart = startOfWeekMonday(parseDate(startDate))
    let guard = 0
    while (guard < MAX_ITERATIONS) {
      if (formatDate(weekStart) > rangeEnd) break
      for (const wd of weekdays) {
        const date = formatDate(addDays(weekStart, wd - 1))
        if (date < startDate) continue
        if (date > rangeEnd) break
        if (!push(date)) return finish()
      }
      weekStart = addDays(weekStart, 7 * stepWeeks)
      guard += 1
    }
  } else if (rule.freq === 'monthly') {
    const base = parseDate(startDate)
    const day = base.getDate()
    const step = Math.max(1, rule.intervalValue ?? 1)
    for (let index = 0; index < 600; index += 1) {
      const monthCursor = addMonths(new Date(base.getFullYear(), base.getMonth(), 1), index * step)
      const year = monthCursor.getFullYear()
      const month = monthCursor.getMonth() + 1
      // 目标月没有这一天时跳过（例如 31 号遇到 30 天的月份）
      if (day > daysInMonth(year, month)) continue
      const date = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
      if (date > rangeEnd) break
      if (date < startDate) continue
      if (!push(date)) return finish()
    }
  } else {
    // yearly
    const base = parseDate(startDate)
    const month = base.getMonth() + 1
    const day = base.getDate()
    for (let year = base.getFullYear(); year <= base.getFullYear() + 200; year += 1) {
      if (day > daysInMonth(year, month)) continue
      const date = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
      if (date > rangeEnd) break
      if (date < startDate) continue
      if (!push(date)) return finish()
    }
  }

  return finish()

  function finish(): Occurrence[] {
    const out: Occurrence[] = []
    for (const date of candidates) {
      const exception = byDay.get(date)
      if (exception && exception.action === 'skipped') continue
      if (exception && exception.action === 'modified') {
        out.push({
          seriesId: master.id,
          originalDate: date,
          startAt: isTodo ? null : (exception.startAt ?? (isAllDay ? date : shiftDateTime(date, startTime))),
          endAt: isTodo ? null : (exception.endAt ?? (isAllDay ? date : shiftDateTime(date, endTime, endOffset))),
          dueAt: isTodo ? (dueTime ? `${date}T${dueTime}` : date) : null,
          title: exception.title ?? master.title,
          location: exception.location ?? master.location,
          people: exception.people ?? master.people,
          note: exception.note ?? master.note,
          done: exception.done ?? master.done,
          isException: true,
          exceptionId: exception.id,
        })
        continue
      }
      out.push({
        seriesId: master.id,
        originalDate: date,
        startAt: isTodo ? null : (isAllDay ? date : shiftDateTime(date, startTime)),
        endAt: isTodo ? null : (isAllDay ? date : shiftDateTime(date, endTime, endOffset)),
        dueAt: isTodo ? (dueTime ? `${date}T${dueTime}` : date) : null,
        title: master.title,
        location: master.location,
        people: master.people,
        note: master.note,
        done: master.done,
        isException: false,
        exceptionId: null,
      })
    }
    return out.filter((item) => {
      const day = (item.startAt ?? item.dueAt ?? item.originalDate).slice(0, 10)
      return day >= rangeStart && day <= rangeEnd
    })
  }
}

/** 该系列在区间内是否有发生实例（用于判断是否显示）。 */
export function hasOccurrence(occurrences: Occurrence[]): boolean {
  return occurrences.length > 0
}

/** 三选一的处理范围文案（PRD 7.2）。 */
export const RECURRENCE_SCOPE_LABEL = {
  single: '仅这一次',
  following: '这一次及以后',
  all: '全部',
} as const

export type RecurrenceScope = keyof typeof RECURRENCE_SCOPE_LABEL

export const RECURRENCE_SCOPE_HINT: Record<RecurrenceScope, string> = {
  single: '只改这一天，其他日期保持原样',
  following: '从这一天起改成新规则，之前的保持不变',
  all: '整个系列一起改',
}

/** 常用重复规则的简短描述，用于详情与列表展示。 */
export function describeRule(rule: RecRule): string {
  const wdNames = ['一', '二', '三', '四', '五', '六', '日']
  const base =
    rule.freq === 'daily'
      ? '每天'
      : rule.freq === 'weekly'
        ? `每周${(rule.byWeekdays ?? []).map((wd) => wdNames[wd - 1]).join('、') || ''}`
        : rule.freq === 'biweekly'
          ? '每两周'
          : rule.freq === 'monthly'
            ? '每月'
            : rule.freq === 'yearly'
              ? '每年'
              : rule.intervalUnit === 'day'
                ? `每 ${rule.intervalValue ?? 1} 天`
                : `每 ${rule.intervalValue ?? 1} 周`
  const until = rule.untilDate ? `，至 ${rule.untilDate}` : ''
  const count = rule.maxCount ? `，共 ${rule.maxCount} 次` : ''
  return `${base}${until}${count}`
}
