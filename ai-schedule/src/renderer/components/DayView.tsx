import type { ReactNode } from 'react'
import type { EventItem } from '../../shared/entities'
import {
  eventsOnDate,
  freeSlots,
  layoutDay,
  spanOfDay,
  totalFreeMinutes,
} from '../../shared/layout'
import { formatChineseDate, parseDate, sameDay } from '../../shared/date'
import { timeFromMinutes } from '../../shared/date'
import { EventBlock, HOUR_HEIGHT } from './EventBlock'

export interface DayViewProps {
  date: Date
  events: EventItem[]
  today: Date
  editing: boolean
  /** 当前分钟数，用于画“现在”红线；由外层传入便于测试 */
  nowMinute: number
  onSelectEvent: (id: string) => void
  onOpenEditor: (id: string) => void
  onCreateAt: (date: string, hour: number) => void
  onMoveEvent?: (id: string, deltaMinutes: number) => void
  onResizeEvent?: (id: string, deltaMinutes: number) => void
  onContextMenuEvent?: (id: string, x: number, y: number) => void
}

function isoDate(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

/** 日视图：单日时间轴 + 当天面板（待办与空闲时段）。 */
export function DayView({
  date,
  events,
  today,
  editing,
  nowMinute,
  onSelectEvent,
  onOpenEditor,
  onCreateAt,
  onMoveEvent,
  onResizeEvent,
  onContextMenuEvent,
}: DayViewProps): ReactNode {
  const dateStr = isoDate(date)
  const isToday = sameDay(date, today)
  const dayEvents = eventsOnDate(events, dateStr)
  const timed = dayEvents.filter((event) => spanOfDay(event, dateStr) !== null)
  const todos = dayEvents.filter((event) => event.kind === 'todo')

  const spans = timed.map((event) => {
    const span = spanOfDay(event, dateStr)
    return { id: event.id, startMin: span?.startMin ?? 0, endMin: span?.endMin ?? 0 }
  })
  const placed = new Map(layoutDay(spans).map((block) => [block.id, block]))
  const gaps = freeSlots(spans.map(({ startMin, endMin }) => ({ startMin, endMin })))
  const hours = Array.from({ length: 24 }, (_, index) => index)

  return (
    <div className="day-view">
      <div className="day-view__main">
        <div className="day-view__head">
          <span className="day-view__date">{formatChineseDate(date, true)}</span>
          {isToday ? <span className="day-view__badge">今天</span> : null}
        </div>

        <div className="day-view__body">
          <div className="day-view__axis" aria-hidden="true">
            {hours.map((hour) => (
              <div key={hour} className="week-axis__row" style={{ height: `${HOUR_HEIGHT}px` }}>
                <span className="week-axis__label">{String(hour).padStart(2, '0')}:00</span>
              </div>
            ))}
          </div>

          <div className="day-view__col" data-testid="day-column">
            <div className="week-col__bg">
              {hours.map((hour) => (
                <div
                  key={hour}
                  className="week-slot"
                  data-testid={`day-slot-${hour}`}
                  style={{ height: `${HOUR_HEIGHT}px` }}
                  onDoubleClick={() => onCreateAt(dateStr, hour)}
                />
              ))}
            </div>
            <div className="week-col__blocks">
              {timed.map((event) => (
                <EventBlock
                  key={event.id}
                  event={event}
                  placed={
                    placed.get(event.id) ?? { id: event.id, startMin: 0, endMin: 60, column: 0, columnCount: 1 }
                  }
                  editing={editing}
                  onSelect={onSelectEvent}
                  onOpenEditor={onOpenEditor}
                  onMove={onMoveEvent}
                  onResize={onResizeEvent}
                  onContextMenu={onContextMenuEvent}
                />
              ))}
            </div>
            {isToday ? (
              <div
                className="day-view__now"
                data-testid="now-line"
                style={{ top: `${(nowMinute / 60) * HOUR_HEIGHT}px` }}
              />
            ) : null}
          </div>
        </div>
      </div>

      <aside className="day-panel" aria-label="当天面板">
        <section className="day-panel__block">
          <h3 className="day-panel__title">当天待办</h3>
          {todos.length === 0 ? (
            <p className="day-panel__empty">没有待办</p>
          ) : (
            <ul className="day-panel__list">
              {todos.map((todo) => (
                <li key={todo.id} data-testid={`day-todo-${todo.id}`}>
                  {todo.title}
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="day-panel__block">
          <h3 className="day-panel__title">空闲时段</h3>
          {gaps.length === 0 ? (
            <p className="day-panel__empty">当天已排满</p>
          ) : (
            <ul className="day-panel__list" data-testid="free-slots">
              {gaps.map((gap) => (
                <li key={`${gap.startMin}-${gap.endMin}`}>
                  {timeFromMinutes(gap.startMin)}–{timeFromMinutes(gap.endMin)} 空闲{' '}
                  {Math.floor((gap.endMin - gap.startMin) / 60) > 0
                    ? `${Math.floor((gap.endMin - gap.startMin) / 60)} 小时`
                    : ''}
                  {(gap.endMin - gap.startMin) % 60 > 0
                    ? `${(gap.endMin - gap.startMin) % 60} 分钟`
                    : ''}
                </li>
              ))}
            </ul>
          )}
          <p className="day-panel__hint" data-testid="free-total">
            合计空闲 {Math.floor(totalFreeMinutes(gaps) / 60)} 小时 {totalFreeMinutes(gaps) % 60} 分钟
          </p>
        </section>
      </aside>
    </div>
  )
}

export { parseDate }
