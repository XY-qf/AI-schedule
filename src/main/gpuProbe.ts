import { app } from 'electron'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { GPU_COMPAT_LADDER, gpuCompatSwitches, type GpuCompatMode } from '../shared/gpuCompat'

/**
 * 启动前的显卡体检。
 *
 * 背景：出现的
 *   `GPU process launch failed: error_code=18` +
 *   `FATAL:gpu_data_manager_impl_private.cc GPU process isn't usable. Goodbye.`
 * 是 Chromium 在 GPU 进程起不来时直接杀整个主进程，JS 捕获不到。
 * 因此「崩一次、下次再降一级」的老办法必然会让用户看到一次崩溃。
 *
 * 这里改成开窗前先拿同样的开关起一个探针进程（gpuProbeMain.ts）实测，
 * 从最好的一级往下试，选第一级真能起来的：
 *   off（正常 GPU）→ gpu-sandbox → in-process → software
 * 结果在启动成功后被永久记下来（见 main.ts 的 markBootCompleted），
 * 之后每次启动都直接用那一级，不再有「又崩一次」。
 */

/** 单次探针最长等待；GPU 起不来时 Chromium 会自己 FATAL，很快就返回。 */
export const GPU_PROBE_TIMEOUT_MS = 6000

export type GpuProbeOutcome = 'ok' | 'fail' | 'unknown'
export type GpuProbe = (mode: GpuCompatMode) => GpuProbeOutcome

/**
 * 探针的临时 userData。
 *
 * 优先放在应用自己的 userData 下面（和 Chromium 平时写的目录同源，最不容易
 * 被沙箱/杀软拦），实在建不出来再退回系统临时目录。
 */
function createProbeDir(): string {
  try {
    const base = path.join(app.getPath('userData'), 'gpu-probe')
    fs.mkdirSync(base, { recursive: true })
    return fs.mkdtempSync(path.join(base, 'run-'))
  } catch {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'ai-schedule-gpu-probe-'))
  }
}

/** 用同样的可执行文件起一次探针，判断这一级开关能不能正常开窗口。 */
export function runGpuProbe(mode: GpuCompatMode): GpuProbeOutcome {
  const probeDir = createProbeDir()
  // 打包后 Electron 只认自己 ASAR 里的入口，多给的脚本路径会被忽略，
  // 所以探针靠环境变量在 entry.ts 里分流；开发态（electron .）则要补上应用目录。
  const args = app.isPackaged ? [] : [app.getAppPath()]
  try {
    const result = spawnSync(process.execPath, args, {
      timeout: GPU_PROBE_TIMEOUT_MS,
      windowsHide: true,
      stdio: 'ignore',
      env: {
        ...process.env,
        AI_SCHEDULE_GPU_PROBE: '1',
        AI_SCHEDULE_GPU_PROBE_DIR: probeDir,
        AI_SCHEDULE_GPU_PROBE_SWITCHES: gpuCompatSwitches(mode).join(','),
      },
    })
    if (result.status === 0) return 'ok'
    // 超时 / 起不来 / 被杀：环境本身不配合，继续往下试只会让启动更慢
    if (result.status === null || result.error) return 'unknown'
    return 'fail'
  } catch {
    return 'unknown'
  } finally {
    try {
      fs.rmSync(probeDir, { recursive: true, force: true })
    } catch {
      /* 清理失败不影响结论 */
    }
  }
}

/**
 * 从最好的一级往下试，返回第一级能起来的。
 * 全都不行或环境不配合（unknown）时返回 null，调用方退回原来的判定。
 */
export function probeGpuLadder(probe: GpuProbe = runGpuProbe): GpuCompatMode | null {
  for (const mode of GPU_COMPAT_LADDER) {
    const outcome = probe(mode)
    if (outcome === 'ok') return mode
    if (outcome === 'unknown') return null
  }
  return null
}
