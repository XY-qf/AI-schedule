import fs from 'node:fs'
import path from 'node:path'
import { isDirectoryWritable } from './db/atomic'

export interface AppPaths {
  /** 数据目录：文档\AI日程 */
  dataDir: string
  /** 数据文件：文档\AI日程\schedule.db */
  dbFile: string
  /** 备份目录：文档\AI日程\backups */
  backupDir: string
}

/** 数据目录不可用（无法创建或不可写）。 */
export class DataDirectoryError extends Error {
  constructor(
    readonly dir: string,
    readonly reason: string,
    readonly detail?: unknown,
  ) {
    super(`数据目录不可用：${dir}（${reason}）`)
    this.name = 'DataDirectoryError'
  }
}

export const DATA_DIR_NAME = 'AI日程'
export const DB_FILE_NAME = 'schedule.db'
export const BACKUP_DIR_NAME = 'backups'

/**
 * 由「文档」目录推导出全部路径。
 * 单独抽成纯函数，便于测试不同的 home / 文档目录。
 */
export function resolveAppPaths(documentsDir: string): AppPaths {
  const dataDir = path.join(documentsDir, DATA_DIR_NAME)
  return {
    dataDir,
    dbFile: path.join(dataDir, DB_FILE_NAME),
    backupDir: path.join(dataDir, BACKUP_DIR_NAME),
  }
}

/**
 * 确保数据目录可用：
 * 1. 目录不存在则创建；
 * 2. 创建后做一次真实写入探测；
 * 3. 失败抛出可读的中文错误，绝不静默继续（否则会以为数据丢了）。
 */
export function ensureDataDir(paths: AppPaths): void {
  try {
    fs.mkdirSync(paths.dataDir, { recursive: true })
  } catch (error) {
    throw new DataDirectoryError(paths.dataDir, '无法创建目录', error)
  }
  if (!isDirectoryWritable(paths.dataDir)) {
    throw new DataDirectoryError(paths.dataDir, '目录不可写入')
  }
  try {
    fs.mkdirSync(paths.backupDir, { recursive: true })
  } catch (error) {
    throw new DataDirectoryError(paths.backupDir, '无法创建备份目录', error)
  }
}

/** 打开数据文件所在文件夹所需的参数（交给 shell 使用）。 */
export function parentDirOf(filePath: string): string {
  return path.dirname(filePath)
}
