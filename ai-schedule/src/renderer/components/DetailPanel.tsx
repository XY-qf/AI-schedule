import type { ReactNode } from 'react'
import type { EventItem } from '../../shared/entities'
import { CATEGORY_LABEL } from '../../shared/domain'
import { formatChineseDate, parseDate } from '../../shared/date'
import { Button } from './Controls'

export interface DetailPanelProps {
  event: EventItem | null
  /** 编辑态才允许修改 */
  editing: boolean
  onClose: () => void
  onEdit: () => void
  onToggleDone: () => void
  onDelete: () => void
  /** 当这条是课程表里的课时，提供这次课的信息 */
  courseOccurrence?: { courseId: string; date: string } | null
  /** 这次课是否已经被单独改期或停课 */
  isCourseException?: boolean
  onMoveCourseOnce?: () => void
  onCancelCourseOnce?: () => void
  onClearCourseException?: () => void
}

function timeLine(event: EventItem): string {
  if (event.kind === 'todo') {
    if (!event.dueAt) return ''
    const date = event.dueAt.slice(0, 10)
    const time = event.dueAt.includes('T') ? event.dueAt.slice(11, 16) : ''
    return `截止 ${formatChineseDate(parseDate(date))}${time ? ` ${time}` : ''}`
  }
  if (event.kind === 'allDay') {
    if (!event.startAt || !event.endAt) return ''
    if (event.startAt === event.endAt) return `全天 ${formatChineseDate(parseDate(event.startAt))}`
    return `全天 ${formatChineseDate(parseDate(event.startAt))} 至 ${formatChineseDate(parseDate(event.endAt))}`
  }
  if (!event.startAt || !event.endAt) return ''
  const startDay = event.startAt.slice(0, 10)
  const endDay = event.endAt.slice(0, 10)
  const start = `${formatChineseDate(parseDate(startDay))} ${event.startAt.slice(11, 16)}`
  if (startDay === endDay) return `${start}–${event.endAt.slice(11, 16)}`
  return `${start} 至 ${formatChineseDate(parseDate(endDay))} ${event.endAt.slice(11, 16)}`
}

/** 右侧只读详情面板（PRD 6.1.2）。 */
export function DetailPanel({
  event,
  editing,
  onClose,
  onEdit,
  onToggleDone,
  onDelete,
  courseOccurrence,
  isCourseException = false,
  onMoveCourseOnce,
  onCancelCourseOnce,
  onClearCourseException,
}: DetailPanelProps): ReactNode {
  if (!event) return null

  return (
    <aside className="detail-panel" aria-label="日程详情" data-testid="detail-panel">
      <div className="detail-panel__header">
        <span className={`detail-panel__dot category-${event.category}`} />
        <span className="detail-panel__title">{event.title}</span>
        <button type="button" className="btn btn--ghost btn--sm btn--icon" aria-label="关闭详情" onClick={onClose}>
          ×
        </button>
      </div>

      <div className="detail-panel__body">
        <div className="detail-row">
          <span className="detail-row__label">类别</span>
          <span className="detail-row__value">{CATEGORY_LABEL[event.category]}</span>
        </div>
        <div className="detail-row">
          <span className="detail-row__label">时间</span>
          <span className="detail-row__value">{timeLine(event)}</span>
        </div>
        {event.location ? (
          <div className="detail-row">
            <span className="detail-row__label">地点</span>
            <span className="detail-row__value">{event.location}</span>
          </div>
        ) : null}
        {event.people ? (
          <div className="detail-row">
            <span className="detail-row__label">老师/参与人</span>
            <span className="detail-row__value">{event.people}</span>
          </div>
        ) : null}
        {event.note ? (
          <div className="detail-row">
            <span className="detail-row__label">备注</span>
            <span className="detail-row__value detail-row__value--multiline">{event.note}</span>
          </div>
        ) : null}
        <div className="detail-row">
          <span className="detail-row__label">状态</span>
          <span className="detail-row__value">{event.done ? '已完成' : '未完成'}</span>
        </div>
      </div>

      <div className="detail-panel__footer">
        {courseOccurrence ? (
          <>
            {editing && onMoveCourseOnce ? (
              <Button size="sm" onClick={onMoveCourseOnce}>
                仅这一次改期
              </Button>
            ) : null}
            {editing && onCancelCourseOnce ? (
              <Button size="sm" variant="danger" onClick={onCancelCourseOnce}>
                本次停课
              </Button>
            ) : null}
            {isCourseException && onClearCourseException ? (
              <Button size="sm" onClick={onClearCourseException}>
                撤销例外
              </Button>
            ) : null}
            <span className="detail-panel__hint">
              {isCourseException
                ? '这一次已单独调整过，不影响其它周次'
                : editing
                  ? '只影响这一次课，其它周次不变'
                  : '这是课程表里的课，点顶部「编辑」后可改期或停课'}
            </span>
          </>
        ) : editing ? (
          <>
            <Button size="sm" onClick={onEdit}>
              编辑
            </Button>
            <Button size="sm" onClick={onToggleDone}>
              {event.done ? '取消完成' : '标记完成'}
            </Button>
            <Button size="sm" variant="danger" onClick={onDelete}>
              删除
            </Button>
          </>
        ) : (
          <>
            <Button size="sm" onClick={onToggleDone}>
              {event.done ? '取消完成' : '标记完成'}
            </Button>
            <span className="detail-panel__hint">点顶部「编辑」后可修改或删除</span>
          </>
        )}
      </div>
    </aside>
  )
}
