/**
 * 测试入口：在同进程内加载全部编译后的 *.test.js，交给 node:test 运行。
 * 不使用子进程，因此在受限环境里也能跑。
 */
import fs from 'node:fs'
import path from 'node:path'

// 先建立 DOM 环境，再加载测试文件：@testing-library/react 在导入时就需要 document。
import { setupDom } from './helpers/dom'

setupDom()

function walk(dir: string, out: string[] = []): string[] {
  if (!fs.existsSync(dir)) return out
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) walk(full, out)
    else if (entry.name.endsWith('.test.js')) out.push(full)
  }
  return out
}

const allFiles = walk(__dirname).sort()
const filter = process.env.TEST_ONLY
const files = filter ? allFiles.filter((file) => file.includes(filter)) : allFiles
if (files.length === 0) {
  console.error('没有找到任何测试文件')
  process.exit(1)
}

console.log(`共加载 ${files.length} 个测试文件`)
for (const file of files) {
  const relative = path.relative(__dirname, file).replace(/\\/g, '/')
  console.log(`  · ${relative}`)
  require(file)
}

// 兜底：万一某个测试留下了定时器或句柄导致事件循环不退出，
// 到点强制结束，避免整个测试卡死。（unref 保证它不影响正常结束）
const hardStop = setTimeout(() => {
  console.error('\n测试进程疑似被残留句柄挂住，强制退出')
  process.exit(process.exitCode ?? 1)
}, 20000)
hardStop.unref()
