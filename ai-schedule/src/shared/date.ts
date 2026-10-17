/**
 * 日期与时间工具：全部使用本地时间，不引入时区概念。
 *
 * 约定：
 * - 日期字符串：'YYYY-MM-DD'
 * - 日期时间字符串：'YYYY-MM-DDTHH:mm'
 * - 时刻字符串：'HH:mm'
 * - 星期：1 = 周一 … 7 = 周日
 */

const WEEKDAY_CN = ['周一', '周二', '周三', '周四', '周五', '周六', '周日']

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n)
}

/** 两位补零（供测试与外部格式化复用）。 */
export function pad2Safe(n: number): string {
  return pad2(n)
}

/** 允许的年份范围：超出这个范围的输入一定是误输入（用户反馈第 9 条）。 */
export const MIN_YEAR = 1900
export const MAX_YEAR = 2100

export function isValidYear(year: number): boolean {
  return Number.isInteger(year) && year >= MIN_YEAR && year <= MAX_YEAR
}

export function isValidDateString(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  if (!isValidYear(Number(value.slice(0, 4)))) return false
  const d = parseDate(value)
  return formatDate(d) === value
}

export function isValidTimeString(value: string): boolean {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(value)
}

export function isValidDateTimeString(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return false
  const [datePart, timePart] = value.split('T')
  return isValidDateString(datePart) && isValidTimeString(timePart)
}

/** 解析 'YYYY-MM-DD' 为本地时间当日 00:00。 */
export function parseDate(value: string): Date {
  const [y, m, d] = value.split('-').map(Number)
  const date = new Date(y, m - 1, d, 0, 0, 0, 0)
  if (Number.isNaN(date.getTime())) throw new Error(`无法解析日期：${value}`)
  return date
}

/** 解析 'YYYY-MM-DDTHH:mm' 为本地时间。 */
export function parseDateTime(value: string): Date {
  const [datePart, timePart] = value.split('T')
  const date = parseDate(datePart)
  const [h, m] = timePart.split(':').map(Number)
  date.setHours(h, m, 0, 0)
  return date
}

export function formatDate(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
}

export function formatDateTime(d: Date): string {
  return `${formatDate(d)}T${pad2(d.getHours())}:${pad2(d.getMinutes())}`
}

export function formatTime(d: Date): string {
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`
}

/** 拼接日期与时刻：若时刻为 '24:00' 则落到次日 00:00。 */
export function combineDateTime(dateStr: string, timeStr: string): string {
  if (timeStr === '24:00') {
    return `${formatDate(addDays(parseDate(dateStr), 1))}T00:00`
  }
  return `${dateStr}T${timeStr}`
}

export function addDays(d: Date, days: number): Date {
  const next = new Date(d.getTime())
  next.setDate(next.getDate() + days)
  return next
}

/** 加减月份；若目标月没有对应日（如 1 月 31 日加一个月），回退到该月最后一天。 */
export function addMonths(d: Date, months: number): Date {
  const year = d.getFullYear()
  const month = d.getMonth() + months
  const day = d.getDate()
  const lastDay = new Date(year, month + 1, 0).getDate()
  return new Date(year, month, Math.min(day, lastDay), d.getHours(), d.getMinutes(), 0, 0)
}

export function addYears(d: Date, years: number): Date {
  return addMonths(d, years * 12)
}

export function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0)
}

export function endOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999)
}

/** 周一为一周之始。 */
export function startOfWeekMonday(d: Date): Date {
  const base = startOfDay(d)
  const wd = base.getDay() === 0 ? 7 : base.getDay() // 周日转成 7
  return addDays(base, 1 - wd)
}

export function endOfWeekMonday(d: Date): Date {
  return endOfDay(addDays(startOfWeekMonday(d), 6))
}

export function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1, 0, 0, 0, 0)
}

export function endOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59, 999)
}

/** 相差整天数（b - a），按本地日历计算。 */
export function diffDays(a: Date, b: Date): number {
  const ms = startOfDay(b).getTime() - startOfDay(a).getTime()
  return Math.round(ms / 86400000)
}

export function sameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  )
}

/** 1 = 周一 … 7 = 周日。 */
export function weekdayIndex(d: Date): number {
  const wd = d.getDay()
  return wd === 0 ? 7 : wd
}

/** 该日期是本月的第几周（以周一为界，1 起）。 */
export function weekOfMonth(d: Date): number {
  const first = new Date(d.getFullYear(), d.getMonth(), 1, 0, 0, 0, 0)
  const firstWeekday = weekdayIndex(first)
  return Math.floor((d.getDate() + firstWeekday - 2) / 7) + 1
}

/** 时刻字符串转当日分钟数。 */
export function minutesOfTime(timeStr: string): number {
  if (timeStr === '24:00') return 24 * 60
  const [h, m] = timeStr.split(':').map(Number)
  return h * 60 + m
}

/** 当日分钟数转 'HH:mm'（1440 视为 '24:00'）。 */
export function timeFromMinutes(minutes: number): string {
  const clamped = Math.max(0, Math.min(24 * 60, Math.round(minutes)))
  if (clamped === 24 * 60) return '24:00'
  return `${pad2(Math.floor(clamped / 60))}:${pad2(clamped % 60)}`
}

/** 起止日期之间（含两端）的每一天。 */
export function enumerateDates(startDate: string, endDate: string): string[] {
  const start = parseDate(startDate)
  const end = parseDate(endDate)
  const out: string[] = []
  let cursor = start
  let guard = 0
  while (cursor.getTime() <= end.getTime() && guard < 4000) {
    out.push(formatDate(cursor))
    cursor = addDays(cursor, 1)
    guard += 1
  }
  return out
}

/** 中文日期：“3月4日 周三”；跨年时带年份。 */
export function formatChineseDate(d: Date, withYear = false): string {
  const wd = WEEKDAY_CN[weekdayIndex(d) - 1]
  const yearPart = withYear ? `${d.getFullYear()}年` : ''
  return `${yearPart}${d.getMonth() + 1}月${d.getDate()}日 ${wd}`
}

export function formatChineseWeekday(d: Date): string {
  return WEEKDAY_CN[weekdayIndex(d) - 1]
}

/** 今天/明天/周几 M月D日 —— 列表视图的分组标题。 */
export function formatRelativeDayLabel(target: Date, today: Date): string {
  const delta = diffDays(today, target)
  if (delta === 0) return `今天 · ${formatChineseDate(target)}`
  if (delta === 1) return `明天 · ${formatChineseDate(target)}`
  if (delta === -1) return `昨天 · ${formatChineseDate(target)}`
  return formatChineseDate(target)
}

/** 第几周（从学期第 1 周周一起算，1 起）；不在学期内返回 0。 */
export function semesterWeekIndex(semesterStartDate: string, date: Date): number {
  const start = parseDate(semesterStartDate)
  const offset = diffDays(start, startOfDay(date))
  if (offset < 0) return 0
  return Math.floor(offset / 7) + 1
}

export function isOddWeek(weekIndex: number): boolean {
  return weekIndex % 2 === 1
}

/** 月份天数。 */
export function daysInMonth(year: number, month1to12: number): number {
  return new Date(year, month1to12, 0).getDate()
}

/** 该月内所有匹配“几号”的日期字符串；不存在的日期跳过。 */
export function datesOfMonthDay(year: number, month1to12: number, day: number): string[] {
  if (day < 1 || day > daysInMonth(year, month1to12)) return []
  return [`${year}-${pad2(month1to12)}-${pad2(day)}`]
}

/** 把 'YYYY-MM-DDTHH:mm' 平移若干分钟（可负），跨天自动进位。 */
export function shiftDateTimeString(value: string, minutes: number): string {
  const d = parseDateTime(value)
  d.setMinutes(d.getMinutes() + minutes)
  return formatDateTime(d)
}

/** 把时间吸附到最近的 N 分钟（拖动时用，默认 15 分钟）。 */
export function snapMinutes(minutes: number, step = 15): number {
  return Math.round(minutes / step) * step
}

export function nowLocal(): Date {
  return new Date()
}

export function isoWeekLabel(d: Date): string {
  return `${d.getMonth() + 1}月${d.getDate()}日`
}
