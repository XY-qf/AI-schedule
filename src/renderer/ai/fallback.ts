import type { AiFallbackConfig } from './types'

/**
 * 兜底解析：小模型有时不出标准工具调用，而是吐一段 JSON。
 * 这里把能认出来的片段翻译成同样的工具调用，交给上层统一处理。
 */

export interface FallbackCall {
  name: string
  input: unknown
}

/** 模型最终回答里可能残留的工具调用围栏，展示前清掉。 */
export function cleanAssistantText(text: string): string {
  return text
    .replace(/```(?:tool[_-]?call|json)?[\s\S]*?```/gi, ' ')
    .replace(/<\/?tool_call>/gi, ' ')
    .replace(/\s*\n\s*\n\s*/g, '\n')
    .trim()
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

function asCallsFromJson(value: unknown, fallback: AiFallbackConfig): FallbackCall[] {
  if (Array.isArray(value)) {
    // 可能是 [{name, arguments}, …]，也可能直接是课程/日程数组
    if (
      value.length > 0 &&
      value.every(
        (item) => item && typeof item === 'object' && ('name' in (item as object) || 'tool' in (item as object)),
      )
    ) {
      return value.flatMap((item) => asCallsFromJson(item, fallback))
    }
    return [{ name: fallback.listTool, input: { [fallback.listKey]: value } }]
  }
  if (!value || typeof value !== 'object') return []
  const record = value as Record<string, unknown>
  const name = record.name ?? record.tool ?? record.toolName ?? record.function
  if (typeof name === 'string') {
    const args =
      record.arguments ?? record.parameters ?? record.input ?? record.args ?? record.functionCall ?? {}
    return [{ name, input: typeof args === 'string' ? safeJson(args) : args }]
  }
  if (Array.isArray(record[fallback.listKey])) {
    return [{ name: fallback.listTool, input: { [fallback.listKey]: record[fallback.listKey] } }]
  }
  // 单个对象（直接给了课程/日程字段）
  if (Object.keys(record).length > 0) return [{ name: fallback.listTool, input: { [fallback.listKey]: [record] } }]
  return []
}

export function extractFallbackToolCalls(text: string, fallback: AiFallbackConfig): FallbackCall[] {
  if (!text || !text.trim()) return []
  const blocks = [
    ...text.matchAll(/```(?:json|tool[_-]?call)?\s*([\s\S]*?)```/gi),
    ...text.matchAll(/<tool_call>\s*([\s\S]*?)\s*<\/tool_call>/gi),
  ].map((match) => match[1])

  const candidates = [...blocks]
  const arrayStart = text.indexOf('[')
  const arrayEnd = text.lastIndexOf(']')
  if (arrayStart >= 0 && arrayEnd > arrayStart) {
    candidates.push(text.slice(arrayStart, arrayEnd + 1))
  }
  // 整段就是一个 JSON（模型直接吐了对象/数组，没有围栏）
  candidates.push(text.trim())

  const calls: FallbackCall[] = []
  for (const candidate of candidates) {
    const trimmed = candidate.trim()
    if (!trimmed) continue
    const parsed = safeJson(trimmed)
    if (typeof parsed === 'string') continue
    calls.push(...asCallsFromJson(parsed, fallback))
    if (calls.length > 0) break
  }
  return calls
}
