import crypto from 'node:crypto'
import type { DataStore, Row } from './store'
import { timestampNow } from './store'
import type { Category, EventKind } from '../../shared/domain'
import {
  DEFAULT_PERIODS,
  ValidationError,
  validateCourseInput,
  validateEventInput,
  validatePeriodInput,
  validateSemesterInput,
  type Course,
  type CourseInput,
  type EventInput,
  type EventItem,
  type OddEven,
  type Period,
  type PeriodInput,
  type Semester,
  type SemesterInput,
  type TimeMode,
} from '../../shared/entities'

function newId(): string {
  return crypto.randomUUID()
}

function str(value: unknown): string {
  return value === null || value === undefined ? '' : String(value)
}

function nullableStr(value: unknown): string | null {
  return value === null || value === undefined || value === '' ? null : String(value)
}

function nullableNum(value: unknown): number | null {
  return value === null || value === undefined ? null : Number(value)
}

function datePartOf(value: string | null): string | null {
  if (!value) return null
  return value.slice(0, 10)
}

/* ------------------------------- 日程 ------------------------------- */

function toEvent(row: Row): EventItem {
  return {
    id: str(row.id),
    title: str(row.title),
    category: str(row.category) as Category,
    kind: str(row.kind) as EventKind,
    startAt: nullableStr(row.start_at),
    endAt: nullableStr(row.end_at),
    dueAt: nullableStr(row.due_at),
    location: nullableStr(row.location),
    people: nullableStr(row.people),
    note: nullableStr(row.note),
    done: Number(row.done) === 1,
    recurrenceId: nullableStr(row.recurrence_id),
    createdAt: str(row.created_at),
    updatedAt: str(row.updated_at),
  }
}

/** 一条日程覆盖的日期区间（用于按时间窗筛选）。 */
export function eventDateSpan(event: EventItem): { start: string; end: string } {
  if (event.kind === 'todo') {
    const day = datePartOf(event.dueAt) ?? '0000-00-00'
    return { start: day, end: day }
  }
  const start = datePartOf(event.startAt) ?? '0000-00-00'
  const end = datePartOf(event.endAt) ?? start
  return { start, end }
}

export class EventsRepository {
  constructor(private readonly store: DataStore) {}

  list(): EventItem[] {
    return this.store
      .all<Row>('SELECT * FROM events ORDER BY start_at IS NULL, start_at, due_at')
      .map(toEvent)
  }

  /** 取与 [startDate, endDate] 有交集的日程（含跨天）。 */
  listInRange(startDate: string, endDate: string): EventItem[] {
    return this.list().filter((event) => {
      const span = eventDateSpan(event)
      return span.start <= endDate && span.end >= startDate
    })
  }

  get(id: string): EventItem | null {
    const row = this.store.get<Row>('SELECT * FROM events WHERE id = ?', [id])
    return row ? toEvent(row) : null
  }

  count(): number {
    const row = this.store.get<Row>('SELECT count(*) AS total FROM events')
    return row ? Number(row.total) : 0
  }

  create(input: EventInput): EventItem {
    const errors = validateEventInput(input)
    if (errors.length > 0) throw new ValidationError(errors)
    const now = timestampNow()
    const id = newId()
    this.store.run(
      `INSERT INTO events
        (id, title, category, kind, start_at, end_at, due_at, location, people, note, done, recurrence_id, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        id,
        input.title.trim(),
        input.category,
        input.kind,
        input.startAt ?? null,
        input.endAt ?? null,
        input.dueAt ?? null,
        input.location ?? null,
        input.people ?? null,
        input.note ?? null,
        0,
        input.recurrenceId ?? null,
        now,
        now,
      ],
    )
    const created = this.get(id)
    if (!created) throw new Error('保存日程失败')
    return created
  }

  update(id: string, patch: Partial<EventInput> & { done?: boolean }): EventItem {
    const existing = this.get(id)
    if (!existing) throw new Error('日程不存在')
    const merged: EventInput = {
      title: patch.title ?? existing.title,
      category: patch.category ?? existing.category,
      kind: patch.kind ?? existing.kind,
      startAt: patch.startAt !== undefined ? patch.startAt : existing.startAt,
      endAt: patch.endAt !== undefined ? patch.endAt : existing.endAt,
      dueAt: patch.dueAt !== undefined ? patch.dueAt : existing.dueAt,
      location: patch.location !== undefined ? patch.location : existing.location,
      people: patch.people !== undefined ? patch.people : existing.people,
      note: patch.note !== undefined ? patch.note : existing.note,
      recurrenceId: patch.recurrenceId !== undefined ? patch.recurrenceId : existing.recurrenceId,
    }
    const errors = validateEventInput(merged)
    if (errors.length > 0) throw new ValidationError(errors)
    this.store.run(
      `UPDATE events SET title=?, category=?, kind=?, start_at=?, end_at=?, due_at=?,
        location=?, people=?, note=?, done=?, recurrence_id=?, updated_at=? WHERE id=?`,
      [
        merged.title.trim(),
        merged.category,
        merged.kind,
        merged.startAt ?? null,
        merged.endAt ?? null,
        merged.dueAt ?? null,
        merged.location ?? null,
        merged.people ?? null,
        merged.note ?? null,
        (patch.done ?? existing.done) ? 1 : 0,
        merged.recurrenceId ?? null,
        timestampNow(),
        id,
      ],
    )
    const updated = this.get(id)
    if (!updated) throw new Error('更新日程失败')
    return updated
  }

  setDone(id: string, done: boolean): void {
    this.store.run('UPDATE events SET done = ?, updated_at = ? WHERE id = ?', [
      done ? 1 : 0,
      timestampNow(),
      id,
    ])
  }

  remove(id: string): void {
    this.store.run('DELETE FROM events WHERE id = ?', [id])
  }
}

/* ------------------------------- 学期 ------------------------------- */

function toSemester(row: Row): Semester {
  return {
    id: str(row.id),
    name: str(row.name),
    startDate: str(row.start_date),
    weeks: Number(row.weeks),
    isCurrent: Number(row.is_current) === 1,
    createdAt: str(row.created_at),
    updatedAt: str(row.updated_at),
  }
}

export class SemestersRepository {
  constructor(private readonly store: DataStore) {}

  list(): Semester[] {
    return this.store
      .all<Row>('SELECT * FROM semesters ORDER BY start_date DESC')
      .map(toSemester)
  }

  current(): Semester | null {
    const row = this.store.get<Row>('SELECT * FROM semesters WHERE is_current = 1 LIMIT 1')
    if (row) return toSemester(row)
    return this.list()[0] ?? null
  }

  get(id: string): Semester | null {
    const row = this.store.get<Row>('SELECT * FROM semesters WHERE id = ?', [id])
    return row ? toSemester(row) : null
  }

  create(input: SemesterInput): Semester {
    const errors = validateSemesterInput(input)
    if (errors.length > 0) throw new ValidationError(errors)
    const id = newId()
    const now = timestampNow()
    const makeCurrent = input.isCurrent ?? this.list().length === 0
    this.store.transaction(() => {
      if (makeCurrent) this.store.run('UPDATE semesters SET is_current = 0')
      this.store.run(
        `INSERT INTO semesters (id, name, start_date, weeks, is_current, created_at, updated_at)
         VALUES (?,?,?,?,?,?,?)`,
        [id, input.name.trim(), input.startDate, input.weeks, makeCurrent ? 1 : 0, now, now],
      )
    })
    const created = this.get(id)
    if (!created) throw new Error('保存学期失败')
    return created
  }

  update(id: string, patch: Partial<SemesterInput>): Semester {
    const existing = this.get(id)
    if (!existing) throw new Error('学期不存在')
    const merged: SemesterInput = {
      name: patch.name ?? existing.name,
      startDate: patch.startDate ?? existing.startDate,
      weeks: patch.weeks ?? existing.weeks,
    }
    const errors = validateSemesterInput(merged)
    if (errors.length > 0) throw new ValidationError(errors)
    this.store.run(
      'UPDATE semesters SET name=?, start_date=?, weeks=?, updated_at=? WHERE id=?',
      [merged.name.trim(), merged.startDate, merged.weeks, timestampNow(), id],
    )
    const updated = this.get(id)
    if (!updated) throw new Error('更新学期失败')
    return updated
  }

  setCurrent(id: string): void {
    this.store.transaction(() => {
      this.store.run('UPDATE semesters SET is_current = 0')
      this.store.run('UPDATE semesters SET is_current = 1, updated_at = ? WHERE id = ?', [
        timestampNow(),
        id,
      ])
    })
  }

  /** 删除学期并连带删除其下的课程与调课记录（PRD 9.8）。 */
  remove(id: string): void {
    this.store.transaction(() => {
      this.store.run(
        'DELETE FROM course_exceptions WHERE course_id IN (SELECT id FROM courses WHERE semester_id = ?)',
        [id],
      )
      this.store.run('DELETE FROM courses WHERE semester_id = ?', [id])
      this.store.run('DELETE FROM semesters WHERE id = ?', [id])
    })
  }
}

/* ---------------------------- 作息时间表 ---------------------------- */

function toPeriod(row: Row): Period {
  return {
    id: str(row.id),
    name: str(row.name),
    startTime: str(row.start_time),
    endTime: str(row.end_time),
    orderIndex: Number(row.order_index),
  }
}

export class PeriodsRepository {
  constructor(private readonly store: DataStore) {}

  list(): Period[] {
    return this.store
      .all<Row>('SELECT * FROM periods ORDER BY order_index ASC')
      .map(toPeriod)
  }

  /** 整表替换：批量编辑作息时间表时使用。 */
  replaceAll(items: PeriodInput[]): Period[] {
    const errors: string[] = []
    for (const item of items) errors.push(...validatePeriodInput(item))
    if (errors.length > 0) throw new ValidationError(errors)
    this.store.transaction(() => {
      this.store.run('DELETE FROM periods')
      const now = timestampNow()
      items.forEach((item, index) => {
        this.store.run(
          `INSERT INTO periods (id, name, start_time, end_time, order_index, created_at, updated_at)
           VALUES (?,?,?,?,?,?,?)`,
          [newId(), item.name.trim(), item.startTime, item.endTime, index + 1, now, now],
        )
      })
    })
    return this.list()
  }

  /** 表为空时自动铺一套默认作息（供课程表换算节次用）。 */
  ensureDefaults(): Period[] {
    const existing = this.list()
    if (existing.length > 0) return existing
    return this.replaceAll(DEFAULT_PERIODS)
  }

  resetDefaults(): Period[] {
    return this.replaceAll(DEFAULT_PERIODS)
  }
}

/* ------------------------------- 课程 ------------------------------- */

function toCourse(row: Row): Course {
  return {
    id: str(row.id),
    semesterId: str(row.semester_id),
    title: str(row.title),
    teacher: nullableStr(row.teacher),
    location: nullableStr(row.location),
    weekday: Number(row.weekday),
    timeMode: str(row.time_mode) as TimeMode,
    startPeriod: nullableNum(row.start_period),
    endPeriod: nullableNum(row.end_period),
    startTime: nullableStr(row.start_time),
    endTime: nullableStr(row.end_time),
    weekFrom: Number(row.week_from),
    weekTo: Number(row.week_to),
    oddEven: str(row.odd_even) as OddEven,
    color: nullableStr(row.color),
    createdAt: str(row.created_at),
    updatedAt: str(row.updated_at),
  }
}

export class CoursesRepository {
  constructor(private readonly store: DataStore) {}

  list(semesterId?: string): Course[] {
    const rows = semesterId
      ? this.store.all<Row>('SELECT * FROM courses WHERE semester_id = ? ORDER BY weekday, start_period, start_time', [semesterId])
      : this.store.all<Row>('SELECT * FROM courses ORDER BY weekday, start_period, start_time')
    return rows.map(toCourse)
  }

  get(id: string): Course | null {
    const row = this.store.get<Row>('SELECT * FROM courses WHERE id = ?', [id])
    return row ? toCourse(row) : null
  }

  count(semesterId?: string): number {
    const row = semesterId
      ? this.store.get<Row>('SELECT count(*) AS total FROM courses WHERE semester_id = ?', [semesterId])
      : this.store.get<Row>('SELECT count(*) AS total FROM courses')
    return row ? Number(row.total) : 0
  }

  create(input: CourseInput): Course {
    const errors = validateCourseInput(input)
    if (errors.length > 0) throw new ValidationError(errors)
    const id = newId()
    const now = timestampNow()
    this.store.run(
      `INSERT INTO courses
        (id, semester_id, title, teacher, location, weekday, time_mode, start_period, end_period,
         start_time, end_time, week_from, week_to, odd_even, color, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        id,
        input.semesterId,
        input.title.trim(),
        input.teacher ?? null,
        input.location ?? null,
        input.weekday,
        input.timeMode,
        input.startPeriod ?? null,
        input.endPeriod ?? null,
        input.startTime ?? null,
        input.endTime ?? null,
        input.weekFrom,
        input.weekTo,
        input.oddEven,
        input.color ?? null,
        now,
        now,
      ],
    )
    const created = this.get(id)
    if (!created) throw new Error('保存课程失败')
    return created
  }

  update(id: string, patch: Partial<CourseInput>): Course {
    const existing = this.get(id)
    if (!existing) throw new Error('课程不存在')
    const merged: CourseInput = {
      semesterId: patch.semesterId ?? existing.semesterId,
      title: patch.title ?? existing.title,
      teacher: patch.teacher !== undefined ? patch.teacher : existing.teacher,
      location: patch.location !== undefined ? patch.location : existing.location,
      weekday: patch.weekday ?? existing.weekday,
      timeMode: patch.timeMode ?? existing.timeMode,
      startPeriod: patch.startPeriod !== undefined ? patch.startPeriod : existing.startPeriod,
      endPeriod: patch.endPeriod !== undefined ? patch.endPeriod : existing.endPeriod,
      startTime: patch.startTime !== undefined ? patch.startTime : existing.startTime,
      endTime: patch.endTime !== undefined ? patch.endTime : existing.endTime,
      weekFrom: patch.weekFrom ?? existing.weekFrom,
      weekTo: patch.weekTo ?? existing.weekTo,
      oddEven: patch.oddEven ?? existing.oddEven,
      color: patch.color !== undefined ? patch.color : existing.color,
    }
    const errors = validateCourseInput(merged)
    if (errors.length > 0) throw new ValidationError(errors)
    this.store.run(
      `UPDATE courses SET semester_id=?, title=?, teacher=?, location=?, weekday=?, time_mode=?,
        start_period=?, end_period=?, start_time=?, end_time=?, week_from=?, week_to=?,
        odd_even=?, color=?, updated_at=? WHERE id=?`,
      [
        merged.semesterId,
        merged.title.trim(),
        merged.teacher ?? null,
        merged.location ?? null,
        merged.weekday,
        merged.timeMode,
        merged.startPeriod ?? null,
        merged.endPeriod ?? null,
        merged.startTime ?? null,
        merged.endTime ?? null,
        merged.weekFrom,
        merged.weekTo,
        merged.oddEven,
        merged.color ?? null,
        timestampNow(),
        id,
      ],
    )
    const updated = this.get(id)
    if (!updated) throw new Error('更新课程失败')
    return updated
  }

  remove(id: string): void {
    this.store.transaction(() => {
      this.store.run('DELETE FROM course_exceptions WHERE course_id = ?', [id])
      this.store.run('DELETE FROM courses WHERE id = ?', [id])
    })
  }
}
