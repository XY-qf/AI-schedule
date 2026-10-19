import { describe, expect, it } from '../helpers/expect'
import { cleanup, fireEvent, render, screen } from '../helpers/ui'
import { App } from '../../src/renderer/App'
import { parseDate } from '../../src/shared/date'
import type { Course, CourseInput, EventItem, Period, Semester } from '../../src/shared/entities'
import type { PreloadApi } from '../../src/shared/ipc'
import { EMPTY_COURSE_API } from '../helpers/apiExtras'

const TODAY = parseDate('2026-03-04')

const SEMESTER: Semester = {
  id: 'sem-1',
  name: '2026 春季',
  startDate: '2026-03-02',
  weeks: 18,
  isCurrent: true,
  createdAt: '',
  updatedAt: '',
}

const PERIODS: Period[] = [
  { id: 'p1', name: '第 1 节', startTime: '08:00', endTime: '08:45', orderIndex: 1 },
  { id: 'p2', name: '第 2 节', startTime: '08:55', endTime: '09:40', orderIndex: 2 },
  { id: 'p3', name: '第 3 节', startTime: '10:00', endTime: '10:45', orderIndex: 3 },
]

function makeApi(seedCourses: Course[] = []) {
  const courses = [...seedCourses]
  const calls: string[] = []
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
    listAllEvents: async (): Promise<EventItem[]> => [],
    listEvents: async (): Promise<EventItem[]> => [],
    listEventExceptions: async () => [],
    createEvent: async () => ({} as EventItem),
    updateEvent: async () => ({} as EventItem),
    deleteEvent: async () => undefined,
    setEventDone: async () => undefined,
    listSemesters: async () => [SEMESTER],
    listPeriods: async () => PERIODS,
    listCourses: async () => courses.map((item) => ({ ...item })),
    listCourseExceptions: async () => [],
    createCourse: async (input: CourseInput) => {
      calls.push(`create:${input.title}:weekday=${input.weekday}:period=${input.startPeriod}-${input.endPeriod}:mode=${input.timeMode}`)
      counter += 1
      const created: Course = {
        id: `c-${counter}`,
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
        color: input.color ?? null,
        createdAt: '',
        updatedAt: '',
      }
      courses.push(created)
      return created
    },
    updateCourse: async (id, patch) => {
      calls.push(`update:${id}`)
      const index = courses.findIndex((item) => item.id === id)
      courses[index] = { ...courses[index], ...patch } as Course
      return courses[index]
    },
    deleteCourse: async (id) => {
      const index = courses.findIndex((item) => item.id === id)
      if (index >= 0) courses.splice(index, 1)
    },
  }
  return { api, calls, courses }
}

describe('反馈 #1：课程表页新建的课程要立刻显示在课表格里', () => {
  it('在课表格里双击新建课程后，格子里出现这门课', async () => {
    const { api, calls } = makeApi()
    render(<App today={TODAY} initialAnchor={TODAY} api={api} />)
    fireEvent.click(screen.getByRole('button', { name: '课程表' }))
    await screen.findByTestId('course-table')

    fireEvent.doubleClick(screen.getByTestId('cell-3-2'))
    await screen.findByRole('dialog')
    fireEvent.change(screen.getByLabelText(/课程名称|课名|名称/), { target: { value: '线性代数' } })
    fireEvent.click(screen.getByRole('button', { name: '保存' }))

    await new Promise((resolve) => setTimeout(resolve, 80))
    expect(calls.length).toBeGreaterThan(0)
    const created = document.querySelector('[data-testid^="course-c-"]')
    expect(created).not.toBeNull()
    cleanup()
  })

  it('新建时不填节次也能落到双击的那一格', async () => {
    const { api, calls } = makeApi()
    render(<App today={TODAY} initialAnchor={TODAY} api={api} />)
    fireEvent.click(screen.getByRole('button', { name: '课程表' }))
    await screen.findByTestId('course-table')
    fireEvent.doubleClick(screen.getByTestId('cell-5-3'))
    await screen.findByRole('dialog')
    fireEvent.change(screen.getByLabelText(/课程名称|课名|名称/), { target: { value: '体育' } })
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    await new Promise((resolve) => setTimeout(resolve, 80))
    expect(calls.some((call) => call.includes('weekday=5'))).toBe(true)
    expect(calls.some((call) => call.includes('period=3-3'))).toBe(true)
    cleanup()
  })
})

describe('反馈 #1（补充）：按具体时间录入的课程也要出现在课表格里', () => {
  it('新建时选「按具体时间」，保存后课表格里能看到', async () => {
    const { api } = makeApi()
    render(<App today={TODAY} initialAnchor={TODAY} api={api} />)
    fireEvent.click(screen.getByRole('button', { name: '课程表' }))
    await screen.findByTestId('course-table')

    fireEvent.doubleClick(screen.getByTestId('cell-4-1'))
    await screen.findByRole('dialog')
    fireEvent.change(screen.getByLabelText(/课程名称|课名|名称/), { target: { value: '大学物理' } })
    fireEvent.change(screen.getByLabelText('时间方式'), { target: { value: 'clock' } })
    fireEvent.change(screen.getByLabelText('开始时间'), { target: { value: '08:00' } })
    fireEvent.change(screen.getByLabelText('结束时间'), { target: { value: '09:40' } })
    fireEvent.click(screen.getByRole('button', { name: '保存' }))

    await new Promise((resolve) => setTimeout(resolve, 80))
    const created = document.querySelector('[data-testid^="course-c-"]')
    expect(created).not.toBeNull()
    expect(created?.textContent).toContain('大学物理')
    cleanup()
  })
})
