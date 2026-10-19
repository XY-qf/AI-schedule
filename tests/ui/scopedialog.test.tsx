import { describe, expect, it } from '../helpers/expect'
import { cleanup, fireEvent, render, screen } from '../helpers/ui'
import { ScopeDialog } from '../../src/renderer/components/ScopeDialog'
import type { RecurrenceScope } from '../../src/shared/recurrence'

function renderScope(props: Partial<Parameters<typeof ScopeDialog>[0]> = {}) {
  const picked: RecurrenceScope[] = []
  const calls: string[] = []
  render(
    <ScopeDialog
      open
      title="这次修改要应用到哪些日程？"
      onSelect={(scope) => picked.push(scope)}
      onClose={() => calls.push('close')}
      {...props}
    />,
  )
  return { picked, calls }
}

describe('重复日程三选一', () => {
  it('三个选项都渲染，并带说明文字', () => {
    renderScope()
    expect(screen.getByTestId('scope-single').textContent).toContain('仅这一次')
    expect(screen.getByTestId('scope-single').textContent).toContain('只改这一天')
    expect(screen.getByTestId('scope-following').textContent).toContain('这一次及以后')
    expect(screen.getByTestId('scope-all').textContent).toContain('全部')
    expect(screen.getByTestId('scope-all').textContent).toContain('整个系列一起改')
    cleanup()
  })

  it('默认选中「仅这一次」，直接确定就按它处理', () => {
    const { picked } = renderScope()
    expect((screen.getByTestId('scope-single').querySelector('input') as HTMLInputElement).checked).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: '确定' }))
    expect(picked).toEqual(['single'])
    cleanup()
  })

  it('选「这一次及以后」后确定', () => {
    const { picked } = renderScope()
    fireEvent.click(screen.getByTestId('scope-following').querySelector('input') as Element)
    fireEvent.click(screen.getByRole('button', { name: '确定' }))
    expect(picked).toEqual(['following'])
    cleanup()
  })

  it('选「全部」后确定', () => {
    const { picked } = renderScope()
    fireEvent.click(screen.getByTestId('scope-all').querySelector('input') as Element)
    fireEvent.click(screen.getByRole('button', { name: '确定' }))
    expect(picked).toEqual(['all'])
    cleanup()
  })

  it('删除场景用红色按钮与「删除」文案', () => {
    renderScope({ title: '删除重复日程', confirmLabel: '删除', danger: true })
    const button = screen.getByRole('button', { name: '删除' })
    expect(button.className).toContain('btn--danger')
    cleanup()
  })

  it('取消不回调选择', () => {
    const { picked, calls } = renderScope()
    fireEvent.click(screen.getByRole('button', { name: '取消' }))
    expect(picked).toEqual([])
    expect(calls).toEqual(['close'])
    cleanup()
  })
})
