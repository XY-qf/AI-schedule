/**
 * 路径守卫。
 *
 * Windows 上的 Electron/Chromium 无法从含非 ASCII 字符（例如中文）的路径启动：
 * 进程会在浏览器进程初始化阶段直接崩溃（0x80000003 / 0xC0000005），
 * 连窗口都不出现，也不给任何提示。这里在启动最早期检测并给出可读的中文提示。
 */

/** 路径里是否有非 ASCII 字符（中文、日文、emoji、全角符号等）。 */
export function isAsciiPath(filePath: string): boolean {
  return !/[^\u0000-\u007F]/.test(filePath)
}

export function pathGuardMessage(execPath: string): string {
  return [
    '程序所在的路径含有中文或其它非英文字符，Windows 上的 Electron 无法从这种路径启动。',
    '',
    `当前路径：${execPath}`,
    '',
    '请把整个程序文件夹移动到纯英文路径下再运行，例如：',
    '    C:\\AI-Schedule\\',
    '',
    '桌面快捷方式可以用中文名字，但程序本体必须放在英文路径里。',
  ].join('\n')
}

/** 判断是否需要拦截；需要拦截时返回提示文案。 */
export function checkExecutablePath(execPath: string): string | null {
  return isAsciiPath(execPath) ? null : pathGuardMessage(execPath)
}
