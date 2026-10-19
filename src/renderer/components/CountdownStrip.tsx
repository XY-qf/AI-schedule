import type { ReactNode } from 'react'
import type { CountdownItem } from '../../shared/countdown'

export interface CountdownStripProps {
  items: CountdownItem[]
  onSelect: (id: string) => void
}

/** 顶部「重要事项倒计时」：只显示最近几条，点一下打开详情。 */
export function CountdownStrip({ items, onSelect }: CountdownStripProps): ReactNode {
  if (items.length === 0) return null

  return (
    <div className="countdown-strip" data-testid="countdown-strip">
      {items.map((item) => (
        <button
          key={item.event.id}
          type="button"
          className={`countdown-card category-${item.event.category}${item.countdown.expired ? ' is-expired' : ''}`}
          data-testid={`countdown-${item.event.id}`}
          onClick={() => onSelect(item.event.id)}
          title={`${item.event.title}｜${item.whenText}`}
        >
          <span className="countdown-card__title">{item.event.title}</span>
          <span className="countdown-card__value">{item.countdown.text}</span>
          <span className="countdown-card__when">{item.whenText}</span>
        </button>
      ))}
    </div>
  )
}
