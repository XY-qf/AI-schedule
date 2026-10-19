import { useEffect, type ReactNode } from 'react'

export interface DialogProps {
  open: boolean
  title: string
  onClose: () => void
  children: ReactNode
  footer?: ReactNode
  className?: string
}

/** 模态弹窗：点遮罩或按 Esc 关闭，内容区内滚动。 */
export function Dialog({ open, title, onClose, children, footer, className }: DialogProps): ReactNode {
  useEffect(() => {
    if (!open) return undefined
    const handler = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [open, onClose])

  if (!open) return null

  return (
    <div className="dialog-overlay" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div
        className={`dialog${className ? ` ${className}` : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <div className="dialog__header">
          <span className="dialog__title">{title}</span>
          <button type="button" className="btn btn--ghost btn--sm" aria-label="关闭" onClick={onClose}>
            ×
          </button>
        </div>
        <div className="dialog__body">{children}</div>
        {footer ? <div className="dialog__footer">{footer}</div> : null}
      </div>
    </div>
  )
}

export interface ToastProps {
  message: string
  actionLabel?: string
  onAction?: () => void
  onClose?: () => void
}

/** 底部提示条：用于“已添加 [撤销]”这类 5 秒内可撤销的反馈。 */
export function Toast({ message, actionLabel, onAction, onClose }: ToastProps): ReactNode {
  return (
    <div className="toast" role="status">
      <span>{message}</span>
      {actionLabel && onAction ? (
        <button type="button" className="toast__action" onClick={onAction}>
          {actionLabel}
        </button>
      ) : null}
      {onClose ? (
        <button type="button" className="toast__close" aria-label="关闭提示" onClick={onClose}>
          ×
        </button>
      ) : null}
    </div>
  )
}

export interface EmptyStateProps {
  title: string
  description?: string
  actions?: ReactNode
}

export function EmptyState({ title, description, actions }: EmptyStateProps): ReactNode {
  return (
    <div className="empty-state">
      <div className="empty-state__title">{title}</div>
      {description ? <div>{description}</div> : null}
      {actions ? <div className="empty-state__actions">{actions}</div> : null}
    </div>
  )
}
