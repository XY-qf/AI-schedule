import { useEffect, useState, type ReactNode } from 'react'
import {
  RECURRENCE_SCOPE_HINT,
  RECURRENCE_SCOPE_LABEL,
  type RecurrenceScope,
} from '../../shared/recurrence'
import { Button } from './Controls'
import { Dialog } from './Feedback'

export interface ScopeDialogProps {
  open: boolean
  /** 弹窗标题，例如「这次修改要应用到哪些日程？」 */
  title: string
  /** 确认按钮文案，删除时用「删除」 */
  confirmLabel?: string
  danger?: boolean
  onSelect: (scope: RecurrenceScope) => void
  onClose: () => void
}

const ORDER: RecurrenceScope[] = ['single', 'following', 'all']

/** 重复日程「仅这一次 / 这一次及以后 / 全部」三选一（PRD 7.2）。 */
export function ScopeDialog({
  open,
  title,
  confirmLabel = '确定',
  danger = false,
  onSelect,
  onClose,
}: ScopeDialogProps): ReactNode {
  const [scope, setScope] = useState<RecurrenceScope>('single')

  useEffect(() => {
    if (open) setScope('single')
  }, [open])

  return (
    <Dialog
      open={open}
      title={title}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>取消</Button>
          <Button variant={danger ? 'danger' : 'primary'} onClick={() => onSelect(scope)}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className="scope-options">
        {ORDER.map((item) => (
          <label
            key={item}
            className={`scope-option${scope === item ? ' is-active' : ''}`}
            data-testid={`scope-${item}`}
          >
            <input
              type="radio"
              name="recurrence-scope"
              value={item}
              checked={scope === item}
              onChange={() => setScope(item)}
            />
            <span className="scope-option__label">{RECURRENCE_SCOPE_LABEL[item]}</span>
            <span className="scope-option__hint">{RECURRENCE_SCOPE_HINT[item]}</span>
          </label>
        ))}
      </div>
    </Dialog>
  )
}
