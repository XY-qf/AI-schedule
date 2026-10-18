import type { AiFallbackConfig, AiTaskSpec, AiToolDefinition, CoursePromptContext, DraftCourse } from './types'
import { WEEKDAY_LABEL, summarizeDraft } from './draft'
import type { Course } from '../../shared/entities'
import { describeCourseTime, describeCourseWeeks } from '../../shared/courseUi'
import { formatNowText } from './nowText'

/**
 * 课程录入的提示词与工具定义。
 *
 * 这里只用 JSON Schema 描述参数（不绑定 zod），因为：
 * 1. 参数校验由我们自己的 draft.ts 做，容忍 2B 模型的各种不规范输出；
 * 2. 同一份 schema 会原样塞进 Qwen 的 chat template。
 */

const COURSE_ITEM_SCHEMA = {
  type: 'object',
  properties: {
    title: { type: 'string', description: '课程名，例如「高等数学」' },
    teacher: { type: 'string', description: '老师姓名，没写就省略' },
    location: { type: 'string', description: '上课地点，没写就省略' },
    weekday: {
      type: 'integer',
      description: '星期几：1=周一，2=周二 …… 7=周日',
      minimum: 1,
      maximum: 7,
    },
    startPeriod: { type: 'integer', description: '开始节次，从 1 开始', minimum: 1 },
    endPeriod: { type: 'integer', description: '结束节次，与 startPeriod 相同时表示只占一节' },
    startTime: { type: 'string', description: '开始时间 HH:MM（只有按具体时间上课时才用）' },
    endTime: { type: 'string', description: '结束时间 HH:MM（只有按具体时间上课时才用）' },
    weekFrom: { type: 'integer', description: '起始周，默认 1', minimum: 1 },
    weekTo: { type: 'integer', description: '结束周，默认学期总周数', minimum: 1 },
    oddEven: {
      type: 'string',
      description: '单双周：all=每周都上，odd=单周，even=双周',
      enum: ['all', 'odd', 'even'],
    },
  },
  required: ['title', 'weekday'],
} as const

export const COURSE_TOOLS: Record<string, AiToolDefinition> = {
  addCourses: {
    name: 'add_courses',
    description:
      '把识别到的多门课程一次性加入课程编辑界面。识别到课程表截图里的全部课程时只用一次这个调用。',
    parameters: {
      type: 'object',
      properties: {
        courses: {
          type: 'array',
          description: '要加入的课程列表',
          items: COURSE_ITEM_SCHEMA,
        },
      },
      required: ['courses'],
    },
  },
  addCourse: {
    name: 'add_course',
    description: '只加入一门课程。用户一次只提到一门课时用它。',
    parameters: COURSE_ITEM_SCHEMA as unknown as Record<string, unknown>,
  },
  updateCourse: {
    name: 'update_course',
    description: '修改编辑界面里已有的一门课程。用序号 index（从 1 开始）指出改哪一门。',
    parameters: {
      type: 'object',
      properties: {
        index: { type: 'integer', description: '改第几条，从 1 开始', minimum: 1 },
        ...(COURSE_ITEM_SCHEMA.properties as Record<string, unknown>),
      },
      required: ['index'],
    },
  },
  removeCourse: {
    name: 'remove_course',
    description: '从编辑界面里删掉一条课程。用序号 index（从 1 开始）指出删哪一条。',
    parameters: {
      type: 'object',
      properties: {
        index: { type: 'integer', description: '删第几条，从 1 开始', minimum: 1 },
        title: { type: 'string', description: '也可以直接给课程名' },
      },
    },
  },
  clearCourses: {
    name: 'clear_courses',
    description: '清空编辑界面里的全部课程（用户说「重新来」「都删掉」时用）。',
    parameters: {
      type: 'object',
      properties: {
        reason: { type: 'string', description: '清空的原因，可省略' },
      },
    },
  },
}

export const COURSE_TOOL_LIST: AiToolDefinition[] = Object.values(COURSE_TOOLS)

export const COURSE_FALLBACK: AiFallbackConfig = { listTool: 'add_courses', listKey: 'courses' }

function periodTable(context: CoursePromptContext): string {
  if (context.periods.length === 0) return '（还没有设置作息时间表，节次按 1 起计）'
  return context.periods
    .slice(0, 16)
    .map((item) => `${item.orderIndex}:${item.startTime}-${item.endTime}`)
    .join('，')
}

export function buildSystemPrompt(context: CoursePromptContext): string {
  return [
    '你是「AI 日程」的课程录入助手。你的任务是把用户说的话或课程表截图整理成课程，并通过工具调用写进课程编辑界面。',
    '',
    '必须遵守：',
    '1. 只能通过工具调用写下课程，不要用表格、列表或代码块复述课程。',
    '2. 识别到多门课程时，用一次 add_courses 把全部课程一起提交，不要拆成很多次调用。',
    `3. weekday 用数字 1-7（1=周一 … 7=周日）；节次用整数 startPeriod/endPeriod（从 1 开始）；`,
    `   周次用 weekFrom/weekTo（没写就是 1 到 ${context.semesterWeeks}）；单双周 oddEven=all/odd/even。`,
    '4. 不确定的字段可以省略，不要编造；title 与 weekday 尽量给出，缺了界面上会标黄让用户补。',
    '5. 全部写完以后，用一句话说明你做了什么（例如「已识别 8 门课程，请检查」），不要重复罗列。',
    '6. 用户要求修改或删除已有课程时，用 update_course / remove_course，序号从 1 开始。',
    '7. 看不清的截图要直接说明是看不清，不要猜。',
    '8. 如果工具调用不可用，就用 ```tool_call 代码块输出一行 JSON，例如：',
    '```tool_call',
    '{"name":"add_courses","arguments":{"courses":[{"title":"高等数学","weekday":1,"startPeriod":1,"endPeriod":2,"weekFrom":1,"weekTo":16}]}}',
    '```',
    '9. 【重要】课表里已经有的课程不要再加一遍：如果某门课在下面"已经存在"的清单里，'
      + '并且星期、节次（或时间）都对得上，就跳过它，不要放进 add_courses。',
    '   只有用户明确说"改一下""换教室"时才用 update_course；不要为了让课表"看起来完整"而重复添加。',
    '10. 「今天/明天/这周/下周」这类说法以【现在时间】为准；用户提到的时间如果已经不在学期范围内，照实写并在回答里提醒。',
    '',
    `【现在时间】${formatNowText(context.now ?? new Date(), context.semesterStartDate)}`,
    `作息时间表（节次:起-止）：${periodTable(context)}`,
    `学期总周数：${context.semesterWeeks}`,
  ].join('\n')
}

function draftListText(drafts: DraftCourse[], context: CoursePromptContext): string {
  if (drafts.length === 0) return '（编辑界面里还没有课程）'
  return drafts
    .map((draft, index) => {
      const summary = summarizeDraft(draft, context.periods)
      return `${index + 1}. ${WEEKDAY_LABEL[draft.weekday - 1] ?? ''} ${draft.title}｜${summary.time}｜${summary.weeks}`
    })
    .join('\n')
}

/** 课表里已经存在的课程：给模型看，避免它把同一门课再加一遍。 */
function existingListText(existing: Course[], context: CoursePromptContext): string {
  if (existing.length === 0) return ''
  const lines = existing
    .slice(0, 60)
    .map((course, index) => {
      const time = describeCourseTime(course, context.periods)
      const weeks = describeCourseWeeks(course)
      return `${index + 1}. ${WEEKDAY_LABEL[course.weekday - 1] ?? ''} ${course.title}｜${time}｜${weeks}`
    })
    .join('\n')
  return `课表里【已经存在】的课程（这些不要再加一遍，只有用户明确要求时才用 update_course 改）：\n${lines}`
}

/** 图片请求时把关键规则再塞进用户消息，避免系统提示被弱化。 */
function compactRules(context: CoursePromptContext): string {
  return [
    '【任务】识别这张课程表截图，把表格里的每一门课都写进课程编辑界面。',
    '【规则】',
    '- 只能通过工具调用写入；识别到多门课时，用一次 add_courses 提交全部课程。',
    '- weekday 用 1-7（1=周一）；节次用整数 startPeriod/endPeriod；周次 weekFrom/weekTo（默认 1-',
    `${context.semesterWeeks}）；单双周 oddEven=all/odd/even。`,
    '- 看不清的格子直接跳过，不要编造课程。',
    '- 【重要】课表里已经有的课不要再加一遍：如果某门课在"已经存在"清单里，且星期与节次对得上，就跳过。',
    '- 最后用一句话说明识别到几门课。',
    '- 如果工具调用不可用，就改用 ```tool_call 代码块输出一行 JSON，例如：',
    '```tool_call',
    '{"name":"add_courses","arguments":{"courses":[{"title":"高等数学","weekday":1,"startPeriod":1,"endPeriod":2,"weekFrom":1,"weekTo":16}]}}',
    '```',
    `- 作息时间表（节次:起-止）：${periodTable(context)}`,
    `- 【现在时间】${formatNowText(context.now ?? new Date(), context.semesterStartDate)}`,
  ].join('\n')
}

export interface CoursePromptOptions {
  text: string
  hasImage: boolean
  context: CoursePromptContext
  drafts: DraftCourse[]
  /** 课表里已经存在的课程（用于避免重复添加） */
  existing?: Course[]
}

export function buildUserPrompt(options: CoursePromptOptions): string {
  const { text, hasImage, context, drafts, existing } = options
  const parts: string[] = []
  if (hasImage) parts.push(compactRules(context))
  const existingBlock = existingListText(existing ?? [], context)
  if (existingBlock) parts.push(existingBlock)
  if (drafts.length > 0) {
    parts.push(`编辑界面里现有的课程（序号从 1 开始）：\n${draftListText(drafts, context)}`)
  }
  const trimmed = text.trim()
  if (trimmed) parts.push(trimmed)
  if (parts.length === 0) parts.push('请看看我给的课程表，把课程加进来。')
  return parts.join('\n\n')
}

/** 组装成引擎要的任务描述。 */
export function buildCourseTask(options: CoursePromptOptions): AiTaskSpec {
  return {
    tools: COURSE_TOOL_LIST,
    systemPrompt: buildSystemPrompt(options.context),
    userPrompt: buildUserPrompt(options),
    fallback: COURSE_FALLBACK,
  }
}
