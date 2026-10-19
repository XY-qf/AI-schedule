import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { formatDate, parseDate, sameDay } from '../../shared/date'
import { monthGridDates, weekdayOfDate } from '../../shared/layout'
import { WEEKDAY_SHORT } from './weekdayLabels'

export interface MiniCalendarProps {
  /** 已选日期 'YYYY-MM-DD' */
  value: string
  /** 区间模式的结束日期；给了就高亮中间这一段 */
  endValue?: string | null
  /** 点击某一天 */
  onSelect: (date: string) => void
  /** 固定“今天”，便于测试 */
  today?: Date
}

function startOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1)
}

/**
 * 弹窗里的小日历：日期从日历上点选，不用手动输入（反馈第二版第 5 条）。
 */
export function MiniCalendar({ value, endValue = null, onSelect, today }: MiniCalendarProps): ReactNode {
  const todayDate = today ?? new Date()
  const [cursor, setCursor] = useState<Date>(() => startOfMonth(parseDate(value)))

  // 外部把日期改到别的月份时，跟着翻过去
  useEffect(() => {
    const target = startOfMonth(parseDate(value))
    setCursor((current) =>
      current.getFullYear() === target.getFullYear() && current.getMonth() === target.getMonth()
        ? current
        : target,
    )
  }, [value])

  const dates = useMemo(() => monthGridDates(cursor), [cursor])
  const monthKey = `${cursor.getFullYear()}-${cursor.getMonth()}`

  const shiftMonth = (delta: number): void => {
    setCursor((current) => new Date(current.getFullYear(), current.getMonth() + delta, 1))
  }

  const rangeStart = value
  const rangeEnd = endValue && endValue >= rangeStart ? endValue : null

  return (
    <div className="mini-cal" data-testid="mini-calendar">
      <div className="mini-cal__head">
        <button type="button" className="mini-cal__nav" aria-label="上个月" onClick={() => shiftMonth(-1)}>
          ‹
        </button>
        <span className="mini-cal__title" data-testid="mini-cal-title">
          {cursor.getFullYear()}年{cursor.getMonth() + 1}月
        </span>
        <button type="button" className="mini-cal__nav" aria-label="下个月" onClick={() => shiftMonth(1)}>
          ›
        </button>
      </div>

      <div className="mini-cal__weekdays" aria-hidden="true">
        {WEEKDAY_SHORT.map((label) => (
          <span key={label} className="mini-cal__weekday">
            {label.slice(1)}
          </span>
        ))}
      </div>

      <div className="mini-cal__grid" key={monthKey}>
        {dates.map((date) => {
          const dateObj = parseDate(date)
          const outside = dateObj.getMonth() !== cursor.getMonth()
          const isStart = date === value
          const isEnd = rangeEnd !== null && date === rangeEnd
          const inRange = rangeEnd !== null && date > rangeStart && date < rangeEnd
          const classes = [
            'mini-cal__day',
            outside ? 'is-outside' : '',
            isStart ? 'is-selected' : '',
            isEnd ? 'is-end' : '',
            inRange ? 'is-in-range' : '',
            sameDay(dateObj, todayDate) ? 'is-today' : '',
          ]
            .filter(Boolean)
            .join(' ')

          return (
            <button
              key={date}
              type="button"
              className={classes}
              data-testid={`mini-day-${date}`}
              data-weekday={weekdayOfDate(date)}
              aria-label={formatDate(dateObj)}
              aria-pressed={isStart}
              onClick={() => onSelect(date)}
            >
              {dateObj.getDate()}
            </button>
          )
        })}
      </div>
    </div>
  )
}
