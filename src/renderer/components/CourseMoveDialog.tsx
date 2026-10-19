import { useEffect, useState, type ReactNode } from 'react'
import { Button, TextField } from './Controls'
import { Dialog } from './Feedback'

export interface CourseMoveDialogProps {
  open: boolean
  courseTitle: string
  /** 原本上课的日期 */
  originalDate: string
  defaultStartTime: string
  defaultEndTime: string
  onSave: (payload: { date: string; startTime: string; endTime: string }) => void
  onClose: () => void
}

/** 课程「仅这一次改期」：把某一次课挪到别的日期/时间。 */
export function CourseMoveDialog({
  open,
  courseTitle,
  originalDate,
  defaultStartTime,
  defaultEndTime,
  onSave,
  onClose,
}: CourseMoveDialogProps): ReactNode {
  const [date, setDate] = useState(originalDate)
  const [startTime, setStartTime] = useState(defaultStartTime)
  const [endTime, setEndTime] = useState(defaultEndTime)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setDate(originalDate)
    setStartTime(defaultStartTime)
    setEndTime(defaultEndTime)
    setError(null)
  }, [open, originalDate, defaultStartTime, defaultEndTime])

  const handleSave = (): void => {
    if (!date) {
      setError('请选择调课日期')
      return
    }
    if (startTime >= endTime) {
      setError('结束时间要晚于开始时间')
      return
    }
    setError(null)
    onSave({ date, startTime, endTime })
  }

  return (
    <Dialog
      open={open}
      title="仅这一次改期"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>取消</Button>
          <Button variant="primary" onClick={handleSave}>
            保存
          </Button>
        </>
      }
    >
      <p className="field__hint">
        「{courseTitle}」原本在 {originalDate} 上课。改期后原位置不再显示，只影响这一次。
      </p>
      <div className="form-row">
        <TextField
          id="move-date"
          label="调到哪天"
          type="date"
          value={date}
          onChange={(event) => setDate(event.target.value)}
        />
        <TextField
          id="move-start"
          label="开始时间"
          type="time"
          value={startTime}
          onChange={(event) => setStartTime(event.target.value)}
        />
        <TextField
          id="move-end"
          label="结束时间"
          type="time"
          value={endTime}
          onChange={(event) => setEndTime(event.target.value)}
        />
      </div>
      {error ? (
        <div className="form-error" role="alert">
          {error}
        </div>
      ) : null}
    </Dialog>
  )
}
