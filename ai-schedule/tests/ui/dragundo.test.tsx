import { describe, expect, it } from '../helpers/expect'
import { cleanup, fireEvent, render, screen, waitFor } from '../helpers/ui'
import type { EventItem } from '../../src/shared/entities'
import type { PreloadApi } from '../../src/shared/ipc'
import { EMPTY_COURSE_API } from '../helpers/apiExtras'
import { WeekView } from '../../src/renderer/components/WeekView'
import { App } from '../../src/renderer/App'
import { parseDate, shiftDateTimeString, snapMinutes } from '../../src/shared/date'

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
    recurrenceId: partial.recurrenceId ?? null,
    createdAt: '',
    updatedAt: '',
  }
}

describe('时间平移与小步吸附', () => {
  it('平移分钟数，跨天自动进位', () => {
    expect(shiftDateTimeString('2026-03-04T19:30', 60)).toBe('2026-03-04T20:30')
    expect(shiftDateTimeString('2026-03-04T19:30', -30)).toBe('2026-03-04T19:00')
    expect(shiftDateTimeString('2026-03-04T23:30', 60)).toBe('2026-03-05T00:30')
    expect(shiftDateTimeString('2026-03-05T00:10', -30)).toBe('2026-03-04T23:40')
  })

  it('吸附到 15 分钟', () => {
    expect(snapMinutes(52)).toBe(45)
    expect(snapMinutes(53)).toBe(60)
    expect(snapMinutes(-8)).toBe(-15)
    expect(snapMinutes(60)).toBe(60)
  })
})

describe('拖拽改时间', () => {
  const event = ev({ id: 'e1', title: '高数', startAt: '2026-03-02T08:00', endAt: '2026-03-02T09:40' })

  function renderWeek(editing: boolean, calls: string[]) {
    render(
      <WeekView
        weekStart={parseDate('2026-03-02')}
        events={[event]}
        today={parseDate('2026-03-04')}
        editing={editing}
        onSelectEvent={() => {}}
        onOpenEditor={() => {}}
        onCreateAt={() => {}}
        onMoveEvent={(id, delta) => calls.push(`move:${id}:${delta}`)}
        onResizeEvent={(id, delta) => calls.push(`resize:${id}:${delta}`)}
      />,
    )
  }

  it('向下拖 60 像素移 75 分钟并吸附到 15 分钟', () => {
    const calls: string[] = []
    renderWeek(true, calls)
    const block = screen.getByTestId('block-e1')
    fireEvent.mouseDown(block, { clientY: 100 })
    fireEvent.mouseMove(window, { clientY: 160 })
    fireEvent.mouseUp(window)
    // 60px / 48px 每小时 = 75 分钟
    expect(calls).toEqual(['move:e1:75'])
    cleanup()
  })

  it('拖动距离小于阈值不算拖动，只是点击', () => {
    const calls: string[] = []
    renderWeek(true, calls)
    const block = screen.getByTestId('block-e1')
    fireEvent.mouseDown(block, { clientY: 100 })
    fireEvent.mouseMove(window, { clientY: 103 })
    fireEvent.mouseUp(window)
    expect(calls).toEqual([])
    cleanup()
  })

  it('浏览态不能拖动', () => {
    const calls: string[] = []
    renderWeek(false, calls)
    const block = screen.getByTestId('block-e1')
    fireEvent.mouseDown(block, { clientY: 100 })
    fireEvent.mouseMove(window, { clientY: 200 })
    fireEvent.mouseUp(window)
    expect(calls).toEqual([])
    expect(screen.queryByTestId('resize-e1')).toBeNull()
    cleanup()
  })

  it('拖下边缘改时长，不影响开始时间', () => {
    const calls: string[] = []
    renderWeek(true, calls)
    const handle = screen.getByTestId('resize-e1')
    fireEvent.mouseDown(handle, { clientY: 100 })
    fireEvent.mouseMove(window, { clientY: 148 })
    fireEvent.mouseUp(window)
    expect(calls).toEqual(['resize:e1:60'])
    cleanup()
  })
})

describe('拖动后可以撤销', () => {
  const ANCHOR = parseDate('2026-03-04')
  const TODAY = parseDate('2026-03-04')

  function makeApi(): { api: PreloadApi; calls: string[]; events: EventItem[] } {
    const events: EventItem[] = [
      ev({ id: 'e1', title: '高数', startAt: '2026-03-02T08:00', endAt: '2026-03-02T09:40' }),
    ]
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
      listEvents: async () => events.map((item) => ({ ...item })),
      createEvent: async (input) => {
        calls.push(`create:${input.title}`)
        const created = ev({ id: `new-${events.length + 1}`, title: input.title, startAt: input.startAt ?? null, endAt: input.endAt ?? null })
        events.push(created)
        return created
      },
      updateEvent: async (id, patch) => {
        calls.push(`update:${id}:${patch.startAt ?? ''}:${patch.endAt ?? ''}`)
        const index = events.findIndex((item) => item.id === id)
        events[index] = { ...events[index], ...patch } as EventItem
        return events[index]
      },
      deleteEvent: async (id) => {
        calls.push(`delete:${id}`)
        const index = events.findIndex((item) => item.id === id)
        if (index >= 0) events.splice(index, 1)
      },
      setEventDone: async (id, done) => {
        calls.push(`done:${id}:${done}`)
        const target = events.find((item) => item.id === id)
        if (target) target.done = done
      },
    }
    return { api, calls, events }
  }

  it('拖动后调用更新接口，并给出可撤销提示', async () => {
    const { api, calls } = makeApi()
    render(<App initialAnchor={ANCHOR} today={TODAY} api={api} toastTimeoutMs={800} />)
    await screen.findByTestId('block-e1')

    fireEvent.click(screen.getByRole('button', { name: '编辑' }))
    const block = screen.getByTestId('block-e1')
    fireEvent.mouseDown(block, { clientY: 100 })
    fireEvent.mouseMove(window, { clientY: 148 })
    fireEvent.mouseUp(window)

    await waitFor(() => {
      expect(calls.some((call) => call.startsWith('update:e1:'))).toBe(true)
    })
    expect(calls[0]).toBe('update:e1:2026-03-02T09:00:2026-03-02T10:40')
    expect(await screen.findByRole('button', { name: '撤销' })).toBeTruthy()
    cleanup()
  })

  it('点撤销把时间改回原样', async () => {
    const { api, calls } = makeApi()
    render(<App initialAnchor={ANCHOR} today={TODAY} api={api} toastTimeoutMs={800} />)
    await screen.findByTestId('block-e1')
    fireEvent.click(screen.getByRole('button', { name: '编辑' }))
    const block = screen.getByTestId('block-e1')
    fireEvent.mouseDown(block, { clientY: 100 })
    fireEvent.mouseMove(window, { clientY: 148 })
    fireEvent.mouseUp(window)

    const undoButton = await screen.findByRole('button', { name: '撤销' })
    fireEvent.click(undoButton)

    await waitFor(() => {
      expect(calls[calls.length - 1]).toBe('update:e1:2026-03-02T08:00:2026-03-02T09:40')
    })
    cleanup()
  })

  it('删除后点撤销会把日程重新创建回来', async () => {
    const { api, calls } = makeApi()
    render(<App initialAnchor={ANCHOR} today={TODAY} api={api} toastTimeoutMs={800} />)
    await screen.findByTestId('block-e1')

    fireEvent.click(screen.getByRole('button', { name: '编辑' }))
    fireEvent.doubleClick(screen.getByTestId('block-e1'))
    fireEvent.click(screen.getByRole('button', { name: '删除' }))

    const undoButton = await screen.findByRole('button', { name: '撤销' })
    expect(calls).toContain('delete:e1')
    fireEvent.click(undoButton)
    await waitFor(() => {
      expect(calls.some((call) => call === 'create:高数')).toBe(true)
    })
    cleanup()
  })

  it('提示条会在超时后自动消失', async () => {
    const { api } = makeApi()
    render(<App initialAnchor={ANCHOR} today={TODAY} api={api} toastTimeoutMs={80} />)
    await screen.findByTestId('block-e1')
    fireEvent.click(screen.getByRole('button', { name: '＋ 新建' }))
    fireEvent.change(screen.getByLabelText(/标题/), { target: { value: '临时' } })
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    expect(await screen.findByText('已保存')).toBeTruthy()

    // 等过自动消失时间（不用 waitFor，避免与 act 环境互相等待）
    await new Promise((resolve) => setTimeout(resolve, 200))
    expect(screen.queryByText('已保存')).toBeNull()
    cleanup()
  })

  it('提示条也能手动关闭', async () => {
    const { api } = makeApi()
    render(<App initialAnchor={ANCHOR} today={TODAY} api={api} toastTimeoutMs={60000} />)
    await screen.findByTestId('block-e1')
    fireEvent.click(screen.getByRole('button', { name: '＋ 新建' }))
    fireEvent.change(screen.getByLabelText(/标题/), { target: { value: '临时' } })
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    expect(await screen.findByText('已保存')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '关闭提示' }))
    expect(screen.queryByText('已保存')).toBeNull()
    cleanup()
  })
})
