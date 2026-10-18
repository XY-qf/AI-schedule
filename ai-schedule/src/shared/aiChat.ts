/**
 * 云端大模型调用的公共契约（主进程 ↔ preload ↔ 渲染进程）。
 *
 * 用的是 OpenAI 兼容的 /chat/completions 协议（硅基流动就是这个协议），
 * 这样不需要任何第三方 SDK，主进程用原生 fetch 流式取回即可。
 */

export type AiChatRole = 'system' | 'user' | 'assistant' | 'tool'

export interface AiChatContentPart {
  type: 'text' | 'image_url'
  text?: string
  image_url?: { url: string }
}

export interface AiChatToolCall {
  id: string
  type: 'function'
  function: { name: string; arguments: string }
}

export interface AiChatMessage {
  role: AiChatRole
  content?: string | AiChatContentPart[] | null
  /** assistant 发起的工具调用 */
  tool_calls?: AiChatToolCall[]
  /** role=tool 时对应哪一次调用 */
  tool_call_id?: string
}

export interface AiChatTool {
  type: 'function'
  function: { name: string; description: string; parameters: Record<string, unknown> }
}

export interface AiChatPayload {
  /** 本地请求 id，用于把流式分片对回调用方 */
  id: string
  baseUrl: string
  model: string
  /** 可以不传：主进程会回退到环境变量 SILICONFLOW_API_KEY */
  apiKey?: string
  messages: AiChatMessage[]
  tools?: AiChatTool[]
  temperature?: number
  maxTokens?: number
  /**
   * 是否让模型走"深度思考"。
   * Qwen3 系列默认开启思考，会先吐 reasoning_content、正文迟迟不来，
   * 我们这种"填表单"的活不需要，默认关掉。
   */
  enableThinking?: boolean
  /** 超时（毫秒），默认 180 秒 */
  timeoutMs?: number
}

export type AiChatChunk =
  | { type: 'text'; text: string }
  /** 每秒一次的心跳：模型还在写（思考阶段没有正文，靠它让界面别像死机） */
  | { type: 'heartbeat'; elapsedMs: number; toolCalls: number; reasoningChars: number }
  | { type: 'done'; finishReason: string | null }
  | { type: 'error'; message: string }

export interface AiChatResult {
  text: string
  toolCalls: AiChatToolCall[]
  finishReason: string | null
}

export interface AiModelsPayload {
  baseUrl: string
  apiKey?: string
}

export interface AiModelsResult {
  ok: boolean
  error?: string
  models: string[]
}
