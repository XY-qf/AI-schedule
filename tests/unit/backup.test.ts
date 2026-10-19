import fs from 'node:fs'
import path from 'node:path'
import { after, describe, expect, it } from '../helpers/expect'
import { DataStore, timestampNow } from '../../src/main/db/store'
import { SettingsRepository } from '../../src/main/db/settings'
import {
  BackupError,
  BackupService,
  LAST_BACKUP_AT_KEY,
  LAST_BACKUP_FAILED_KEY,
  MAX_BACKUPS,
  backupFileName,
  isBackupFile,
  parseBackupTime,
} from '../../src/main/services/backup'
import { resolveAppPaths } from '../../src/main/paths'

const wasmPath = require.resolve('sql.js/dist/sql-wasm.wasm')
const baseDir = path.join(__dirname, '..', '..', '.tmp-tests')

interface Ctx {
  store: DataStore
  repo: SettingsRepository
  service: BackupService
  paths: ReturnType<typeof resolveAppPaths>
}

const openStores: DataStore[] = []

async function makeCtx(name: string): Promise<Ctx> {
  const dir = path.join(baseDir, name)
  fs.rmSync(dir, { recursive: true, force: true })
  fs.mkdirSync(dir, { recursive: true })
  const paths = resolveAppPaths(dir)
  const store = await DataStore.open({ filePath: paths.dbFile, wasmPath })
  openStores.push(store)
  const repo = new SettingsRepository(store)
  const holder = { store: store as DataStore | null, repo: repo as SettingsRepository | null }
  const service = new BackupService({
    backupDir: paths.backupDir,
    dbFilePath: paths.dbFile,
    store: () => holder.store,
    settings: () => holder.repo,
    wasmPath,
  })
  return { store, repo, service, paths }
}

after(() => {
  for (const store of openStores) store.close()
  fs.rmSync(baseDir, { recursive: true, force: true })
})

function insertEvent(store: DataStore, id: string, title: string): void {
  store.run(
    'INSERT INTO events (id, title, category, kind, start_at, end_at, done, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?)',
    [id, title, 'life', 'timed', '2026-03-04T08:00', '2026-03-04T09:00', 0, timestampNow(), timestampNow()],
  )
}

describe('备份文件命名', () => {
  it('按时间生成且可反解', () => {
    const name = backupFileName(new Date(2026, 2, 4, 9, 5))
    expect(name).toBe('schedule-2026-03-04_0905.db')
    expect(parseBackupTime(name)).toBe('2026-03-04 09:05')
  })

  it('不符合命名的文件不被当作备份', () => {
    expect(isBackupFile('随便一个文件.db')).toBe(false)
    expect(parseBackupTime('schedule-2026-3-4_0905.db')).toBeNull()
    expect(parseBackupTime('before-restore-2026-03-04_0905.db')).toBeNull()
    expect(isBackupFile('schedule-2026-03-04_0905.db')).toBe(true)
  })
})

describe('生成备份', () => {
  it('备份文件落盘、清单可见、状态更新', async () => {
    const { store, repo, service, paths } = await makeCtx('backup-create')
    insertEvent(store, 'e1', '交作业')

    const entry = service.create(new Date(2026, 2, 4, 9, 0))
    expect(fs.existsSync(entry.filePath)).toBe(true)
    expect(entry.sizeBytes).toBeGreaterThan(0)
    expect(repo.get(LAST_BACKUP_AT_KEY)).toBe('2026-03-04 09:00')
    expect(repo.getBoolean(LAST_BACKUP_FAILED_KEY)).toBe(false)

    const list = service.list()
    expect(list.length).toBe(1)
    expect(list[0].fileName).toBe('schedule-2026-03-04_0900.db')
    expect(fs.existsSync(paths.backupDir)).toBe(true)
  })

  it('重复同一分钟备份不会报错', async () => {
    const { service } = await makeCtx('backup-same-minute')
    const at = new Date(2026, 2, 4, 9, 0)
    service.create(at)
    service.create(at)
    expect(service.list().length).toBe(1)
  })

  it('数据仓库不可用时抛明确错误', async () => {
    const { service } = await makeCtx('backup-no-store')
    const broken = new BackupService({
      backupDir: path.join(baseDir, 'backup-no-store', 'backups'),
      dbFilePath: path.join(baseDir, 'backup-no-store', 'x.db'),
      store: () => null,
      settings: () => null,
      wasmPath,
    })
    expect(() => broken.create()).toThrow('数据仓库未就绪')
    // 原服务仍然正常
    expect(service.create(new Date(2026, 2, 4, 10, 0)).fileName).toContain('schedule-')
  })
})

describe('保留份数', () => {
  it(`最多保留 ${MAX_BACKUPS} 份，最旧的被删除`, async () => {
    const { service } = await makeCtx('backup-prune')
    for (let i = 0; i < 12; i += 1) {
      service.create(new Date(2026, 2, 1, 8, i))
    }
    const list = service.list()
    expect(list.length).toBe(MAX_BACKUPS)
    const names = list.map((item) => item.fileName)
    expect(names).toContain('schedule-2026-03-01_0811.db')
    expect(names).toContain('schedule-2026-03-01_0802.db')
    expect(names).not.toContain('schedule-2026-03-01_0801.db')
    expect(names).not.toContain('schedule-2026-03-01_0800.db')
    // 清单按时间从新到旧
    expect(names[0]).toBe('schedule-2026-03-01_0811.db')
  })
})

describe('每日备份', () => {
  it('同一天只做一次', async () => {
    const { service } = await makeCtx('backup-daily')
    const day1 = new Date(2026, 2, 4, 9, 0)
    expect(service.shouldRunDaily(day1)).toBe(true)
    const first = service.runDailyIfNeeded(day1)
    expect(first?.fileName).toBe('schedule-2026-03-04_0900.db')
    expect(service.shouldRunDaily(day1)).toBe(false)
    expect(service.runDailyIfNeeded(new Date(2026, 2, 4, 18, 0))).toBeNull()
  })

  it('第二天会再次备份', async () => {
    const { service } = await makeCtx('backup-daily-2')
    service.runDailyIfNeeded(new Date(2026, 2, 4, 9, 0))
    expect(service.shouldRunDaily(new Date(2026, 2, 5, 8, 0))).toBe(true)
    expect(service.runDailyIfNeeded(new Date(2026, 2, 5, 8, 0))?.fileName).toBe(
      'schedule-2026-03-05_0800.db',
    )
  })

  it('没有设置仓库时不乱报要备份', async () => {
    const service = new BackupService({
      backupDir: path.join(baseDir, 'backup-no-settings', 'backups'),
      dbFilePath: path.join(baseDir, 'backup-no-settings', 'x.db'),
      store: () => null,
      settings: () => null,
      wasmPath,
    })
    expect(service.shouldRunDaily()).toBe(false)
  })
})

describe('从备份恢复', () => {
  it('恢复后数据回到备份时的状态，并为当前数据留下安全备份', async () => {
    const { store, service, paths } = await makeCtx('restore-ok')
    insertEvent(store, 'old', '备份前就有的')
    const entry = service.create(new Date(2026, 2, 4, 9, 0))

    // 备份之后又加了新数据
    insertEvent(store, 'new', '备份之后加的')
    expect(store.all('SELECT id FROM events').length).toBe(2)

    const { safetyBackup } = await service.restore(entry.fileName)
    expect(safetyBackup).not.toBeNull()
    expect(fs.existsSync(safetyBackup?.filePath ?? '')).toBe(true)

    // 重新打开后应只剩备份时的那一条
    store.close()
    const reopened = await DataStore.open({ filePath: paths.dbFile, wasmPath })
    openStores.push(reopened)
    const rows = reopened.all<{ id: string }>('SELECT id FROM events ORDER BY id')
    expect(rows.map((row) => row.id)).toEqual(['old'])
    expect(reopened.checkIntegrity()).toBe('ok')
  })

  it('备份文件损坏时拒绝恢复，当前数据不受影响', async () => {
    const { store, service } = await makeCtx('restore-corrupt')
    insertEvent(store, 'keep', '不能丢的数据')
    const entry = service.create(new Date(2026, 2, 4, 9, 0))
    fs.writeFileSync(entry.filePath, Buffer.from('这不是数据库'))

    let caught: unknown = null
    try {
      await service.restore(entry.fileName)
    } catch (error) {
      caught = error
    }
    expect(caught instanceof BackupError).toBe(true)
    expect((caught as BackupError).message).toContain('备份文件已损坏')
    expect(store.all('SELECT id FROM events').length).toBe(1)
  })

  it('备份文件不存在时报错', async () => {
    const { service } = await makeCtx('restore-missing')
    let caught: unknown = null
    try {
      await service.restore('schedule-2020-01-01_0000.db')
    } catch (error) {
      caught = error
    }
    expect(caught instanceof BackupError).toBe(true)
    expect((caught as BackupError).message).toContain('找不到备份文件')
  })

  it('安全备份不会被保留份数策略清掉', async () => {
    const { store, service } = await makeCtx('restore-safety-kept')
    insertEvent(store, 'a', 'A')
    const entry = service.create(new Date(2026, 2, 4, 9, 0))
    const { safetyBackup } = await service.restore(entry.fileName)
    for (let i = 0; i < 12; i += 1) service.create(new Date(2026, 2, 6, 8, i))
    expect(fs.existsSync(safetyBackup?.filePath ?? '')).toBe(true)
  })
})
