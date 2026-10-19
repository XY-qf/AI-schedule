import { isGpuCompatMode, type GpuCompatMode } from '../shared/gpuCompat'
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

/**
 * 主进程可能启用了 GPU 兼容模式；没有或非法就返回 null（正常模式）。
 */
export function readGpuCompatMode(search: string): GpuCompatMode | null {
  const raw = new URLSearchParams(search).get('gpuCompat')
  return isGpuCompatMode(raw) ? raw : null
}
