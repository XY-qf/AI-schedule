import type { ReactNode } from 'react'
import type { EventItem } from '../../shared/entities'
import {
  layoutAllDay,
  layoutDay,
  spanOfDay,
  weekDates,
  weekdayOfDate,
  type AllDayChip,
} from '../../shared/layout'
import { sameDay, startOfWeekMonday } from '../../shared/date'
import { formatChineseWeekday } from '../../shared/date'
import { EventBlock, HOUR_HEIGHT } from './EventBlock'

export { HOUR_HEIGHT } from './EventBlock'

export interface WeekViewProps {
  weekStart: Date
  events: EventItem[]
  today: Date
  editing: boolean
  onSelectEvent: (id: string) => void
  onOpenEditor: (id: string) => void
  /** 双击空白格子：在该日该小时新建 */
  onCreateAt: (date: string, hour: number) => void
  /** 编辑态拖动日程块：整体平移 */
  onMoveEvent?: (id: string, deltaMinutes: number) => void
  /** 编辑态拉下边缘：改变时长 */
  onResizeEvent?: (id: string, deltaMinutes: number) => void
  /** 右键菜单 */
  onContextMenuEvent?: (id: string, x: number, y: number) => void
}

function chipLabel(chip: AllDayChip): string {
  const { event } = chip
  if (event.kind === 'todo') return `☐ ${event.title}`
  return event.title
}

/** 周视图：左侧 24 小时时间轴 + 七列；顶部为全天条。 */
export function WeekView({
  weekStart,
  events,
  today,
  editing,
  onSelectEvent,
  onOpenEditor,
  onCreateAt,
  onMoveEvent,
  onResizeEvent,
  onContextMenuEvent,
}: WeekViewProps): ReactNode {
  const dates = weekDates(startOfWeekMonday(weekStart))
  const chips = layoutAllDay(events, dates)
  const hours = Array.from({ length: 24 }, (_, index) => index)

  return (
    <div className="week-view">
      <div className="week-allday" data-testid="week-allday">
        <div className="week-allday__label">全天</div>
        <div className="week-allday__grid">
          {dates.map((date) => (
            <div
              key={date}
              className={`week-allday__col${sameDay(new Date(`${date}T00:00`), today) ? ' is-today' : ''}`}
            />
          ))}
        </div>
        <div className="week-allday__chips">
          {chips.map((chip) => (
            <button
              key={chip.event.id}
              type="button"
              className={`allday-chip category-${chip.event.category}${chip.event.done ? ' is-done' : ''}`}
              data-testid={`chip-${chip.event.id}`}
              style={{
                gridColumn: `${chip.startCol + 1} / ${chip.endCol + 2}`,
              }}
              onClick={() => onSelectEvent(chip.event.id)}
              onDoubleClick={() => onOpenEditor(chip.event.id)}
              title={chipLabel(chip)}
            >
              {chip.continuesLeft ? '‹ ' : ''}
              {chipLabel(chip)}
              {chip.continuesRight ? ' ›' : ''}
            </button>
          ))}
        </div>
      </div>

      <div className="week-head">
        <div className="week-head__gutter" />
        <div className="week-head__cols">
          {dates.map((date) => {
            const dateObj = new Date(`${date}T00:00`)
            const isToday = sameDay(dateObj, today)
            return (
              <div
                key={date}
                className={`week-head__cell${isToday ? ' is-today' : ''}`}
                data-testid={`head-${date}`}
              >
                <span className="week-head__weekday">{formatChineseWeekday(dateObj)}</span>
                <span className="week-head__date">
                  {dateObj.getMonth() + 1}/{dateObj.getDate()}
                </span>
              </div>
            )
          })}
        </div>
      </div>

      <div className="week-body">
        <div className="week-axis" aria-hidden="true">
          {hours.map((hour) => (
            <div key={hour} className="week-axis__row" style={{ height: `${HOUR_HEIGHT}px` }}>
              <span className="week-axis__label">{String(hour).padStart(2, '0')}:00</span>
            </div>
          ))}
        </div>

        <div className="week-cols">
          {dates.map((date) => {
            const dayEvents = events.filter((event) => spanOfDay(event, date) !== null)
            const spans = dayEvents.map((event) => {
              const span = spanOfDay(event, date)
              return { id: event.id, startMin: span?.startMin ?? 0, endMin: span?.endMin ?? 0 }
            })
            const placed = new Map(layoutDay(spans).map((block) => [block.id, block]))
            const isToday = sameDay(new Date(`${date}T00:00`), today)

            return (
              <div
                key={date}
                className={`week-col${isToday ? ' is-today' : ''}`}
                data-testid={`col-${date}`}
                data-weekday={weekdayOfDate(date)}
              >
                <div className="week-col__bg">
                  {hours.map((hour) => (
                    <div
                      key={hour}
                      className="week-slot"
                      data-testid={`slot-${date}-${hour}`}
                      style={{ height: `${HOUR_HEIGHT}px` }}
                      onDoubleClick={() => onCreateAt(date, hour)}
                    />
                  ))}
                </div>
                <div className="week-col__blocks">
                  {dayEvents.map((event) => (
                    <EventBlock
                      key={event.id}
                      event={event}
                      placed={placed.get(event.id) ?? { id: event.id, startMin: 0, endMin: 60, column: 0, columnCount: 1 }}
                      editing={editing}
                      onSelect={onSelectEvent}
                      onOpenEditor={onOpenEditor}
                      onMove={onMoveEvent}
                      onResize={onResizeEvent}
                      onContextMenu={onContextMenuEvent}
                    />
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
