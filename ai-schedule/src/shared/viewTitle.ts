import { formatChineseDate, parseDate, weekOfMonth } from './date'
import type { ViewKey } from './navigation'

/** 工具栏标题文字：随视图粒度变化。 */
export function viewTitle(view: ViewKey, anchor: Date): string {
  if (view === 'week') {
    return `${anchor.getFullYear()}年${anchor.getMonth() + 1}月 第${weekOfMonth(anchor)}周`
  }
  if (view === 'day') {
    return formatChineseDate(anchor, true)
  }
  if (view === 'month') {
    return `${anchor.getFullYear()}年${anchor.getMonth() + 1}月`
  }
  return '接下来 30 天'
}

/** 周视图表头：从周一到周日的日期范围，例如 “3月2日 – 3月8日”。 */
export function weekRangeLabel(weekStart: Date): string {
  const end = new Date(weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate() + 6)
  const left = `${weekStart.getMonth() + 1}月${weekStart.getDate()}日`
  const right =
    end.getMonth() === weekStart.getMonth()
      ? `${end.getDate()}日`
      : `${end.getMonth() + 1}月${end.getDate()}日`
  return `${left} – ${right}`
}

/** 按视图粒度移动锚点日期。 */
export function shiftAnchor(view: ViewKey, anchor: Date, direction: 1 | -1): Date {
  const next = new Date(anchor.getTime())
  if (view === 'week') next.setDate(next.getDate() + 7 * direction)
  else if (view === 'day') next.setDate(next.getDate() + direction)
  else if (view === 'month') next.setMonth(next.getMonth() + direction)
  else next.setDate(next.getDate() + 30 * direction)
  return next
}

export function parseAnchor(value: string | null | undefined): Date {
  if (!value) return new Date()
  try {
    return parseDate(value)
  } catch {
    return new Date()
  }
}
