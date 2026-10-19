import { useEffect, useMemo, useState, type ReactNode } from 'react'
import type { Category, EventKind } from '../../shared/domain'
import { CATEGORIES, CATEGORY_LABEL } from '../../shared/domain'
import type { EventInput, EventItem } from '../../shared/entities'
import { validateEventInput } from '../../shared/entities'
import { conflictMessage, findConflicts } from '../../shared/conflict'
import { formatChineseDate, formatDate, parseDate, timeFromMinutes, minutesOfTime } from '../../shared/date'
import { Button, SegmentedControl, SelectField, TextField } from './Controls'
import { Dialog } from './Feedback'
import { MiniCalendar } from './MiniCalendar'

export interface EventDialogProps {
  open: boolean
  mode: 'create' | 'edit'
  initial?: EventItem | null
  defaults?: { date?: string; startTime?: string; category?: Category; kind?: EventKind }
  /** 用于冲突检测的同一天日程 */
  siblingEvents?: EventItem[]
  canDelete?: boolean
  /** 固定“今天”，便于测试 */
  today?: Date
  /** 编辑时带上已有的重复规则，用于回填 */
  initialRepeat?: {
    freq: string
    untilDate: string | null
    maxCount: number | null
    byWeekdays?: number[] | null
    intervalValue?: number | null
    intervalUnit?: 'day' | 'week' | null
  } | null
  onSave: (input: EventInput, repeat: RepeatPayload | null) => void
  onDelete?: () => void
  onClose: () => void
}

/** 弹窗交给外层的重复规则内容；null 表示不重复。 */
export interface RepeatPayload {
  freq: string
  untilDate: string | null
  maxCount: number | null
  /** 弹窗里改不到，但要把已有的原样带回去，避免编辑时丢掉「每周一三五」 */
  byWeekdays?: number[] | null
  intervalValue?: number | null
  intervalUnit?: 'day' | 'week' | null
}

const REPEAT_OPTIONS = [
  { value: 'none', label: '不重复' },
  { value: 'daily', label: '每天' },
  { value: 'weekly', label: '每周' },
  { value: 'biweekly', label: '每两周' },
  { value: 'monthly', label: '每月' },
  { value: 'yearly', label: '每年' },
]

/** 创建方式：日期＝单日事项；时间段＝可以跨天（反馈第二版「后续功能」第 4 条）。 */
export type CreateMode = 'single' | 'range'

interface FormState {
  title: string
  category: Category
  mode: CreateMode
  /** 只有截止时间（原来的待办） */
  deadline: boolean
  /** 单日模式的日期，或时间段模式的开始日期 */
  date: string
  startTime: string
  endTime: string
  endDate: string
  dueDate: string
  dueTime: string
  important: boolean
  location: string
  people: string
  note: string
  done: boolean
  repeatFreq: string
  repeatUntil: string
  repeatCount: string
}

function plusOneHour(time: string): string {
  return timeFromMinutes(Math.min(minutesOfTime(time) + 60, 23 * 60 + 59))
}

function isSameDay(startAt: string | null, endAt: string | null): boolean {
  if (!startAt || !endAt) return true
  return startAt.slice(0, 10) === endAt.slice(0, 10)
}

type BaseForm = Omit<FormState, 'repeatFreq' | 'repeatUntil' | 'repeatCount'>

function fromEventBase(event: EventItem): BaseForm {
  const today = formatDate(new Date())
  const common = {
    title: event.title,
    category: event.category,
    deadline: event.kind === 'todo',
    important: event.important === true,
    location: event.location ?? '',
    people: event.people ?? '',
    note: event.note ?? '',
    done: event.done,
    dueDate: event.dueAt?.slice(0, 10) ?? today,
    dueTime: event.dueAt?.includes('T') ? event.dueAt.slice(11, 16) : '23:59',
  }

  if (event.kind === 'todo') {
    return {
      ...common,
      mode: 'single',
      date: today,
      startTime: '',
      endTime: '',
      endDate: today,
    }
  }

  if (event.kind === 'allDay') {
    const start = event.startAt ?? today
    const end = event.endAt ?? start
    return {
      ...common,
      mode: start === end ? 'single' : 'range',
      date: start,
      startTime: '',
      endTime: '',
      endDate: end,
    }
  }

  if (event.kind === 'startOnly') {
    return {
      ...common,
      mode: 'single',
      date: event.startAt?.slice(0, 10) ?? today,
      startTime: event.startAt?.slice(11, 16) ?? '09:00',
      endTime: '',
      endDate: event.startAt?.slice(0, 10) ?? today,
    }
  }

  const startDate = event.startAt?.slice(0, 10) ?? today
  const endDate = event.endAt?.slice(0, 10) ?? startDate
  return {
    ...common,
    mode: isSameDay(event.startAt, event.endAt) ? 'single' : 'range',
    date: startDate,
    startTime: event.startAt?.slice(11, 16) ?? '09:00',
    endTime: event.endAt?.slice(11, 16) ?? '10:00',
    endDate,
  }
}

function repeatFields(
  repeat: EventDialogProps['initialRepeat'],
): Pick<FormState, 'repeatFreq' | 'repeatUntil' | 'repeatCount'> {
  return {
    repeatFreq: repeat?.freq ?? 'none',
    repeatUntil: repeat?.untilDate ?? '',
    repeatCount: repeat?.maxCount ? String(repeat.maxCount) : '',
  }
}

function buildInitial(
  mode: 'create' | 'edit',
  initial: EventItem | null | undefined,
  defaults: EventDialogProps['defaults'],
  repeat: EventDialogProps['initialRepeat'],
): FormState {
  if (mode === 'edit' && initial) return { ...fromEventBase(initial), ...repeatFields(repeat) }

  const today = formatDate(new Date())
  const date = defaults?.date ?? today
  const startTime = defaults?.startTime ?? ''
  return {
    ...repeatFields(repeat),
    title: '',
    category: defaults?.category ?? 'activity',
    mode: 'single',
    deadline: defaults?.kind === 'todo',
    date,
    startTime,
    endTime: startTime ? plusOneHour(startTime) : '',
    endDate: date,
    dueDate: date,
    dueTime: '23:59',
    important: false,
    location: '',
    people: '',
    note: '',
    done: false,
  }
}

/** 由界面填写内容推导出数据层的时间形态。 */
export function kindOf(form: {
  mode: CreateMode
  deadline: boolean
  startTime: string
  endTime: string
}): EventKind {
  if (form.deadline) return 'todo'
  if (!form.startTime && !form.endTime) return 'allDay'
  if (form.mode === 'single' && form.startTime && !form.endTime) return 'startOnly'
  return 'timed'
}

function toInput(form: FormState, initial?: EventItem | null): EventInput {
  const base = {
    title: form.title,
    category: form.category,
    location: form.location.trim() || null,
    people: form.people.trim() || null,
    note: form.note.trim() || null,
    important: form.important,
    recurrenceId: initial?.recurrenceId ?? null,
  }

  if (form.deadline) {
    return { ...base, kind: 'todo', dueAt: `${form.dueDate}T${form.dueTime}` }
  }

  const endDate = form.mode === 'range' ? form.endDate : form.date

  if (!form.startTime && !form.endTime) {
    return { ...base, kind: 'allDay', startAt: form.date, endAt: endDate }
  }

  if (form.mode === 'single' && form.startTime && !form.endTime) {
    return { ...base, kind: 'startOnly', startAt: `${form.date}T${form.startTime}`, endAt: null }
  }

  return {
    ...base,
    kind: 'timed',
    startAt: `${form.date}T${form.startTime || '00:00'}`,
    endAt: `${endDate}T${form.endTime || '23:59'}`,
  }
}

const KIND_HINT: Record<EventKind, string> = {
  timed: '会显示在时间轴上',
  allDay: '会显示在顶部「全天」一条',
  startOnly: '会在时间轴上画一道线',
  todo: '会显示在待办里',
}

/** 新建 / 编辑日程弹窗。校验不过不保存；冲突只提示不阻止。 */
export function EventDialog({
  open,
  mode,
  initial,
  defaults,
  siblingEvents = [],
  canDelete = false,
  today,
  initialRepeat = null,
  onSave,
  onDelete,
  onClose,
}: EventDialogProps): ReactNode {
  const [form, setForm] = useState<FormState>(() => buildInitial(mode, initial, defaults, initialRepeat))
  const [errors, setErrors] = useState<string[]>([])
  /** 时间段模式下，日历当前填哪个日期 */
  const [picking, setPicking] = useState<'start' | 'end'>('start')

  useEffect(() => {
    if (open) {
      setForm(buildInitial(mode, initial, defaults, initialRepeat))
      setErrors([])
      setPicking('start')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initial?.id, mode, initialRepeat?.freq])

  const update = <K extends keyof FormState>(key: K, value: FormState[K]): void => {
    setForm((current) => ({ ...current, [key]: value }))
  }

  const draft = useMemo(() => toInput(form, initial), [form, initial])
  const derivedKind = kindOf(form)

  const conflicts = useMemo(() => {
    if (draft.kind !== 'timed' || !draft.startAt || !draft.endAt) return []
    return findConflicts(
      { startAt: draft.startAt, endAt: draft.endAt, kind: draft.kind, id: initial?.id },
      siblingEvents,
    )
  }, [draft, siblingEvents, initial?.id])

  const titleEmpty = form.title.trim() === ''

  /** 点日历：单日模式直接换日期；时间段模式按当前选中的那一头填 */
  const handlePickDate = (date: string): void => {
    setForm((current) => {
      if (current.mode === 'single') {
        return {
          ...current,
          date,
          endDate: current.endDate < date ? date : current.endDate,
          dueDate: current.deadline ? date : current.dueDate,
        }
      }
      if (picking === 'start') {
        return {
          ...current,
          date,
          endDate: current.endDate < date ? date : current.endDate,
        }
      }
      // 选结束：早于开始就当成新的开始
      if (date < current.date) return { ...current, date, endDate: current.date }
      return { ...current, endDate: date }
    })
    if (form.mode === 'range' && picking === 'start') setPicking('end')
    else if (form.mode === 'range' && picking === 'end') setPicking('start')
  }

  const handleSave = (): void => {
    const messages = validateEventInput(draft)
    if (messages.length > 0) {
      setErrors(messages)
      return
    }
    setErrors([])
    const repeat: RepeatPayload | null =
      form.repeatFreq === 'none'
        ? null
        : {
            freq: form.repeatFreq,
            untilDate: form.repeatUntil || null,
            maxCount: form.repeatCount ? Number(form.repeatCount) : null,
            byWeekdays: initialRepeat?.byWeekdays ?? null,
            intervalValue: initialRepeat?.intervalValue ?? null,
            intervalUnit: initialRepeat?.intervalUnit ?? null,
          }
    onSave(draft, repeat)
  }

  const title = mode === 'create' ? '新建日程' : '编辑日程'

  return (
    <Dialog
      open={open}
      title={title}
      className="dialog--wide"
      onClose={onClose}
      footer={
        <>
          {mode === 'edit' && canDelete && onDelete ? (
            <Button variant="danger" onClick={onDelete} style={{ marginRight: 'auto' }}>
              删除
            </Button>
          ) : null}
          <Button onClick={onClose}>取消</Button>
          <Button variant="primary" onClick={handleSave} disabled={titleEmpty}>
            保存
          </Button>
        </>
      }
    >
      <TextField
        id="event-title"
        label="标题"
        required
        value={form.title}
        autoFocus
        placeholder="例如：高数、篮球训练"
        onChange={(event) => update('title', event.target.value)}
      />

      <div className="event-form__meta">
        <SelectField
          id="event-category"
          label="类别"
          value={form.category}
          options={CATEGORIES.map((item) => ({ value: item, label: CATEGORY_LABEL[item] }))}
          onChange={(event) => update('category', event.target.value as Category)}
        />
        <div className="field">
          <span className="field__label">时间方式</span>
          <SegmentedControl
            ariaLabel="选择时间方式"
            value={form.mode}
            options={[
              { value: 'single', label: '日期（单日）' },
              { value: 'range', label: '时间段（可跨天）' },
            ]}
            onChange={(value) => {
              update('mode', value)
              setPicking('start')
            }}
          />
        </div>
        <label className="checkbox checkbox--important">
          <input
            type="checkbox"
            checked={form.important}
            aria-label="标记为重要事项"
            onChange={(event) => update('important', event.target.checked)}
          />
          重要事项
        </label>
      </div>

      <div className="event-form__time">
        <MiniCalendar
          value={form.date}
          endValue={form.mode === 'range' ? form.endDate : null}
          today={today}
          onSelect={handlePickDate}
        />

        <div className="event-form__picked">
          <div className="event-form__picked-row">
            <span className="event-form__picked-label">{form.mode === 'range' ? '开始' : '日期'}</span>
            <button
              type="button"
              className={`event-form__date-chip${form.mode === 'range' && picking === 'start' ? ' is-active' : ''}`}
              onClick={() => setPicking('start')}
              data-testid="picked-start"
            >
              {formatChineseDate(parseDate(form.date), true)}
            </button>
          </div>

          {form.mode === 'range' ? (
            <div className="event-form__picked-row">
              <span className="event-form__picked-label">结束</span>
              <button
                type="button"
                className={`event-form__date-chip${picking === 'end' ? ' is-active' : ''}`}
                onClick={() => setPicking('end')}
                data-testid="picked-end"
              >
                {formatChineseDate(parseDate(form.endDate), true)}
              </button>
            </div>
          ) : null}

          <div className="form-row">
            <TextField
              id="event-start"
              label={form.mode === 'range' ? '开始时间' : '开始时间（可空）'}
              type="time"
              value={form.startTime}
              onChange={(event) => update('startTime', event.target.value)}
            />
            <TextField
              id="event-end"
              label={form.mode === 'range' ? '结束时间' : '结束时间（可空）'}
              type="time"
              value={form.endTime}
              onChange={(event) => update('endTime', event.target.value)}
            />
          </div>

          <p className="event-form__hint" data-testid="kind-hint">
            {KIND_HINT[derivedKind]}
            {form.mode === 'range' ? '（时间段可以跨天）' : ''}
          </p>
        </div>
      </div>

      <label className="checkbox checkbox--deadline">
        <input
          type="checkbox"
          checked={form.deadline}
          aria-label="只有截止时间（当作待办）"
          onChange={(event) => update('deadline', event.target.checked)}
        />
        只有截止时间（当作待办，出现在待办页）
      </label>

      {form.deadline ? (
        <div className="form-row">
          <TextField
            id="event-due-date"
            label="截止日期"
            type="date"
            value={form.dueDate}
            onChange={(event) => update('dueDate', event.target.value)}
          />
          <TextField
            id="event-due-time"
            label="截止时刻"
            type="time"
            value={form.dueTime}
            onChange={(event) => update('dueTime', event.target.value)}
          />
        </div>
      ) : null}

      <div className="form-row">
        <SelectField
          id="event-repeat"
          label="重复"
          value={form.repeatFreq}
          options={REPEAT_OPTIONS}
          onChange={(event) => update('repeatFreq', event.target.value)}
        />
        {form.repeatFreq !== 'none' ? (
          <>
            <TextField
              id="event-repeat-until"
              label="重复到（可空）"
              type="date"
              value={form.repeatUntil}
              onChange={(event) => update('repeatUntil', event.target.value)}
            />
            <TextField
              id="event-repeat-count"
              label="共几次（可空）"
              type="number"
              min={1}
              value={form.repeatCount}
              onChange={(event) => update('repeatCount', event.target.value)}
            />
          </>
        ) : null}
      </div>

      <div className="form-row">
        <TextField
          id="event-location"
          label="地点"
          value={form.location}
          onChange={(event) => update('location', event.target.value)}
        />
        <TextField
          id="event-people"
          label="老师 / 参与人"
          value={form.people}
          onChange={(event) => update('people', event.target.value)}
        />
      </div>

      <TextField
        id="event-note"
        label="备注"
        value={form.note}
        onChange={(event) => update('note', event.target.value)}
      />

      {errors.length > 0 ? (
        <div className="form-error" role="alert">
          {errors.map((message) => (
            <div key={message}>{message}</div>
          ))}
        </div>
      ) : null}

      {conflictMessage(conflicts) ? (
        <div className="conflict-hint" role="status" data-testid="conflict-hint">
          {conflictMessage(conflicts)}
        </div>
      ) : null}
    </Dialog>
  )
}
