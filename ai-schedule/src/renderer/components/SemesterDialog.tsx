import { useEffect, useState, type ReactNode } from 'react'
import type { Semester, SemesterInput } from '../../shared/entities'
import { validateSemesterInput } from '../../shared/entities'
import { Button, TextField } from './Controls'
import { Dialog } from './Feedback'

export interface SemesterDialogProps {
  open: boolean
  mode: 'create' | 'edit'
  initial?: Semester | null
  onSave: (input: SemesterInput) => void
  onDelete?: () => void
  canDelete?: boolean
  onClose: () => void
}

/** 学期设置：名称、开学日期（第 1 周周一）、总周数。 */
export function SemesterDialog({
  open,
  mode,
  initial,
  onSave,
  onDelete,
  canDelete = false,
  onClose,
}: SemesterDialogProps): ReactNode {
  const [name, setName] = useState(initial?.name ?? '')
  const [startDate, setStartDate] = useState(initial?.startDate ?? '')
  const [weeks, setWeeks] = useState(String(initial?.weeks ?? 18))
  const [errors, setErrors] = useState<string[]>([])

  // 弹窗常驻挂载，打开时按传入的学期重置
  useEffect(() => {
    if (!open) return
    setName(initial?.name ?? '')
    setStartDate(initial?.startDate ?? '')
    setWeeks(String(initial?.weeks ?? 18))
    setErrors([])
  }, [open, initial?.id])

  const handleSave = (): void => {
    const input: SemesterInput = { name, startDate, weeks: Number(weeks) }
    const messages = validateSemesterInput(input)
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
      title={mode === 'create' ? '新建学期' : '学期设置'}
      onClose={onClose}
      footer={
        <>
          {mode === 'edit' && canDelete && onDelete ? (
            <Button variant="danger" onClick={onDelete} style={{ marginRight: 'auto' }}>
              删除学期
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
        id="semester-name"
        label="学期名称"
        required
        placeholder="例如：2026 春季"
        value={name}
        autoFocus
        onChange={(event) => setName(event.target.value)}
      />
      <div className="form-row">
        <TextField
          id="semester-start"
          label="开学日期（第 1 周的周一）"
          type="date"
          value={startDate}
          onChange={(event) => setStartDate(event.target.value)}
        />
        <TextField
          id="semester-weeks"
          label="总周数"
          type="number"
          min={1}
          value={weeks}
          onChange={(event) => setWeeks(event.target.value)}
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
