import { describe, expect, it } from '../helpers/expect'
import { cleanup, fireEvent, render, screen } from '../helpers/ui'
import { App } from '../../src/renderer/App'
import { EventDialog } from '../../src/renderer/components/EventDialog'
import { parseDate } from '../../src/shared/date'
import type { EventInput, EventItem } from '../../src/shared/entities'
import type { RecRule, SeriesException } from '../../src/shared/recurrence'
import type { PreloadApi } from '../../src/shared/ipc'
import { EMPTY_COURSE_API } from '../helpers/apiExtras'
import type { RepeatPayload } from '../../src/renderer/components/EventDialog'

const TODAY = parseDate('2026-03-04')

function makeEvent(partial: Partial<EventItem> & { id: string }): EventItem {
  return {
    id: partial.id,
    title: partial.title ?? '篮球训练',
    category: partial.category ?? 'activity',
    kind: partial.kind ?? 'timed',
    startAt: partial.startAt ?? '2026-03-04T19:30',
    endAt: partial.endAt ?? '2026-03-04T21:00',
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

const RULE: RecRule = {
  id: 'r1',
  freq: 'weekly',
  intervalValue: null,
  intervalUnit: null,
  byWeekdays: null,
  untilDate: null,
  maxCount: null,
}

interface Ctx {
  api: PreloadApi
  calls: string[]
  rules: RecRule[]
  exceptions: SeriesException[]
  events: EventItem[]
}

function makeApi(initialEvents: EventItem[], initialRules: RecRule[] = []): Ctx {
  const calls: string[] = []
  const events = [...initialEvents]
  const rules = [...initialRules]
  const exceptions: SeriesException[] = []
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
    createEvent: async (input: EventInput) => {
      counter += 1
      calls.push(`create:${input.title}:${input.recurrenceId ?? 'none'}`)
      const created = makeEvent({
        id: `new-${counter}`,
        title: input.title,
        startAt: input.startAt ?? null,
        endAt: input.endAt ?? null,
        recurrenceId: input.recurrenceId ?? null,
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
    setEventDone: async () => undefined,
    listRecurrences: async () => rules.map((rule) => ({ ...rule })),
    createRecurrence: async (input) => {
      counter += 1
      calls.push(`rule-create:${input.freq}`)
      const rule: RecRule = {
        id: `r-new-${counter}`,
        freq: input.freq,
        intervalValue: input.intervalValue ?? null,
        intervalUnit: input.intervalUnit ?? null,
        byWeekdays: input.byWeekdays ?? null,
        untilDate: input.untilDate ?? null,
        maxCount: input.maxCount ?? null,
      }
      rules.push(rule)
      return rule
    },
    updateRecurrence: async (id, patch) => {
      calls.push(`rule-update:${id}`)
      const index = rules.findIndex((rule) => rule.id === id)
      rules[index] = { ...rules[index], ...patch } as RecRule
      return rules[index]
    },
    deleteRecurrence: async (id) => {
      calls.push(`rule-delete:${id}`)
      const index = rules.findIndex((rule) => rule.id === id)
      if (index >= 0) rules.splice(index, 1)
    },
    listEventExceptions: async () => exceptions.map((item) => ({ ...item })),
    upsertEventException: async (input) => {
      calls.push(`exception:${input.action}:${input.originalDate}`)
      const record: SeriesException = {
        id: `x-${exceptions.length + 1}`,
        seriesId: input.seriesId,
        originalDate: input.originalDate,
        action: input.action,
        startAt: input.startAt ?? null,
        endAt: input.endAt ?? null,
        title: input.title ?? null,
        location: input.location ?? null,
        people: input.people ?? null,
        note: input.note ?? null,
        done: input.done ?? null,
      }
      exceptions.push(record)
      return record
    },
    deleteEventException: async () => undefined,
  }
  return { api, calls, rules, exceptions, events }
}

describe('新建弹窗里的重复设置', () => {
  function renderDialog(props: Partial<Parameters<typeof EventDialog>[0]> = {}) {
    const saved: Array<{ input: EventInput; repeat: RepeatPayload | null }> = []
    render(
      <EventDialog
        open
        mode="create"
        defaults={{ date: '2026-03-04', startTime: '19:30', category: 'activity' }}
        siblingEvents={[]}
        onSave={(input, repeat) => saved.push({ input, repeat })}
        onClose={() => {}}
        {...props}
      />,
    )
    return saved
  }

  it('默认不重复，也不显示结束条件', () => {
    renderDialog()
    expect((screen.getByLabelText('重复') as HTMLSelectElement).value).toBe('none')
    expect(screen.queryByLabelText('重复到（可空）')).toBeNull()
    cleanup()
  })

  it('选了每周才出现结束条件', () => {
    renderDialog()
    fireEvent.change(screen.getByLabelText('重复'), { target: { value: 'weekly' } })
    expect(screen.getByLabelText('重复到（可空）')).toBeTruthy()
    expect(screen.getByLabelText('共几次（可空）')).toBeTruthy()
    cleanup()
  })

  it('保存时把重复规则一起交出去', () => {
    const saved = renderDialog()
    fireEvent.change(screen.getByLabelText(/标题/), { target: { value: '篮球训练' } })
    fireEvent.change(screen.getByLabelText('重复'), { target: { value: 'weekly' } })
    fireEvent.change(screen.getByLabelText('重复到（可空）'), { target: { value: '2026-06-30' } })
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    expect(saved.length).toBe(1)
    expect(saved[0].repeat).toEqual({ freq: 'weekly', untilDate: '2026-06-30', maxCount: null })
    cleanup()
  })

  it('不重复时交出去的是 null', () => {
    const saved = renderDialog()
    fireEvent.change(screen.getByLabelText(/标题/), { target: { value: '一次性的' } })
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    expect(saved[0].repeat).toBeNull()
    cleanup()
  })

  it('编辑已有重复日程时回填规则', () => {
    renderDialog({
      mode: 'edit',
      initial: makeEvent({ id: 'm1', recurrenceId: 'r1' }),
      initialRepeat: { freq: 'biweekly', untilDate: '2026-05-01', maxCount: null },
    })
    expect((screen.getByLabelText('重复') as HTMLSelectElement).value).toBe('biweekly')
    expect((screen.getByLabelText('重复到（可空）') as HTMLInputElement).value).toBe('2026-05-01')
    cleanup()
  })
})

describe('重复日程在日历上展开', () => {
  it('母事件按每周展开成多次', async () => {
    const { api } = makeApi([makeEvent({ id: 'm1', recurrenceId: 'r1' })], [RULE])
    render(<App today={TODAY} initialAnchor={TODAY} api={api} />)
    expect(await screen.findByTestId('block-m1#2026-03-04')).toBeTruthy()
    cleanup()
  })

  it('新建带重复的日程会先建规则再建日程', async () => {
    const { api, calls } = makeApi([])
    render(<App today={TODAY} initialAnchor={TODAY} api={api} />)
    await screen.findByTestId('week-allday').catch(() => undefined)

    fireEvent.click(screen.getByRole('button', { name: '＋ 新建' }))
    fireEvent.change(screen.getByLabelText(/标题/), { target: { value: '晨跑' } })
    fireEvent.change(screen.getByLabelText('重复'), { target: { value: 'daily' } })
    fireEvent.click(screen.getByRole('button', { name: '保存' }))

    await new Promise((resolve) => setTimeout(resolve, 60))
    expect(calls).toContain('rule-create:daily')
    expect(calls.some((call) => call.startsWith('create:晨跑:r-new-'))).toBe(true)
    cleanup()
  })
})

describe('重复日程的三选一', () => {
  async function openOccurrence() {
    const ctx = makeApi([makeEvent({ id: 'm1', recurrenceId: 'r1' })], [RULE])
    render(<App today={TODAY} initialAnchor={TODAY} api={ctx.api} />)
    await screen.findByTestId('block-m1#2026-03-04')
    fireEvent.click(screen.getByRole('button', { name: '编辑' }))
    fireEvent.doubleClick(screen.getByTestId('block-m1#2026-03-04'))
    return ctx
  }

  it('删除某一次会先问作用范围', async () => {
    const { calls } = await openOccurrence()
    fireEvent.click(screen.getByRole('button', { name: '删除' }))
    expect(screen.getByRole('dialog').textContent).toContain('删除重复日程')
    expect(screen.getByTestId('scope-single')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: '删除' }))
    await new Promise((resolve) => setTimeout(resolve, 60))
    expect(calls).toContain('exception:skipped:2026-03-04')
    cleanup()
  })

  it('选「全部」会连同母事件与规则一起删掉', async () => {
    const { calls } = await openOccurrence()
    fireEvent.click(screen.getByRole('button', { name: '删除' }))
    fireEvent.click(screen.getByTestId('scope-all').querySelector('input') as Element)
    fireEvent.click(screen.getByRole('button', { name: '删除' }))
    await new Promise((resolve) => setTimeout(resolve, 60))
    expect(calls).toContain('delete:m1')
    expect(calls).toContain('rule-delete:r1')
    cleanup()
  })

  it('选「这一次及以后」会把老系列截断在前一天', async () => {
    const { calls } = await openOccurrence()
    fireEvent.click(screen.getByRole('button', { name: '删除' }))
    fireEvent.click(screen.getByTestId('scope-following').querySelector('input') as Element)
    fireEvent.click(screen.getByRole('button', { name: '删除' }))
    await new Promise((resolve) => setTimeout(resolve, 60))
    expect(calls).toContain('rule-update:r1')
    cleanup()
  })

  it('修改某一次并选「仅这一次」会写一条改期例外', async () => {
    const { calls } = await openOccurrence()
    fireEvent.change(screen.getByLabelText(/标题/), { target: { value: '篮球训练（改期）' } })
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    expect(screen.getByRole('dialog').textContent).toContain('这次修改要应用到哪些日程')
    fireEvent.click(screen.getByRole('button', { name: '确定' }))
    await new Promise((resolve) => setTimeout(resolve, 60))
    expect(calls).toContain('exception:modified:2026-03-04')
    cleanup()
  })
})
