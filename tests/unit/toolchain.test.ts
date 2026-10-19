import { describe, expect, it } from '../helpers/expect'
import { CATEGORIES, CATEGORY_LABEL, isCategory, isEventKind } from '../../src/shared/domain'

describe('工具链自检（M0 前置）', () => {
  it('三类日程定义完整', () => {
    expect(CATEGORIES).toEqual(['course', 'activity', 'life'])
    expect(CATEGORY_LABEL.course).toBe('课内')
    expect(CATEGORY_LABEL.activity).toBe('课外活动')
    expect(CATEGORY_LABEL.life).toBe('个人生活')
  })

  it('类型守卫能挡住非法值', () => {
    expect(isCategory('course')).toBe(true)
    expect(isCategory('unknown')).toBe(false)
    expect(isCategory(null)).toBe(false)
    expect(isEventKind('timed')).toBe(true)
    expect(isEventKind('weekly')).toBe(false)
  })
})
