import { describe, expect, it } from '../helpers/expect'
import { cleanup, fireEvent, render, screen } from '../helpers/ui'
import { App } from '../../src/renderer/App'
import { CountdownStrip } from '../../src/renderer/components/CountdownStrip'
import { importantCountdowns } from '../../src/shared/countdown'
import { parseDate } from '../../src/shared/date'
import type { EventInput, EventItem } from '../../src/shared/entities'
import type { PreloadApi } from '../../src/shared/ipc'
import { EMPTY_COURSE_API } from '../helpers/apiExtras'

const TODAY = parseDate('2026-03-04')

function ev(partial: Partial<EventItem> & { id: string }): EventItem {
  return {
    id: partial.id,
    title: partial.title ?? '事项',
    category: partial.category ?? 'life',
    kind: partial.kind ?? 'timed',
    startAt: partial.startAt ?? null,
    endAt: partial.endAt ?? null,
    dueAt: partial.dueAt ?? null,
    location: null,
    people: null,
    note: null,
    done: partial.done ?? false,
    important: partial.important ?? false,
    recurrenceId: null,
    createdAt: '',
    updatedAt: '',
  }
}

function makeApi(events: EventItem[]) {
  const calls: string[] = []
  const list = [...events]
  const api: PreloadApi = {
    ...EMPTY_COURSE_API,
    getStatus: async () => ({
      dataFilePath: 'x',
      lastBackupAt: null,
      backupFailed: false,
      eventCount: list.length,
      dataDirMissing: false,
      dataDirMessage: null,
    }),
    rememberLocation: async () => undefined,
    openDataFolder: async () => undefined,
    getPlatform: async () => ({ electron: '', node: '' }),
    listAllEvents: async () => list.map((item) => ({ ...item })),
    listEvents: async () => list.map((item) => ({ ...item })),
    listEventExceptions: async () => [],
    createEvent: async (input: EventInput) => ev({ id: 'new', title: input.title }),
    updateEvent: async (id, patch) => {
      calls.push(`update:${id}:important=${String(patch.important)}`)
      const index = list.findIndex((item) => item.id === id)
      if (index >= 0) list[index] = { ...list[index], ...patch } as EventItem
      return list[index]
    },
    deleteEvent: async () => undefined,
    setEventDone: async () => undefined,
  }
  return { api, calls, list }
}

describe('倒计时组件', () => {
  it('没有重要事项时不渲染', () => {
    render(<CountdownStrip items={[]} onSelect={() => {}} />)
    expect(document.querySelector('[data-testid="countdown-strip"]')).toBeNull()
    cleanup()
  })

  it('渲染标题、剩余时间与日期', () => {
    const items = importantCountdowns(
      [ev({ id: 'a', title: '交论文', kind: 'todo', important: true, dueAt: '2026-03-05T23:59' })],
      new Date(2026, 2, 4, 10, 0),
    )
    render(<CountdownStrip items={items} onSelect={() => {}} />)
    const card = screen.getByTestId('countdown-a')
    expect(card.textContent).toContain('交论文')
    expect(card.textContent).toContain('还有 1 天')
    expect(card.textContent).toContain('3月5日 23:59')
    cleanup()
  })

  it('点击卡片会回调这条日程的 id', () => {
    const picked: string[] = []
    const items = importantCountdowns(
      [ev({ id: 'a', title: '交论文', important: true, startAt: '2026-03-06T09:00', endAt: '2026-03-06T10:00' })],
      new Date(2026, 2, 4, 10, 0),
    )
    render(<CountdownStrip items={items} onSelect={(id) => picked.push(id)} />)
    fireEvent.click(screen.getByTestId('countdown-a'))
    expect(picked).toEqual(['a'])
    cleanup()
  })

  it('过期的事项有单独样式', () => {
    const items = importantCountdowns(
      [ev({ id: 'a', title: '过期', important: true, startAt: '2026-03-01T09:00', endAt: '2026-03-01T10:00' })],
      new Date(2026, 2, 4, 10, 0),
    )
    render(<CountdownStrip items={items} onSelect={() => {}} />)
    expect(screen.getByTestId('countdown-a').className).toContain('is-expired')
    cleanup()
  })
})

describe('日历页上的倒计时', () => {
  it('重要事项出现在日历顶部，普通日程不出现', async () => {
    const { api } = makeApi([
      ev({ id: 'imp', title: '答辩', important: true, startAt: '2026-03-20T09:00', endAt: '2026-03-20T11:00' }),
      ev({ id: 'plain', title: '普通', startAt: '2026-03-06T09:00', endAt: '2026-03-06T10:00' }),
    ])
    render(<App today={TODAY} initialAnchor={TODAY} api={api} />)
    expect(await screen.findByTestId('countdown-imp')).toBeTruthy()
    expect(screen.queryByTestId('countdown-plain')).toBeNull()
    cleanup()
  })

  it('没有重要事项时不占位置', async () => {
    const { api } = makeApi([ev({ id: 'plain', title: '普通', startAt: '2026-03-06T09:00', endAt: '2026-03-06T10:00' })])
    render(<App today={TODAY} initialAnchor={TODAY} api={api} />)
    await screen.findByTestId('block-plain')
    expect(screen.queryByTestId('countdown-strip')).toBeNull()
    cleanup()
  })

  it('点倒计时卡片会打开详情', async () => {
    const { api } = makeApi([ev({ id: 'imp', title: '答辩', important: true, startAt: '2026-03-20T09:00', endAt: '2026-03-20T11:00' })])
    render(<App today={TODAY} initialAnchor={TODAY} api={api} />)
    fireEvent.click(await screen.findByTestId('countdown-imp'))
    expect(screen.getByTestId('detail-panel').textContent).toContain('答辩')
    cleanup()
  })

  it('详情面板可以把日程标为重要', async () => {
    const { api, calls } = makeApi([ev({ id: 'e1', title: '体检', startAt: '2026-03-04T09:00', endAt: '2026-03-04T10:00' })])
    render(<App today={TODAY} initialAnchor={TODAY} api={api} />)
    fireEvent.click(await screen.findByTestId('block-e1'))
    fireEvent.click(screen.getByTestId('toggle-important'))
    await new Promise((resolve) => setTimeout(resolve, 60))
    expect(calls).toContain('update:e1:important=true')
    cleanup()
  })
})
