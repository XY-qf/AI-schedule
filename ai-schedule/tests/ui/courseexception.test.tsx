import { describe, expect, it } from '../helpers/expect'
import { cleanup, fireEvent, render, screen } from '../helpers/ui'

async function flush(ms = 40): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms))
}
import { App } from '../../src/renderer/App'
import { DetailPanel } from '../../src/renderer/components/DetailPanel'
import { CourseMoveDialog } from '../../src/renderer/components/CourseMoveDialog'
import { parseDate } from '../../src/shared/date'
import type { Course, EventItem, Period, Semester } from '../../src/shared/entities'
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

const COURSE: Course = {
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
}

type Exc = {
  id: string
  courseId: string
  originalDate: string
  action: 'moved' | 'cancelled'
  startAt: string | null
  endAt: string | null
  note: string | null
}

function makeCourseExceptionApi(initial: Exc[] = []): { api: PreloadApi; calls: string[]; exceptions: Exc[] } {
  const calls: string[] = []
  const exceptions: Exc[] = [...initial]
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
    createEvent: async () => {
      throw new Error('未实现')
    },
    updateEvent: async () => {
      throw new Error('未实现')
    },
    deleteEvent: async () => undefined,
    setEventDone: async () => undefined,
    listSemesters: async () => [{ ...SEMESTER }],
    listPeriods: async () => PERIODS.map((item) => ({ ...item })),
    listCourses: async () => [{ ...COURSE }],
    listCourseExceptions: async () => exceptions.map((item) => ({ ...item })),
    setCourseException: async (input) => {
      calls.push(`exception:${input.action}:${input.originalDate}`)
      const index = exceptions.findIndex(
        (item) => item.courseId === input.courseId && item.originalDate === input.originalDate,
      )
      const record: Exc = {
        id: `x-${exceptions.length + 1}`,
        courseId: input.courseId,
        originalDate: input.originalDate,
        action: input.action,
        startAt: input.startAt ?? null,
        endAt: input.endAt ?? null,
        note: input.note ?? null,
      }
      if (index >= 0) exceptions[index] = record
      else exceptions.push(record)
    },
    clearCourseException: async (courseId, originalDate) => {
      calls.push(`clear:${originalDate}`)
      const index = exceptions.findIndex(
        (item) => item.courseId === courseId && item.originalDate === originalDate,
      )
      if (index >= 0) exceptions.splice(index, 1)
    },
  }
  return { api, calls, exceptions }
}

const MONDAY = parseDate('2026-03-02')
const TODAY = parseDate('2026-03-02')
const COURSE_EVENT_ID = 'course:c1:2026-03-02'

async function openCalendar(initial: Exc[] = []) {
  const ctx = makeCourseExceptionApi(initial)
  render(<App today={TODAY} initialAnchor={TODAY} api={ctx.api} />)
  await screen.findByTestId(`block-${COURSE_EVENT_ID}`)
  return ctx
}

describe('课程例外 · 详情面板', () => {
  it('浏览态只给提示，不给改期停课按钮', () => {
    render(
      <DetailPanel
        event={{
          id: COURSE_EVENT_ID,
          title: '高等数学',
          category: 'course',
          kind: 'timed',
          startAt: '2026-03-02T08:00',
          endAt: '2026-03-02T09:40',
          dueAt: null,
          location: 'A101',
          people: '王老师',
          note: null,
          done: false,
          recurrenceId: null,
          createdAt: '',
          updatedAt: '',
        }}
        editing={false}
        courseOccurrence={{ courseId: 'c1', date: '2026-03-02' }}
        onClose={() => {}}
        onEdit={() => {}}
        onToggleDone={() => {}}
        onDelete={() => {}}
        onMoveCourseOnce={() => {}}
        onCancelCourseOnce={() => {}}
      />,
    )
    expect(screen.queryByRole('button', { name: '仅这一次改期' })).toBeNull()
    expect(document.body.textContent).toContain('这是课程表里的课')
    cleanup()
  })

  it('编辑态给出改期与停课，并说明只影响这一次', () => {
    render(
      <DetailPanel
        event={{
          id: COURSE_EVENT_ID,
          title: '高等数学',
          category: 'course',
          kind: 'timed',
          startAt: '2026-03-02T08:00',
          endAt: '2026-03-02T09:40',
          dueAt: null,
          location: null,
          people: null,
          note: null,
          done: false,
          recurrenceId: null,
          createdAt: '',
          updatedAt: '',
        }}
        editing
        courseOccurrence={{ courseId: 'c1', date: '2026-03-02' }}
        onClose={() => {}}
        onEdit={() => {}}
        onToggleDone={() => {}}
        onDelete={() => {}}
        onMoveCourseOnce={() => {}}
        onCancelCourseOnce={() => {}}
      />,
    )
    expect(screen.getByRole('button', { name: '仅这一次改期' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '本次停课' })).toBeTruthy()
    expect(document.body.textContent).toContain('只影响这一次课')
    cleanup()
  })

  it('已有例外时显示撤销按钮', () => {
    render(
      <DetailPanel
        event={{
          id: COURSE_EVENT_ID,
          title: '高等数学',
          category: 'course',
          kind: 'timed',
          startAt: '2026-03-02T08:00',
          endAt: '2026-03-02T09:40',
          dueAt: null,
          location: null,
          people: null,
          note: null,
          done: false,
          recurrenceId: null,
          createdAt: '',
          updatedAt: '',
        }}
        editing
        courseOccurrence={{ courseId: 'c1', date: '2026-03-02' }}
        isCourseException
        onClose={() => {}}
        onEdit={() => {}}
        onToggleDone={() => {}}
        onDelete={() => {}}
        onMoveCourseOnce={() => {}}
        onCancelCourseOnce={() => {}}
        onClearCourseException={() => {}}
      />,
    )
    expect(screen.getByRole('button', { name: '撤销例外' })).toBeTruthy()
    expect(document.body.textContent).toContain('已单独调整过')
    cleanup()
  })
})

describe('课程例外 · 端到端', () => {
  it('停课后这一次课从日历上消失', async () => {
    const { calls } = await openCalendar()
    fireEvent.click(screen.getByRole('button', { name: '编辑' }))
    fireEvent.click(await screen.findByTestId(`block-${COURSE_EVENT_ID}`))
    fireEvent.click(screen.getByRole('button', { name: '本次停课' }))

    await flush()
    expect(calls).toContain('exception:cancelled:2026-03-02')
    expect(screen.queryByTestId(`block-${COURSE_EVENT_ID}`)).toBeNull()
    cleanup()
  })

  it('改期后原位置消失、新时间出现', async () => {
    const { calls } = await openCalendar()
    fireEvent.click(screen.getByRole('button', { name: '编辑' }))
    fireEvent.click(await screen.findByTestId(`block-${COURSE_EVENT_ID}`))
    fireEvent.click(screen.getByRole('button', { name: '仅这一次改期' }))

    fireEvent.change(screen.getByLabelText('调到哪天'), { target: { value: '2026-03-04' } })
    fireEvent.change(screen.getByLabelText('开始时间'), { target: { value: '10:00' } })
    fireEvent.change(screen.getByLabelText('结束时间'), { target: { value: '11:40' } })
    fireEvent.click(screen.getByRole('button', { name: '保存' }))

    await flush()
    expect(calls).toContain('exception:moved:2026-03-02')
    // 改到 3 月 4 日 10:00：块出现在那一天，位置 480px，原周一格子不再有它
    const moved = screen.getByTestId(`block-${COURSE_EVENT_ID}`)
    expect(moved.style.top).toBe('480px')
    expect(screen.getByTestId('col-2026-03-04').contains(moved)).toBe(true)
    expect(screen.getByTestId('col-2026-03-02').contains(moved)).toBe(false)
    cleanup()
  })

  it('改了期的课可以撤销，回到原位置', async () => {
    const { calls } = await openCalendar([
      {
        id: 'x1',
        courseId: 'c1',
        originalDate: '2026-03-02',
        action: 'moved',
        startAt: '2026-03-04T10:00',
        endAt: '2026-03-04T11:40',
        note: null,
      },
    ])
    // 先确认这条课现在在周三 10:00
    const before = screen.getByTestId(`block-${COURSE_EVENT_ID}`)
    expect(before.style.top).toBe('480px')

    fireEvent.click(screen.getByRole('button', { name: '编辑' }))
    fireEvent.click(before)
    fireEvent.click(screen.getByRole('button', { name: '撤销例外' }))

    await flush()
    expect(calls).toContain('clear:2026-03-02')
    const after = screen.getByTestId(`block-${COURSE_EVENT_ID}`)
    expect(after.style.top).toBe('384px') // 回到周一 08:00
    expect(screen.getByTestId('col-2026-03-02').contains(after)).toBe(true)
    cleanup()
  })
})

describe('改期弹窗', () => {
  function renderMoveDialog() {
    const saved: Array<{ date: string; startTime: string; endTime: string }> = []
    render(
      <CourseMoveDialog
        open
        courseTitle="高等数学"
        originalDate="2026-03-02"
        defaultStartTime="08:00"
        defaultEndTime="09:40"
        onSave={(payload) => saved.push(payload)}
        onClose={() => {}}
      />,
    )
    return saved
  }

  it('默认带出原来的日期与时间', () => {
    renderMoveDialog()
    expect((screen.getByLabelText('调到哪天') as HTMLInputElement).value).toBe('2026-03-02')
    expect((screen.getByLabelText('开始时间') as HTMLInputElement).value).toBe('08:00')
    expect((screen.getByLabelText('结束时间') as HTMLInputElement).value).toBe('09:40')
    cleanup()
  })

  it('结束早于开始时拦住并提示', () => {
    const saved = renderMoveDialog()
    fireEvent.change(screen.getByLabelText('开始时间'), { target: { value: '10:00' } })
    fireEvent.change(screen.getByLabelText('结束时间'), { target: { value: '09:00' } })
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    expect(saved).toEqual([])
    expect(screen.getByRole('alert').textContent).toContain('结束时间要晚于开始时间')
    cleanup()
  })

  it('填好后回传新日期与时间', () => {
    const saved = renderMoveDialog()
    fireEvent.change(screen.getByLabelText('调到哪天'), { target: { value: '2026-03-04' } })
    fireEvent.change(screen.getByLabelText('开始时间'), { target: { value: '10:00' } })
    fireEvent.change(screen.getByLabelText('结束时间'), { target: { value: '11:40' } })
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    expect(saved).toEqual([{ date: '2026-03-04', startTime: '10:00', endTime: '11:40' }])
    cleanup()
  })
})

export { MONDAY }
