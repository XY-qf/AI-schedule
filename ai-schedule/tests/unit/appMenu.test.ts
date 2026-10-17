import { describe, expect, it } from '../helpers/expect'
import { buildMenuTemplate, collectMenuLabels, type MenuActions } from '../../src/main/appMenu'

const noop = (): void => undefined

const ACTIONS: MenuActions = {
  onNewEvent: noop,
  onToday: noop,
  onPrev: noop,
  onNext: noop,
  onOpenSettings: noop,
  onQuit: noop,
  onAbout: noop,
  onReload: noop,
  onToggleDevTools: noop,
}

describe('应用菜单（反馈 #2：菜单栏改为中文）', () => {
  const template = buildMenuTemplate(ACTIONS)
  const labels = collectMenuLabels(template)

  it('顶级菜单是中文', () => {
    const top = template.map((item) => item.label).filter(Boolean)
    expect(top).toContain('文件')
    expect(top).toContain('编辑')
    expect(top).toContain('视图')
    expect(top).toContain('帮助')
  })

  it('不出现 Electron 默认的英文菜单名', () => {
    for (const english of ['File', 'Edit', 'View', 'Window', 'Help']) {
      expect(labels).not.toContain(english)
    }
  })

  it('所有菜单文案都含中文', () => {
    for (const label of labels) {
      expect(/[\u4e00-\u9fa5]/.test(label)).toBe(true)
    }
  })

  it('文件菜单里有新建日程与退出', () => {
    expect(labels).toContain('新建日程')
    expect(labels).toContain('退出')
  })

  it('新建日程绑定了快捷键', () => {
    const file = template.find((item) => item.label === '文件')
    const items = (file?.submenu ?? []) as Array<{ label?: string; accelerator?: string }>
    const item = items.find((entry) => entry.label === '新建日程')
    expect(item?.accelerator).toBe('CmdOrCtrl+N')
  })
})
