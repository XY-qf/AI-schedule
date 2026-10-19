import { describe, expect, it } from '../helpers/expect'
import { cleanup, fireEvent, render, screen } from '../helpers/ui'
import { EventDialog, kindOf } from '../../src/renderer/components/EventDialog'
import { MiniCalendar } from '../../src/renderer/components/MiniCalendar'
import type { RepeatPayload } from '../../src/renderer/components/EventDialog'
import type { EventInput, EventItem } from '../../src/shared/entities'

const TODAY = new Date(2026, 2, 4)

function makeEvent(partial: Partial<EventItem> & { id: string }): EventItem {
  return {
    id: partial.id,
    title: partial.title ?? '篮球训练',
    category: partial.category ?? 'activity',
    kind: partial.kind ?? 'timed',
    startAt: partial.startAt ?? '2026-03-04T19:00',
    endAt: partial.endAt ?? '2026-03-04T20:00',
    dueAt: partial.dueAt ?? null,
    location: partial.location ?? null,
    people: null,
    note: null,
    done: partial.done ?? false,
    important: partial.important ?? false,
    recurrenceId: null,
    createdAt: '',
    updatedAt: '',
  }
}

interface Saved {
  input: EventInput
  repeat: RepeatPayload | null
}

function renderDialog(props: Partial<Parameters<typeof EventDialog>[0]> = {}) {
  const saved: Saved[] = []
  const calls: string[] = []
  render(
    <EventDialog
      open
      mode="create"
      today={TODAY}
      defaults={{ date: '2026-03-04', category: 'activity' }}
      siblingEvents={[]}
      onSave={(input, repeat) => saved.push({ input, repeat })}
      onDelete={() => calls.push('delete')}
      onClose={() => calls.push('close')}
      {...props}
    />,
  )
  return { saved, calls }
}

function fillTitle(value = '开会'): void {
  fireEvent.change(screen.getByLabelText(/标题/), { target: { value } })
}

describe('时间形态推导', () => {
  it('没填时间 → 全天', () => {
    expect(kindOf({ mode: 'single', deadline: false, startTime: '', endTime: '' })).toBe('allDay')
  })
  it('只填开始 → 只有开始时间', () => {
    expect(kindOf({ mode: 'single', deadline: false, startTime: '09:00', endTime: '' })).toBe('startOnly')
  })
  it('开始+结束 → 时间段', () => {
    expect(kindOf({ mode: 'single', deadline: false, startTime: '09:00', endTime: '10:00' })).toBe('timed')
  })
  it('时间段模式 + 两个时间都空 → 全天（可跨天）', () => {
    expect(kindOf({ mode: 'range', deadline: false, startTime: '', endTime: '' })).toBe('allDay')
  })
  it('勾了待办 → 待办', () => {
    expect(kindOf({ mode: 'single', deadline: true, startTime: '09:00', endTime: '10:00' })).toBe('todo')
  })
})

describe('小日历', () => {
  it('点某一天会把日期回传', () => {
    const picked: string[] = []
    render(<MiniCalendar value="2026-03-04" today={TODAY} onSelect={(date) => picked.push(date)} />)
    fireEvent.click(screen.getByTestId('mini-day-2026-03-10'))
    expect(picked).toEqual(['2026-03-10'])
    cleanup()
  })

  it('可以翻到上个月/下个月', () => {
    const picked: string[] = []
    render(<MiniCalendar value="2026-03-04" today={TODAY} onSelect={(date) => picked.push(date)} />)
    expect(screen.getByTestId('mini-cal-title').textContent).toBe('2026年3月')
    fireEvent.click(screen.getByRole('button', { name: '下个月' }))
    expect(screen.getByTestId('mini-cal-title').textContent).toBe('2026年4月')
    fireEvent.click(screen.getByTestId('mini-day-2026-04-06'))
    expect(picked).toEqual(['2026-04-06'])
    cleanup()
  })

  it('选中的那天带选中样式', () => {
    render(<MiniCalendar value="2026-03-04" today={TODAY} onSelect={() => {}} />)
    expect(screen.getByTestId('mini-day-2026-03-04').className).toContain('is-selected')
    expect(screen.getByTestId('mini-day-2026-03-05').className).not.toContain('is-selected')
    cleanup()
  })
})

describe('新建日程：日期模式', () => {
  it('默认日期模式，不填时间保存为全天', () => {
    const { saved } = renderDialog()
    fillTitle('春游')
    fireEvent.click(screen.getByTestId('mini-day-2026-03-07'))
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    expect(saved.length).toBe(1)
    expect(saved[0].input.kind).toBe('allDay')
    expect(saved[0].input.startAt).toBe('2026-03-07')
    expect(saved[0].input.endAt).toBe('2026-03-07')
    cleanup()
  })

  it('只填开始时间 → 只有开始时间', () => {
    const { saved } = renderDialog()
    fillTitle('取快递')
    fireEvent.change(screen.getByLabelText(/开始时间/), { target: { value: '15:30' } })
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    expect(saved[0].input.kind).toBe('startOnly')
    expect(saved[0].input.startAt).toBe('2026-03-04T15:30')
    expect(saved[0].input.endAt).toBeNull()
    cleanup()
  })

  it('填了开始与结束 → 当天的时间段', () => {
    const { saved } = renderDialog()
    fillTitle('开会')
    fireEvent.change(screen.getByLabelText(/开始时间/), { target: { value: '09:00' } })
    fireEvent.change(screen.getByLabelText(/结束时间/), { target: { value: '10:30' } })
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    expect(saved[0].input.kind).toBe('timed')
    expect(saved[0].input.startAt).toBe('2026-03-04T09:00')
    expect(saved[0].input.endAt).toBe('2026-03-04T10:30')
    cleanup()
  })

  it('没填标题时保存按钮不可用', () => {
    renderDialog()
    const button = screen.getByRole('button', { name: '保存' }) as HTMLButtonElement
    expect(button.disabled).toBe(true)
    cleanup()
  })
})

describe('新建日程：时间段模式（可跨天）', () => {
  it('先点开始再点结束，保存为跨天', () => {
    const { saved } = renderDialog()
    fillTitle('实习')
    fireEvent.click(screen.getByRole('tab', { name: /时间段/ }))
    fireEvent.click(screen.getByTestId('mini-day-2026-03-04'))
    fireEvent.click(screen.getByTestId('mini-day-2026-03-06'))
    fireEvent.change(screen.getByLabelText(/开始时间/), { target: { value: '09:00' } })
    fireEvent.change(screen.getByLabelText(/结束时间/), { target: { value: '18:00' } })
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    expect(saved[0].input.kind).toBe('timed')
    expect(saved[0].input.startAt).toBe('2026-03-04T09:00')
    expect(saved[0].input.endAt).toBe('2026-03-06T18:00')
    cleanup()
  })

  it('时间段模式不填时间 → 跨天的全天日程', () => {
    const { saved } = renderDialog()
    fillTitle('出差')
    fireEvent.click(screen.getByRole('tab', { name: /时间段/ }))
    fireEvent.click(screen.getByTestId('mini-day-2026-03-04'))
    fireEvent.click(screen.getByTestId('mini-day-2026-03-05'))
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    expect(saved[0].input.kind).toBe('allDay')
    expect(saved[0].input.startAt).toBe('2026-03-04')
    expect(saved[0].input.endAt).toBe('2026-03-05')
    cleanup()
  })

  it('结束日期早于开始时会自动对调', () => {
    const { saved } = renderDialog()
    fillTitle('活动')
    fireEvent.click(screen.getByRole('tab', { name: /时间段/ }))
    fireEvent.click(screen.getByTestId('mini-day-2026-03-10'))
    fireEvent.click(screen.getByTestId('mini-day-2026-03-06'))
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    expect(saved[0].input.startAt).toBe('2026-03-06')
    expect(saved[0].input.endAt).toBe('2026-03-10')
    cleanup()
  })
})

describe('新建日程：待办与重要', () => {
  it('勾了「只有截止时间」只保存截止时间', () => {
    const { saved } = renderDialog()
    fillTitle('交论文')
    fireEvent.click(screen.getByLabelText(/只有截止时间/))
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    expect(saved[0].input.kind).toBe('todo')
    expect(saved[0].input.dueAt).toBe('2026-03-04T23:59')
    cleanup()
  })

  it('勾了重要事项会带进保存内容', () => {
    const { saved } = renderDialog()
    fillTitle('答辩')
    fireEvent.click(screen.getByLabelText('标记为重要事项'))
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    expect(saved[0].input.important).toBe(true)
    cleanup()
  })

  it('默认不是重要事项', () => {
    const { saved } = renderDialog()
    fillTitle('普通')
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    expect(saved[0].input.important).toBe(false)
    cleanup()
  })
})

describe('校验与冲突', () => {
  it('结束时间早于开始时间时提示且不保存', () => {
    const { saved } = renderDialog()
    fillTitle('倒着来')
    fireEvent.change(screen.getByLabelText(/开始时间/), { target: { value: '18:00' } })
    fireEvent.change(screen.getByLabelText(/结束时间/), { target: { value: '09:00' } })
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    expect(saved.length).toBe(0)
    expect(screen.getByRole('alert').textContent).toContain('结束时间要晚于开始时间')
    cleanup()
  })

  it('有重叠时给出冲突提示，但仍能保存', () => {
    const sibling = makeEvent({ id: 'other', title: '已有', startAt: '2026-03-04T09:00', endAt: '2026-03-04T11:00' })
    const { saved } = renderDialog({ siblingEvents: [sibling] })
    fillTitle('新会议')
    fireEvent.change(screen.getByLabelText(/开始时间/), { target: { value: '10:00' } })
    fireEvent.change(screen.getByLabelText(/结束时间/), { target: { value: '12:00' } })
    expect(screen.getByTestId('conflict-hint')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    expect(saved.length).toBe(1)
    cleanup()
  })
})

describe('编辑已有日程', () => {
  it('时间段日程回填为单日模式与时间', () => {
    renderDialog({ mode: 'edit', initial: makeEvent({ id: 'e1' }), canDelete: true })
    expect(screen.getByRole('dialog').textContent).toContain('编辑日程')
    expect((screen.getByLabelText(/标题/) as HTMLInputElement).value).toBe('篮球训练')
    expect((screen.getByLabelText(/开始时间/) as HTMLInputElement).value).toBe('19:00')
    expect((screen.getByLabelText(/结束时间/) as HTMLInputElement).value).toBe('20:00')
    cleanup()
  })

  it('跨天日程回填为时间段模式', () => {
    renderDialog({
      mode: 'edit',
      initial: makeEvent({ id: 'e2', startAt: '2026-03-04T09:00', endAt: '2026-03-06T18:00' }),
    })
    expect(screen.getByTestId('picked-end').textContent).toContain('2026')
    const tab = screen.getByRole('tab', { name: /时间段/ })
    expect(tab.getAttribute('aria-selected')).toBe('true')
    cleanup()
  })

  it('全天日程回填后保存仍是全天', () => {
    const saved: Saved[] = []
    render(
      <EventDialog
        open
        mode="edit"
        today={TODAY}
        initial={makeEvent({ id: 'e3', kind: 'allDay', startAt: '2026-03-04', endAt: '2026-03-04' })}
        siblingEvents={[]}
        onSave={(input, repeat) => saved.push({ input, repeat })}
        onClose={() => {}}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    expect(saved[0].input.kind).toBe('allDay')
    cleanup()
  })

  it('只有开始时间的日程回填后保存仍是只有开始', () => {
    const saved: Saved[] = []
    render(
      <EventDialog
        open
        mode="edit"
        today={TODAY}
        initial={makeEvent({ id: 'e4', kind: 'startOnly', startAt: '2026-03-04T15:30', endAt: null })}
        siblingEvents={[]}
        onSave={(input, repeat) => saved.push({ input, repeat })}
        onClose={() => {}}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    expect(saved[0].input.kind).toBe('startOnly')
    expect(saved[0].input.endAt).toBeNull()
    cleanup()
  })

  it('待办回填后保存仍是待办', () => {
    const saved: Saved[] = []
    render(
      <EventDialog
        open
        mode="edit"
        today={TODAY}
        initial={makeEvent({ id: 'e5', kind: 'todo', startAt: null, endAt: null, dueAt: '2026-03-09T23:59' })}
        siblingEvents={[]}
        onSave={(input, repeat) => saved.push({ input, repeat })}
        onClose={() => {}}
      />,
    )
    expect((screen.getByLabelText('截止日期') as HTMLInputElement).value).toBe('2026-03-09')
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    expect(saved[0].input.kind).toBe('todo')
    expect(saved[0].input.dueAt).toBe('2026-03-09T23:59')
    cleanup()
  })

  it('编辑时可以删除', () => {
    const { calls } = renderDialog({ mode: 'edit', initial: makeEvent({ id: 'e6' }), canDelete: true })
    fireEvent.click(screen.getByRole('button', { name: '删除' }))
    expect(calls).toContain('delete')
    cleanup()
  })
})

describe('重复设置', () => {
  it('选了每周会把重复规则一起交出去', () => {
    const { saved } = renderDialog()
    fillTitle('周会')
    fireEvent.change(screen.getByLabelText('重复'), { target: { value: 'weekly' } })
    fireEvent.change(screen.getByLabelText('重复到（可空）'), { target: { value: '2026-06-30' } })
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    expect(saved[0].repeat).toEqual({
      freq: 'weekly',
      untilDate: '2026-06-30',
      maxCount: null,
      byWeekdays: null,
      intervalValue: null,
      intervalUnit: null,
    })
    cleanup()
  })

  it('不重复时是 null', () => {
    const { saved } = renderDialog()
    fillTitle('一次性')
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    expect(saved[0].repeat).toBeNull()
    cleanup()
  })
})
