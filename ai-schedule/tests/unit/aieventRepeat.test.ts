import { describe, expect, it } from '../helpers/expect'
import {
  applyEventToolCall,
  createManualEventDraft,
  describeRepeat,
  draftValidateProblems,
  normalizeRepeat,
  normalizeWeekdayList,
  summarizeEventDraft,
} from '../../src/renderer/ai/eventDraft'
import type { EventDraftContext } from '../../src/renderer/ai/eventDraft'
import type { DraftEvent } from '../../src/renderer/ai/types'

const CONTEXT: EventDraftContext = { today: '2026-10-18', now: new Date('2026-10-18T14:32:00') }

function draft(overrides: Partial<DraftEvent> = {}): DraftEvent {
  return { ...createManualEventDraft(CONTEXT, { title: '组会' }), ...overrides }
}

describe('日程重复规则', () => {
  it('星期列表能认中文、数字与区间', () => {
    expect(normalizeWeekdayList([1, 3, 5])).toEqual([1, 3, 5])
    expect(normalizeWeekdayList('周一、三、五')).toEqual([1, 3, 5])
    expect(normalizeWeekdayList('周一到周五')).toEqual([1, 2, 3, 4, 5])
    expect(normalizeWeekdayList('1,3')).toEqual([1, 3])
    expect(normalizeWeekdayList('')).toBeNull()
  })

  it('对象写法的 repeat 能读出来', () => {
    const repeat = normalizeRepeat({
      freq: 'weekly',
      byWeekdays: [1, 3],
      untilDate: '2026-12-31',
      maxCount: 10,
    })
    expect(repeat).toEqual({
      freq: 'weekly',
      intervalValue: null,
      intervalUnit: null,
      byWeekdays: [1, 3],
      untilDate: '2026-12-31',
      maxCount: 10,
    })
  })

  it('只给 byWeekdays 时按每周处理', () => {
    expect(normalizeRepeat({ byWeekdays: [2, 4] })?.freq).toBe('weekly')
  })

  it('自定义间隔：每 10 天 / 每 3 周', () => {
    const tenDays = normalizeRepeat({ freq: 'custom', intervalValue: 10, intervalUnit: 'day' })
    expect(tenDays?.freq).toBe('custom')
    expect(tenDays?.intervalValue).toBe(10)
    expect(tenDays?.intervalUnit).toBe('day')
    const threeWeeks = normalizeRepeat({ freq: 'custom', intervalValue: '3', intervalUnit: 'week' })
    expect(threeWeeks?.intervalValue).toBe(3)
    expect(threeWeeks?.intervalUnit).toBe('week')
  })

  it('字符串写法的 repeat 也能兜底解析', () => {
    expect(normalizeRepeat('每周一三五')?.byWeekdays).toEqual([1, 3, 5])
    expect(normalizeRepeat('每周一三五')?.freq).toBe('weekly')
    expect(normalizeRepeat('每两周')?.freq).toBe('biweekly')
    expect(normalizeRepeat('每天')?.freq).toBe('daily')
    expect(normalizeRepeat('每月')?.freq).toBe('monthly')
    // 只有次数、没有周期，不算重复
    expect(normalizeRepeat('一共 8 次')).toBeNull()
    const weeklyEight = normalizeRepeat('每周一次，一共 8 次')
    expect(weeklyEight?.freq).toBe('weekly')
    expect(weeklyEight?.maxCount).toBe(8)
  })

  it('没有周期含义时返回 null', () => {
    expect(normalizeRepeat(null)).toBeNull()
    expect(normalizeRepeat(undefined)).toBeNull()
    expect(normalizeRepeat({})).toBeNull()
    expect(normalizeRepeat('明天下午三点开会')).toBeNull()
  })

  it('描述文字：每周一、三 · 到某天 · 共 N 次', () => {
    expect(
      describeRepeat({
        freq: 'weekly',
        intervalValue: null,
        intervalUnit: null,
        byWeekdays: [1, 3],
        untilDate: '2026-12-31',
        maxCount: 10,
      }),
    ).toBe('每周 · 周一、周三 · 到 2026-12-31 · 共 10 次')
    expect(describeRepeat(null)).toBe('')
  })

  it('工具调用里带 repeat 会落到草稿上', () => {
    const result = applyEventToolCall(
      [],
      'add_events',
      {
        events: [
          {
            title: '组会',
            kind: 'timed',
            startAt: '2026-10-19 14:00',
            endAt: '2026-10-19 15:00',
            repeat: { freq: 'weekly', byWeekdays: [1], untilDate: '2026-12-31' },
          },
        ],
      },
      CONTEXT,
    )
    expect(result.drafts).toHaveLength(1)
    expect(result.drafts[0].repeat?.freq).toBe('weekly')
    expect(result.drafts[0].repeat?.byWeekdays).toEqual([1])
    expect(summarizeEventDraft(result.drafts[0]).repeat).toContain('周一')
  })

  it('update_event 不给 repeat 时保留原规则，给 null 时清掉', () => {
    const original = draft({ repeat: { freq: 'weekly', intervalValue: null, intervalUnit: null, byWeekdays: [1], untilDate: null, maxCount: null } })
    const keep = applyEventToolCall([original], 'update_event', { index: 1, title: '组会（改）' }, CONTEXT)
    expect(keep.drafts[0].repeat?.freq).toBe('weekly')

    const cleared = applyEventToolCall([original], 'update_event', { index: 1, repeat: null }, CONTEXT)
    expect(cleared.drafts[0].repeat).toBeNull()
  })

  it('规则有问题时进不了库', () => {
    const bad = draft({ repeat: { freq: 'weekly', intervalValue: null, intervalUnit: null, byWeekdays: [9], untilDate: '2026-13-45', maxCount: 0 } })
    const problems = draftValidateProblems(bad)
    expect(problems.length).toBeGreaterThan(0)
    expect(problems.join('；')).toContain('星期')
  })
})
