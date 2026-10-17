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
