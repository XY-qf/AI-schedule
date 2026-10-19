import { describe, expect, it } from '../helpers/expect'
import path from 'node:path'
import { resolveRendererAsset } from '../../src/main/rendererProtocol'

const ROOT = path.join('C:', 'app', 'dist', 'renderer')

describe('app:// 界面资源解析', () => {
  it('根路径映射到 index.html', () => {
    const asset = resolveRendererAsset(ROOT, 'app://bundle/')
    expect(asset).not.toBeNull()
    expect(asset!.target.endsWith('index.html')).toBe(true)
    expect(asset!.mime).toContain('text/html')
  })

  it('脚本、样式、wasm 的 MIME 都要对', () => {
    expect(resolveRendererAsset(ROOT, 'app://bundle/assets/app.js')!.mime).toContain('javascript')
    expect(resolveRendererAsset(ROOT, 'app://bundle/assets/worker.mjs')!.mime).toContain('javascript')
    expect(resolveRendererAsset(ROOT, 'app://bundle/assets/app.css')!.mime).toContain('text/css')
    expect(resolveRendererAsset(ROOT, 'app://bundle/assets/ort.wasm')!.mime).toBe('application/wasm')
  })

  it('带查询串也能解析（启动参数 page/view）', () => {
    const asset = resolveRendererAsset(ROOT, 'app://bundle/index.html?page=courseTable&view=week')
    expect(asset).not.toBeNull()
    expect(asset!.target.endsWith('index.html')).toBe(true)
  })

  it('越界路径被拦下', () => {
    expect(resolveRendererAsset(ROOT, 'app://bundle/%2e%2e%2f%2e%2e%2fsecret.txt')).toBeNull()
    expect(resolveRendererAsset(ROOT, 'app://bundle/..%5c..%5csecret.txt')).toBeNull()
  })

  it('坏 URL 与空字节返回 null', () => {
    expect(resolveRendererAsset(ROOT, 'not a url')).toBeNull()
    expect(resolveRendererAsset(ROOT, 'app://bundle/a%00.js')).toBeNull()
  })

  it('所有结果都落在 dist/renderer 里面', () => {
    const asset = resolveRendererAsset(ROOT, 'app://bundle/assets/app.js')
    expect(asset!.target.startsWith(path.normalize(ROOT))).toBe(true)
  })
})
