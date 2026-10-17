import type { EventItem } from './entities'
import { minutesOfTime, parseDateTime, weekdayIndex } from './date'

export const MINUTES_PER_DAY = 24 * 60

export interface Span {
  startMin: number
  endMin: number
}

/** 时间段事件的当日分钟区间；跨天时按当天截取。 */
export function spanOfDay(event: EventItem, date: string): Span | null {
  if (event.kind !== 'timed' || !event.startAt || !event.endAt) return null
  const startDay = event.startAt.slice(0, 10)
  const endDay = event.endAt.slice(0, 10)

  const startMin =
    startDay < date ? 0 : minutesOfTime(event.startAt.slice(11, 16))
  const endMinRaw =
    endDay > date ? MINUTES_PER_DAY : minutesOfTime(event.endAt.slice(11, 16))
  const endMin = Math.max(startMin, endMinRaw)

  if (startDay > date || endDay < date) return null
  return { startMin, endMin }
}

/** 日程块在时间轴上的位置（像素由界面按比例换算）。 */
export interface BlockGeometry {
  topMin: number
  heightMin: number
}

export function blockGeometry(span: Span): BlockGeometry {
  return { topMin: span.startMin, heightMin: Math.max(1, span.endMin - span.startMin) }
}

export interface PlacedBlock {
  id: string
  startMin: number
  endMin: number
  /** 第几列（0 起） */
  column: number
  /** 同一重叠簇里一共分几列 */
  columnCount: number
}

/** 两个时间段是否真的重叠（首尾相接不算）。 */
export function spansOverlap(a: Span, b: Span): boolean {
  return a.startMin < b.endMin && b.startMin < a.endMin
}

/**
 * 重叠排布：把同一天里互相重叠的日程拆成若干列并排显示。
 * 互相重叠的日程归为同一簇，簇内按开始时间贪心分列，簇的列数取最大值。
 */
export function layoutDay(items: Array<{ id: string } & Span>): PlacedBlock[] {
  const sorted = [...items].sort((a, b) => a.startMin - b.startMin || a.endMin - b.endMin)
  const result: PlacedBlock[] = []

  let cluster: Array<{ id: string } & Span> = []
  let clusterEnd = -1

  const flush = (): void => {
    if (cluster.length === 0) return
    const columns: Span[][] = []
    for (const item of cluster) {
      let placed = false
      for (let i = 0; i < columns.length; i += 1) {
        const last = columns[i][columns[i].length - 1]
        if (!spansOverlap(last, item)) {
          columns[i].push(item)
          result.push({ id: item.id, startMin: item.startMin, endMin: item.endMin, column: i, columnCount: 0 })
          placed = true
          break
        }
      }
      if (!placed) {
        columns.push([item])
        result.push({
          id: item.id,
          startMin: item.startMin,
          endMin: item.endMin,
          column: columns.length - 1,
          columnCount: 0,
        })
      }
    }
    const width = columns.length
    for (const block of result) {
      if (cluster.some((item) => item.id === block.id)) block.columnCount = width
    }
    cluster = []
    clusterEnd = -1
  }

  for (const item of sorted) {
    if (cluster.length > 0 && item.startMin >= clusterEnd) flush()
    cluster.push(item)
    clusterEnd = Math.max(clusterEnd, item.endMin)
  }
  flush()

  return result
}

/** 某一周的 7 个日期字符串（周一开头）。 */
export function weekDates(weekStart: Date): string[] {
  const out: string[] = []
  for (let i = 0; i < 7; i += 1) {
    const d = new Date(weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate() + i)
    out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`)
  }
  return out
}

/** 全天条里的条目：全天事件、跨天事件、待办。 */
export function isAllDayLike(event: EventItem): boolean {
  return event.kind === 'allDay' || event.kind === 'todo'
}

export interface AllDayChip {
  event: EventItem
  /** 在本周内的起止列（0..6，含） */
  startCol: number
  endCol: number
  /** 是否为跨天事件在中间被截断 */
  continuesLeft: boolean
  continuesRight: boolean
}

/** 把全天/跨天/待办事件排成“一周内的横向条”。 */
export function layoutAllDay(events: EventItem[], dates: string[]): AllDayChip[] {
  const first = dates[0]
  const last = dates[dates.length - 1]
  const chips: AllDayChip[] = []

  const spanOf = (event: EventItem): { start: string; end: string } | null => {
    if (event.kind === 'todo') {
      const day = event.dueAt ? event.dueAt.slice(0, 10) : null
      return day ? { start: day, end: day } : null
    }
    if (!event.startAt || !event.endAt) return null
    return { start: event.startAt.slice(0, 10), end: event.endAt.slice(0, 10) }
  }

  for (const event of events) {
    if (event.kind !== 'allDay' && event.kind !== 'todo') continue
    const span = spanOf(event)
    if (!span) continue
    if (span.start > last || span.end < first) continue
    const startCol = Math.max(0, dates.indexOf(span.start))
    const endColRaw = dates.indexOf(span.end)
    const endCol = endColRaw === -1 ? dates.length - 1 : endColRaw
    chips.push({
      event,
      startCol: startCol === -1 ? 0 : startCol,
      endCol: Math.max(startCol, endCol),
      continuesLeft: span.start < first,
      continuesRight: span.end > last,
    })
  }

  // 跨度长的排上面；同跨度全天事件优先于待办；再按起始列与标题，保证顺序稳定
  return chips.sort((a, b) => {
    const spanA = a.endCol - a.startCol
    const spanB = b.endCol - b.startCol
    if (spanA !== spanB) return spanB - spanA
    if (a.event.kind !== b.event.kind) return a.event.kind === 'allDay' ? -1 : 1
    if (a.startCol !== b.startCol) return a.startCol - b.startCol
    return a.event.title.localeCompare(b.event.title)
  })
}

/** 该日期是星期几（1=周一）。 */
export function weekdayOfDate(date: string): number {
  return weekdayIndex(parseDateTime(`${date}T00:00`))
}

/** 一条日程覆盖的日期区间；全天与时间段按起止，待办按截止日。 */
export function eventSpan(event: EventItem): { start: string; end: string } | null {
  if (event.kind === 'todo') {
    if (!event.dueAt) return null
    const day = event.dueAt.slice(0, 10)
    return { start: day, end: day }
  }
  if (!event.startAt || !event.endAt) return null
  const start = event.startAt.slice(0, 10)
  const end = event.endAt.slice(0, 10)
  return { start, end: end < start ? start : end }
}

/** 落在某一天的全部日程（含跨天）。 */
export function eventsOnDate(events: EventItem[], date: string): EventItem[] {
  return sortByTime(
    events.filter((event) => {
      const span = eventSpan(event)
      return span !== null && span.start <= date && span.end >= date
    }),
  )
}

/** 按开始时间排序：有时间段的在前，再者按时间，最后按标题。 */
export function sortByTime(events: EventItem[]): EventItem[] {
  return [...events].sort((a, b) => {
    const key = (event: EventItem): string => {
      if (event.kind === 'todo') return `2${event.dueAt ?? ''}`
      if (event.kind === 'allDay') return '1'
      return `0${event.startAt ?? ''}`
    }
    const diff = key(a).localeCompare(key(b))
    if (diff !== 0) return diff
    return a.title.localeCompare(b.title)
  })
}

/** 某月日历网格的 42 个日期（从周一开头，覆盖完整 6 周）。 */
export function monthGridDates(monthAnchor: Date): string[] {
  const first = new Date(monthAnchor.getFullYear(), monthAnchor.getMonth(), 1)
  // 网格起点：该月 1 日所在周的周一
  const gridStart = new Date(first)
  const wd = gridStart.getDay() === 0 ? 7 : gridStart.getDay()
  gridStart.setDate(gridStart.getDate() - (wd - 1))
  const out: string[] = []
  for (let i = 0; i < 42; i += 1) {
    const d = new Date(gridStart.getFullYear(), gridStart.getMonth(), gridStart.getDate() + i)
    out.push(
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`,
    )
  }
  return out
}

/** 该日期是否属于某个月（用于月视图把非本月日期灰显）。 */
export function isSameMonth(date: string, monthAnchor: Date): boolean {
  return (
    Number(date.slice(0, 4)) === monthAnchor.getFullYear() &&
    Number(date.slice(5, 7)) === monthAnchor.getMonth() + 1
  )
}

/** 从某天起算的连续 N 天（列表视图用）。 */
export function nextDays(startDate: string, count: number): string[] {
  const start = parseDateTime(`${startDate}T00:00`)
  const out: string[] = []
  for (let i = 0; i < count; i += 1) {
    const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i)
    out.push(
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`,
    )
  }
  return out
}

/**
 * 当天空闲时段（日视图右侧面板用）。
 * 先把重叠区间合并，再取间隙；不足最小时长（默认 30 分钟）的间隙忽略。
 */
export function freeSlots(
  spans: Span[],
  options: { minMinutes?: number; dayStart?: number; dayEnd?: number } = {},
): Span[] {
  const minMinutes = options.minMinutes ?? 30
  const dayStart = options.dayStart ?? 0
  const dayEnd = options.dayEnd ?? MINUTES_PER_DAY

  const sorted = spans
    .filter((span) => span.endMin > span.startMin)
    .map((span) => ({
      startMin: Math.max(span.startMin, dayStart),
      endMin: Math.min(span.endMin, dayEnd),
    }))
    .filter((span) => span.endMin > span.startMin)
    .sort((a, b) => a.startMin - b.startMin)

  const merged: Span[] = []
  for (const span of sorted) {
    const last = merged[merged.length - 1]
    if (last && span.startMin <= last.endMin) {
      last.endMin = Math.max(last.endMin, span.endMin)
    } else {
      merged.push({ ...span })
    }
  }

  const gaps: Span[] = []
  let cursor = dayStart
  for (const span of merged) {
    if (span.startMin - cursor >= minMinutes) gaps.push({ startMin: cursor, endMin: span.startMin })
    cursor = Math.max(cursor, span.endMin)
  }
  if (dayEnd - cursor >= minMinutes) gaps.push({ startMin: cursor, endMin: dayEnd })
  return gaps
}

/** 空闲分钟数合计。 */
export function totalFreeMinutes(spans: Span[]): number {
  return spans.reduce((sum, span) => sum + (span.endMin - span.startMin), 0)
}
