import initSqlJs, { type SqlJsStatic } from 'sql.js'

let cached: Promise<SqlJsStatic> | null = null
let cachedPath: string | null = null

/**
 * 加载 SQLite 的 WASM 运行时。
 * wasmPath 由调用方给出：主进程用 require.resolve，测试用 createRequire 计算，
 * 这样同一份代码在 Electron 与 Vitest 里都能跑。
 */
export function loadSqlJs(wasmPath: string): Promise<SqlJsStatic> {
  if (!cached || cachedPath !== wasmPath) {
    cachedPath = wasmPath
    cached = initSqlJs({ locateFile: () => wasmPath })
  }
  return cached
}
