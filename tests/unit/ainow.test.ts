import { describe, expect, it } from '../helpers/expect'
import { formatNowText } from '../../src/renderer/ai/nowText'
import { buildSystemPrompt, buildUserPrompt } from '../../src/renderer/ai/tools'
import { buildEventSystemPrompt } from '../../src/renderer/ai/eventTools'
import type { CoursePromptContext } from '../../src/renderer/ai/types'
import type { Period } from '../../src/shared/entities'

const PERIODS: Period[] = [
  { id: 'p1', name: '第 1 节', startTime: '08:00', endTime: '08:45', orderIndex: 1 },
  { id: 'p2', name: '第 2 节', startTime: '08:55', endTime: '09:40', orderIndex: 2 },
]

// 2026-10-18 是周日；学期 2026-09-07 开学（第 1 周周一）
const NOW = new Date('2026-10-18T14:32:00')
const SEMESTER_START = '2026-09-07'

function context(overrides: Partial<CoursePromptContext> = {}): CoursePromptContext {
  return {
    semesterWeeks: 18,
    periods: PERIODS,
    now: NOW,
    semesterStartDate: SEMESTER_START,
    ...overrides,
  }
}

describe('提示词里的现在时间', () => {
  it('日期 + 星期 + 时刻', () => {
    expect(formatNowText(NOW)).toBe('2026-10-18（周日）14:32')
  })

  it('有学期开始日期时补上第几周与单双周', () => {
    // 9-07 到 10-18 是 41 天 → 第 6 周（41/7 向下取整 + 1）
    const text = formatNowText(NOW, SEMESTER_START)
    expect(text).toContain('2026-10-18（周日）14:32')
    expect(text).toContain('当前是第 6 周')
    expect(text).toContain('双周')
  })

  it('学期还没开始时不算周次', () => {
    expect(formatNowText(NOW, '2026-12-01')).toBe('2026-10-18（周日）14:32')
  })

  it('课程系统提示里带【现在时间】与作业时间表', () => {
    const prompt = buildSystemPrompt(context())
    expect(prompt).toContain('【现在时间】2026-10-18（周日）14:32，当前是第 6 周（双周）')
    expect(prompt).toContain('08:00-08:45')
    expect(prompt).toContain('学期总周数：18')
    // 相对说法以现在时间为准
    expect(prompt).toContain('以【现在时间】为准')
  })

  it('图片那条紧凑规则里也带现在时间', () => {
    const prompt = buildUserPrompt({
      text: '',
      hasImage: true,
      context: context(),
      drafts: [],
    })
    expect(prompt).toContain('【现在时间】2026-10-18（周日）14:32')
  })

  it('日程系统提示同时给出现在时间与今天', () => {
    const prompt = buildEventSystemPrompt({ today: '2026-10-18', now: NOW })
    expect(prompt).toContain('【现在时间】2026-10-18（周日）14:32')
    expect(prompt).toContain('今天是 2026-10-18')
  })

  it('传进来的 now 优先，不会被系统时间覆盖', () => {
    const prompt = buildSystemPrompt(context({ now: new Date('2027-01-05T08:05:00') }))
    expect(prompt).toContain('2027-01-05')
    expect(prompt).toContain('08:05')
  })
})
