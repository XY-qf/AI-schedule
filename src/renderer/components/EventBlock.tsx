import { useCallback, useRef, useState, type ReactNode } from 'react'
import type { EventItem } from '../../shared/entities'
import { CATEGORY_LABEL } from '../../shared/domain'
import type { PlacedBlock } from '../../shared/layout'
import { snapMinutes } from '../../shared/date'

export const HOUR_HEIGHT = 48
export const DAY_HEIGHT = HOUR_HEIGHT * 24
/** 拖动超过这个像素才算“真的在拖”，避免误触 */
export const DRAG_THRESHOLD_PX = 5

function minutesToPx(minutes: number): number {
  return (minutes / 60) * HOUR_HEIGHT
}

function pxToMinutes(px: number): number {
  return (px / HOUR_HEIGHT) * 60
}

function timeText(event: EventItem): string {
  if (event.kind === 'todo') return '待办'
  if (!event.startAt || !event.endAt) return ''
  if (event.kind === 'allDay') return '全天'
  return `${event.startAt.slice(11, 16)}–${event.endAt.slice(11, 16)}`
}

export interface EventBlockProps {
  event: EventItem
  placed: PlacedBlock
  editing: boolean
  onSelect: (id: string) => void
  onOpenEditor: (id: string) => void
  /** 拖动块：整体平移（分钟，已吸附） */
  onMove?: (id: string, deltaMinutes: number) => void
  /** 拉下边缘：改变时长（分钟，已吸附） */
  onResize?: (id: string, deltaMinutes: number) => void
  /** 右键菜单 */
  onContextMenu?: (id: string, x: number, y: number) => void
}

interface DragState {
  mode: 'move' | 'resize'
  startY: number
  deltaMinutes: number
  dragging: boolean
}

/** 时间轴上的一个日程块：按分钟定位，重叠时按列并排。 */
export function EventBlock({
  event,
  placed,
  editing,
  onSelect,
  onOpenEditor,
  onMove,
  onResize,
  onContextMenu,
}: EventBlockProps): ReactNode {
  const top = minutesToPx(placed.startMin)
  const height = minutesToPx(Math.max(placed.endMin - placed.startMin, 1))
  const width = 100 / placed.columnCount
  const compact = height < 34
  const [drag, setDrag] = useState<DragState | null>(null)
  const dragRef = useRef<DragState | null>(null)

  const canDrag = editing && event.kind === 'timed' && Boolean(onMove || onResize)

  const beginDrag = useCallback(
    (mode: 'move' | 'resize', startY: number) => {
      const state: DragState = { mode, startY, deltaMinutes: 0, dragging: false }
      dragRef.current = state
      setDrag(state)

      const onMouseMove = (moveEvent: MouseEvent): void => {
        const current = dragRef.current
        if (!current) return
        const deltaPx = moveEvent.clientY - current.startY
        if (!current.dragging && Math.abs(deltaPx) < DRAG_THRESHOLD_PX) return
        const next: DragState = {
          ...current,
          dragging: true,
          deltaMinutes: snapMinutes(pxToMinutes(deltaPx)),
        }
        dragRef.current = next
        setDrag(next)
      }

      const onMouseUp = (): void => {
        window.removeEventListener('mousemove', onMouseMove)
        window.removeEventListener('mouseup', onMouseUp)
        const current = dragRef.current
        dragRef.current = null
        setDrag(null)
        if (!current || !current.dragging || current.deltaMinutes === 0) return
        if (current.mode === 'move') onMove?.(event.id, current.deltaMinutes)
        else onResize?.(event.id, current.deltaMinutes)
      }

      window.addEventListener('mousemove', onMouseMove)
      window.addEventListener('mouseup', onMouseUp)
    },
    [event.id, onMove, onResize],
  )

  const classes = [
    'event-block',
    `category-${event.category}`,
    event.done ? 'is-done' : '',
    compact ? 'is-compact' : '',
    editing ? 'is-editable' : '',
    drag?.dragging ? 'is-dragging' : '',
  ]
    .filter(Boolean)
    .join(' ')

  const previewOffset = drag?.mode === 'move' ? minutesToPx(drag.deltaMinutes) : 0
  const previewHeight = drag?.mode === 'resize' ? minutesToPx(drag.deltaMinutes) : 0

  return (
    <button
      type="button"
      className={classes}
      data-testid={`block-${event.id}`}
      data-category={event.category}
      style={{
        top: `${top + previewOffset}px`,
        height: `${Math.max(height + previewHeight, 8)}px`,
        left: `calc(${width * placed.column}% + 2px)`,
        width: `calc(${width}% - 4px)`,
      }}
      onMouseDown={(mouseEvent) => {
        if (!canDrag || !onMove) return
        mouseEvent.preventDefault()
        beginDrag('move', mouseEvent.clientY)
      }}
      onClick={() => onSelect(event.id)}
      onDoubleClick={() => onOpenEditor(event.id)}
      onContextMenu={(contextEvent) => {
        contextEvent.preventDefault()
        onContextMenu?.(event.id, contextEvent.clientX, contextEvent.clientY)
      }}
      title={`${event.title}｜${CATEGORY_LABEL[event.category]}｜${timeText(event)}`}
    >
      <span className="event-block__title">{event.title}</span>
      {!compact ? (
        <span className="event-block__meta">
          {timeText(event)}
          {event.location ? ` · ${event.location}` : ''}
        </span>
      ) : null}
      {canDrag && onResize ? (
        <span
          className="event-block__resize"
          data-testid={`resize-${event.id}`}
          onMouseDown={(mouseEvent) => {
            mouseEvent.preventDefault()
            mouseEvent.stopPropagation()
            beginDrag('resize', mouseEvent.clientY)
          }}
        />
      ) : null}
    </button>
  )
}
