import { useEffect, useMemo, useState, type ReactNode } from 'react'
import type { Course, CourseInput, OddEven, Period, TimeMode } from '../../shared/entities'
import { validateCourseInput } from '../../shared/entities'
import { Button, SelectField, TextField } from './Controls'
import { Dialog } from './Feedback'
import { ODD_EVEN_LABEL } from '../../shared/courseUi'

export interface CourseDialogProps {
  open: boolean
  mode: 'create' | 'edit'
  initial?: Course | null
  semesterId: string
  periods: Period[]
  defaults?: { weekday?: number; periodIndex?: number }
  canDelete?: boolean
  onSave: (input: CourseInput) => void
  onDelete?: () => void
  onClose: () => void
}

interface FormState {
  title: string
  teacher: string
  location: string
  weekday: number
  timeMode: TimeMode
  startPeriod: number
  endPeriod: number
  startTime: string
  endTime: string
  weekFrom: number
  weekTo: number
  oddEven: OddEven
}

function buildInitial(
  mode: 'create' | 'edit',
  initial: Course | null | undefined,
  defaults: CourseDialogProps['defaults'],
): FormState {
  if (mode === 'edit' && initial) {
    return {
      title: initial.title,
      teacher: initial.teacher ?? '',
      location: initial.location ?? '',
      weekday: initial.weekday,
      timeMode: initial.timeMode,
      startPeriod: initial.startPeriod ?? 1,
      endPeriod: initial.endPeriod ?? 1,
      startTime: initial.startTime ?? '08:00',
      endTime: initial.endTime ?? '09:40',
      weekFrom: initial.weekFrom,
      weekTo: initial.weekTo,
      oddEven: initial.oddEven,
    }
  }
  const periodIndex = defaults?.periodIndex ?? 1
  return {
    title: '',
    teacher: '',
    location: '',
    weekday: defaults?.weekday ?? 1,
    timeMode: 'period',
    startPeriod: periodIndex,
    endPeriod: periodIndex,
    startTime: '08:00',
    endTime: '09:40',
    weekFrom: 1,
    weekTo: 16,
    oddEven: 'all',
  }
}

/** 课程录入弹窗：支持节次与具体时间两种方式，含单双周与周次范围。 */
export function CourseDialog({
  open,
  mode,
  initial,
  semesterId,
  periods,
  defaults,
  canDelete = false,
  onSave,
  onDelete,
  onClose,
}: CourseDialogProps): ReactNode {
  const [form, setForm] = useState<FormState>(() => buildInitial(mode, initial, defaults))
  const [errors, setErrors] = useState<string[]>([])

  // 弹窗常驻挂载，每次打开都要按最新的默认值/待编辑课程重置表单
  useEffect(() => {
    if (!open) return
    setForm(buildInitial(mode, initial, defaults))
    setErrors([])
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initial?.id, mode, defaults?.weekday, defaults?.periodIndex])

  const update = <K extends keyof FormState>(key: K, value: FormState[K]): void => {
    setForm((current) => {
      const next = { ...current, [key]: value }
      if (key === 'startPeriod' && next.endPeriod < next.startPeriod) next.endPeriod = next.startPeriod
      return next
    })
  }

  const periodOptions = useMemo(
    () =>
      periods.map((period) => ({
        value: String(period.orderIndex),
        label: `${period.name}（${period.startTime}）`,
      })),
    [periods],
  )

  const handleSave = (): void => {
    const input: CourseInput = {
      semesterId,
      title: form.title,
      teacher: form.teacher.trim() || null,
      location: form.location.trim() || null,
      weekday: form.weekday,
      timeMode: form.timeMode,
      startPeriod: form.timeMode === 'period' ? form.startPeriod : null,
      endPeriod: form.timeMode === 'period' ? form.endPeriod : null,
      startTime: form.timeMode === 'clock' ? form.startTime : null,
      endTime: form.timeMode === 'clock' ? form.endTime : null,
      weekFrom: form.weekFrom,
      weekTo: form.weekTo,
      oddEven: form.oddEven,
    }
    const messages = validateCourseInput(input)
    if (messages.length > 0) {
      setErrors(messages)
      return
    }
    setErrors([])
    onSave(input)
  }

  return (
    <Dialog
      open={open}
      title={mode === 'create' ? '新建课程' : '编辑课程'}
      onClose={onClose}
      footer={
        <>
          {mode === 'edit' && canDelete && onDelete ? (
            <Button variant="danger" onClick={onDelete} style={{ marginRight: 'auto' }}>
              删除
            </Button>
          ) : null}
          <Button onClick={onClose}>取消</Button>
          <Button variant="primary" onClick={handleSave}>
            保存
          </Button>
        </>
      }
    >
      <TextField
        id="course-title"
        label="课名"
        required
        value={form.title}
        autoFocus
        placeholder="例如：高等数学"
        onChange={(event) => update('title', event.target.value)}
      />

      <div className="form-row">
        <TextField
          id="course-teacher"
          label="老师"
          value={form.teacher}
          onChange={(event) => update('teacher', event.target.value)}
        />
        <TextField
          id="course-location"
          label="地点"
          value={form.location}
          onChange={(event) => update('location', event.target.value)}
        />
      </div>

      <div className="form-row">
        <SelectField
          id="course-weekday"
          label="星期"
          value={String(form.weekday)}
          options={[1, 2, 3, 4, 5, 6, 7].map((day) => ({ value: String(day), label: `周${['一', '二', '三', '四', '五', '六', '日'][day - 1]}` }))}
          onChange={(event) => update('weekday', Number(event.target.value))}
        />
        <SelectField
          id="course-time-mode"
          label="时间方式"
          value={form.timeMode}
          options={[
            { value: 'period', label: '按第几节' },
            { value: 'clock', label: '按具体时间' },
          ]}
          onChange={(event) => update('timeMode', event.target.value as TimeMode)}
        />
      </div>

      {form.timeMode === 'period' ? (
        <div className="form-row">
          <SelectField
            id="course-start-period"
            label="开始节次"
            value={String(form.startPeriod)}
            options={periodOptions}
            onChange={(event) => update('startPeriod', Number(event.target.value))}
          />
          <SelectField
            id="course-end-period"
            label="结束节次"
            value={String(form.endPeriod)}
            options={periodOptions}
            onChange={(event) => update('endPeriod', Number(event.target.value))}
          />
        </div>
      ) : (
        <div className="form-row">
          <TextField
            id="course-start-time"
            label="开始时间"
            type="time"
            value={form.startTime}
            onChange={(event) => update('startTime', event.target.value)}
          />
          <TextField
            id="course-end-time"
            label="结束时间"
            type="time"
            value={form.endTime}
            onChange={(event) => update('endTime', event.target.value)}
          />
        </div>
      )}

      <div className="form-row">
        <TextField
          id="course-week-from"
          label="起始周"
          type="number"
          min={1}
          value={String(form.weekFrom)}
          onChange={(event) => update('weekFrom', Number(event.target.value))}
        />
        <TextField
          id="course-week-to"
          label="结束周"
          type="number"
          min={1}
          value={String(form.weekTo)}
          onChange={(event) => update('weekTo', Number(event.target.value))}
        />
        <SelectField
          id="course-odd-even"
          label="单双周"
          value={form.oddEven}
          options={(['all', 'odd', 'even'] as OddEven[]).map((value) => ({ value, label: ODD_EVEN_LABEL[value] }))}
          onChange={(event) => update('oddEven', event.target.value as OddEven)}
        />
      </div>

      {errors.length > 0 ? (
        <div className="form-error" role="alert">
          {errors.map((message) => (
            <div key={message}>{message}</div>
          ))}
        </div>
      ) : null}
    </Dialog>
  )
}
