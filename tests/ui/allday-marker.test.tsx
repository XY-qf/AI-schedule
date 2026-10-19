import { describe, expect, it } from '../helpers/expect'
import { cleanup, fireEvent, render, screen } from '../helpers/ui'
import { App } from '../../src/renderer/App'
import { DayView } from '../../src/renderer/components/DayView'
import { WeekView } from '../../src/renderer/components/WeekView'
import { layoutAllDay, pointMarkers, weekDates } from '../../src/shared/layout'
import { parseDate, startOfWeekMonday } from '../../src/shared/date'
import type { EventItem } from '../../src/shared/entities'
import type { PreloadApi } from '../../src/shared/ipc'
import { EMPTY_COURSE_API } from '../helpers/apiExtras'

const TODAY = parseDate('2026-03-04')
const WEEK_START = startOfWeekMonday(TODAY)

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
    recurrenceId: null,
    createdAt: '',
    updatedAt: '',
  }
}

const START_ONLY = ev({ id: 's1', title: '取快递', kind: 'startOnly', startAt: '2026-03-04T15:30' })
const DUE_ONLY = ev({ id: 'd1', title: '交论文', kind: 'todo', dueAt: '2026-03-04T23:00' })
const DUE_DATE_ONLY = ev({ id: 'd2', title: '体检', kind: 'todo', dueAt: '2026-03-05' })
const ALL_DAY = ev({ id: 'a1', title: '运动会', kind: 'allDay', startAt: '2026-03-04', endAt: '2026-03-04' })

describe('反馈 #2：只有开始 / 只有截止的日程要在日历上画一道线', () => {
  it('pointMarkers 只挑出这两类，并给出当天第几分钟', () => {
    const markers = pointMarkers([START_ONLY, DUE_ONLY, DUE_DATE_ONLY, ALL_DAY], '2026-03-04')
    expect(markers.length).toBe(2)
    expect(markers[0].event.id).toBe('s1')
    expect(markers[0].minute).toBe(15 * 60 + 30)
    expect(markers[0].kind).toBe('start')
    expect(markers[1].event.id).toBe('d1')
    expect(markers[1].minute).toBe(23 * 60)
    expect(markers[1].kind).toBe('due')
  })

  it('只有日期没有时刻的待办不算线标记', () => {
    const markers = pointMarkers([DUE_DATE_ONLY], '2026-03-05')
    expect(markers.length).toBe(0)
  })

  it('全天条里不再重复显示这两类（有时间的）', () => {
    const dates = weekDates(WEEK_START)
    const chips = layoutAllDay([START_ONLY, DUE_ONLY, DUE_DATE_ONLY, ALL_DAY], dates)
    const ids = chips.map((chip) => chip.event.id)
    expect(ids).toContain('a1')
    expect(ids).toContain('d2')
    expect(ids).not.toContain('s1')
    expect(ids).not.toContain('d1')
  })

  it('周视图里渲染出线标记，且不在全天条里', async () => {
    render(
      <WeekView
        weekStart={WEEK_START}
        events={[START_ONLY, DUE_ONLY]}
        today={TODAY}
        editing={false}
        onSelectEvent={() => {}}
        onOpenEditor={() => {}}
        onCreateAt={() => {}}
      />,
    )
    const marker = await screen.findByTestId('marker-s1')
    expect(marker.className).toContain('point-marker--start')
    expect((marker as HTMLElement).style.top).toBe(`${(15.5 * 48)}px`.replace('768px', '744px'))
    expect(screen.getByTestId('marker-d1').className).toContain('point-marker--due')
    expect(screen.queryByTestId('chip-s1')).toBeNull()
    expect(screen.queryByTestId('chip-d1')).toBeNull()
    cleanup()
  })

  it('点线标记能选中该日程', async () => {
    const picked: string[] = []
    render(
      <WeekView
        weekStart={WEEK_START}
        events={[START_ONLY]}
        today={TODAY}
        editing={false}
        onSelectEvent={(id) => picked.push(id)}
        onOpenEditor={() => {}}
        onCreateAt={() => {}}
      />,
    )
    fireEvent.click(await screen.findByTestId('marker-s1'))
    expect(picked).toEqual(['s1'])
    cleanup()
  })

  it('日视图里也有线标记', async () => {
    render(
      <DayView
        date={TODAY}
        today={TODAY}
        nowMinute={600}
        events={[START_ONLY, DUE_ONLY]}
        editing={false}
        onSelectEvent={() => {}}
        onOpenEditor={() => {}}
        onCreateAt={() => {}}
      />,
    )
    expect(await screen.findByTestId('marker-s1')).toBeTruthy()
    expect(screen.getByTestId('marker-d1')).toBeTruthy()
    cleanup()
  })
})

describe('反馈 #3：全天条要能看清', () => {
  it('全天条有独立的内容容器，云片放在里面（不再用负边距叠层）', async () => {
    render(
      <WeekView
        weekStart={WEEK_START}
        events={[ALL_DAY]}
        today={TODAY}
        editing={false}
        onSelectEvent={() => {}}
        onOpenEditor={() => {}}
        onCreateAt={() => {}}
      />,
    )
    const body = await screen.findByTestId('week-allday-body')
    const chip = screen.getByTestId('chip-a1')
    expect(body.contains(chip)).toBe(true)
    expect(body.querySelector('.week-allday__grid')).not.toBeNull()
    cleanup()
  })

  it('多条全天日程都能渲染出来（不会只显示一条）', async () => {
    const many = Array.from({ length: 5 }, (_, index) =>
      ev({ id: `a${index}`, title: `全天${index}`, kind: 'allDay', startAt: '2026-03-04', endAt: '2026-03-04' }),
    )
    render(
      <WeekView
        weekStart={WEEK_START}
        events={many}
        today={TODAY}
        editing={false}
        onSelectEvent={() => {}}
        onOpenEditor={() => {}}
        onCreateAt={() => {}}
      />,
    )
    await screen.findByTestId('week-allday-body')
    expect(document.querySelectorAll('[data-testid^="chip-a"]').length).toBe(5)
    cleanup()
  })
})

describe('待办与只有开始的日程在 App 里能显示', () => {
  function makeApi(events: EventItem[]) {
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
      listEventExceptions: async () => [],
      createEvent: async () => events[0],
      updateEvent: async () => events[0],
      deleteEvent: async () => undefined,
      setEventDone: async () => undefined,
    }
    return api
  }

  it('新建的待办与只有开始的日程，在周视图里以线的形式出现', async () => {
    render(
      <App today={TODAY} initialAnchor={TODAY} api={makeApi([START_ONLY, DUE_ONLY])} />,
    )
    expect(await screen.findByTestId('marker-s1')).toBeTruthy()
    expect(screen.getByTestId('marker-d1')).toBeTruthy()
    cleanup()
  })
})
