import type { Database, SqlValue } from 'sql.js'
import { loadSqlJs } from './sqljs'
import { migrate, readSchemaVersion, LATEST_SCHEMA_VERSION } from './schema'
import { readFileIfExists, writeFileAtomic } from './atomic'

export type Row = Record<string, SqlValue>
export type Params = SqlValue[]

export class CorruptDataFileError extends Error {
  constructor(
    readonly filePath: string,
    readonly detail?: unknown,
  ) {
    super(`数据文件无法打开，可能已损坏：${filePath}`)
    this.name = 'CorruptDataFileError'
  }
}

export interface DataStoreOptions {
  /** 数据文件绝对路径，例如 文档\AI日程\schedule.db */
  filePath: string
  /** sql.js 的 wasm 文件绝对路径 */
  wasmPath: string
}

/**
 * 本地数据仓库：SQLite（WASM）单文件 + 每次写入后原子落盘。
 * 不依赖原生模块，因此在 Electron 主进程与 Vitest 里行为完全一致。
 */
export class DataStore {
  private closed = false
  private transactionDepth = 0

  private constructor(
    private readonly database: Database,
    readonly filePath: string,
  ) {}

  static async open(options: DataStoreOptions): Promise<DataStore> {
    const SQL = await loadSqlJs(options.wasmPath)
    const bytes = readFileIfExists(options.filePath)
    let database: Database
    if (bytes && bytes.length > 0) {
      try {
        database = new SQL.Database(bytes)
        // 触发一次真实查询，确认文件确实是可用的 SQLite 库
        database.exec('SELECT count(*) FROM sqlite_master')
      } catch (error) {
        throw new CorruptDataFileError(options.filePath, error)
      }
    } else {
      database = new SQL.Database()
    }
    migrate(database)
    const store = new DataStore(database, options.filePath)
    if (!bytes || bytes.length === 0) store.persist()
    return store
  }

  get schemaVersion(): number {
    return readSchemaVersion(this.database)
  }

  get expectedSchemaVersion(): number {
    return LATEST_SCHEMA_VERSION
  }

  /** 关闭之后不要再读写：退出流程里调用方用它来决定是否还值得保存。 */
  get isOpen(): boolean {
    return !this.closed
  }

  private assertOpen(): void {
    if (this.closed) throw new Error('数据仓库已关闭')
  }

  /** 把内存中的数据库整体写入磁盘（原子替换）。事务进行中只标记待落盘。 */
  persist(): void {
    this.assertOpen()
    if (this.transactionDepth > 0) return
    const bytes = this.database.export()
    writeFileAtomic(this.filePath, bytes)
  }

  /** 导出一份二进制快照（用于备份）。 */
  exportBytes(): Uint8Array {
    this.assertOpen()
    return this.database.export()
  }

  exec(sql: string): void {
    this.assertOpen()
    this.database.run(sql)
    this.persist()
  }

  run(sql: string, params: Params = []): number {
    this.assertOpen()
    this.database.run(sql, params)
    const modified = this.database.getRowsModified()
    this.persist()
    return modified
  }

  all<T extends Row = Row>(sql: string, params: Params = []): T[] {
    this.assertOpen()
    const statement = this.database.prepare(sql)
    try {
      statement.bind(params)
      const rows: T[] = []
      while (statement.step()) {
        rows.push(statement.getAsObject() as T)
      }
      return rows
    } finally {
      statement.free()
    }
  }

  get<T extends Row = Row>(sql: string, params: Params = []): T | null {
    const rows = this.all<T>(sql, params)
    return rows.length > 0 ? rows[0] : null
  }

  /** 在一个事务里执行多次写入，成功后统一落盘一次。 */
  transaction<T>(fn: () => T): T {
    this.assertOpen()
    if (this.transactionDepth > 0) throw new Error('不支持嵌套事务')
    this.database.run('BEGIN')
    this.transactionDepth += 1
    try {
      const result = fn()
      this.database.run('COMMIT')
      this.transactionDepth -= 1
      this.persist()
      return result
    } catch (error) {
      try {
        this.database.run('ROLLBACK')
      } catch {
        /* 回滚失败时保留原始错误 */
      }
      this.transactionDepth = Math.max(0, this.transactionDepth - 1)
      throw error
    }
  }

  /** SQLite 完整性检查。 */
  checkIntegrity(): string {
    const result = this.database.exec('PRAGMA integrity_check')
    if (result.length === 0) return 'unknown'
    return String(result[0].values[0]?.[0] ?? 'unknown')
  }

  /** 表清单（自检与测试用）。 */
  listTables(): string[] {
    return this.all<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
    ).map((row) => row.name)
  }

  close(): void {
    if (this.closed) return
    this.closed = true
    try {
      this.database.close()
    } catch {
      /* 关闭失败不影响已落盘的数据 */
    }
  }
}

/** 统一的“当前时间戳”文本，用于 created_at / updated_at。 */
export function timestampNow(): string {
  const d = new Date()
  const pad = (n: number): string => (n < 10 ? `0${n}` : String(n))
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    ` ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
  )
}
