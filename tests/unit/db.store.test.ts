import fs from 'node:fs'
import path from 'node:path'
import { after, describe, expect, it } from '../helpers/expect'
import { DataStore, CorruptDataFileError, timestampNow } from '../../src/main/db/store'
import { LATEST_SCHEMA_VERSION } from '../../src/main/db/schema'
import { listTempFiles, readFileIfExists, writeFileAtomic } from '../../src/main/db/atomic'

const wasmPath = require.resolve('sql.js/dist/sql-wasm.wasm')
const baseDir = path.join(__dirname, '..', '..', '.tmp-tests')

function freshDir(name: string): string {
  const dir = path.join(baseDir, name)
  fs.rmSync(dir, { recursive: true, force: true })
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

after(() => {
  fs.rmSync(baseDir, { recursive: true, force: true })
})

describe('数据文件与建库', () => {
  it('首次打开自动建库、建表并落盘', async () => {
    const dir = freshDir('create')
    const file = path.join(dir, 'schedule.db')
    const store = await DataStore.open({ filePath: file, wasmPath })
    const tables = store.listTables()
    expect(tables).toEqual([
      'course_exceptions',
      'courses',
      'event_exceptions',
      'events',
      'periods',
      'recurrences',
      'semesters',
      'settings',
    ])
    expect(store.schemaVersion).toBe(LATEST_SCHEMA_VERSION)
    expect(store.expectedSchemaVersion).toBe(LATEST_SCHEMA_VERSION)
    expect(fs.existsSync(file)).toBe(true)
    expect(fs.statSync(file).size).toBeGreaterThan(0)
    expect(store.checkIntegrity()).toBe('ok')
    store.close()
  })

  it('写入后关闭再打开，数据仍然存在（模拟重启）', async () => {
    const dir = freshDir('persist')
    const file = path.join(dir, 'schedule.db')
    const first = await DataStore.open({ filePath: file, wasmPath })
    first.run(
      'INSERT INTO settings (key, value) VALUES (?, ?)',
      ['theme', 'light'],
    )
    first.run(
      'INSERT INTO events (id, title, category, kind, start_at, end_at, done, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?)',
      ['e1', '高数', 'course', 'timed', '2026-03-04T08:00', '2026-03-04T09:40', 0, timestampNow(), timestampNow()],
    )
    first.close()

    const second = await DataStore.open({ filePath: file, wasmPath })
    const row = second.get<{ title: string }>('SELECT title FROM events WHERE id = ?', ['e1'])
    expect(row?.title).toBe('高数')
    const setting = second.get<{ value: string }>('SELECT value FROM settings WHERE key = ?', ['theme'])
    expect(setting?.value).toBe('light')
    expect(second.checkIntegrity()).toBe('ok')
    second.close()
  })

  it('重复打开不会重复建表，版本保持稳定', async () => {
    const dir = freshDir('idempotent')
    const file = path.join(dir, 'schedule.db')
    const store = await DataStore.open({ filePath: file, wasmPath })
    store.close()
    const again = await DataStore.open({ filePath: file, wasmPath })
    expect(again.schemaVersion).toBe(LATEST_SCHEMA_VERSION)
    expect(again.listTables().length).toBe(8)
    again.close()
  })
})

describe('原子写入', () => {
  it('写入后不留下临时文件', async () => {
    const dir = freshDir('atomic')
    const file = path.join(dir, 'schedule.db')
    const store = await DataStore.open({ filePath: file, wasmPath })
    store.run('INSERT INTO settings (key, value) VALUES (?, ?)', ['a', '1'])
    store.run('INSERT INTO settings (key, value) VALUES (?, ?)', ['b', '2'])
    expect(listTempFiles(dir)).toEqual([])
    store.close()
  })

  it('writeFileAtomic 覆盖已有文件且内容完整', () => {
    const dir = freshDir('atomic2')
    const file = path.join(dir, 'x.bin')
    writeFileAtomic(file, new Uint8Array([1, 2, 3]))
    expect(Array.from(readFileIfExists(file) ?? [])).toEqual([1, 2, 3])
    writeFileAtomic(file, new Uint8Array([9, 8]))
    expect(Array.from(readFileIfExists(file) ?? [])).toEqual([9, 8])
    expect(listTempFiles(dir)).toEqual([])
  })

  it('文件不存在时读取返回 null', () => {
    const dir = freshDir('missing')
    expect(readFileIfExists(path.join(dir, 'nope.db'))).toBeNull()
  })
})

describe('异常处理', () => {
  it('数据文件损坏时抛出可识别的错误，而不是静默新建空库', async () => {
    const dir = freshDir('corrupt')
    const file = path.join(dir, 'schedule.db')
    fs.writeFileSync(file, Buffer.from('this is not a sqlite database at all'))
    let caught: unknown = null
    try {
      await DataStore.open({ filePath: file, wasmPath })
    } catch (error) {
      caught = error
    }
    expect(caught instanceof CorruptDataFileError).toBe(true)
    expect((caught as CorruptDataFileError).filePath).toBe(file)
  })

  it('事务失败会回滚，已有数据不受影响', async () => {
    const dir = freshDir('tx')
    const file = path.join(dir, 'schedule.db')
    const store = await DataStore.open({ filePath: file, wasmPath })
    store.run('INSERT INTO settings (key, value) VALUES (?, ?)', ['keep', 'yes'])

    let threw = false
    try {
      store.transaction(() => {
        store.run('INSERT INTO settings (key, value) VALUES (?, ?)', ['temp', 'gone'])
        throw new Error('人为失败')
      })
    } catch {
      threw = true
    }
    expect(threw).toBe(true)

    expect(store.get<{ value: string }>('SELECT value FROM settings WHERE key = ?', ['keep'])?.value).toBe('yes')
    expect(store.get('SELECT value FROM settings WHERE key = ?', ['temp'])).toBeNull()
    store.close()
  })

  it('关闭后继续使用会报错', async () => {
    const dir = freshDir('closed')
    const store = await DataStore.open({ filePath: path.join(dir, 'schedule.db'), wasmPath })
    store.close()
    expect(() => store.all('SELECT 1')).toThrow('已关闭')
  })
})

describe('时间戳', () => {
  it('timestampNow 输出可排序的本地时间字符串', () => {
    const stamp = timestampNow()
    expect(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(stamp)).toBe(true)
  })
})
