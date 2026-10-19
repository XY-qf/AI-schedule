import fs from 'node:fs'
import path from 'node:path'
import { after, describe, expect, it } from '../helpers/expect'
import { DataStore, timestampNow } from '../../src/main/db/store'
import { EventsRepository } from '../../src/main/db/repositories'
import { LATEST_SCHEMA_VERSION, MIGRATIONS, migrate } from '../../src/main/db/schema'
import { loadSqlJs } from '../../src/main/db/sqljs'

const wasmPath = require.resolve('sql.js/dist/sql-wasm.wasm')
const baseDir = path.join(__dirname, '..', '..', '.tmp-tests-important')
const stores: DataStore[] = []

after(() => {
  for (const store of stores) store.close()
  fs.rmSync(baseDir, { recursive: true, force: true })
})

async function openStore(name: string): Promise<DataStore> {
  const dir = path.join(baseDir, name)
  fs.rmSync(dir, { recursive: true, force: true })
  fs.mkdirSync(dir, { recursive: true })
  const store = await DataStore.open({ filePath: path.join(dir, 'schedule.db'), wasmPath })
  stores.push(store)
  return store
}

describe('重要事项标记（倒计时用）', () => {
  it('表结构版本升到 2，events 多了 important 列', async () => {
    expect(LATEST_SCHEMA_VERSION).toBe(MIGRATIONS.length)
    expect(LATEST_SCHEMA_VERSION > 1).toBe(true)
    const store = await openStore('schema')
    expect(store.schemaVersion).toBe(LATEST_SCHEMA_VERSION)
    const columns = store.all<{ name: string }>('PRAGMA table_info(events)')
    expect(columns.some((column) => column.name === 'important')).toBe(true)
  })

  it('新建重要日程后能读回 true', async () => {
    const store = await openStore('create')
    const repo = new EventsRepository(store)
    const created = repo.create({
      title: '毕业论文答辩',
      category: 'course',
      kind: 'timed',
      startAt: '2026-06-01T09:00',
      endAt: '2026-06-01T11:00',
      important: true,
    })
    expect(created.important).toBe(true)
    expect(repo.get(created.id)?.important).toBe(true)
  })

  it('默认不是重要事项', async () => {
    const store = await openStore('default')
    const repo = new EventsRepository(store)
    const created = repo.create({ title: '普通', category: 'life', kind: 'timed', startAt: '2026-06-01T09:00', endAt: '2026-06-01T10:00' })
    expect(created.important).toBe(false)
  })

  it('可以改成重要，也可以取消', async () => {
    const store = await openStore('toggle')
    const repo = new EventsRepository(store)
    const created = repo.create({ title: '交材料', category: 'life', kind: 'todo', dueAt: '2026-06-02T23:59' })
    expect(created.important).toBe(false)
    expect(repo.update(created.id, { important: true }).important).toBe(true)
    expect(repo.update(created.id, { important: false }).important).toBe(false)
  })

  it('更新其它字段不会把重要标记弄丢', async () => {
    const store = await openStore('keep')
    const repo = new EventsRepository(store)
    const created = repo.create({
      title: '体检',
      category: 'life',
      kind: 'timed',
      startAt: '2026-06-03T09:00',
      endAt: '2026-06-03T10:00',
      important: true,
    })
    const updated = repo.update(created.id, { title: '体检（改）' })
    expect(updated.title).toBe('体检（改）')
    expect(updated.important).toBe(true)
  })

  it('老库（v1）升级后数据仍在，important 为 false', async () => {
    const dir = path.join(baseDir, 'legacy')
    fs.mkdirSync(dir, { recursive: true })
    const file = path.join(dir, 'old.db')

    // 造一个只有 v1 结构的库
    const SQL = await loadSqlJs(wasmPath)
    const raw = new SQL.Database()
    raw.run('BEGIN')
    for (const statement of MIGRATIONS[0]) raw.run(statement)
    raw.run('PRAGMA user_version = 1')
    raw.run('COMMIT')
    const now = timestampNow()
    raw.run(
      `INSERT INTO events (id, title, category, kind, start_at, end_at, due_at, location, people, note, done, recurrence_id, created_at, updated_at)
       VALUES ('old-1','老日程','life','timed','2026-05-01T09:00','2026-05-01T10:00',NULL,NULL,NULL,NULL,0,NULL,?,?)`,
      [now, now],
    )
    const data = raw.export()
    raw.close()
    fs.writeFileSync(file, Buffer.from(data))

    const store = await DataStore.open({ filePath: file, wasmPath })
    stores.push(store)
    expect(store.schemaVersion).toBe(LATEST_SCHEMA_VERSION)
    const repo = new EventsRepository(store)
    const all = repo.list()
    expect(all.length).toBe(1)
    expect(all[0].title).toBe('老日程')
    expect(all[0].important).toBe(false)
  })

  it('migrate 可重复执行（幂等）', async () => {
    const store = await openStore('idempotent')
    expect(store.schemaVersion).toBe(LATEST_SCHEMA_VERSION)
    const SQL = await loadSqlJs(wasmPath)
    const probe = new SQL.Database(store.exportBytes())
    expect(migrate(probe)).toBe(LATEST_SCHEMA_VERSION)
    expect(migrate(probe)).toBe(LATEST_SCHEMA_VERSION)
    probe.close()
  })
})
