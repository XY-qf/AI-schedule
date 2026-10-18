import path from 'node:path'

/** 界面资源的 MIME：模块脚本与 wasm 对 MIME 很敏感，不能靠猜。 */
export const RENDERER_MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.wasm': 'application/wasm',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
}

export interface RendererAsset {
  /** 磁盘上的绝对路径 */
  target: string
  mime: string
}

/**
 * 把 `app://bundle/xxx` 解析成 dist/renderer 下的真实文件。
 *
 * 越界（`../`、绝对路径、非法 URL）一律返回 null，由调用方回 403/404。
 * 单独抽成纯函数是为了能脱离 Electron 测出来。
 */
export function resolveRendererAsset(rendererRoot: string, requestUrl: string): RendererAsset | null {
  let pathname: string
  try {
    pathname = decodeURIComponent(new URL(requestUrl).pathname || '/')
  } catch {
    return null
  }
  if (pathname.includes('\0')) return null

  const relative = pathname === '/' || pathname === '' ? 'index.html' : pathname.replace(/^\/+/, '')
  const root = path.normalize(rendererRoot)
  const target = path.normalize(path.join(root, relative))
  const prefix = root.endsWith(path.sep) ? root : `${root}${path.sep}`
  if (target !== root && !target.startsWith(prefix)) return null

  return { target, mime: RENDERER_MIME[path.extname(target).toLowerCase()] ?? 'application/octet-stream' }
}
