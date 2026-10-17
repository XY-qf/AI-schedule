/**
 * jsdom 只用于测试环境，仅声明本项目用到的部分 API，
 * 避免为了一个测试依赖再引入 @types/jsdom。
 */
declare module 'jsdom' {
  export interface JSDOMOptions {
    url?: string
    pretendToBeVisual?: boolean
  }

  export class JSDOM {
    constructor(html?: string, options?: JSDOMOptions)
    readonly window: Window & typeof globalThis
  }
}
