import crypto from 'node:crypto'
import type { DataStore, Row } from './store'
import { timestampNow } from './store'
import type { RepeatFreq } from '../../shared/entities'
import type { RecRule, SeriesException } from '../../shared/recurrence'
import { ValidationError } from '../../shared/entities'

function newId(): string {
  return crypto.randomUUID()
}

function str(value: unknown): string {
  return value === null || value === undefined ? '' : String(value)
}

function nullableNum(value: unknown): number | null {
  return value === null || value === undefined ? null : Number(value)
}

export interface RecurrenceInput {
  freq: RepeatFreq
  intervalValue?: number | null
  intervalUnit?: 'day' | 'week' | null
  byWeekdays?: number[] | null
  untilDate?: string | null
  maxCount?: number | null
}

function parseWeekdays(raw: unknown): number[] | null {
  const text = str(raw)
  if (!text) return null
  try {
    const parsed = JSON.parse(text)
    return Array.isArray(parsed) ? parsed.map(Number).filter((n) => Number.isFinite(n)) : null
  } catch {
    return null
  }
}

function toRule(row: Row): RecRule {
  return {
    id: str(row.id),
    freq: str(row.freq) as RepeatFreq,
    intervalValue: nullableNum(row.interval_value),
    intervalUnit: (str(row.interval_unit) || null) as 'day' | 'week' | null,
    byWeekdays: parseWeekdays(row.by_weekdays),
    untilDate: str(row.until_date) || null,
    maxCount: nullableNum(row.max_count),
  }
}

/** 重复规则仓库。 */
export class RecurrencesRepository {
  constructor(private readonly store: DataStore) {}

  get(id: string): RecRule | null {
    const row = this.store.get<Row>('SELECT * FROM recurrences WHERE id = ?', [id])
    return row ? toRule(row) : null
  }

  list(): RecRule[] {
    return this.store.all<Row>('SELECT * FROM recurrences').map(toRule)
  }

  create(input: RecurrenceInput): RecRule {
    if (!input.freq) throw new ValidationError(['请选择重复方式'])
    if (input.untilDate && !/^\d{4}-\d{2}-\d{2}$/.test(input.untilDate)) {
      throw new ValidationError(['请填写重复结束条件'])
    }
    if (input.maxCount !== null && input.maxCount !== undefined && input.maxCount < 1) {
      throw new ValidationError(['请填写重复结束条件'])
    }
    const id = newId()
    const now = timestampNow()
    this.store.run(
      `INSERT INTO recurrences
        (id, freq, interval_value, interval_unit, by_weekdays, until_date, max_count, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?)`,
      [
        id,
        input.freq,
        input.intervalValue ?? null,
        input.intervalUnit ?? null,
        input.byWeekdays && input.byWeekdays.length > 0 ? JSON.stringify(input.byWeekdays) : null,
        input.untilDate ?? null,
        input.maxCount ?? null,
        now,
        now,
      ],
    )
    const created = this.get(id)
    if (!created) throw new Error('保存重复规则失败')
    return created
  }

  update(id: string, patch: Partial<RecurrenceInput>): RecRule {
    const existing = this.get(id)
    if (!existing) throw new Error('重复规则不存在')
    const merged: RecurrenceInput = {
      freq: patch.freq ?? existing.freq,
      intervalValue: patch.intervalValue !== undefined ? patch.intervalValue : existing.intervalValue,
      intervalUnit: patch.intervalUnit !== undefined ? patch.intervalUnit : existing.intervalUnit,
      byWeekdays: patch.byWeekdays !== undefined ? patch.byWeekdays : existing.byWeekdays,
      untilDate: patch.untilDate !== undefined ? patch.untilDate : existing.untilDate,
      maxCount: patch.maxCount !== undefined ? patch.maxCount : existing.maxCount,
    }
    this.store.run(
      `UPDATE recurrences SET freq=?, interval_value=?, interval_unit=?, by_weekdays=?,
        until_date=?, max_count=?, updated_at=? WHERE id=?`,
      [
        merged.freq,
        merged.intervalValue ?? null,
        merged.intervalUnit ?? null,
        merged.byWeekdays && merged.byWeekdays.length > 0 ? JSON.stringify(merged.byWeekdays) : null,
        merged.untilDate ?? null,
        merged.maxCount ?? null,
        timestampNow(),
        id,
      ],
    )
    const updated = this.get(id)
    if (!updated) throw new Error('更新重复规则失败')
    return updated
  }

  remove(id: string): void {
    this.store.transaction(() => {
      this.store.run('DELETE FROM event_exceptions WHERE series_id IN (SELECT id FROM events WHERE recurrence_id = ?)', [id])
      this.store.run('UPDATE events SET recurrence_id = NULL WHERE recurrence_id = ?', [id])
      this.store.run('DELETE FROM recurrences WHERE id = ?', [id])
    })
  }
}

export interface ExceptionInput {
  seriesId: string
  originalDate: string
  action: 'modified' | 'skipped'
  startAt?: string | null
  endAt?: string | null
  title?: string | null
  location?: string | null
  people?: string | null
  note?: string | null
  done?: boolean | null
}

function toException(row: Row): SeriesException {
  return {
    id: str(row.id),
    seriesId: str(row.series_id),
    originalDate: str(row.original_date),
    action: str(row.action) as 'modified' | 'skipped',
    startAt: str(row.start_at) || null,
    endAt: str(row.end_at) || null,
    title: str(row.title) || null,
    location: str(row.location) || null,
    people: str(row.people) || null,
    note: str(row.note) || null,
    done: row.done === null || row.done === undefined ? null : Number(row.done) === 1,
  }
}

/** 重复日程的例外（某一次被改期或跳过）。 */
export class EventExceptionsRepository {
  constructor(private readonly store: DataStore) {}

  listBySeries(seriesId: string): SeriesException[] {
    return this.store
      .all<Row>('SELECT * FROM event_exceptions WHERE series_id = ? ORDER BY original_date', [seriesId])
      .map(toException)
  }

  listAll(): SeriesException[] {
    return this.store.all<Row>('SELECT * FROM event_exceptions ORDER BY original_date').map(toException)
  }

  getByDate(seriesId: string, originalDate: string): SeriesException | null {
    const row = this.store.get<Row>(
      'SELECT * FROM event_exceptions WHERE series_id = ? AND original_date = ?',
      [seriesId, originalDate],
    )
    return row ? toException(row) : null
  }

  countBySeries(seriesId: string): number {
    const row = this.store.get<Row>(
      'SELECT count(*) AS total FROM event_exceptions WHERE series_id = ?',
      [seriesId],
    )
    return row ? Number(row.total) : 0
  }

  /** 同一天的例外只保留一条：重复设置会覆盖。 */
  upsert(input: ExceptionInput): SeriesException {
    const existing = this.getByDate(input.seriesId, input.originalDate)
    const now = timestampNow()
    if (existing) {
      this.store.run(
        `UPDATE event_exceptions SET action=?, start_at=?, end_at=?, title=?, location=?,
          people=?, note=?, done=?, updated_at=? WHERE id=?`,
        [
          input.action,
          input.startAt ?? null,
          input.endAt ?? null,
          input.title ?? null,
          input.location ?? null,
          input.people ?? null,
          input.note ?? null,
          input.done === null || input.done === undefined ? null : input.done ? 1 : 0,
          now,
          existing.id,
        ],
      )
      const updated = this.getByDate(input.seriesId, input.originalDate)
      if (!updated) throw new Error('更新例外失败')
      return updated
    }
    const id = newId()
    this.store.run(
      `INSERT INTO event_exceptions
        (id, series_id, original_date, action, start_at, end_at, title, location, people, note, done, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        id,
        input.seriesId,
        input.originalDate,
        input.action,
        input.startAt ?? null,
        input.endAt ?? null,
        input.title ?? null,
        input.location ?? null,
        input.people ?? null,
        input.note ?? null,
        input.done === null || input.done === undefined ? null : input.done ? 1 : 0,
        now,
        now,
      ],
    )
    const created = this.getByDate(input.seriesId, input.originalDate)
    if (!created) throw new Error('保存例外失败')
    return created
  }

  remove(id: string): void {
    this.store.run('DELETE FROM event_exceptions WHERE id = ?', [id])
  }
}

/* ---------------------- 课程的单次调课 / 停课 ---------------------- */

export interface CourseExceptionInput {
  courseId: string
  originalDate: string
  action: 'moved' | 'cancelled'
  startAt?: string | null
  endAt?: string | null
  note?: string | null
}

export interface CourseException {
  id: string
  courseId: string
  originalDate: string
  action: 'moved' | 'cancelled'
  startAt: string | null
  endAt: string | null
  note: string | null
}

function toCourseException(row: Row): CourseException {
  return {
    id: str(row.id),
    courseId: str(row.course_id),
    originalDate: str(row.original_date),
    action: str(row.action) as 'moved' | 'cancelled',
    startAt: str(row.start_at) || null,
    endAt: str(row.end_at) || null,
    note: str(row.note) || null,
  }
}

export class CourseExceptionsRepository {
  constructor(private readonly store: DataStore) {}

  listByCourse(courseId: string): CourseException[] {
    return this.store
      .all<Row>('SELECT * FROM course_exceptions WHERE course_id = ? ORDER BY original_date', [courseId])
      .map(toCourseException)
  }

  listAll(): CourseException[] {
    return this.store.all<Row>('SELECT * FROM course_exceptions').map(toCourseException)
  }

  getByDate(courseId: string, originalDate: string): CourseException | null {
    const row = this.store.get<Row>(
      'SELECT * FROM course_exceptions WHERE course_id = ? AND original_date = ?',
      [courseId, originalDate],
    )
    return row ? toCourseException(row) : null
  }

  upsert(input: CourseExceptionInput): CourseException {
    const existing = this.getByDate(input.courseId, input.originalDate)
    const now = timestampNow()
    if (existing) {
      this.store.run(
        'UPDATE course_exceptions SET action=?, start_at=?, end_at=?, note=?, updated_at=? WHERE id=?',
        [input.action, input.startAt ?? null, input.endAt ?? null, input.note ?? null, now, existing.id],
      )
      const updated = this.getByDate(input.courseId, input.originalDate)
      if (!updated) throw new Error('更新调课记录失败')
      return updated
    }
    const id = newId()
    this.store.run(
      `INSERT INTO course_exceptions (id, course_id, original_date, action, start_at, end_at, note, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?)`,
      [
        id,
        input.courseId,
        input.originalDate,
        input.action,
        input.startAt ?? null,
        input.endAt ?? null,
        input.note ?? null,
        now,
        now,
      ],
    )
    const created = this.getByDate(input.courseId, input.originalDate)
    if (!created) throw new Error('保存调课记录失败')
    return created
  }

  remove(id: string): void {
    this.store.run('DELETE FROM course_exceptions WHERE id = ?', [id])
  }
}
