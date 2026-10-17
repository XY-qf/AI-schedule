import { describe, expect, it } from '../helpers/expect'
import { cleanup, fireEvent, render, screen } from '../helpers/ui'
import type { EventInput, EventItem } from '../../src/shared/entities'
import { EventDialog } from '../../src/renderer/components/EventDialog'

function ev(partial: Partial<EventItem> & { id: string }): EventItem {
  return {
    id: partial.id,
    title: partial.title ?? '已有日程',
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

interface Result {
  saved: EventInput[]
  closed: number
  deleted: number
}

function renderDialog(props: Partial<Parameters<typeof EventDialog>[0]> = {}): Result {
  const result: Result = { saved: [], closed: 0, deleted: 0 }
  render(
    <EventDialog
      open
      mode="create"
      defaults={{ date: '2026-03-05', startTime: '19:30', category: 'activity' }}
      siblingEvents={[]}
      onSave={(input) => result.saved.push(input)}
      onClose={() => (result.closed += 1)}
      onDelete={() => (result.deleted += 1)}
      {...props}
    />,
  )
  return result
}

describe('新建日程弹窗 · 默认值', () => {
  it('时间与类别按传入的默认值预填', () => {
    renderDialog()
    expect((screen.getByLabelText(/标题/) as HTMLInputElement).value).toBe('')
    expect((screen.getByLabelText('日期') as HTMLInputElement).value).toBe('2026-03-05')
    expect((screen.getByLabelText('开始时间') as HTMLInputElement).value).toBe('19:30')
    expect((screen.getByLabelText('结束时间') as HTMLInputElement).value).toBe('20:30')
    expect((screen.getByLabelText('类别') as HTMLSelectElement).value).toBe('activity')
    expect((screen.getByLabelText('类型') as HTMLSelectElement).value).toBe('timed')
    cleanup()
  })

  it('标题为空时保存按钮不可点', () => {
    renderDialog()
    const save = screen.getByRole('button', { name: '保存' }) as HTMLButtonElement
    expect(save.disabled).toBe(true)
    fireEvent.change(screen.getByLabelText(/标题/), { target: { value: '篮球训练' } })
    expect(save.disabled).toBe(false)
    cleanup()
  })
})

describe('新建日程弹窗 · 校验', () => {
  it('结束时间早于开始时间时给出中文提示且不保存', () => {
    const result = renderDialog()
    fireEvent.change(screen.getByLabelText(/标题/), { target: { value: '会议' } })
    fireEvent.change(screen.getByLabelText('开始时间'), { target: { value: '10:00' } })
    fireEvent.change(screen.getByLabelText('结束时间'), { target: { value: '09:00' } })
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    expect(result.saved).toEqual([])
    expect(screen.getByRole('alert').textContent).toContain('结束时间要晚于开始时间')
    cleanup()
  })

  it('改正后可以保存，错误提示消失', () => {
    const result = renderDialog()
    fireEvent.change(screen.getByLabelText(/标题/), { target: { value: '会议' } })
    fireEvent.change(screen.getByLabelText('开始时间'), { target: { value: '10:00' } })
    fireEvent.change(screen.getByLabelText('结束时间'), { target: { value: '09:00' } })
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    fireEvent.change(screen.getByLabelText('结束时间'), { target: { value: '11:00' } })
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    expect(result.saved.length).toBe(1)
    expect(screen.queryByRole('alert')).toBeNull()
    cleanup()
  })

  it('只有空格的标题不算填写', () => {
    renderDialog()
    fireEvent.change(screen.getByLabelText(/标题/), { target: { value: '   ' } })
    expect((screen.getByRole('button', { name: '保存' }) as HTMLButtonElement).disabled).toBe(true)
    cleanup()
  })
})

describe('新建日程弹窗 · 四种时间形态', () => {
  it('时间段保存为带时刻的起止', () => {
    const result = renderDialog()
    fireEvent.change(screen.getByLabelText(/标题/), { target: { value: '篮球训练' } })
    fireEvent.change(screen.getByLabelText('地点'), { target: { value: '体育馆' } })
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    expect(result.saved).toEqual([
      {
        title: '篮球训练',
        category: 'activity',
        kind: 'timed',
        startAt: '2026-03-05T19:30',
        endAt: '2026-03-05T20:30',
        location: '体育馆',
        people: null,
        note: null,
        recurrenceId: null,
      },
    ])
    cleanup()
  })

  it('切成全天只保存日期', () => {
    const result = renderDialog()
    fireEvent.change(screen.getByLabelText(/标题/), { target: { value: '回家' } })
    fireEvent.change(screen.getByLabelText('类型'), { target: { value: 'allDay' } })
    fireEvent.change(screen.getByLabelText('结束日期'), { target: { value: '2026-03-07' } })
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    expect(result.saved[0].kind).toBe('allDay')
    expect(result.saved[0].startAt).toBe('2026-03-05')
    expect(result.saved[0].endAt).toBe('2026-03-07')
    expect(result.saved[0].startAt).not.toContain('T')
    cleanup()
  })

  it('切成待办只保存截止时间，默认 23:59', () => {
    const result = renderDialog()
    fireEvent.change(screen.getByLabelText(/标题/), { target: { value: '交报告' } })
    fireEvent.change(screen.getByLabelText('类型'), { target: { value: 'todo' } })
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    expect(result.saved[0].kind).toBe('todo')
    expect(result.saved[0].dueAt).toBe('2026-03-05T23:59')
    cleanup()
  })

  it('待办可以指定具体截止时刻', () => {
    const result = renderDialog()
    fireEvent.change(screen.getByLabelText(/标题/), { target: { value: '交报告' } })
    fireEvent.change(screen.getByLabelText('类型'), { target: { value: 'todo' } })
    fireEvent.change(screen.getByLabelText('截止时刻'), { target: { value: '17:00' } })
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    expect(result.saved[0].dueAt).toBe('2026-03-05T17:00')
    cleanup()
  })

  it('跨天事件用结束日期表达', () => {
    const result = renderDialog()
    fireEvent.change(screen.getByLabelText(/标题/), { target: { value: '通宵赶作业' } })
    fireEvent.change(screen.getByLabelText('开始时间'), { target: { value: '22:00' } })
    fireEvent.change(screen.getByLabelText('结束时间'), { target: { value: '02:00' } })
    fireEvent.change(screen.getByLabelText('结束日期（跨天时修改）'), { target: { value: '2026-03-06' } })
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    expect(result.saved[0].startAt).toBe('2026-03-05T22:00')
    expect(result.saved[0].endAt).toBe('2026-03-06T02:00')
    cleanup()
  })
})

describe('新建日程弹窗 · 冲突提示', () => {
  it('与已有日程重叠时提示，但仍可保存', () => {
    const result = renderDialog({
      siblingEvents: [ev({ id: 'x', title: '高数', startAt: '2026-03-05T19:00', endAt: '2026-03-05T21:00' })],
    })
    fireEvent.change(screen.getByLabelText(/标题/), { target: { value: '篮球训练' } })
    const hint = screen.getByTestId('conflict-hint')
    expect(hint.textContent).toContain('高数')
    expect(hint.textContent).toContain('可仍然保存')
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    expect(result.saved.length).toBe(1)
    cleanup()
  })

  it('不重叠时没有提示', () => {
    renderDialog({
      siblingEvents: [ev({ id: 'x', title: '高数', startAt: '2026-03-05T08:00', endAt: '2026-03-05T09:40' })],
    })
    expect(screen.queryByTestId('conflict-hint')).toBeNull()
    cleanup()
  })

  it('全天与待办不触发冲突提示', () => {
    renderDialog({
      siblingEvents: [ev({ id: 'x', title: '高数', startAt: '2026-03-05T00:00', endAt: '2026-03-05T23:59' })],
    })
    fireEvent.change(screen.getByLabelText('类型'), { target: { value: 'allDay' } })
    expect(screen.queryByTestId('conflict-hint')).toBeNull()
    cleanup()
  })
})

describe('编辑日程弹窗', () => {
  const existing = ev({
    id: 'edit-1',
    title: '社团例会',
    category: 'activity',
    startAt: '2026-03-05T14:00',
    endAt: '2026-03-05T16:00',
    location: '线上',
    done: true,
  })

  it('字段按已有日程预填，标题显示为编辑', () => {
    renderDialog({ mode: 'edit', initial: existing, canDelete: true })
    expect(screen.getByRole('dialog').textContent).toContain('编辑日程')
    expect((screen.getByLabelText(/标题/) as HTMLInputElement).value).toBe('社团例会')
    expect((screen.getByLabelText('开始时间') as HTMLInputElement).value).toBe('14:00')
    expect((screen.getByLabelText('结束时间') as HTMLInputElement).value).toBe('16:00')
    expect((screen.getByLabelText('地点') as HTMLInputElement).value).toBe('线上')
    cleanup()
  })

  it('编辑态且有权限时出现删除按钮，点击回调', () => {
    const result = renderDialog({ mode: 'edit', initial: existing, canDelete: true })
    fireEvent.click(screen.getByRole('button', { name: '删除' }))
    expect(result.deleted).toBe(1)
    cleanup()
  })

  it('没有删除权限时不显示删除按钮', () => {
    renderDialog({ mode: 'edit', initial: existing, canDelete: false })
    expect(screen.queryByRole('button', { name: '删除' })).toBeNull()
    cleanup()
  })

  it('取消会回调关闭', () => {
    const result = renderDialog()
    fireEvent.click(screen.getByRole('button', { name: '取消' }))
    expect(result.closed).toBe(1)
    cleanup()
  })
})
