import type { DataStore } from './db/store'
import type { SettingsRepository } from './db/settings'
import type { AppPaths } from './paths'
import type { StatusPayload } from '../shared/ipc'

export const LAST_BACKUP_AT_KEY = 'backup.lastAt'
export const LAST_BACKUP_FAILED_KEY = 'backup.lastFailed'

export interface BuildStatusInput {
  store: DataStore
  settings: SettingsRepository
  paths: AppPaths
  dataDirMissing?: boolean
  dataDirMessage?: string | null
}

/** 组装状态栏数据。抽成纯函数便于测试。 */
export function buildStatusPayload(input: BuildStatusInput): StatusPayload {
  const { store, settings, paths } = input
  const countRow = store.get<{ total: number }>('SELECT count(*) AS total FROM events')
  const total = countRow ? Number(countRow.total) : 0
  const lastBackupAt = settings.get(LAST_BACKUP_AT_KEY)
  const backupFailed = settings.getBoolean(LAST_BACKUP_FAILED_KEY) ?? false
  return {
    dataFilePath: paths.dbFile,
    lastBackupAt,
    backupFailed,
    eventCount: total,
    dataDirMissing: input.dataDirMissing ?? false,
    dataDirMessage: input.dataDirMessage ?? null,
  }
}

/** 数据目录不可用时的兜底状态（此时没有可用的数据库）。 */
export function unavailableStatus(paths: AppPaths, message: string): StatusPayload {
  return {
    dataFilePath: paths.dbFile,
    lastBackupAt: null,
    backupFailed: false,
    eventCount: 0,
    dataDirMissing: true,
    dataDirMessage: message,
  }
}
