import type { OddEven, Period } from '../../shared/entities'

/**
 * AI 助手的公共类型。
 *
 * 只放结构与纯函数，不引入任何重依赖，测试和界面层都可以直接引用。
 * 推理已经改成调用云端 OpenAI 兼容接口（硅基流动），不再有本地模型/设备/精度这些概念。
 */

/** 两个入口共用同一套逻辑：课程录入 / 日程录入。 */
export type AiTaskKind = 'course' | 'event'

export interface AiRuntimeConfig {
  /** 是否启用 AI 助手 */
  enabled: boolean
  /** OpenAI 兼容接口地址，例如 https://api.siliconflow.cn/v1 */
  baseUrl: string
  /** 模型名，例如 Qwen/Qwen3.5-4B */
  model: string
  /** 硅基流动的 API Key（也可以由主进程的环境变量 SILICONFLOW_API_KEY 提供） */
  apiKey: string
  temperature: number
  /** 是否开启深度思考（DeepSeek 等推理模型） */
  thinking: boolean
}

/* ------------------------------------------------------------------ */
/* 草稿：课程与日程各一份，都是"先放编辑界面、用户确认后再入库"        */
/* ------------------------------------------------------------------ */

/** 课程草稿。 */
export interface DraftCourse {
  /** 界面用的稳定 key */
  key: string
  title: string
  teacher: string
  location: string
  /** 1 = 周一 … 7 = 周日 */
  weekday: number
  timeMode: 'period' | 'clock'
  startPeriod: number
  endPeriod: number
  startTime: string
  endTime: string
  weekFrom: number
  weekTo: number
  oddEven: OddEven
  /** 模型没给全信息，需要用户确认 */
  needsReview: boolean
}

/** 重复规则（与库里的 RecurRule 同构，null = 不重复）。 */
export interface DraftRepeat {
  freq: 'daily' | 'weekly' | 'biweekly' | 'monthly' | 'yearly' | 'custom'
  /** 自定义间隔的数量（配合 intervalUnit） */
  intervalValue: number | null
  intervalUnit: 'day' | 'week' | null
  /** 每周的哪几天，1=周一 … 7=周日 */
  byWeekdays: number[] | null
  /** 到哪天为止（含） */
  untilDate: string | null
  /** 一共重复几次 */
  maxCount: number | null
}

/** 日程草稿。 */
export interface DraftEvent {
  key: string
  title: string
  category: 'course' | 'activity' | 'life'
  kind: 'timed' | 'allDay' | 'startOnly' | 'todo'
  /** 'YYYY-MM-DDTHH:mm'；全天为 'YYYY-MM-DD' */
  startAt: string | null
  endAt: string | null
  /** 待办的截止时间 */
  dueAt: string | null
  location: string
  people: string
  note: string
  /** 重复规则；null = 只这一次 */
  repeat: DraftRepeat | null
  needsReview: boolean
}

/* ------------------------------------------------------------------ */
/* 交给引擎的任务描述（提示词 + 工具定义都由纯逻辑层生成）             */
/* ------------------------------------------------------------------ */

export interface AiToolDefinition {
  name: string
  description: string
  /** JSON Schema */
  parameters: Record<string, unknown>
}

export interface AiFallbackConfig {
  /** 模型直接吐 JSON 数组时，当作哪个工具调用 */
  listTool: string
  /** 数组放在哪个字段里 */
  listKey: string
}

export interface AiTaskSpec {
  tools: AiToolDefinition[]
  systemPrompt: string
  userPrompt: string
  fallback: AiFallbackConfig
}

export interface AiRunRequest {
  task: AiTaskKind
  spec: AiTaskSpec
  /** 课程表截图等图片的 data URL */
  imageDataUrl: string | null
  signal: AbortSignal
}

export type AiEngineEvent =
  | { type: 'status'; message: string; progress: number | null }
  | { type: 'text'; text: string }
  | { type: 'tool-call'; name: string; input: unknown }
  | { type: 'done'; text: string }
  | { type: 'error'; message: string }

export type AiEngineListener = (event: AiEngineEvent) => void

/** 引擎：把一次任务变成流式事件（现在是云端调用，接口保持可替换）。 */
export interface AiEngine {
  run(request: AiRunRequest, onEvent: AiEngineListener): Promise<void>
  dispose(): void
}

export type AiEngineFactory = (config: AiRuntimeConfig) => Promise<AiEngine>

/* ------------------------------------------------------------------ */
/* 全局状态：主界面右下角的状态窗读它                                 */
/* ------------------------------------------------------------------ */

export type AiPhase = 'off' | 'idle' | 'connecting' | 'generating' | 'error'

export interface AiStatus {
  phase: AiPhase
  /** 给人看的一句话 */
  message: string
  /** 0–1，目前云端调用没有确定进度，一般给 null */
  progress: number | null
  /** 正在跑哪个任务 */
  task: AiTaskKind | null
  /** 是否成功调用过（之后就是"运行正常"） */
  connected: boolean
}

/** 课程工具的上下文（建提示词时要用）。 */
export interface CoursePromptContext {
  semesterWeeks: number
  periods: Period[]
  /** 当前时间：提示词里要告诉模型"现在是什么时候" */
  now?: Date
  /** 学期第 1 周周一，用来算"当前第几周" */
  semesterStartDate?: string
}
