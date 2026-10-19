import { describe, expect, it } from '../helpers/expect'
import type { EventItem } from '../../src/shared/entities'
import {
  describeRule,
  expandOccurrences,
  RECURRENCE_SCOPE_HINT,
  RECURRENCE_SCOPE_LABEL,
  type RecRule,
  type SeriesException,
} from '../../src/shared/recurrence'

function master(partial: Partial<EventItem> = {}): EventItem {
  return {
    id: 'series-1',
    title: '篮球训练',
    category: 'activity',
    kind: 'timed',
    startAt: '2026-03-04T19:30',
    endAt: '2026-03-04T21:00',
    dueAt: null,
    location: '体育馆',
    people: null,
    note: null,
    done: false,
    recurrenceId: 'rule-1',
    createdAt: '',
    updatedAt: '',
    ...partial,
  }
}

function rule(partial: Partial<RecRule> = {}): RecRule {
  return {
    id: 'rule-1',
    freq: 'weekly',
    intervalValue: null,
    intervalUnit: null,
    byWeekdays: null,
    untilDate: null,
    maxCount: null,
    ...partial,
  }
}

function dates(list: Array<{ originalDate: string }>): string[] {
  return list.map((item) => item.originalDate)
}

describe('重复规则 · 每天', () => {
  it('区间内每天一次，时间保持不变', () => {
    const list = expandOccurrences(master(), rule({ freq: 'daily' }), [], '2026-03-04', '2026-03-07')
    expect(dates(list)).toEqual(['2026-03-04', '2026-03-05', '2026-03-06', '2026-03-07'])
    expect(list[1].startAt).toBe('2026-03-05T19:30')
    expect(list[1].endAt).toBe('2026-03-05T21:00')
  })

  it('自定义每 3 天', () => {
    const list = expandOccurrences(
      master(),
      rule({ freq: 'custom', intervalUnit: 'day', intervalValue: 3 }),
      [],
      '2026-03-04',
      '2026-03-15',
    )
    expect(dates(list)).toEqual(['2026-03-04', '2026-03-07', '2026-03-10', '2026-03-13'])
  })
})

describe('重复规则 · 每周', () => {
  it('每周一次（默认取开始那天是周三）', () => {
    const list = expandOccurrences(master(), rule({ freq: 'weekly' }), [], '2026-03-01', '2026-03-22')
    expect(dates(list)).toEqual(['2026-03-04', '2026-03-11', '2026-03-18'])
  })

  it('一周多天：周一三五', () => {
    const list = expandOccurrences(
      master({ startAt: '2026-03-02T08:00', endAt: '2026-03-02T09:00' }),
      rule({ freq: 'weekly', byWeekdays: [1, 3, 5] }),
      [],
      '2026-03-02',
      '2026-03-08',
    )
    expect(dates(list)).toEqual(['2026-03-02', '2026-03-04', '2026-03-06'])
  })

  it('从周中间开始的周规则不会倒推到开始日期之前', () => {
    // 开始日是周三，规则只选周一
    const list = expandOccurrences(
      master({ startAt: '2026-03-04T08:00', endAt: '2026-03-04T09:00' }),
      rule({ freq: 'weekly', byWeekdays: [1] }),
      [],
      '2026-03-01',
      '2026-03-16',
    )
    expect(dates(list)).toEqual(['2026-03-09', '2026-03-16'])
  })

  it('每两周交替出现', () => {
    const list = expandOccurrences(master(), rule({ freq: 'biweekly' }), [], '2026-03-01', '2026-04-05')
    expect(dates(list)).toEqual(['2026-03-04', '2026-03-18', '2026-04-01'])
  })

  it('自定义每 3 周', () => {
    const list = expandOccurrences(
      master(),
      rule({ freq: 'custom', intervalUnit: 'week', intervalValue: 3 }),
      [],
      '2026-03-01',
      '2026-04-30',
    )
    expect(dates(list)).toEqual(['2026-03-04', '2026-03-25', '2026-04-15'])
  })
})

describe('重复规则 · 每月与每年', () => {
  it('每月同一天', () => {
    const list = expandOccurrences(
      master({ startAt: '2026-01-15T10:00', endAt: '2026-01-15T11:00' }),
      rule({ freq: 'monthly' }),
      [],
      '2026-01-01',
      '2026-04-30',
    )
    expect(dates(list)).toEqual(['2026-01-15', '2026-02-15', '2026-03-15', '2026-04-15'])
  })

  it('每月 31 号在没有 31 号的月份跳过', () => {
    const list = expandOccurrences(
      master({ startAt: '2026-01-31T10:00', endAt: '2026-01-31T11:00' }),
      rule({ freq: 'monthly' }),
      [],
      '2026-01-01',
      '2026-05-31',
    )
    // 2 月、4 月没有 31 号；3 月、5 月有
    expect(dates(list)).toEqual(['2026-01-31', '2026-03-31', '2026-05-31'])
  })

  it('每年同月同日', () => {
    const list = expandOccurrences(
      master({ startAt: '2026-03-04T20:00', endAt: '2026-03-04T21:00' }),
      rule({ freq: 'yearly' }),
      [],
      '2026-01-01',
      '2028-12-31',
    )
    expect(dates(list)).toEqual(['2026-03-04', '2027-03-04', '2028-03-04'])
  })

  it('2 月 29 日的年度事件只在闰年出现', () => {
    const list = expandOccurrences(
      master({ startAt: '2024-02-29T09:00', endAt: '2024-02-29T10:00' }),
      rule({ freq: 'yearly' }),
      [],
      '2024-01-01',
      '2029-12-31',
    )
    expect(dates(list)).toEqual(['2024-02-29', '2028-02-29'])
  })
})

describe('重复规则 · 结束条件', () => {
  it('到指定日期为止（含当天）', () => {
    const list = expandOccurrences(
      master(),
      rule({ freq: 'weekly', untilDate: '2026-03-18' }),
      [],
      '2026-03-01',
      '2026-05-01',
    )
    expect(dates(list)).toEqual(['2026-03-04', '2026-03-11', '2026-03-18'])
  })

  it('共 N 次', () => {
    const list = expandOccurrences(
      master(),
      rule({ freq: 'weekly', maxCount: 3 }),
      [],
      '2026-03-01',
      '2026-06-01',
    )
    expect(dates(list)).toEqual(['2026-03-04', '2026-03-11', '2026-03-18'])
  })
})

describe('重复规则 · 例外', () => {
  const exceptions: SeriesException[] = [
    {
      id: 'x1',
      seriesId: 'series-1',
      originalDate: '2026-03-11',
      action: 'skipped',
      startAt: null,
      endAt: null,
      title: null,
      location: null,
      people: null,
      note: null,
      done: null,
    },
    {
      id: 'x2',
      seriesId: 'series-1',
      originalDate: '2026-03-18',
      action: 'modified',
      startAt: '2026-03-19T20:00',
      endAt: '2026-03-19T21:30',
      title: '篮球训练（改期）',
      location: null,
      people: null,
      note: null,
      done: null,
    },
  ]

  it('跳过的那次不再出现', () => {
    const list = expandOccurrences(master(), rule({ freq: 'weekly' }), exceptions, '2026-03-01', '2026-03-31')
    expect(dates(list)).not.toContain('2026-03-11')
  })

  it('改期的那次按新时间出现并带上标记', () => {
    const list = expandOccurrences(master(), rule({ freq: 'weekly' }), exceptions, '2026-03-01', '2026-04-30')
    const moved = list.find((item) => item.originalDate === '2026-03-18')
    expect(moved).toBeTruthy()
    expect(moved?.isException).toBe(true)
    expect(moved?.startAt).toBe('2026-03-19T20:00')
    expect(moved?.title).toBe('篮球训练（改期）')
  })

  it('其他日期不受影响', () => {
    const list = expandOccurrences(master(), rule({ freq: 'weekly' }), exceptions, '2026-03-01', '2026-03-31')
    const normal = list.find((item) => item.originalDate === '2026-03-04')
    expect(normal?.isException).toBe(false)
    expect(normal?.startAt).toBe('2026-03-04T19:30')
  })

  it('例外只作用于自己的系列', () => {
    const other = expandOccurrences(
      master({ id: 'series-2' }),
      rule({ freq: 'weekly' }),
      exceptions,
      '2026-03-01',
      '2026-03-31',
    )
    expect(dates(other)).toContain('2026-03-11')
  })
})

describe('重复规则 · 区间与形态', () => {
  it('只返回落在区间内的实例，区间外不泄漏', () => {
    const list = expandOccurrences(master(), rule({ freq: 'daily' }), [], '2026-03-10', '2026-03-11')
    expect(dates(list)).toEqual(['2026-03-10', '2026-03-11'])
  })

  it('跨天母日程保持跨天时长', () => {
    const list = expandOccurrences(
      master({ startAt: '2026-03-04T22:00', endAt: '2026-03-05T02:00' }),
      rule({ freq: 'weekly' }),
      [],
      '2026-03-01',
      '2026-03-20',
    )
    expect(list[0].startAt).toBe('2026-03-04T22:00')
    expect(list[0].endAt).toBe('2026-03-05T02:00')
    expect(list[1].endAt).toBe('2026-03-12T02:00')
  })

  it('全天重复只用日期', () => {
    const list = expandOccurrences(
      master({ kind: 'allDay', startAt: '2026-03-02', endAt: '2026-03-02' }),
      rule({ freq: 'weekly' }),
      [],
      '2026-03-01',
      '2026-03-20',
    )
    expect(list[0].startAt).toBe('2026-03-02')
    expect(list[0].startAt).not.toContain('T')
  })

  it('待办（只有截止）改为按截止日期展开', () => {
    const list = expandOccurrences(
      master({ kind: 'todo', startAt: null, endAt: null, dueAt: '2026-03-04' }),
      rule({ freq: 'daily' }),
      [],
      '2026-03-01',
      '2026-03-31',
    )
    // 母事件从 3 月 4 日开始，到 3 月 31 日共 28 次
    expect(list.length).toBe(28)
    expect(list[0].dueAt).toBe('2026-03-04')
  })

  it('既没有开始也没有截止的条目不展开', () => {
    expect(
      expandOccurrences(
        master({ kind: 'todo', startAt: null, endAt: null, dueAt: null }),
        rule({ freq: 'daily' }),
        [],
        '2026-03-01',
        '2026-03-31',
      ),
    ).toEqual([])
  })
})

describe('重复规则 · 展示文案', () => {
  it('常见规则的中文描述', () => {
    expect(describeRule(rule({ freq: 'daily' }))).toBe('每天')
    expect(describeRule(rule({ freq: 'weekly', byWeekdays: [3] }))).toBe('每周三')
    expect(describeRule(rule({ freq: 'weekly', byWeekdays: [1, 3] }))).toBe('每周一、三')
    expect(describeRule(rule({ freq: 'biweekly' }))).toBe('每两周')
    expect(describeRule(rule({ freq: 'monthly' }))).toBe('每月')
    expect(describeRule(rule({ freq: 'yearly' }))).toBe('每年')
  })

  it('带结束条件与自定义间隔', () => {
    expect(describeRule(rule({ freq: 'weekly', byWeekdays: [3], maxCount: 16 }))).toBe('每周三，共 16 次')
    expect(describeRule(rule({ freq: 'weekly', byWeekdays: [3], untilDate: '2026-06-30' }))).toBe('每周三，至 2026-06-30')
    expect(describeRule(rule({ freq: 'custom', intervalUnit: 'day', intervalValue: 3 }))).toBe('每 3 天')
  })

  it('三选一的范围文案齐全', () => {
    expect(RECURRENCE_SCOPE_LABEL.single).toBe('仅这一次')
    expect(RECURRENCE_SCOPE_LABEL.following).toBe('这一次及以后')
    expect(RECURRENCE_SCOPE_LABEL.all).toBe('全部')
    expect(RECURRENCE_SCOPE_HINT.single).toContain('只改这一天')
    expect(RECURRENCE_SCOPE_HINT.all).toContain('整个系列')
  })
})
