import { describe, expect, it } from '../helpers/expect'
import type { Period } from '../../src/shared/entities'
import { validateCourseInput } from '../../src/shared/entities'
import {
  applyDraftToolCall,
  createManualDraft,
  draftFromCourseInput,
  draftFromRaw,
  draftToCourseInput,
  extractCourseList,
  normalizeClock,
  normalizeOddEven,
  normalizePeriodRange,
  normalizeToolName,
  normalizeWeekday,
  normalizeWeeks,
  summarizeDraft,
  type DraftContext,
} from '../../src/renderer/ai/draft'
import {
  DEFAULT_BASE_URL,
  DEFAULT_MODEL,
  AI_PREFERENCE_KEYS,
  isLikelyApiKey,
  maskApiKey,
  normalizeBaseUrl,
  resolveAiConfig,
} from '../../src/renderer/ai/config'
import { buildSystemPrompt, buildUserPrompt, COURSE_FALLBACK, COURSE_TOOL_LIST } from '../../src/renderer/ai/tools'
import { cleanAssistantText, extractFallbackToolCalls } from '../../src/renderer/ai/fallback'

const PERIODS: Period[] = [
  { id: 'p1', name: '第 1 节', startTime: '08:00', endTime: '08:45', orderIndex: 1 },
  { id: 'p2', name: '第 2 节', startTime: '08:55', endTime: '09:40', orderIndex: 2 },
  { id: 'p3', name: '第 3 节', startTime: '10:00', endTime: '10:45', orderIndex: 3 },
  { id: 'p4', name: '第 4 节', startTime: '10:55', endTime: '11:40', orderIndex: 4 },
]

const CONTEXT: DraftContext = { semesterWeeks: 18, periods: PERIODS }

describe('AI 课程字段归一化', () => {
  it('星期能认数字、中文、英文', () => {
    expect(normalizeWeekday(3)).toBe(3)
    expect(normalizeWeekday('3')).toBe(3)
    expect(normalizeWeekday('周一')).toBe(1)
    expect(normalizeWeekday('星期一')).toBe(1)
    expect(normalizeWeekday('礼拜三')).toBe(3)
    expect(normalizeWeekday('周日')).toBe(7)
    expect(normalizeWeekday('星期天')).toBe(7)
    expect(normalizeWeekday('Wed')).toBe(3)
    expect(normalizeWeekday('monday')).toBe(1)
    expect(normalizeWeekday(9)).toBeNull()
    expect(normalizeWeekday('看心情')).toBeNull()
  })

  it('节次范围能认范围与单值', () => {
    expect(normalizePeriodRange('第1-2节', undefined, 4)).toEqual({ start: 1, end: 2 })
    expect(normalizePeriodRange('3', undefined, 12)).toEqual({ start: 3, end: 3 })
    expect(normalizePeriodRange('1~4', undefined, 12)).toEqual({ start: 1, end: 4 })
    expect(normalizePeriodRange(2, 3, 12)).toEqual({ start: 2, end: 3 })
    expect(normalizePeriodRange('一至二节', undefined, 12)).toEqual({ start: 1, end: 2 })
    expect(normalizePeriodRange('下午', undefined, 12)).toBeNull()
  })

  it('周次能认范围、全学期与缺省', () => {
    expect(normalizeWeeks('1-16周', undefined, 18)).toEqual({ from: 1, to: 16 })
    expect(normalizeWeeks('全学期', undefined, 18)).toEqual({ from: 1, to: 18 })
    expect(normalizeWeeks(undefined, undefined, 20)).toEqual({ from: 1, to: 20 })
    expect(normalizeWeeks(5, undefined, 18)).toEqual({ from: 5, to: 5 })
    // 超出学期总周数要收回来
    expect(normalizeWeeks('1-30', undefined, 18)).toEqual({ from: 1, to: 18 })
  })

  it('单双周与时间', () => {
    expect(normalizeOddEven('单周')).toBe('odd')
    expect(normalizeOddEven('双')).toBe('even')
    expect(normalizeOddEven('每周')).toBe('all')
    expect(normalizeOddEven('不清楚')).toBeNull()
    expect(normalizeClock('8:00')).toBe('08:00')
    expect(normalizeClock('14：05')).toBe('14:05')
    expect(normalizeClock('8点30分')).toBe('08:30')
    expect(normalizeClock('晚点再说')).toBeNull()
  })
})

describe('草稿生成', () => {
  it('中文键的课程对象也能读出来', () => {
    const draft = draftFromRaw(
      { 课程名: '高等数学', 星期: '周一', 节次: '1-2', 周次: '1-16', 老师: '王老师', 地点: 'A101' },
      CONTEXT,
    )
    expect(draft).not.toBeNull()
    expect(draft!.title).toBe('高等数学')
    expect(draft!.weekday).toBe(1)
    expect(draft!.startPeriod).toBe(1)
    expect(draft!.endPeriod).toBe(2)
    expect(draft!.weekFrom).toBe(1)
    expect(draft!.weekTo).toBe(16)
    expect(draft!.teacher).toBe('王老师')
    expect(draft!.location).toBe('A101')
    expect(draft!.needsReview).toBe(false)
  })

  it('按具体时间上课的课用 clock 模式', () => {
    const draft = draftFromRaw({ title: '体育', weekday: 2, time: '14:00-15:40' }, CONTEXT)
    expect(draft!.timeMode).toBe('clock')
    expect(draft!.startTime).toBe('14:00')
    expect(draft!.endTime).toBe('15:40')
  })

  it('信息不全时标记待确认而不是直接报错', () => {
    const draft = draftFromRaw({ title: '大学英语' }, CONTEXT)
    expect(draft!.needsReview).toBe(true)
    expect(draft!.weekday).toBe(1)
    expect(draft!.weekFrom).toBe(1)
    expect(draft!.weekTo).toBe(18)
  })

  it('没有课名的条目当噪声丢掉', () => {
    expect(draftFromRaw({}, CONTEXT)).toBeNull()
    expect(draftFromRaw({ weekday: 2 }, CONTEXT)).toBeNull()
    expect(draftFromRaw(null, CONTEXT)).toBeNull()
  })

  it('手动加一行得到空课名的待确认草稿', () => {
    const draft = createManualDraft(CONTEXT, { title: '' })
    expect(draft.title).toBe('')
    expect(draft.needsReview).toBe(true)
  })

  it('列表摘要包含星期、课名、时间与周次', () => {
    const draft = draftFromRaw({ title: '高数', weekday: 1, startPeriod: 1, endPeriod: 2 }, CONTEXT)!
    const summary = summarizeDraft(draft, PERIODS)
    expect(summary.title).toContain('周一')
    expect(summary.title).toContain('高数')
    expect(summary.time).toContain('第 1-2 节')
    expect(summary.weeks).toContain('周')
  })
})

describe('工具调用修改草稿列表', () => {
  const twoCourses = {
    courses: [
      { title: '高等数学', weekday: 1, startPeriod: 1, endPeriod: 2, weekFrom: 1, weekTo: 16 },
      { title: '高等数学', weekday: 1, startPeriod: 1, endPeriod: 2, weekFrom: 1, weekTo: 16 },
      { title: '大学英语', weekday: 3, startPeriod: 3, endPeriod: 4 },
    ],
  }

  it('add_courses 一次加入多门，并且跳过完全重复的', () => {
    const result = applyDraftToolCall([], 'add_courses', twoCourses, CONTEXT)
    expect(result.drafts).toHaveLength(2)
    expect(result.drafts[0].title).toBe('高等数学')
    expect(result.drafts[1].title).toBe('大学英语')
    expect(result.message).toContain('已加入 2')
  })

  it('驼峰工具名与 add_course 单门也能识别', () => {
    expect(normalizeToolName('addCourses')).toBe('add_courses')
    expect(normalizeToolName('add_course')).toBe('add_course')
    expect(normalizeToolName('deleteCourse')).toBe('remove_course')
    expect(normalizeToolName('莫名其妙')).toBeNull()

    const single = applyDraftToolCall([], 'addCourse', { title: '线性代数', weekday: 4 }, CONTEXT)
    expect(single.drafts).toHaveLength(1)
    expect(single.drafts[0].title).toBe('线性代数')
  })

  it('update_course 按序号只改给出的字段', () => {
    const added = applyDraftToolCall([], 'add_courses', twoCourses, CONTEXT)
    const updated = applyDraftToolCall(added.drafts, 'update_course', { index: 2, location: 'B202' }, CONTEXT)
    expect(updated.drafts[1].location).toBe('B202')
    expect(updated.drafts[1].title).toBe('大学英语')
    expect(updated.drafts[1].startPeriod).toBe(3)
    expect(updated.drafts[0].location).toBe('')
    expect(updated.message).toContain('已修改')
  })

  it('update_course 可以按课名定位', () => {
    const added = applyDraftToolCall([], 'add_courses', twoCourses, CONTEXT)
    const updated = applyDraftToolCall(added.drafts, 'update_course', { title: '大学英语', weekday: 5 }, CONTEXT)
    expect(updated.drafts[1].weekday).toBe(5)
  })

  it('remove_course 与 clear_courses', () => {
    const added = applyDraftToolCall([], 'add_courses', twoCourses, CONTEXT)
    const removed = applyDraftToolCall(added.drafts, 'remove_course', { index: 1 }, CONTEXT)
    expect(removed.drafts).toHaveLength(1)
    expect(removed.drafts[0].title).toBe('大学英语')
    expect(removed.message).toContain('已删除')

    const cleared = applyDraftToolCall(removed.drafts, 'clear_courses', {}, CONTEXT)
    expect(cleared.drafts).toHaveLength(0)
  })

  it('未知工具名不动草稿', () => {
    const added = applyDraftToolCall([], 'add_courses', twoCourses, CONTEXT)
    const result = applyDraftToolCall(added.drafts, 'do_something', {}, CONTEXT)
    expect(result.drafts).toHaveLength(2)
    expect(result.message).toBeNull()
  })

  it('取出课程数组的几种写法', () => {
    expect(extractCourseList([{ title: 'a' }])).toHaveLength(1)
    expect(extractCourseList({ items: [{ title: 'a' }] })).toHaveLength(1)
    expect(extractCourseList({ list: [{ title: 'a' }] })).toHaveLength(1)
    expect(extractCourseList({ title: 'a' })).toHaveLength(1)
    expect(extractCourseList({ foo: 1 })).toHaveLength(0)
  })
})

describe('草稿转成课程入库参数', () => {
  it('能通过课程校验', () => {
    const draft = draftFromRaw(
      { title: '高等数学', weekday: 1, startPeriod: 1, endPeriod: 2, weekFrom: 1, weekTo: 16 },
      CONTEXT,
    )!
    const input = draftToCourseInput(draft, 'sem-1')
    expect(input.semesterId).toBe('sem-1')
    expect(validateCourseInput(input)).toEqual([])
  })

  it('弹窗改完回填不会丢字段', () => {
    const input = {
      semesterId: 'sem-1',
      title: '大学物理',
      teacher: '李老师',
      location: 'C303',
      weekday: 5,
      timeMode: 'period' as const,
      startPeriod: 5,
      endPeriod: 6,
      startTime: null,
      endTime: null,
      weekFrom: 3,
      weekTo: 18,
      oddEven: 'even' as const,
    }
    const draft = draftFromCourseInput(input, 'k1')
    expect(draft.key).toBe('k1')
    expect(draft.needsReview).toBe(false)
    expect(draftToCourseInput(draft, 'sem-1')).toEqual(input)
  })
})

describe('AI 运行配置', () => {
  it('默认走 DeepSeek 官方接口，并开着深度思考', () => {
    const config = resolveAiConfig({})
    expect(config.enabled).toBe(true)
    expect(config.model).toBe(DEFAULT_MODEL)
    expect(config.model).toBe('deepseek-chat')
    expect(config.baseUrl).toBe(DEFAULT_BASE_URL)
    expect(config.apiKey).toBe('')
    expect(config.temperature).toBe(0.2)
    expect(config.thinking).toBe(true)
    expect(resolveAiConfig({ [AI_PREFERENCE_KEYS.thinking]: '0' }).thinking).toBe(false)
  })

  it('温度被夹紧，非法值退回默认', () => {
    expect(resolveAiConfig({ [AI_PREFERENCE_KEYS.temperature]: '9' }).temperature).toBe(1)
    expect(resolveAiConfig({ [AI_PREFERENCE_KEYS.temperature]: '-3' }).temperature).toBe(0)
    expect(resolveAiConfig({ [AI_PREFERENCE_KEYS.temperature]: 'abc' }).temperature).toBe(0.2)
    expect(resolveAiConfig({ [AI_PREFERENCE_KEYS.enabled]: '0' }).enabled).toBe(false)
  })

  it('接口地址补协议头、去尾部斜杠，空串回退默认', () => {
    expect(normalizeBaseUrl('api.siliconflow.cn/v1/')).toBe('https://api.siliconflow.cn/v1')
    expect(normalizeBaseUrl('')).toBe(DEFAULT_BASE_URL)
    expect(normalizeBaseUrl('  https://a.b// ')).toBe('https://a.b')
  })

  it('模型名与 Key 会去掉首尾空格', () => {
    const config = resolveAiConfig({
      [AI_PREFERENCE_KEYS.model]: '  Qwen/Qwen3-8B  ',
      [AI_PREFERENCE_KEYS.apiKey]: '  sk-abcdefghijkl  ',
    })
    expect(config.model).toBe('Qwen/Qwen3-8B')
    expect(config.apiKey).toBe('sk-abcdefghijkl')
  })

  it('Key 打码只露出首尾', () => {
    expect(maskApiKey('')).toBe('未填写')
    expect(maskApiKey('sk-1234567890abcd')).toBe('sk-1****abcd')
    expect(isLikelyApiKey('sk-123')).toBe(false)
    expect(isLikelyApiKey('sk-1234567890')).toBe(true)
  })
})

describe('提示词与兜底解析', () => {
  it('图片请求把规则塞进用户消息（多模态路径会丢掉 system）', () => {
    const prompt = buildUserPrompt({ text: '', hasImage: true, context: CONTEXT, drafts: [] })
    expect(prompt).toContain('add_courses')
    expect(prompt).toContain('作息时间表')
  })

  it('系统提示包含作息表与总周数', () => {
    const prompt = buildSystemPrompt(CONTEXT)
    expect(prompt).toContain('18')
    expect(prompt).toContain('08:00-08:45')
  })

  it('兜底解析：围栏里的工具调用', () => {
    const text = '好的：\n```json\n{"name":"add_courses","arguments":{"courses":[{"title":"高数","weekday":1}]}}\n```'
    const calls = extractFallbackToolCalls(text, COURSE_FALLBACK)
    expect(calls).toHaveLength(1)
    expect(calls[0].name).toBe('add_courses')
  })

  it('兜底解析：直接吐课程数组', () => {
    const text = '[{"title":"高数","weekday":1},{"title":"英语","weekday":3}]'
    const calls = extractFallbackToolCalls(text, COURSE_FALLBACK)
    expect(calls).toHaveLength(1)
    expect(calls[0].name).toBe('add_courses')
    expect(extractCourseList(calls[0].input)).toHaveLength(2)
  })

  it('兜底解析：没有 JSON 就没有调用', () => {
    expect(extractFallbackToolCalls('我看看这张图，稍等', COURSE_FALLBACK)).toHaveLength(0)
  })

  it('课程工具名固定（引擎按名字派发）', () => {
    const names = COURSE_TOOL_LIST.map((item) => item.name)
    expect(names).toContain('add_courses')
    expect(names).toContain('update_course')
    expect(names).toContain('remove_course')
    expect(COURSE_FALLBACK).toEqual({ listTool: 'add_courses', listKey: 'courses' })
  })

  it('展示前清掉残留的围栏', () => {
    const cleaned = cleanAssistantText('已识别 3 门课\n```json\n{"a":1}\n```')
    expect(cleaned).toContain('已识别 3 门课')
    expect(cleaned).not.toContain('```')
  })
})
