import fs from 'node:fs'
import path from 'node:path'

/**
 * 原子写文件：先写同目录临时文件 → fsync → 覆盖目标文件。
 * 任何一步失败都不会破坏已有的目标文件。
 */
export function writeFileAtomic(targetPath: string, data: Uint8Array): void {
  const dir = path.dirname(targetPath)
  fs.mkdirSync(dir, { recursive: true })
  const tmpPath = path.join(
    dir,
    `.${path.basename(targetPath)}.${process.pid}.${Date.now()}.tmp`,
  )
  const fd = fs.openSync(tmpPath, 'w')
  try {
    fs.writeSync(fd, data)
    fs.fsyncSync(fd)
  } finally {
    fs.closeSync(fd)
  }
  try {
    fs.renameSync(tmpPath, targetPath)
  } catch (error) {
    try {
      fs.unlinkSync(tmpPath)
    } catch {
      /* 清理失败不影响主流程 */
    }
    throw error
  }
}

/** 读取文件；不存在返回 null，其它错误照常抛出。 */
export function readFileIfExists(filePath: string): Uint8Array | null {
  try {
    return new Uint8Array(fs.readFileSync(filePath))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  }
}

/** 目录是否可写（用一次真实的小文件写入探测）。 */
export function isDirectoryWritable(dir: string): boolean {
  try {
    fs.mkdirSync(dir, { recursive: true })
    const probe = path.join(dir, `.write-probe-${process.pid}.tmp`)
    fs.writeFileSync(probe, 'ok')
    fs.unlinkSync(probe)
    return true
  } catch {
    return false
  }
}

/** 列出目录中残留的临时文件（用于清理与自测）。 */
export function listTempFiles(dir: string): string[] {
  try {
    return fs
      .readdirSync(dir)
      .filter((name) => name.endsWith('.tmp') && name.startsWith('.'))
  } catch {
    return []
  }
}
