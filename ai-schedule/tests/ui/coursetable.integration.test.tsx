import { describe, expect, it } from '../helpers/expect'
import { cleanup, fireEvent, render, screen, waitFor } from '../helpers/ui'
import { App } from '../../src/renderer/App'
import { SemesterDialog } from '../../src/renderer/components/SemesterDialog'
import { PeriodsDialog } from '../../src/renderer/components/PeriodsDialog'
import { parseDate } from '../../src/shared/date'
import type { Course, CourseInput, EventItem, Period, Semester, SemesterInput } from '../../src/shared/entities'
import type { PreloadApi } from '../../src/shared/ipc'
import { EMPTY_COURSE_API } from '../helpers/apiExtras'

const PERIODS: Period[] = [
  { id: 'p1', name: '第 1 节', startTime: '08:00', endTime: '08:45', orderIndex: 1 },
  { id: 'p2', name: '第 2 节', startTime: '08:55', endTime: '09:40', orderIndex: 2 },
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

interface State {
  semesters: Semester[]
  courses: Course[]
  periods: Period[]
  calls: string[]
}

function makeCourseApi(initialCourses: Course[] = []): { api: PreloadApi; state: State } {
  const state: State = {
    semesters: [{ ...SEMESTER }],
    courses: [...initialCourses],
    periods: [...PERIODS],
    calls: [],
  }
  let counter = 0

  const api: PreloadApi = {
    ...EMPTY_COURSE_API,
    getStatus: async () => ({
      dataFilePath: 'x',
      lastBackupAt: null,
      backupFailed: false,
      eventCount: 0,
      dataDirMissing: false,
      dataDirMessage: null,
    }),
    rememberLocation: async () => undefined,
    openDataFolder: async () => undefined,
    getPlatform: async () => ({ electron: '', node: '' }),
    listEvents: async (): Promise<EventItem[]> => [],
    createEvent: async () => {
      throw new Error('未实现')
    },
    updateEvent: async () => {
      throw new Error('未实现')
    },
    deleteEvent: async () => undefined,
    setEventDone: async () => undefined,
    listSemesters: async () => state.semesters.map((item) => ({ ...item })),
    createSemester: async (input: SemesterInput) => {
      counter += 1
      const created: Semester = {
        id: `sem-new-${counter}`,
        name: input.name,
        startDate: input.startDate,
        weeks: input.weeks,
        isCurrent: state.semesters.length === 0,
        createdAt: '',
        updatedAt: '',
      }
      state.semesters.push(created)
      state.calls.push(`createSemester:${input.name}`)
      return created
    },
    updateSemester: async (id, patch) => {
      const index = state.semesters.findIndex((item) => item.id === id)
      state.semesters[index] = { ...state.semesters[index], ...patch }
      return state.semesters[index]
    },
    deleteSemester: async (id) => {
      state.semesters = state.semesters.filter((item) => item.id !== id)
      state.calls.push(`deleteSemester:${id}`)
    },
    setCurrentSemester: async (id) => {
      state.calls.push(`setCurrent:${id}`)
      state.semesters = state.semesters.map((item) => ({ ...item, isCurrent: item.id === id }))
    },
    listPeriods: async () => state.periods.map((item) => ({ ...item })),
    savePeriods: async (items) => {
      state.periods = items.map((item, index) => ({ id: `p${index + 1}`, orderIndex: index + 1, ...item }))
      state.calls.push('savePeriods')
      return state.periods
    },
    resetPeriods: async () => {
      state.periods = [...PERIODS]
      state.calls.push('resetPeriods')
      return state.periods
    },
    listCourses: async (semesterId) => state.courses.filter((course) => course.semesterId === semesterId),
    createCourse: async (input: CourseInput) => {
      counter += 1
      const created: Course = {
        id: `c-new-${counter}`,
        semesterId: input.semesterId,
        title: input.title,
        teacher: input.teacher ?? null,
        location: input.location ?? null,
        weekday: input.weekday,
        timeMode: input.timeMode,
        startPeriod: input.startPeriod ?? null,
        endPeriod: input.endPeriod ?? null,
        startTime: input.startTime ?? null,
        endTime: input.endTime ?? null,
        weekFrom: input.weekFrom,
        weekTo: input.weekTo,
        oddEven: input.oddEven,
        color: null,
        createdAt: '',
        updatedAt: '',
      }
      state.courses.push(created)
      state.calls.push(`createCourse:${input.title}`)
      return created
    },
    updateCourse: async (id, patch) => {
      const index = state.courses.findIndex((course) => course.id === id)
      state.courses[index] = { ...state.courses[index], ...patch } as Course
      state.calls.push(`updateCourse:${id}`)
      return state.courses[index]
    },
    deleteCourse: async (id) => {
      state.courses = state.courses.filter((course) => course.id !== id)
      state.calls.push(`deleteCourse:${id}`)
    },
  }
  return { api, state }
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

const TODAY = parseDate('2026-03-04')

async function openCoursePage(courses: Course[] = []) {
  const { api, state } = makeCourseApi(courses)
  render(<App today={TODAY} initialAnchor={TODAY} api={api} />)
  fireEvent.click(screen.getByRole('button', { name: '课程表' }))
  await screen.findByTestId('course-table')
  return state
}

describe('课程表页接入数据', () => {
  it('切到课程表页能读出学期、作息表与课程', async () => {
    await openCoursePage([makeCourse()])
    expect(screen.getByTestId('semester-select')).toBeTruthy()
    expect(await screen.findByTestId('course-c1')).toBeTruthy()
    expect(screen.getByTestId('period-1').textContent).toContain('08:00')
    cleanup()
  })

  it('双击空格子打开新建课程弹窗，保存后出现在网格里', async () => {
    const state = await openCoursePage()
    fireEvent.doubleClick(screen.getByTestId('cell-3-2'))
    fireEvent.change(screen.getByLabelText('课名'), { target: { value: '大学物理' } })
    fireEvent.click(screen.getByRole('button', { name: '保存' }))

    expect(await screen.findByText('已保存课程')).toBeTruthy()
    expect(state.calls).toContain('createCourse:大学物理')
    const created = await screen.findByTestId('course-c-new-1')
    expect(created.textContent).toContain('大学物理')
    expect(screen.getByTestId('cell-3-2').contains(created)).toBe(true)
    cleanup()
  })

  it('点已有课程打开编辑弹窗，改名后网格更新', async () => {
    const state = await openCoursePage([makeCourse()])
    fireEvent.click(await screen.findByTestId('course-c1'))
    expect((screen.getByLabelText('课名') as HTMLInputElement).value).toBe('高等数学')
    fireEvent.change(screen.getByLabelText('课名'), { target: { value: '高等数学（A班）' } })
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    await waitFor(() => {
      expect(state.calls).toContain('updateCourse:c1')
    })
    expect((await screen.findByTestId('course-c1')).textContent).toContain('高等数学（A班）')
    cleanup()
  })

  it('删除课程后网格里消失', async () => {
    const state = await openCoursePage([makeCourse()])
    fireEvent.click(await screen.findByTestId('course-c1'))
    fireEvent.click(screen.getByRole('button', { name: '删除' }))
    await waitFor(() => {
      expect(state.calls).toContain('deleteCourse:c1')
    })
    await waitFor(() => {
      expect(screen.queryByTestId('course-c1')).toBeNull()
    })
    cleanup()
  })

  it('新建学期后学期下拉出现新项', async () => {
    const state = await openCoursePage()
    fireEvent.click(screen.getByRole('button', { name: '新建学期' }))
    fireEvent.change(screen.getByLabelText(/学期名称/), { target: { value: '2026 秋季' } })
    fireEvent.change(screen.getByLabelText(/开学日期/), { target: { value: '2026-09-07' } })
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    await waitFor(() => {
      expect(state.calls).toContain('createSemester:2026 秋季')
    })
    expect((await screen.findByTestId('semester-select')).textContent).toContain('2026 秋季')
    cleanup()
  })

  it('作息时间表弹窗保存后调用接口', async () => {
    const state = await openCoursePage()
    fireEvent.click(screen.getByRole('button', { name: '作息时间表' }))
    fireEvent.change(screen.getByLabelText('第 1 行开始时间'), { target: { value: '08:10' } })
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    await waitFor(() => {
      expect(state.calls).toContain('savePeriods')
    })
    expect(state.periods[0].startTime).toBe('08:10')
    cleanup()
  })
})

describe('学期弹窗', () => {
  function renderSemesterDialog(props: Partial<Parameters<typeof SemesterDialog>[0]> = {}) {
    const saved: SemesterInput[] = []
    const calls: string[] = []
    render(
      <SemesterDialog
        open
        mode="create"
        onSave={(input) => saved.push(input)}
        onDelete={() => calls.push('delete')}
        canDelete
        onClose={() => calls.push('close')}
        {...props}
      />,
    )
    return { saved, calls }
  }

  it('信息不全时给出中文提示且不保存', () => {
    const { saved } = renderSemesterDialog()
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    expect(saved).toEqual([])
    expect(screen.getByRole('alert').textContent).toContain('请填写学期名称')
    cleanup()
  })

  it('填写完整后保存', () => {
    const { saved } = renderSemesterDialog()
    fireEvent.change(screen.getByLabelText(/学期名称/), { target: { value: '2026 春季' } })
    fireEvent.change(screen.getByLabelText(/开学日期/), { target: { value: '2026-03-02' } })
    fireEvent.change(screen.getByLabelText('总周数'), { target: { value: '18' } })
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    expect(saved).toEqual([{ name: '2026 春季', startDate: '2026-03-02', weeks: 18 }])
    cleanup()
  })

  it('编辑态预填并可删除', () => {
    const { calls } = renderSemesterDialog({ mode: 'edit', initial: SEMESTER })
    expect((screen.getByLabelText(/学期名称/) as HTMLInputElement).value).toBe('2026 春季')
    fireEvent.click(screen.getByRole('button', { name: '删除学期' }))
    expect(calls).toEqual(['delete'])
    cleanup()
  })
})

describe('作息时间表弹窗', () => {
  function renderPeriodsDialog() {
    const saved: Array<Array<{ name: string; startTime: string; endTime: string }>> = []
    const calls: string[] = []
    render(
      <PeriodsDialog
        open
        periods={PERIODS}
        onSave={(items) => saved.push(items)}
        onReset={() => calls.push('reset')}
        onClose={() => calls.push('close')}
      />,
    )
    return { saved, calls }
  }

  it('按现有作息铺出编辑行', () => {
    renderPeriodsDialog()
    expect(screen.getByTestId('period-row-0')).toBeTruthy()
    expect(screen.getByTestId('period-row-1')).toBeTruthy()
    expect((screen.getByLabelText('第 1 行节次名称') as HTMLInputElement).value).toBe('第 1 节')
    cleanup()
  })

  it('可以增加与删除节次', () => {
    renderPeriodsDialog()
    fireEvent.click(screen.getByRole('button', { name: '＋ 添加一节' }))
    expect(screen.getByTestId('period-row-2')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '删除第 3 行' }))
    expect(screen.queryByTestId('period-row-2')).toBeNull()
    cleanup()
  })

  it('开始时间晚于结束时间时报错', () => {
    const { saved } = renderPeriodsDialog()
    fireEvent.change(screen.getByLabelText('第 1 行开始时间'), { target: { value: '10:00' } })
    fireEvent.change(screen.getByLabelText('第 1 行结束时间'), { target: { value: '09:00' } })
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    expect(saved).toEqual([])
    expect(screen.getByRole('alert').textContent).toContain('请检查作息时间')
    cleanup()
  })

  it('保存与恢复默认都回传', () => {
    const { saved, calls } = renderPeriodsDialog()
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    expect(saved.length).toBe(1)
    expect(saved[0].length).toBe(2)
    fireEvent.click(screen.getByRole('button', { name: '恢复默认' }))
    expect(calls).toContain('reset')
    cleanup()
  })
})
