import type { AiRuntimeConfig } from './types'

/** DeepSeek 官方接口（OpenAI 兼容）。 */
export const DEFAULT_BASE_URL = 'https://api.deepseek.com'
/** 默认模型：DeepSeek 官方的基础对话模型。 */
export const DEFAULT_MODEL = 'deepseek-chat'
/** 官方接口里"会思考"的那个模型。 */
export const DEEPSEEK_REASONER_MODEL = 'deepseek-reasoner'

export const AI_PREFERENCE_KEYS = {
  enabled: 'ai.enabled',
  baseUrl: 'ai.baseUrl',
  model: 'ai.model',
  apiKey: 'ai.apiKey',
  temperature: 'ai.temperature',
  thinking: 'ai.thinking',
} as const

/** 常见模型预设，方便在设置里直接选。 */
export const MODEL_PRESETS = [
  { value: 'deepseek-chat', label: 'deepseek-chat（官方，快）' },
  { value: 'deepseek-reasoner', label: 'deepseek-reasoner（官方，会思考）' },
] as const

/** 是不是 DeepSeek 官方接口：它只认自己的字段，多传会 400。 */
export function isDeepSeekOfficial(baseUrl: string): boolean {
  const text = baseUrl.trim()
  if (!text) return false
  try {
    const host = new URL(/^https?:\/\//i.test(text) ? text : `https://${text}`).hostname.toLowerCase()
    return host === 'deepseek.com' || host.endsWith('.deepseek.com')
  } catch {
    return false
  }
}

/**
 * 真正发给接口的模型名。
 *
 * DeepSeek 官方没有 `enable_thinking` 这种开关，思考是**另一个模型**（deepseek-reasoner）。
 * 所以开了思考但模型还是 deepseek-chat 时，自动换成 deepseek-reasoner；
 * 其它服务商（硅基流动等）仍然靠 enable_thinking 参数控制，模型名不动。
 */
export function resolveEffectiveModel(config: AiRuntimeConfig): string {
  const model = config.model.trim() || DEFAULT_MODEL
  if (!config.thinking) return model
  if (!isDeepSeekOfficial(config.baseUrl)) return model
  if (/reasoner/i.test(model)) return model
  return DEEPSEEK_REASONER_MODEL
}

/** 因为"开思考"而被换过模型时要提示用户。 */
export function thinkingSwitchedModel(config: AiRuntimeConfig): string | null {
  const effective = resolveEffectiveModel(config)
  return effective === config.model.trim() ? null : effective
}

/** 去掉尾部斜杠、补协议头；空串回退默认地址。 */
export function normalizeBaseUrl(value: string): string {
  const text = value.trim()
  if (!text) return DEFAULT_BASE_URL
  const withScheme = /^https?:\/\//i.test(text) ? text : `https://${text}`
  return withScheme.replace(/\/+$/, '')
}

/** 把 Key 中间打码，状态窗里显示用。 */
export function maskApiKey(apiKey: string): string {
  const text = apiKey.trim()
  if (!text) return '未填写'
  if (text.length <= 8) return `${text.slice(0, 2)}****`
  return `${text.slice(0, 4)}****${text.slice(-4)}`
}

export function isLikelyApiKey(apiKey: string): boolean {
  const text = apiKey.trim()
  // 硅基流动的 Key 形如 sk-xxxxx，这里只做基本形状校验，真正校验交给接口
  return text.length >= 12
}

/** 读取设置里的 AI 配置，非法值一律退回默认。 */
export function resolveAiConfig(preferences: Record<string, string>): AiRuntimeConfig {
  const model = (preferences[AI_PREFERENCE_KEYS.model] ?? '').trim() || DEFAULT_MODEL
  const rawTemperature = Number(preferences[AI_PREFERENCE_KEYS.temperature] ?? '0.2')
  const temperature = Number.isFinite(rawTemperature)
    ? Math.min(1, Math.max(0, rawTemperature))
    : 0.2
  return {
    enabled: (preferences[AI_PREFERENCE_KEYS.enabled] ?? '1') !== '0',
    baseUrl: normalizeBaseUrl(preferences[AI_PREFERENCE_KEYS.baseUrl] ?? ''),
    model,
    apiKey: (preferences[AI_PREFERENCE_KEYS.apiKey] ?? '').trim(),
    temperature,
    // 默认开着深度思考：DeepSeek 关掉思考后识别课程表容易漏项
    thinking: (preferences[AI_PREFERENCE_KEYS.thinking] ?? '1') !== '0',
  }
}
