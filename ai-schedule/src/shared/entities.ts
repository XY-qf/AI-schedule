import type { Category, EventKind } from './domain'
import { isValidDateString, isValidDateTimeString, isValidTimeString } from './date'

/** 表单校验失败：错误信息是可读中文，界面直接展示。 */
export class ValidationError extends Error {
  constructor(readonly messages: string[]) {
    super(messages.join('；'))
    this.name = 'ValidationError'
  }
}

export const ODD_EVEN = ['all', 'odd', 'even'] as const
export type OddEven = (typeof ODD_EVEN)[number]

export const TIME_MODES = ['period', 'clock'] as const
export type TimeMode = (typeof TIME_MODES)[number]

export const REPEAT_FREQS = ['daily', 'weekly', 'biweekly', 'monthly', 'yearly', 'custom'] as const
export type RepeatFreq = (typeof REPEAT_FREQS)[number]

export const EXCEPTION_ACTIONS = ['modified', 'skipped'] as const
export type ExceptionAction = (typeof EXCEPTION_ACTIONS)[number]

export const COURSE_EXCEPTION_ACTIONS = ['moved', 'cancelled'] as const
export type CourseExceptionAction = (typeof COURSE_EXCEPTION_ACTIONS)[number]

export interface Semester {
  id: string
  name: string
  /** 第 1 周的周一 */
  startDate: string
  weeks: number
  isCurrent: boolean
  createdAt: string
  updatedAt: string
}

export interface SemesterInput {
  name: string
  startDate: string
  weeks: number
  isCurrent?: boolean
}

export interface Period {
  id: string
  name: string
  startTime: string
  endTime: string
  orderIndex: number
}

export interface PeriodInput {
  name: string
  startTime: string
  endTime: string
}

export interface Course {
  id: string
  semesterId: string
  title: string
  teacher: string | null
  location: string | null
  /** 1 = 周一 … 7 = 周日 */
  weekday: number
  timeMode: TimeMode
  startPeriod: number | null
  endPeriod: number | null
  startTime: string | null
  endTime: string | null
  weekFrom: number
  weekTo: number
  oddEven: OddEven
  color: string | null
  createdAt: string
  updatedAt: string
}

export interface CourseInput {
  semesterId: string
  title: string
  teacher?: string | null
  location?: string | null
  weekday: number
  timeMode: TimeMode
  startPeriod?: number | null
  endPeriod?: number | null
  startTime?: string | null
  endTime?: string | null
  weekFrom: number
  weekTo: number
  oddEven: OddEven
  color?: string | null
}

export interface EventItem {
  id: string
  title: string
  category: Category
  kind: EventKind
  /** 时间段：'YYYY-MM-DDTHH:mm'；全天：'YYYY-MM-DD' */
  startAt: string | null
  endAt: string | null
  /** 待办的截止时间 */
  dueAt: string | null
  location: string | null
  people: string | null
  note: string | null
  done: boolean
  recurrenceId: string | null
  createdAt: string
  updatedAt: string
}

export interface EventInput {
  title: string
  category: Category
  kind: EventKind
  startAt?: string | null
  endAt?: string | null
  dueAt?: string | null
  location?: string | null
  people?: string | null
  note?: string | null
  recurrenceId?: string | null
}

export const DEFAULT_WEEKS = 18

/** 常见作息：45 分钟一节，课间 10 分钟。 */
export const DEFAULT_PERIODS: PeriodInput[] = [
  { name: '第 1 节', startTime: '08:00', endTime: '08:45' },
  { name: '第 2 节', startTime: '08:55', endTime: '09:40' },
  { name: '第 3 节', startTime: '10:00', endTime: '10:45' },
  { name: '第 4 节', startTime: '10:55', endTime: '11:40' },
  { name: '第 5 节', startTime: '14:00', endTime: '14:45' },
  { name: '第 6 节', startTime: '14:55', endTime: '15:40' },
  { name: '第 7 节', startTime: '16:00', endTime: '16:45' },
  { name: '第 8 节', startTime: '16:55', endTime: '17:40' },
  { name: '第 9 节', startTime: '19:00', endTime: '19:45' },
  { name: '第 10 节', startTime: '19:55', endTime: '20:40' },
  { name: '第 11 节', startTime: '20:50', endTime: '21:35' },
  { name: '第 12 节', startTime: '21:45', endTime: '22:30' },
]

function empty(value: string | null | undefined): boolean {
  return value === null || value === undefined || value.trim() === ''
}

/** 日程字段校验（PRD 9.9）。返回全部错误，界面可一次展示。 */
export function validateEventInput(input: EventInput): string[] {
  const errors: string[] = []
  if (empty(input.title)) errors.push('请填写标题')

  if (input.kind === 'timed') {
    const { startAt, endAt } = input
    if (!startAt || !isValidDateTimeString(startAt) || !endAt || !isValidDateTimeString(endAt)) {
      errors.push('请填写开始与结束时间')
    } else if (endAt <= startAt) {
      errors.push('结束时间要晚于开始时间')
    }
  } else if (input.kind === 'allDay') {
    const { startAt, endAt } = input
    if (!startAt || !isValidDateString(startAt) || !endAt || !isValidDateString(endAt)) {
      errors.push('请选择起止日期')
    } else if (endAt < startAt) {
      errors.push('结束日期不能早于开始日期')
    }
  } else if (input.kind === 'startOnly') {
    const { startAt } = input
    if (!startAt || !isValidDateTimeString(startAt)) {
      errors.push('请选择开始时间')
    }
  } else if (input.kind === 'todo') {
    const { dueAt } = input
    if (!dueAt) {
      errors.push('请选择截止日期')
    } else if (!isValidDateString(dueAt) && !isValidDateTimeString(dueAt)) {
      errors.push('截止日期格式不正确')
    }
  }
  return errors
}

export function validateSemesterInput(input: SemesterInput): string[] {
  const errors: string[] = []
  if (empty(input.name)) errors.push('请填写学期名称')
  if (!isValidDateString(input.startDate)) errors.push('请选择开学日期')
  if (!Number.isInteger(input.weeks) || input.weeks < 1 || input.weeks > 60) {
    errors.push('总周数需在 1 到 60 之间')
  }
  return errors
}

export function validatePeriodInput(input: PeriodInput): string[] {
  const errors: string[] = []
  if (empty(input.name)) errors.push('请填写节次名称')
  if (!isValidTimeString(input.startTime) || !isValidTimeString(input.endTime)) {
    errors.push('请检查作息时间')
  } else if (input.startTime >= input.endTime) {
    errors.push('请检查作息时间')
  }
  return errors
}

export function validateCourseInput(input: CourseInput): string[] {
  const errors: string[] = []
  if (empty(input.title)) errors.push('请填写课名')
  if (!Number.isInteger(input.weekday) || input.weekday < 1 || input.weekday > 7) {
    errors.push('请选择星期')
  }
  if (!Number.isInteger(input.weekFrom) || !Number.isInteger(input.weekTo) || input.weekFrom < 1 || input.weekTo < input.weekFrom) {
    errors.push('请填写正确的周次范围')
  }
  if (input.timeMode === 'period') {
    if (
      !Number.isInteger(input.startPeriod ?? NaN) ||
      !Number.isInteger(input.endPeriod ?? NaN) ||
      (input.startPeriod ?? 0) < 1 ||
      (input.endPeriod ?? 0) < (input.startPeriod ?? 0)
    ) {
      errors.push('请填写课名与上课时间')
    }
  } else {
    if (
      !input.startTime ||
      !input.endTime ||
      !isValidTimeString(input.startTime) ||
      !isValidTimeString(input.endTime) ||
      input.startTime >= input.endTime
    ) {
      errors.push('请填写课名与上课时间')
    }
  }
  return errors
}
