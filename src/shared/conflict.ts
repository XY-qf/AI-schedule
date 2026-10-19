import type { EventItem } from './entities'
import { spanOfDay, spansOverlap, type Span } from './layout'

export interface ConflictInfo {
  /** 冲突的已有日程 */
  other: EventItem
  /** 重叠的分钟数 */
  overlapMinutes: number
}

/**
 * 冲突检测（PRD 9.6）：
 * - 只比对“时间段”类型，全天与待办不参与；
 * - 首尾相接不算冲突；
 * - 只比对同一天的日程。
 */
export function findConflicts(
  candidate: { startAt: string | null; endAt: string | null; kind: string; id?: string },
  sameDayEvents: EventItem[],
): ConflictInfo[] {
  if (candidate.kind !== 'timed' || !candidate.startAt || !candidate.endAt) return []
  const date = candidate.startAt.slice(0, 10)

  const fake: EventItem = {
    id: candidate.id ?? '__candidate__',
    title: '',
    category: 'life',
    kind: 'timed',
    startAt: candidate.startAt,
    endAt: candidate.endAt,
    dueAt: null,
    location: null,
    people: null,
    note: null,
    done: false,
    recurrenceId: null,
    createdAt: '',
    updatedAt: '',
  }
  const span = spanOfDay(fake, date)
  if (!span) return []

  const conflicts: ConflictInfo[] = []
  for (const event of sameDayEvents) {
    if (candidate.id && event.id === candidate.id) continue
    const otherSpan: Span | null = spanOfDay(event, date)
    if (!otherSpan) continue
    if (!spansOverlap(span, otherSpan)) continue
    const overlap = Math.min(span.endMin, otherSpan.endMin) - Math.max(span.startMin, otherSpan.startMin)
    if (overlap <= 0) continue
    conflicts.push({ other: event, overlapMinutes: overlap })
  }
  return conflicts.sort((a, b) => b.overlapMinutes - a.overlapMinutes)
}

/** 冲突提示的中文文案（PRD 附录 B）。 */
export function conflictMessage(conflicts: ConflictInfo[]): string | null {
  if (conflicts.length === 0) return null
  const first = conflicts[0].other
  const time = first.startAt && first.endAt ? `${first.startAt.slice(11, 16)}–${first.endAt.slice(11, 16)}` : ''
  const more = conflicts.length > 1 ? `，另有 ${conflicts.length - 1} 项重叠` : ''
  return `与「${first.title} ${time}」时间重叠${more}，可仍然保存`
}
