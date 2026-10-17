import type { ReactNode } from 'react'
import type { EventItem } from '../../shared/entities'
import { CATEGORY_LABEL } from '../../shared/domain'
import { eventsOnDate, nextDays, sortByTime } from '../../shared/layout'
import { formatDate, formatRelativeDayLabel, parseDate } from '../../shared/date'
import { EmptyState } from './Feedback'

export interface ListViewProps {
  /** 列表起点（通常是今天） */
  anchor: Date
  events: EventItem[]
  today: Date
  /** 往后多少天 */
  days?: number
  onSelectEvent: (id: string) => void
  onToggleDone?: (id: string) => void
}

function rowTime(event: EventItem): string {
  if (event.kind === 'todo') return ''
  if (event.kind === 'allDay') return '全天'
  if (!event.startAt || !event.endAt) return ''
  return `${event.startAt.slice(11, 16)}–${event.endAt.slice(11, 16)}`
}

/** 列表 / 议程视图：从今天起按天分组的时间顺序清单。 */
export function ListView({
  anchor,
  events,
  today,
  days = 30,
  onSelectEvent,
  onToggleDone,
}: ListViewProps): ReactNode {
  const dates = nextDays(formatDate(anchor), days)
  const groups = dates
    .map((date) => ({ date, items: sortByTime(eventsOnDate(events, date)) }))
    .filter((group) => group.items.length > 0)

  if (groups.length === 0) {
    return (
      <EmptyState
        title="接下来 30 天还没有安排"
        description="双击日历空白处，或点右上角「＋ 新建」开始记录。"
      />
    )
  }

  return (
    <div className="list-view">
      {groups.map((group) => {
        const dateObj = parseDate(group.date)
        return (
          <section key={group.date} className="list-group" data-testid={`list-group-${group.date}`}>
            <h3 className="list-group__title">{formatRelativeDayLabel(dateObj, today)}</h3>
            <div className="list-group__items">
              {group.items.map((event) => (
                <div
                  key={event.id}
                  className={`list-row${event.done ? ' is-done' : ''}`}
                  data-testid={`list-row-${event.id}`}
                >
                  <span className="list-row__time">{rowTime(event)}</span>
                  <button
                    type="button"
                    className="list-row__main"
                    onClick={() => onSelectEvent(event.id)}
                  >
                    <span className={`list-row__dot category-${event.category}`} />
                    <span className="list-row__title">{event.title}</span>
                    <span className="list-row__meta">
                      {CATEGORY_LABEL[event.category]}
                      {event.location ? ` · ${event.location}` : ''}
                    </span>
                  </button>
                  {onToggleDone ? (
                    <input
                      type="checkbox"
                      className="list-row__done"
                      aria-label={`${event.title} 已完成`}
                      checked={event.done}
                      onChange={() => onToggleDone(event.id)}
                    />
                  ) : null}
                </div>
              ))}
            </div>
          </section>
        )
      })}
    </div>
  )
}
