import { describe, expect, it } from '../helpers/expect'
import { readInitialLocation } from '../../src/renderer/initialLocation'
import { buildStatusPayload, unavailableStatus, LAST_BACKUP_AT_KEY, LAST_BACKUP_FAILED_KEY } from '../../src/main/status'
import { DataStore } from '../../src/main/db/store'
import { SettingsRepository } from '../../src/main/db/settings'
import { resolveAppPaths } from '../../src/main/paths'
import fs from 'node:fs'
import path from 'node:path'
import { after } from '../helpers/expect'
import { timestampNow } from '../../src/main/db/store'

const wasmPath = require.resolve('sql.js/dist/sql-wasm.wasm')
const baseDir = path.join(__dirname, '..', '..', '.tmp-tests')

after(() => {
  fs.rmSync(baseDir, { recursive: true, force: true })
})

async function openStore(name: string): Promise<{ store: DataStore; repo: SettingsRepository; paths: ReturnType<typeof resolveAppPaths> }> {
  const dir = path.join(baseDir, name)
  fs.rmSync(dir, { recursive: true, force: true })
  const paths = resolveAppPaths(dir)
  const store = await DataStore.open({ filePath: paths.dbFile, wasmPath })
  return { store, repo: new SettingsRepository(store), paths }
}

describe('启动时的页面恢复参数', () => {
  it('没有参数时回到日历周视图', () => {
    expect(readInitialLocation('')).toEqual({ page: 'calendar', view: 'week' })
  })

  it('读取合法参数', () => {
    expect(readInitialLocation('?page=todo&view=month')).toEqual({ page: 'todo', view: 'month' })
  })

  it('非法参数退回默认，不会白屏', () => {
    expect(readInitialLocation('?page=hack&view=year')).toEqual({ page: 'calendar', view: 'week' })
    expect(readInitialLocation('?page=&view=')).toEqual({ page: 'calendar', view: 'week' })
  })
})

describe('状态栏数据组装', () => {
  it('空库时条数为 0、无备份时间', async () => {
    const { store, repo, paths } = await openStore('status-empty')
    const payload = buildStatusPayload({ store, settings: repo, paths })
    expect(payload.eventCount).toBe(0)
    expect(payload.lastBackupAt).toBeNull()
    expect(payload.backupFailed).toBe(false)
    expect(payload.dataDirMissing).toBe(false)
    expect(payload.dataFilePath).toBe(paths.dbFile)
    store.close()
  })

  it('条数来自 events 表，备份信息来自设置', async () => {
    const { store, repo, paths } = await openStore('status-filled')
    for (const id of ['a', 'b', 'c']) {
      store.run(
        'INSERT INTO events (id, title, category, kind, start_at, end_at, done, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?)',
        [id, `日程${id}`, 'life', 'timed', '2026-03-04T08:00', '2026-03-04T09:00', 0, timestampNow(), timestampNow()],
      )
    }
    repo.set(LAST_BACKUP_AT_KEY, '2026-03-04 09:00')
    repo.set(LAST_BACKUP_FAILED_KEY, true)
    const payload = buildStatusPayload({ store, settings: repo, paths })
    expect(payload.eventCount).toBe(3)
    expect(payload.lastBackupAt).toBe('2026-03-04 09:00')
    expect(payload.backupFailed).toBe(true)
    store.close()
  })

  it('数据目录不可用时的兜底状态', () => {
    const paths = resolveAppPaths('C:\\docs')
    const payload = unavailableStatus(paths, '目录不可写')
    expect(payload.dataDirMissing).toBe(true)
    expect(payload.dataDirMessage).toBe('目录不可写')
    expect(payload.eventCount).toBe(0)
  })
})
