import { useEffect, type ReactNode } from 'react'

export interface ContextMenuItem {
  key: string
  label: string
  danger?: boolean
}

export interface ContextMenuProps {
  x: number
  y: number
  items: ContextMenuItem[]
  onSelect: (key: string) => void
  onClose: () => void
}

/** 简易右键菜单：点外面或按 Esc 关闭。 */
export function ContextMenu({ x, y, items, onSelect, onClose }: ContextMenuProps): ReactNode {
  useEffect(() => {
    const handler = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [onClose])

  if (items.length === 0) return null

  return (
    <div className="context-menu-backdrop" onMouseDown={onClose}>
      <div
        className="context-menu"
        role="menu"
        style={{ left: `${x}px`, top: `${y}px` }}
        onMouseDown={(event) => event.stopPropagation()}
      >
        {items.map((item) => (
          <button
            key={item.key}
            type="button"
            role="menuitem"
            className={`context-menu__item${item.danger ? ' is-danger' : ''}`}
            onClick={() => {
              onSelect(item.key)
              onClose()
            }}
          >
            {item.label}
          </button>
        ))}
      </div>
    </div>
  )
}
