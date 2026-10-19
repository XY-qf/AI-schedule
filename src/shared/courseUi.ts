import type { Course, OddEven, Period } from './entities'
import { courseTimes } from './courseSchedule'

export { courseTimes }

export const ODD_EVEN_LABEL: Record<OddEven, string> = {
  all: '每周',
  odd: '单周',
  even: '双周',
}

/** 课程的周次描述，例如「1–16 周 · 单周」。 */
export function describeCourseWeeks(course: Course): string {
  const range =
    course.weekFrom === course.weekTo ? `第 ${course.weekFrom} 周` : `${course.weekFrom}–${course.weekTo} 周`
  const odd = course.oddEven === 'all' ? '' : ` · ${ODD_EVEN_LABEL[course.oddEven]}`
  return `${range}${odd}`
}

/** 课程时间描述：节次模式显示「第 1-2 节 08:00–09:40」。 */
export function describeCourseTime(course: Course, periods: Period[]): string {
  const times = courseTimes(course, periods)
  if (course.timeMode === 'period') {
    const range =
      course.startPeriod === course.endPeriod
        ? `第 ${course.startPeriod} 节`
        : `第 ${course.startPeriod}-${course.endPeriod} 节`
    return times ? `${range} ${times.startTime}–${times.endTime}` : range
  }
  return times ? `${times.startTime}–${times.endTime}` : '时间未填'
}

/**
 * 这门课在作息表上占第几节到第几节。
 *
 * 节次模式直接用录入的节次；按时间录入的课没有节次，
 * 就按时间区间与每节课的重叠情况换算出来——否则它在课程表里一格都不占，
 * 只剩日历里能看到（用户反馈第 8 条）。
 */
export function coursePeriodSpan(
  course: Course,
  periods: Period[],
): { from: number; to: number } | null {
  if (course.timeMode === 'period') {
    const from = course.startPeriod ?? 0
    const to = course.endPeriod ?? from
    return from >= 1 ? { from, to: Math.max(from, to) } : null
  }

  const times = courseTimes(course, periods)
  if (!times) return null

  const covered = periods
    .filter((period) => period.startTime < times.endTime && period.endTime > times.startTime)
    .map((period) => period.orderIndex)
    .sort((a, b) => a - b)

  if (covered.length === 0) return null
  return { from: covered[0], to: covered[covered.length - 1] }
}
