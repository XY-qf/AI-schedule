import { useEffect, useState, type ReactNode } from 'react'
import type { Period, PeriodInput } from '../../shared/entities'
import { validatePeriodInput } from '../../shared/entities'
import { Button } from './Controls'
import { Dialog } from './Feedback'

export interface PeriodsDialogProps {
  open: boolean
  periods: Period[]
  onSave: (items: PeriodInput[]) => void
  onReset: () => void
  onClose: () => void
}

interface Row {
  key: string
  name: string
  startTime: string
  endTime: string
}

let rowSeed = 0

function toRows(periods: Period[]): Row[] {
  if (periods.length === 0) {
    return [{ key: `p${(rowSeed += 1)}`, name: '第 1 节', startTime: '08:00', endTime: '08:45' }]
  }
  return periods.map((period) => ({
    key: period.id,
    name: period.name,
    startTime: period.startTime,
    endTime: period.endTime,
  }))
}

/** 作息时间表编辑：节次 ↔ 具体时间，改完所有按节次排的课程跟着变。 */
export function PeriodsDialog({ open, periods, onSave, onReset, onClose }: PeriodsDialogProps): ReactNode {
  const [rows, setRows] = useState<Row[]>(() => toRows(periods))
  const [errors, setErrors] = useState<string[]>([])

  // 每次打开都按当前作息重置编辑行
  useEffect(() => {
    if (!open) return
    setRows(toRows(periods))
    setErrors([])
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const update = (index: number, patch: Partial<Row>): void => {
    setRows((current) => current.map((row, i) => (i === index ? { ...row, ...patch } : row)))
  }

  const handleSave = (): void => {
    const items: PeriodInput[] = rows.map((row) => ({
      name: row.name,
      startTime: row.startTime,
      endTime: row.endTime,
    }))
    const messages: string[] = []
    for (const item of items) messages.push(...validatePeriodInput(item))
    if (messages.length > 0) {
      setErrors(messages)
      return
    }
    setErrors([])
    onSave(items)
  }

  return (
    <Dialog
      open={open}
      title="作息时间表"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onReset} style={{ marginRight: 'auto' }}>
            恢复默认
          </Button>
          <Button onClick={onClose}>取消</Button>
          <Button variant="primary" onClick={handleSave}>
            保存
          </Button>
        </>
      }
    >
      <div className="periods-list">
        <div className="periods-list__head">
          <span>节次名称</span>
          <span>开始</span>
          <span>结束</span>
          <span />
        </div>
        {rows.map((row, index) => (
          <div key={row.key} className="periods-list__row" data-testid={`period-row-${index}`}>
            <input
              className="field__input"
              aria-label={`第 ${index + 1} 行节次名称`}
              value={row.name}
              onChange={(event) => update(index, { name: event.target.value })}
            />
            <input
              className="field__input"
              type="time"
              aria-label={`第 ${index + 1} 行开始时间`}
              value={row.startTime}
              onChange={(event) => update(index, { startTime: event.target.value })}
            />
            <input
              className="field__input"
              type="time"
              aria-label={`第 ${index + 1} 行结束时间`}
              value={row.endTime}
              onChange={(event) => update(index, { endTime: event.target.value })}
            />
            <button
              type="button"
              className="btn btn--ghost btn--sm"
              aria-label={`删除第 ${index + 1} 行`}
              onClick={() => setRows((current) => current.filter((_, i) => i !== index))}
            >
              删除
            </button>
          </div>
        ))}
        <Button
          size="sm"
          onClick={() =>
            setRows((current) => [
              ...current,
              {
                key: `p${(rowSeed += 1)}`,
                name: `第 ${current.length + 1} 节`,
                startTime: '08:00',
                endTime: '08:45',
              },
            ])
          }
        >
          ＋ 添加一节
        </Button>
      </div>
      {errors.length > 0 ? (
        <div className="form-error" role="alert">
          {errors.map((message, index) => (
            <div key={`${message}-${index}`}>{message}</div>
          ))}
        </div>
      ) : null}
      <p className="field__hint">修改后保存，所有按节次排的课程显示时间会同步更新。</p>
    </Dialog>
  )
}
