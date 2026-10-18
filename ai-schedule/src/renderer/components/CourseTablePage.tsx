import type { ReactNode } from 'react'
import type { Course, Period, Semester } from '../../shared/entities'
import { ODD_EVEN_LABEL, coursePeriodSpan } from '../../shared/courseUi'
import { formatChineseDate, parseDate, sameDay, semesterWeekIndex } from '../../shared/date'
import { WEEKDAY_SHORT } from './weekdayLabels'

export interface CourseTablePageProps {
  semesters: Semester[]
  semester: Semester | null
  periods: Period[]
  courses: Course[]
  today: Date
  /** 表格上方的扩展区（AI 录入入口） */
  aiSlot?: ReactNode
  onSelectSemester: (id: string) => void
  onNewSemester: () => void
  onEditSemester: () => void
  onOpenPeriods: () => void
  onCreateCourse: (weekday: number, periodIndex: number) => void
  onSelectCourse: (id: string) => void
}

/** 课程表页：以课表网格为主，学期与作息时间表放在页内右上角（PRD 6.5）。 */
export function CourseTablePage({
  semesters,
  semester,
  periods,
  courses,
  today,
  aiSlot,
  onSelectSemester,
  onNewSemester,
  onEditSemester,
  onOpenPeriods,
  onCreateCourse,
  onSelectCourse,
}: CourseTablePageProps): ReactNode {
  const weekIndex = semester ? semesterWeekIndex(semester.startDate, today) : 0
  const inSemester = semester !== null && weekIndex >= 1 && weekIndex <= semester.weeks

  return (
    <section className="page" aria-label="课程表">
      <div className="page__header">
        <span className="page__title">课程表</span>
        <span className="toolbar-spacer" />
        <span className="page__subtitle">今天是{semester ? `第 ${weekIndex} 周 ` : ''}{formatChineseDate(today)}</span>
        <select
          className="field__select"
          aria-label="选择学期"
          data-testid="semester-select"
          value={semester?.id ?? ''}
          onChange={(event) => onSelectSemester(event.target.value)}
        >
          {semesters.length === 0 ? <option value="">（还没有学期）</option> : null}
          {semesters.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}
            </option>
          ))}
        </select>
        <button type="button" className="btn btn--sm" onClick={onNewSemester}>
          新建学期
        </button>
        <button type="button" className="btn btn--sm" onClick={onEditSemester} disabled={!semester}>
          学期设置
        </button>
        <button type="button" className="btn btn--sm" onClick={onOpenPeriods}>
          作息时间表
        </button>
      </div>

      {aiSlot ? <div className="page__ai">{aiSlot}</div> : null}

      {!semester ? (
        <div className="page__body">
          <p className="placeholder">先新建一个学期，再往课表里添加课程。</p>
        </div>
      ) : (
        <>
          {!inSemester ? (
            <div className="table-banner" role="status">
              今天不在该学期的周次范围内（学期共 {semester.weeks} 周，从 {semester.startDate} 开始）
            </div>
          ) : null}
          <div className="page__body page__body--flush">
            <div className="course-table" data-testid="course-table">
              <div className="course-table__corner">节次</div>
              {WEEKDAY_SHORT.map((label) => (
                <div key={label} className="course-table__head">
                  {label}
                </div>
              ))}

              {periods.map((period) => (
                <div key={period.id} className="course-table__row">
                  <div className="course-table__period" data-testid={`period-${period.orderIndex}`}>
                    <span className="course-table__period-name">{period.name}</span>
                    <span className="course-table__period-time">{period.startTime}</span>
                  </div>
                  {[1, 2, 3, 4, 5, 6, 7].map((weekday) => {
                    const spans = courses
                      .filter((course) => course.weekday === weekday)
                      .map((course) => ({ course, span: coursePeriodSpan(course, periods) }))
                    const cellCourses = spans
                      .filter(
                        (item) =>
                          item.span !== null &&
                          item.span.from <= period.orderIndex &&
                          item.span.to >= period.orderIndex,
                      )
                      .map((item) => item.course)
                    const isFirstRowOfCourse = spans.some(
                      (item) => item.span !== null && item.span.from === period.orderIndex,
                    )
                    return (
                      <div
                        key={weekday}
                        className="course-table__cell"
                        data-testid={`cell-${weekday}-${period.orderIndex}`}
                        onDoubleClick={() => onCreateCourse(weekday, period.orderIndex)}
                      >
                        {cellCourses
                          .filter(
                            (course) => coursePeriodSpan(course, periods)?.from === period.orderIndex,
                          )
                          .map((course) => {
                            const computed = coursePeriodSpan(course, periods)
                            const span = computed ? computed.to - computed.from + 1 : 1
                            return (
                              <button
                                key={course.id}
                                type="button"
                                className="course-cell"
                                data-testid={`course-${course.id}`}
                                style={{ height: `${span * 84 - 8}px` }}
                                onClick={(event) => {
                                  event.stopPropagation()
                                  onSelectCourse(course.id)
                                }}
                                onDoubleClick={(event) => {
                                  event.stopPropagation()
                                  onSelectCourse(course.id)
                                }}
                                title={`${course.title}${course.location ? ` · ${course.location}` : ''}`}
                              >
                                <span className="course-cell__title">{course.title}</span>
                                <span className="course-cell__meta">
                                  {ODD_EVEN_LABEL[course.oddEven]}
                                  {course.location ? ` · ${course.location}` : ''}
                                </span>
                              </button>
                            )
                          })}
                        {!isFirstRowOfCourse ? null : null}
                      </div>
                    )
                  })}
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </section>
  )
}

export { sameDay, parseDate }
