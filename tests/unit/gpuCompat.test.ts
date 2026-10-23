import { describe, expect, it } from '../helpers/expect'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  GPU_COMPAT_RETRY_MS,
  clearBootPending,
  clearGpuCompatState,
  decideGpuCompat,
  markBootPending,
  readBootPending,
  readGpuCompatState,
  writeGpuCompatState,
} from '../../src/main/gpuCompat'
import { describeGpuCompat, gpuCompatSwitches } from '../../src/shared/gpuCompat'

const base = {
  argv: [] as string[],
  env: {} as Record<string, string | undefined>,
  lastPendingMode: null,
  state: null,
  now: 1_000,
}

describe('GPU 兼容模式判定', () => {
  it('正常启动什么都不加', () => {
    expect(decideGpuCompat(base)).toEqual({ mode: 'off', reason: null })
  })

  it('命令行手动指定时以命令行为准', () => {
    expect(decideGpuCompat({ ...base, argv: ['.', '--in-process-gpu'] })).toEqual({
      mode: 'in-process',
      reason: 'argv',
    })
    expect(decideGpuCompat({ ...base, argv: ['--disable-gpu-sandbox'] }).mode).toBe('gpu-sandbox')
    expect(decideGpuCompat({ ...base, argv: ['--disable-gpu'] }).mode).toBe('software')
  })

  it('第一次崩：先试只关 GPU 沙箱（保留硬件加速）', () => {
    expect(decideGpuCompat({ ...base, lastPendingMode: 'off' })).toEqual({
      mode: 'gpu-sandbox',
      reason: 'crash',
    })
  })

  it('关沙箱也没救回来：再降一级到 in-process，然后 software', () => {
    expect(decideGpuCompat({ ...base, lastPendingMode: 'gpu-sandbox' }).mode).toBe('in-process')
    expect(decideGpuCompat({ ...base, lastPendingMode: 'in-process' }).mode).toBe('software')
    // 已经是最低一级就不再降
    expect(decideGpuCompat({ ...base, lastPendingMode: 'software' }).mode).toBe('software')
  })

  it('记住的兼容模式在重试时间之前一直生效', () => {
    const state = { mode: 'gpu-sandbox' as const, retryAt: base.now + GPU_COMPAT_RETRY_MS }
    expect(decideGpuCompat({ ...base, state }).reason).toBe('state')
    expect(decideGpuCompat({ ...base, state, now: state.retryAt + 1 }).mode).toBe('off')
    expect(decideGpuCompat({ ...base, state: { mode: 'gpu-sandbox', retryAt: null } }).mode).toBe(
      'gpu-sandbox',
    )
  })

  it('环境变量可以强制指定级别', () => {
    expect(decideGpuCompat({ ...base, env: { AI_SCHEDULE_GPU_COMPAT_MODE: 'software' } })).toEqual({
      mode: 'software',
      reason: 'env',
    })
    expect(decideGpuCompat({ ...base, env: { AI_SCHEDULE_GPU_COMPAT: '1' } }).mode).toBe('gpu-sandbox')
  })

  it('记住的 off 也算已知状态：下次不必重新体检', () => {
    const state = { mode: 'off' as const, retryAt: null }
    expect(decideGpuCompat({ ...base, state })).toEqual({ mode: 'off', reason: 'state' })
  })

  it('崩溃标记优先于记住的状态：否则会一直崩在同一个级别上', () => {
    const state = { mode: 'off' as const, retryAt: null }
    expect(decideGpuCompat({ ...base, state, lastPendingMode: 'off' })).toEqual({
      mode: 'gpu-sandbox',
      reason: 'crash',
    })
  })
})

describe('每一级追加的开关', () => {
  it('顺序与内容稳定', () => {
    expect(gpuCompatSwitches('off')).toEqual([])
    expect(gpuCompatSwitches('gpu-sandbox')).toEqual(['disable-gpu-sandbox'])
    expect(gpuCompatSwitches('in-process')).toContain('in-process-gpu')
    expect(gpuCompatSwitches('software')).toContain('disable-gpu')
  })

  it('都有中文说明（界面要显示）', () => {
    expect(describeGpuCompat('off')).toBeNull()
    for (const mode of ['gpu-sandbox', 'in-process', 'software'] as const) {
      expect(describeGpuCompat(mode)).toContain('兼容模式')
    }
  })
})

describe('GPU 兼容模式的状态文件', () => {
  it('读写、启动标记与清理', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gpu-compat-'))
    const stateFile = path.join(dir, 'gpu-compat.json')
    const bootFile = path.join(dir, 'boot.pending')

    expect(readGpuCompatState(stateFile)).toBeNull()
    writeGpuCompatState(stateFile, { mode: 'gpu-sandbox', retryAt: 123 })
    expect(readGpuCompatState(stateFile)).toEqual({ mode: 'gpu-sandbox', retryAt: 123 })
    clearGpuCompatState(stateFile)
    expect(readGpuCompatState(stateFile)).toBeNull()

    expect(readBootPending(bootFile)).toBeNull()
    markBootPending(bootFile, 'gpu-sandbox', Date.now())
    expect(readBootPending(bootFile)).toBe('gpu-sandbox')
    clearBootPending(bootFile)
    expect(readBootPending(bootFile)).toBeNull()

    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('兼容老版本存过的布尔值（升级后先试更好的一级）', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gpu-compat-'))
    const stateFile = path.join(dir, 'gpu-compat.json')
    fs.writeFileSync(stateFile, JSON.stringify({ compat: true, retryAt: 9 }), 'utf8')
    expect(readGpuCompatState(stateFile)).toEqual({ mode: 'gpu-sandbox', retryAt: 9 })
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('内容损坏时当作没有状态', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gpu-compat-'))
    const stateFile = path.join(dir, 'gpu-compat.json')
    fs.writeFileSync(stateFile, 'not json', 'utf8')
    expect(readGpuCompatState(stateFile)).toBeNull()
    fs.rmSync(dir, { recursive: true, force: true })
  })
})
