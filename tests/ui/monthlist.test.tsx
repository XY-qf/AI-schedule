import { describe, expect, it } from '../helpers/expect'
import { cleanup, fireEvent, render, screen } from '../helpers/ui'
import type { EventItem } from '../../src/shared/entities'
import { MonthView } from '../../src/renderer/components/MonthView'
import { ListView } from '../../src/renderer/components/ListView'
import {
  eventsOnDate,
  eventSpan,
  isSameMonth,
  monthGridDates,
  nextDays,
  sortByTime,
} from '../../src/shared/layout'
import { parseDate } from '../../src/shared/date'

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
    recurrenceId: null,
    createdAt: '',
    updatedAt: '',
  }
}

const TODAY = parseDate('2026-03-04')
const MARCH = parseDate('2026-03-04')

describe('日期区间与网格工具', () => {
  it('日程跨度：时间段、全天、待办', () => {
    expect(eventSpan(ev({ id: 'a', startAt: '2026-03-04T08:00', endAt: '2026-03-04T09:00' }))).toEqual({
      start: '2026-03-04',
      end: '2026-03-04',
    })
    expect(eventSpan(ev({ id: 'b', kind: 'allDay', startAt: '2026-03-04', endAt: '2026-03-06' }))).toEqual({
      start: '2026-03-04',
      end: '2026-03-06',
    })
    expect(eventSpan(ev({ id: 'c', kind: 'todo', dueAt: '2026-03-08' }))).toEqual({
      start: '2026-03-08',
      end: '2026-03-08',
    })
    expect(eventSpan(ev({ id: 'd' }))).toBeNull()
  })

  it('按天取日程时跨天事件每天都出现', () => {
    const trip = ev({ id: 'trip', kind: 'allDay', startAt: '2026-03-04', endAt: '2026-03-06' })
    expect(eventsOnDate([trip], '2026-03-04').length).toBe(1)
    expect(eventsOnDate([trip], '2026-03-05').length).toBe(1)
    expect(eventsOnDate([trip], '2026-03-07').length).toBe(0)
  })

  it('同一天内排序：时间段在前、全天其次、待办最后', () => {
    const list = sortByTime([
      ev({ id: 'todo', kind: 'todo', dueAt: '2026-03-04T23:59', title: '待办' }),
      ev({ id: 'all', kind: 'allDay', startAt: '2026-03-04', endAt: '2026-03-04', title: '全天' }),
      ev({ id: 'late', startAt: '2026-03-04T19:00', endAt: '2026-03-04T20:00', title: '晚间' }),
      ev({ id: 'early', startAt: '2026-03-04T08:00', endAt: '2026-03-04T09:00', title: '早间' }),
    ])
    expect(list.map((item) => item.id)).toEqual(['early', 'late', 'all', 'todo'])
  })

  it('月网格是 42 天且从周一开始', () => {
    const dates = monthGridDates(parseDate('2026-03-15'))
    expect(dates.length).toBe(42)
    expect(dates[0]).toBe('2026-02-23') // 3 月 1 日是周日，网格从 2 月 23 日周一起
    expect(dates[41]).toBe('2026-04-05')
  })

  it('判断日期是否属于该月', () => {
    expect(isSameMonth('2026-03-01', MARCH)).toBe(true)
    expect(isSameMonth('2026-02-28', MARCH)).toBe(false)
    expect(isSameMonth('2026-04-01', MARCH)).toBe(false)
  })

  it('连续 N 天', () => {
    expect(nextDays('2026-03-30', 3)).toEqual(['2026-03-30', '2026-03-31', '2026-04-01'])
  })
})

describe('月视图', () => {
  function renderMonth(events: EventItem[], overrides: Partial<Parameters<typeof MonthView>[0]> = {}) {
    const calls: string[] = []
    render(
      <MonthView
        monthAnchor={MARCH}
        events={events}
        today={TODAY}
        editing={false}
        onSelectEvent={(id) => calls.push(`select:${id}`)}
        onOpenEditor={(id) => calls.push(`edit:${id}`)}
        onCreateAt={(date) => calls.push(`create:${date}`)}
        onShowMore={(date) => calls.push(`more:${date}`)}
        {...overrides}
      />,
    )
    return calls
  }

  it('渲染六行七列共 42 个格子', () => {
    renderMonth([])
    expect(screen.getAllByTestId(/^month-cell-/).length).toBe(42)
    expect(screen.getByTestId('month-cell-2026-02-23')).toBeTruthy()
    expect(screen.getByTestId('month-cell-2026-04-05')).toBeTruthy()
    cleanup()
  })

  it('非本月日期灰显，今天高亮', () => {
    renderMonth([])
    expect(screen.getByTestId('month-cell-2026-02-23').className).toContain('is-outside')
    expect(screen.getByTestId('month-cell-2026-03-15').className).not.toContain('is-outside')
    expect(screen.getByTestId('month-cell-2026-03-04').className).toContain('is-today')
    cleanup()
  })

  it('格子里显示日程，超过 3 条折叠成 +N 更多', () => {
    const many = [1, 2, 3, 4, 5].map((n) =>
      ev({ id: `e${n}`, title: `事项${n}`, startAt: `2026-03-10T0${n}:00`, endAt: `2026-03-10T0${n}:30` }),
    )
    renderMonth(many)
    expect(screen.getByTestId('month-item-e1-2026-03-10')).toBeTruthy()
    expect(screen.getByTestId('month-item-e3-2026-03-10')).toBeTruthy()
    expect(screen.queryByTestId('month-item-e4-2026-03-10')).toBeNull()
    expect(screen.getByTestId('month-more-2026-03-10').textContent).toBe('+2 更多')
    cleanup()
  })

  it('点「+N 更多」跳转那天', () => {
    const many = [1, 2, 3, 4].map((n) =>
      ev({ id: `e${n}`, startAt: `2026-03-10T0${n}:00`, endAt: `2026-03-10T0${n}:30` }),
    )
    const calls = renderMonth(many)
    fireEvent.click(screen.getByTestId('month-more-2026-03-10'))
    expect(calls).toEqual(['more:2026-03-10'])
    cleanup()
  })

  it('双击空白格子按该日新建', () => {
    const calls = renderMonth([])
    fireEvent.doubleClick(screen.getByTestId('month-cell-2026-03-20'))
    expect(calls).toEqual(['create:2026-03-20'])
    cleanup()
  })

  it('点日程条打开详情，双击进编辑（事件不冒泡到格子）', () => {
    const calls = renderMonth([ev({ id: 'e1', title: '高数', startAt: '2026-03-10T08:00', endAt: '2026-03-10T09:40' })])
    fireEvent.click(screen.getByTestId('month-item-e1-2026-03-10'))
    fireEvent.doubleClick(screen.getByTestId('month-item-e1-2026-03-10'))
    expect(calls).toEqual(['select:e1', 'edit:e1'])
    cleanup()
  })

  it('全天与待办在格子里显示', () => {
    renderMonth([
      ev({ id: 'all', title: '回家', kind: 'allDay', startAt: '2026-03-07', endAt: '2026-03-08' }),
      ev({ id: 'todo', title: '交报告', kind: 'todo', dueAt: '2026-03-09' }),
    ])
    expect(screen.getByTestId('month-item-all-2026-03-07').textContent).toContain('全天')
    expect(screen.getByTestId('month-item-all-2026-03-08')).toBeTruthy()
    expect(screen.getByTestId('month-item-todo-2026-03-09').textContent).toContain('交报告')
    cleanup()
  })
})

describe('列表视图', () => {
  function renderList(events: EventItem[], overrides: Partial<Parameters<typeof ListView>[0]> = {}) {
    const calls: string[] = []
    render(
      <ListView
        anchor={TODAY}
        events={events}
        today={TODAY}
        onSelectEvent={(id) => calls.push(`select:${id}`)}
        onToggleDone={(id) => calls.push(`done:${id}`)}
        {...overrides}
      />,
    )
    return calls
  }

  it('按天分组，今天与明天用相对标签', () => {
    renderList([
      ev({ id: 'a', title: '高数', startAt: '2026-03-04T08:00', endAt: '2026-03-04T09:40' }),
      ev({ id: 'b', title: '物理', startAt: '2026-03-05T10:00', endAt: '2026-03-05T11:40' }),
    ])
    expect(screen.getByTestId('list-group-2026-03-04').textContent).toContain('今天 · 3月4日 周三')
    expect(screen.getByTestId('list-group-2026-03-05').textContent).toContain('明天 · 3月5日 周四')
    cleanup()
  })

  it('组内按时间排序，行内显示时间与地点', () => {
    renderList([
      ev({ id: 'late', title: '晚间', startAt: '2026-03-04T19:00', endAt: '2026-03-04T20:00' }),
      ev({ id: 'early', title: '早间', startAt: '2026-03-04T08:00', endAt: '2026-03-04T09:00', location: 'A101' }),
    ])
    const group = screen.getByTestId('list-group-2026-03-04')
    const rows = group.querySelectorAll('[data-testid^="list-row-"]')
    expect(rows[0].getAttribute('data-testid')).toBe('list-row-early')
    expect(rows[0].textContent).toContain('08:00–09:00')
    expect(rows[0].textContent).toContain('A101')
    cleanup()
  })

  it('已完成条目带划线样式', () => {
    renderList([ev({ id: 'a', title: '已完成的事', done: true, startAt: '2026-03-04T08:00', endAt: '2026-03-04T09:00' })])
    expect(screen.getByTestId('list-row-a').className).toContain('is-done')
    cleanup()
  })

  it('点行打开详情，勾选回传完成切换', () => {
    const calls = renderList([ev({ id: 'a', title: '高数', startAt: '2026-03-04T08:00', endAt: '2026-03-04T09:00' })])
    fireEvent.click(screen.getByRole('button', { name: /高数/ }))
    fireEvent.click(screen.getByRole('checkbox'))
    expect(calls).toEqual(['select:a', 'done:a'])
    cleanup()
  })

  it('只显示 30 天内的日程', () => {
    renderList([
      ev({ id: 'in', startAt: '2026-03-20T08:00', endAt: '2026-03-20T09:00' }),
      ev({ id: 'out', startAt: '2026-05-20T08:00', endAt: '2026-05-20T09:00' }),
    ])
    expect(screen.queryByTestId('list-row-in')).toBeTruthy()
    expect(screen.queryByTestId('list-row-out')).toBeNull()
    cleanup()
  })

  it('没有安排时显示空状态', () => {
    renderList([])
    expect(document.body.textContent).toContain('接下来 30 天还没有安排')
    cleanup()
  })
})
