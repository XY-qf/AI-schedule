import { JSDOM } from 'jsdom'

let dom: JSDOM | null = null

function setGlobal(key: string, value: unknown): void {
  Object.defineProperty(globalThis, key, {
    value,
    configurable: true,
    writable: true,
  })
}

/**
 * 为界面测试建立最小 DOM 环境。
 * 必须在加载 @testing-library/react 之前调用（由 tests/run-all.ts 统一在入口处执行）。
 */
export function setupDom(): void {
  if (dom) return
  dom = new JSDOM('<!doctype html><html><body></body></html>', {
    url: 'http://localhost/',
    // 注意：不要开 pretendToBeVisual —— 它会启动持续运行的动画帧循环，
    // 导致测试跑完后 Node 进程一直不退出。
    pretendToBeVisual: false,
  })
  const w = dom.window as unknown as Window & typeof globalThis

  setGlobal('window', w)
  setGlobal('document', w.document)
  setGlobal('navigator', w.navigator)
  setGlobal('HTMLElement', w.HTMLElement)
  setGlobal('HTMLInputElement', w.HTMLInputElement)
  setGlobal('HTMLButtonElement', w.HTMLButtonElement)
  setGlobal('HTMLSelectElement', w.HTMLSelectElement)
  setGlobal('HTMLTextAreaElement', w.HTMLTextAreaElement)
  setGlobal('Element', w.Element)
  setGlobal('Node', w.Node)
  setGlobal('Event', w.Event)
  setGlobal('CustomEvent', w.CustomEvent)
  setGlobal('MouseEvent', w.MouseEvent)
  setGlobal('KeyboardEvent', w.KeyboardEvent)
  setGlobal('FocusEvent', w.FocusEvent)
  setGlobal('getComputedStyle', w.getComputedStyle.bind(w))
  setGlobal('requestAnimationFrame', (cb: FrameRequestCallback) =>
    setTimeout(() => cb(Date.now()), 0),
  )
  setGlobal('cancelAnimationFrame', (id: number) => clearTimeout(id))
  setGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  setGlobal(
    'ResizeObserver',
    class {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    },
  )
  setGlobal('matchMedia', () => ({
    matches: false,
    addEventListener: (): void => {},
    removeEventListener: (): void => {},
  }))
}

export function teardownDom(): void {
  if (!dom) return
  dom.window.close()
  dom = null
}
