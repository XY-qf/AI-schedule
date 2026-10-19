import {
  formatChineseWeekday,
  formatDate,
  formatTime,
  isOddWeek,
  semesterWeekIndex,
} from '../../shared/date'

/**
 * 提示词里的「现在时间」。
 *
 * 例：`2026-10-18（周日）14:32，当前是第 7 周（单周）`
 * 有了它，模型才能正确理解「今天」「明晚」「这周五」「下周开始」这类相对说法，
 * 也才能判断某门课现在是否还在上课周次内。
 */
export function formatNowText(now: Date, semesterStartDate?: string): string {
  const date = formatDate(now)
  const weekday = formatChineseWeekday(now)
  const time = formatTime(now)
  let text = `${date}（${weekday}）${time}`
  if (semesterStartDate) {
    const week = semesterWeekIndex(semesterStartDate, now)
    if (week > 0) {
      text += `，当前是第 ${week} 周（${isOddWeek(week) ? '单' : '双'}周）`
    }
  }
  return text
}
