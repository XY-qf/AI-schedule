import type { Course, CourseInput, OddEven, Period } from '../../shared/entities'
import { describeCourseTime, describeCourseWeeks } from '../../shared/courseUi'
import { courseTimes } from '../../shared/courseSchedule'
import type { DraftCourse } from './types'

/** 界面文案用的星期名。 */
export const WEEKDAY_LABEL = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'] as const

export const ODD_EVEN_TEXT: Record<OddEven, string> = {
  all: '每周',
  odd: '单周',
  even: '双周',
}

let keySeed = 0

/** 草稿的稳定 key（只用于 React 列表与定位，不写库）。 */
export function nextDraftKey(): string {
  keySeed += 1
  return `draft-${keySeed}`
}

export interface DraftContext {
  /** 学期总周数，用来解释「全学期」 */
  semesterWeeks: number
  /** 作息时间表 */
  periods: Period[]
}

/* ------------------------------------------------------------------ */
/* 字段归一化：模型可能给数字、中文、范围字符串，都要能吃下去          */
/* ------------------------------------------------------------------ */

const CN_DIGITS: Record<string, number> = {
  一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10,
  十一: 11, 十二: 12,
}

/** 星期：1-7、'周一'、'星期一'、'礼拜三'、'Mon'、'星期日' 都接受。 */
export function normalizeWeekday(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    const day = Math.trunc(value)
    return day >= 1 && day <= 7 ? day : null
  }
  if (typeof value !== 'string') return null
  const text = value.trim().toLowerCase().replace(/\s+/g, '')
  if (!text) return null

  const english = text.match(/(mon|tue|wed|thu|fri|sat|sun)/)
  if (english) {
    return ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].indexOf(english[1]) + 1
  }

  const cn = text.match(/[一二三四五六日天]/)
  if (cn) {
    if (cn[0] === '天') return 7
    return ['一', '二', '三', '四', '五', '六', '日'].indexOf(cn[0]) + 1
  }

  const digit = text.match(/[1-7]/)
  if (digit) return Number(digit[0])
  return null
}

/** 从一段文字里抽出所有数字（支持 1-2、1~2、第1、2节、1,2 等写法）。 */
export function extractNumbers(value: unknown): number[] {
  if (typeof value === 'number' && Number.isFinite(value)) return [Math.trunc(value)]
  if (Array.isArray(value)) return value.flatMap((item) => extractNumbers(item))
  if (typeof value !== 'string') return []

  const numbers: number[] = []
  const pattern = /\d+|[一二三四五六七八九十]{1,3}/g
  let match: RegExpExecArray | null
  while ((match = pattern.exec(value)) !== null) {
    const token = match[0]
    if (/^\d+$/.test(token)) {
      numbers.push(Number(token))
    } else if (CN_DIGITS[token] !== undefined) {
      numbers.push(CN_DIGITS[token])
    }
  }
  return numbers
}

/** 节次范围：容忍 '第1-2节'、'1~4'、[1,2]、'3,4'。 */
export function normalizePeriodRange(
  startValue: unknown,
  endValue: unknown,
  maxPeriod: number,
): { start: number; end: number } | null {
  const startNumbers = extractNumbers(startValue)
  const endNumbers = extractNumbers(endValue)
  const pool = [...startNumbers, ...endNumbers].filter((item) => item >= 1)
  if (pool.length === 0) return null

  const start = Math.min(...pool)
  let end = Math.max(...pool)
  if (end < start) end = start
  if (maxPeriod > 0 && start > maxPeriod) return null
  if (maxPeriod > 0 && end > maxPeriod) end = maxPeriod
  return { start, end }
}

/** 周次范围：「1-16 周」「全学期」「1~8」「3」都能理解。 */
export function normalizeWeeks(
  fromValue: unknown,
  toValue: unknown,
  maxWeeks: number,
  fallbackFrom = 1,
): { from: number; to: number } {
  const text = `${String(fromValue ?? '')} ${String(toValue ?? '')}`
  const weeks = Math.max(1, Math.trunc(maxWeeks || 1))
  if (/全学期|整学期|整个学期|所有周|全部周/.test(text)) {
    return { from: 1, to: weeks }
  }

  const numbers = extractNumbers([fromValue, toValue]).filter((item) => item >= 1)
  if (numbers.length === 0) {
    return { from: clamp(fallbackFrom, 1, weeks), to: weeks }
  }
  let from = Math.min(...numbers)
  let to = Math.max(...numbers)
  if (from > weeks) from = weeks
  if (to > weeks) to = weeks
  if (to < from) to = from
  return { from, to }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

/** 单双周：'单周'/'odd'/'1'，'双周'/'even'/'2'。 */
export function normalizeOddEven(value: unknown): OddEven | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null
  const text = String(value).trim().toLowerCase()
  if (!text) return null
  if (/单|odd|[^0-9]1$/.test(text)) return 'odd'
  if (/双|even|[^0-9]2$/.test(text)) return 'even'
  if (/每周|全部|all|both|每周都有/.test(text)) return 'all'
  return null
}

/** 时间点：'8:00'、'08：00'、'8点30'、'08:00:00' 统一成 HH:mm。 */
export function normalizeClock(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const text = value.trim()
  if (!text) return null
  const colon = text.match(/(\d{1,2})[:：](\d{2})/)
  if (colon) {
    const hour = Number(colon[1])
    const minute = Number(colon[2])
    if (hour > 23 || minute > 59) return null
    return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
  }
  const cn = text.match(/(\d{1,2})\s*[点时](?:\s*(\d{1,2})\s*分?)?/)
  if (cn) {
    const hour = Number(cn[1])
    const minute = cn[2] ? Number(cn[2]) : 0
    if (hour > 23 || minute > 59) return null
    return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
  }
  return null
}

/* ------------------------------------------------------------------ */
/* 从工具调用参数里读出一门课                                          */
/* ------------------------------------------------------------------ */

function pick(raw: Record<string, unknown>, keys: readonly string[]): unknown {
  for (const key of keys) {
    if (raw[key] !== undefined && raw[key] !== null && raw[key] !== '') return raw[key]
  }
  return undefined
}

function asText(value: unknown): string {
  if (typeof value === 'string') return value.trim()
  if (typeof value === 'number') return String(value)
  return ''
}

interface ParsedFields {
  title: string
  teacher: string
  location: string
  weekday: number | null
  startPeriod: number | null
  endPeriod: number | null
  startTime: string | null
  endTime: string | null
  weekFrom: number | null
  weekTo: number | null
  oddEven: OddEven | null
}

const TITLE_KEYS = ['title', 'name', 'course', 'courseName', '课名', '课程', '课程名', '名称', '科目'] as const
const TEACHER_KEYS = ['teacher', 'instructor', '老师', '教师', '任课教师', '授课教师'] as const
const LOCATION_KEYS = ['location', 'room', 'place', 'venue', '地点', '教室', '上课地点', '上课教室'] as const
const WEEKDAY_KEYS = ['weekday', 'weekDay', 'day', 'week', '星期', '周几', '星期几', '上课星期', '上课日'] as const
const START_PERIOD_KEYS = ['startPeriod', 'period', 'start', 'from', '开始节次', '节次', '起始节次', '开始节', '第几节'] as const
const END_PERIOD_KEYS = ['endPeriod', 'to', '结束节次', '结束节', '结束'] as const
const START_TIME_KEYS = ['startTime', 'beginTime', '开始时间', '上课时间', '起始时间'] as const
const END_TIME_KEYS = ['endTime', 'finishTime', '结束时间', '下课时间', '终止时间'] as const
const TIME_TEXT_KEYS = ['time', 'timeRange', '节次', '上课时间', '时间段'] as const
const WEEK_FROM_KEYS = ['weekFrom', 'startWeek', 'fromWeek', 'beginWeek', '起始周', '开始周'] as const
const WEEK_TO_KEYS = ['weekTo', 'endWeek', 'toWeek', '结束周', '结束周次', '截止周'] as const
const WEEKS_TEXT_KEYS = ['weeks', 'weekRange', '周次', '周数', '上课周次'] as const
const ODD_EVEN_KEYS = ['oddEven', 'odd_even', 'weekType', '单双周', '周类型', '单双周次'] as const

/** 把模型给的对象（可能是英文键，也可能是中文键）解析成统一字段。 */
export function readCourseFields(raw: unknown, context: DraftContext): ParsedFields {
  const source = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const maxPeriod = context.periods.length > 0
    ? Math.max(...context.periods.map((item) => item.orderIndex))
    : 12

  const title = asText(pick(source, TITLE_KEYS))
  const teacher = asText(pick(source, TEACHER_KEYS))
  const location = asText(pick(source, LOCATION_KEYS))
  const weekday = normalizeWeekday(pick(source, WEEKDAY_KEYS))

  const timeText = pick(source, TIME_TEXT_KEYS)
  const clockRange = typeof timeText === 'string'
    ? timeText.match(/(\d{1,2})[:：](\d{2})\s*[-–~至到]\s*(\d{1,2})[:：](\d{2})/)
    : null

  let startTime = normalizeClock(pick(source, START_TIME_KEYS))
  let endTime = normalizeClock(pick(source, END_TIME_KEYS))
  if (clockRange) {
    startTime = startTime ?? normalizeClock(`${clockRange[1]}:${clockRange[2]}`)
    endTime = endTime ?? normalizeClock(`${clockRange[3]}:${clockRange[4]}`)
  }

  let periodRange = normalizePeriodRange(
    pick(source, START_PERIOD_KEYS),
    pick(source, END_PERIOD_KEYS),
    maxPeriod,
  )
  if (!periodRange && !clockRange && typeof timeText === 'string' && startTime === null) {
    // 「第 1-2 节」这类只给了 time 文本的情况
    periodRange = normalizePeriodRange(timeText, timeText, maxPeriod)
  }

  const weekRange = normalizeWeeks(
    pick(source, WEEK_FROM_KEYS) ?? pick(source, WEEKS_TEXT_KEYS),
    pick(source, WEEK_TO_KEYS) ?? pick(source, WEEKS_TEXT_KEYS),
    context.semesterWeeks,
  )
  const hasWeekInput =
    pick(source, WEEK_FROM_KEYS) !== undefined ||
    pick(source, WEEK_TO_KEYS) !== undefined ||
    pick(source, WEEKS_TEXT_KEYS) !== undefined

  return {
    title,
    teacher,
    location,
    weekday,
    startPeriod: periodRange ? periodRange.start : null,
    endPeriod: periodRange ? periodRange.end : null,
    startTime,
    endTime,
    weekFrom: hasWeekInput ? weekRange.from : null,
    weekTo: hasWeekInput ? weekRange.to : null,
    oddEven: normalizeOddEven(pick(source, ODD_EVEN_KEYS)),
  }
}

/** 从任意对象里造出一门草稿课；没有课名就返回 null（当噪声丢掉）。 */
export function draftFromRaw(raw: unknown, context: DraftContext): DraftCourse | null {
  const fields = readCourseFields(raw, context)
  if (!fields.title) return null
  return buildDraft(fields, context, nextDraftKey())
}

function buildDraft(fields: ParsedFields, context: DraftContext, key: string): DraftCourse {
  const maxPeriod = context.periods.length > 0
    ? Math.max(...context.periods.map((item) => item.orderIndex))
    : 12
  const fallbackWeeks = normalizeWeeks(null, null, context.semesterWeeks)

  const useClock = fields.startPeriod === null && fields.startTime !== null && fields.endTime !== null
  const periodStart = fields.startPeriod ?? 1
  const periodEnd = Math.max(periodStart, fields.endPeriod ?? periodStart)

  const needsReview =
    fields.weekday === null ||
    (fields.startPeriod === null && (fields.startTime === null || fields.endTime === null))

  return {
    key,
    title: fields.title,
    teacher: fields.teacher,
    location: fields.location,
    weekday: fields.weekday ?? 1,
    timeMode: useClock ? 'clock' : 'period',
    startPeriod: clamp(periodStart, 1, maxPeriod),
    endPeriod: clamp(periodEnd, 1, maxPeriod),
    startTime: fields.startTime ?? '08:00',
    endTime: fields.endTime ?? '09:40',
    weekFrom: fields.weekFrom ?? fallbackWeeks.from,
    weekTo: fields.weekTo ?? fallbackWeeks.to,
    oddEven: fields.oddEven ?? 'all',
    needsReview,
  }
}

/** 手动新建一门空草稿（用户直接点「加一行」时用）。 */
export function createManualDraft(context: DraftContext, defaults?: Partial<DraftCourse>): DraftCourse {
  const fields = readCourseFields({ title: '新课程' }, context)
  return { ...buildDraft(fields, context, nextDraftKey()), needsReview: true, ...defaults }
}

/* ------------------------------------------------------------------ */
/* 草稿 ↔ 课程实体                                                     */
/* ------------------------------------------------------------------ */

export function draftToCourse(draft: DraftCourse): Course {
  return {
    id: draft.key,
    semesterId: '',
    title: draft.title,
    teacher: draft.teacher || null,
    location: draft.location || null,
    weekday: draft.weekday,
    timeMode: draft.timeMode,
    startPeriod: draft.timeMode === 'period' ? draft.startPeriod : null,
    endPeriod: draft.timeMode === 'period' ? draft.endPeriod : null,
    startTime: draft.timeMode === 'clock' ? draft.startTime : null,
    endTime: draft.timeMode === 'clock' ? draft.endTime : null,
    weekFrom: draft.weekFrom,
    weekTo: draft.weekTo,
    oddEven: draft.oddEven,
    color: null,
    createdAt: '',
    updatedAt: '',
  }
}

export function draftToCourseInput(draft: DraftCourse, semesterId: string): CourseInput {
  const course = draftToCourse(draft)
  return {
    semesterId,
    title: course.title,
    teacher: course.teacher,
    location: course.location,
    weekday: course.weekday,
    timeMode: course.timeMode,
    startPeriod: course.startPeriod,
    endPeriod: course.endPeriod,
    startTime: course.startTime,
    endTime: course.endTime,
    weekFrom: course.weekFrom,
    weekTo: course.weekTo,
    oddEven: course.oddEven,
  }
}

/** 用户在弹窗里改完一门草稿后回填。 */
export function draftFromCourseInput(input: CourseInput, key: string): DraftCourse {
  return {
    key,
    title: input.title.trim(),
    teacher: input.teacher?.trim() ?? '',
    location: input.location?.trim() ?? '',
    weekday: input.weekday,
    timeMode: input.timeMode,
    startPeriod: input.startPeriod ?? 1,
    endPeriod: input.endPeriod ?? input.startPeriod ?? 1,
    startTime: input.startTime ?? '08:00',
    endTime: input.endTime ?? '09:40',
    weekFrom: input.weekFrom,
    weekTo: input.weekTo,
    oddEven: input.oddEven,
    needsReview: false,
  }
}

export interface DraftSummary {
  title: string
  time: string
  weeks: string
  detail: string
}

/** 列表里那一行的人话描述。 */
export function summarizeDraft(draft: DraftCourse, periods: Period[]): DraftSummary {
  const course = draftToCourse(draft)
  const time = describeCourseTime(course, periods)
  const weeks = describeCourseWeeks(course)
  const extras = [draft.teacher, draft.location].filter(Boolean).join(' · ')
  return {
    title: `${WEEKDAY_LABEL[draft.weekday - 1] ?? '周一'} ${draft.title}`,
    time,
    weeks,
    detail: extras,
  }
}

/* ------------------------------------------------------------------ */
/* 重复课程判定：模型不知道课表里已经有什么，所以入库前自己再拦一道     */
/* ------------------------------------------------------------------ */

/** 课名比较用的归一化：去掉所有空白、统一大小写、全角括号转半角。 */
export function normalizeCourseTitle(title: string): string {
  return String(title ?? '')
    .replace(/\s+/g, '')
    .replace(/[（]/g, '(')
    .replace(/[）]/g, ')')
    .toLowerCase()
}

/** 两段周次（含单双周）是否有共同的一周。 */
export function weeksOverlap(
  aFrom: number,
  aTo: number,
  aOdd: OddEven,
  bFrom: number,
  bTo: number,
  bOdd: OddEven,
): boolean {
  const from = Math.max(aFrom, bFrom)
  const to = Math.min(aTo, bTo)
  if (from > to) return false
  if (aOdd === bOdd) return true
  if (aOdd === 'all' || bOdd === 'all') return true
  // 一单一双：范围内只要有一周两边都上，就算重叠
  for (let week = from; week <= to; week += 1) {
    const aOk = week % 2 === (aOdd === 'odd' ? 1 : 0)
    const bOk = week % 2 === (bOdd === 'odd' ? 1 : 0)
    if (aOk && bOk) return true
  }
  return false
}

function sameSlot(
  a: { startTime: string; endTime: string } | null,
  b: { startTime: string; endTime: string } | null,
): boolean {
  if (!a || !b) return false
  return a.startTime === b.startTime && a.endTime === b.endTime
}

/** 这门草稿是不是已经在课表里了；返回撞上的那门课。 */
export function findExistingCourse(
  draft: DraftCourse,
  existing: Course[],
  periods: Period[],
): Course | null {
  const title = normalizeCourseTitle(draft.title)
  if (!title) return null
  const slot = courseTimes(draftToCourse(draft), periods)
  if (!slot) return null
  for (const course of existing) {
    if (normalizeCourseTitle(course.title) !== title) continue
    if (course.weekday !== draft.weekday) continue
    if (!sameSlot(courseTimes(course, periods), slot)) continue
    if (
      !weeksOverlap(
        draft.weekFrom,
        draft.weekTo,
        draft.oddEven,
        course.weekFrom,
        course.weekTo,
        course.oddEven,
      )
    ) {
      continue
    }
    return course
  }
  return null
}

export interface DuplicateSplit {
  /** 可以入库的 */
  keep: DraftCourse[]
  /** 被判定重复的，以及撞上的已有课程（互相重复时为 null） */
  duplicates: Array<{ draft: DraftCourse; existing: Course | null }>
  /** 与已有课程重复的数量 */
  existingCount: number
  /** 自己内部重复的数量 */
  innerCount: number
}

/**
 * 结算前过滤：既去掉"课表里已经有了"的，也去掉"这一批自己重复"的。
 * 同名 + 同一天 + 同一时段 + 周次有重叠 才算重复，不同时段不算。
 */
export function splitDuplicates(
  drafts: DraftCourse[],
  existing: Course[],
  periods: Period[],
): DuplicateSplit {
  const keep: DraftCourse[] = []
  const duplicates: DuplicateSplit['duplicates'] = []
  let existingCount = 0
  let innerCount = 0
  for (const draft of drafts) {
    const hit = findExistingCourse(draft, existing, periods)
    if (hit) {
      existingCount += 1
      duplicates.push({ draft, existing: hit })
      continue
    }
    const innerHit = findExistingCourse(draft, keep.map(draftToCourse), periods)
    if (innerHit) {
      innerCount += 1
      duplicates.push({ draft, existing: null })
      continue
    }
    keep.push(draft)
  }
  return { keep, duplicates, existingCount, innerCount }
}

/* ------------------------------------------------------------------ */
/* 工具调用 → 修改草稿列表                                             */
/* ------------------------------------------------------------------ */

export type DraftToolName =
  | 'add_courses'
  | 'add_course'
  | 'update_course'
  | 'remove_course'
  | 'clear_courses'

/** 模型可能写成 addCourses / add_courses / add-course，统一成固定名字。 */
export function normalizeToolName(name: string): DraftToolName | null {
  const text = String(name ?? '').toLowerCase().replace(/[^a-z]/g, '')
  if (!text) return null
  if (text === 'addcourses' || text === 'addcourselist' || text === 'bulkaddcourses' || text === 'createcourses') {
    return 'add_courses'
  }
  if (text === 'addcourse' || text === 'createcourse' || text === 'addschedule' || text === 'newcourse') {
    return 'add_course'
  }
  if (text === 'updatecourse' || text === 'editcourse' || text === 'modifycourse' || text === 'changecourse') {
    return 'update_course'
  }
  if (text === 'removecourse' || text === 'deletecourse' || text === 'dropcourse') {
    return 'remove_course'
  }
  if (text === 'clearcourses' || text === 'cleardraft' || text === 'resetcourses' || text === 'clearlist') {
    return 'clear_courses'
  }
  return null
}

/** 从工具参数里取出「一组课」：数组本身、courses/items/list 字段，或单门课。 */
export function extractCourseList(input: unknown): unknown[] {
  if (Array.isArray(input)) return input
  if (!input || typeof input !== 'object') return []
  const record = input as Record<string, unknown>
  for (const key of ['courses', 'items', 'list', 'courseList', 'data', '课程', '课程列表', '结果']) {
    const value = record[key]
    if (Array.isArray(value)) return value
  }
  const keys = Object.keys(record)
  if (keys.length === 1 && Array.isArray(record[keys[0]])) return record[keys[0]] as unknown[]
  if (keys.some((key) => TITLE_KEYS.includes(key as (typeof TITLE_KEYS)[number]))) return [input]
  return []
}

function readIndex(input: unknown): number | null {
  if (!input || typeof input !== 'object') return null
  const record = input as Record<string, unknown>
  const raw = record.index ?? record.idx ?? record.position ?? record.number ?? record.no ?? record.序号 ?? record.第几条
  if (typeof raw === 'number' && Number.isFinite(raw)) return Math.trunc(raw)
  if (typeof raw === 'string') {
    const numbers = extractNumbers(raw)
    if (numbers.length > 0) return numbers[0]
  }
  return null
}

function sameCourse(a: DraftCourse, b: DraftCourse): boolean {
  return (
    a.title === b.title &&
    a.weekday === b.weekday &&
    a.timeMode === b.timeMode &&
    (a.timeMode === 'period'
      ? a.startPeriod === b.startPeriod && a.endPeriod === b.endPeriod
      : a.startTime === b.startTime && a.endTime === b.endTime) &&
    a.weekFrom === b.weekFrom &&
    a.weekTo === b.weekTo &&
    a.oddEven === b.oddEven
  )
}

const MAX_DRAFTS = 80

export interface ApplyResult {
  drafts: DraftCourse[]
  /** 给界面日志用的一句话；没有变化时为 null */
  message: string | null
}

/**
 * 把一次工具调用落到草稿列表上。
 *
 * 所有字段都在这里做归一化和兜底：2B 模型输出不一定规范，
 * 宁可把明显的错误挡在「草稿」阶段，也不要写进数据库。
 */
export function applyDraftToolCall(
  drafts: DraftCourse[],
  name: string,
  input: unknown,
  context: DraftContext,
): ApplyResult {
  const tool = normalizeToolName(name)
  if (!tool) {
    return { drafts, message: null }
  }

  if (tool === 'clear_courses') {
    return { drafts: [], message: '已清空编辑界面里的课程' }
  }

  if (tool === 'add_courses' || tool === 'add_course') {
    const list = tool === 'add_course' ? (Array.isArray(input) ? input : [input]) : extractCourseList(input)
    const next = [...drafts]
    let added = 0
    let skipped = 0
    for (const raw of list) {
      if (next.length >= MAX_DRAFTS) break
      const draft = draftFromRaw(raw, context)
      if (!draft) {
        skipped += 1
        continue
      }
      if (next.some((item) => sameCourse(item, draft))) {
        skipped += 1
        continue
      }
      next.push(draft)
      added += 1
    }
    if (added === 0) {
      return {
        drafts,
        message: skipped > 0 ? '没有识别出可用的课程（缺少课名？）' : null,
      }
    }
    return {
      drafts: next,
      message: `已加入 ${added} 门课程${skipped > 0 ? `（跳过 ${skipped} 条重复或无效）` : ''}`,
    }
  }

  if (tool === 'remove_course') {
    const index = readIndex(input)
    const title = asText(
      input && typeof input === 'object'
        ? pick(input as Record<string, unknown>, TITLE_KEYS)
        : undefined,
    )
    const targetIndex = resolveTargetIndex(drafts, index, title)
    if (targetIndex === null) {
      return { drafts, message: '没找到要删除的课程' }
    }
    const next = drafts.filter((_, position) => position !== targetIndex)
    return { drafts: next, message: `已删除「${drafts[targetIndex].title}」` }
  }

  // update_course
  const index = readIndex(input)
  const raw = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>
  const title = asText(pick(raw, TITLE_KEYS))
  const targetIndex = resolveTargetIndex(drafts, index, title)
  if (targetIndex === null) {
    return { drafts, message: '没找到要修改的课程' }
  }
  const current = drafts[targetIndex]
  const fields = readCourseFields(raw, context)
  const merged = mergeDraft(current, fields, context)
  const next = drafts.map((item, position) => (position === targetIndex ? merged : item))
  return { drafts: next, message: `已修改「${merged.title}」` }
}

function resolveTargetIndex(drafts: DraftCourse[], index: number | null, title: string): number | null {
  if (index !== null) {
    const position = index >= 1 ? index - 1 : 0
    if (position >= 0 && position < drafts.length) return position
  }
  if (title) {
    const byTitle = drafts.findIndex((item) => item.title === title)
    if (byTitle >= 0) return byTitle
  }
  if (index === null && !title) return drafts.length > 0 ? 0 : null
  return null
}

/** 只覆盖模型真正给出的字段，没给的一律保留原值。 */
function mergeDraft(current: DraftCourse, fields: ParsedFields, context: DraftContext): DraftCourse {
  const maxPeriod = context.periods.length > 0
    ? Math.max(...context.periods.map((item) => item.orderIndex))
    : 12
  const next: DraftCourse = { ...current }
  if (fields.title) next.title = fields.title
  if (fields.teacher) next.teacher = fields.teacher
  if (fields.location) next.location = fields.location
  if (fields.weekday !== null) next.weekday = fields.weekday
  if (fields.weekFrom !== null) next.weekFrom = fields.weekFrom
  if (fields.weekTo !== null) next.weekTo = fields.weekTo
  if (fields.oddEven !== null) next.oddEven = fields.oddEven

  if (fields.startPeriod !== null) {
    next.timeMode = 'period'
    next.startPeriod = clamp(fields.startPeriod, 1, maxPeriod)
    next.endPeriod = clamp(fields.endPeriod ?? fields.startPeriod, next.startPeriod, maxPeriod)
  } else if (fields.startTime !== null && fields.endTime !== null) {
    next.timeMode = 'clock'
    next.startTime = fields.startTime
    next.endTime = fields.endTime
  }

  next.needsReview =
    next.weekday < 1 ||
    (next.timeMode === 'period' && (next.startPeriod < 1 || next.endPeriod < next.startPeriod))
  return next
}
