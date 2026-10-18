/**
 * GPU 兼容模式的分级定义（主进程与界面共用，纯逻辑、不碰 fs）。
 *
 * 分级顺序：off → gpu-sandbox → in-process → software。
 * 主进程启动时按其中一级加开关；界面用它显示"现在处于哪种兼容模式"。
 */

export type GpuCompatMode = 'off' | 'gpu-sandbox' | 'in-process' | 'software'

export const GPU_COMPAT_LADDER: GpuCompatMode[] = ['off', 'gpu-sandbox', 'in-process', 'software']

export function isGpuCompatMode(value: unknown): value is GpuCompatMode {
  return GPU_COMPAT_LADDER.includes(value as GpuCompatMode)
}

/** 崩一次就往下降一级。 */
export function nextGpuCompatMode(mode: GpuCompatMode): GpuCompatMode {
  const index = GPU_COMPAT_LADDER.indexOf(mode)
  return GPU_COMPAT_LADDER[Math.min(index + 1, GPU_COMPAT_LADDER.length - 1)]
}

/** 每一级要追加的 Chromium 开关。 */
export function gpuCompatSwitches(mode: GpuCompatMode): string[] {
  switch (mode) {
    case 'gpu-sandbox':
      // 最常见也最有效的解法：只关 GPU 进程沙箱，硬件加速还在
      return ['disable-gpu-sandbox']
    case 'in-process':
      return ['disable-gpu-sandbox', 'in-process-gpu']
    case 'software':
      return ['disable-gpu', 'disable-gpu-sandbox', 'disable-gpu-compositing']
    default:
      return []
  }
}

/** 给界面看的一句话。 */
export function describeGpuCompat(mode: GpuCompatMode): string | null {
  if (mode === 'gpu-sandbox') {
    return '兼容模式（已关闭 GPU 进程沙箱）：显卡仍可用。系统里有虚拟显示器时这是最常见的解法。'
  }
  if (mode === 'in-process') {
    return '兼容模式（GPU 线程并入主进程）：硬件加速多半用不了，AI 会自动改用 CPU。'
  }
  if (mode === 'software') {
    return '兼容模式（软件渲染）：界面能开，但没有显卡加速，AI 只能跑 CPU。'
  }
  return null
}
