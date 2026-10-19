import { describe, expect, it } from '../helpers/expect'
import { cleanup, fireEvent, render, screen } from '../helpers/ui'
import type { EventItem } from '../../src/shared/entities'
import { bucketOf, groupByTime, groupTodos } from '../../src/shared/collections'
import { parseDate } from '../../src/shared/date'
import { CategoryPage } from '../../src/renderer/components/CategoryPage'
import { TodoPage } from '../../src/renderer/components/TodoPage'
import { App } from '../../src/renderer/App'
import type { PreloadApi } from '../../src/shared/ipc'
import { EMPTY_COURSE_API } from '../helpers/apiExtras'

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

// 2026-03-04 是周三，本周到 3 月 8 日（周日）
const TODAY = parseDate('2026-03-04')

describe('分桶规则', () => {
  it('逾期 / 今天 / 本周 / 以后', () => {
    expect(bucketOf('2026-03-03', TODAY)).toBe('overdue')
    expect(bucketOf('2026-03-04', TODAY)).toBe('today')
    expect(bucketOf('2026-03-05', TODAY)).toBe('thisWeek')
    expect(bucketOf('2026-03-08', TODAY)).toBe('thisWeek')
    expect(bucketOf('2026-03-09', TODAY)).toBe('later')
    expect(bucketOf('2026-04-01', TODAY)).toBe('later')
  })

  it('周日当天时本周只剩今天', () => {
    const sunday = parseDate('2026-03-08')
    expect(bucketOf('2026-03-08', sunday)).toBe('today')
    expect(bucketOf('2026-03-09', sunday)).toBe('later')
  })
})

describe('待办分组', () => {
  it('已完成的单独一组，未完成按到期时间分组', () => {
    const groups = groupTodos(
      [
        ev({ id: 'a', kind: 'todo', dueAt: '2026-03-01', title: '逾期' }),
        ev({ id: 'b', kind: 'todo', dueAt: '2026-03-04T23:59', title: '今天' }),
        ev({ id: 'c', kind: 'todo', dueAt: '2026-03-06', title: '本周' }),
        ev({ id: 'd', kind: 'todo', dueAt: '2026-04-01', title: '以后' }),
        ev({ id: 'e', kind: 'todo', dueAt: '2026-03-02', title: '完成', done: true }),
      ],
      TODAY,
    )
    expect(groups.overdue.map((item) => item.id)).toEqual(['a'])
    expect(groups.today.map((item) => item.id)).toEqual(['b'])
    expect(groups.thisWeek.map((item) => item.id)).toEqual(['c'])
    expect(groups.later.map((item) => item.id)).toEqual(['d'])
    expect(groups.done.map((item) => item.id)).toEqual(['e'])
  })

  it('没有截止日期的待办落到“以后”，组内按截止时间排序', () => {
    const groups = groupTodos(
      [
        ev({ id: 'x', kind: 'todo', dueAt: null, title: '无日期' }),
        ev({ id: 'y', kind: 'todo', dueAt: '2026-05-01', title: '晚' }),
        ev({ id: 'z', kind: 'todo', dueAt: '2026-04-01', title: '早' }),
      ],
      TODAY,
    )
    expect(groups.later.map((item) => item.id)).toEqual(['z', 'y', 'x'])
  })
})

describe('分类时间分组', () => {
  it('今天及以后是“即将到来”，之前是“更早”', () => {
    const groups = groupByTime(
      [
        ev({ id: 'a', startAt: '2026-03-01T10:00', endAt: '2026-03-01T11:00' }),
        ev({ id: 'b', startAt: '2026-03-04T10:00', endAt: '2026-03-04T11:00' }),
        ev({ id: 'c', startAt: '2026-03-06T10:00', endAt: '2026-03-06T11:00' }),
      ],
      TODAY,
    )
    expect(groups.upcoming.map((item) => item.id)).toEqual(['b', 'c'])
    expect(groups.past.map((item) => item.id)).toEqual(['a'])
  })

  it('“更早”按时间倒序', () => {
    const groups = groupByTime(
      [
        ev({ id: 'old', startAt: '2026-02-01T10:00', endAt: '2026-02-01T11:00' }),
        ev({ id: 'new', startAt: '2026-03-01T10:00', endAt: '2026-03-01T11:00' }),
      ],
      TODAY,
    )
    expect(groups.past.map((item) => item.id)).toEqual(['new', 'old'])
  })
})

describe('分类页组件', () => {
  function renderCategory(events: EventItem[], overrides: Partial<Parameters<typeof CategoryPage>[0]> = {}) {
    const calls: string[] = []
    render(
      <CategoryPage
        category="activity"
        events={events}
        today={TODAY}
        onCreate={() => calls.push('create')}
        onSelect={(id) => calls.push(`select:${id}`)}
        onToggleDone={(id) => calls.push(`done:${id}`)}
        {...overrides}
      />,
    )
    return calls
  }

  it('显示即将到来的条目，过去的需要展开', () => {
    renderCategory([
      ev({ id: 'future', startAt: '2026-03-06T14:00', endAt: '2026-03-06T16:00' }),
      ev({ id: 'past', startAt: '2026-03-01T10:00', endAt: '2026-03-01T12:00' }),
    ])
    expect(screen.getByTestId('cat-row-future')).toBeTruthy()
    expect(screen.queryByTestId('cat-row-past')).toBeNull()
    expect(document.body.textContent).toContain('展开（1）')
    cleanup()
  })

  it('展开后能看到更早的条目', () => {
    renderCategory([ev({ id: 'past', startAt: '2026-03-01T10:00', endAt: '2026-03-01T12:00' })])
    fireEvent.click(screen.getByRole('button', { name: /展开（1）/ }))
    expect(screen.getByTestId('cat-row-past')).toBeTruthy()
    cleanup()
  })

  it('默认隐藏已完成，勾选后显示', () => {
    renderCategory([ev({ id: 'doneItem', done: true, startAt: '2026-03-06T14:00', endAt: '2026-03-06T16:00' })])
    expect(screen.queryByTestId('cat-row-doneItem')).toBeNull()
    fireEvent.click(screen.getByLabelText('显示已完成的'))
    expect(screen.getByTestId('cat-row-doneItem')).toBeTruthy()
    cleanup()
  })

  it('新建、选中与勾选完成都回传', () => {
    const calls = renderCategory([ev({ id: 'e1', title: '社团例会', startAt: '2026-03-06T14:00', endAt: '2026-03-06T16:00' })])
    fireEvent.click(screen.getByRole('button', { name: '＋ 新建课外活动' }))
    fireEvent.click(screen.getByRole('button', { name: /社团例会/ }))
    fireEvent.click(screen.getByLabelText('社团例会 已完成'))
    expect(calls).toEqual(['create', 'select:e1', 'done:e1'])
    cleanup()
  })

  it('没有任何安排时显示空状态', () => {
    renderCategory([])
    expect(document.body.textContent).toContain('还没有课外活动安排')
    cleanup()
  })
})

describe('待办页组件', () => {
  function renderTodo(events: EventItem[]) {
    const calls: string[] = []
    render(
      <TodoPage
        events={events}
        today={TODAY}
        onCreate={() => calls.push('create')}
        onSelect={(id) => calls.push(`select:${id}`)}
        onToggleDone={(id) => calls.push(`done:${id}`)}
      />,
    )
    return calls
  }

  it('按逾期/今天/本周/以后分组并显示数量', () => {
    renderTodo([
      ev({ id: 'a', kind: 'todo', dueAt: '2026-03-01', title: '逾期事' }),
      ev({ id: 'b', kind: 'todo', dueAt: '2026-03-04T23:59', title: '今天事' }),
      ev({ id: 'c', kind: 'todo', dueAt: '2026-03-06', title: '本周事' }),
      ev({ id: 'd', kind: 'todo', dueAt: '2026-04-06', title: '以后事' }),
    ])
    expect(screen.getByTestId('todo-group-overdue').textContent).toContain('(1)')
    expect(screen.getByTestId('todo-group-today').textContent).toContain('(1)')
    expect(screen.getByTestId('todo-group-thisWeek').textContent).toContain('(1)')
    expect(screen.getByTestId('todo-group-later').textContent).toContain('(1)')
    expect(screen.getByTestId('todo-row-a').textContent).toContain('逾期事')
    cleanup()
  })

  it('没有条目的分组不渲染', () => {
    renderTodo([ev({ id: 'a', kind: 'todo', dueAt: '2026-04-06', title: '以后事' })])
    expect(screen.queryByTestId('todo-group-overdue')).toBeNull()
    expect(screen.getByTestId('todo-group-later')).toBeTruthy()
    cleanup()
  })

  it('已完成折叠，展开后可见', () => {
    renderTodo([ev({ id: 'done1', kind: 'todo', dueAt: '2026-03-01', title: '做完的事', done: true })])
    expect(screen.queryByTestId('todo-row-done1')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '展开已完成' }))
    expect(screen.getByTestId('todo-row-done1')).toBeTruthy()
    cleanup()
  })

  it('勾选与新建回传', () => {
    const calls = renderTodo([ev({ id: 'a', kind: 'todo', dueAt: '2026-03-04T23:59', title: '交报告' })])
    fireEvent.click(screen.getByLabelText('交报告 已完成'))
    fireEvent.click(screen.getByRole('button', { name: '＋ 新建待办' }))
    expect(calls).toEqual(['done:a', 'create'])
    cleanup()
  })

  it('没有待办时给出空状态', () => {
    renderTodo([])
    expect(document.body.textContent).toContain('还没有待办')
    cleanup()
  })
})

describe('三个页面接入应用', () => {
  function makeApi(): PreloadApi {
    const events: EventItem[] = [
      ev({ id: 'act', title: '篮球训练', startAt: '2026-03-06T19:00', endAt: '2026-03-06T21:00' }),
      ev({ id: 'life', title: '体检', category: 'life', startAt: '2026-03-07T09:00', endAt: '2026-03-07T10:00' }),
      ev({ id: 'todo', title: '交报告', kind: 'todo', category: 'course', dueAt: '2026-03-08' }),
    ]
    return {
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
      createEvent: async () => {
        throw new Error('未实现')
      },
      updateEvent: async () => {
        throw new Error('未实现')
      },
      deleteEvent: async () => undefined,
      setEventDone: async () => undefined,
    }
  }

  it('课外活动页只显示该分类的条目', async () => {
    render(<App today={TODAY} initialAnchor={TODAY} api={makeApi()} initialPage="activity" />)
    expect(await screen.findByTestId('cat-row-act')).toBeTruthy()
    expect(screen.queryByTestId('cat-row-life')).toBeNull()
    cleanup()
  })

  it('个人生活页只显示该分类的条目', async () => {
    render(<App today={TODAY} initialAnchor={TODAY} api={makeApi()} initialPage="life" />)
    expect(await screen.findByTestId('cat-row-life')).toBeTruthy()
    expect(screen.queryByTestId('cat-row-act')).toBeNull()
    cleanup()
  })

  it('待办页只显示待办条目', async () => {
    render(<App today={TODAY} initialAnchor={TODAY} api={makeApi()} initialPage="todo" />)
    expect(await screen.findByTestId('todo-row-todo')).toBeTruthy()
    expect(screen.queryByTestId('todo-row-act')).toBeNull()
    cleanup()
  })

  it('待办页的新建默认就是待办类型', async () => {
    render(<App today={TODAY} initialAnchor={TODAY} api={makeApi()} initialPage="todo" />)
    await screen.findByTestId('todo-row-todo')
    fireEvent.click(screen.getByRole('button', { name: '＋ 新建待办' }))
    // 新版弹窗没有「类型」下拉：待办 = 勾上「只有截止时间」
    expect((screen.getByLabelText(/只有截止时间/) as HTMLInputElement).checked).toBe(true)
    cleanup()
  })
})
