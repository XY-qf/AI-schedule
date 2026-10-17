import type { DataStore } from './store'

/** 键值设置仓库：设置项、窗口状态等都存在这里，随数据文件一起持久化。 */
export class SettingsRepository {
  constructor(private readonly store: DataStore) {}

  get(key: string): string | null {
    const row = this.store.get<{ value: string }>('SELECT value FROM settings WHERE key = ?', [key])
    return row ? String(row.value) : null
  }

  getNumber(key: string): number | null {
    const raw = this.get(key)
    if (raw === null) return null
    const trimmed = raw.trim()
    // 空字符串会被 Number('') 变成 0，这里必须当作“没有值”处理
    if (trimmed === '') return null
    const value = Number(trimmed)
    return Number.isFinite(value) ? value : null
  }

  getBoolean(key: string): boolean | null {
    const raw = this.get(key)
    if (raw === null) return null
    return raw === '1' || raw === 'true'
  }

  set(key: string, value: string | number | boolean): void {
    const text = typeof value === 'boolean' ? (value ? '1' : '0') : String(value)
    this.store.run(
      'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
      [key, text],
    )
  }

  setMany(entries: Record<string, string | number | boolean>): void {
    this.store.transaction(() => {
      for (const [key, value] of Object.entries(entries)) this.set(key, value)
    })
  }

  remove(key: string): void {
    this.store.run('DELETE FROM settings WHERE key = ?', [key])
  }

  all(): Record<string, string> {
    const rows = this.store.all<{ key: string; value: string }>('SELECT key, value FROM settings')
    const out: Record<string, string> = {}
    for (const row of rows) out[String(row.key)] = String(row.value)
    return out
  }
}
