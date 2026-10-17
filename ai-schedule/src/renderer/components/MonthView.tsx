import type { ReactNode } from 'react'
import type { EventItem } from '../../shared/entities'
import { eventsOnDate, isSameMonth, monthGridDates } from '../../shared/layout'
import { sameDay } from '../../shared/date'
import { WEEKDAY_SHORT } from './weekdayLabels'

export interface MonthViewProps {
  monthAnchor: Date
  events: EventItem[]
  today: Date
  editing: boolean
  onSelectEvent: (id: string) => void
  onOpenEditor: (id: string) => void
  /** 双击空白：在该日新建（默认 09:00） */
  onCreateAt: (date: string) => void
  /** 点「+N 更多」跳日视图 */
  onShowMore: (date: string) => void
  maxPerCell?: number
}

function timeOf(event: EventItem): string {
  if (event.kind === 'todo') return ''
  if (event.kind === 'allDay') return '全天'
  return event.startAt?.slice(11, 16) ?? ''
}

/** 月视图：六行七列，每格最多 3 条，其余折叠成「+N 更多」。 */
export function MonthView({
  monthAnchor,
  events,
  today,
  editing,
  onSelectEvent,
  onOpenEditor,
  onCreateAt,
  onShowMore,
  maxPerCell = 3,
}: MonthViewProps): ReactNode {
  const dates = monthGridDates(monthAnchor)

  return (
    <div className="month-view">
      <div className="month-head">
        {WEEKDAY_SHORT.map((label) => (
          <div key={label} className="month-head__cell">
            {label}
          </div>
        ))}
      </div>
      <div className="month-grid">
        {dates.map((date) => {
          const dayEvents = eventsOnDate(events, date)
          const shown = dayEvents.slice(0, maxPerCell)
          const rest = dayEvents.length - shown.length
          const inMonth = isSameMonth(date, monthAnchor)
          const isToday = sameDay(new Date(`${date}T00:00`), today)
          const dayNumber = Number(date.slice(8, 10))

          return (
            <div
              key={date}
              className={`month-cell${inMonth ? '' : ' is-outside'}${isToday ? ' is-today' : ''}`}
              data-testid={`month-cell-${date}`}
              onDoubleClick={() => onCreateAt(date)}
            >
              <div className="month-cell__date">{dayNumber}</div>
              <div className="month-cell__items">
                {shown.map((event) => (
                  <button
                    key={event.id}
                    type="button"
                    className={`month-item category-${event.category}${event.done ? ' is-done' : ''}`}
                    data-testid={`month-item-${event.id}-${date}`}
                    onClick={(clickEvent) => {
                      clickEvent.stopPropagation()
                      onSelectEvent(event.id)
                    }}
                    onDoubleClick={(doubleEvent) => {
                      doubleEvent.stopPropagation()
                      onOpenEditor(event.id)
                    }}
                    title={`${event.title}｜${timeOf(event)}`}
                  >
                    {timeOf(event) ? `${timeOf(event)} ` : ''}
                    {event.title}
                  </button>
                ))}
                {rest > 0 ? (
                  <button
                    type="button"
                    className="month-cell__more"
                    data-testid={`month-more-${date}`}
                    onClick={(clickEvent) => {
                      clickEvent.stopPropagation()
                      onShowMore(date)
                    }}
                  >
                    +{rest} 更多
                  </button>
                ) : null}
              </div>
              {editing ? <span className="month-cell__edit-dot" aria-hidden="true" /> : null}
            </div>
          )
        })}
      </div>
    </div>
  )
}
