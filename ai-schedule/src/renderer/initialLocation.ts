import { isPageKey, isViewKey, type PageKey, type ViewKey } from '../shared/navigation'

export interface InitialLocation {
  page: PageKey
  view: ViewKey
}

/**
 * 从启动参数里读取上次停留的页面与视图。
 * 主进程通过 loadFile 的 query 传入，非法值一律退回默认。
 */
export function readInitialLocation(search: string): InitialLocation {
  const params = new URLSearchParams(search)
  const page = params.get('page')
  const view = params.get('view')
  return {
    page: isPageKey(page) ? page : 'calendar',
    view: isViewKey(view) ? view : 'week',
  }
}
