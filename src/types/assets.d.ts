declare module '*.css' {
  const content: string
  export default content
}

/** Vite 的 `?url` 资源导入：返回打包后可直接使用的 URL。 */
declare module '*?url' {
  const url: string
  export default url
}

/** Vite 的 `?worker&url`：让 worker 单独打包，并把它的 URL 交给主线程。 */
declare module '*.ts?worker&url' {
  const url: string
  export default url
}
