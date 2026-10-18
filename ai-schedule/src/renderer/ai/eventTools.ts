import type { AiFallbackConfig, AiTaskSpec, AiToolDefinition, DraftEvent } from './types'
import { EVENT_CATEGORY_LABEL, EVENT_KIND_LABEL, summarizeEventDraft, type EventDraftContext } from './eventDraft'
import { formatNowText } from './nowText'

/**
 * 日程录入的提示词与工具定义（与课程那套同构）。
 *
 * 日程比课程多了"哪天几点"：模型必须输出绝对日期，所以提示词里会塞进今天的日期。
 */

const EVENT_ITEM_SCHEMA = {
  type: 'object',
  properties: {
    title: { type: 'string', description: '日程标题，例如「组会」「打疫苗」' },
    category: {
      type: 'string',
      description: '类别：course=课内，activity=课外活动，life=个人生活',
      enum: ['course', 'activity', 'life'],
    },
    kind: {
      type: 'string',
      description:
        '时间形态：timed=有起止时刻，allDay=只有日期，startOnly=只有开始时间，todo=只有截止时间',
      enum: ['timed', 'allDay', 'startOnly', 'todo'],
    },
    startAt: { type: 'string', description: '开始：YYYY-MM-DD HH:mm（allDay 只写 YYYY-MM-DD）' },
    endAt: { type: 'string', description: '结束：YYYY-MM-DD HH:mm' },
    dueAt: { type: 'string', description: '截止时间：todo 用，YYYY-MM-DD 或 YYYY-MM-DD HH:mm' },
    location: { type: 'string', description: '地点，没写就省略' },
    people: { type: 'string', description: '和谁，没写就省略' },
    note: { type: 'string', description: '备注，没写就省略' },
    repeat: {
      type: ['object', 'null'],
      description:
        '重复规则；只发生一次就省略。用户说「每周一三五」「每两周」「每天」「每月 5 号」时用它。'
        + '取消重复给 null。',
      properties: {
        freq: {
          type: 'string',
          description: '频次：daily=每天，weekly=每周，biweekly=每两周，monthly=每月，yearly=每年，custom=自定义间隔',
          enum: ['daily', 'weekly', 'biweekly', 'monthly', 'yearly', 'custom'],
        },
        byWeekdays: {
          type: 'array',
          description: '每周的哪几天，1=周一 … 7=周日，例如「每周一三五」= [1,3,5]',
          items: { type: 'integer', minimum: 1, maximum: 7 },
        },
        untilDate: { type: 'string', description: '重复到哪天为止（含），YYYY-MM-DD' },
        maxCount: { type: 'integer', description: '一共重复几次（含第一次）', minimum: 1 },
        intervalValue: { type: 'integer', description: 'freq=custom 时每隔几个单位重复一次', minimum: 1 },
        intervalUnit: { type: 'string', description: 'custom 的间隔单位', enum: ['day', 'week'] },
      },
    },
  },
  required: ['title'],
} as const

export const EVENT_TOOLS: Record<string, AiToolDefinition> = {
  addEvents: {
    name: 'add_events',
    description:
      '把识别到的多条日程一次性加入待确认列表。一次说了好几件事时必须用这个调用一次提交。',
    parameters: {
      type: 'object',
      properties: {
        events: { type: 'array', description: '要加入的日程列表', items: EVENT_ITEM_SCHEMA },
      },
      required: ['events'],
    },
  },
  addEvent: {
    name: 'add_event',
    description: '只加入一条日程。用户一次只说到一件事时用它。',
    parameters: EVENT_ITEM_SCHEMA as unknown as Record<string, unknown>,
  },
  updateEvent: {
    name: 'update_event',
    description: '修改待确认列表里已有的一条日程。用序号 index（从 1 开始）指出改哪一条。',
    parameters: {
      type: 'object',
      properties: {
        index: { type: 'integer', description: '改第几条，从 1 开始', minimum: 1 },
        ...(EVENT_ITEM_SCHEMA.properties as Record<string, unknown>),
      },
      required: ['index'],
    },
  },
  removeEvent: {
    name: 'remove_event',
    description: '从待确认列表里删掉一条日程。用序号 index（从 1 开始）。',
    parameters: {
      type: 'object',
      properties: {
        index: { type: 'integer', description: '删第几条，从 1 开始', minimum: 1 },
        title: { type: 'string', description: '也可以直接给标题' },
      },
    },
  },
  clearEvents: {
    name: 'clear_events',
    description: '清空待确认列表（用户说「重新来」「都删掉」时用）。',
    parameters: {
      type: 'object',
      properties: { reason: { type: 'string', description: '清空原因，可省略' } },
    },
  },
}

export const EVENT_TOOL_LIST: AiToolDefinition[] = Object.values(EVENT_TOOLS)

export const EVENT_FALLBACK: AiFallbackConfig = { listTool: 'add_events', listKey: 'events' }

const KIND_HINT = Object.entries(EVENT_KIND_LABEL)
  .map(([key, label]) => `${key}=${label}`)
  .join('，')
const CATEGORY_HINT = Object.entries(EVENT_CATEGORY_LABEL)
  .map(([key, label]) => `${key}=${label}`)
  .join('，')

/** 提示词里的"现在时间"：有具体时刻就用它，只有日期时退回 today。 */
function nowText(context: EventDraftContext): string {
  if (!context.now) return context.today
  return formatNowText(context.now)
}

export function buildEventSystemPrompt(context: EventDraftContext): string {
  return [
    '你是「AI 日程」的日程录入助手。你的任务是把用户说的话整理成日程，并通过工具调用写进待确认列表。',
    '',
    '必须遵守：',
    '1. 只能通过工具调用写日程，不要用表格或列表复述。',
    '2. 一次说到多件事时，用一次 add_events 全部提交，不要拆成多次调用。',
    `3. 【现在时间】${nowText(context)}，所以今天是 ${context.today}。`
      + '所有日期都必须是绝对日期 YYYY-MM-DD，不要输出「明天」这种相对说法。',
    '4. 时间形态：' + KIND_HINT + '。用户没说的按最接近的形态推断：',
    '   - 只说了截止 → todo；只说日期不说时刻 → allDay；有开始没结束 → startOnly；起止都有 → timed。',
    `5. 类别：${CATEGORY_HINT}。没说就省略，界面会默认填「课外活动」。`,
    '6. 不确定的字段省略，不要编造；title 必须给出，缺日期会在界面上标黄让用户补。',
    '7. 【重复】用户说「每周」「每天」「每月」「隔周」这类周期时，在 repeat 里写清楚，不要只记第一次：',
    '   - 每周一三五 → {"freq":"weekly","byWeekdays":[1,3,5]}（1=周一 … 7=周日）',
    '   - 每两周一次 → {"freq":"biweekly"}；每周一次 → {"freq":"weekly"}',
    '   - 每天/每天早上 → {"freq":"daily"}；每月 5 号 → {"freq":"monthly"}（以 startAt 那天为准）',
    '   - 每 10 天 / 每 3 周这种自定义间隔 → {"freq":"custom","intervalValue":10,"intervalUnit":"day"}',
    '   - 「到期末」「到 12 月 31 日」→ untilDate；「一共 10 次」→ maxCount',
    '   - startAt 必须写成第一次发生的那个日期；用户没说期限就只给 freq，界面上可以再调。',
    '   用户明确说只这一次、或完全没有周期含义时省略 repeat。',
    '8. 全部写完用一句话说明你做了什么（例如「已记录 3 条日程，请检查」）。',
    '9. 如果工具调用不可用，就用 ```tool_call 代码块输出一行 JSON，例如：',
    '```tool_call',
    '{"name":"add_events","arguments":{"events":[{"title":"组会","category":"activity","kind":"timed","startAt":"2026-03-04 14:00","endAt":"2026-03-04 15:30","location":"实验楼"}]}}',
    '```',
  ].join('\n')
}

function draftListText(drafts: DraftEvent[]): string {
  if (drafts.length === 0) return '（待确认列表里还没有日程）'
  return drafts
    .map((draft, index) => {
      const summary = summarizeEventDraft(draft)
      return `${index + 1}. ${draft.title}｜${summary.when}｜${EVENT_KIND_LABEL[draft.kind]}`
    })
    .join('\n')
}

function compactRules(context: EventDraftContext): string {
  return [
    '【任务】识别这张图里的日程信息，把每一件事都写进待确认列表。',
    '【规则】',
    '- 只能通过工具调用写入；多件事用一次 add_events 全部提交。',
    `- 【现在时间】${nowText(context)}，今天是 ${context.today}；日期必须输出绝对日期 YYYY-MM-DD，时间 HH:mm。`,
    '- 时间形态：' + KIND_HINT + '。',
    '- 有周期含义时写 repeat：每周一三五 → {"freq":"weekly","byWeekdays":[1,3,5]}；'
      + '每两周 → {"freq":"biweekly"}；每天 → {"freq":"daily"}；到某天为止 → untilDate；共 N 次 → maxCount。',
    '- 看不清的直接跳过，不要编造。',
    '- 最后用一句话说明记录了几条。',
  ].join('\n')
}

export interface EventPromptOptions {
  text: string
  hasImage: boolean
  context: EventDraftContext
  drafts: DraftEvent[]
}

export function buildEventUserPrompt(options: EventPromptOptions): string {
  const { text, hasImage, context, drafts } = options
  const parts: string[] = []
  if (hasImage) parts.push(compactRules(context))
  if (drafts.length > 0) {
    parts.push(`待确认列表里现有的日程（序号从 1 开始）：\n${draftListText(drafts)}`)
  }
  const trimmed = text.trim()
  if (trimmed) parts.push(trimmed)
  if (parts.length === 0) parts.push('请看看我给的图，把日程加进来。')
  return parts.join('\n\n')
}

export function buildEventTask(options: EventPromptOptions): AiTaskSpec {
  return {
    tools: EVENT_TOOL_LIST,
    systemPrompt: buildEventSystemPrompt(options.context),
    userPrompt: buildEventUserPrompt(options),
    fallback: EVENT_FALLBACK,
  }
}
