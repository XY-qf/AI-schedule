import type {
  AiEngine,
  AiEngineEvent,
  AiEngineFactory,
  AiEngineListener,
  AiRunRequest,
  AiRuntimeConfig,
  AiStatus,
  AiTaskKind,
} from './types'

/**
 * AI 助手的运行期状态（单例）。
 *
 * 放在这里而不是组件内部，是因为：
 * 1. 课程表与日历两个入口共用同一个引擎与状态；
 * 2. 右下角状态窗、可能同时存在的两个面板都要读同一份状态；
 * 3. 切换页面时正在进行的请求不应该被打断。
 */

type Listener = () => void

const IDLE: AiStatus = {
  phase: 'idle',
  message: 'AI 待命',
  progress: null,
  task: null,
  connected: false,
}

export class AiRuntime {
  private listeners = new Set<Listener>()
  private engine: AiEngine | null = null
  private engineKey = ''
  private controller: AbortController | null = null
  private status: AiStatus = { ...IDLE }
  private config: AiRuntimeConfig | null = null
  private readonly factory: AiEngineFactory | null

  constructor(factory?: AiEngineFactory) {
    this.factory = factory ?? null
  }

  getStatus(): AiStatus {
    return this.status
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  /** 把当前设置同步进来；接口/模型/Key 变了就丢掉旧引擎。 */
  configure(config: AiRuntimeConfig): void {
    this.config = config
    const key = `${config.baseUrl}|${config.model}|${config.apiKey}|${config.temperature}`
    if (key !== this.engineKey) {
      this.disposeEngine()
      this.engineKey = key
      this.patch({ connected: false })
    }
    if (!config.enabled) {
      this.disposeEngine()
      this.patch({ phase: 'off', message: 'AI 助手已在设置里关闭', progress: null, task: null })
      return
    }
    if (this.status.phase === 'off') {
      this.patch({ phase: 'idle', message: this.status.connected ? 'AI 已就绪' : 'AI 待命' })
    }
  }

  isBusy(): boolean {
    return this.status.phase === 'connecting' || this.status.phase === 'generating'
  }

  abort(): void {
    if (!this.controller) return
    this.patch({ message: '正在停止…' })
    this.controller.abort()
  }

  /** 跑一次识别；事件既交给调用方，也用来更新全局状态。 */
  async run(
    task: AiTaskKind,
    request: Omit<AiRunRequest, 'task' | 'signal'>,
    onEvent: AiEngineListener,
  ): Promise<void> {
    if (!this.config?.enabled) throw new Error('AI 助手已在设置里关闭，请到设置页开启')
    if (this.isBusy()) throw new Error('AI 正在识别，请等这一次跑完')

    const engine = await this.ensureEngine()
    const controller = new AbortController()
    this.controller = controller
    this.patch({ phase: 'connecting', message: '正在请求模型…', progress: null, task })

    const forward: AiEngineListener = (event: AiEngineEvent) => {
      this.absorb(event, task)
      onEvent(event)
    }

    try {
      await engine.run({ ...request, task, signal: controller.signal }, forward)
    } catch (error) {
      if (!controller.signal.aborted) {
        this.patch({
          phase: 'error',
          message: `识别失败：${String((error as Error)?.message ?? error)}`,
          progress: null,
          task: null,
        })
      }
      throw error
    } finally {
      if (this.controller === controller) this.controller = null
      if (this.status.phase === 'connecting' || this.status.phase === 'generating') {
        this.patch({
          phase: 'idle',
          message: controller.signal.aborted ? '已停止' : 'AI 待命',
          progress: null,
          task: null,
        })
      }
    }
  }

  dispose(): void {
    this.controller?.abort()
    this.controller = null
    this.disposeEngine()
  }

  private absorb(event: AiEngineEvent, task: AiTaskKind): void {
    if (event.type === 'status') {
      this.patch({ message: event.message })
      return
    }
    if (event.type === 'text' || event.type === 'tool-call') {
      this.patch({
        phase: 'generating',
        message: event.type === 'text' ? '正在生成…' : '正在修改待确认列表…',
        progress: null,
        task,
      })
      return
    }
    if (event.type === 'done') {
      this.patch({ phase: 'idle', message: 'AI 已就绪', progress: null, task: null, connected: true })
      return
    }
    if (event.type === 'error') {
      this.patch({ phase: 'error', message: event.message, progress: null, task })
    }
  }

  private async ensureEngine(): Promise<AiEngine> {
    if (this.engine) return this.engine
    const config = this.config
    if (!config) throw new Error('AI 尚未配置')

    const factory =
      this.factory ??
      (async (runtimeConfig: AiRuntimeConfig): Promise<AiEngine> => {
        const module = await import('./engine')
        return module.createCloudAiEngine(runtimeConfig)
      })

    this.engine = await factory(config)
    return this.engine
  }

  private disposeEngine(): void {
    this.engine?.dispose()
    this.engine = null
  }

  /** 只在内容真的变了的时候通知，避免渲染循环。 */
  private patch(next: Partial<AiStatus>): void {
    const merged = { ...this.status, ...next }
    const changed = (Object.keys(next) as Array<keyof AiStatus>).some(
      (key) => this.status[key] !== merged[key],
    )
    if (!changed) return
    this.status = merged
    for (const listener of this.listeners) listener()
  }
}

/** 建一个运行期实例；界面里用 props 传，方便测试替换。 */
export function createAiRuntime(factory?: AiEngineFactory): AiRuntime {
  return new AiRuntime(factory)
}
