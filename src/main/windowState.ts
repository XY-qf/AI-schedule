import type { SettingsRepository } from './db/settings'
import { isPageKey, isViewKey, type PageKey, type ViewKey } from '../shared/navigation'

export interface WindowState {
  /** 窗口左上角；null 表示交给系统决定（首次启动） */
  x: number | null
  y: number | null
  width: number
  height: number
  maximized: boolean
  lastPage: PageKey
  lastView: ViewKey
}

export const MIN_WINDOW_WIDTH = 1024
export const MIN_WINDOW_HEIGHT = 640
export const DEFAULT_WINDOW_WIDTH = 1280
export const DEFAULT_WINDOW_HEIGHT = 800

export const DEFAULT_WINDOW_STATE: WindowState = {
  x: null,
  y: null,
  width: DEFAULT_WINDOW_WIDTH,
  height: DEFAULT_WINDOW_HEIGHT,
  maximized: false,
  lastPage: 'calendar',
  lastView: 'week',
}

const KEY = {
  x: 'window.x',
  y: 'window.y',
  width: 'window.width',
  height: 'window.height',
  maximized: 'window.maximized',
  page: 'app.lastPage',
  view: 'app.lastView',
} as const

function clampSize(value: number | null, min: number, fallback: number): number {
  if (value === null || !Number.isFinite(value) || value <= 0) return fallback
  return Math.max(min, Math.round(value))
}

/** 读取窗口状态；任何非法值都退回默认值，保证不会出现不可用的窗口。 */
export function loadWindowState(repo: SettingsRepository): WindowState {
  const x = repo.getNumber(KEY.x)
  const y = repo.getNumber(KEY.y)
  const page = repo.get(KEY.page)
  const view = repo.get(KEY.view)
  return {
    x: x === null ? null : Math.round(x),
    y: y === null ? null : Math.round(y),
    width: clampSize(repo.getNumber(KEY.width), MIN_WINDOW_WIDTH, DEFAULT_WINDOW_WIDTH),
    height: clampSize(repo.getNumber(KEY.height), MIN_WINDOW_HEIGHT, DEFAULT_WINDOW_HEIGHT),
    maximized: repo.getBoolean(KEY.maximized) ?? false,
    lastPage: isPageKey(page) ? page : DEFAULT_WINDOW_STATE.lastPage,
    lastView: isViewKey(view) ? view : DEFAULT_WINDOW_STATE.lastView,
  }
}

/** 保存窗口状态；写成一个事务，避免只写了一半。 */
export function saveWindowState(repo: SettingsRepository, state: WindowState): void {
  const width = clampSize(state.width, MIN_WINDOW_WIDTH, DEFAULT_WINDOW_WIDTH)
  const height = clampSize(state.height, MIN_WINDOW_HEIGHT, DEFAULT_WINDOW_HEIGHT)
  const entries: Record<string, string | number | boolean> = {
    [KEY.width]: width,
    [KEY.height]: height,
    [KEY.maximized]: state.maximized,
    [KEY.page]: state.lastPage,
    [KEY.view]: state.lastView,
  }
  if (state.x !== null && Number.isFinite(state.x)) entries[KEY.x] = Math.round(state.x)
  if (state.y !== null && Number.isFinite(state.y)) entries[KEY.y] = Math.round(state.y)
  repo.setMany(entries)
}
