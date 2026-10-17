import { useState, type ReactNode } from 'react'
import type { BackupInfo } from '../../shared/ipc'
import { Button, Checkbox } from './Controls'

export interface SettingsPageProps {
  dataFilePath: string
  dataDir: string
  version: string
  backups: BackupInfo[]
  preferences: Record<string, string>
  onOpenFolder: () => void
  onBackupNow: () => void
  onRestore: (fileName: string) => void
  onSetPreference: (key: string, value: string) => void
}

const COLOR_KEYS = [
  { key: 'color.course', label: '课内' },
  { key: 'color.activity', label: '课外活动' },
  { key: 'color.life', label: '个人生活' },
] as const

const DEFAULT_COLORS: Record<string, string> = {
  'color.course': '#3b82f6',
  'color.activity': '#f59e0b',
  'color.life': '#10b981',
}

function sizeText(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

/** 设置页（PRD 6.8）：数据与备份、类别颜色、显示偏好、关于。 */
export function SettingsPage({
  dataFilePath,
  dataDir,
  version,
  backups,
  preferences,
  onOpenFolder,
  onBackupNow,
  onRestore,
  onSetPreference,
}: SettingsPageProps): ReactNode {
  const [pendingRestore, setPendingRestore] = useState<string | null>(null)
  const showTodo = (preferences['display.showTodo'] ?? '1') !== '0'

  return (
    <section className="page" aria-label="设置">
      <div className="page__header">
        <span className="page__title">设置</span>
      </div>
      <div className="page__body settings">
        <section className="settings__block" data-testid="settings-data">
          <h3 className="settings__title">数据与备份</h3>
          <div className="settings__row">
            <span className="settings__label">数据位置</span>
            <code className="settings__value" data-testid="data-path">
              {dataFilePath}
            </code>
            <Button size="sm" onClick={onOpenFolder}>
              打开所在文件夹
            </Button>
          </div>
          <p className="field__hint">
            数据只存在这台电脑上，程序不联网、不上传任何内容。退出时会自动备份，每天首次启动也会备份一次。
          </p>

          <div className="settings__row">
            <span className="settings__label">自动备份</span>
            <span className="settings__value">保留最近 10 份</span>
            <Button size="sm" variant="primary" onClick={onBackupNow}>
              立即备份
            </Button>
          </div>

          {backups.length === 0 ? (
            <p className="day-panel__empty">还没有备份</p>
          ) : (
            <div className="backup-list" data-testid="backup-list">
              {backups.map((backup) => (
                <div key={backup.fileName} className="backup-row" data-testid={`backup-${backup.fileName}`}>
                  <span className="backup-row__time">{backup.createdAt}</span>
                  <span className="backup-row__size">{sizeText(backup.sizeBytes)}</span>
                  <Button size="sm" onClick={() => setPendingRestore(backup.fileName)}>
                    从这份恢复
                  </Button>
                </div>
              ))}
            </div>
          )}

          {pendingRestore ? (
            <div className="settings__confirm" role="alert">
              将用「{pendingRestore}」的数据覆盖当前数据，恢复后程序会自动重启。
              <Button size="sm" onClick={() => setPendingRestore(null)}>
                取消
              </Button>
              <Button
                size="sm"
                variant="danger"
                onClick={() => {
                  onRestore(pendingRestore)
                  setPendingRestore(null)
                }}
              >
                确定恢复
              </Button>
            </div>
          ) : null}
        </section>

        <section className="settings__block">
          <h3 className="settings__title">类别颜色</h3>
          <div className="settings__colors">
            {COLOR_KEYS.map((item) => (
              <label key={item.key} className="settings__color">
                <input
                  type="color"
                  aria-label={`${item.label}颜色`}
                  value={preferences[item.key] ?? DEFAULT_COLORS[item.key]}
                  onChange={(event) => onSetPreference(item.key, event.target.value)}
                />
                <span>{item.label}</span>
              </label>
            ))}
          </div>
          <p className="field__hint">周起始日固定为周一；时间轴固定显示 00:00–24:00。</p>
        </section>

        <section className="settings__block">
          <h3 className="settings__title">显示</h3>
          <Checkbox
            id="show-todo"
            label="在日历的全天条里显示待办"
            checked={showTodo}
            onChange={(checked) => onSetPreference('display.showTodo', checked ? '1' : '0')}
          />
        </section>

        <section className="settings__block">
          <h3 className="settings__title">关于</h3>
          <div className="settings__row">
            <span className="settings__label">版本</span>
            <span className="settings__value">{version}</span>
          </div>
          <div className="settings__row">
            <span className="settings__label">数据目录</span>
            <span className="settings__value">{dataDir}</span>
          </div>
          <p className="field__hint">个人单机使用，不需要账号，也没有手机端。</p>
        </section>
      </div>
    </section>
  )
}
