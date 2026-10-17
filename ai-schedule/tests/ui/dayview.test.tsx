import { describe, expect, it } from '../helpers/expect'
import { cleanup, fireEvent, render, screen } from '../helpers/ui'
import type { EventItem } from '../../src/shared/entities'
import { DayView } from '../../src/renderer/components/DayView'
import { freeSlots, totalFreeMinutes } from '../../src/shared/layout'
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

const DAY = parseDate('2026-03-04')

describe('空闲时段计算', () => {
  it('没有安排时整天都是空闲', () => {
    const gaps = freeSlots([])
    expect(gaps).toEqual([{ startMin: 0, endMin: 1440 }])
    expect(totalFreeMinutes(gaps)).toBe(1440)
  })

  it('两件事之间挖出空档', () => {
    const gaps = freeSlots([
      { startMin: 480, endMin: 580 },
      { startMin: 720, endMin: 840 },
    ])
    expect(gaps).toEqual([
      { startMin: 0, endMin: 480 },
      { startMin: 580, endMin: 720 },
      { startMin: 840, endMin: 1440 },
    ])
  })

  it('重叠的日程先合并再算空档', () => {
    const gaps = freeSlots([
      { startMin: 480, endMin: 600 },
      { startMin: 540, endMin: 660 },
    ])
    expect(gaps).toEqual([
      { startMin: 0, endMin: 480 },
      { startMin: 660, endMin: 1440 },
    ])
  })

  it('不足 30 分钟的空档忽略', () => {
    const gaps = freeSlots([
      { startMin: 600, endMin: 660 },
      { startMin: 680, endMin: 720 },
    ])
    // 660-680 只有 20 分钟，不算空闲
    expect(gaps.some((gap) => gap.startMin === 660)).toBe(false)
  })

  it('排满一天时没有空档', () => {
    expect(freeSlots([{ startMin: 0, endMin: 1440 }])).toEqual([])
  })

  it('零长度区间被忽略', () => {
    expect(freeSlots([{ startMin: 600, endMin: 600 }])).toEqual([{ startMin: 0, endMin: 1440 }])
  })
})

describe('日视图', () => {
  function renderDay(events: EventItem[], overrides: Partial<Parameters<typeof DayView>[0]> = {}) {
    const calls: string[] = []
    render(
      <DayView
        date={DAY}
        events={events}
        today={DAY}
        editing={false}
        nowMinute={600}
        onSelectEvent={(id) => calls.push(`select:${id}`)}
        onOpenEditor={(id) => calls.push(`edit:${id}`)}
        onCreateAt={(date, hour) => calls.push(`create:${date}:${hour}`)}
        {...overrides}
      />,
    )
    return calls
  }

  it('显示当天中文日期与“今天”标记', () => {
    renderDay([])
    expect(document.body.textContent).toContain('2026年3月4日 周三')
    expect(document.body.textContent).toContain('今天')
    cleanup()
  })

  it('24 个小时格都能双击新建', () => {
    const calls = renderDay([])
    fireEvent.doubleClick(screen.getByTestId('day-slot-8'))
    expect(calls).toEqual(['create:2026-03-04:8'])
    expect(screen.getAllByTestId(/^day-slot-/).length).toBe(24)
    cleanup()
  })

  it('时间段事件显示在时间轴，位置按时长换算', () => {
    renderDay([ev({ id: 'e1', title: '高数', startAt: '2026-03-04T08:00', endAt: '2026-03-04T09:40' })])
    const block = screen.getByTestId('block-e1')
    expect(block.style.top).toBe('384px')
    expect(block.style.height).toBe('80px')
    cleanup()
  })

  it('今天会画一条“现在”红线，不是今天则不画', () => {
    renderDay([])
    const line = screen.getByTestId('now-line')
    expect(line.style.top).toBe('480px') // 600 分钟 → 10 点
    cleanup()

    renderDay([], { date: parseDate('2026-03-05') })
    expect(screen.queryByTestId('now-line')).toBeNull()
    cleanup()
  })

  it('当天面板列出待办', () => {
    renderDay([
      ev({ id: 't1', title: '买牙膏', kind: 'todo', dueAt: '2026-03-04T23:59' }),
      ev({ id: 't2', title: '交报告', kind: 'todo', dueAt: '2026-03-05T23:59' }),
    ])
    expect(screen.getByTestId('day-todo-t1').textContent).toBe('买牙膏')
    expect(screen.queryByTestId('day-todo-t2')).toBeNull()
    cleanup()
  })

  it('没有待办时给出提示', () => {
    renderDay([])
    expect(document.body.textContent).toContain('没有待办')
    cleanup()
  })

  it('当天面板显示空闲时段与合计', () => {
    renderDay([ev({ id: 'e1', startAt: '2026-03-04T08:00', endAt: '2026-03-04T10:00' })])
    const slots = screen.getByTestId('free-slots').textContent ?? ''
    expect(slots).toContain('00:00–08:00')
    expect(slots).toContain('10:00–24:00')
    cleanup()
  })

  it('排满时提示已排满', () => {
    renderDay([ev({ id: 'all', kind: 'allDay', startAt: '2026-03-04', endAt: '2026-03-04' })])
    expect(document.body.textContent).toContain('空闲时段')
    cleanup()
  })

  it('点击与双击日程块回传', () => {
    const calls = renderDay([ev({ id: 'e1', startAt: '2026-03-04T08:00', endAt: '2026-03-04T09:00' })])
    fireEvent.click(screen.getByTestId('block-e1'))
    fireEvent.doubleClick(screen.getByTestId('block-e1'))
    expect(calls).toEqual(['select:e1', 'edit:e1'])
    cleanup()
  })
})
