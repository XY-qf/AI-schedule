import { describe, expect, it } from '../helpers/expect'
import { cleanup, fireEvent, render, screen } from '../helpers/ui'
import { useState } from 'react'
import {
  Button,
  Checkbox,
  SelectField,
  SegmentedControl,
  TextField,
} from '../../src/renderer/components/Controls'
import { Dialog, EmptyState, Toast } from '../../src/renderer/components/Feedback'

describe('基础组件 · 按钮', () => {
  it('渲染文字并响应点击', () => {
    let clicked = 0
    render(<Button onClick={() => (clicked += 1)}>新建</Button>)
    fireEvent.click(screen.getByRole('button', { name: '新建' }))
    expect(clicked).toBe(1)
    cleanup()
  })

  it('变体与禁用状态正确反映到 DOM', () => {
    render(
      <Button variant="primary" disabled>
        保存
      </Button>,
    )
    const button = screen.getByRole('button', { name: '保存' }) as HTMLButtonElement
    expect(button.className).toContain('btn--primary')
    expect(button.disabled).toBe(true)
    cleanup()
  })

  it('默认是 type=button，不会误触发表单提交', () => {
    render(<Button>普通</Button>)
    const button = screen.getByRole('button', { name: '普通' }) as HTMLButtonElement
    expect(button.getAttribute('type')).toBe('button')
    cleanup()
  })
})

describe('基础组件 · 输入框', () => {
  it('标签与输入框关联，可输入', () => {
    render(<TextField id="title" label="标题" required />)
    const input = screen.getByLabelText(/标题/) as HTMLInputElement
    fireEvent.change(input, { target: { value: '高数' } })
    expect(input.value).toBe('高数')
    expect(document.querySelector('.field__label-required')).toBeTruthy()
    cleanup()
  })

  it('错误信息以 alert 角色出现并标记 aria-invalid', () => {
    render(<TextField id="title" label="标题" error="请填写标题" />)
    const alert = screen.getByRole('alert')
    expect(alert.textContent).toBe('请填写标题')
    const input = screen.getByLabelText('标题') as HTMLInputElement
    expect(input.getAttribute('aria-invalid')).toBe('true')
    cleanup()
  })

  it('没有错误时显示提示文字', () => {
    render(<TextField id="loc" label="地点" hint="可留空" />)
    expect(screen.queryByRole('alert')).toBeNull()
    expect(document.body.textContent).toContain('可留空')
    cleanup()
  })
})

describe('基础组件 · 勾选框与下拉框', () => {
  it('勾选框可切换并回调', () => {
    function Host(): React.ReactElement {
      const [checked, setChecked] = useState(false)
      return <Checkbox id="done" label="已完成" checked={checked} onChange={setChecked} />
    }
    render(<Host />)
    const box = screen.getByRole('checkbox') as HTMLInputElement
    expect(box.checked).toBe(false)
    fireEvent.click(box)
    expect(box.checked).toBe(true)
    cleanup()
  })

  it('下拉框渲染选项并响应选择', () => {
    let value = 'week'
    render(
      <SelectField
        id="view"
        label="视图"
        value={value}
        options={[
          { value: 'week', label: '周' },
          { value: 'day', label: '日' },
        ]}
        onChange={(event) => (value = event.target.value)}
      />,
    )
    const select = screen.getByLabelText('视图') as HTMLSelectElement
    expect(select.options.length).toBe(2)
    fireEvent.change(select, { target: { value: 'day' } })
    expect(value).toBe('day')
    cleanup()
  })
})

describe('基础组件 · 分段控件', () => {
  it('高亮当前项并在点击后切换', () => {
    function Host(): React.ReactElement {
      const [view, setView] = useState<'week' | 'day'>('week')
      return (
        <SegmentedControl
          ariaLabel="视图切换"
          value={view}
          options={[
            { value: 'week', label: '周' },
            { value: 'day', label: '日' },
          ]}
          onChange={setView}
        />
      )
    }
    render(<Host />)
    const week = screen.getByRole('tab', { name: '周' })
    const day = screen.getByRole('tab', { name: '日' })
    expect(week.getAttribute('aria-selected')).toBe('true')
    expect(day.getAttribute('aria-selected')).toBe('false')
    fireEvent.click(day)
    expect(day.getAttribute('aria-selected')).toBe('true')
    expect(week.getAttribute('aria-selected')).toBe('false')
    cleanup()
  })
})

describe('基础组件 · 弹窗', () => {
  it('关闭状态下不渲染内容', () => {
    render(
      <Dialog open={false} title="新建日程" onClose={() => {}}>
        内容
      </Dialog>,
    )
    expect(screen.queryByRole('dialog')).toBeNull()
    cleanup()
  })

  it('打开时渲染标题、内容与底部按钮', () => {
    render(
      <Dialog open title="新建日程" onClose={() => {}} footer={<Button variant="primary">保存</Button>}>
        内容区
      </Dialog>,
    )
    const dialog = screen.getByRole('dialog')
    expect(dialog.textContent).toContain('新建日程')
    expect(dialog.textContent).toContain('内容区')
    expect(screen.getByRole('button', { name: '保存' })).toBeTruthy()
    cleanup()
  })

  it('按 Esc 触发关闭', () => {
    let closed = 0
    render(
      <Dialog open title="新建日程" onClose={() => (closed += 1)}>
        内容
      </Dialog>,
    )
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(closed).toBe(1)
    cleanup()
  })

  it('点击遮罩关闭，点击弹窗内部不关闭', () => {
    let closed = 0
    render(
      <Dialog open title="新建日程" onClose={() => (closed += 1)}>
        内容
      </Dialog>,
    )
    fireEvent.mouseDown(screen.getByRole('dialog'))
    expect(closed).toBe(0)
    fireEvent.mouseDown(document.querySelector('.dialog-overlay') as Element)
    expect(closed).toBe(1)
    cleanup()
  })
})

describe('基础组件 · 提示条与空状态', () => {
  it('提示条显示消息与撤销按钮', () => {
    let undone = 0
    render(<Toast message="已添加" actionLabel="撤销" onAction={() => (undone += 1)} />)
    expect(screen.getByRole('status').textContent).toContain('已添加')
    fireEvent.click(screen.getByRole('button', { name: '撤销' }))
    expect(undone).toBe(1)
    cleanup()
  })

  it('空状态显示标题、说明与操作', () => {
    render(
      <EmptyState
        title="还没有任何日程"
        description="从这三步开始"
        actions={<Button variant="primary">先建课程表</Button>}
      />,
    )
    expect(document.body.textContent).toContain('还没有任何日程')
    expect(document.body.textContent).toContain('从这三步开始')
    expect(screen.getByRole('button', { name: '先建课程表' })).toBeTruthy()
    cleanup()
  })
})
