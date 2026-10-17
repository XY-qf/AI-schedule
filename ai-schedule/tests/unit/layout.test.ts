import { describe, expect, it } from '../helpers/expect'
import type { EventItem } from '../../src/shared/entities'
import {
  blockGeometry,
  isAllDayLike,
  layoutAllDay,
  layoutDay,
  spanOfDay,
  spansOverlap,
  weekDates,
  weekdayOfDate,
} from '../../src/shared/layout'
import { conflictMessage, findConflicts } from '../../src/shared/conflict'
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
    location: null,
    people: null,
    note: null,
    done: partial.done ?? false,
    recurrenceId: null,
    createdAt: '',
    updatedAt: '',
  }
}

describe('日程块几何', () => {
  it('同日时间段换算为分钟', () => {
    const e = ev({ id: 'a', startAt: '2026-03-04T08:00', endAt: '2026-03-04T09:40' })
    expect(spanOfDay(e, '2026-03-04')).toEqual({ startMin: 480, endMin: 580 })
    expect(blockGeometry({ startMin: 480, endMin: 580 })).toEqual({ topMin: 480, heightMin: 100 })
  })

  it('跨天事件在中间那天占满整天', () => {
    const e = ev({ id: 'a', startAt: '2026-04-01T22:00', endAt: '2026-04-03T02:00' })
    expect(spanOfDay(e, '2026-04-02')).toEqual({ startMin: 0, endMin: 1440 })
    expect(spanOfDay(e, '2026-04-01')).toEqual({ startMin: 1320, endMin: 1440 })
    expect(spanOfDay(e, '2026-04-03')).toEqual({ startMin: 0, endMin: 120 })
  })

  it('不在当天的日程返回 null', () => {
    const e = ev({ id: 'a', startAt: '2026-03-04T08:00', endAt: '2026-03-04T09:00' })
    expect(spanOfDay(e, '2026-03-05')).toBeNull()
  })

  it('全天与待办没有时间轴区间', () => {
    expect(spanOfDay(ev({ id: 'b', kind: 'allDay', startAt: '2026-03-04', endAt: '2026-03-04' }), '2026-03-04')).toBeNull()
    expect(spanOfDay(ev({ id: 'c', kind: 'todo', dueAt: '2026-03-04' }), '2026-03-04')).toBeNull()
  })

  it('零长度也至少给 1 分钟高度，避免块消失', () => {
    expect(blockGeometry({ startMin: 600, endMin: 600 }).heightMin).toBe(1)
  })
})

describe('重叠判定', () => {
  it('首尾相接不算重叠，真交叉才算', () => {
    expect(spansOverlap({ startMin: 540, endMin: 600 }, { startMin: 600, endMin: 660 })).toBe(false)
    expect(spansOverlap({ startMin: 540, endMin: 601 }, { startMin: 600, endMin: 660 })).toBe(true)
    expect(spansOverlap({ startMin: 500, endMin: 700 }, { startMin: 550, endMin: 600 })).toBe(true)
  })
})

describe('并排排布', () => {
  it('互不重叠时各占满宽', () => {
    const placed = layoutDay([
      { id: 'a', startMin: 480, endMin: 540 },
      { id: 'b', startMin: 600, endMin: 660 },
    ])
    expect(placed).toEqual([
      { id: 'a', startMin: 480, endMin: 540, column: 0, columnCount: 1 },
      { id: 'b', startMin: 600, endMin: 660, column: 0, columnCount: 1 },
    ])
  })

  it('两个重叠时左右各占一半', () => {
    const placed = layoutDay([
      { id: 'a', startMin: 480, endMin: 600 },
      { id: 'b', startMin: 540, endMin: 660 },
    ])
    expect(placed.map((b) => b.column)).toEqual([0, 1])
    expect(placed.map((b) => b.columnCount)).toEqual([2, 2])
  })

  it('三个互相重叠时分成三列', () => {
    const placed = layoutDay([
      { id: 'a', startMin: 480, endMin: 600 },
      { id: 'b', startMin: 500, endMin: 620 },
      { id: 'c', startMin: 520, endMin: 640 },
    ])
    expect(placed.map((b) => b.column)).toEqual([0, 1, 2])
    expect(placed.every((b) => b.columnCount === 3)).toBe(true)
  })

  it('不重叠的簇互不影响列数', () => {
    const placed = layoutDay([
      { id: 'a', startMin: 480, endMin: 540 },
      { id: 'b', startMin: 500, endMin: 600 },
      { id: 'c', startMin: 700, endMin: 760 },
    ])
    const byId = new Map(placed.map((b) => [b.id, b]))
    expect(byId.get('a')?.columnCount).toBe(2)
    expect(byId.get('b')?.columnCount).toBe(2)
    expect(byId.get('c')?.columnCount).toBe(1)
  })

  it('首尾相接的两条不并排', () => {
    const placed = layoutDay([
      { id: 'a', startMin: 480, endMin: 540 },
      { id: 'b', startMin: 540, endMin: 600 },
    ])
    expect(placed.every((b) => b.columnCount === 1)).toBe(true)
  })
})

describe('一周日期与星期', () => {
  it('从周一开始连续 7 天', () => {
    expect(weekDates(parseDate('2026-03-02'))).toEqual([
      '2026-03-02',
      '2026-03-03',
      '2026-03-04',
      '2026-03-05',
      '2026-03-06',
      '2026-03-07',
      '2026-03-08',
    ])
  })

  it('跨月那一周正确衔接', () => {
    const dates = weekDates(parseDate('2026-03-30'))
    expect(dates[0]).toBe('2026-03-30')
    expect(dates[6]).toBe('2026-04-05')
  })

  it('日期转星期序号', () => {
    expect(weekdayOfDate('2026-03-02')).toBe(1)
    expect(weekdayOfDate('2026-03-08')).toBe(7)
  })
})

describe('全天条', () => {
  it('全天、跨天、待办进全天条；时间段事件不进', () => {
    expect(isAllDayLike(ev({ id: 'a', kind: 'allDay', startAt: '2026-03-04', endAt: '2026-03-04' }))).toBe(true)
    expect(isAllDayLike(ev({ id: 'b', kind: 'todo', dueAt: '2026-03-04' }))).toBe(true)
    expect(isAllDayLike(ev({ id: 'c', startAt: '2026-03-04T08:00', endAt: '2026-03-04T09:00' }))).toBe(false)
  })

  it('跨天事件按列截取，并标记左右被截断', () => {
    const dates = weekDates(parseDate('2026-03-02'))
    const chips = layoutAllDay(
      [ev({ id: 'trip', title: '外地比赛', kind: 'allDay', startAt: '2026-02-27', endAt: '2026-03-03' })],
      dates,
    )
    expect(chips.length).toBe(1)
    expect(chips[0].startCol).toBe(0)
    expect(chips[0].endCol).toBe(1)
    expect(chips[0].continuesLeft).toBe(true)
    expect(chips[0].continuesRight).toBe(false)
  })

  it('不在本周的事件被排除', () => {
    const dates = weekDates(parseDate('2026-03-02'))
    const chips = layoutAllDay(
      [ev({ id: 'x', kind: 'allDay', startAt: '2026-04-10', endAt: '2026-04-11' })],
      dates,
    )
    expect(chips).toEqual([])
  })

  it('跨度长的排前面，顺序稳定', () => {
    const dates = weekDates(parseDate('2026-03-02'))
    const chips = layoutAllDay(
      [
        ev({ id: 'short', title: '一天', kind: 'allDay', startAt: '2026-03-04', endAt: '2026-03-04' }),
        ev({ id: 'long', title: '三天', kind: 'allDay', startAt: '2026-03-02', endAt: '2026-03-04' }),
        ev({ id: 'todo', title: '买牙膏', kind: 'todo', dueAt: '2026-03-03' }),
      ],
      dates,
    )
    expect(chips.map((c) => c.event.id)).toEqual(['long', 'short', 'todo'])
  })

  it('待办落在单列上', () => {
    const dates = weekDates(parseDate('2026-03-02'))
    const chips = layoutAllDay([ev({ id: 'd', kind: 'todo', dueAt: '2026-03-05' })], dates)
    expect(chips[0].startCol).toBe(3)
    expect(chips[0].endCol).toBe(3)
  })
})

describe('冲突检测', () => {
  const existing = [
    ev({ id: 'c1', title: '高数', startAt: '2026-03-04T08:00', endAt: '2026-03-04T09:40' }),
    ev({ id: 'c2', title: '英语', startAt: '2026-03-04T10:00', endAt: '2026-03-04T11:40' }),
    ev({ id: 'c3', title: '全天', kind: 'allDay', startAt: '2026-03-04', endAt: '2026-03-04' }),
    ev({ id: 'c4', title: '待办', kind: 'todo', dueAt: '2026-03-04' }),
  ]

  it('时间重叠时检出并给出重叠分钟数', () => {
    const conflicts = findConflicts(
      { startAt: '2026-03-04T09:00', endAt: '2026-03-04T10:30', kind: 'timed' },
      existing,
    )
    expect(conflicts.length).toBe(2)
    expect(conflicts[0].other.id).toBe('c1')
    expect(conflicts[0].overlapMinutes).toBe(40)
  })

  it('首尾相接不算冲突', () => {
    expect(
      findConflicts({ startAt: '2026-03-04T09:40', endAt: '2026-03-04T10:00', kind: 'timed' }, existing),
    ).toEqual([])
  })

  it('全天与待办不参与冲突', () => {
    expect(
      findConflicts({ startAt: '2026-03-04T00:00', endAt: '2026-03-04T23:59', kind: 'timed' }, existing).map((c) => c.other.id),
    ).toEqual(['c1', 'c2'])
  })

  it('编辑自己时不会和自己冲突', () => {
    const conflicts = findConflicts(
      { id: 'c1', startAt: '2026-03-04T08:00', endAt: '2026-03-04T09:40', kind: 'timed' },
      existing,
    )
    expect(conflicts).toEqual([])
  })

  it('非时间段类型不检出冲突', () => {
    expect(findConflicts({ startAt: '2026-03-04', endAt: '2026-03-04', kind: 'allDay' }, existing)).toEqual([])
  })

  it('提示文案包含标题与时间', () => {
    const conflicts = findConflicts(
      { startAt: '2026-03-04T08:30', endAt: '2026-03-04T09:00', kind: 'timed' },
      existing,
    )
    expect(conflictMessage(conflicts)).toBe('与「高数 08:00–09:40」时间重叠，可仍然保存')
    expect(conflictMessage([])).toBeNull()
  })

  it('多个冲突时提示另有几项', () => {
    const conflicts = findConflicts(
      { startAt: '2026-03-04T08:00', endAt: '2026-03-04T11:00', kind: 'timed' },
      existing,
    )
    expect(conflictMessage(conflicts)).toContain('另有 1 项重叠')
  })
})
