import { describe, expect, it } from '../helpers/expect'
import type { EventItem } from '../../src/shared/entities'
import type { RecRule, SeriesException } from '../../src/shared/recurrence'
import { expandEvents, parseOccurrenceId, occurrenceToEvent } from '../../src/shared/occurrences'

function master(partial: Partial<EventItem> = {}): EventItem {
  return {
    id: 'm1',
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
    recurrenceId: 'r1',
    createdAt: '',
    updatedAt: '',
    ...partial,
  }
}

const RULE: RecRule = {
  id: 'r1',
  freq: 'weekly',
  intervalValue: null,
  intervalUnit: null,
  byWeekdays: null,
  untilDate: null,
  maxCount: null,
}

describe('实例标识', () => {
  it('实例 id 由母事件与日期拼成，可反解', () => {
    const event = occurrenceToEvent(master(), {
      seriesId: 'm1',
      originalDate: '2026-03-11',
      startAt: '2026-03-11T19:30',
      endAt: '2026-03-11T21:00',
      dueAt: null,
      title: null,
      location: null,
      people: null,
      note: null,
      done: null,
      isException: false,
      exceptionId: null,
    })
    expect(event.id).toBe('m1#2026-03-11')
    expect(event.startAt).toBe('2026-03-11T19:30')
    expect(parseOccurrenceId(event.id)).toEqual({ masterId: 'm1', originalDate: '2026-03-11' })
  })

  it('普通 id 反解为 null', () => {
    expect(parseOccurrenceId('e1')).toBeNull()
    expect(parseOccurrenceId('m1#乱七八糟')).toBeNull()
  })
})

describe('把重复系列展开成日历条目', () => {
  it('每周一次在区间内展开成多次', () => {
    const list = expandEvents({
      events: [master()],
      rules: [RULE],
      exceptions: [],
      rangeStart: '2026-03-01',
      rangeEnd: '2026-03-31',
    })
    expect(list.length).toBe(4)
    expect(list[0].id).toBe('m1#2026-03-04')
    expect(list.every((item) => item.seriesMasterId === 'm1')).toBe(true)
    expect(list.every((item) => item.isException === false)).toBe(true)
  })

  it('非重复日程原样返回（不改 id）', () => {
    const plain = master({ id: 'plain', recurrenceId: null })
    const list = expandEvents({
      events: [plain],
      rules: [],
      exceptions: [],
      rangeStart: '2026-03-01',
      rangeEnd: '2026-03-31',
    })
    expect(list.length).toBe(1)
    expect(list[0].id).toBe('plain')
    expect(list[0].seriesMasterId).toBe('')
  })

  it('跳过的例外让那一次消失', () => {
    const exceptions: SeriesException[] = [
      {
        id: 'x1',
        seriesId: 'm1',
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
    ]
    const list = expandEvents({
      events: [master()],
      rules: [RULE],
      exceptions,
      rangeStart: '2026-03-01',
      rangeEnd: '2026-03-31',
    })
    expect(list.map((item) => item.originalDate)).not.toContain('2026-03-11')
    expect(list.length).toBe(3)
  })

  it('改期的例外换成新时间并标记', () => {
    const exceptions: SeriesException[] = [
      {
        id: 'x2',
        seriesId: 'm1',
        originalDate: '2026-03-11',
        action: 'modified',
        startAt: '2026-03-12T20:00',
        endAt: '2026-03-12T21:30',
        title: '篮球训练（改期）',
        location: null,
        people: null,
        note: null,
        done: null,
      },
    ]
    const list = expandEvents({
      events: [master()],
      rules: [RULE],
      exceptions,
      rangeStart: '2026-03-01',
      rangeEnd: '2026-03-31',
    })
    const moved = list.find((item) => item.originalDate === '2026-03-11')
    expect(moved?.isException).toBe(true)
    expect(moved?.startAt).toBe('2026-03-12T20:00')
    expect(moved?.title).toBe('篮球训练（改期）')
  })

  it('规则不存在时退回普通日程，不会凭空消失', () => {
    const list = expandEvents({
      events: [master({ recurrenceId: 'missing' })],
      rules: [],
      exceptions: [],
      rangeStart: '2026-03-01',
      rangeEnd: '2026-03-31',
    })
    expect(list.length).toBe(1)
    expect(list[0].id).toBe('m1')
  })

  it('多条日程混合展开，普通条目不受影响', () => {
    const list = expandEvents({
      events: [master(), master({ id: 'p1', recurrenceId: null, startAt: '2026-03-05T09:00', endAt: '2026-03-05T10:00' })],
      rules: [RULE],
      exceptions: [],
      rangeStart: '2026-03-01',
      rangeEnd: '2026-03-15',
    })
    expect(list.filter((item) => item.seriesMasterId === 'm1').length).toBe(2)
    expect(list.filter((item) => item.id === 'p1').length).toBe(1)
  })
})
