import fs from 'node:fs'
import path from 'node:path'
import { DataStore } from '../db/store'
import type { SettingsRepository } from '../db/settings'
import { writeFileAtomic } from '../db/atomic'

export const MAX_BACKUPS = 10
export const BACKUP_PREFIX = 'schedule-'
export const LAST_BACKUP_AT_KEY = 'backup.lastAt'
export const LAST_BACKUP_FAILED_KEY = 'backup.lastFailed'
export const LAST_DAILY_BACKUP_DATE_KEY = 'backup.lastDailyDate'

export interface BackupEntry {
  /** 文件名，例如 schedule-2026-03-04_0900.db */
  fileName: string
  /** 完整路径 */
  filePath: string
  /** 字节数 */
  sizeBytes: number
  /** 备份时间，格式 2026-03-04 09:00 */
  createdAt: string
}

export class BackupError extends Error {
  constructor(
    readonly reason: string,
    readonly detail?: unknown,
  ) {
    super(reason)
    this.name = 'BackupError'
  }
}

function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n)
}

/** schedule-2026-03-04_0900.db */
export function backupFileName(at: Date): string {
  const date = `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`
  const time = `${pad(at.getHours())}${pad(at.getMinutes())}`
  return `${BACKUP_PREFIX}${date}_${time}.db`
}

/** 从文件名解析出可读时间；不符合命名规则返回 null。 */
export function parseBackupTime(fileName: string): string | null {
  const match = /^schedule-(\d{4})-(\d{2})-(\d{2})_(\d{2})(\d{2})\.db$/.exec(fileName)
  if (!match) return null
  const [, year, month, day, hour, minute] = match
  return `${year}-${month}-${day} ${hour}:${minute}`
}

function isBackupFileName(name: string): boolean {
  return parseBackupTime(name) !== null
}

export interface BackupServiceOptions {
  backupDir: string
  dbFilePath: string
  store: () => DataStore | null
  settings: () => SettingsRepository | null
  wasmPath: string
}

/**
 * 自动备份与恢复。
 * 备份 = 把当前整库导出并按时间命名落盘；恢复 = 先给当前数据做一份安全备份，再覆盖。
 */
export class BackupService {
  constructor(private readonly options: BackupServiceOptions) {}

  private get settings(): SettingsRepository | null {
    return this.options.settings()
  }

  /** 现有备份清单，按时间从新到旧。 */
  list(): BackupEntry[] {
    const dir = this.options.backupDir
    if (!fs.existsSync(dir)) return []
    const entries: BackupEntry[] = []
    for (const name of fs.readdirSync(dir)) {
      if (!isBackupFileName(name)) continue
      const filePath = path.join(dir, name)
      let stat: fs.Stats
      try {
        stat = fs.statSync(filePath)
      } catch {
        continue
      }
      if (!stat.isFile()) continue
      entries.push({
        fileName: name,
        filePath,
        sizeBytes: stat.size,
        createdAt: parseBackupTime(name) ?? '',
      })
    }
    return entries.sort((a, b) => (a.fileName < b.fileName ? 1 : -1))
  }

  /** 保留最近 MAX_BACKUPS 份，其余删除。返回被删除的文件名。 */
  prune(): string[] {
    const entries = this.list()
    const removed: string[] = []
    for (const entry of entries.slice(MAX_BACKUPS)) {
      try {
        fs.unlinkSync(entry.filePath)
        removed.push(entry.fileName)
      } catch {
        /* 删不掉就留着，下次再试 */
      }
    }
    return removed
  }

  /** 生成一份备份；失败时记录状态并在错误里说明，不抛出给界面（由调用方决定提示）。 */
  create(now: Date = new Date(), reason: string = 'manual'): BackupEntry {
    const store = this.options.store()
    if (!store) throw new BackupError('数据仓库未就绪，无法备份')
    const dir = this.options.backupDir
    try {
      fs.mkdirSync(dir, { recursive: true })
      const name = backupFileName(now)
      const filePath = path.join(dir, name)
      writeFileAtomic(filePath, store.exportBytes())
      const stat = fs.statSync(filePath)
      this.prune()
      const settings = this.settings
      if (settings) {
        settings.set(LAST_BACKUP_AT_KEY, parseBackupTime(name) ?? '')
        settings.set(LAST_BACKUP_FAILED_KEY, false)
        if (reason === 'daily') {
          settings.set(LAST_DAILY_BACKUP_DATE_KEY, `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`)
        }
      }
      return { fileName: name, filePath, sizeBytes: stat.size, createdAt: parseBackupTime(name) ?? '' }
    } catch (error) {
      const settings = this.settings
      if (settings) {
        settings.set(LAST_BACKUP_FAILED_KEY, true)
        settings.set(LAST_BACKUP_AT_KEY, '')
      }
      if (error instanceof BackupError) throw error
      throw new BackupError('备份失败：无法写入备份文件', error)
    }
  }

  /** 当天是否还没做过每日备份。 */
  shouldRunDaily(now: Date = new Date()): boolean {
    const settings = this.settings
    if (!settings) return false
    const today = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
    return settings.get(LAST_DAILY_BACKUP_DATE_KEY) !== today
  }

  /** 每日首次启动时的备份：当天已做过就跳过。 */
  runDailyIfNeeded(now: Date = new Date()): BackupEntry | null {
    if (!this.shouldRunDaily(now)) return null
    return this.create(now, 'daily')
  }

  /**
   * 从备份恢复。
   * 顺序：校验备份可用 → 给当前数据做安全备份 → 原子覆盖 → 返回安全备份信息。
   * 任何一步失败都不会破坏当前数据。
   */
  async restore(fileName: string): Promise<{ safetyBackup: BackupEntry | null }> {
    const dir = this.options.backupDir
    const sourcePath = path.join(dir, fileName)
    if (!fs.existsSync(sourcePath)) throw new BackupError(`找不到备份文件：${fileName}`)

    const bytes = new Uint8Array(fs.readFileSync(sourcePath))
    // 1. 先确认这份备份真的能打开
    let probe: DataStore
    try {
      probe = await DataStore.open({ filePath: sourcePath, wasmPath: this.options.wasmPath })
      if (probe.checkIntegrity() !== 'ok') throw new Error('完整性检查未通过')
      probe.close()
    } catch (error) {
      throw new BackupError(`备份文件已损坏，无法恢复：${fileName}`, error)
    }

    // 2. 给当前数据留退路
    let safety: BackupEntry | null = null
    if (fs.existsSync(this.options.dbFilePath)) {
      const stamp = new Date()
      const safetyName = `before-restore-${backupFileName(stamp).replace(BACKUP_PREFIX, '')}`
      const safetyPath = path.join(dir, safetyName)
      writeFileAtomic(safetyPath, new Uint8Array(fs.readFileSync(this.options.dbFilePath)))
      safety = {
        fileName: safetyName,
        filePath: safetyPath,
        sizeBytes: fs.statSync(safetyPath).size,
        createdAt: parseBackupTime(safetyName) ?? '',
      }
    }

    // 3. 覆盖（原子写，失败也不会留下半个文件）
    writeFileAtomic(this.options.dbFilePath, bytes)
    return { safetyBackup: safety }
  }
}

/** 备份文件是否可被识别（用于界面提示与测试）。 */
export function isBackupFile(fileName: string): boolean {
  return isBackupFileName(fileName)
}
