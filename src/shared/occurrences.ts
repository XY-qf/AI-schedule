import type { EventItem } from './entities'
import { expandOccurrences, type Occurrence, type RecRule, type SeriesException } from './recurrence'

/**
 * 把一条重复日程展开成日历上的多个实例。
 * 实例 id 用 `母事件id#原日期`，保证每次出现的标识稳定、可反查是哪一次。
 */
export function occurrenceToEvent(master: EventItem, occurrence: Occurrence): EventItem {
  return {
    ...master,
    id: `${master.id}#${occurrence.originalDate}`,
    title: occurrence.title ?? master.title,
    startAt: occurrence.startAt,
    endAt: occurrence.endAt,
    dueAt: occurrence.dueAt ?? master.dueAt,
    location: occurrence.location,
    people: occurrence.people,
    note: occurrence.note,
    done: occurrence.done ?? master.done,
    updatedAt: master.updatedAt,
    createdAt: master.createdAt,
  }
}

export interface ExpandedEvent extends EventItem {
  /** 展开来源：母事件 id 与该次原本的日期 */
  seriesMasterId: string
  originalDate: string
  isException: boolean
}

export interface ExpandInput {
  events: EventItem[]
  rules: RecRule[]
  exceptions: SeriesException[]
  rangeStart: string
  rangeEnd: string
}

/**
 * 把日程列表里的重复系列就地展开：
 * 非重复的日程原样返回；重复的母事件被替换成区间内的各个实例。
 */
export function expandEvents(input: ExpandInput): ExpandedEvent[] {
  const { events, rules, exceptions, rangeStart, rangeEnd } = input
  const ruleById = new Map(rules.map((rule) => [rule.id, rule]))
  const out: ExpandedEvent[] = []

  for (const event of events) {
    const rule = event.recurrenceId ? ruleById.get(event.recurrenceId) : undefined
    if (!rule) {
      out.push({ ...event, seriesMasterId: '', originalDate: '', isException: false })
      continue
    }
    const occurrences = expandOccurrences(event, rule, exceptions, rangeStart, rangeEnd)
    for (const occurrence of occurrences) {
      out.push({
        ...occurrenceToEvent(event, occurrence),
        seriesMasterId: event.id,
        originalDate: occurrence.originalDate,
        isException: occurrence.isException,
      })
    }
  }

  return out
}

/** 从实例 id 反解出母事件 id 与原日期；不是实例则返回 null。 */
export function parseOccurrenceId(id: string): { masterId: string; originalDate: string } | null {
  const index = id.indexOf('#')
  if (index <= 0) return null
  const masterId = id.slice(0, index)
  const originalDate = id.slice(index + 1)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(originalDate)) return null
  return { masterId, originalDate }
}
