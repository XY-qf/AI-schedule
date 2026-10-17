import { describe, expect, it } from '../helpers/expect'
import { cleanup, fireEvent, render, screen } from '../helpers/ui'
import { App } from '../../src/renderer/App'
import { ContextMenu } from '../../src/renderer/components/ContextMenu'
import { parseDate } from '../../src/shared/date'
import type { EventItem } from '../../src/shared/entities'
import type { PreloadApi } from '../../src/shared/ipc'
import { EMPTY_COURSE_API } from '../helpers/apiExtras'

const TODAY = parseDate('2026-03-04')

function makeEvent(partial: Partial<EventItem> & { id: string }): EventItem {
  return {
    id: partial.id,
    title: partial.title ?? '高数',
    category: partial.category ?? 'course',
    kind: partial.kind ?? 'timed',
    startAt: partial.startAt ?? '2026-03-02T08:00',
    endAt: partial.endAt ?? '2026-03-02T09:40',
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

interface Ctx {
  api: PreloadApi
  calls: string[]
  events: EventItem[]
}

function makeApi(seed: EventItem[]): Ctx {
  const calls: string[] = []
  const events = [...seed]
  let counter = 0
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
      counter += 1
      calls.push(`create:${input.title}`)
      const created = makeEvent({
        id: `new-${counter}`,
        title: input.title,
        startAt: input.startAt ?? null,
        endAt: input.endAt ?? null,
      })
      events.push(created)
      return created
    },
    updateEvent: async (id, patch) => {
      calls.push(`update:${id}`)
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

async function openApp(seed: EventItem[] = [makeEvent({ id: 'e1' })]) {
  const ctx = makeApi(seed)
  render(<App today={TODAY} initialAnchor={TODAY} api={ctx.api} />)
  await screen.findByTestId('block-e1')
  return ctx
}

describe('右键菜单组件', () => {
  it('按坐标渲染菜单项并回传选择', () => {
    const picked: string[] = []
    render(
      <ContextMenu
        x={120}
        y={80}
        items={[
          { key: 'edit', label: '编辑' },
          { key: 'delete', label: '删除', danger: true },
        ]}
        onSelect={(key) => picked.push(key)}
        onClose={() => picked.push('close')}
      />,
    )
    const menu = screen.getByRole('menu')
    expect(menu.style.left).toBe('120px')
    expect(menu.style.top).toBe('80px')
    fireEvent.click(screen.getByRole('menuitem', { name: '编辑' }))
    expect(picked).toEqual(['edit', 'close'])
    cleanup()
  })

  it('Esc 关闭', () => {
    const picked: string[] = []
    render(
      <ContextMenu x={0} y={0} items={[{ key: 'a', label: 'A' }]} onSelect={() => {}} onClose={() => picked.push('close')} />,
    )
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(picked).toEqual(['close'])
    cleanup()
  })

  it('点遮罩关闭，点菜单本身不关', () => {
    const picked: string[] = []
    render(
      <ContextMenu x={0} y={0} items={[{ key: 'a', label: 'A' }]} onSelect={() => {}} onClose={() => picked.push('close')} />,
    )
    fireEvent.mouseDown(screen.getByRole('menu'))
    expect(picked).toEqual([])
    fireEvent.mouseDown(document.querySelector('.context-menu-backdrop') as Element)
    expect(picked).toEqual(['close'])
    cleanup()
  })
})

describe('日程右键菜单', () => {
  it('浏览态右键只给查看详情与标记完成', async () => {
    await openApp()
    fireEvent.contextMenu(screen.getByTestId('block-e1'))
    const items = screen.getAllByRole('menuitem').map((item) => item.textContent)
    expect(items).toEqual(['查看详情', '标记完成'])
    cleanup()
  })

  it('编辑态多出编辑、复制与删除', async () => {
    await openApp()
    fireEvent.click(screen.getByRole('button', { name: '编辑' }))
    fireEvent.contextMenu(screen.getByTestId('block-e1'))
    const items = screen.getAllByRole('menuitem').map((item) => item.textContent)
    expect(items).toEqual(['查看详情', '编辑', '复制一份', '标记完成', '删除'])
    cleanup()
  })

  it('点“标记完成”会调用接口', async () => {
    const { calls } = await openApp()
    fireEvent.contextMenu(screen.getByTestId('block-e1'))
    fireEvent.click(screen.getByRole('menuitem', { name: '标记完成' }))
    expect(calls).toContain('done:e1:true')
    cleanup()
  })

  it('点“复制一份”会新建同名副本', async () => {
    const { calls } = await openApp()
    fireEvent.click(screen.getByRole('button', { name: '编辑' }))
    fireEvent.contextMenu(screen.getByTestId('block-e1'))
    fireEvent.click(screen.getByRole('menuitem', { name: '复制一份' }))
    expect(calls).toContain('create:高数（副本）')
    cleanup()
  })

  it('点“查看详情”打开详情面板', async () => {
    await openApp()
    fireEvent.contextMenu(screen.getByTestId('block-e1'))
    fireEvent.click(screen.getByRole('menuitem', { name: '查看详情' }))
    expect(screen.getByTestId('detail-panel')).toBeTruthy()
    cleanup()
  })

  it('点“编辑”打开编辑弹窗', async () => {
    await openApp()
    fireEvent.click(screen.getByRole('button', { name: '编辑' }))
    fireEvent.contextMenu(screen.getByTestId('block-e1'))
    fireEvent.click(screen.getByRole('menuitem', { name: '编辑' }))
    expect(screen.getByRole('dialog').textContent).toContain('编辑日程')
    cleanup()
  })

  it('课程块不出现编辑、复制与删除', async () => {
    // 只通过课程表提供这节课，避免和手写日程重复
    const { api } = makeApi([])
    const withCourse: PreloadApi = {
      ...api,
      listSemesters: async () => [
        {
          id: 'sem-1',
          name: '2026 春季',
          startDate: '2026-03-02',
          weeks: 18,
          isCurrent: true,
          createdAt: '',
          updatedAt: '',
        },
      ],
      listPeriods: async () => [
        { id: 'p1', name: '第 1 节', startTime: '08:00', endTime: '08:45', orderIndex: 1 },
        { id: 'p2', name: '第 2 节', startTime: '08:55', endTime: '09:40', orderIndex: 2 },
      ],
      listCourses: async () => [
        {
          id: 'c1',
          semesterId: 'sem-1',
          title: '高等数学',
          teacher: null,
          location: null,
          weekday: 1,
          timeMode: 'period',
          startPeriod: 1,
          endPeriod: 2,
          startTime: null,
          endTime: null,
          weekFrom: 1,
          weekTo: 16,
          oddEven: 'all',
          color: null,
          createdAt: '',
          updatedAt: '',
        },
      ],
    }
    render(<App today={TODAY} initialAnchor={TODAY} api={withCourse} />)
    await screen.findByTestId('block-course:c1:2026-03-02')
    fireEvent.click(screen.getByRole('button', { name: '编辑' }))
    fireEvent.contextMenu(screen.getByTestId('block-course:c1:2026-03-02'))
    const items = screen.getAllByRole('menuitem').map((item) => item.textContent)
    expect(items).toEqual(['查看详情', '标记完成'])
    cleanup()
  })
})
