import { describe, expect, it } from '../helpers/expect'
import { cleanup, fireEvent, render, screen } from '../helpers/ui'
import { App } from '../../src/renderer/App'
import { parseDate } from '../../src/shared/date'
import { validateEventInput } from '../../src/shared/entities'
import type { Course, EventInput, EventItem, Period, Semester } from '../../src/shared/entities'
import type { PreloadApi } from '../../src/shared/ipc'
import type { RecRule, SeriesException } from '../../src/shared/recurrence'
import { EMPTY_COURSE_API } from '../helpers/apiExtras'

const TODAY = parseDate('2026-03-04')

function ev(partial: Partial<EventItem> & { id: string }): EventItem {
  return {
    id: partial.id,
    title: partial.title ?? '事项',
    category: partial.category ?? 'activity',
    kind: partial.kind ?? 'timed',
    startAt: partial.startAt ?? null,
    endAt: partial.endAt ?? null,
    dueAt: partial.dueAt ?? null,
    location: partial.location ?? null,
    people: null,
    note: null,
    done: partial.done ?? false,
    recurrenceId: partial.recurrenceId ?? null,
    createdAt: '',
    updatedAt: '',
  }
}

const WEEKLY: RecRule = {
  id: 'r1',
  freq: 'weekly',
  intervalValue: null,
  intervalUnit: null,
  byWeekdays: null,
  untilDate: null,
  maxCount: null,
}

const BIWEEKLY: RecRule = { ...WEEKLY, id: 'r2', freq: 'biweekly', untilDate: '2026-06-30', maxCount: 8 }

interface Ctx {
  api: PreloadApi
  calls: string[]
  events: EventItem[]
  rules: RecRule[]
  exceptions: SeriesException[]
}

interface Options {
  events?: EventItem[]
  rules?: RecRule[]
  exceptions?: SeriesException[]
  semesters?: Semester[]
  periods?: Period[]
  courses?: Course[]
}

function makeApi(options: Options = {}): Ctx {
  const calls: string[] = []
  const events = [...(options.events ?? [])]
  const rules = [...(options.rules ?? [])]
  const exceptions = [...(options.exceptions ?? [])]
  let counter = 0

  const api: PreloadApi = {
    ...EMPTY_COURSE_API,
    getStatus: async () => ({
      dataFilePath: 'x',
      lastBackupAt: null,
      backupFailed: false,
      eventCount: events.length,
      dataDirMissing: false,
      dataDirMessage: null,
    }),
    rememberLocation: async () => undefined,
    openDataFolder: async () => undefined,
    getPlatform: async () => ({ electron: '', node: '' }),
    listAllEvents: async () => events.map((item) => ({ ...item })),
    listEvents: async () => events.map((item) => ({ ...item })),
    createEvent: async (input: EventInput) => {
      counter += 1
      calls.push(`create:${input.kind}:${input.startAt ?? 'null'}:${input.endAt ?? 'null'}:${input.recurrenceId ?? 'none'}`)
      const created = ev({
        id: `new-${counter}`,
        title: input.title,
        kind: input.kind,
        startAt: input.startAt ?? null,
        endAt: input.endAt ?? null,
        dueAt: input.dueAt ?? null,
        recurrenceId: input.recurrenceId ?? null,
      })
      events.push(created)
      return created
    },
    updateEvent: async (id, patch) => {
      calls.push(`update:${id}`)
      const index = events.findIndex((item) => item.id === id)
      if (index >= 0) events[index] = { ...events[index], ...patch } as EventItem
      return events[index]
    },
    deleteEvent: async (id) => {
      calls.push(`delete:${id}`)
    },
    setEventDone: async () => undefined,
    listRecurrences: async () => rules.map((rule) => ({ ...rule })),
    createRecurrence: async (input) => {
      counter += 1
      calls.push(`rule-create:${input.freq}:${input.untilDate ?? 'null'}`)
      const rule: RecRule = {
        id: `r-new-${counter}`,
        freq: input.freq,
        intervalValue: input.intervalValue ?? null,
        intervalUnit: input.intervalUnit ?? null,
        byWeekdays: input.byWeekdays ?? null,
        untilDate: input.untilDate ?? null,
        maxCount: input.maxCount ?? null,
      }
      rules.push(rule)
      return rule
    },
    updateRecurrence: async (id, patch) => {
      calls.push(`rule-update:${id}:${patch.untilDate ?? 'null'}`)
      const index = rules.findIndex((rule) => rule.id === id)
      rules[index] = { ...rules[index], ...patch } as RecRule
      return rules[index]
    },
    deleteRecurrence: async () => undefined,
    listEventExceptions: async () => exceptions.map((item) => ({ ...item })),
    upsertEventException: async (input) => {
      calls.push(`exception:${input.action}:${input.originalDate}`)
      const record: SeriesException = {
        id: `x-${exceptions.length + 1}`,
        seriesId: input.seriesId,
        originalDate: input.originalDate,
        action: input.action,
        startAt: input.startAt ?? null,
        endAt: input.endAt ?? null,
        title: input.title ?? null,
        location: input.location ?? null,
        people: input.people ?? null,
        note: input.note ?? null,
        done: input.done ?? null,
      }
      exceptions.push(record)
      return record
    },
    deleteEventException: async () => undefined,
    listSemesters: async () => options.semesters ?? [],
    listPeriods: async () => options.periods ?? [],
    listCourses: async () => options.courses ?? [],
    listCourseExceptions: async () => [],
  }
  return { api, calls, events, rules, exceptions }
}

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

function course(partial: Partial<Course> & { id: string }): Course {
  return {
    id: partial.id,
    semesterId: 'sem-1',
    title: partial.title ?? '线性代数',
    teacher: null,
    location: null,
    weekday: partial.weekday ?? 3,
    timeMode: partial.timeMode ?? 'clock',
    startPeriod: partial.startPeriod ?? null,
    endPeriod: partial.endPeriod ?? null,
    startTime: partial.startTime ?? null,
    endTime: partial.endTime ?? null,
    weekFrom: partial.weekFrom ?? 1,
    weekTo: partial.weekTo ?? 16,
    oddEven: partial.oddEven ?? 'all',
    color: null,
    createdAt: '',
    updatedAt: '',
  }
}

describe('反馈 #12：重复日程在母事件之后的周仍要显示', () => {
  it('翻到两周后仍能看到那一次的实例', async () => {
    const { api } = makeApi({
      events: [ev({ id: 'm1', title: '篮球', startAt: '2026-03-04T19:00', endAt: '2026-03-04T21:00', recurrenceId: 'r1' })],
      rules: [WEEKLY],
    })
    render(<App today={TODAY} initialAnchor={TODAY} api={api} />)
    await screen.findByTestId('block-m1#2026-03-04')

    fireEvent.click(screen.getByRole('button', { name: '下一页' }))
    fireEvent.click(screen.getByRole('button', { name: '下一页' }))
    expect(await screen.findByTestId('block-m1#2026-03-18')).toBeTruthy()
    cleanup()
  })
})

describe('反馈 #7：每两周重复不能只重复两次', () => {
  it('月视图里能看到隔周出现的多次', async () => {
    const { api } = makeApi({
      events: [ev({ id: 'm1', title: '例会', startAt: '2026-03-04T19:00', endAt: '2026-03-04T21:00', recurrenceId: 'r2' })],
      rules: [BIWEEKLY],
    })
    render(<App today={TODAY} initialAnchor={TODAY} api={api} />)
    await screen.findByTestId('block-m1#2026-03-04')
    fireEvent.click(screen.getByRole('tab', { name: '月' }))
    const ids = Array.from(document.querySelectorAll('[data-testid^="month-item-m1#"]')).map((node) =>
      node.getAttribute('data-testid'),
    )
    expect(ids).toContain('month-item-m1#2026-03-04-2026-03-04')
    expect(ids).toContain('month-item-m1#2026-03-18-2026-03-18')
    expect(ids).toContain('month-item-m1#2026-04-01-2026-04-01')
    cleanup()
  })
})

describe('反馈 #10：待办要能显示出来', () => {
  it('截止日期在很久以后的待办，在待办页能看到', async () => {
    const { api } = makeApi({
      events: [ev({ id: 't1', title: '交论文', kind: 'todo', dueAt: '2026-12-31T23:59' })],
    })
    render(<App today={TODAY} initialAnchor={TODAY} api={api} />)
    fireEvent.click(screen.getByRole('button', { name: '待办' }))
    expect(await screen.findByTestId('todo-row-t1')).toBeTruthy()
    expect(document.body.textContent).toContain('交论文')
    cleanup()
  })
})

describe('反馈 #11：选「这一次及以后」不能把日程弄没', () => {
  it('拆出新系列并继续存在', async () => {
    const { api, calls } = makeApi({
      events: [ev({ id: 'm1', title: '篮球', startAt: '2026-03-04T19:00', endAt: '2026-03-04T21:00', recurrenceId: 'r1' })],
      rules: [WEEKLY],
    })
    render(<App today={TODAY} initialAnchor={TODAY} api={api} />)
    await screen.findByTestId('block-m1#2026-03-04')
    fireEvent.click(screen.getByRole('button', { name: '下一页' }))
    fireEvent.click(screen.getByRole('button', { name: '编辑' }))
    fireEvent.doubleClick(await screen.findByTestId('block-m1#2026-03-11'))
    fireEvent.change(screen.getByLabelText(/标题/), { target: { value: '篮球（改）' } })
    fireEvent.click(screen.getByRole('button', { name: '保存' }))

    fireEvent.click(screen.getByTestId('scope-following').querySelector('input') as Element)
    fireEvent.click(screen.getByRole('button', { name: '确定' }))
    await new Promise((resolve) => setTimeout(resolve, 80))

    // 老系列截断到前一天
    expect(calls).toContain('rule-update:r1:2026-03-10')
    // 新系列单独建规则 + 建日程（不是复用老规则）
    expect(calls.some((call) => call.startsWith('rule-create:weekly'))).toBe(true)
    expect(calls.some((call) => call.includes('create:timed') && call.includes('r-new-'))).toBe(true)
    cleanup()
  })
})

describe('反馈 #8：按时间录入的课程要出现在课程表里', () => {
  it('节次为空的课程按时间换算后占格', async () => {
    const { api } = makeApi({
      semesters: [SEMESTER],
      periods: PERIODS,
      courses: [course({ id: 'c1', title: '线性代数', weekday: 3, timeMode: 'clock', startTime: '08:00', endTime: '09:40' })],
    })
    render(<App today={TODAY} initialAnchor={TODAY} api={api} />)
    fireEvent.click(screen.getByRole('button', { name: '课程表' }))
    expect(await screen.findByTestId('course-c1')).toBeTruthy()
    cleanup()
  })
})

describe('反馈 #4：只有开始时间的日程', () => {
  it('保存时只带开始时间，不带结束时间', async () => {
    const { api, calls } = makeApi()
    render(<App today={TODAY} initialAnchor={TODAY} api={api} />)
    fireEvent.click(screen.getByRole('button', { name: '＋ 新建' }))
    fireEvent.change(screen.getByLabelText(/标题/), { target: { value: '取快递' } })
    fireEvent.change(screen.getByLabelText('类型'), { target: { value: 'startOnly' } })
    fireEvent.change(screen.getByLabelText('日期'), { target: { value: '2026-03-05' } })
    fireEvent.change(screen.getByLabelText('开始时间'), { target: { value: '15:30' } })
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    await new Promise((resolve) => setTimeout(resolve, 60))
    expect(calls.some((call) => call.startsWith('create:startOnly:2026-03-05T15:30:null'))).toBe(true)
    cleanup()
  })
})

describe('反馈 #9：荒谬的年份要被拦下', () => {
  it('6666 年被拒绝', () => {
    const errors = validateEventInput({
      title: '穿越',
      category: 'life',
      kind: 'timed',
      startAt: '6666-01-01T10:00',
      endAt: '6666-01-01T11:00',
    })
    expect(errors.length).toBeGreaterThan(0)
  })

  it('正常年份通过', () => {
    const errors = validateEventInput({
      title: '正常',
      category: 'life',
      kind: 'timed',
      startAt: '2026-01-01T10:00',
      endAt: '2026-01-01T11:00',
    })
    expect(errors).toEqual([])
  })

  it('不存在的日期也要被拒绝', () => {
    const errors = validateEventInput({
      title: '错误日期',
      category: 'life',
      kind: 'timed',
      startAt: '2026-02-30T10:00',
      endAt: '2026-02-30T11:00',
    })
    expect(errors.length).toBeGreaterThan(0)
  })
})
