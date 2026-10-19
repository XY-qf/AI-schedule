import { describe, expect, it } from '../helpers/expect'
import { cleanup, fireEvent, render, screen } from '../helpers/ui'
import { App } from '../../src/renderer/App'
import { parseDate } from '../../src/shared/date'
import { expandOccurrences, type RecRule, type SeriesException } from '../../src/shared/recurrence'
import type { EventInput, EventItem } from '../../src/shared/entities'
import type { PreloadApi } from '../../src/shared/ipc'
import { EMPTY_COURSE_API } from '../helpers/apiExtras'

const TODAY = parseDate('2026-03-04')

function todo(partial: Partial<EventItem> = {}): EventItem {
  return {
    id: 't1',
    title: '交作业',
    category: 'course',
    kind: 'todo',
    startAt: null,
    endAt: null,
    dueAt: '2026-03-04T23:59',
    location: null,
    people: null,
    note: null,
    done: false,
    important: false,
    recurrenceId: 'r1',
    createdAt: '',
    updatedAt: '',
    ...partial,
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

describe('重复待办（只有截止时间）能不能展开', () => {
  it('每周重复的待办会展开成多次，而不是消失', () => {
    const list = expandOccurrences(todo(), WEEKLY, [], '2026-03-01', '2026-03-31')
    expect(list.length).toBe(4)
    expect(list.map((item) => item.originalDate)).toEqual([
      '2026-03-04',
      '2026-03-11',
      '2026-03-18',
      '2026-03-25',
    ])
  })

  it('每次的截止时刻落在当天，且没有开始与结束时间', () => {
    const list = expandOccurrences(todo(), WEEKLY, [], '2026-03-01', '2026-03-31')
    expect(list[0].startAt).toBeNull()
    expect(list[0].endAt).toBeNull()
    expect(list[0].dueAt).toBe('2026-03-04T23:59')
    expect(list[1].dueAt).toBe('2026-03-11T23:59')
  })

  it('只有日期没有时刻的待办也能展开', () => {
    const list = expandOccurrences(todo({ dueAt: '2026-03-04' }), WEEKLY, [], '2026-03-01', '2026-03-31')
    expect(list.length).toBe(4)
    expect(list[0].dueAt).toBe('2026-03-04')
  })

  it('按次数限制', () => {
    const list = expandOccurrences(todo(), { ...WEEKLY, maxCount: 2 }, [], '2026-03-01', '2026-04-30')
    expect(list.length).toBe(2)
  })

  it('按截止日期限制', () => {
    const list = expandOccurrences(todo(), { ...WEEKLY, untilDate: '2026-03-18' }, [], '2026-03-01', '2026-04-30')
    expect(list.map((item) => item.originalDate)).toEqual(['2026-03-04', '2026-03-11', '2026-03-18'])
  })

  it('跳过某一次后那一次不出现', () => {
    const exceptions: SeriesException[] = [
      {
        id: 'x1',
        seriesId: 't1',
        originalDate: '2026-03-11',
        action: 'skipped',
        startAt: null,
        endAt: null,
        title: null,
        location: null,
        people: null,
        note: null,
        done: null,
      },
    ]
    const list = expandOccurrences(todo(), WEEKLY, exceptions, '2026-03-01', '2026-03-31')
    expect(list.map((item) => item.originalDate)).toEqual(['2026-03-04', '2026-03-18', '2026-03-25'])
  })

  it('改了标题的例外会生效', () => {
    const exceptions: SeriesException[] = [
      {
        id: 'x2',
        seriesId: 't1',
        originalDate: '2026-03-11',
        action: 'modified',
        startAt: null,
        endAt: null,
        title: '交作业（延期）',
        location: null,
        people: null,
        note: null,
        done: null,
      },
    ]
    const list = expandOccurrences(todo(), WEEKLY, exceptions, '2026-03-01', '2026-03-31')
    expect(list[1].title).toBe('交作业（延期）')
    expect(list[1].dueAt).toBe('2026-03-11T23:59')
  })

  it('没有截止时间的待办不会炸，也不会乱展开', () => {
    const list = expandOccurrences(todo({ dueAt: null }), WEEKLY, [], '2026-03-01', '2026-03-31')
    expect(list.length).toBe(0)
  })
})

describe('界面上的重复待办', () => {
  function makeApi(events: EventItem[], rules: RecRule[]) {
    const calls: string[] = []
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
      listRecurrences: async () => rules.map((rule) => ({ ...rule })),
      listEventExceptions: async () => [],
      createEvent: async (input: EventInput) => todo({ id: 'new', title: input.title }),
      updateEvent: async () => todo(),
      deleteEvent: async () => undefined,
      setEventDone: async () => undefined,
    }
    return { api, calls }
  }

  it('勾了重复的待办会在日历上出现（以线的形式）', async () => {
    const { api } = makeApi([todo()], [WEEKLY])
    render(<App today={TODAY} initialAnchor={TODAY} api={api} />)
    expect(await screen.findByTestId('marker-t1#2026-03-04')).toBeTruthy()
    cleanup()
  })

  it('翻到下一周也能看到下一次', async () => {
    const { api } = makeApi([todo()], [WEEKLY])
    render(<App today={TODAY} initialAnchor={TODAY} api={api} />)
    await screen.findByTestId('marker-t1#2026-03-04')
    fireEvent.click(screen.getByRole('button', { name: '下一页' }))
    expect(await screen.findByTestId('marker-t1#2026-03-11')).toBeTruthy()
    cleanup()
  })

  it('待办页里也能看到重复产生的各次', async () => {
    const { api } = makeApi([todo()], [WEEKLY])
    render(<App today={TODAY} initialAnchor={TODAY} api={api} initialPage="todo" />)
    expect(await screen.findByTestId('todo-row-t1#2026-03-04')).toBeTruthy()
    cleanup()
  })
})
