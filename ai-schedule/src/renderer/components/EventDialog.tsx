import { useEffect, useMemo, useState, type ReactNode } from 'react'
import type { Category, EventKind } from '../../shared/domain'
import { CATEGORIES, CATEGORY_LABEL } from '../../shared/domain'
import type { EventInput, EventItem } from '../../shared/entities'
import { validateEventInput } from '../../shared/entities'
import { conflictMessage, findConflicts } from '../../shared/conflict'
import { formatDate, timeFromMinutes, minutesOfTime } from '../../shared/date'
import { Button, SelectField, TextField } from './Controls'
import { Dialog } from './Feedback'

export interface EventDialogProps {
  open: boolean
  mode: 'create' | 'edit'
  initial?: EventItem | null
  defaults?: { date?: string; startTime?: string; category?: Category; kind?: EventKind }
  /** 用于冲突检测的同一天日程 */
  siblingEvents?: EventItem[]
  canDelete?: boolean
  /** 编辑时带上已有的重复规则，用于回填 */
  initialRepeat?: { freq: string; untilDate: string | null; maxCount: number | null } | null
  onSave: (input: EventInput, repeat: RepeatPayload | null) => void
  onDelete?: () => void
  onClose: () => void
}

/** 弹窗交给外层的重复规则内容；null 表示不重复。 */
export interface RepeatPayload {
  freq: string
  untilDate: string | null
  maxCount: number | null
}

const REPEAT_OPTIONS = [
  { value: 'none', label: '不重复' },
  { value: 'daily', label: '每天' },
  { value: 'weekly', label: '每周' },
  { value: 'biweekly', label: '每两周' },
  { value: 'monthly', label: '每月' },
  { value: 'yearly', label: '每年' },
]

interface FormState {
  repeatFreq: string
  repeatUntil: string
  repeatCount: string
  title: string
  category: Category
  kind: EventKind
  date: string
  startTime: string
  endTime: string
  endDate: string
  dueDate: string
  dueTime: string
  location: string
  people: string
  note: string
  done: boolean
}

const KIND_OPTIONS: Array<{ value: EventKind; label: string }> = [
  { value: 'timed', label: '时间段' },
  { value: 'allDay', label: '全天' },
  { value: 'startOnly', label: '只有开始时间' },
  { value: 'todo', label: '只有截止时间' },
]

function plusOneHour(time: string): string {
  return timeFromMinutes(Math.min(minutesOfTime(time) + 60, 23 * 60 + 59))
}

type BaseForm = Omit<FormState, 'repeatFreq' | 'repeatUntil' | 'repeatCount'>

function fromEventBase(event: EventItem): BaseForm {
  const today = formatDate(new Date())
  if (event.kind === 'timed') {
    return {
      title: event.title,
      category: event.category,
      kind: 'timed',
      date: event.startAt?.slice(0, 10) ?? today,
      startTime: event.startAt?.slice(11, 16) ?? '09:00',
      endTime: event.endAt?.slice(11, 16) ?? '10:00',
      endDate: event.endAt?.slice(0, 10) ?? today,
      dueDate: today,
      dueTime: '23:59',
      location: event.location ?? '',
      people: event.people ?? '',
      note: event.note ?? '',
      done: event.done,
    }
  }
  if (event.kind === 'allDay') {
    return {
      title: event.title,
      category: event.category,
      kind: 'allDay',
      date: event.startAt ?? today,
      startTime: '09:00',
      endTime: '10:00',
      endDate: event.endAt ?? event.startAt ?? today,
      dueDate: today,
      dueTime: '23:59',
      location: event.location ?? '',
      people: event.people ?? '',
      note: event.note ?? '',
      done: event.done,
    }
  }
  if (event.kind === 'startOnly') {
    return {
      title: event.title,
      category: event.category,
      kind: 'startOnly',
      date: event.startAt?.slice(0, 10) ?? today,
      startTime: event.startAt?.slice(11, 16) ?? '09:00',
      endTime: '10:00',
      endDate: today,
      dueDate: today,
      dueTime: '23:59',
      location: event.location ?? '',
      people: event.people ?? '',
      note: event.note ?? '',
      done: event.done,
    }
  }
  return {
    title: event.title,
    category: event.category,
    kind: 'todo',
    date: today,
    startTime: '09:00',
    endTime: '10:00',
    endDate: today,
    dueDate: event.dueAt?.slice(0, 10) ?? today,
    dueTime: event.dueAt?.includes('T') ? event.dueAt.slice(11, 16) : '23:59',
    location: event.location ?? '',
    people: event.people ?? '',
    note: event.note ?? '',
    done: event.done,
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
  const date = defaults?.date ?? formatDate(new Date())
  const startTime = defaults?.startTime ?? '09:00'
  return {
    ...repeatFields(repeat),
    title: '',
    category: defaults?.category ?? 'activity',
    kind: defaults?.kind ?? 'timed',
    date,
    startTime,
    endTime: plusOneHour(startTime),
    endDate: date,
    dueDate: date,
    dueTime: '23:59',
    location: '',
    people: '',
    note: '',
    done: false,
  }
}

function toInput(form: FormState, initial?: EventItem | null): EventInput {
  const base = {
    title: form.title,
    category: form.category,
    location: form.location.trim() || null,
    people: form.people.trim() || null,
    note: form.note.trim() || null,
    recurrenceId: initial?.recurrenceId ?? null,
  }
  if (form.kind === 'timed') {
    return { ...base, kind: 'timed', startAt: `${form.date}T${form.startTime}`, endAt: `${form.endDate}T${form.endTime}` }
  }
  if (form.kind === 'allDay') {
    return { ...base, kind: 'allDay', startAt: form.date, endAt: form.endDate }
  }
  if (form.kind === 'startOnly') {
    return { ...base, kind: 'startOnly', startAt: `${form.date}T${form.startTime}`, endAt: null }
  }
  return { ...base, kind: 'todo', dueAt: `${form.dueDate}T${form.dueTime}` }
}

/** 新建 / 编辑日程弹窗。校验不过不保存；冲突只提示不阻止。 */
export function EventDialog({
  open,
  mode,
  initial,
  defaults,
  siblingEvents = [],
  canDelete = false,
  initialRepeat = null,
  onSave,
  onDelete,
  onClose,
}: EventDialogProps): ReactNode {
  const [form, setForm] = useState<FormState>(() => buildInitial(mode, initial, defaults, initialRepeat))
  const [errors, setErrors] = useState<string[]>([])

  useEffect(() => {
    if (open) {
      setForm(buildInitial(mode, initial, defaults, initialRepeat))
      setErrors([])
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initial?.id, mode, initialRepeat?.freq])

  const update = <K extends keyof FormState>(key: K, value: FormState[K]): void => {
    setForm((current) => ({ ...current, [key]: value }))
  }

  const draft = useMemo(() => toInput(form, initial), [form, initial])

  const conflicts = useMemo(() => {
    if (draft.kind !== 'timed' || !draft.startAt || !draft.endAt) return []
    return findConflicts(
      { startAt: draft.startAt, endAt: draft.endAt, kind: draft.kind, id: initial?.id },
      siblingEvents,
    )
  }, [draft, siblingEvents, initial?.id])

  const titleEmpty = form.title.trim() === ''

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
          }
    onSave(draft, repeat)
  }

  const title = mode === 'create' ? '新建日程' : '编辑日程'

  return (
    <Dialog
      open={open}
      title={title}
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

      <div className="form-row">
        <SelectField
          id="event-category"
          label="类别"
          value={form.category}
          options={CATEGORIES.map((item) => ({ value: item, label: CATEGORY_LABEL[item] }))}
          onChange={(event) => update('category', event.target.value as Category)}
        />
        <SelectField
          id="event-kind"
          label="类型"
          value={form.kind}
          options={KIND_OPTIONS.map((item) => ({ value: item.value, label: item.label }))}
          onChange={(event) => update('kind', event.target.value as EventKind)}
        />
      </div>

      {form.kind === 'timed' ? (
        <>
          <div className="form-row">
            <TextField
              id="event-date"
              label="日期"
              type="date"
              value={form.date}
              onChange={(event) => {
                update('date', event.target.value)
                if (form.endDate < event.target.value) update('endDate', event.target.value)
              }}
            />
            <TextField
              id="event-start"
              label="开始时间"
              type="time"
              value={form.startTime}
              onChange={(event) => update('startTime', event.target.value)}
            />
            <TextField
              id="event-end"
              label="结束时间"
              type="time"
              value={form.endTime}
              onChange={(event) => update('endTime', event.target.value)}
            />
          </div>
          <div className="form-row">
            <TextField
              id="event-end-date"
              label="结束日期（跨天时修改）"
              type="date"
              value={form.endDate}
              onChange={(event) => update('endDate', event.target.value)}
            />
          </div>
        </>
      ) : null}

      {form.kind === 'startOnly' ? (
        <div className="form-row">
          <TextField
            id="event-date"
            label="日期"
            type="date"
            value={form.date}
            onChange={(event) => update('date', event.target.value)}
          />
          <TextField
            id="event-start"
            label="开始时间"
            type="time"
            value={form.startTime}
            onChange={(event) => update('startTime', event.target.value)}
          />
        </div>
      ) : null}

      {form.kind === 'allDay' ? (
        <div className="form-row">
          <TextField
            id="event-date"
            label="开始日期"
            type="date"
            value={form.date}
            onChange={(event) => update('date', event.target.value)}
          />
          <TextField
            id="event-end-date"
            label="结束日期"
            type="date"
            value={form.endDate}
            onChange={(event) => update('endDate', event.target.value)}
          />
        </div>
      ) : null}

      {form.kind === 'todo' ? (
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
