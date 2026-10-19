import { useState, type ReactNode } from 'react'
import type { EventItem } from '../../shared/entities'
import { CATEGORY_LABEL } from '../../shared/domain'
import { TODO_BUCKET_LABEL, TODO_BUCKET_ORDER, groupTodos, type TodoBucket } from '../../shared/collections'
import { formatChineseDate, parseDate } from '../../shared/date'
import { Button } from './Controls'
import { EmptyState } from './Feedback'

export interface TodoPageProps {
  events: EventItem[]
  today: Date
  onCreate: () => void
  onSelect: (id: string) => void
  onToggleDone: (id: string) => void
}

function dueLabel(event: EventItem): string {
  if (!event.dueAt) return ''
  const date = event.dueAt.slice(0, 10)
  const time = event.dueAt.includes('T') ? event.dueAt.slice(11, 16) : ''
  return `${formatChineseDate(parseDate(date))}${time && time !== '23:59' ? ` ${time}` : ''}`
}

/** 待办页（PRD 6.7）：按 逾期／今天／本周／以后 分组，已完成折叠。 */
export function TodoPage({ events, today, onCreate, onSelect, onToggleDone }: TodoPageProps): ReactNode {
  const [showDone, setShowDone] = useState(false)
  const groups = groupTodos(events, today)
  const total = events.length

  const renderRow = (event: EventItem): ReactNode => (
    <div
      key={event.id}
      className={`todo-row${event.done ? ' is-done' : ''}`}
      data-testid={`todo-row-${event.id}`}
    >
      <input
        type="checkbox"
        className="todo-row__done"
        aria-label={`${event.title} 已完成`}
        checked={event.done}
        onChange={() => onToggleDone(event.id)}
      />
      <button type="button" className="todo-row__main" onClick={() => onSelect(event.id)}>
        <span className="todo-row__due">{dueLabel(event)}</span>
        <span className="todo-row__title">{event.title}</span>
        <span className="todo-row__category">{CATEGORY_LABEL[event.category]}</span>
      </button>
    </div>
  )

  return (
    <section className="page" aria-label="待办">
      <div className="page__header">
        <span className="page__title">待办</span>
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
          ＋ 新建待办
        </Button>
      </div>
      <div className="page__body">
        {total === 0 ? (
          <EmptyState title="还没有待办" description="把只有截止日期的事记在这里，按紧急程度自动分组。" />
        ) : (
          <>
            {TODO_BUCKET_ORDER.map((bucket: TodoBucket) => {
              const items = groups[bucket]
              if (items.length === 0) return null
              return (
                <div key={bucket} className={`todo-group todo-group--${bucket}`} data-testid={`todo-group-${bucket}`}>
                  <h3 className="todo-group__title">
                    {TODO_BUCKET_LABEL[bucket]}
                    <span className="todo-group__count">({items.length})</span>
                  </h3>
                  <div className="todo-group__items">{items.map(renderRow)}</div>
                </div>
              )
            })}

            {groups.done.length > 0 ? (
              <div className="todo-group" data-testid="todo-group-done">
                <h3 className="todo-group__title">
                  <button
                    type="button"
                    className="btn btn--ghost btn--sm"
                    aria-label="展开已完成"
                    onClick={() => setShowDone((value) => !value)}
                  >
                    {showDone ? '▾' : '▸'}
                  </button>
                  已完成
                  <span className="todo-group__count">({groups.done.length})</span>
                </h3>
                {showDone ? <div className="todo-group__items">{groups.done.map(renderRow)}</div> : null}
              </div>
            ) : null}
          </>
        )}
      </div>
    </section>
  )
}
