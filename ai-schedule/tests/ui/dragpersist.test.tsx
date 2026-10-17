import { describe, expect, it } from '../helpers/expect'
import { cleanup, fireEvent, render, screen } from '../helpers/ui'
import { App } from '../../src/renderer/App'
import { parseDate } from '../../src/shared/date'
import type { EventInput, EventItem } from '../../src/shared/entities'
import type { PreloadApi } from '../../src/shared/ipc'
import { EMPTY_COURSE_API } from '../helpers/apiExtras'

const TODAY = parseDate('2026-03-04')

function ev(partial: Partial<EventItem> & { id: string }): EventItem {
  return {
    id: partial.id,
    title: partial.title ?? '健身',
    category: partial.category ?? 'activity',
    kind: partial.kind ?? 'timed',
    startAt: partial.startAt ?? '2026-03-04T19:00',
    endAt: partial.endAt ?? '2026-03-04T20:00',
    dueAt: null,
    location: null,
    people: null,
    note: null,
    done: false,
    recurrenceId: partial.recurrenceId ?? null,
    createdAt: '',
    updatedAt: '',
  }
}

interface Ctx {
  api: PreloadApi
  calls: string[]
  events: EventItem[]
}

function makeApi(seed: EventItem[]): Ctx {
  const calls: string[] = []
  const events = [...seed]
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
      calls.push(`create:${input.title}`)
      return ev({ id: 'new' })
    },
    updateEvent: async (id, patch) => {
      calls.push(`update:${id}:${patch.startAt}~${patch.endAt}`)
      const index = events.findIndex((item) => item.id === id)
      if (index >= 0) events[index] = { ...events[index], ...patch } as EventItem
      return events[index]
    },
    deleteEvent: async (id) => {
      calls.push(`delete:${id}`)
    },
    setEventDone: async () => undefined,
  }
  return { api, calls, events }
}

/** 在元素上模拟一次真实的拖拽（按下 → 移动 → 松开）。 */
function drag(element: Element, deltaY: number): void {
  fireEvent.mouseDown(element, { clientY: 200 })
  fireEvent.mouseMove(window, { clientY: 200 + deltaY })
  fireEvent.mouseUp(window, { clientY: 200 + deltaY })
}

describe('编辑态拖拽必须真正落库', () => {
  it('拖动块会修改开始与结束时间', async () => {
    const { api, calls } = makeApi([ev({ id: 'e1' })])
    render(<App today={TODAY} initialAnchor={TODAY} api={api} />)
    await screen.findByTestId('block-e1')
    fireEvent.click(screen.getByRole('button', { name: '编辑' }))
    drag(screen.getByTestId('block-e1'), 48)
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(calls.some((call) => call.startsWith('update:e1:2026-03-04T20:00'))).toBe(true)
    cleanup()
  })

  it('拉下边缘会修改结束时间、开始时间不变', async () => {
    const { api, calls } = makeApi([ev({ id: 'e1' })])
    render(<App today={TODAY} initialAnchor={TODAY} api={api} />)
    await screen.findByTestId('block-e1')
    fireEvent.click(screen.getByRole('button', { name: '编辑' }))
    drag(screen.getByTestId('resize-e1'), 48)
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(calls.some((call) => call.startsWith('update:e1:2026-03-04T19:00'))).toBe(true)
    expect(calls.some((call) => call.includes('2026-03-04T21:00'))).toBe(true)
    cleanup()
  })

  it('浏览态拖不动（不调用更新）', async () => {
    const { api, calls } = makeApi([ev({ id: 'e1' })])
    render(<App today={TODAY} initialAnchor={TODAY} api={api} />)
    await screen.findByTestId('block-e1')
    drag(screen.getByTestId('block-e1'), 48)
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(calls.filter((call) => call.startsWith('update:')).length).toBe(0)
    cleanup()
  })

  it('重复日程的某一次拖动，写入「仅这一次」的改期例外', async () => {
    const { api, calls } = makeApi([])
    const withRule: PreloadApi = {
      ...api,
      listAllEvents: async () => [ev({ id: 'm1', recurrenceId: 'r1' })],
      listEvents: async () => [ev({ id: 'm1', recurrenceId: 'r1' })],
      listRecurrences: async () => {
        calls.push('rules')
        return [
          {
            id: 'r1',
            freq: 'weekly',
            intervalValue: null,
            intervalUnit: null,
            byWeekdays: null,
            untilDate: null,
            maxCount: null,
          },
        ]
      },
      listEventExceptions: async () => {
        calls.push('exceptions')
        return []
      },
      upsertEventException: async (input) => {
        calls.push(`exception:${input.action}:${input.originalDate}:${input.startAt}`)
        return {
          id: 'x1',
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
      },
    }
    render(<App today={TODAY} initialAnchor={TODAY} api={withRule} />)
    await screen.findByTestId('block-m1#2026-03-04')
    fireEvent.click(screen.getByRole('button', { name: '编辑' }))
    drag(screen.getByTestId('block-m1#2026-03-04'), 48)
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(calls.some((call) => call.startsWith('update:m1#'))).toBe(false)
    expect(calls.some((call) => call.startsWith('exception:modified:2026-03-04:'))).toBe(true)
    cleanup()
  })
})
