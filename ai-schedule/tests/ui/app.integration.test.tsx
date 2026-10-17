import { describe, expect, it } from '../helpers/expect'
import { cleanup, fireEvent, render, screen } from '../helpers/ui'
import { App } from '../../src/renderer/App'
import { DetailPanel } from '../../src/renderer/components/DetailPanel'
import { parseDate } from '../../src/shared/date'
import type { EventInput, EventItem } from '../../src/shared/entities'
import type { PreloadApi } from '../../src/shared/ipc'
import { EMPTY_COURSE_API } from '../helpers/apiExtras'

function makeEvent(partial: Partial<EventItem> & { id: string }): EventItem {
  return {
    id: partial.id,
    title: partial.title ?? '事项',
    category: partial.category ?? 'activity',
    kind: partial.kind ?? 'timed',
    startAt: partial.startAt ?? null,
    endAt: partial.endAt ?? null,
    dueAt: partial.dueAt ?? null,
    location: partial.location ?? null,
    people: partial.people ?? null,
    note: partial.note ?? null,
    done: partial.done ?? false,
    recurrenceId: null,
    createdAt: '',
    updatedAt: '',
  }
}

interface FakeState {
  events: EventItem[]
  calls: string[]
}

function makeApi(initial: EventItem[] = []): { api: PreloadApi; state: FakeState } {
  // 首次无数据时界面会显示引导页而不是周视图，这里补一条示例日程保证测的是日历本身
  const seed: EventItem[] =
    initial.length > 0
      ? []
      : [makeEvent({ id: 'seed', title: '示例', startAt: '2026-03-02T07:00', endAt: '2026-03-02T07:30' })]
  const state: FakeState = { events: [...initial, ...seed], calls: [] }
  let counter = 0

  const api: PreloadApi = {
    ...EMPTY_COURSE_API,
    getStatus: async () => ({
      dataFilePath: 'x',
      lastBackupAt: null,
      backupFailed: false,
      eventCount: state.events.length,
      dataDirMissing: false,
      dataDirMessage: null,
    }),
    rememberLocation: async () => undefined,
    openDataFolder: async () => undefined,
    getPlatform: async () => ({ electron: '', node: '' }),
    listEvents: async (start, end) => {
      state.calls.push(`list:${start}:${end}`)
      return state.events.filter((event) => {
        const day = (event.startAt ?? event.dueAt ?? '').slice(0, 10)
        return day >= start && day <= end
      })
    },
    createEvent: async (input: EventInput) => {
      counter += 1
      state.calls.push(`create:${input.title}`)
      const created = makeEvent({
        id: `new-${counter}`,
        ...input,
        startAt: input.startAt ?? null,
        endAt: input.endAt ?? null,
        dueAt: input.dueAt ?? null,
      })
      state.events.push(created)
      return created
    },
    updateEvent: async (id, patch) => {
      state.calls.push(`update:${id}`)
      const index = state.events.findIndex((event) => event.id === id)
      const merged = { ...state.events[index], ...patch } as EventItem
      state.events[index] = merged
      return merged
    },
    deleteEvent: async (id) => {
      state.calls.push(`delete:${id}`)
      state.events = state.events.filter((event) => event.id !== id)
    },
    setEventDone: async (id, done) => {
      state.calls.push(`done:${id}:${done}`)
      const target = state.events.find((event) => event.id === id)
      if (target) target.done = done
    },
  }
  return { api, state }
}

const ANCHOR = parseDate('2026-03-04')
const TODAY = parseDate('2026-03-04')

async function renderApp(events: EventItem[] = []) {
  const { api, state } = makeApi(events)
  render(<App initialAnchor={ANCHOR} today={TODAY} api={api} />)
  // 等首次加载完成
  await screen.findByTestId('week-allday')
  return state
}

describe('日历页 · 数据加载', () => {
  it('按当前周的范围请求日程', async () => {
    const state = await renderApp()
    expect(state.calls[0]).toBe('list:2026-03-02:2026-03-08')
    cleanup()
  })

  it('加载到的日程显示在周视图里', async () => {
    await renderApp([makeEvent({ id: 'e1', title: '高数', startAt: '2026-03-02T08:00', endAt: '2026-03-02T09:40' })])
    expect(await screen.findByTestId('block-e1')).toBeTruthy()
    cleanup()
  })
})

describe('日历页 · 详情与编辑', () => {
  it('浏览态点日程块打开只读详情，双击也只会打开详情', async () => {
    await renderApp([makeEvent({ id: 'e1', title: '高数', startAt: '2026-03-02T08:00', endAt: '2026-03-02T09:40' })])
    fireEvent.click(screen.getByTestId('block-e1'))
    expect(screen.getByTestId('detail-panel').textContent).toContain('高数')
    expect(screen.queryByRole('dialog')).toBeNull()

    fireEvent.doubleClick(screen.getByTestId('block-e1'))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.getByTestId('detail-panel')).toBeTruthy()
    cleanup()
  })

  it('编辑态双击日程块打开编辑弹窗，字段已预填', async () => {
    await renderApp([makeEvent({ id: 'e1', title: '高数', startAt: '2026-03-02T08:00', endAt: '2026-03-02T09:40' })])
    fireEvent.click(screen.getByRole('button', { name: '编辑' }))
    fireEvent.doubleClick(screen.getByTestId('block-e1'))
    const dialog = screen.getByRole('dialog')
    expect(dialog.textContent).toContain('编辑日程')
    expect((screen.getByLabelText(/标题/) as HTMLInputElement).value).toBe('高数')
    cleanup()
  })

  it('双击空白格子打开新建窗口，并预填日期与小时', async () => {
    await renderApp()
    fireEvent.doubleClick(screen.getByTestId('slot-2026-03-06-14'))
    expect(screen.getByRole('dialog').textContent).toContain('新建日程')
    expect((screen.getByLabelText('日期') as HTMLInputElement).value).toBe('2026-03-06')
    expect((screen.getByLabelText('开始时间') as HTMLInputElement).value).toBe('14:00')
    expect((screen.getByLabelText('结束时间') as HTMLInputElement).value).toBe('15:00')
    cleanup()
  })

  it('保存新日程会写入并刷新列表', async () => {
    const state = await renderApp()
    fireEvent.doubleClick(screen.getByTestId('slot-2026-03-06-14'))
    fireEvent.change(screen.getByLabelText(/标题/), { target: { value: '篮球训练' } })
    fireEvent.click(screen.getByRole('button', { name: '保存' }))

    expect(await screen.findByText('已保存')).toBeTruthy()
    expect(state.calls).toContain('create:篮球训练')
    expect(await screen.findByTestId('block-new-1')).toBeTruthy()
    expect(screen.queryByRole('dialog')).toBeNull()
    cleanup()
  })

  it('标记完成会调用接口并刷新', async () => {
    const state = await renderApp([makeEvent({ id: 'e1', title: '高数', startAt: '2026-03-02T08:00', endAt: '2026-03-02T09:40' })])
    fireEvent.click(screen.getByTestId('block-e1'))
    fireEvent.click(screen.getByRole('button', { name: '标记完成' }))
    expect(state.calls).toContain('done:e1:true')
    cleanup()
  })

  it('编辑态下可删除日程', async () => {
    const state = await renderApp([makeEvent({ id: 'e1', title: '高数', startAt: '2026-03-02T08:00', endAt: '2026-03-02T09:40' })])
    fireEvent.click(screen.getByRole('button', { name: '编辑' }))
    fireEvent.doubleClick(screen.getByTestId('block-e1'))
    fireEvent.click(screen.getByRole('button', { name: '删除' }))
    expect(await screen.findByText('已删除')).toBeTruthy()
    expect(state.calls).toContain('delete:e1')
    cleanup()
  })

  it('顶部“＋ 新建”也能打开新建窗口', async () => {
    await renderApp()
    fireEvent.click(screen.getByRole('button', { name: '＋ 新建' }))
    expect(screen.getByRole('dialog').textContent).toContain('新建日程')
    cleanup()
  })
})

describe('详情面板', () => {
  const event = makeEvent({
    id: 'd1',
    title: '社团例会',
    category: 'activity',
    startAt: '2026-03-05T14:00',
    endAt: '2026-03-05T16:00',
    location: '线上',
    people: '李同学',
    note: '带会议记录',
  })

  function renderPanel(overrides: Partial<Parameters<typeof DetailPanel>[0]> = {}) {
    const calls: string[] = []
    render(
      <DetailPanel
        event={event}
        editing={false}
        onClose={() => calls.push('close')}
        onEdit={() => calls.push('edit')}
        onToggleDone={() => calls.push('toggle')}
        onDelete={() => calls.push('delete')}
        {...overrides}
      />,
    )
    return calls
  }

  it('显示标题、类别、时间、地点、参与人、备注', () => {
    renderPanel()
    const text = screen.getByTestId('detail-panel').textContent ?? ''
    expect(text).toContain('社团例会')
    expect(text).toContain('课外活动')
    expect(text).toContain('14:00')
    expect(text).toContain('线上')
    expect(text).toContain('李同学')
    expect(text).toContain('带会议记录')
    expect(text).toContain('未完成')
    cleanup()
  })

  it('浏览态只给“标记完成”，并提示需要进入编辑态', () => {
    renderPanel()
    expect(screen.queryByRole('button', { name: '编辑' })).toBeNull()
    expect(screen.queryByRole('button', { name: '删除' })).toBeNull()
    expect(document.body.textContent).toContain('点顶部「编辑」后可修改或删除')
    cleanup()
  })

  it('编辑态给出编辑、完成、删除三个操作', () => {
    const calls = renderPanel({ editing: true })
    fireEvent.click(screen.getByRole('button', { name: '编辑' }))
    fireEvent.click(screen.getByRole('button', { name: '标记完成' }))
    fireEvent.click(screen.getByRole('button', { name: '删除' }))
    expect(calls).toEqual(['edit', 'toggle', 'delete'])
    cleanup()
  })

  it('已完成时按钮变成“取消完成”', () => {
    renderPanel({ event: { ...event, done: true } })
    expect(screen.getByRole('button', { name: '取消完成' })).toBeTruthy()
    expect(screen.getByTestId('detail-panel').textContent).toContain('已完成')
    cleanup()
  })

  it('关闭按钮回传', () => {
    const calls = renderPanel()
    fireEvent.click(screen.getByRole('button', { name: '关闭详情' }))
    expect(calls).toEqual(['close'])
    cleanup()
  })

  it('没有选中日程时不渲染', () => {
    render(
      <DetailPanel event={null} editing={false} onClose={() => {}} onEdit={() => {}} onToggleDone={() => {}} onDelete={() => {}} />,
    )
    expect(screen.queryByTestId('detail-panel')).toBeNull()
    cleanup()
  })

  it('待办显示截止日期', () => {
    render(
      <DetailPanel
        event={makeEvent({ id: 't', title: '交报告', kind: 'todo', dueAt: '2026-03-08T17:00' })}
        editing={false}
        onClose={() => {}}
        onEdit={() => {}}
        onToggleDone={() => {}}
        onDelete={() => {}}
      />,
    )
    expect(screen.getByTestId('detail-panel').textContent).toContain('截止')
    expect(screen.getByTestId('detail-panel').textContent).toContain('17:00')
    cleanup()
  })
})
