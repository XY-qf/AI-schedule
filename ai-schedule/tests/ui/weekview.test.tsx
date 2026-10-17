import { describe, expect, it } from '../helpers/expect'
import { fireEvent, render, screen, cleanup } from '../helpers/ui'
import type { EventItem } from '../../src/shared/entities'
import { WeekView } from '../../src/renderer/components/WeekView'
import { EventBlock } from '../../src/renderer/components/EventBlock'
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

const WEEK_START = parseDate('2026-03-02') // 周一
const TODAY = parseDate('2026-03-04') // 周三

function renderWeek(events: EventItem[], overrides: Partial<Parameters<typeof WeekView>[0]> = {}) {
  const calls: string[] = []
  const utils = render(
    <WeekView
      weekStart={WEEK_START}
      events={events}
      today={TODAY}
      editing={false}
      onSelectEvent={(id) => calls.push(`select:${id}`)}
      onOpenEditor={(id) => calls.push(`edit:${id}`)}
      onCreateAt={(date, hour) => calls.push(`create:${date}:${hour}`)}
      {...overrides}
    />,
  )
  return { ...utils, calls }
}

describe('周视图 · 表头与列', () => {
  it('渲染周一到周日七列表头', () => {
    renderWeek([])
    const heads = ['2026-03-02', '2026-03-03', '2026-03-04', '2026-03-05', '2026-03-06', '2026-03-07', '2026-03-08']
    for (const date of heads) {
      expect(screen.getByTestId(`head-${date}`)).toBeTruthy()
    }
    expect(screen.getByTestId('head-2026-03-02').textContent).toContain('周一')
    expect(screen.getByTestId('head-2026-03-02').textContent).toContain('3/2')
    cleanup()
  })

  it('今天那一列有高亮标记', () => {
    renderWeek([])
    expect(screen.getByTestId('head-2026-03-04').className).toContain('is-today')
    expect(screen.getByTestId('col-2026-03-04').className).toContain('is-today')
    expect(screen.getByTestId('head-2026-03-05').className).not.toContain('is-today')
    cleanup()
  })

  it('每天有 24 个可双击的小时格', () => {
    renderWeek([])
    for (let hour = 0; hour < 24; hour += 1) {
      expect(screen.getByTestId(`slot-2026-03-02-${hour}`)).toBeTruthy()
    }
    expect(screen.getAllByTestId(/^slot-2026-03-02-/).length).toBe(24)
    cleanup()
  })

  it('双击小时格回调日期与小时', () => {
    const { calls } = renderWeek([])
    fireEvent.doubleClick(screen.getByTestId('slot-2026-03-05-14'))
    expect(calls).toEqual(['create:2026-03-05:14'])
    cleanup()
  })
})

describe('周视图 · 日程块', () => {
  it('时间段事件落在正确的列，位置与高度按时长换算', () => {
    const event = ev({ id: 'e1', title: '高数', startAt: '2026-03-02T08:00', endAt: '2026-03-02T09:40' })
    renderWeek([event])
    const block = screen.getByTestId('block-e1')
    // 08:00 → 480 分钟 → 480/60*48 = 384px；100 分钟 → 80px
    expect(block.style.top).toBe('384px')
    expect(block.style.height).toBe('80px')
    expect(screen.getByTestId('col-2026-03-02').contains(block)).toBe(true)
    cleanup()
  })

  it('块内显示标题、时间与地点', () => {
    const event = ev({ id: 'e2', title: '篮球训练', startAt: '2026-03-03T19:30', endAt: '2026-03-03T21:00', location: '体育馆' })
    renderWeek([event])
    const block = screen.getByTestId('block-e2')
    expect(block.textContent).toContain('篮球训练')
    expect(block.textContent).toContain('19:30–21:00')
    expect(block.textContent).toContain('体育馆')
    cleanup()
  })

  it('太短的块只显示标题，不挤两行', () => {
    const event = ev({ id: 'e3', title: '短会', startAt: '2026-03-02T08:00', endAt: '2026-03-02T08:15' })
    renderWeek([event])
    const block = screen.getByTestId('block-e3')
    expect(block.className).toContain('is-compact')
    expect(block.textContent).not.toContain('08:00')
    cleanup()
  })

  it('重叠的两个日程左右各占一半', () => {
    renderWeek([
      ev({ id: 'a', startAt: '2026-03-02T08:00', endAt: '2026-03-02T10:00' }),
      ev({ id: 'b', startAt: '2026-03-02T09:00', endAt: '2026-03-02T11:00' }),
    ])
    const a = screen.getByTestId('block-a')
    const b = screen.getByTestId('block-b')
    expect(a.style.width).toContain('50%')
    expect(b.style.width).toContain('50%')
    expect(a.style.left).toContain('0%')
    expect(b.style.left).toContain('50%')
    cleanup()
  })

  it('单击选中、双击进入编辑', () => {
    const { calls } = renderWeek([ev({ id: 'e4', startAt: '2026-03-02T08:00', endAt: '2026-03-02T09:00' })])
    fireEvent.click(screen.getByTestId('block-e4'))
    fireEvent.doubleClick(screen.getByTestId('block-e4'))
    expect(calls).toEqual(['select:e4', 'edit:e4'])
    cleanup()
  })

  it('已完成日程带划线样式', () => {
    renderWeek([ev({ id: 'e5', done: true, startAt: '2026-03-02T08:00', endAt: '2026-03-02T09:00' })])
    expect(screen.getByTestId('block-e5').className).toContain('is-done')
    cleanup()
  })

  it('三类日程带各自的分类样式', () => {
    renderWeek([
      ev({ id: 'c', category: 'course', startAt: '2026-03-02T08:00', endAt: '2026-03-02T09:00' }),
      ev({ id: 'a', category: 'activity', startAt: '2026-03-03T08:00', endAt: '2026-03-03T09:00' }),
      ev({ id: 'l', category: 'life', startAt: '2026-03-04T08:00', endAt: '2026-03-04T09:00' }),
    ])
    expect(screen.getByTestId('block-c').className).toContain('category-course')
    expect(screen.getByTestId('block-a').className).toContain('category-activity')
    expect(screen.getByTestId('block-l').className).toContain('category-life')
    cleanup()
  })

  it('跨天事件在每一天都出现', () => {
    renderWeek([ev({ id: 'x', kind: 'allDay', startAt: '2026-03-02', endAt: '2026-03-04' })])
    expect(screen.getAllByTestId('chip-x').length).toBe(1)
    cleanup()
  })
})

describe('周视图 · 全天条', () => {
  it('全天事件进全天条而不是时间轴', () => {
    renderWeek([ev({ id: 'all', kind: 'allDay', startAt: '2026-03-03', endAt: '2026-03-03' })])
    expect(screen.getByTestId('chip-all')).toBeTruthy()
    expect(screen.queryByTestId('block-all')).toBeNull()
    cleanup()
  })

  it('待办进全天条并带方框标记', () => {
    renderWeek([ev({ id: 'todo', kind: 'todo', title: '买牙膏', dueAt: '2026-03-05' })])
    const chip = screen.getByTestId('chip-todo')
    expect(chip.textContent).toContain('买牙膏')
    expect(chip.textContent).toContain('☐')
    cleanup()
  })

  it('跨天事件按列跨列显示', () => {
    renderWeek([ev({ id: 'trip', kind: 'allDay', startAt: '2026-03-02', endAt: '2026-03-04' })])
    const chip = screen.getByTestId('chip-trip')
    expect(chip.style.gridColumn).toBe('1 / 4')
    cleanup()
  })

  it('点击全天条也打开详情', () => {
    const { calls } = renderWeek([ev({ id: 'all', kind: 'allDay', startAt: '2026-03-03', endAt: '2026-03-03' })])
    fireEvent.click(screen.getByTestId('chip-all'))
    expect(calls).toEqual(['select:all'])
    cleanup()
  })
})

describe('日程块组件', () => {
  it('悬浮提示包含分类与时间', () => {
    render(
      <EventBlock
        event={ev({ id: 'z', title: '社团例会', category: 'activity', startAt: '2026-03-02T14:00', endAt: '2026-03-02T16:00' })}
        placed={{ id: 'z', startMin: 840, endMin: 960, column: 0, columnCount: 1 }}
        editing={false}
        onSelect={() => {}}
        onOpenEditor={() => {}}
      />,
    )
    const block = screen.getByTestId('block-z')
    expect(block.getAttribute('title')).toContain('社团例会')
    expect(block.getAttribute('title')).toContain('课外活动')
    expect(block.getAttribute('title')).toContain('14:00–16:00')
    cleanup()
  })
})
