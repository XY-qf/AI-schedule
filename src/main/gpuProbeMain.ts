import { app, BrowserWindow } from 'electron'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

/**
 * 显卡探针（只在 AI_SCHEDULE_GPU_PROBE=1 时由 entry.ts 加载）。
 *
 * 为什么需要它：GPU 进程起不来时 Chromium 会直接 FATAL 掉整个主进程
 * （`GPU process isn't usable. Goodbye.`），JS 里根本捕获不到，所以只能
 * 「先拿同样的可执行文件 + 同样的开关另起一个进程试一次」：
 *   能开窗口、能拿到 GPU 信息 → 退出码 0，说明这一级可用；
 *   GPU 起不来 → Chromium 自己硬崩，退出码非 0；
 *   卡住 → 到点退出码 3。
 *
 * 探针只写临时目录，不碰真实 userData（缓存、状态文件都不会被污染）。
 */

const switches = (process.env.AI_SCHEDULE_GPU_PROBE_SWITCHES ?? '')
  .split(',')
  .map((item) => item.trim())
  .filter(Boolean)

// 父进程（gpuProbe.ts）会给一个临时目录；单独跑没给的话自己建一个
const probeDir =
  process.env.AI_SCHEDULE_GPU_PROBE_DIR ??
  fs.mkdtempSync(path.join(os.tmpdir(), 'ai-schedule-gpu-probe-'))
app.setPath('userData', probeDir)
app.setPath('sessionData', probeDir)
for (const flag of switches) app.commandLine.appendSwitch(flag)

let settled = false

function finish(code: number): void {
  if (settled) return
  settled = true
  try {
    fs.rmSync(probeDir, { recursive: true, force: true })
  } catch {
    /* 清理失败不影响结论 */
  }
  app.exit(code)
}

// 兜底：万一 GPU 既不崩也不回，10 秒后当作不可用
const hardTimeout = setTimeout(() => finish(3), 10000)
hardTimeout.unref?.()

app.whenReady().then(async () => {
  try {
    // 开一个隐藏窗口：窗口的合成器会真正去建 GPU 通道，起不来就会在这里崩。
    // 用 about:blank，别用 data: —— 某些显卡/企业策略下 data: 会被拦成 ERR_FAILED。
    const win = new BrowserWindow({ show: false, width: 64, height: 64 })
    await win.loadURL('about:blank')
    // 再显式要一次 GPU 信息，确保通道真的建起来了
    await app.getGPUInfo('basic')
    clearTimeout(hardTimeout)
    finish(0)
  } catch {
    finish(4)
  }
})
