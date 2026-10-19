import type { Database } from 'sql.js'

/**
 * 表结构版本化迁移：每个元素是一次升级要执行的语句集合。
 * 数据库里的 PRAGMA user_version 记录当前版本；新增升级只往后追加，不改历史项。
 */
export const MIGRATIONS: readonly (readonly string[])[] = [
  // v1：初始表结构
  [
    `CREATE TABLE IF NOT EXISTS settings (
       key TEXT PRIMARY KEY,
       value TEXT NOT NULL
     )`,
    `CREATE TABLE IF NOT EXISTS semesters (
       id TEXT PRIMARY KEY,
       name TEXT NOT NULL,
       start_date TEXT NOT NULL,
       weeks INTEGER NOT NULL,
       is_current INTEGER NOT NULL DEFAULT 0,
       created_at TEXT NOT NULL,
       updated_at TEXT NOT NULL
     )`,
    `CREATE TABLE IF NOT EXISTS periods (
       id TEXT PRIMARY KEY,
       name TEXT NOT NULL,
       start_time TEXT NOT NULL,
       end_time TEXT NOT NULL,
       order_index INTEGER NOT NULL,
       created_at TEXT NOT NULL,
       updated_at TEXT NOT NULL
     )`,
    `CREATE TABLE IF NOT EXISTS courses (
       id TEXT PRIMARY KEY,
       semester_id TEXT NOT NULL,
       title TEXT NOT NULL,
       teacher TEXT,
       location TEXT,
       weekday INTEGER NOT NULL,
       time_mode TEXT NOT NULL,
       start_period INTEGER,
       end_period INTEGER,
       start_time TEXT,
       end_time TEXT,
       week_from INTEGER NOT NULL,
       week_to INTEGER NOT NULL,
       odd_even TEXT NOT NULL DEFAULT 'all',
       color TEXT,
       created_at TEXT NOT NULL,
       updated_at TEXT NOT NULL
     )`,
    `CREATE TABLE IF NOT EXISTS recurrences (
       id TEXT PRIMARY KEY,
       freq TEXT NOT NULL,
       interval_value INTEGER,
       interval_unit TEXT,
       by_weekdays TEXT,
       until_date TEXT,
       max_count INTEGER,
       created_at TEXT NOT NULL,
       updated_at TEXT NOT NULL
     )`,
    `CREATE TABLE IF NOT EXISTS events (
       id TEXT PRIMARY KEY,
       title TEXT NOT NULL,
       category TEXT NOT NULL,
       kind TEXT NOT NULL,
       start_at TEXT,
       end_at TEXT,
       due_at TEXT,
       location TEXT,
       people TEXT,
       note TEXT,
       done INTEGER NOT NULL DEFAULT 0,
       recurrence_id TEXT,
       created_at TEXT NOT NULL,
       updated_at TEXT NOT NULL
     )`,
    `CREATE TABLE IF NOT EXISTS event_exceptions (
       id TEXT PRIMARY KEY,
       series_id TEXT NOT NULL,
       original_date TEXT NOT NULL,
       action TEXT NOT NULL,
       start_at TEXT,
       end_at TEXT,
       title TEXT,
       location TEXT,
       people TEXT,
       note TEXT,
       done INTEGER,
       created_at TEXT NOT NULL,
       updated_at TEXT NOT NULL
     )`,
    `CREATE TABLE IF NOT EXISTS course_exceptions (
       id TEXT PRIMARY KEY,
       course_id TEXT NOT NULL,
       original_date TEXT NOT NULL,
       action TEXT NOT NULL,
       start_at TEXT,
       end_at TEXT,
       note TEXT,
       created_at TEXT NOT NULL,
       updated_at TEXT NOT NULL
     )`,
    `CREATE INDEX IF NOT EXISTS idx_events_start ON events (start_at)`,
    `CREATE INDEX IF NOT EXISTS idx_events_due ON events (due_at)`,
    `CREATE INDEX IF NOT EXISTS idx_events_recurrence ON events (recurrence_id)`,
    `CREATE INDEX IF NOT EXISTS idx_courses_semester ON courses (semester_id)`,
    `CREATE INDEX IF NOT EXISTS idx_event_exc_series ON event_exceptions (series_id, original_date)`,
    `CREATE INDEX IF NOT EXISTS idx_course_exc_course ON course_exceptions (course_id, original_date)`,
  ],
  // v2：重要事项标记（倒计时功能用）
  [`ALTER TABLE events ADD COLUMN important INTEGER NOT NULL DEFAULT 0`],
]

export const LATEST_SCHEMA_VERSION = MIGRATIONS.length

export function readSchemaVersion(db: Database): number {
  const result = db.exec('PRAGMA user_version')
  if (result.length === 0 || result[0].values.length === 0) return 0
  return Number(result[0].values[0][0] ?? 0)
}

/** 把数据库升级到最新版本；可重复调用（幂等）。 */
export function migrate(db: Database): number {
  let version = readSchemaVersion(db)
  while (version < LATEST_SCHEMA_VERSION) {
    const statements = MIGRATIONS[version]
    db.run('BEGIN')
    try {
      for (const statement of statements) db.run(statement)
      db.run(`PRAGMA user_version = ${version + 1}`)
      db.run('COMMIT')
    } catch (error) {
      try {
        db.run('ROLLBACK')
      } catch {
        /* 回滚失败时保留原始错误 */
      }
      throw error
    }
    version += 1
  }
  return version
}
