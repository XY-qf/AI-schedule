import { describe, expect, it } from '../helpers/expect'
import { countdownTo, importantCountdowns, targetOf } from '../../src/shared/countdown'
import type { EventItem } from '../../src/shared/entities'

function ev(partial: Partial<EventItem> & { id: string }): EventItem {
  return {
    id: partial.id,
    title: partial.title ?? '事项',
    category: partial.category ?? 'life',
    kind: partial.kind ?? 'timed',
    startAt: partial.startAt ?? null,
    endAt: partial.endAt ?? null,
    dueAt: partial.dueAt ?? null,
    location: null,
    people: null,
    note: null,
    done: partial.done ?? false,
    important: partial.important ?? false,
    recurrenceId: null,
    createdAt: '',
    updatedAt: '',
  }
}

const NOW = new Date(2026, 2, 4, 10, 0)

describe('倒计时的计算', () => {
  it('还有几天', () => {
    const result = countdownTo(new Date(2026, 2, 8, 10, 0), NOW)
    expect(result.expired).toBe(false)
    expect(result.days).toBe(4)
    expect(result.text).toBe('还有 4 天')
  })

  it('还有几天零几小时', () => {
    const result = countdownTo(new Date(2026, 2, 6, 16, 0), NOW)
    expect(result.text).toBe('还有 2 天 6 小时')
  })

  it('不到一天按小时算', () => {
    const result = countdownTo(new Date(2026, 2, 4, 15, 30), NOW)
    expect(result.days).toBe(0)
    expect(result.text).toBe('还有 5 小时 30 分')
  })

  it('不到一小时按分钟算', () => {
    const result = countdownTo(new Date(2026, 2, 4, 10, 25), NOW)
    expect(result.text).toBe('还有 25 分钟')
  })

  it('已经过期会显示过了几天', () => {
    const result = countdownTo(new Date(2026, 2, 1, 10, 0), NOW)
    expect(result.expired).toBe(true)
    expect(result.text).toBe('已过 3 天')
  })

  it('当天已过期显示“已过期”', () => {
    const result = countdownTo(new Date(2026, 2, 4, 9, 0), NOW)
    expect(result.expired).toBe(true)
    expect(result.text).toBe('已过期')
  })
})

describe('关键时刻的取法', () => {
  it('时间段取开始时间', () => {
    const target = targetOf(ev({ id: 'a', startAt: '2026-03-06T09:00', endAt: '2026-03-06T10:00' }))
    expect(target?.getTime()).toBe(new Date(2026, 2, 6, 9, 0).getTime())
  })

  it('待办取截止时间', () => {
    const target = targetOf(ev({ id: 'b', kind: 'todo', dueAt: '2026-03-09T23:59' }))
    expect(target?.getTime()).toBe(new Date(2026, 2, 9, 23, 59).getTime())
  })

  it('全天取当天零点', () => {
    const target = targetOf(ev({ id: 'c', kind: 'allDay', startAt: '2026-03-10', endAt: '2026-03-10' }))
    expect(target?.getTime()).toBe(new Date(2026, 2, 10, 0, 0).getTime())
  })

  it('没有时间返回 null', () => {
    expect(targetOf(ev({ id: 'd', kind: 'todo', dueAt: null }))).toBeNull()
  })
})

describe('重要事项倒计时列表', () => {
  const events = [
    ev({ id: 'far', title: '期末考试', important: true, startAt: '2026-03-20T09:00', endAt: '2026-03-20T11:00' }),
    ev({ id: 'near', title: '交论文', kind: 'todo', important: true, dueAt: '2026-03-05T23:59' }),
    ev({ id: 'plain', title: '普通', startAt: '2026-03-05T09:00', endAt: '2026-03-05T10:00' }),
    ev({ id: 'done', title: '已完成', important: true, done: true, startAt: '2026-03-05T09:00', endAt: '2026-03-05T10:00' }),
    ev({ id: 'past', title: '过期了', important: true, startAt: '2026-03-01T09:00', endAt: '2026-03-01T10:00' }),
  ]

  it('只保留重要且未完成的，按远近排序', () => {
    const list = importantCountdowns(events, NOW, 10)
    expect(list.map((item) => item.event.id)).toEqual(['near', 'far', 'past'])
  })

  it('默认只给最近 3 条', () => {
    const many = Array.from({ length: 6 }, (_, index) =>
      ev({ id: `i${index}`, title: `事项${index}`, important: true, startAt: `2026-03-${String(10 + index).padStart(2, '0')}T09:00`, endAt: `2026-03-${String(10 + index).padStart(2, '0')}T10:00` }),
    )
    expect(importantCountdowns(many, NOW).length).toBe(3)
  })

  it('带日期文案', () => {
    const list = importantCountdowns(events, NOW, 10)
    expect(list[0].whenText).toBe('3月5日 23:59')
  })

  it('没有重要事项时是空数组', () => {
    expect(importantCountdowns([ev({ id: 'x', startAt: '2026-03-05T09:00', endAt: '2026-03-05T10:00' })], NOW)).toEqual([])
  })
})
