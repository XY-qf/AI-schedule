import fs from 'node:fs'
import {
  GPU_COMPAT_LADDER,
  isGpuCompatMode,
  nextGpuCompatMode,
  type GpuCompatMode,
} from '../shared/gpuCompat'

/**
 * GPU 兼容模式的判定与状态文件（主进程专用）。
 *
 * 现象：某些机器上 Chromium 的 GPU 子进程直接起不来 ——
 *   GPU process launch failed: error_code=18
 *   FATAL:gpu_data_manager_impl_private.cc GPU process isn't usable. Goodbye.
 * 窗口一个都不出来。已知诱因：系统里装了虚拟显示适配器（GameViewer / wjIddDriver 之类）、
 * 从网络盘或受限环境启动、显卡沙箱被安全软件挡。
 *
 * 处理顺序（每一级都记到状态文件里，崩了就升一级）：
 *   off → gpu-sandbox（只关 GPU 进程沙箱，**保留硬件加速**）
 *       → in-process（GPU 线程搬进主进程，硬件加速多半没了）
 *       → software（彻底软件渲染，保证能开）
 * 用某一级成功启动后，把结论记下来并 7 天后再试一次正常 GPU。
 */

export const GPU_COMPAT_RETRY_MS = 7 * 24 * 60 * 60 * 1000

export interface GpuCompatState {
  mode: GpuCompatMode
  /** 到什么时候可以再试一次正常 GPU；null 表示一直这样 */
  retryAt: number | null
}

export interface GpuCompatDecision {
  mode: GpuCompatMode
  reason: 'argv' | 'env' | 'state' | 'crash' | null
}

export interface GpuCompatInput {
  argv: string[]
  env: Record<string, string | undefined>
  /** 上次启动用来救急的模式；null 表示上次正常走完或没有记录 */
  lastPendingMode: GpuCompatMode | null
  state: GpuCompatState | null
  now: number
}

function fromArgv(argv: string[]): GpuCompatMode | null {
  if (argv.some((arg) => arg === '--in-process-gpu' || arg.startsWith('--in-process-gpu='))) {
    return 'in-process'
  }
  if (argv.some((arg) => arg === '--disable-gpu' || arg.startsWith('--disable-gpu='))) return 'software'
  if (argv.some((arg) => arg === '--disable-gpu-sandbox')) return 'gpu-sandbox'
  return null
}

export function decideGpuCompat(input: GpuCompatInput): GpuCompatDecision {
  const { argv, env, lastPendingMode, state, now } = input

  const forced = fromArgv(argv)
  if (forced) return { mode: forced, reason: 'argv' }

  const fromEnv = (env.AI_SCHEDULE_GPU_COMPAT_MODE ?? '').trim()
  if (isGpuCompatMode(fromEnv)) return { mode: fromEnv, reason: 'env' }
  if ((env.AI_SCHEDULE_GPU_COMPAT ?? '') === '1') return { mode: 'gpu-sandbox', reason: 'env' }

  if (state && state.mode !== 'off' && (state.retryAt === null || now < state.retryAt)) {
    return { mode: state.mode, reason: 'state' }
  }

  // 上次用某个模式启动过、但没走完 → 说明那个模式没救回来，降一级
  if (lastPendingMode) {
    return { mode: nextGpuCompatMode(lastPendingMode), reason: 'crash' }
  }

  return { mode: 'off', reason: null }
}

/* ------------------------------------------------------------------ */
/* 状态文件                                                           */
/* ------------------------------------------------------------------ */

function safeRead(file: string): string | null {
  try {
    return fs.readFileSync(file, 'utf8')
  } catch {
    return null
  }
}

function safeWrite(file: string, content: string): void {
  try {
    fs.writeFileSync(file, content, 'utf8')
  } catch {
    /* 写不出来不影响启动 */
  }
}

function safeRemove(file: string): void {
  try {
    fs.unlinkSync(file)
  } catch {
    /* 本来就没有也算成功 */
  }
}

export function readGpuCompatState(file: string): GpuCompatState | null {
  const text = safeRead(file)
  if (!text) return null
  try {
    const parsed = JSON.parse(text) as { mode?: unknown; compat?: unknown; retryAt?: unknown }
    const mode: GpuCompatMode = isGpuCompatMode(parsed.mode)
      ? parsed.mode
      : // 老版本只存过一个布尔值（那时只试过 in-process）。
        // 升级后先从更好的一级（gpu-sandbox，保留硬件加速）重试一次，不行再降回去。
        parsed.compat === true
        ? 'gpu-sandbox'
        : 'off'
    return { mode, retryAt: typeof parsed.retryAt === 'number' ? parsed.retryAt : null }
  } catch {
    return null
  }
}

export function writeGpuCompatState(file: string, state: GpuCompatState): void {
  safeWrite(file, JSON.stringify({ mode: state.mode, retryAt: state.retryAt }))
}

export function clearGpuCompatState(file: string): void {
  safeRemove(file)
}

/** 启动开始时记下"这次用的是哪一级"；正常加载完再清掉。 */
export function markBootPending(file: string, mode: GpuCompatMode, now: number): void {
  safeWrite(file, JSON.stringify({ mode, at: now }))
}

export function readBootPending(file: string): GpuCompatMode | null {
  const text = safeRead(file)
  if (!text) return null
  try {
    const parsed = JSON.parse(text) as { mode?: unknown }
    return isGpuCompatMode(parsed.mode) ? parsed.mode : 'off'
  } catch {
    // 老版本写的是纯时间戳
    return 'off'
  }
}

export function clearBootPending(file: string): void {
  safeRemove(file)
}

export { GPU_COMPAT_LADDER, type GpuCompatMode }
