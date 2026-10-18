import type {
  AiChatChunk,
  AiChatPayload,
  AiChatResult,
  AiChatToolCall,
} from '../shared/aiChat'

/**
 * OpenAI 兼容接口的流式客户端（主进程）。
 *
 * 放在主进程的原因：渲染进程的 origin 是自定义的 app://，直连第三方接口会被 CORS 挡；
 * 主进程用原生 fetch 没有这个限制，也不经过任何 SDK。
 *
 * 三个细节都踩过坑：
 * 1. 收到 `data: [DONE]` 必须立刻结束——服务端可能不马上关连接，光等流结束会一直挂着；
 * 2. 纯工具调用时模型不吐正文，界面会以为死机，所以定时发心跳（已等待多少秒）；
 * 3. 首字节超时单独判定（20 秒），区分"网络不通/Key 不对"和"模型在慢慢写"。
 */

interface RunOptions {
  apiKey: string
  signal: AbortSignal
  onChunk: (chunk: AiChatChunk) => void
}

/** 连上以后（或连都没连上时）连续这么久没有任何新内容，就认为卡住了 */
const IDLE_TIMEOUT_MS = 45_000

/** 把 SSE 文本按行拆开，兼容 \r\n 与跨块分片。 */
export function splitSseEvents(buffer: string): { events: string[]; rest: string } {
  const events: string[] = []
  let rest = buffer
  let index = rest.indexOf('\n\n')
  while (index >= 0) {
    events.push(rest.slice(0, index))
    rest = rest.slice(index + 2)
    index = rest.indexOf('\n\n')
  }
  // 也兼容只有 \r\n\r\n 的情况
  if (events.length === 0 && rest.includes('\r\n\r\n')) {
    const parts = rest.split('\r\n\r\n')
    rest = parts.pop() ?? ''
    events.push(...parts)
  }
  return { events, rest }
}

/** 从一个 SSE 事件块里取出 data 负载（忽略注释行与 event 名）。 */
export function extractSseData(event: string): string | null {
  const lines = event.split(/\r?\n/)
  const data: string[] = []
  for (const line of lines) {
    if (!line.startsWith('data:')) continue
    data.push(line.slice(5).replace(/^\s/, ''))
  }
  if (data.length === 0) return null
  return data.join('\n')
}

interface ToolCallAccumulator {
  id: string
  name: string
  arguments: string
}

/** 官方接口只认自己的字段，多传会 400（硅基流动这类才接受 enable_thinking）。 */
function isDeepSeekOfficial(baseUrl: string): boolean {
  const text = baseUrl.trim()
  if (!text) return false
  try {
    const host = new URL(/^https?:\/\//i.test(text) ? text : `https://${text}`).hostname.toLowerCase()
    return host === 'deepseek.com' || host.endsWith('.deepseek.com')
  } catch {
    return false
  }
}

/** GET /models：列出当前 Key 可用的模型 id，用来核对模型名。 */
export async function listModels(options: {
  baseUrl: string
  apiKey: string
  signal?: AbortSignal
}): Promise<string[]> {
  const baseUrl = options.baseUrl.trim().replace(/\/+$/, '')
  const response = await fetch(`${baseUrl}/models`, {
    headers: { authorization: `Bearer ${options.apiKey}` },
    signal: options.signal,
  })
  if (!response.ok) {
    const detail = await response.text().catch(() => '')
    throw new Error(`接口返回 ${response.status}：${detail.slice(0, 300) || response.statusText}`)
  }
  const payload = (await response.json()) as { data?: Array<{ id?: string }> }
  return (payload.data ?? [])
    .map((item) => String(item.id ?? ''))
    .filter((id) => id.length > 0)
    .sort()
}

export async function streamChat(payload: AiChatPayload, options: RunOptions): Promise<AiChatResult> {
  const baseUrl = payload.baseUrl.trim().replace(/\/+$/, '')
  const url = `${baseUrl}/chat/completions`
  const controller = new AbortController()
  const onOuterAbort = (): void => controller.abort()
  options.signal.addEventListener('abort', onOuterAbort)

  const totalTimer = setTimeout(() => controller.abort(), payload.timeoutMs ?? 180_000)
  let idleTimedOut = false
  let sawData = false
  // 从"发出请求"开始算，所以首字节迟迟不来也算空闲超时
  let lastDataAt = Date.now()
  let text = ''
  let reasoningChars = 0
  const calls = new Map<number, ToolCallAccumulator>()
  let finishReason: string | null = null

  const startedAt = Date.now()
  const heartbeat = setInterval(() => {
    options.onChunk({
      type: 'heartbeat',
      elapsedMs: Date.now() - startedAt,
      toolCalls: calls.size,
      reasoningChars,
    })
    if (Date.now() - lastDataAt > IDLE_TIMEOUT_MS) {
      idleTimedOut = true
      controller.abort()
    }
  }, 1000)

  const thinking = payload.enableThinking === true
  const body: Record<string, unknown> = {
    model: payload.model,
    messages: payload.messages,
    stream: true,
    temperature: payload.temperature ?? 0.2,
  }
  if (!isDeepSeekOfficial(baseUrl)) {
    // 硅基流动这类网关：vLLM 系实现认 enable_thinking，另有实现读 chat_template_kwargs，
    // 多塞一个键不会报错，所以两种都带上。
    body.enable_thinking = thinking
    body.chat_template_kwargs = { enable_thinking: thinking, thinking }
  }
  // DeepSeek 官方不用这些字段：思考与否由模型名决定（deepseek-reasoner）
  if (payload.maxTokens) body.max_tokens = payload.maxTokens
  if (payload.tools && payload.tools.length > 0) {
    body.tools = payload.tools
    body.tool_choice = 'auto'
  }

  try {
    let response: Response
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${options.apiKey}`,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      })
    } catch (error) {
      if (!sawData && idleTimedOut) {
        throw new Error(
          `接口 ${IDLE_TIMEOUT_MS / 1000} 秒没有响应：检查网络能否访问 ${baseUrl}，或 API Key 是否可用`,
        )
      }
      throw error
    }

    if (!response.ok) {
      const detail = await response.text().catch(() => '')
      throw new Error(`接口返回 ${response.status}：${detail.slice(0, 400) || response.statusText}`)
    }
    if (!response.body) throw new Error('接口没有返回内容')

    const decoder = new TextDecoder()
    let buffer = ''
    let done = false

    for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
      sawData = true
      lastDataAt = Date.now()
      buffer += decoder.decode(chunk, { stream: true })
      const { events, rest } = splitSseEvents(buffer)
      buffer = rest
      for (const event of events) {
        const data = extractSseData(event)
        if (!data) continue
        // 服务端说完了就别再等连接关闭
        if (data.trim() === '[DONE]') {
          done = true
          break
        }
        let parsed: {
          choices?: Array<{
            delta?: {
              content?: string | null
              reasoning_content?: string | null
              tool_calls?: Array<{
                index?: number
                id?: string
                function?: { name?: string; arguments?: string }
              }>
            }
            finish_reason?: string | null
          }>
        }
        try {
          parsed = JSON.parse(data)
        } catch {
          continue
        }
        const choice = parsed.choices?.[0]
        if (!choice) continue
        const delta = choice.delta ?? {}
        // 思考内容不进正文，只记长度（界面用它显示"正在思考"）
        if (typeof delta.reasoning_content === 'string' && delta.reasoning_content.length > 0) {
          reasoningChars += delta.reasoning_content.length
        }
        if (typeof delta.content === 'string' && delta.content.length > 0) {
          text += delta.content
          options.onChunk({ type: 'text', text: delta.content })
        }
        if (delta.tool_calls) {
          for (const [fallbackIndex, call] of delta.tool_calls.entries()) {
            const index = typeof call.index === 'number' ? call.index : fallbackIndex
            const current = calls.get(index) ?? { id: '', name: '', arguments: '' }
            if (call.id) current.id = call.id
            if (call.function?.name) current.name = call.function.name
            if (call.function?.arguments) current.arguments += call.function.arguments
            calls.set(index, current)
          }
        }
        if (choice.finish_reason) finishReason = choice.finish_reason
      }
      if (done) break
    }
  } catch (error) {
    if (idleTimedOut) {
      throw new Error(
        sawData
          ? `接口连续 ${IDLE_TIMEOUT_MS / 1000} 秒没有返回新内容，已中止：可能是模型排队太久或网络中途断开`
          : `接口 ${IDLE_TIMEOUT_MS / 1000} 秒没有响应：检查网络能否访问 ${baseUrl}，或 API Key 是否可用`,
      )
    }
    throw error
  } finally {
    clearInterval(heartbeat)
    clearTimeout(totalTimer)
    options.signal.removeEventListener('abort', onOuterAbort)
  }

  const toolCalls: AiChatToolCall[] = [...calls.entries()]
    .sort((a, b) => a[0] - b[0])
    .filter(([, call]) => call.name.length > 0)
    .map(([index, call]) => ({
      id: call.id || `call_${index}`,
      type: 'function' as const,
      function: { name: call.name, arguments: call.arguments || '{}' },
    }))

  options.onChunk({ type: 'done', finishReason })
  return { text, toolCalls, finishReason }
}
