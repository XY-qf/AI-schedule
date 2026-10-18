import type { EventInput, EventItem } from '../../shared/entities'
import { validateEventInput } from '../../shared/entities'
import { addDays, formatChineseDate, isValidDateString, parseDate } from '../../shared/date'
import type { DraftEvent, DraftRepeat } from './types'
import { extractNumbers, nextDraftKey, normalizeClock } from './draft'

/**
 * 日程草稿：与课程草稿同一套思路——模型只改"待确认列表"，用户确认后才入库。
 */

export interface EventDraftContext {
  /** 今天，'YYYY-MM-DD'，用来解释"明天""3月4日"这类相对说法 */
  today: string
  /** 当前时间：提示词里要写成"现在时间"（含星期与时刻） */
  now?: Date
}

export const EVENT_KIND_LABEL: Record<DraftEvent['kind'], string> = {
  timed: '时间段',
  allDay: '全天',
  startOnly: '只有开始时间',
  todo: '只有截止时间',
}

export const EVENT_CATEGORY_LABEL: Record<DraftEvent['category'], string> = {
  course: '课内',
  activity: '课外活动',
  life: '个人生活',
}

function pad(value: number): string {
  return String(value).padStart(2, '0')
}

function dateKey(year: number, month: number, day: number): string | null {
  const text = `${year}-${pad(month)}-${pad(day)}`
  return isValidDateString(text) ? text : null
}

/** 把模型给的一句话时间解析成 { 日期, 时刻 }。 */
export function normalizeDateTimeText(
  value: unknown,
  context: EventDraftContext,
): { date: string | null; time: string | null } {
  const text = String(value ?? '').trim()
  if (!text) return { date: null, time: null }

  const base = parseDate(context.today)
  let date: string | null = null

  // 相对说法
  const relative: Array<[RegExp, number]> = [
    [/大后天/, 3],
    [/后天/, 2],
    [/明天|明日/, 1],
    [/今天|今日|今晚/, 0],
    [/昨天|昨日/, -1],
  ]
  for (const [pattern, offset] of relative) {
    if (pattern.test(text)) {
      date = `${addDays(base, offset).getFullYear()}-${pad(addDays(base, offset).getMonth() + 1)}-${pad(addDays(base, offset).getDate())}`
      break
    }
  }

  if (!date) {
    const full = /(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})/.exec(text)
    if (full) {
      date = dateKey(Number(full[1]), Number(full[2]), Number(full[3]))
    }
  }
  if (!date) {
    const monthDay = /(\d{1,2})\s*[月/-]\s*(\d{1,2})/.exec(text)
    if (monthDay) {
      date = dateKey(base.getFullYear(), Number(monthDay[1]), Number(monthDay[2]))
    }
  }
  if (!date) {
    const justDay = /(?:^|\D)(\d{1,2})\s*[日号]/.exec(text)
    const month = /(\d{1,2})\s*月/.exec(text)
    if (justDay && month) {
      date = dateKey(base.getFullYear(), Number(month[1]), Number(justDay[1]))
    }
  }

  const time = normalizeClock(text)
  return { date, time }
}

/** 类别：中文/英文都能认。 */
export function normalizeCategory(value: unknown): DraftEvent['category'] | null {
  const text = String(value ?? '').toLowerCase()
  if (!text) return null
  if (/course|课内|课程|上课|class/.test(text)) return 'course'
  if (/activity|课外|活动|社团/.test(text)) return 'activity'
  if (/life|生活|个人|私事/.test(text)) return 'life'
  return null
}

/** 时间形态。 */
export function normalizeEventKind(value: unknown): DraftEvent['kind'] | null {
  const text = String(value ?? '').toLowerCase()
  if (!text) return null
  if (/allday|all-day|全天|整天/.test(text)) return 'allDay'
  if (/todo|待办|截止|deadline|due/.test(text)) return 'todo'
  if (/startonly|start-only|只有开始|开始时间/.test(text)) return 'startOnly'
  if (/timed|时间段|会议|安排/.test(text)) return 'timed'
  return null
}

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

const TITLE_KEYS = ['title', 'name', 'event', 'summary', '标题', '名称', '事项', '日程'] as const
const CATEGORY_KEYS = ['category', 'type', '类别', '分类', '类型'] as const
const KIND_KEYS = ['kind', 'timeKind', '形态', '时间形态'] as const
const START_KEYS = ['startAt', 'start', 'begin', 'from', '开始时间', '开始'] as const
const END_KEYS = ['endAt', 'end', 'to', '结束时间', '结束'] as const
const DUE_KEYS = ['dueAt', 'due', 'deadline', '截止时间', '截止'] as const
const DATE_KEYS = ['date', 'day', '日期', '哪天'] as const
const LOCATION_KEYS = ['location', 'place', 'room', '地点', '位置'] as const
const PEOPLE_KEYS = ['people', 'person', 'with', '参与人', '人物', '和谁'] as const
const NOTE_KEYS = ['note', 'notes', 'remark', '备注', '说明'] as const
const REPEAT_KEYS = ['repeat', 'recurrence', 'repeatRule', 'rule', '重复', '重复规则'] as const

/* ------------------------------------------------------------------ */
/* 重复规则                                                            */
/* ------------------------------------------------------------------ */

const WEEKDAY_TEXT: Record<string, number> = {
  一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 日: 7, 天: 7,
  1: 1, 2: 2, 3: 3, 4: 4, 5: 5, 6: 6, 7: 7,
}

/** 从「周一、三」「1,3,5」「周一到周五」里读出星期数字。 */
export function normalizeWeekdayList(value: unknown): number[] | null {
  if (Array.isArray(value)) {
    const days = value
      .map((item) => normalizeWeekdayNumber(item))
      .filter((item): item is number => item !== null)
    return days.length > 0 ? uniqueSorted(days) : null
  }
  const text = asText(value)
  if (!text) return null
  // 支持「1-5」这种区间写法
  const range = text.match(/(周?[一二三四五六日天1-7])\s*[到至~-]\s*(周?[一二三四五六日天1-7])/)
  if (range) {
    const from = WEEKDAY_TEXT[range[1].replace('周', '')]
    const to = WEEKDAY_TEXT[range[2].replace('周', '')]
    if (from && to && from <= to) {
      return Array.from({ length: to - from + 1 }, (_, index) => from + index)
    }
  }
  const days: number[] = []
  for (const char of text.replace(/周|星期|礼拜/g, '')) {
    const day = WEEKDAY_TEXT[char]
    if (day) days.push(day)
  }
  return days.length > 0 ? uniqueSorted(days) : null
}

function normalizeWeekdayNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    const day = Math.trunc(value)
    return day >= 1 && day <= 7 ? day : null
  }
  const text = asText(value).replace(/周|星期|礼拜/g, '')
  const day = WEEKDAY_TEXT[text]
  return day ?? null
}

function uniqueSorted(values: number[]): number[] {
  return [...new Set(values)].sort((a, b) => a - b)
}

/** 频次归一化：接受英文枚举与中文说法。 */
export function normalizeRepeatFreq(value: unknown): DraftRepeat['freq'] | null {
  const text = asText(value).toLowerCase()
  if (!text) return null
  if (/daily|每天|每日|一天一次/.test(text)) return 'daily'
  if (/biweekly|每两周|双周|隔周/.test(text)) return 'biweekly'
  if (/weekly|每周|每星期|每个星期/.test(text)) return 'weekly'
  if (/monthly|每月|每个月/.test(text)) return 'monthly'
  if (/yearly|annually|每年/.test(text)) return 'yearly'
  if (/custom|自定义|间隔/.test(text)) return 'custom'
  return null
}

/**
 * 把模型给的 repeat 归一化成规则对象。
 *
 * 接受两种写法：
 *  - 对象：{freq,byWeekdays,untilDate,maxCount,intervalValue,intervalUnit}
 *  - 字符串：「每周一三五」「每两周」「每天」「每月 5 号，到 12 月 31 日」
 */
export function normalizeRepeat(raw: unknown, context?: EventDraftContext): DraftRepeat | null {
  if (raw === null || raw === undefined || raw === '') return null

  if (typeof raw === 'string') {
    return parseRepeatText(raw)
  }
  if (typeof raw !== 'object') return null
  const record = raw as Record<string, unknown>

  const byWeekdays =
    normalizeWeekdayList(record.byWeekdays ?? record.weekdays ?? record.days ?? record.星期 ?? record.重复日) ?? null
  const freq =
    normalizeRepeatFreq(record.freq ?? record.frequency ?? record.repeatFreq ?? record.类型 ?? record.频率) ??
    (byWeekdays ? 'weekly' : null)

  const intervalUnitRaw = asText(record.intervalUnit ?? record.unit ?? record.间隔单位).toLowerCase()
  const intervalUnit: DraftRepeat['intervalUnit'] =
    intervalUnitRaw === 'day' || /天/.test(intervalUnitRaw)
      ? 'day'
      : intervalUnitRaw === 'week' || /周|星期/.test(intervalUnitRaw)
        ? 'week'
        : null
  const intervalValueRaw = record.intervalValue ?? record.interval ?? record.每 ??
    record.间隔数量
  const intervalValue =
    typeof intervalValueRaw === 'number' && Number.isFinite(intervalValueRaw)
      ? Math.max(1, Math.trunc(intervalValueRaw))
      : extractNumbers(asText(intervalValueRaw))[0] ?? null

  const untilDate = normalizeRepeatDate(record.untilDate ?? record.until ?? record.endDate ?? record.截止日期, context)
  const maxCountRaw = record.maxCount ?? record.count ?? record.times ?? record.次数
  const maxCount =
    typeof maxCountRaw === 'number' && Number.isFinite(maxCountRaw)
      ? Math.max(1, Math.trunc(maxCountRaw))
      : extractNumbers(asText(maxCountRaw))[0] ?? null

  if (!freq && !untilDate && !maxCount) return null
  if (!freq) {
    // 只给了 byWeekdays / 截止时间时按每周处理
    if (!byWeekdays) return null
  }
  const resolvedFreq: DraftRepeat['freq'] = freq ?? (byWeekdays ? 'weekly' : 'weekly')
  return {
    freq: resolvedFreq,
    intervalValue: resolvedFreq === 'custom' ? intervalValue ?? 1 : intervalValue,
    intervalUnit: resolvedFreq === 'custom' ? intervalUnit ?? 'week' : intervalUnit,
    byWeekdays: resolvedFreq === 'weekly' || resolvedFreq === 'biweekly' ? byWeekdays : null,
    untilDate,
    maxCount,
  }
}

function normalizeRepeatDate(value: unknown, context?: EventDraftContext): string | null {
  const text = asText(value)
  if (!text) return null
  if (isValidDateString(text)) return text
  const normalized = normalizeDateTimeText(text, context ?? { today: '' })
  return normalized.date
}

/** 只解析中文短语，够模型兜底用。 */
function parseRepeatText(text: string): DraftRepeat | null {
  const body = text.trim()
  if (!body) return null
  const byWeekdays = /周|星期|礼拜|[1-7]\s*[,，、]/.test(body) ? normalizeWeekdayList(body) : null
  let freq = normalizeRepeatFreq(body)
  let intervalValue: number | null = null
  let intervalUnit: 'day' | 'week' | null = null

  const every = body.match(/每\s*(\d+|[一二两三四五六七八九十])\s*(天|日|周|星期|礼拜|月)/)
  if (every) {
    const rawCount = every[1]
    const count = /^\d+$/.test(rawCount)
      ? Number(rawCount)
      : ({ 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 }[rawCount] ?? 1)
    intervalValue = count
    intervalUnit = /天|日/.test(every[2]) ? 'day' : 'week'
    freq = freq ?? (intervalUnit === 'week' ? 'custom' : 'custom')
  }
  if (!freq && byWeekdays) freq = 'weekly'
  if (!freq) return null

  const untilMatch = body.match(/(到|至|截止)\s*(\d{4}-\d{1,2}-\d{1,2})/)
  const untilDate = untilMatch ? normalizeRepeatDate(untilMatch[2]) : null
  const countMatch = body.match(/(共|一共|总共)\s*(\d+)\s*次/) ?? body.match(/(\d+)\s*次/)
  const maxCount = countMatch ? Math.max(1, Number(countMatch[2] ?? countMatch[1])) : null

  return {
    freq,
    intervalValue: freq === 'custom' ? intervalValue ?? 1 : intervalValue,
    intervalUnit: freq === 'custom' ? intervalUnit ?? 'week' : intervalUnit,
    byWeekdays: freq === 'weekly' || freq === 'biweekly' ? byWeekdays : null,
    untilDate,
    maxCount,
  }
}

const FREQ_TEXT: Record<DraftRepeat['freq'], string> = {
  daily: '每天',
  weekly: '每周',
  biweekly: '每两周',
  monthly: '每月',
  yearly: '每年',
  custom: '每',
}

/** 给界面/提示词用的一句话描述。 */
export function describeRepeat(repeat: DraftRepeat | null): string {
  if (!repeat) return ''
  const parts: string[] = []
  if (repeat.freq === 'custom') {
    const unit = repeat.intervalUnit === 'day' ? '天' : '周'
    parts.push(`每 ${repeat.intervalValue ?? 1} ${unit}`)
  } else if (repeat.freq === 'biweekly') {
    parts.push('每两周')
  } else {
    parts.push(FREQ_TEXT[repeat.freq])
  }
  if (repeat.byWeekdays && repeat.byWeekdays.length > 0) {
    parts.push(repeat.byWeekdays.map((day) => `周${'一二三四五六日'[day - 1]}`).join('、'))
  }
  if (repeat.untilDate) parts.push(`到 ${repeat.untilDate}`)
  if (repeat.maxCount) parts.push(`共 ${repeat.maxCount} 次`)
  return parts.join(' · ')
}

/** 重复规则本身有没有明显问题（日期/次数/星期）。 */
export function repeatProblems(repeat: DraftRepeat | null): string[] {
  if (!repeat) return []
  const problems: string[] = []
  if (repeat.untilDate && !isValidDateString(repeat.untilDate)) {
    problems.push('重复截止日期格式不对')
  }
  if (repeat.maxCount !== null && (!Number.isInteger(repeat.maxCount) || repeat.maxCount < 1)) {
    problems.push('重复次数必须是正整数')
  }
  if (repeat.byWeekdays) {
    for (const day of repeat.byWeekdays) {
      if (!Number.isInteger(day) || day < 1 || day > 7) {
        problems.push('重复的星期必须在 1-7 之间')
        break
      }
    }
  }
  if (repeat.freq === 'custom' && repeat.intervalValue !== null && repeat.intervalValue < 1) {
    problems.push('重复间隔至少是 1')
  }
  return problems
}

/** 这次的调用里到底有没有提到 repeat（用来区分"没改"和"清空"）。 */
function hasRepeatKey(raw: Record<string, unknown>): boolean {
  return REPEAT_KEYS.some((key) => Object.prototype.hasOwnProperty.call(raw, key))
}

interface ParsedEvent {
  title: string
  category: DraftEvent['category'] | null
  kind: DraftEvent['kind'] | null
  start: { date: string | null; time: string | null }
  end: { date: string | null; time: string | null }
  due: { date: string | null; time: string | null }
  dateOnly: { date: string | null; time: string | null }
  location: string
  people: string
  note: string
  /** 本次调用给出的重复规则（null + repeatProvided=false 表示没提到） */
  repeat: DraftRepeat | null
  repeatProvided: boolean
}

export function readEventFields(raw: unknown, context: EventDraftContext): ParsedEvent {
  const source = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const repeatProvided = hasRepeatKey(source)
  return {
    title: asText(pick(source, TITLE_KEYS)),
    category: normalizeCategory(pick(source, CATEGORY_KEYS)),
    kind: normalizeEventKind(pick(source, KIND_KEYS)),
    start: normalizeDateTimeText(pick(source, START_KEYS), context),
    end: normalizeDateTimeText(pick(source, END_KEYS), context),
    due: normalizeDateTimeText(pick(source, DUE_KEYS), context),
    dateOnly: normalizeDateTimeText(pick(source, DATE_KEYS), context),
    location: asText(pick(source, LOCATION_KEYS)),
    people: asText(pick(source, PEOPLE_KEYS)),
    note: asText(pick(source, NOTE_KEYS)),
    repeat: repeatProvided ? normalizeRepeat(pick(source, REPEAT_KEYS) ?? source, context) : null,
    repeatProvided,
  }
}

const DEFAULT_START_TIME = '09:00'

/** 从任意对象造一条日程草稿；没有标题就当噪声丢掉。 */
export function draftFromRaw(raw: unknown, context: EventDraftContext): DraftEvent | null {
  const fields = readEventFields(raw, context)
  if (!fields.title) return null
  return buildDraft(fields, nextDraftKey())
}

function buildDraft(fields: ParsedEvent, key: string): DraftEvent {
  // 只有"开始/日期"算 start；截止时间不能顶替开始时间，否则待办会被认成全天
  const startDate = fields.start.date ?? fields.dateOnly.date
  const endDate = fields.end.date ?? startDate
  const startTime = fields.start.time
  const endTime = fields.end.time
  const dueTime = fields.due.time

  let kind: DraftEvent['kind'] = fields.kind ?? 'timed'
  if (!fields.kind) {
    if (fields.due.date && !startDate) kind = 'todo'
    else if (!startDate) kind = 'timed'
    else if (startTime && !endTime) kind = 'startOnly'
    else if (!startTime && !endTime) kind = 'allDay'
    else kind = 'timed'
  }

  let startAt: string | null = null
  let endAt: string | null = null
  let dueAt: string | null = null

  if (kind === 'todo') {
    const date = fields.due.date ?? startDate
    if (date) dueAt = dueTime ? `${date}T${dueTime}` : date
  } else if (kind === 'allDay') {
    if (startDate) {
      startAt = startDate
      endAt = endDate && endDate >= startDate ? endDate : startDate
    }
  } else {
    if (startDate) {
      startAt = `${startDate}T${startTime ?? DEFAULT_START_TIME}`
      if (kind === 'timed' && endTime) {
        endAt = `${endDate ?? startDate}T${endTime}`
        if (endAt <= startAt) endAt = null
      }
      if (kind === 'timed' && !endAt) kind = 'startOnly'
    }
  }

  if (!fields.kind && kind === 'timed' && startAt && endAt) kind = 'timed'

  const needsReview =
    (kind === 'todo' && !dueAt) ||
    (kind !== 'todo' && !startAt) ||
    (startAt !== null && startTime === null && (kind === 'timed' || kind === 'startOnly'))

  return {
    key,
    title: fields.title,
    category: fields.category ?? 'activity',
    kind,
    startAt,
    endAt,
    dueAt,
    location: fields.location,
    people: fields.people,
    note: fields.note,
    repeat: fields.repeatProvided ? fields.repeat : null,
    needsReview: needsReview || (!startAt && !dueAt),
  }
}

/** 手动新建一条空草稿（默认是今天 09:00–10:00 的时间段）。 */
export function createManualEventDraft(
  context: EventDraftContext,
  defaults?: Partial<DraftEvent>,
): DraftEvent {
  const fields = readEventFields(
    {
      title: '新日程',
      start: `${context.today} ${DEFAULT_START_TIME}`,
      end: `${context.today} 10:00`,
    },
    context,
  )
  return { ...buildDraft(fields, nextDraftKey()), needsReview: true, ...defaults }
}

/* ------------------------------------------------------------------ */
/* 草稿 ↔ 实体                                                         */
/* ------------------------------------------------------------------ */

export function draftToEventInput(draft: DraftEvent): EventInput {
  return {
    title: draft.title,
    category: draft.category,
    kind: draft.kind,
    startAt: draft.kind === 'todo' ? null : draft.startAt,
    endAt: draft.kind === 'todo' ? null : draft.endAt,
    dueAt: draft.kind === 'todo' ? draft.dueAt : null,
    location: draft.location || null,
    people: draft.people || null,
    note: draft.note || null,
  }
}

/** 草稿 → 入库参数（重复规则由调用方另行处理）。 */
export function draftFromEventInput(input: EventInput, key: string, repeat: DraftRepeat | null = null): DraftEvent {
  return {
    key,
    title: input.title.trim(),
    category: input.category,
    kind: input.kind,
    startAt: input.startAt ?? null,
    endAt: input.endAt ?? null,
    dueAt: input.dueAt ?? null,
    location: input.location?.trim() ?? '',
    people: input.people?.trim() ?? '',
    note: input.note?.trim() ?? '',
    repeat,
    needsReview: false,
  }
}

/** 给日程弹窗做回填用的完整实体（不写库，id 用草稿 key）。 */
export function draftToEventItem(draft: DraftEvent): EventItem {
  return {
    id: draft.key,
    title: draft.title,
    category: draft.category,
    kind: draft.kind,
    startAt: draft.startAt,
    endAt: draft.endAt,
    dueAt: draft.dueAt,
    location: draft.location || null,
    people: draft.people || null,
    note: draft.note || null,
    done: false,
    recurrenceId: null,
    createdAt: '',
    updatedAt: '',
  }
}

export function draftValidateProblems(draft: DraftEvent): string[] {
  return [...validateEventInput(draftToEventInput(draft)), ...repeatProblems(draft.repeat)]
}

export interface EventSummary {
  title: string
  when: string
  detail: string
  /** 重复规则的人话描述；不重复时为空串 */
  repeat: string
}

function describeMoment(value: string | null): string {
  if (!value) return ''
  const datePart = value.slice(0, 10)
  const timePart = value.length > 10 ? value.slice(11, 16) : ''
  const pretty = isValidDateString(datePart) ? formatChineseDate(parseDate(datePart)) : datePart
  return timePart ? `${pretty} ${timePart}` : pretty
}

/** 列表里那一行的人话描述。 */
export function summarizeEventDraft(draft: DraftEvent): EventSummary {
  const extras = [draft.location, draft.people].filter(Boolean).join(' · ')
  let when = ''
  if (draft.kind === 'todo') {
    when = `截止 ${describeMoment(draft.dueAt)}`
  } else if (draft.kind === 'allDay') {
    const from = describeMoment(draft.startAt)
    const to = describeMoment(draft.endAt)
    when = from === to ? `全天 ${from}` : `全天 ${from} – ${to}`
  } else if (draft.kind === 'startOnly') {
    when = describeMoment(draft.startAt)
  } else {
    when = `${describeMoment(draft.startAt)} – ${draft.endAt ? draft.endAt.slice(11, 16) : ''}`
  }
  return { title: draft.title, when, detail: extras, repeat: describeRepeat(draft.repeat) }
}

/* ------------------------------------------------------------------ */
/* 工具调用 → 修改草稿列表                                             */
/* ------------------------------------------------------------------ */

export type EventToolName = 'add_events' | 'add_event' | 'update_event' | 'remove_event' | 'clear_events'

export function normalizeEventToolName(name: string): EventToolName | null {
  const text = String(name ?? '').toLowerCase().replace(/[^a-z]/g, '')
  if (!text) return null
  if (text === 'addevents' || text === 'addeventlist' || text === 'bulkaddevents') return 'add_events'
  if (text === 'addevent' || text === 'createevent' || text === 'addschedule' || text === 'newevent') {
    return 'add_event'
  }
  if (text === 'updateevent' || text === 'editevent' || text === 'modifyevent') return 'update_event'
  if (text === 'removeevent' || text === 'deleteevent' || text === 'dropevent') return 'remove_event'
  if (text === 'clearevents' || text === 'clearlist' || text === 'resetevent') return 'clear_events'
  return null
}

export function extractEventList(input: unknown): unknown[] {
  if (Array.isArray(input)) return input
  if (!input || typeof input !== 'object') return []
  const record = input as Record<string, unknown>
  for (const key of ['events', 'items', 'list', 'eventList', 'data', '日程', '日程列表']) {
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
  const raw = record.index ?? record.idx ?? record.position ?? record.number ?? record.no ?? record.序号
  if (typeof raw === 'number' && Number.isFinite(raw)) return Math.trunc(raw)
  if (typeof raw === 'string') {
    const numbers = extractNumbers(raw)
    if (numbers.length > 0) return numbers[0]
  }
  return null
}

function sameEvent(a: DraftEvent, b: DraftEvent): boolean {
  return a.title === b.title && a.kind === b.kind && a.startAt === b.startAt && a.dueAt === b.dueAt
}

const MAX_DRAFTS = 60

export interface EventApplyResult {
  drafts: DraftEvent[]
  message: string | null
}

export function applyEventToolCall(
  drafts: DraftEvent[],
  name: string,
  input: unknown,
  context: EventDraftContext,
): EventApplyResult {
  const tool = normalizeEventToolName(name)
  if (!tool) return { drafts, message: null }

  if (tool === 'clear_events') return { drafts: [], message: '已清空待确认的日程' }

  if (tool === 'add_events' || tool === 'add_event') {
    const list = tool === 'add_event' ? (Array.isArray(input) ? input : [input]) : extractEventList(input)
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
      if (next.some((item) => sameEvent(item, draft))) {
        skipped += 1
        continue
      }
      next.push(draft)
      added += 1
    }
    if (added === 0) {
      return { drafts, message: skipped > 0 ? '没有识别出可用的日程（缺少标题？）' : null }
    }
    return {
      drafts: next,
      message: `已加入 ${added} 条日程${skipped > 0 ? `（跳过 ${skipped} 条重复或无效）` : ''}`,
    }
  }

  const raw = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>
  const title = asText(pick(raw, TITLE_KEYS))
  const index = readIndex(input)

  if (tool === 'remove_event') {
    const position = resolveTargetIndex(drafts, index, title)
    if (position === null) return { drafts, message: '没找到要删除的日程' }
    return {
      drafts: drafts.filter((_, current) => current !== position),
      message: `已删除「${drafts[position].title}」`,
    }
  }

  const position = resolveTargetIndex(drafts, index, title)
  if (position === null) return { drafts, message: '没找到要修改的日程' }
  const current = drafts[position]
  const fields = readEventFields(raw, context)
  const merged = mergeDraft(current, fields, context)
  return {
    drafts: drafts.map((item, at) => (at === position ? merged : item)),
    message: `已修改「${merged.title}」`,
  }
}

function resolveTargetIndex(drafts: DraftEvent[], index: number | null, title: string): number | null {
  if (index !== null) {
    const position = index >= 1 ? index - 1 : 0
    if (position >= 0 && position < drafts.length) return position
  }
  if (title) {
    const at = drafts.findIndex((item) => item.title === title)
    if (at >= 0) return at
  }
  if (index === null && !title) return drafts.length > 0 ? 0 : null
  return null
}

/** 只覆盖模型真正给出的字段。 */
function mergeDraft(current: DraftEvent, fields: ParsedEvent, _context: EventDraftContext): DraftEvent {
  return buildDraft(
    {
      ...fields,
      title: fields.title || current.title,
      category: fields.category ?? current.category,
      kind: fields.kind ?? current.kind,
      location: fields.location || current.location,
      people: fields.people || current.people,
      note: fields.note || current.note,
      // 模型没提 repeat 就保留原来的；明确给了 null 表示"取消重复"
      repeat: fields.repeatProvided ? fields.repeat : current.repeat,
      repeatProvided: true,
      start: fields.start.date
        ? fields.start
        : {
            date: current.startAt?.slice(0, 10) ?? null,
            time: current.startAt && current.startAt.length > 10 ? current.startAt.slice(11, 16) : null,
          },
      end: fields.end.date
        ? fields.end
        : {
            date: current.endAt?.slice(0, 10) ?? null,
            time: current.endAt && current.endAt.length > 10 ? current.endAt.slice(11, 16) : null,
          },
      due: fields.due.date
        ? fields.due
        : {
            date: current.dueAt?.slice(0, 10) ?? null,
            time: current.dueAt && current.dueAt.length > 10 ? current.dueAt.slice(11, 16) : null,
          },
    },
    current.key,
  )
}
