// 诊断用：启动打包后的程序，拿到真实退出码（图形程序不能用管道捕获输出）
const { spawn } = require('node:child_process')
const path = require('node:path')

const exe = process.argv[2]
const withFlags = process.argv[3] === 'flags'
const args = withFlags
  ? ['--no-sandbox', '--disable-gpu', '--enable-logging', '--log-file=' + path.join(path.dirname(exe), 'chromium.log')]
  : []

console.log('启动:', exe)
console.log('参数:', JSON.stringify(args))

const child = spawn(exe, args, { stdio: 'ignore', cwd: path.dirname(exe) })

let done = false
const finish = (text) => {
  if (done) return
  done = true
  console.log(text)
  try { child.kill() } catch {}
  process.exit(0)
}

child.on('error', (err) => finish('spawn 失败: ' + err.message))
child.on('exit', (code, signal) => {
  const hex = code === null ? 'null' : '0x' + (code >>> 0).toString(16).toUpperCase().padStart(8, '0')
  finish(`进程退出: code=${code} (${hex}) signal=${signal}`)
})

setTimeout(() => finish('15 秒后仍存活（说明进程没崩，可能窗口没显示或卡住了）'), 15000)
