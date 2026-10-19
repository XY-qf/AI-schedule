import { describe, expect, it } from '../helpers/expect'
import fs from 'node:fs'
import path from 'node:path'
import { resolveAiConfig } from '../../src/renderer/ai/config'
import { AiRuntime } from '../../src/renderer/ai/runtime'
import type { AiEngine, AiEngineListener, AiRunRequest, AiStatus, AiTaskSpec } from '../../src/renderer/ai/types'

const CONFIG = { ...resolveAiConfig({}), apiKey: 'sk-test-123456' }

const SPEC: AiTaskSpec = {
  tools: [{ name: 'add_courses', description: 'd', parameters: { type: 'object' } }],
  systemPrompt: 'sys',
  userPrompt: 'user',
  fallback: { listTool: 'add_courses', listKey: 'courses' },
}

function engineFrom(
  run: (request: AiRunRequest, onEvent: AiEngineListener) => void | Promise<void>,
  onDispose?: () => void,
): AiEngine {
  return {
    async run(request, onEvent) {
      await run(request, onEvent)
    },
    dispose: () => onDispose?.(),
  }
}

describe('AI 运行期状态', () => {
  it('连接 → 生成 → 就绪，状态窗能跟着变', async () => {
    const engine = engineFrom(async (_request: AiRunRequest, onEvent) => {
      onEvent({ type: 'status', message: '正在请求 Qwen/Qwen3.5-4B…', progress: null })
      onEvent({ type: 'text', text: '好的' })
      onEvent({ type: 'tool-call', name: 'add_courses', input: { courses: [] } })
      onEvent({ type: 'done', text: '已识别 2 门课程' })
    })
    const runtime = new AiRuntime(async () => engine)
    runtime.configure(CONFIG)

    const seen: AiStatus[] = []
    runtime.subscribe(() => seen.push({ ...runtime.getStatus() }))

    await runtime.run('course', { spec: SPEC, imageDataUrl: null }, () => undefined)

    const final = runtime.getStatus()
    expect(final.phase).toBe('idle')
    expect(final.connected).toBe(true)
    expect(seen.some((item) => item.phase === 'connecting')).toBe(true)
    expect(seen.some((item) => item.phase === 'generating')).toBe(true)
    expect(final.message).toContain('就绪')
  })

  it('引擎抛错 → 进入 error 状态并抛出', async () => {
    const engine = engineFrom(() => {
      throw new Error('接口返回 401：invalid api key')
    })
    const runtime = new AiRuntime(async () => engine)
    runtime.configure(CONFIG)
    let threw = false
    try {
      await runtime.run('event', { spec: SPEC, imageDataUrl: null }, () => undefined)
    } catch {
      threw = true
    }
    expect(threw).toBe(true)
    expect(runtime.getStatus().phase).toBe('error')
    expect(runtime.getStatus().message).toContain('401')
  })

  it('中途停止回到待命，并提示已停止', async () => {
    const engine = engineFrom(
      (request) =>
        new Promise<void>((_resolve, reject) => {
          request.signal.addEventListener('abort', () => reject(new Error('aborted')))
        }),
    )
    const runtime = new AiRuntime(async () => engine)
    runtime.configure(CONFIG)
    const running = runtime.run('course', { spec: SPEC, imageDataUrl: null }, () => undefined)
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(runtime.isBusy()).toBe(true)
    runtime.abort()
    let threw = false
    try {
      await running
    } catch {
      threw = true
    }
    expect(threw).toBe(true)
    const status = runtime.getStatus()
    expect(status.phase).toBe('idle')
    expect(status.message).toContain('已停止')
  })

  it('同一时间只跑一次，第二次直接拒绝', async () => {
    const engine = engineFrom(
      (request) =>
        new Promise<void>((_resolve, reject) => {
          request.signal.addEventListener('abort', () => reject(new Error('aborted')))
        }),
    )
    const runtime = new AiRuntime(async () => engine)
    runtime.configure(CONFIG)
    const first = runtime.run('course', { spec: SPEC, imageDataUrl: null }, () => undefined)
    await new Promise((resolve) => setTimeout(resolve, 10))

    let message = ''
    try {
      await runtime.run('event', { spec: SPEC, imageDataUrl: null }, () => undefined)
    } catch (error) {
      message = String((error as Error).message)
    }
    expect(message).toContain('正在识别')

    runtime.abort()
    await first.catch(() => undefined)
  })

  it('设置里关掉以后不再运行', async () => {
    const runtime = new AiRuntime(async () => engineFrom(() => undefined))
    runtime.configure({ ...CONFIG, enabled: false })
    expect(runtime.getStatus().phase).toBe('off')
    let threw = false
    try {
      await runtime.run('course', { spec: SPEC, imageDataUrl: null }, () => undefined)
    } catch {
      threw = true
    }
    expect(threw).toBe(true)
  })

  it('接口配置变了会释放旧引擎', async () => {
    let disposed = 0
    const runtime = new AiRuntime(async () =>
      engineFrom(() => undefined, () => {
        disposed += 1
      }),
    )
    runtime.configure(CONFIG)
    await runtime.run('course', { spec: SPEC, imageDataUrl: null }, () => undefined)
    runtime.configure({ ...CONFIG, model: 'Qwen/Qwen3-8B' })
    expect(disposed).toBe(1)
  })
})

describe('引擎与云端接口的契约', () => {
  it('系统提示作为 system 消息发出去，不再有本地模型相关代码', () => {
    const file = path.join(process.cwd(), 'src', 'renderer', 'ai', 'engine.ts')
    if (!fs.existsSync(file)) return
    const source = fs.readFileSync(file, 'utf8')
    expect(source).toContain("role: 'system'")
    expect(source).toContain('api.aiChat')
    // 本地推理那一套应该已经删干净
    expect(source).not.toContain('transformers')
    expect(source).not.toContain('worker')
  })
})
