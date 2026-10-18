import { getApi } from '../api'
import type { AiChatMessage, AiChatTool, AiChatToolCall } from '../../shared/aiChat'
import { cleanAssistantText, extractFallbackToolCalls } from './fallback'
import { resolveEffectiveModel, thinkingSwitchedModel } from './config'
import type { AiEngine, AiEngineListener, AiRunRequest, AiRuntimeConfig } from './types'

/**
 * 云端引擎：把任务转成一次 OpenAI 兼容的 /chat/completions 调用。
 *
 * - 网络请求由主进程代发（渲染进程的 app:// origin 会被第三方接口的 CORS 挡掉）；
 * - 工具调用走标准 OpenAI function calling，参数在结果里一次拿全；
 * - 有工具调用时补一轮"无工具"的请求让模型用一句话总结，失败就忽略；
 * - 模型没走工具调用时，退回"从回答里解析 JSON"的兜底。
 */

function newRequestId(): string {
  return `ai-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function parseToolArguments(raw: string): unknown {
  const text = raw.trim()
  if (!text) return {}
  try {
    return JSON.parse(text)
  } catch {
    return { raw }
  }
}

function buildMessages(request: AiRunRequest, textOnly = false): AiChatMessage[] {
  const messages: AiChatMessage[] = [{ role: 'system', content: request.spec.systemPrompt }]
  if (request.imageDataUrl && !textOnly) {
    messages.push({
      role: 'user',
      content: [
        { type: 'text', text: request.spec.userPrompt },
        { type: 'image_url', image_url: { url: request.imageDataUrl } },
      ],
    })
  } else {
    messages.push({ role: 'user', content: request.spec.userPrompt })
  }
  return messages
}

function buildTools(request: AiRunRequest): AiChatTool[] {
  return request.spec.tools.map((tool) => ({
    type: 'function' as const,
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    },
  }))
}

/** 把"图片不被支持"这类 4xx 认出来，好退化成纯文字再试一次。 */
function looksLikeImageRejected(message: string): boolean {
  return /image|vision|multimodal|图片|图像/i.test(message) && /400|415|422|invalid|unsupported/i.test(message)
}

export function createCloudAiEngine(config: AiRuntimeConfig): AiEngine {
  let disposed = false

  interface CallResult {
    text: string
    toolCalls: AiChatToolCall[]
  }

  async function call(
    messages: AiChatMessage[],
    tools: AiChatTool[] | undefined,
    signal: AbortSignal,
    onText: (delta: string) => void,
    onHeartbeat: (message: string) => void,
  ): Promise<CallResult> {
    const api = getApi()
    const id = newRequestId()
    let failure: string | null = null
    const onAbort = (): void => api.aiCancel(id)
    signal.addEventListener('abort', onAbort)
    try {
      const outcome = await api.aiChat(
        {
          id,
          baseUrl: config.baseUrl,
          model: resolveEffectiveModel(config),
          apiKey: config.apiKey,
          messages,
          tools,
          temperature: config.temperature,
          // DeepSeek 这类推理模型：思考开着识别更准，关掉更快
          enableThinking: config.thinking,
          // 思考模式下推理过程也要占额度，放宽一点防截断
          maxTokens: config.thinking ? 8192 : 4096,
        },
        (chunk) => {
          if (chunk.type === 'text') onText(chunk.text)
          else if (chunk.type === 'heartbeat') {
            const seconds = Math.max(1, Math.round(chunk.elapsedMs / 1000))
            if (chunk.toolCalls > 0) {
              onHeartbeat(`模型正在整理字段…（已 ${seconds} 秒，收到 ${chunk.toolCalls} 组工具调用）`)
            } else if (chunk.reasoningChars > 0) {
              onHeartbeat(`模型正在思考…（已 ${seconds} 秒，思考 ${chunk.reasoningChars} 字）`)
            } else {
              onHeartbeat(`模型正在生成…（已 ${seconds} 秒）`)
            }
          } else if (chunk.type === 'error') failure = chunk.message
        },
      )
      if (!outcome.ok) throw new Error(outcome.error ?? failure ?? '调用失败')
      return { text: outcome.text ?? '', toolCalls: outcome.toolCalls ?? [] }
    } finally {
      signal.removeEventListener('abort', onAbort)
    }
  }

  async function run(request: AiRunRequest, onEvent: AiEngineListener): Promise<void> {
    if (disposed) throw new Error('AI 引擎已释放')
    if (!config.apiKey) {
      throw new Error('还没填 API Key：请到「设置 → AI 助手」填写 DeepSeek 的 API Key')
    }

    const model = resolveEffectiveModel(config)
    const switched = thinkingSwitchedModel(config)
    onEvent({
      type: 'status',
      message: switched
        ? `正在请求 ${model}…（开了深度思考，已从 ${config.model} 换成 ${model}）`
        : `正在请求 ${model}…`,
      progress: null,
    })

    const tools = buildTools(request)
    const onText = (delta: string): void => {
      onEvent({ type: 'text', text: delta })
    }
    const onHeartbeat = (message: string): void => {
      onEvent({ type: 'status', message, progress: null })
    }

    let result: CallResult
    try {
      result = await call(buildMessages(request), tools, request.signal, onText, onHeartbeat)
    } catch (error) {
      const message = String((error as Error)?.message ?? error)
      // 有些文本模型不接受图文混排，去掉图片再试一次
      if (request.imageDataUrl && looksLikeImageRejected(message)) {
        onEvent({ type: 'status', message: '当前模型不支持图片，改用文字再试一次…', progress: null })
        result = await call(buildMessages(request, true), tools, request.signal, onText, onHeartbeat)
        onEvent({ type: 'status', message: '提示：图片没有发出去，识别结果可能不完整', progress: null })
      } else {
        throw error
      }
    }

    if (request.signal.aborted) {
      onEvent({ type: 'status', message: '已停止', progress: null })
      return
    }

    let text = result.text
    if (result.toolCalls.length > 0) {
      for (const toolCall of result.toolCalls) {
        onEvent({
          type: 'tool-call',
          name: toolCall.function.name,
          input: parseToolArguments(toolCall.function.arguments),
        })
      }

      // 再补一轮"无工具"的请求，让模型用一句话收尾（失败不影响已完成的修改）
      try {
        onEvent({ type: 'status', message: '正在整理结果…', progress: null })
        const toolResults: AiChatMessage[] = result.toolCalls.map((toolCall) => ({
          role: 'tool' as const,
          tool_call_id: toolCall.id,
          content: '{"ok":true}',
        }))
        const summary = await call(
          [
            ...buildMessages(request, Boolean(request.imageDataUrl)),
            { role: 'assistant', content: text || null, tool_calls: result.toolCalls },
            ...toolResults,
          ],
          undefined,
          request.signal,
          onText,
          onHeartbeat,
        )
        if (summary.text.trim()) text = summary.text
      } catch {
        /* 收尾失败就用原来的文本 */
      }
    } else {
      // 模型没走工具调用：从回答里兜底解析 JSON
      for (const fallbackCall of extractFallbackToolCalls(text, request.spec.fallback)) {
        onEvent({ type: 'tool-call', name: fallbackCall.name, input: fallbackCall.input })
      }
    }

    onEvent({ type: 'done', text: cleanAssistantText(text) })
  }

  function dispose(): void {
    disposed = true
  }

  return { run, dispose }
}
