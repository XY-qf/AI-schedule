import { describe, expect, it } from '../helpers/expect'
import { probeGpuLadder, type GpuProbeOutcome } from '../../src/main/gpuProbe'
import type { GpuCompatMode } from '../../src/shared/gpuCompat'

function probeWith(results: Record<GpuCompatMode, GpuProbeOutcome>) {
  const tried: GpuCompatMode[] = []
  const probe = (mode: GpuCompatMode): GpuProbeOutcome => {
    tried.push(mode)
    return results[mode]
  }
  return { probe, tried }
}

describe('启动前的显卡体检', () => {
  it('从最好的一级开始试，选第一级真能起来的', () => {
    const { probe, tried } = probeWith({
      off: 'fail',
      'gpu-sandbox': 'ok',
      'in-process': 'ok',
      software: 'ok',
    })
    expect(probeGpuLadder(probe)).toBe('gpu-sandbox')
    expect(tried).toEqual(['off', 'gpu-sandbox'])
  })

  it('GPU 正常时只用试一级，不拖慢启动', () => {
    const { probe, tried } = probeWith({
      off: 'ok',
      'gpu-sandbox': 'ok',
      'in-process': 'ok',
      software: 'ok',
    })
    expect(probeGpuLadder(probe)).toBe('off')
    expect(tried).toEqual(['off'])
  })

  it('连软件渲染都起不来时返回 null（交回原有逻辑，不假装成功）', () => {
    const { probe, tried } = probeWith({
      off: 'fail',
      'gpu-sandbox': 'fail',
      'in-process': 'fail',
      software: 'fail',
    })
    expect(probeGpuLadder(probe)).toBeNull()
    expect(tried).toEqual(['off', 'gpu-sandbox', 'in-process', 'software'])
  })

  it('探针本身超时（环境不配合）就立刻停手，别把启动拖成十几秒', () => {
    const { probe, tried } = probeWith({
      off: 'unknown',
      'gpu-sandbox': 'ok',
      'in-process': 'ok',
      software: 'ok',
    })
    expect(probeGpuLadder(probe)).toBeNull()
    expect(tried).toEqual(['off'])
  })
})
