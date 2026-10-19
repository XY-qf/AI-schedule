import { describe, expect, it } from '../helpers/expect'
import { cleanup, fireEvent, render, screen } from '../helpers/ui'
import { App } from '../../src/renderer/App'
import { AiStatusBadge } from '../../src/renderer/components/AiStatusBadge'
import { resolveAiConfig } from '../../src/renderer/ai/config'
import { EMPTY_COURSE_API } from '../helpers/apiExtras'
import type { Course, EventInput, EventItem, Semester } from '../../src/shared/entities'
import type { PreloadApi } from '../../src/shared/ipc'
import type { AiEngine, AiEngineEvent, AiRunRequest, AiStatus } from '../../src/renderer/ai/types'

const SEMESTER: Semester = {
  id: 'sem-1',
  name: '2026 春季',
  startDate: '2026-03-02',
  weeks: 18,
  isCurrent: true,
  createdAt: '',
  updatedAt: '',
}

async function flush(ms = 50): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms))
}

function makeApi(state: { events: EventItem[]; calls: string[] }): PreloadApi {
  return {
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
    listAllEvents: async () => state.events.map((item) => ({ ...item })),
    listEvents: async () => state.events.map((item) => ({ ...item })),
    createEvent: async (input: EventInput) => {
      const created: EventItem = {
        id: `e-${state.events.length + 1}`,
        title: input.title,
        category: input.category,
        kind: input.kind,
        startAt: input.startAt ?? null,
        endAt: input.endAt ?? null,
        dueAt: input.dueAt ?? null,
        location: input.location ?? null,
        people: input.people ?? null,
        note: input.note ?? null,
        done: false,
        recurrenceId: null,
        createdAt: '',
        updatedAt: '',
      }
      state.events.push(created)
      state.calls.push(`createEvent:${input.title}:${input.startAt ?? input.dueAt}`)
      return created
    },
    updateEvent: async () => {
      throw new Error('未实现')
    },
    deleteEvent: async () => undefined,
    setEventDone: async () => undefined,
    listSemesters: async () => [{ ...SEMESTER }],
    listCourses: async (): Promise<Course[]> => [],
    createRecurrence: async (input) => {
      state.calls.push(`createRecurrence:${input.freq}:${(input.byWeekdays ?? []).join('')}`)
      return { id: 'rec-1', ...input } as never
    },
  }
}

function makeEngine(script: AiEngineEvent[]): { factory: () => Promise<AiEngine>; runs: AiRunRequest[] } {
  const runs: AiRunRequest[] = []
  const engine: AiEngine = {
    async run(request, onEvent) {
      runs.push(request)
      for (const event of script) {
        if (request.signal.aborted) return
        onEvent(event)
      }
    },
    dispose() {
      /* 测试不需要 */
    },
  }
  return { factory: async () => engine, runs }
}

const TWO_EVENTS: AiEngineEvent = {
  type: 'tool-call',
  name: 'add_events',
  input: {
    events: [
      { title: '组会', category: 'activity', startAt: '2026-03-05 14:00', endAt: '2026-03-05 15:30' },
      { title: '交实验报告', kind: 'todo', dueAt: '2026-03-06' },
    ],
  },
}

describe('日历页的 AI 录入入口', () => {
  it('在新建按钮旁边有入口，识别结果确认后才写进日历', async () => {
    const state = { events: [] as EventItem[], calls: [] as string[] }
    const engine = makeEngine([TWO_EVENTS, { type: 'done', text: '已记录 2 条日程' }])
    render(
      <App
        api={makeApi(state)}
        today={new Date('2026-03-04T10:00:00')}
        aiEngineFactory={engine.factory}
      />,
    )
    await flush()

    expect(screen.getByTestId('ai-event-entry')).toBeTruthy()
    expect(document.body.textContent).toContain('用 AI 记日程')

    fireEvent.click(screen.getByTestId('ai-event-toggle'))
    fireEvent.change(screen.getByTestId('ai-event-input'), {
      target: { value: '明天下午 3 点和导师开会；周五前交实验报告' },
    })
    fireEvent.click(screen.getByTestId('ai-event-run'))
    await flush()

    // 只是草稿
    expect(screen.getAllByTestId('ai-event-draft-row')).toHaveLength(2)
    expect(state.events).toHaveLength(0)
    expect(document.body.textContent).toContain('组会')
    expect(document.body.textContent).toContain('交实验报告')

    fireEvent.click(screen.getByTestId('ai-event-confirm'))
    await flush()

    expect(state.events).toHaveLength(2)
    expect(state.calls).toContain('createEvent:组会:2026-03-05T14:00')
    expect(state.calls).toContain('createEvent:交实验报告:2026-03-06')
    expect(screen.queryAllByTestId('ai-event-draft-row')).toHaveLength(0)
    cleanup()
  })

  it('请求带上今天的日期，任务类型是 event', async () => {
    const state = { events: [] as EventItem[], calls: [] as string[] }
    const engine = makeEngine([{ type: 'done', text: '' }])
    render(
      <App api={makeApi(state)} today={new Date('2026-03-04T10:00:00')} aiEngineFactory={engine.factory} />,
    )
    await flush()
    fireEvent.click(screen.getByTestId('ai-event-toggle'))
    fireEvent.change(screen.getByTestId('ai-event-input'), { target: { value: '明天开会' } })
    fireEvent.click(screen.getByTestId('ai-event-run'))
    await flush()

    expect(engine.runs).toHaveLength(1)
    expect(engine.runs[0].task).toBe('event')
    expect(engine.runs[0].spec.systemPrompt).toContain('2026-03-04')
    expect(engine.runs[0].spec.tools.map((tool) => tool.name)).toContain('add_events')
    expect(engine.runs[0].spec.userPrompt).toContain('明天开会')
    cleanup()
  })

  it('带重复的日程：先建规则再建日程，列表上显示重复', async () => {
    const state = { events: [] as EventItem[], calls: [] as string[] }
    const engine = makeEngine([
      {
        type: 'tool-call',
        name: 'add_events',
        input: {
          events: [
            {
              title: '组会',
              category: 'activity',
              kind: 'timed',
              startAt: '2026-03-05 14:00',
              endAt: '2026-03-05 15:30',
              repeat: { freq: 'weekly', byWeekdays: [4], untilDate: '2026-06-30' },
            },
          ],
        },
      },
      { type: 'done', text: '已记录 1 条日程' },
    ])
    render(
      <App api={makeApi(state)} today={new Date('2026-03-04T10:00:00')} aiEngineFactory={engine.factory} />,
    )
    await flush()
    fireEvent.click(screen.getByTestId('ai-event-toggle'))
    fireEvent.change(screen.getByTestId('ai-event-input'), {
      target: { value: '每周四下午两点组会，到 6 月底' },
    })
    fireEvent.click(screen.getByTestId('ai-event-run'))
    await flush()

    // 待确认列表里能看到重复规则
    expect(screen.getByTestId('ai-event-repeat').textContent).toContain('每周')
    expect(screen.getByTestId('ai-event-repeat').textContent).toContain('周四')
    expect(state.calls).toHaveLength(0)

    fireEvent.click(screen.getByTestId('ai-event-confirm'))
    await flush()

    // 先建规则（每周、周四），再建日程
    expect(state.calls[0]).toBe('createRecurrence:weekly:4')
    expect(state.calls[1]).toContain('createEvent:组会')
    expect(state.events).toHaveLength(1)
    cleanup()
  })

  it('草稿可以编辑后再入库', async () => {
    const state = { events: [] as EventItem[], calls: [] as string[] }
    const engine = makeEngine([TWO_EVENTS, { type: 'done', text: '' }])
    render(
      <App api={makeApi(state)} today={new Date('2026-03-04T10:00:00')} aiEngineFactory={engine.factory} />,
    )
    await flush()
    fireEvent.click(screen.getByTestId('ai-event-toggle'))
    fireEvent.change(screen.getByTestId('ai-event-input'), { target: { value: '识别一下' } })
    fireEvent.click(screen.getByTestId('ai-event-run'))
    await flush()

    fireEvent.click(screen.getByLabelText('编辑 组会'))
    fireEvent.change(screen.getByLabelText('标题'), { target: { value: '组会（改）' } })
    fireEvent.click(screen.getByText('保存'))
    await flush()

    expect(document.body.textContent).toContain('组会（改）')
    cleanup()
  })
})

describe('AI 状态窗', () => {
  const config = resolveAiConfig({})

  function status(overrides: Partial<AiStatus>): AiStatus {
    return {
      phase: 'idle',
      message: 'AI 待命',
      progress: null,
      task: null,
      connected: false,
      ...overrides,
    }
  }

  it('待命 / 连接中 / 生成中 / 运行正常 / 出错 / 已关闭', () => {
    const view = (value: AiStatus, enabled = true) => {
      cleanup()
      render(
        <AiStatusBadge
          status={value}
          config={{ ...config, enabled }}
          onAbort={() => undefined}
        />,
      )
      return screen.getByTestId('ai-status-label').textContent ?? ''
    }

    expect(view(status({}))).toContain('待命')
    expect(view(status({ phase: 'connecting', message: '正在请求模型…' }))).toContain('连接中')
    expect(view(status({ phase: 'generating', message: '正在生成…' }))).toContain('生成中')
    expect(view(status({ connected: true }))).toContain('运行正常')
    expect(view(status({ phase: 'error', message: '识别失败：x' }))).toContain('出错')
    expect(view(status({}), false)).toContain('已关闭')
    cleanup()
  })

  it('展开后能看到模型、接口与 Key 状态，并能停止', () => {
    let aborted = 0
    render(
      <AiStatusBadge
        status={status({ phase: 'connecting', message: '正在请求模型…' })}
        config={{ ...config, apiKey: 'sk-1234567890abcd' }}
        onAbort={() => {
          aborted += 1
        }}
      />,
    )
    fireEvent.click(screen.getByTestId('ai-status-toggle'))
    const detail = screen.getByTestId('ai-status-detail')
    expect(detail.textContent).toContain('deepseek-chat')
    expect(detail.textContent).toContain('api.deepseek.com')
    expect(detail.textContent).toContain('sk-1****abcd')
    expect(detail.textContent).toContain('思考')
    // 开思考时官方会换成 reasoner，展开卡片里能看到
    expect(detail.textContent).toContain('deepseek-reasoner')

    fireEvent.click(screen.getByTestId('ai-status-abort'))
    expect(aborted).toBe(1)
    cleanup()
  })

  it('没填 Key 时给提示', () => {
    render(
      <AiStatusBadge
        status={status({})}
        config={{ ...config, apiKey: '' }}
        onAbort={() => undefined}
      />,
    )
    fireEvent.click(screen.getByTestId('ai-status-toggle'))
    expect(screen.getByTestId('ai-status-nokey').textContent).toContain('API Key')
    cleanup()
  })

  it('展开卡片里不出现 GPU 兼容模式之类的无关提示', () => {
    render(<AiStatusBadge status={status({})} config={config} onAbort={() => undefined} />)
    fireEvent.click(screen.getByTestId('ai-status-toggle'))
    expect(document.body.textContent).not.toContain('兼容模式')
    cleanup()
  })

  it('主界面右下角一直有状态窗', async () => {
    const engine = makeEngine([{ type: 'done', text: '' }])
    render(<App api={makeApi({ events: [], calls: [] })} today={new Date('2026-03-04T10:00:00')} aiEngineFactory={engine.factory} />)
    await flush()
    expect(screen.getByTestId('ai-status-badge')).toBeTruthy()
    expect(screen.getByTestId('ai-status-label').textContent).toContain('待命')
    cleanup()
  })
})
