import { act } from '@testing-library/react'
import { describe, expect, it } from '../helpers/expect'
import { cleanup, fireEvent, render, screen } from '../helpers/ui'
import { App } from '../../src/renderer/App'
import { EMPTY_COURSE_API } from '../helpers/apiExtras'
import type { Course, CourseInput, EventItem, Period, Semester } from '../../src/shared/entities'
import type { PreloadApi } from '../../src/shared/ipc'
import type { AiEngine, AiEngineEvent, AiRunRequest } from '../../src/renderer/ai/types'

const PERIODS: Period[] = [
  { id: 'p1', name: '第 1 节', startTime: '08:00', endTime: '08:45', orderIndex: 1 },
  { id: 'p2', name: '第 2 节', startTime: '08:55', endTime: '09:40', orderIndex: 2 },
  { id: 'p3', name: '第 3 节', startTime: '10:00', endTime: '10:45', orderIndex: 3 },
  { id: 'p4', name: '第 4 节', startTime: '10:55', endTime: '11:40', orderIndex: 4 },
]

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

interface State {
  courses: Course[]
  calls: string[]
}

function makeApi(state: State, semesters: Semester[] = [SEMESTER]): PreloadApi {
  let counter = 0
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
    listAllEvents: async (): Promise<EventItem[]> => [],
    listEvents: async (): Promise<EventItem[]> => [],
    createEvent: async () => {
      throw new Error('未实现')
    },
    updateEvent: async () => {
      throw new Error('未实现')
    },
    deleteEvent: async () => undefined,
    setEventDone: async () => undefined,
    listSemesters: async () => semesters.map((item) => ({ ...item })),
    listPeriods: async () => PERIODS.map((item) => ({ ...item })),
    listCourses: async () => state.courses.map((item) => ({ ...item })),
    createCourse: async (input: CourseInput) => {
      counter += 1
      const created: Course = {
        id: `c-new-${counter}`,
        semesterId: input.semesterId,
        title: input.title,
        teacher: input.teacher ?? null,
        location: input.location ?? null,
        weekday: input.weekday,
        timeMode: input.timeMode,
        startPeriod: input.startPeriod ?? null,
        endPeriod: input.endPeriod ?? null,
        startTime: input.startTime ?? null,
        endTime: input.endTime ?? null,
        weekFrom: input.weekFrom,
        weekTo: input.weekTo,
        oddEven: input.oddEven,
        color: null,
        createdAt: '',
        updatedAt: '',
      }
      state.courses.push(created)
      state.calls.push(`createCourse:${input.title}:${input.weekday}:${input.startPeriod}`)
      return created
    },
  }
}

function makeEngine(script: AiEngineEvent[]): {
  factory: () => Promise<AiEngine>
  runs: AiRunRequest[]
} {
  const runs: AiRunRequest[] = []
  const engine: AiEngine = {
    async run(request, onEvent) {
      runs.push(request)
      // 事件是异步到达界面层的，用 act 包起来避免 React 的 act 警告
      await act(async () => {
        for (const event of script) {
          if (request.signal.aborted) return
          onEvent(event)
        }
      })
    },
    dispose() {
      /* 测试不需要 */
    },
  }
  return { factory: async () => engine, runs }
}

const TWO_COURSES: AiEngineEvent = {
  type: 'tool-call',
  name: 'add_courses',
  input: {
    courses: [
      { title: '高等数学', weekday: 1, startPeriod: 1, endPeriod: 2, weekFrom: 1, weekTo: 16, location: 'A101' },
      { title: '大学英语', weekday: 3, startPeriod: 3, endPeriod: 4, weekFrom: 1, weekTo: 16 },
    ],
  },
}

function renderCoursePage(options: {
  script?: AiEngineEvent[]
  state?: State
  semesters?: Semester[]
}) {
  const state = options.state ?? { courses: [], calls: [] }
  const engine = makeEngine(options.script ?? [])
  render(
    <App
      api={makeApi(state, options.semesters)}
      initialPage="courseTable"
      today={new Date('2026-03-04T10:00:00')}
      aiEngineFactory={engine.factory}
    />,
  )
  return { state, runs: engine.runs }
}

describe('AI 课程录入入口', () => {
  it('课程表页顶部有入口，展开后能看到输入框与按钮', async () => {
    renderCoursePage({})
    await flush()
    expect(screen.getByTestId('ai-course-entry')).toBeTruthy()
    expect(document.body.textContent).toContain('用 AI 添加课程')

    fireEvent.click(screen.getByTestId('ai-toggle'))
    expect(screen.getByTestId('ai-input')).toBeTruthy()
    expect(screen.getByTestId('ai-pick-image')).toBeTruthy()
    expect(screen.getByTestId('ai-run')).toBeTruthy()
    cleanup()
  })

  it('识别结果先进入待确认列表，确认后才写入课程表', async () => {
    const { state } = renderCoursePage({
      script: [TWO_COURSES, { type: 'done', text: '已识别 2 门课程，请检查' }],
    })
    await flush()

    fireEvent.click(screen.getByTestId('ai-toggle'))
    fireEvent.change(screen.getByTestId('ai-input'), { target: { value: '周一 1-2 节高数，周三 3-4 节英语' } })
    fireEvent.click(screen.getByTestId('ai-run'))
    await flush()

    // 1. 只是草稿，还没有写库
    expect(screen.getAllByTestId('ai-draft-row')).toHaveLength(2)
    expect(state.courses).toHaveLength(0)
    expect(document.body.textContent).toContain('高等数学')
    expect(document.body.textContent).toContain('大学英语')
    expect(document.body.textContent).toContain('已识别 2 门课程')

    // 2. 用户确认后才真正落库
    fireEvent.click(screen.getByTestId('ai-confirm'))
    await flush()

    expect(state.courses).toHaveLength(2)
    expect(state.calls).toContain('createCourse:高等数学:1:1')
    expect(state.calls).toContain('createCourse:大学英语:3:3')
    expect(state.courses[0].semesterId).toBe('sem-1')
    expect(state.courses[0].location).toBe('A101')
    expect(screen.queryAllByTestId('ai-draft-row')).toHaveLength(0)
    cleanup()
  })

  it('缺少字段的课程会标「待确认」', async () => {
    renderCoursePage({
      script: [
        { type: 'tool-call', name: 'add_course', input: { title: '体育' } },
        { type: 'done', text: '' },
      ],
    })
    await flush()
    fireEvent.click(screen.getByTestId('ai-toggle'))
    fireEvent.change(screen.getByTestId('ai-input'), { target: { value: '加一门体育' } })
    fireEvent.click(screen.getByTestId('ai-run'))
    await flush()

    expect(screen.getAllByTestId('ai-draft-row')).toHaveLength(1)
    expect(document.body.textContent).toContain('待确认')
    cleanup()
  })

  it('可以在确认前编辑草稿，改完再入库', async () => {
    const { state } = renderCoursePage({ script: [TWO_COURSES, { type: 'done', text: '' }] })
    await flush()
    fireEvent.click(screen.getByTestId('ai-toggle'))
    fireEvent.change(screen.getByTestId('ai-input'), { target: { value: '识别一下' } })
    fireEvent.click(screen.getByTestId('ai-run'))
    await flush()

    fireEvent.click(screen.getByLabelText('编辑 高等数学'))
    fireEvent.change(screen.getByLabelText('课名'), { target: { value: '高等数学（上）' } })
    fireEvent.click(screen.getByText('保存'))
    await flush()

    expect(document.body.textContent).toContain('高等数学（上）')
    fireEvent.click(screen.getByTestId('ai-confirm'))
    await flush()
    expect(state.calls).toContain('createCourse:高等数学（上）:1:1')
    cleanup()
  })

  it('可以删掉识别错的草稿', async () => {
    renderCoursePage({ script: [TWO_COURSES, { type: 'done', text: '' }] })
    await flush()
    fireEvent.click(screen.getByTestId('ai-toggle'))
    fireEvent.change(screen.getByTestId('ai-input'), { target: { value: '识别一下' } })
    fireEvent.click(screen.getByTestId('ai-run'))
    await flush()

    fireEvent.click(screen.getByLabelText('删除 大学英语'))
    expect(screen.getAllByTestId('ai-draft-row')).toHaveLength(1)
    cleanup()
  })

  it('引擎报错时把原因显示出来', async () => {
    const engine: AiEngine = {
      async run() {
        throw new Error('模型下载失败：网络不可用')
      },
      dispose() {
        /* 测试不需要 */
      },
    }
    render(
      <App
        api={makeApi({ courses: [], calls: [] })}
        initialPage="courseTable"
        today={new Date('2026-03-04T10:00:00')}
        aiEngineFactory={async () => engine}
      />,
    )
    await flush()
    fireEvent.click(screen.getByTestId('ai-toggle'))
    fireEvent.change(screen.getByTestId('ai-input'), { target: { value: '识别一下' } })
    fireEvent.click(screen.getByTestId('ai-run'))
    await flush()

    expect(screen.getByTestId('ai-error').textContent).toContain('模型下载失败')
    cleanup()
  })

  it('没有学期时提示先建学期，识别按钮不可用', async () => {
    renderCoursePage({ semesters: [] })
    await flush()
    fireEvent.click(screen.getByTestId('ai-toggle'))
    fireEvent.change(screen.getByTestId('ai-input'), { target: { value: '识别一下' } })

    const button = screen.getByTestId('ai-run') as HTMLButtonElement
    expect(button.disabled).toBe(true)
    expect(document.body.textContent).toContain('请先在右上角「新建学期」')
    cleanup()
  })

  it('识别请求带上作息表与学期周数（供模型推算节次）', async () => {
    const { runs } = renderCoursePage({ script: [{ type: 'done', text: '' }] })
    await flush()
    fireEvent.click(screen.getByTestId('ai-toggle'))
    fireEvent.change(screen.getByTestId('ai-input'), { target: { value: '识别一下' } })
    fireEvent.click(screen.getByTestId('ai-run'))
    await flush()

    expect(runs).toHaveLength(1)
    expect(runs[0].task).toBe('course')
    expect(runs[0].spec.systemPrompt).toContain('18')
    expect(runs[0].spec.systemPrompt).toContain('08:00-08:45')
    expect(runs[0].spec.userPrompt).toContain('识别一下')
    expect(runs[0].spec.tools.map((tool) => tool.name)).toContain('add_courses')
    cleanup()
  })

  it('课表里已有的课会告诉模型，并要求不要重复添加', async () => {
    const existing: Course = {
      id: 'c-exist',
      semesterId: 'sem-1',
      title: '高等数学',
      teacher: null,
      location: 'A101',
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
    }
    const { runs } = renderCoursePage({
      state: { courses: [existing], calls: [] },
      script: [{ type: 'done', text: '' }],
    })
    await flush()
    fireEvent.click(screen.getByTestId('ai-toggle'))
    fireEvent.change(screen.getByTestId('ai-input'), { target: { value: '识别一下' } })
    fireEvent.click(screen.getByTestId('ai-run'))
    await flush()

    expect(runs[0].spec.userPrompt).toContain('已经存在')
    expect(runs[0].spec.userPrompt).toContain('高等数学')
    expect(runs[0].spec.systemPrompt).toContain('不要再加一遍')
    cleanup()
  })

  it('模型重复给出了已有的课：标「已存在」，确认时跳过', async () => {
    const existing: Course = {
      id: 'c-exist',
      semesterId: 'sem-1',
      title: '高等数学',
      teacher: null,
      location: 'A101',
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
    }
    const { state } = renderCoursePage({
      state: { courses: [existing], calls: [] },
      script: [TWO_COURSES, { type: 'done', text: '' }],
    })
    await flush()
    fireEvent.click(screen.getByTestId('ai-toggle'))
    fireEvent.change(screen.getByTestId('ai-input'), { target: { value: '识别一下' } })
    fireEvent.click(screen.getByTestId('ai-run'))
    await flush()

    // 两条草稿都进来了，但和已有课程撞的那条被标出来
    expect(screen.getAllByTestId('ai-draft-row')).toHaveLength(2)
    expect(screen.getAllByTestId('ai-draft-dup')).toHaveLength(1)
    expect(document.body.textContent).toContain('其中 1 门课表里已有')

    fireEvent.click(screen.getByTestId('ai-confirm'))
    await flush()

    // 只写入了大学英语，高数没有被重复添加
    expect(state.calls).toEqual(['createCourse:大学英语:3:3'])
    expect(state.courses).toHaveLength(2)
    expect(document.body.textContent).toContain('跳过 1 门重复的')
    cleanup()
  })

  it('全都是已有的课时，确认按钮不会重复写库', async () => {
    const existing: Course = {
      id: 'c-exist',
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
    }
    const { state } = renderCoursePage({
      state: { courses: [existing], calls: [] },
      script: [
        {
          type: 'tool-call',
          name: 'add_courses',
          input: {
            courses: [
              { title: '高等数学', weekday: 1, startPeriod: 1, endPeriod: 2, weekFrom: 1, weekTo: 16 },
            ],
          },
        },
        { type: 'done', text: '' },
      ],
    })
    await flush()
    fireEvent.click(screen.getByTestId('ai-toggle'))
    fireEvent.change(screen.getByTestId('ai-input'), { target: { value: '识别一下' } })
    fireEvent.click(screen.getByTestId('ai-run'))
    await flush()

    fireEvent.click(screen.getByTestId('ai-confirm'))
    await flush()

    expect(state.calls).toHaveLength(0)
    expect(screen.getByTestId('ai-error').textContent).toContain('都已经有了')
    cleanup()
  })
})
