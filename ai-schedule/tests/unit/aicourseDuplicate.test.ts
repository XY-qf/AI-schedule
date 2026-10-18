import { describe, expect, it } from '../helpers/expect'
import type { Course, Period } from '../../src/shared/entities'
import {
  createManualDraft,
  findExistingCourse,
  normalizeCourseTitle,
  splitDuplicates,
  weeksOverlap,
  type DraftContext,
} from '../../src/renderer/ai/draft'

const PERIODS: Period[] = [
  { id: 'p1', name: '第 1 节', startTime: '08:00', endTime: '08:45', orderIndex: 1 },
  { id: 'p2', name: '第 2 节', startTime: '08:55', endTime: '09:40', orderIndex: 2 },
  { id: 'p3', name: '第 3 节', startTime: '10:00', endTime: '10:45', orderIndex: 3 },
  { id: 'p4', name: '第 4 节', startTime: '10:55', endTime: '11:40', orderIndex: 4 },
]

const CONTEXT: DraftContext = { semesterWeeks: 18, periods: PERIODS }

function course(overrides: Partial<Course> = {}): Course {
  return {
    id: 'c1',
    semesterId: 's1',
    title: '高等数学',
    teacher: '',
    location: 'A101',
    weekday: 1,
    timeMode: 'period',
    startPeriod: 1,
    endPeriod: 2,
    startTime: null,
    endTime: null,
    weekFrom: 1,
    weekTo: 16,
    oddEven: 'all',
    color: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

function draft(overrides: Parameters<typeof createManualDraft>[1] = {}) {
  return createManualDraft(CONTEXT, { title: '高等数学', weekday: 1, startPeriod: 1, endPeriod: 2, weekFrom: 1, weekTo: 16, ...overrides })
}

describe('重复课程判定', () => {
  it('课名归一化忽略空格、大小写与全角括号', () => {
    expect(normalizeCourseTitle(' 高等 数学 ')).toBe('高等数学')
    expect(normalizeCourseTitle('English(2)')).toBe(normalizeCourseTitle('english（2）'))
  })

  it('周次范围与单双周是否重叠', () => {
    expect(weeksOverlap(1, 16, 'all', 1, 16, 'all')).toBe(true)
    expect(weeksOverlap(1, 8, 'all', 9, 16, 'all')).toBe(false)
    // 同为单周或同为双周，只要范围相交就算重叠
    expect(weeksOverlap(1, 8, 'odd', 3, 12, 'odd')).toBe(true)
    // 一单一双：奇数周与偶数周永远不会同时上，所以不算重叠
    expect(weeksOverlap(1, 8, 'odd', 1, 8, 'even')).toBe(false)
    expect(weeksOverlap(1, 1, 'odd', 2, 2, 'even')).toBe(false)
    // 一方是每周，另一方是单周，范围相交就算
    expect(weeksOverlap(1, 16, 'all', 5, 6, 'odd')).toBe(true)
  })

  it('同名同天同节次同周次 → 判为已存在', () => {
    const hit = findExistingCourse(draft(), [course()], PERIODS)
    expect(hit?.id).toBe('c1')
  })

  it('时段不同不算重复（同一天可以有两门不同的课）', () => {
    expect(findExistingCourse(draft(), [course({ startPeriod: 3, endPeriod: 4 })], PERIODS)).toBeNull()
  })

  it('周次完全错开不算重复', () => {
    expect(
      findExistingCourse(draft({ weekFrom: 1, weekTo: 8 }), [course({ weekFrom: 9, weekTo: 16 })], PERIODS),
    ).toBeNull()
  })

  it('不同星期不算重复', () => {
    expect(findExistingCourse(draft(), [course({ weekday: 3 })], PERIODS)).toBeNull()
  })

  it('按时间下课（clock）也能比对：同一时段算重复', () => {
    const clockCourse = course({
      timeMode: 'clock',
      startPeriod: null,
      endPeriod: null,
      startTime: '08:00',
      endTime: '09:40',
    })
    expect(findExistingCourse(draft(), [clockCourse], PERIODS)?.id).toBe('c1')
  })

  it('结算时把已有课程与批内重复都挑出来', () => {
    const existing = [course()]
    const split = splitDuplicates(
      [
        draft({ title: '高等数学' }), // 与已有重复
        draft({ title: '大学英语', weekday: 3 }), // 正常
        draft({ title: '大学英语', weekday: 3 }), // 与上一条重复
      ],
      existing,
      PERIODS,
    )
    expect(split.keep).toHaveLength(1)
    expect(split.keep[0].title).toBe('大学英语')
    expect(split.existingCount).toBe(1)
    expect(split.innerCount).toBe(1)
    expect(split.duplicates).toHaveLength(2)
  })

  it('全都重复时 keep 为空（界面会提示不用重复添加）', () => {
    const split = splitDuplicates([draft()], [course()], PERIODS)
    expect(split.keep).toHaveLength(0)
    expect(split.existingCount).toBe(1)
  })
})
