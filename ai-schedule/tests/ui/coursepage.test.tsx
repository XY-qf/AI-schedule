import { describe, expect, it } from '../helpers/expect'
import { cleanup, fireEvent, render, screen } from '../helpers/ui'
import type { Course, CourseInput, Period, Semester } from '../../src/shared/entities'
import { CourseTablePage } from '../../src/renderer/components/CourseTablePage'
import { CourseDialog } from '../../src/renderer/components/CourseDialog'
import { describeCourseTime, describeCourseWeeks } from '../../src/shared/courseUi'
import { parseDate } from '../../src/shared/date'

const PERIODS: Period[] = [
  { id: 'p1', name: '第 1 节', startTime: '08:00', endTime: '08:45', orderIndex: 1 },
  { id: 'p2', name: '第 2 节', startTime: '08:55', endTime: '09:40', orderIndex: 2 },
  { id: 'p3', name: '第 3 节', startTime: '10:00', endTime: '10:45', orderIndex: 3 },
]

const SEMESTER: Semester = {
  id: 'sem-1',
  name: '2026 春季',
  startDate: '2026-03-02',
  weeks: 18,
  isCurrent: true,
  createdAt: '',
  updatedAt: '',
}

function makeCourse(partial: Partial<Course> = {}): Course {
  return {
    id: 'c1',
    semesterId: 'sem-1',
    title: '高等数学',
    teacher: '王老师',
    location: 'A101',
    weekday: 1,
    timeMode: 'period',
    startPeriod: 1,
    endPeriod: 2,
    startTime: null,
    endTime: null,
    weekFrom: 1,
    weekTo: 16,
    oddEven: 'all',
    color: null,
    createdAt: '',
    updatedAt: '',
    ...partial,
  }
}

describe('课程描述文案', () => {
  it('周次与单双周', () => {
    expect(describeCourseWeeks(makeCourse())).toBe('1–16 周')
    expect(describeCourseWeeks(makeCourse({ weekFrom: 3, weekTo: 3 }))).toBe('第 3 周')
    expect(describeCourseWeeks(makeCourse({ oddEven: 'odd' }))).toBe('1–16 周 · 单周')
  })

  it('节次模式与时间模式', () => {
    expect(describeCourseTime(makeCourse(), PERIODS)).toBe('第 1-2 节 08:00–09:40')
    expect(describeCourseTime(makeCourse({ startPeriod: 1, endPeriod: 1 }), PERIODS)).toBe('第 1 节 08:00–08:45')
    expect(
      describeCourseTime(makeCourse({ timeMode: 'clock', startTime: '14:00', endTime: '15:40' }), PERIODS),
    ).toBe('14:00–15:40')
  })
})

describe('课程表页', () => {
  function renderPage(courses: Course[], overrides: Partial<Parameters<typeof CourseTablePage>[0]> = {}) {
    const calls: string[] = []
    render(
      <CourseTablePage
        semesters={[SEMESTER]}
        semester={SEMESTER}
        periods={PERIODS}
        courses={courses}
        today={parseDate('2026-03-04')}
        onSelectSemester={(id) => calls.push(`semester:${id}`)}
        onNewSemester={() => calls.push('newSemester')}
        onEditSemester={() => calls.push('editSemester')}
        onOpenPeriods={() => calls.push('periods')}
        onCreateCourse={(weekday, period) => calls.push(`create:${weekday}:${period}`)}
        onSelectCourse={(id) => calls.push(`select:${id}`)}
        {...overrides}
      />,
    )
    return calls
  }

  it('渲染七列表头与节次行', () => {
    renderPage([])
    expect(screen.getByTestId('course-table')).toBeTruthy()
    expect(document.body.textContent).toContain('周一')
    expect(document.body.textContent).toContain('周日')
    expect(screen.getByTestId('period-1').textContent).toContain('08:00')
    cleanup()
  })

  it('课程落在正确的星期与节次格子里', () => {
    renderPage([makeCourse()])
    const cell = screen.getByTestId('cell-1-1')
    expect(cell.contains(screen.getByTestId('course-c1'))).toBe(true)
    expect(screen.getByTestId('cell-2-1').contains(screen.getByTestId('course-c1'))).toBe(false)
    cleanup()
  })

  it('课程块显示单双周与地点', () => {
    renderPage([makeCourse({ oddEven: 'odd' })])
    const block = screen.getByTestId('course-c1')
    expect(block.textContent).toContain('高等数学')
    expect(block.textContent).toContain('单周')
    expect(block.textContent).toContain('A101')
    cleanup()
  })

  it('跨两节的课程高度按节数计算', () => {
    renderPage([makeCourse({ startPeriod: 1, endPeriod: 2 })])
    expect(screen.getByTestId('course-c1').style.height).toBe('160px')
    cleanup()
  })

  it('双击空格子按星期与节次新建', () => {
    const calls = renderPage([])
    fireEvent.doubleClick(screen.getByTestId('cell-3-2'))
    expect(calls).toEqual(['create:3:2'])
    cleanup()
  })

  it('点击课程回传课程 id', () => {
    const calls = renderPage([makeCourse()])
    fireEvent.click(screen.getByTestId('course-c1'))
    expect(calls).toEqual(['select:c1'])
    cleanup()
  })

  it('顶部按钮回传学期与作息表操作', () => {
    const calls = renderPage([])
    fireEvent.click(screen.getByRole('button', { name: '新建学期' }))
    fireEvent.click(screen.getByRole('button', { name: '学期设置' }))
    fireEvent.click(screen.getByRole('button', { name: '作息时间表' }))
    expect(calls).toEqual(['newSemester', 'editSemester', 'periods'])
    cleanup()
  })

  it('切换学期回传 id', () => {
    const calls = renderPage([], {
      semesters: [SEMESTER, { ...SEMESTER, id: 'sem-2', name: '2026 秋季' }],
    })
    fireEvent.change(screen.getByTestId('semester-select'), { target: { value: 'sem-2' } })
    expect(calls).toEqual(['semester:sem-2'])
    cleanup()
  })

  it('没有学期时提示先建学期', () => {
    renderPage([], { semester: null, semesters: [] })
    expect(document.body.textContent).toContain('先新建一个学期')
    cleanup()
  })

  it('今天不在学期周次内时给出提示', () => {
    renderPage([], { today: parseDate('2026-08-01') })
    expect(document.body.textContent).toContain('今天不在该学期的周次范围内')
    cleanup()
  })
})

describe('课程录入弹窗', () => {
  function renderDialog(props: Partial<Parameters<typeof CourseDialog>[0]> = {}) {
    const saved: CourseInput[] = []
    const calls: string[] = []
    render(
      <CourseDialog
        open
        mode="create"
        semesterId="sem-1"
        periods={PERIODS}
        defaults={{ weekday: 3, periodIndex: 2 }}
        canDelete
        onSave={(input) => saved.push(input)}
        onDelete={() => calls.push('delete')}
        onClose={() => calls.push('close')}
        {...props}
      />,
    )
    return { saved, calls }
  }

  it('按点击的格子预填星期与节次', () => {
    renderDialog()
    expect((screen.getByLabelText('星期') as HTMLSelectElement).value).toBe('3')
    expect((screen.getByLabelText('开始节次') as HTMLSelectElement).value).toBe('2')
    expect((screen.getByLabelText('结束节次') as HTMLSelectElement).value).toBe('2')
    expect((screen.getByLabelText('起始周') as HTMLInputElement).value).toBe('1')
    expect((screen.getByLabelText('结束周') as HTMLInputElement).value).toBe('16')
    cleanup()
  })

  it('课名为空时给出中文提示且不保存', () => {
    const { saved } = renderDialog()
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    expect(saved).toEqual([])
    expect(screen.getByRole('alert').textContent).toContain('请填写课名')
    cleanup()
  })

  it('按节次保存的载荷正确', () => {
    const { saved } = renderDialog()
    fireEvent.change(screen.getByLabelText('课名'), { target: { value: '大学物理' } })
    fireEvent.change(screen.getByLabelText('地点'), { target: { value: 'B203' } })
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    expect(saved).toEqual([
      {
        semesterId: 'sem-1',
        title: '大学物理',
        teacher: null,
        location: 'B203',
        weekday: 3,
        timeMode: 'period',
        startPeriod: 2,
        endPeriod: 2,
        startTime: null,
        endTime: null,
        weekFrom: 1,
        weekTo: 16,
        oddEven: 'all',
      },
    ])
    cleanup()
  })

  it('切换成具体时间后改为提交时间字段', () => {
    const { saved } = renderDialog()
    fireEvent.change(screen.getByLabelText('课名'), { target: { value: '英语' } })
    fireEvent.change(screen.getByLabelText('时间方式'), { target: { value: 'clock' } })
    fireEvent.change(screen.getByLabelText('开始时间'), { target: { value: '14:00' } })
    fireEvent.change(screen.getByLabelText('结束时间'), { target: { value: '15:40' } })
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    expect(saved[0].timeMode).toBe('clock')
    expect(saved[0].startTime).toBe('14:00')
    expect(saved[0].startPeriod).toBeNull()
    cleanup()
  })

  it('单双周可选并进入载荷', () => {
    const { saved } = renderDialog()
    fireEvent.change(screen.getByLabelText('课名'), { target: { value: '体育' } })
    fireEvent.change(screen.getByLabelText('单双周'), { target: { value: 'even' } })
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    expect(saved[0].oddEven).toBe('even')
    cleanup()
  })

  it('起始周大于结束周时报错', () => {
    const { saved } = renderDialog()
    fireEvent.change(screen.getByLabelText('课名'), { target: { value: '体育' } })
    fireEvent.change(screen.getByLabelText('起始周'), { target: { value: '10' } })
    fireEvent.change(screen.getByLabelText('结束周'), { target: { value: '5' } })
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    expect(saved).toEqual([])
    expect(screen.getByRole('alert').textContent).toContain('请填写正确的周次范围')
    cleanup()
  })

  it('编辑态预填并可删除', () => {
    const { calls, saved } = renderDialog({ mode: 'edit', initial: makeCourse() })
    expect((screen.getByLabelText('课名') as HTMLInputElement).value).toBe('高等数学')
    expect((screen.getByLabelText('老师') as HTMLInputElement).value).toBe('王老师')
    fireEvent.click(screen.getByRole('button', { name: '删除' }))
    expect(calls).toEqual(['delete'])
    expect(saved).toEqual([])
    cleanup()
  })
})
