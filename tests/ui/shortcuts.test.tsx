import { describe, expect, it } from '../helpers/expect'
import { cleanup, fireEvent, render, screen } from '../helpers/ui'
import { App } from '../../src/renderer/App'
import { parseDate } from '../../src/shared/date'
import type { EventItem } from '../../src/shared/entities'
import type { PreloadApi } from '../../src/shared/ipc'
import { EMPTY_COURSE_API } from '../helpers/apiExtras'

function makeApi(): PreloadApi {
  // 有数据才不是首次引导页，快捷键才作用在日历上
  const events: EventItem[] = [
    {
      id: 'seed',
      title: '示例',
      category: 'activity',
      kind: 'timed',
      startAt: '2026-03-02T07:00',
      endAt: '2026-03-02T07:30',
      dueAt: null,
      location: null,
      people: null,
      note: null,
      done: false,
      recurrenceId: null,
      createdAt: '',
      updatedAt: '',
    },
  ]
  return {
    ...EMPTY_COURSE_API,
    getStatus: async () => ({
      dataFilePath: 'x',
      lastBackupAt: null,
      backupFailed: false,
      eventCount: 0,
      dataDirMissing: false,
      dataDirMessage: null,
    }),
    rememberLocation: async () => undefined,
    openDataFolder: async () => undefined,
    getPlatform: async () => ({ electron: '', node: '' }),
    listAllEvents: async () => events,
    listEvents: async () => events,
    createEvent: async (input) => {
      const created: EventItem = {
        id: `new-${events.length + 1}`,
        title: input.title,
        category: input.category,
        kind: input.kind,
        startAt: input.startAt ?? null,
        endAt: input.endAt ?? null,
        dueAt: input.dueAt ?? null,
        location: null,
        people: null,
        note: null,
        done: false,
        recurrenceId: null,
        createdAt: '',
        updatedAt: '',
      }
      events.push(created)
      return created
    },
    updateEvent: async () => {
      throw new Error('未实现')
    },
    deleteEvent: async () => undefined,
    setEventDone: async () => undefined,
  }
}

const ANCHOR = parseDate('2026-03-04')
const TODAY = parseDate('2026-03-04')

async function renderApp() {
  render(<App initialAnchor={ANCHOR} today={TODAY} api={makeApi()} />)
  await screen.findByTestId('week-allday')
}

function title(): string {
  return screen.getByTestId('toolbar-title').textContent ?? ''
}

describe('键盘快捷键', () => {
  it('左右方向键按周翻页', async () => {
    await renderApp()
    expect(title()).toBe('2026年3月 第2周')
    fireEvent.keyDown(window, { key: 'ArrowRight' })
    expect(title()).toBe('2026年3月 第3周')
    fireEvent.keyDown(window, { key: 'ArrowLeft' })
    expect(title()).toBe('2026年3月 第2周')
    // 再往前一周是 2 月 25 日，属于 2 月第 5 周
    fireEvent.keyDown(window, { key: 'ArrowLeft' })
    expect(title()).toBe('2026年2月 第5周')
    cleanup()
  })

  it('T 键回到今天', async () => {
    await renderApp()
    fireEvent.keyDown(window, { key: 'ArrowRight' })
    expect(title()).not.toBe('2026年3月 第2周')
    fireEvent.keyDown(window, { key: 't' })
    // 回到真实今天所在周（2026-10-17 附近），只验证不再是刚才那一周
    expect(screen.getByTestId('toolbar-title').textContent).not.toBe('2026年3月 第3周')
    cleanup()
  })

  it('Ctrl+N 打开新建窗口', async () => {
    await renderApp()
    fireEvent.keyDown(window, { key: 'n', ctrlKey: true })
    expect(screen.getByRole('dialog').textContent).toContain('新建日程')
    cleanup()
  })

  it('Esc 关闭弹窗', async () => {
    await renderApp()
    fireEvent.keyDown(window, { key: 'n', ctrlKey: true })
    expect(screen.getByRole('dialog')).toBeTruthy()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
    cleanup()
  })

  it('在输入框里打字不会触发翻页或新建', async () => {
    await renderApp()
    fireEvent.keyDown(window, { key: 'n', ctrlKey: true })
    const input = screen.getByLabelText(/标题/) as HTMLInputElement
    fireEvent.keyDown(input, { key: 'ArrowRight' })
    fireEvent.keyDown(input, { key: 't' })
    expect(title()).toBe('2026年3月 第2周')
    expect(screen.getByRole('dialog')).toBeTruthy()
    cleanup()
  })
})
