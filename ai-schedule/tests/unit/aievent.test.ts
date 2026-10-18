import { describe, expect, it } from '../helpers/expect'
import { validateEventInput } from '../../src/shared/entities'
import {
  applyEventToolCall,
  createManualEventDraft,
  draftFromEventInput,
  draftFromRaw,
  draftToEventInput,
  draftToEventItem,
  normalizeCategory,
  normalizeDateTimeText,
  normalizeEventKind,
  normalizeEventToolName,
  summarizeEventDraft,
  type EventDraftContext,
} from '../../src/renderer/ai/eventDraft'
import { buildEventSystemPrompt, buildEventTask, EVENT_TOOL_LIST } from '../../src/renderer/ai/eventTools'

const CONTEXT: EventDraftContext = { today: '2026-03-04' }

describe('日程时间解析', () => {
  it('绝对日期与时刻', () => {
    expect(normalizeDateTimeText('2026-03-04 14:00', CONTEXT)).toEqual({ date: '2026-03-04', time: '14:00' })
    expect(normalizeDateTimeText('2026/3/5 上午9点', CONTEXT)).toEqual({ date: '2026-03-05', time: '09:00' })
    expect(normalizeDateTimeText('3月8日', CONTEXT)).toEqual({ date: '2026-03-08', time: null })
  })

  it('相对说法按今天推算', () => {
    expect(normalizeDateTimeText('明天 15:30', CONTEXT).date).toBe('2026-03-05')
    expect(normalizeDateTimeText('今天下午 3 点', CONTEXT).date).toBe('2026-03-04')
    expect(normalizeDateTimeText('后天', CONTEXT).date).toBe('2026-03-06')
  })

  it('不存在的日期不会被编出来', () => {
    expect(normalizeDateTimeText('2月30日', CONTEXT).date).toBeNull()
    expect(normalizeDateTimeText('', CONTEXT)).toEqual({ date: null, time: null })
  })

  it('类别与形态的中英文写法', () => {
    expect(normalizeCategory('课内')).toBe('course')
    expect(normalizeCategory('课外活动')).toBe('activity')
    expect(normalizeCategory('life')).toBe('life')
    expect(normalizeCategory('说不清')).toBeNull()
    expect(normalizeEventKind('全天')).toBe('allDay')
    expect(normalizeEventKind('待办')).toBe('todo')
    expect(normalizeEventKind('timed')).toBe('timed')
    expect(normalizeEventKind('startOnly')).toBe('startOnly')
  })
})

describe('日程草稿生成', () => {
  it('带起止时刻的日程', () => {
    const draft = draftFromRaw(
      { title: '组会', category: 'activity', startAt: '2026-03-05 14:00', endAt: '2026-03-05 15:30', location: '实验楼 302' },
      CONTEXT,
    )!
    expect(draft.kind).toBe('timed')
    expect(draft.startAt).toBe('2026-03-05T14:00')
    expect(draft.endAt).toBe('2026-03-05T15:30')
    expect(draft.location).toBe('实验楼 302')
    expect(draft.needsReview).toBe(false)
  })

  it('只有日期 → 全天；只有截止 → 待办', () => {
    const allDay = draftFromRaw({ title: '回家', kind: '全天', startAt: '2026-03-07' }, CONTEXT)!
    expect(allDay.kind).toBe('allDay')
    expect(allDay.startAt).toBe('2026-03-07')
    expect(allDay.endAt).toBe('2026-03-07')

    const todo = draftFromRaw({ title: '交实验报告', dueAt: '2026-03-06 23:59' }, CONTEXT)!
    expect(todo.kind).toBe('todo')
    expect(todo.dueAt).toBe('2026-03-06T23:59')
    expect(todo.startAt).toBeNull()
  })

  it('有开始没结束 → 只有开始时间', () => {
    const draft = draftFromRaw({ title: '跑步', startAt: '2026-03-05 07:00' }, CONTEXT)!
    expect(draft.kind).toBe('startOnly')
    expect(draft.endAt).toBeNull()
  })

  it('中文键也能读', () => {
    const draft = draftFromRaw({ 标题: '打疫苗', 开始: '2026-03-09 09:00', 地点: '校医院' }, CONTEXT)!
    expect(draft.title).toBe('打疫苗')
    expect(draft.location).toBe('校医院')
  })

  it('缺日期时标记待确认，没有标题当噪声丢掉', () => {
    const vague = draftFromRaw({ title: '有空再说' }, CONTEXT)!
    expect(vague.needsReview).toBe(true)
    expect(draftFromRaw({}, CONTEXT)).toBeNull()
    expect(draftFromRaw({ category: 'life' }, CONTEXT)).toBeNull()
  })

  it('手动加一行是待确认的空草稿', () => {
    const draft = createManualEventDraft(CONTEXT)
    expect(draft.needsReview).toBe(true)
    expect(draft.kind).toBe('timed')
  })

  it('摘要里有人话时间', () => {
    const draft = draftFromRaw({ title: '组会', startAt: '2026-03-05 14:00', endAt: '2026-03-05 15:30' }, CONTEXT)!
    const summary = summarizeEventDraft(draft)
    expect(summary.title).toBe('组会')
    expect(summary.when).toContain('14:00')
  })
})

describe('日程工具调用', () => {
  const twoEvents = {
    events: [
      { title: '组会', startAt: '2026-03-05 14:00', endAt: '2026-03-05 15:30' },
      { title: '组会', startAt: '2026-03-05 14:00', endAt: '2026-03-05 15:30' },
      { title: '交报告', dueAt: '2026-03-06' },
    ],
  }

  it('一次加入多条并去重', () => {
    const result = applyEventToolCall([], 'add_events', twoEvents, CONTEXT)
    expect(result.drafts).toHaveLength(2)
    expect(result.message).toContain('已加入 2')
  })

  it('工具名兼容驼峰', () => {
    expect(normalizeEventToolName('addEvents')).toBe('add_events')
    expect(normalizeEventToolName('deleteEvent')).toBe('remove_event')
    expect(normalizeEventToolName('whatever')).toBeNull()
  })

  it('按序号改、按序号删、清空', () => {
    const added = applyEventToolCall([], 'add_events', twoEvents, CONTEXT)
    const updated = applyEventToolCall(added.drafts, 'update_event', { index: 2, title: '交实验报告' }, CONTEXT)
    expect(updated.drafts[1].title).toBe('交实验报告')

    const removed = applyEventToolCall(updated.drafts, 'remove_event', { index: 1 }, CONTEXT)
    expect(removed.drafts).toHaveLength(1)
    expect(removed.message).toContain('已删除')

    const cleared = applyEventToolCall(removed.drafts, 'clear_events', {}, CONTEXT)
    expect(cleared.drafts).toHaveLength(0)
  })

  it('未知工具不动草稿', () => {
    const added = applyEventToolCall([], 'add_events', twoEvents, CONTEXT)
    const result = applyEventToolCall(added.drafts, 'something_else', {}, CONTEXT)
    expect(result.drafts).toHaveLength(added.drafts.length)
    expect(result.message).toBeNull()
  })
})

describe('日程草稿转入库参数', () => {
  it('能通过日程校验', () => {
    const draft = draftFromRaw({ title: '组会', startAt: '2026-03-05 14:00', endAt: '2026-03-05 15:30' }, CONTEXT)!
    const input = draftToEventInput(draft)
    expect(input.kind).toBe('timed')
    expect(validateEventInput(input)).toEqual([])
  })

  it('待办只提交截止时间', () => {
    const draft = draftFromRaw({ title: '交报告', dueAt: '2026-03-06' }, CONTEXT)!
    const input = draftToEventInput(draft)
    expect(input.dueAt).toBe('2026-03-06')
    expect(input.startAt).toBeNull()
  })

  it('弹窗改完回填不丢字段', () => {
    const input = {
      title: '体检',
      category: 'life' as const,
      kind: 'allDay' as const,
      startAt: '2026-03-10',
      endAt: '2026-03-10',
      dueAt: null,
      location: '校医院',
      people: null,
      note: null,
    }
    const draft = draftFromEventInput(input, 'k1')
    expect(draft.key).toBe('k1')
    expect(draftToEventInput(draft)).toEqual(input)
    expect(draftToEventItem(draft).id).toBe('k1')
  })
})

describe('日程提示词与工具', () => {
  it('工具清单固定', () => {
    const names = EVENT_TOOL_LIST.map((item) => item.name)
    expect(names).toContain('add_events')
    expect(names).toContain('update_event')
    expect(names).toContain('remove_event')
  })

  it('系统提示带今天的日期，并要求绝对日期', () => {
    const prompt = buildEventSystemPrompt(CONTEXT)
    expect(prompt).toContain('2026-03-04')
    expect(prompt).toContain('YYYY-MM-DD')
  })

  it('任务里带上图片规则与现有草稿', () => {
    const draft = draftFromRaw({ title: '组会', startAt: '2026-03-05 14:00' }, CONTEXT)!
    const task = buildEventTask({ text: '再加一条', hasImage: true, context: CONTEXT, drafts: [draft] })
    expect(task.userPrompt).toContain('组会')
    expect(task.userPrompt).toContain('add_events')
    expect(task.fallback).toEqual({ listTool: 'add_events', listKey: 'events' })
  })
})
