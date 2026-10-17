import fs from 'node:fs'
import path from 'node:path'
import { after, describe, expect, it } from '../helpers/expect'
import { DataStore, timestampNow } from '../../src/main/db/store'
import { EventsRepository } from '../../src/main/db/repositories'
import { eventsOnDate, monthGridDates } from '../../src/shared/layout'
import { expandCourses } from '../../src/shared/courseSchedule'
import type { Course, EventItem, Period, Semester } from '../../src/shared/entities'
import { parseDate } from '../../src/shared/date'

const wasmPath = require.resolve('sql.js/dist/sql-wasm.wasm')
const baseDir = path.join(__dirname, '..', '..', '.tmp-tests')
const stores: DataStore[] = []

after(() => {
  for (const store of stores) store.close()
  fs.rmSync(baseDir, { recursive: true, force: true })
})

/** 生成 5000 条跨一年的日程（含时间段、全天、待办三种形态）。 */
function buildEvents(count: number): Array<[string, string, string, string, string, string, number, string, string]> {
  const now = timestampNow()
  const rows: Array<[string, string, string, string, string, string, number, string, string]> = []
  const start = new Date(2026, 0, 1)
  for (let i = 0; i < count; i += 1) {
    const day = new Date(start.getFullYear(), start.getMonth(), start.getDate() + (i % 365))
    const date = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`
    const hour = 6 + (i % 16)
    const kind = i % 10 === 0 ? 'allDay' : i % 10 === 5 ? 'todo' : 'timed'
    const category = i % 3 === 0 ? 'course' : i % 3 === 1 ? 'activity' : 'life'
    if (kind === 'timed') {
      rows.push([`e${i}`, `日程${i}`, category, 'timed', `${date}T${String(hour).padStart(2, '0')}:00`, `${date}T${String(hour + 1).padStart(2, '0')}:00`, 0, now, now])
    } else if (kind === 'allDay') {
      rows.push([`e${i}`, `全天${i}`, category, 'allDay', date, date, 0, now, now])
    } else {
      rows.push([`e${i}`, `待办${i}`, category, 'todo', '', '', 0, now, now])
      // 待办用 due_at 存截止时间，单独补一下
      rows[rows.length - 1][4] = `${date}T23:59`
    }
  }
  return rows
}

describe('5000 条数据下的性能', () => {
  it('批量写入 5000 条并在可接受时间内完成', async () => {
    const dir = path.join(baseDir, 'perf')
    fs.rmSync(dir, { recursive: true, force: true })
    fs.mkdirSync(dir, { recursive: true })
    const store = await DataStore.open({ filePath: path.join(dir, 'schedule.db'), wasmPath })
    stores.push(store)

    const rows = buildEvents(5000)
    const startedAt = Date.now()
    store.transaction(() => {
      for (const [id, title, category, kind, startAt, endAt] of rows) {
        store.run(
          `INSERT INTO events (id, title, category, kind, start_at, end_at, due_at, done, created_at, updated_at)
           VALUES (?,?,?,?,?,?,?,0,?,?)`,
          [id, title, category, kind, startAt || null, endAt || null, kind === 'todo' ? startAt : null, timestampNow(), timestampNow()],
        )
      }
    })
    const writeMs = Date.now() - startedAt
    console.log(`  写入 5000 条耗时 ${writeMs} ms`)
    expect(writeMs).toBeLessThan(8000)

    const count = store.get<{ total: number }>('SELECT count(*) AS total FROM events')
    expect(Number(count?.total)).toBe(5000)
  })

  it('按周取数据在 5000 条里依然很快', async () => {
    const dir = path.join(baseDir, 'perf')
    const store = await DataStore.open({ filePath: path.join(dir, 'schedule.db'), wasmPath })
    stores.push(store)
    const repo = new EventsRepository(store)

    const startedAt = Date.now()
    const week = repo.listInRange('2026-03-02', '2026-03-08')
    const readMs = Date.now() - startedAt
    console.log(`  一周取数耗时 ${readMs} ms，命中 ${week.length} 条`)

    expect(week.length).toBeGreaterThan(0)
    expect(readMs).toBeLessThan(800)
  })

  it('月视图整屏（42 天）的取数在规定时间内完成', async () => {
    const dir = path.join(baseDir, 'perf')
    const store = await DataStore.open({ filePath: path.join(dir, 'schedule.db'), wasmPath })
    stores.push(store)
    const repo = new EventsRepository(store)

    const startedAt = Date.now()
    const all = repo.listInRange('2026-02-23', '2026-04-05')
    const dates = monthGridDates(parseDate('2026-03-15'))
    const perDay = dates.map((date) => eventsOnDate(all as EventItem[], date))
    const costMs = Date.now() - startedAt

    const total = perDay.reduce((sum, list) => sum + list.length, 0)
    console.log(`  月视图 42 天分桶耗时 ${costMs} ms，总条目 ${total}`)
    expect(dates.length).toBe(42)
    expect(total).toBeGreaterThan(0)
    expect(costMs).toBeLessThan(1200)
  })

  it('30 门课排一整个学期依然很快', () => {
    const periods: Period[] = Array.from({ length: 12 }, (_, index) => ({
      id: `p${index + 1}`,
      name: `第 ${index + 1} 节`,
      startTime: '08:00',
      endTime: '08:45',
      orderIndex: index + 1,
    }))
    const semester: Semester = {
      id: 'sem-1',
      name: '2026 春季',
      startDate: '2026-03-02',
      weeks: 18,
      isCurrent: true,
      createdAt: '',
      updatedAt: '',
    }
    const courses: Course[] = Array.from({ length: 30 }, (_, index) => ({
      id: `c${index}`,
      semesterId: 'sem-1',
      title: `课程${index}`,
      teacher: null,
      location: null,
      weekday: (index % 5) + 1,
      timeMode: 'period',
      startPeriod: (index % 6) + 1,
      endPeriod: (index % 6) + 2,
      startTime: null,
      endTime: null,
      weekFrom: 1,
      weekTo: 16,
      oddEven: index % 3 === 0 ? 'odd' : 'all',
      color: null,
      createdAt: '',
      updatedAt: '',
    }))

    const startedAt = Date.now()
    const occurrences = expandCourses(courses, periods, semester, [], '2026-03-02', '2026-07-05')
    const costMs = Date.now() - startedAt
    console.log(`  30 门课排 18 周耗时 ${costMs} ms，生成 ${occurrences.length} 次`)

    expect(occurrences.length).toBeGreaterThan(100)
    expect(costMs).toBeLessThan(600)
  })
})
