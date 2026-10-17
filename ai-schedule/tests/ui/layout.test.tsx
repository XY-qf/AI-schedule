import { describe, expect, it } from '../helpers/expect'
import { cleanup, fireEvent, render, screen } from '../helpers/ui'
import { App } from '../../src/renderer/App'
import { NavBar, StatusBar, Toolbar } from '../../src/renderer/components/Layout'
import { viewTitle, weekRangeLabel, shiftAnchor } from '../../src/shared/viewTitle'
import { weekOfMonth, parseDate } from '../../src/shared/date'

describe('工具栏标题', () => {
  it('周视图显示年月与第几周', () => {
    expect(viewTitle('week', parseDate('2026-03-04'))).toBe('2026年3月 第2周')
    expect(viewTitle('week', parseDate('2026-03-01'))).toBe('2026年3月 第1周')
  })

  it('日视图显示完整中文日期', () => {
    expect(viewTitle('day', parseDate('2026-03-04'))).toBe('2026年3月4日 周三')
  })

  it('月视图只显示年月，列表视图显示固定文案', () => {
    expect(viewTitle('month', parseDate('2026-03-04'))).toBe('2026年3月')
    expect(viewTitle('list', parseDate('2026-03-04'))).toBe('接下来 30 天')
  })

  it('本月第几周计算正确', () => {
    // 2026-03-01 是周日，属于第 1 周
    expect(weekOfMonth(parseDate('2026-03-01'))).toBe(1)
    expect(weekOfMonth(parseDate('2026-03-02'))).toBe(2)
    expect(weekOfMonth(parseDate('2026-03-08'))).toBe(2)
    expect(weekOfMonth(parseDate('2026-03-09'))).toBe(3)
    // 2026-01-01 是周四
    expect(weekOfMonth(parseDate('2026-01-01'))).toBe(1)
    expect(weekOfMonth(parseDate('2026-01-05'))).toBe(2)
  })
})

describe('周范围文字', () => {
  it('同月时只显示一个月份', () => {
    expect(weekRangeLabel(parseDate('2026-03-02'))).toBe('3月2日 – 8日')
  })

  it('跨月时两端都带月份', () => {
    expect(weekRangeLabel(parseDate('2026-03-30'))).toBe('3月30日 – 4月5日')
  })
})

describe('翻页粒度', () => {
  it('周视图翻 7 天、日视图翻 1 天、列表翻 30 天', () => {
    const base = parseDate('2026-03-04')
    expect(shiftAnchor('week', base, 1).getDate()).toBe(11)
    expect(shiftAnchor('day', base, 1).getDate()).toBe(5)
    expect(shiftAnchor('day', base, -1).getDate()).toBe(3)
    expect(shiftAnchor('list', base, 1).getDate()).toBe(3) // 4 + 30 = 次月 3 日
  })

  it('月视图按月份翻', () => {
    expect(shiftAnchor('month', parseDate('2026-03-04'), 1).getMonth()).toBe(3)
    expect(shiftAnchor('month', parseDate('2026-12-04'), 1).getFullYear()).toBe(2027)
  })
})

describe('左侧导航', () => {
  it('渲染六个入口，顺序固定，设置单独在下方', () => {
    render(<NavBar page="calendar" onSelect={() => {}} />)
    const buttons = screen.getAllByRole('button')
    const labels = buttons.map((button) => button.textContent)
    expect(labels).toEqual(['日历', '课程表', '课外活动', '个人生活', '待办', '设置'])
    cleanup()
  })

  it('当前页高亮并标记 aria-current', () => {
    render(<NavBar page="todo" onSelect={() => {}} />)
    const todo = screen.getByRole('button', { name: '待办' })
    expect(todo.className).toContain('is-active')
    expect(todo.getAttribute('aria-current')).toBe('page')
    const calendar = screen.getByRole('button', { name: '日历' })
    expect(calendar.className).not.toContain('is-active')
    cleanup()
  })

  it('点击回传页面键', () => {
    let picked = ''
    render(<NavBar page="calendar" onSelect={(page) => (picked = page)} />)
    fireEvent.click(screen.getByRole('button', { name: '课程表' }))
    expect(picked).toBe('courseTable')
    cleanup()
  })
})

describe('顶部工具栏', () => {
  it('浏览态显示“编辑”，编辑态显示“完成编辑”并高亮', () => {
    const { rerender } = render(
      <Toolbar
        title="2026年3月 第2周"
        editing={false}
        onPrev={() => {}}
        onNext={() => {}}
        onToday={() => {}}
        onCreate={() => {}}
        onToggleEditing={() => {}}
      />,
    )
    const editButton = screen.getByRole('button', { name: '编辑' })
    expect(editButton.getAttribute('aria-pressed')).toBe('false')

    rerender(
      <Toolbar
        title="2026年3月 第2周"
        editing
        onPrev={() => {}}
        onNext={() => {}}
        onToday={() => {}}
        onCreate={() => {}}
        onToggleEditing={() => {}}
      />,
    )
    const doneButton = screen.getByRole('button', { name: '完成编辑' })
    expect(doneButton.getAttribute('aria-pressed')).toBe('true')
    expect(doneButton.className).toContain('btn--active')
    cleanup()
  })

  it('显示标题并触发各按钮回调', () => {
    const calls: string[] = []
    render(
      <Toolbar
        title="2026年3月 第2周"
        editing={false}
        onPrev={() => calls.push('prev')}
        onNext={() => calls.push('next')}
        onToday={() => calls.push('today')}
        onCreate={() => calls.push('create')}
        onToggleEditing={() => calls.push('edit')}
      />,
    )
    expect(screen.getByTestId('toolbar-title').textContent).toBe('2026年3月 第2周')
    fireEvent.click(screen.getByRole('button', { name: '上一页' }))
    fireEvent.click(screen.getByRole('button', { name: '下一页' }))
    fireEvent.click(screen.getByRole('button', { name: '今天' }))
    fireEvent.click(screen.getByRole('button', { name: '＋ 新建' }))
    fireEvent.click(screen.getByRole('button', { name: '编辑' }))
    expect(calls).toEqual(['prev', 'next', 'today', 'create', 'edit'])
    cleanup()
  })
})

describe('底部状态栏', () => {
  it('显示数据位置、备份时间与条数', () => {
    render(
      <StatusBar
        dataFilePath={'C:\\Users\\me\\Documents\\AI日程\\schedule.db'}
        lastBackupAt="2026-03-04 09:00"
        backupFailed={false}
        eventCount={128}
      />,
    )
    const text = document.body.textContent ?? ''
    expect(text).toContain('数据位置：C:\\Users\\me\\Documents\\AI日程\\schedule.db')
    expect(text).toContain('上次自动备份：2026-03-04 09:00')
    expect(text).toContain('共 128 条日程')
    cleanup()
  })

  it('从未备份时显示“尚未备份”，备份失败时给出提示', () => {
    render(
      <StatusBar dataFilePath="x" lastBackupAt={null} backupFailed eventCount={0} />,
    )
    const text = document.body.textContent ?? ''
    expect(text).toContain('尚未备份')
    expect(text).toContain('备份失败')
    cleanup()
  })

  it('数据目录不可用时明确提示', () => {
    render(
      <StatusBar dataFilePath="x" lastBackupAt={null} backupFailed={false} eventCount={0} dataDirMissing />,
    )
    expect(document.body.textContent).toContain('数据目录不可用')
    cleanup()
  })
})

describe('整体框架', () => {
  it('默认停在日历页的周视图', () => {
    render(<App />)
    expect(screen.getByRole('tab', { name: '周' }).getAttribute('aria-selected')).toBe('true')
    expect(screen.getByRole('button', { name: '日历' }).className).toContain('is-active')
    cleanup()
  })

  it('切换导航后标题与内容跟着变', () => {
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: '待办' }))
    expect(screen.getByTestId('toolbar-title').textContent).toBe('待办')
    expect(screen.getByRole('region', { name: '待办' }).textContent).toContain('新建待办')
    cleanup()
  })

  it('切换视图会更新标题', () => {
    render(<App initialAnchor={parseDate('2026-03-04')} />)
    fireEvent.click(screen.getByRole('tab', { name: '日' }))
    expect(screen.getByTestId('toolbar-title').textContent).toBe('2026年3月4日 周三')
    cleanup()
  })

  it('进入编辑态时主区域带标记，按钮变文字', () => {
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: '编辑' }))
    expect(document.querySelector('.app-main')?.className).toContain('is-editing')
    expect(screen.getByRole('button', { name: '完成编辑' })).toBeTruthy()
    cleanup()
  })

  it('翻页按钮按周移动标题', () => {
    render(<App initialAnchor={parseDate('2026-03-04')} />)
    fireEvent.click(screen.getByRole('button', { name: '下一页' }))
    expect(screen.getByTestId('toolbar-title').textContent).toBe('2026年3月 第3周')
    fireEvent.click(screen.getByRole('button', { name: '上一页' }))
    expect(screen.getByTestId('toolbar-title').textContent).toBe('2026年3月 第2周')
    fireEvent.click(screen.getByRole('button', { name: '上一页' }))
    // 3 月 4 日往前两周是 2 月 25 日，属于 2 月第 5 周
    expect(screen.getByTestId('toolbar-title').textContent).toBe('2026年2月 第5周')
    cleanup()
  })

  it('导航变化会通知外层（用于记住上次位置）', () => {
    const seen: string[] = []
    render(<App onNavigate={(page, view) => seen.push(`${page}:${view}`)} />)
    fireEvent.click(screen.getByRole('button', { name: '课程表' }))
    fireEvent.click(screen.getByRole('button', { name: '日历' }))
    expect(seen).toEqual(['courseTable:week', 'calendar:week'])
    cleanup()
  })

  it('状态栏使用传入的真实状态', () => {
    render(
      <App
        status={{
          dataFilePath: 'D:\\data\\schedule.db',
          lastBackupAt: '2026-03-04 09:00',
          backupFailed: false,
          eventCount: 7,
          dataDirMissing: false,
        }}
      />,
    )
    const text = document.body.textContent ?? ''
    expect(text).toContain('D:\\data\\schedule.db')
    expect(text).toContain('共 7 条日程')
    cleanup()
  })
})
