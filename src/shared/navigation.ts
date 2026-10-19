/** 左侧导航的页面与日历视图的键，主进程与界面共用。 */

export const PAGES = ['calendar', 'courseTable', 'activity', 'life', 'todo', 'settings'] as const

export type PageKey = (typeof PAGES)[number]

export const PAGE_LABEL: Record<PageKey, string> = {
  calendar: '日历',
  courseTable: '课程表',
  activity: '课外活动',
  life: '个人生活',
  todo: '待办',
  settings: '设置',
}

export const VIEWS = ['week', 'day', 'month', 'list'] as const

export type ViewKey = (typeof VIEWS)[number]

export const VIEW_LABEL: Record<ViewKey, string> = {
  week: '周',
  day: '日',
  month: '月',
  list: '列表',
}

export function isPageKey(value: unknown): value is PageKey {
  return typeof value === 'string' && (PAGES as readonly string[]).includes(value)
}

export function isViewKey(value: unknown): value is ViewKey {
  return typeof value === 'string' && (VIEWS as readonly string[]).includes(value)
}
