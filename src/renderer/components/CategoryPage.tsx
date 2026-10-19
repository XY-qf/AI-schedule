import { useState, type ReactNode } from 'react'
import type { Category } from '../../shared/domain'
import { CATEGORY_LABEL } from '../../shared/domain'
import type { EventItem } from '../../shared/entities'
import { groupByTime } from '../../shared/collections'
import { formatChineseDate, parseDate } from '../../shared/date'
import { Button } from './Controls'
import { EmptyState } from './Feedback'

export interface CategoryPageProps {
  category: Category
  events: EventItem[]
  today: Date
  onCreate: () => void
  onSelect: (id: string) => void
  onToggleDone: (id: string) => void
}

function timeLabel(event: EventItem): string {
  if (event.kind === 'todo') return '待办'
  if (event.kind === 'allDay') return '全天'
  if (!event.startAt || !event.endAt) return ''
  return `${event.startAt.slice(11, 16)}–${event.endAt.slice(11, 16)}`
}

function dayLabel(event: EventItem, today: Date): string {
  const date = event.kind === 'todo' ? event.dueAt?.slice(0, 10) : event.startAt?.slice(0, 10)
  if (!date) return ''
  const target = parseDate(date)
  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
  if (date === todayStr) return '今天'
  return formatChineseDate(target)
}

/** 课外活动页 / 个人生活页（同一个组件，按分类取数）。 */
export function CategoryPage({
  category,
  events,
  today,
  onCreate,
  onSelect,
  onToggleDone,
}: CategoryPageProps): ReactNode {
  const [showDone, setShowDone] = useState(false)
  const [showPast, setShowPast] = useState(false)
  const groups = groupByTime(events, today)
  const title = CATEGORY_LABEL[category]

  const renderRow = (event: EventItem): ReactNode => (
    <div key={event.id} className={`category-row${event.done ? ' is-done' : ''}`} data-testid={`cat-row-${event.id}`}>
      <span className="category-row__day">{dayLabel(event, today)}</span>
      <span className="category-row__time">{timeLabel(event)}</span>
      <button type="button" className="category-row__main" onClick={() => onSelect(event.id)}>
        <span className={`category-row__dot category-${event.category}`} />
        <span className="category-row__title">{event.title}</span>
        {event.location ? <span className="category-row__meta">{event.location}</span> : null}
      </button>
      <input
        type="checkbox"
        className="category-row__done"
        aria-label={`${event.title} 已完成`}
        checked={event.done}
        onChange={() => onToggleDone(event.id)}
      />
    </div>
  )

  const visibleUpcoming = groups.upcoming.filter((event) => showDone || !event.done)
  const visiblePast = groups.past.filter((event) => showDone || !event.done)

  return (
    <section className="page" aria-label={title}>
      <div className="page__header">
        <span className="page__title">{title}</span>
        <span className="toolbar-spacer" />
        <label className="checkbox">
          <input
            type="checkbox"
            aria-label="显示已完成的"
            checked={showDone}
            onChange={(event) => setShowDone(event.target.checked)}
          />
          显示已完成的
        </label>
        <Button variant="primary" onClick={onCreate}>
          ＋ 新建{title}
        </Button>
      </div>
      <div className="page__body">
        {groups.upcoming.length === 0 && groups.past.length === 0 ? (
          <EmptyState
            title={`还没有${title}安排`}
            description="点右上角「新建」开始记录。"
          />
        ) : (
          <>
            <h3 className="list-group__title">即将到来</h3>
            {visibleUpcoming.length === 0 ? (
              <p className="day-panel__empty">没有即将到来的安排</p>
            ) : (
              <div className="category-list">{visibleUpcoming.map(renderRow)}</div>
            )}

            {groups.past.length > 0 ? (
              <>
                <h3 className="list-group__title category-list__past-head">
                  更早
                  <button
                    type="button"
                    className="btn btn--ghost btn--sm"
                    onClick={() => setShowPast((value) => !value)}
                  >
                    {showPast ? '收起' : `展开（${groups.past.length}）`}
                  </button>
                </h3>
                {showPast ? <div className="category-list">{visiblePast.map(renderRow)}</div> : null}
              </>
            ) : null}
          </>
        )}
      </div>
    </section>
  )
}
