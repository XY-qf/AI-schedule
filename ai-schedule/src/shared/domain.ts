/** 三类日程：与数据存储、界面颜色共享的定义。 */

export const CATEGORIES = ['course', 'activity', 'life'] as const

export type Category = (typeof CATEGORIES)[number]

export const CATEGORY_LABEL: Record<Category, string> = {
  course: '课内',
  activity: '课外活动',
  life: '个人生活',
}

/** 一条日程的时间形态：时间段 / 全天 / 待办（只有截止时间）。 */
export const EVENT_KINDS = ['timed', 'allDay', 'todo'] as const

export type EventKind = (typeof EVENT_KINDS)[number]

export const EVENT_KIND_LABEL: Record<EventKind, string> = {
  timed: '时间段',
  allDay: '全天',
  todo: '待办',
}

export function isCategory(value: unknown): value is Category {
  return typeof value === 'string' && (CATEGORIES as readonly string[]).includes(value)
}

export function isEventKind(value: unknown): value is EventKind {
  return typeof value === 'string' && (EVENT_KINDS as readonly string[]).includes(value)
}
