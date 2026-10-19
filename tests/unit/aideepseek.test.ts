import { describe, expect, it } from '../helpers/expect'
import {
  DEEPSEEK_REASONER_MODEL,
  DEFAULT_BASE_URL,
  DEFAULT_MODEL,
  isDeepSeekOfficial,
  resolveAiConfig,
  resolveEffectiveModel,
  thinkingSwitchedModel,
} from '../../src/renderer/ai/config'
import type { AiRuntimeConfig } from '../../src/renderer/ai/types'

function config(overrides: Partial<AiRuntimeConfig> = {}): AiRuntimeConfig {
  return {
    enabled: true,
    baseUrl: DEFAULT_BASE_URL,
    model: DEFAULT_MODEL,
    apiKey: 'sk-test-1234567890',
    temperature: 0.2,
    thinking: true,
    ...overrides,
  }
}

describe('DeepSeek 官方接口', () => {
  it('默认走官方地址与 deepseek-chat', () => {
    expect(DEFAULT_BASE_URL).toBe('https://api.deepseek.com')
    expect(DEFAULT_MODEL).toBe('deepseek-chat')
    const resolved = resolveAiConfig({})
    expect(resolved.baseUrl).toBe('https://api.deepseek.com')
    expect(resolved.model).toBe('deepseek-chat')
    expect(resolved.thinking).toBe(true)
  })

  it('能认出 DeepSeek 官方域名（含 /v1 与 api. 前缀）', () => {
    expect(isDeepSeekOfficial('https://api.deepseek.com')).toBe(true)
    expect(isDeepSeekOfficial('https://api.deepseek.com/v1')).toBe(true)
    expect(isDeepSeekOfficial('https://deepseek.com/')).toBe(true)
    expect(isDeepSeekOfficial('https://api.siliconflow.cn/v1')).toBe(false)
    expect(isDeepSeekOfficial('https://notdeepseek.com')).toBe(false)
  })

  it('开思考时 chat 自动换成 reasoner，其它服务商不动模型', () => {
    expect(resolveEffectiveModel(config())).toBe(DEEPSEEK_REASONER_MODEL)
    expect(thinkingSwitchedModel(config())).toBe(DEEPSEEK_REASONER_MODEL)

    // 关掉思考就用原模型
    expect(resolveEffectiveModel(config({ thinking: false }))).toBe('deepseek-chat')
    expect(thinkingSwitchedModel(config({ thinking: false }))).toBeNull()

    // 已经是 reasoner 就不换
    expect(resolveEffectiveModel(config({ model: 'deepseek-reasoner' }))).toBe('deepseek-reasoner')
    expect(thinkingSwitchedModel(config({ model: 'deepseek-reasoner' }))).toBeNull()

    // 第三方网关：模型名由用户决定，不自动改
    const siliconflow = config({ baseUrl: 'https://api.siliconflow.cn/v1', model: 'Qwen/Qwen3.5-4B' })
    expect(resolveEffectiveModel(siliconflow)).toBe('Qwen/Qwen3.5-4B')
    expect(thinkingSwitchedModel(siliconflow)).toBeNull()
  })

  it('模型被换过时，状态窗能看出实际用的是哪个', () => {
    const switched = config()
    expect(resolveEffectiveModel(switched)).not.toBe(switched.model)
  })
})
