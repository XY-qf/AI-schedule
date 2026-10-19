import type { Course, EventItem, Period, Semester } from './entities'
import { addDays, formatDate, parseDate, semesterWeekIndex, weekdayIndex } from './date'

/** 课程的单次调课/停课记录（结构兼容仓储里的类型）。 */
export interface CourseExceptionLike {
  id: string
  courseId: string
  originalDate: string
  action: 'moved' | 'cancelled'
  startAt: string | null
  endAt: string | null
  note?: string | null
}

export interface CourseOccurrence {
  courseId: string
  /** 原本应该上课的日期 */
  date: string
  startAt: string
  endAt: string
  title: string
  location: string | null
  teacher: string | null
  semesterId: string
  color: string | null
  isException: boolean
  exceptionId: string | null
  note: string | null
}

/** 把「第几节」换算成起止时刻；节次不存在时返回 null。 */
export function periodTimes(
  periods: Period[],
  from: number,
  to: number,
): { startTime: string; endTime: string } | null {
  const start = periods.find((period) => period.orderIndex === from)
  const end = periods.find((period) => period.orderIndex === to)
  if (!start || !end) return null
  return { startTime: start.startTime, endTime: end.endTime }
}

/** 一门课在某天的起止时刻（按节次或按具体时间）。 */
export function courseTimes(
  course: Course,
  periods: Period[],
): { startTime: string; endTime: string } | null {
  if (course.timeMode === 'period') {
    if (course.startPeriod === null || course.endPeriod === null) return null
    return periodTimes(periods, course.startPeriod, course.endPeriod)
  }
  if (!course.startTime || !course.endTime) return null
  return { startTime: course.startTime, endTime: course.endTime }
}

/** 该课是否在指定周次出现（周次范围 + 单双周）。 */
export function courseHappensInWeek(course: Course, weekIndex: number): boolean {
  if (weekIndex < course.weekFrom || weekIndex > course.weekTo) return false
  if (course.oddEven === 'odd') return weekIndex % 2 === 1
  if (course.oddEven === 'even') return weekIndex % 2 === 0
  return true
}

/**
 * 展开某学期在一段日期内的全部课程实例（PRD 9.2）。
 * 调课：原位置不再出现，改到新时间出现；停课：原位置不再出现。
 */
export function expandCourses(
  courses: Course[],
  periods: Period[],
  semester: Semester,
  exceptions: CourseExceptionLike[],
  rangeStart: string,
  rangeEnd: string,
): CourseOccurrence[] {
  const byKey = new Map<string, CourseExceptionLike>()
  for (const exception of exceptions) {
    byKey.set(`${exception.courseId}|${exception.originalDate}`, exception)
  }

  const start = parseDate(rangeStart)
  const end = parseDate(rangeEnd)
  const out: CourseOccurrence[] = []

  for (const course of courses) {
    if (course.semesterId !== semester.id) continue
    const times = courseTimes(course, periods)
    if (!times) continue

    let cursor = start
    let guard = 0
    while (cursor.getTime() <= end.getTime() && guard < 400) {
      const date = formatDate(cursor)
      if (weekdayIndex(cursor) === course.weekday) {
        const weekIndex = semesterWeekIndex(semester.startDate, cursor)
        const inSemester = weekIndex >= 1 && weekIndex <= semester.weeks
        if (inSemester && courseHappensInWeek(course, weekIndex)) {
          const exception = byKey.get(`${course.id}|${date}`)
          if (exception && exception.action === 'cancelled') {
            // 停课：原位置不再出现
          } else if (exception && exception.action === 'moved' && exception.startAt && exception.endAt) {
            // 改期：原位置消失，新时间出现
            out.push({
              courseId: course.id,
              date,
              startAt: exception.startAt,
              endAt: exception.endAt,
              title: course.title,
              location: course.location,
              teacher: course.teacher,
              semesterId: course.semesterId,
              color: course.color,
              isException: true,
              exceptionId: exception.id,
              note: exception.note ?? '由课程调课',
            })
          } else {
            out.push({
              courseId: course.id,
              date,
              startAt: `${date}T${times.startTime}`,
              endAt: `${date}T${times.endTime}`,
              title: course.title,
              location: course.location,
              teacher: course.teacher,
              semesterId: course.semesterId,
              color: course.color,
              isException: false,
              exceptionId: null,
              note: null,
            })
          }
        }
      }
      cursor = addDays(cursor, 1)
      guard += 1
    }
  }

  return out.sort((a, b) => (a.startAt < b.startAt ? -1 : a.startAt > b.startAt ? 1 : 0))
}

/** 课程实例转成日历里的日程条目（只读展示，不写库）。 */
export function courseOccurrenceToEvent(occurrence: CourseOccurrence): EventItem {
  return {
    id: `course:${occurrence.courseId}:${occurrence.date}`,
    title: occurrence.title,
    category: 'course',
    kind: 'timed',
    startAt: occurrence.startAt,
    endAt: occurrence.endAt,
    dueAt: null,
    location: occurrence.location,
    people: occurrence.teacher,
    note: occurrence.note,
    done: false,
    recurrenceId: null,
    createdAt: '',
    updatedAt: '',
  }
}

/** 该日期属于学期的第几周；不在学期内返回 0。 */
export function weekOfSemester(semester: Semester, date: Date): number {
  const index = semesterWeekIndex(semester.startDate, date)
  return index >= 1 && index <= semester.weeks ? index : 0
}
