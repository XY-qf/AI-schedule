import type { ReactElement } from 'react'
import { cleanup, render as rtlRender } from '@testing-library/react'

/**
 * 统一的渲染入口：每次渲染前先清理上一次挂载的树。
 * 这样即使某个测试在断言中途失败，也不会把 DOM 泄漏给下一个测试。
 */
export function render(ui: ReactElement) {
  cleanup()
  return rtlRender(ui)
}

export { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react'
