import type { EventItem } from './entities'
import { daysInMonth } from './date'

export type TodoBucket = 'overdue' | 'today' | 'thisWeek' | 'later'

export const TODO_BUCKET_LABEL: Record<TodoBucket, string> = {
  overdue: '逾期',
  today: '今天',
  thisWeek: '本周',
  later: '以后',
}

export const TODO_BUCKET_ORDER: TodoBucket[] = ['overdue', 'today', 'thisWeek', 'later']

function isoDate(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

/** 该日期落在哪一组：逾期 / 今天 / 本周 / 以后（本周以周一为界）。 */
export function bucketOf(date: string, today: Date): TodoBucket {
  const todayStr = isoDate(today)
  if (date < todayStr) return 'overdue'
  if (date === todayStr) return 'today'

  const wd = today.getDay() === 0 ? 7 : today.getDay()
  const weekEnd = new Date(today.getFullYear(), today.getMonth(), today.getDate() + (7 - wd))
  return date <= isoDate(weekEnd) ? 'thisWeek' : 'later'
}

/** 待办的日期键：有截止时间取日期部分。 */
export function dueDateOf(event: EventItem): string | null {
  if (event.kind === 'todo') return event.dueAt ? event.dueAt.slice(0, 10) : null
  if (event.kind === 'allDay') return event.startAt ? event.startAt.slice(0, 10) : null
  return event.startAt ? event.startAt.slice(0, 10) : null
}

export interface TodoGroups {
  overdue: EventItem[]
  today: EventItem[]
  thisWeek: EventItem[]
  later: EventItem[]
  done: EventItem[]
}

/** 待办分组（PRD 6.7）：已完成单独一组，未完成按到期时间分四组。 */
export function groupTodos(items: EventItem[], today: Date): TodoGroups {
  const groups: TodoGroups = { overdue: [], today: [], thisWeek: [], later: [], done: [] }
  for (const item of items) {
    if (item.done) {
      groups.done.push(item)
      continue
    }
    const date = dueDateOf(item)
    if (!date) {
      groups.later.push(item)
      continue
    }
    groups[bucketOf(date, today)].push(item)
  }
  const byDue = (a: EventItem, b: EventItem): number => {
    const da = dueDateOf(a) ?? '9999-99-99'
    const db = dueDateOf(b) ?? '9999-99-99'
    if (da !== db) return da < db ? -1 : 1
    return a.title.localeCompare(b.title)
  }
  groups.overdue.sort(byDue)
  groups.today.sort(byDue)
  groups.thisWeek.sort(byDue)
  groups.later.sort(byDue)
  groups.done.sort(byDue)
  return groups
}

export interface TimeGroups {
  upcoming: EventItem[]
  past: EventItem[]
}

/** 分类页分组（PRD 6.6）：即将到来（含今天）与更早。 */
export function groupByTime(items: EventItem[], today: Date): TimeGroups {
  const todayStr = isoDate(today)
  const upcoming: EventItem[] = []
  const past: EventItem[] = []
  for (const item of items) {
    const date = dueDateOf(item)
    if (!date || date >= todayStr) upcoming.push(item)
    else past.push(item)
  }
  upcoming.sort((a, b) => {
    const da = dueDateOf(a) ?? '9999-99-99'
    const db = dueDateOf(b) ?? '9999-99-99'
    if (da !== db) return da < db ? -1 : 1
    return a.title.localeCompare(b.title)
  })
  past.sort((a, b) => {
    const da = dueDateOf(a) ?? '0000-00-00'
    const db = dueDateOf(b) ?? '0000-00-00'
    if (da !== db) return da > db ? -1 : 1
    return a.title.localeCompare(b.title)
  })
  return { upcoming, past }
}

export interface MonthCellSummary {
  day: number
  inMonth: boolean
}

/** 某月天数（导出给页面用，避免各处重复算）。 */
export function daysOfMonth(year: number, month1to12: number): number {
  return daysInMonth(year, month1to12)
}
