import type { ReactNode } from 'react'
import { PAGES, PAGE_LABEL, type PageKey } from '../../shared/navigation'

export interface NavBarProps {
  page: PageKey
  onSelect: (page: PageKey) => void
}

/** 左侧竖向导航：日历、课程表、课外活动、个人生活、待办，最下方单独分隔出设置。 */
export function NavBar({ page, onSelect }: NavBarProps): ReactNode {
  const mainPages = PAGES.filter((item) => item !== 'settings')
  return (
    <nav className="app-nav" aria-label="主导航">
      <div className="nav-list">
        {mainPages.map((item) => (
          <button
            key={item}
            type="button"
            className={`nav-item${item === page ? ' is-active' : ''}`}
            aria-current={item === page ? 'page' : undefined}
            onClick={() => onSelect(item)}
          >
            {PAGE_LABEL[item]}
          </button>
        ))}
      </div>
      <div className="nav-spacer" />
      <div className="nav-divider" />
      <div className="nav-list">
        <button
          type="button"
          className={`nav-item${page === 'settings' ? ' is-active' : ''}`}
          aria-current={page === 'settings' ? 'page' : undefined}
          onClick={() => onSelect('settings')}
        >
          {PAGE_LABEL.settings}
        </button>
      </div>
    </nav>
  )
}

export interface ToolbarProps {
  title: string
  editing: boolean
  onPrev: () => void
  onNext: () => void
  onToday: () => void
  onCreate: () => void
  onToggleEditing: () => void
}

/** 顶部工具栏：翻页、标题、今天、新建、编辑态切换。 */
export function Toolbar({
  title,
  editing,
  onPrev,
  onNext,
  onToday,
  onCreate,
  onToggleEditing,
}: ToolbarProps): ReactNode {
  return (
    <header className="app-toolbar">
      <button type="button" className="btn btn--ghost btn--sm btn--icon" aria-label="上一页" onClick={onPrev}>
        ‹
      </button>
      <span className="toolbar-title" data-testid="toolbar-title">
        {title}
      </span>
      <button type="button" className="btn btn--ghost btn--sm btn--icon" aria-label="下一页" onClick={onNext}>
        ›
      </button>
      <button type="button" className="btn btn--sm" onClick={onToday}>
        今天
      </button>
      <span className="toolbar-spacer" />
      <button type="button" className="btn btn--primary" onClick={onCreate}>
        ＋ 新建
      </button>
      <button
        type="button"
        className={`btn${editing ? ' btn--active' : ''}`}
        aria-pressed={editing}
        onClick={onToggleEditing}
      >
        {editing ? '完成编辑' : '编辑'}
      </button>
    </header>
  )
}

export interface StatusBarProps {
  dataFilePath: string
  lastBackupAt: string | null
  backupFailed: boolean
  eventCount: number
  dataDirMissing?: boolean
}

/** 底部状态栏：数据位置、上次备份、总条数。 */
export function StatusBar({
  dataFilePath,
  lastBackupAt,
  backupFailed,
  eventCount,
  dataDirMissing = false,
}: StatusBarProps): ReactNode {
  return (
    <footer className="app-status">
      <span className="status-item" title={dataFilePath}>
        数据位置：{dataFilePath}
      </span>
      <span className={`status-item${backupFailed ? ' is-error' : ''}`} style={backupFailed ? { color: 'var(--color-danger)' } : undefined}>
        上次自动备份：{lastBackupAt ?? '尚未备份'}
        {backupFailed ? '（备份失败）' : ''}
      </span>
      <span className="status-item">
        {dataDirMissing ? '数据目录不可用' : `共 ${eventCount} 条日程`}
      </span>
    </footer>
  )
}
