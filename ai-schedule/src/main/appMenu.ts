import type { MenuItemConstructorOptions } from 'electron'

export interface MenuActions {
  onNewEvent: () => void
  onToday: () => void
  onPrev: () => void
  onNext: () => void
  onOpenSettings: () => void
  onQuit: () => void
  onAbout: () => void
  onReload: () => void
  onToggleDevTools: () => void
}

/**
 * 应用菜单模板（全中文）。
 *
 * Electron 默认菜单是英文的 File / Edit / View…，用户反馈第 2 条要求改成中文。
 * 抽成纯函数方便测试。
 */
export function buildMenuTemplate(actions: MenuActions): MenuItemConstructorOptions[] {
  const isMac = process.platform === 'darwin'

  return [
    ...(isMac
      ? [
          {
            label: 'AI日程',
            submenu: [
              { label: '关于 AI日程', click: actions.onAbout },
              { type: 'separator' as const },
              { label: '退出', accelerator: 'Cmd+Q', click: actions.onQuit },
            ],
          } as MenuItemConstructorOptions,
        ]
      : []),
    {
      label: '文件',
      submenu: [
        { label: '新建日程', accelerator: 'CmdOrCtrl+N', click: actions.onNewEvent },
        { type: 'separator' },
        { label: '设置', accelerator: 'CmdOrCtrl+,', click: actions.onOpenSettings },
        ...(isMac ? [] : [{ type: 'separator' as const }, { label: '退出', accelerator: 'Alt+F4', click: actions.onQuit }]),
      ] as MenuItemConstructorOptions[],
    },
    {
      label: '编辑',
      submenu: [
        { label: '撤销', role: 'undo' },
        { label: '重做', role: 'redo' },
        { type: 'separator' },
        { label: '剪切', role: 'cut' },
        { label: '复制', role: 'copy' },
        { label: '粘贴', role: 'paste' },
        { label: '全选', role: 'selectAll' },
      ] as MenuItemConstructorOptions[],
    },
    {
      label: '视图',
      submenu: [
        { label: '回到今天', accelerator: 'CmdOrCtrl+T', click: actions.onToday },
        { label: '上一页', accelerator: 'CmdOrCtrl+Left', click: actions.onPrev },
        { label: '下一页', accelerator: 'CmdOrCtrl+Right', click: actions.onNext },
        { type: 'separator' },
        { label: '重新加载', accelerator: 'CmdOrCtrl+R', click: actions.onReload },
        { label: '全屏', role: 'togglefullscreen' },
        { type: 'separator' },
        // 远程控制/串流软件会吞掉 Ctrl+Shift+I，所以再给一个 F12
        { label: '开发者工具', accelerator: 'CmdOrCtrl+Shift+I', click: actions.onToggleDevTools },
        { label: '开发者工具（F12）', accelerator: 'F12', click: actions.onToggleDevTools },
      ] as MenuItemConstructorOptions[],
    },
    {
      label: '帮助',
      submenu: [{ label: '关于 AI日程', click: actions.onAbout }],
    },
  ]
}

/** 收集模板里所有的文案，便于测试「不能出现英文菜单项」。 */
export function collectMenuLabels(template: MenuItemConstructorOptions[]): string[] {
  const labels: string[] = []
  const walk = (items: MenuItemConstructorOptions[]): void => {
    for (const item of items) {
      if (item.label) labels.push(item.label)
      if (Array.isArray(item.submenu)) walk(item.submenu as MenuItemConstructorOptions[])
    }
  }
  walk(template)
  return labels
}
