import fs from 'node:fs'
import path from 'node:path'
import { after, describe, expect, it } from '../helpers/expect'
import { DataStore } from '../../src/main/db/store'
import {
  CourseExceptionsRepository,
  EventExceptionsRepository,
  RecurrencesRepository,
} from '../../src/main/db/recurrences'
import { CoursesRepository, PeriodsRepository, SemestersRepository } from '../../src/main/db/repositories'
import {
  courseHappensInWeek,
  courseOccurrenceToEvent,
  courseTimes,
  expandCourses,
  periodTimes,
} from '../../src/shared/courseSchedule'
import type { Course, Period, Semester } from '../../src/shared/entities'
import { ValidationError } from '../../src/shared/entities'

const wasmPath = require.resolve('sql.js/dist/sql-wasm.wasm')
const baseDir = path.join(__dirname, '..', '..', '.tmp-tests')
const stores: DataStore[] = []

after(() => {
  for (const store of stores) store.close()
  fs.rmSync(baseDir, { recursive: true, force: true })
})

async function openDb(name: string): Promise<DataStore> {
  const dir = path.join(baseDir, name)
  fs.rmSync(dir, { recursive: true, force: true })
  fs.mkdirSync(dir, { recursive: true })
  const store = await DataStore.open({ filePath: path.join(dir, 'schedule.db'), wasmPath })
  stores.push(store)
  return store
}

describe('重复规则仓储', () => {
  it('创建后能读回，星期列表以 JSON 存取', async () => {
    const store = await openDb('rec-create')
    const repo = new RecurrencesRepository(store)
    const rule = repo.create({ freq: 'weekly', byWeekdays: [1, 3, 5], maxCount: 16 })
    expect(rule.freq).toBe('weekly')
    expect(rule.byWeekdays).toEqual([1, 3, 5])
    expect(rule.maxCount).toBe(16)
    expect(repo.get(rule.id)?.byWeekdays).toEqual([1, 3, 5])
    expect(repo.list().length).toBe(1)
  })

  it('更新规则', async () => {
    const store = await openDb('rec-update')
    const repo = new RecurrencesRepository(store)
    const rule = repo.create({ freq: 'daily' })
    const updated = repo.update(rule.id, { freq: 'monthly', untilDate: '2026-12-31' })
    expect(updated.freq).toBe('monthly')
    expect(updated.untilDate).toBe('2026-12-31')
  })

  it('结束条件不合法被拦下', async () => {
    const store = await openDb('rec-invalid')
    const repo = new RecurrencesRepository(store)
    const messages: string[] = []
    try {
      repo.create({ freq: 'weekly', untilDate: '2026/12/31' })
    } catch (error) {
      messages.push(...(error as ValidationError).messages)
    }
    expect(messages).toContain('请填写重复结束条件')

    const second: string[] = []
    try {
      repo.create({ freq: 'weekly', maxCount: 0 })
    } catch (error) {
      second.push(...(error as ValidationError).messages)
    }
    expect(second).toContain('请填写重复结束条件')
  })

  it('删除规则会解除日程关联并清掉例外', async () => {
    const store = await openDb('rec-remove')
    const repo = new RecurrencesRepository(store)
    const exceptions = new EventExceptionsRepository(store)
    const rule = repo.create({ freq: 'weekly', byWeekdays: [3] })
    store.run(
      `INSERT INTO events (id, title, category, kind, start_at, end_at, done, recurrence_id, created_at, updated_at)
       VALUES ('e1','训练','activity','timed','2026-03-04T19:30','2026-03-04T21:00',0,?,'','')`,
      [rule.id],
    )
    exceptions.upsert({ seriesId: 'e1', originalDate: '2026-03-11', action: 'skipped' })

    repo.remove(rule.id)
    expect(repo.get(rule.id)).toBeNull()
    expect(store.all('SELECT id FROM event_exceptions')).toEqual([])
    const event = store.get<{ recurrence_id: string | null }>('SELECT recurrence_id FROM events WHERE id = ?', ['e1'])
    expect(event?.recurrence_id).toBeNull()
  })
})

describe('日程例外仓储', () => {
  it('跳过与改期都只保留一条（同一天重复设置会覆盖）', async () => {
    const store = await openDb('exc-upsert')
    const repo = new EventExceptionsRepository(store)
    repo.upsert({ seriesId: 's1', originalDate: '2026-03-11', action: 'skipped' })
    const updated = repo.upsert({
      seriesId: 's1',
      originalDate: '2026-03-11',
      action: 'modified',
      startAt: '2026-03-12T20:00',
      endAt: '2026-03-12T21:30',
      title: '改期后',
    })
    expect(updated.action).toBe('modified')
    expect(updated.title).toBe('改期后')
    expect(repo.listBySeries('s1').length).toBe(1)
    expect(repo.countBySeries('s1')).toBe(1)
  })

  it('按系列隔离，删除后消失', async () => {
    const store = await openDb('exc-isolate')
    const repo = new EventExceptionsRepository(store)
    repo.upsert({ seriesId: 's1', originalDate: '2026-03-11', action: 'skipped' })
    const other = repo.upsert({ seriesId: 's2', originalDate: '2026-03-11', action: 'skipped' })
    expect(repo.listBySeries('s1').length).toBe(1)
    repo.remove(other.id)
    expect(repo.listBySeries('s2')).toEqual([])
  })
})

describe('课程调课仓储', () => {
  it('同一节课同一天的记录会覆盖，停课与改期都支持', async () => {
    const store = await openDb('course-exc')
    const repo = new CourseExceptionsRepository(store)
    repo.upsert({ courseId: 'c1', originalDate: '2026-04-06', action: 'cancelled' })
    const moved = repo.upsert({
      courseId: 'c1',
      originalDate: '2026-04-06',
      action: 'moved',
      startAt: '2026-04-08T10:00',
      endAt: '2026-04-08T11:40',
    })
    expect(moved.action).toBe('moved')
    expect(repo.listByCourse('c1').length).toBe(1)
    expect(repo.listAll().length).toBe(1)
  })
})

/* ------------------------------ 课程排布 ------------------------------ */

const PERIODS: Period[] = [
  { id: 'p1', name: '第 1 节', startTime: '08:00', endTime: '08:45', orderIndex: 1 },
  { id: 'p2', name: '第 2 节', startTime: '08:55', endTime: '09:40', orderIndex: 2 },
  { id: 'p3', name: '第 3 节', startTime: '10:00', endTime: '10:45', orderIndex: 3 },
]

const SEMESTER: Semester = {
  id: 'sem-1',
  name: '2026 春季',
  startDate: '2026-03-02',
  weeks: 18,
  isCurrent: true,
  createdAt: '',
  updatedAt: '',
}

function makeCourse(partial: Partial<Course> = {}): Course {
  return {
    id: 'c1',
    semesterId: 'sem-1',
    title: '高等数学',
    teacher: '王老师',
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
    createdAt: '',
    updatedAt: '',
    ...partial,
  }
}

describe('课程时间换算', () => {
  it('节次换算成起止时刻', () => {
    expect(periodTimes(PERIODS, 1, 2)).toEqual({ startTime: '08:00', endTime: '09:40' })
    expect(periodTimes(PERIODS, 2, 3)).toEqual({ startTime: '08:55', endTime: '10:45' })
  })

  it('节次不存在时返回 null（不会算出一个假时间）', () => {
    expect(periodTimes(PERIODS, 1, 9)).toBeNull()
  })

  it('按具体时间的课程直接取时间', () => {
    const course = makeCourse({ timeMode: 'clock', startTime: '14:00', endTime: '15:40' })
    expect(courseTimes(course, PERIODS)).toEqual({ startTime: '14:00', endTime: '15:40' })
  })
})

describe('单双周与周次判断', () => {
  it('单周只在奇数周出现', () => {
    const course = makeCourse({ oddEven: 'odd' })
    expect(courseHappensInWeek(course, 1)).toBe(true)
    expect(courseHappensInWeek(course, 2)).toBe(false)
    expect(courseHappensInWeek(course, 15)).toBe(true)
  })

  it('双周只在偶数周出现', () => {
    const course = makeCourse({ oddEven: 'even' })
    expect(courseHappensInWeek(course, 2)).toBe(true)
    expect(courseHappensInWeek(course, 3)).toBe(false)
  })

  it('超出周次范围不出现', () => {
    const course = makeCourse({ weekFrom: 1, weekTo: 16 })
    expect(courseHappensInWeek(course, 17)).toBe(false)
    expect(courseHappensInWeek(course, 0)).toBe(false)
  })
})

describe('课程展开', () => {
  it('整学期每周一上课，共 16 次', () => {
    const list = expandCourses([makeCourse()], PERIODS, SEMESTER, [], '2026-03-01', '2026-07-01')
    expect(list.length).toBe(16)
    expect(list[0].startAt).toBe('2026-03-02T08:00')
    expect(list[0].endAt).toBe('2026-03-02T09:40')
    expect(list[15].date).toBe('2026-06-15')
  })

  it('单周课程只有 8 次', () => {
    const list = expandCourses([makeCourse({ oddEven: 'odd' })], PERIODS, SEMESTER, [], '2026-03-01', '2026-07-01')
    expect(list.length).toBe(8)
    expect(list.map((item) => item.date).slice(0, 3)).toEqual(['2026-03-02', '2026-03-16', '2026-03-30'])
  })

  it('只返回区间内的课', () => {
    const list = expandCourses([makeCourse()], PERIODS, SEMESTER, [], '2026-03-09', '2026-03-15')
    expect(list.map((item) => item.date)).toEqual(['2026-03-09'])
  })

  it('学期开始之前没有课', () => {
    expect(expandCourses([makeCourse()], PERIODS, SEMESTER, [], '2026-02-01', '2026-03-01')).toEqual([])
  })

  it('不属于该学期的课程不出现', () => {
    const other = makeCourse({ id: 'c2', semesterId: 'sem-2' })
    expect(expandCourses([other], PERIODS, SEMESTER, [], '2026-03-01', '2026-07-01')).toEqual([])
  })

  it('停课的那一次消失，其他周次不变', () => {
    const exceptions = [
      { id: 'x1', courseId: 'c1', originalDate: '2026-03-09', action: 'cancelled' as const, startAt: null, endAt: null },
    ]
    const list = expandCourses([makeCourse()], PERIODS, SEMESTER, exceptions, '2026-03-01', '2026-03-31')
    expect(list.map((item) => item.date)).toEqual(['2026-03-02', '2026-03-16', '2026-03-23', '2026-03-30'])
  })

  it('调课的那一次改到新时间，原位置不再出现', () => {
    const exceptions = [
      {
        id: 'x1',
        courseId: 'c1',
        originalDate: '2026-03-09',
        action: 'moved' as const,
        startAt: '2026-03-11T10:00',
        endAt: '2026-03-11T11:40',
        note: '调到周三',
      },
    ]
    const list = expandCourses([makeCourse()], PERIODS, SEMESTER, exceptions, '2026-03-01', '2026-03-31')
    const moved = list.find((item) => item.date === '2026-03-09')
    expect(moved?.startAt).toBe('2026-03-11T10:00')
    expect(moved?.isException).toBe(true)
    expect(moved?.note).toBe('调到周三')
    // 3 月 9 日原本的位置不再有 08:00 的课
    expect(list.some((item) => item.startAt === '2026-03-09T08:00')).toBe(false)
  })

  it('同一格两门课（单双周各一门）都排出来', () => {
    const odd = makeCourse({ id: 'c1', title: '单周课', oddEven: 'odd' })
    const even = makeCourse({ id: 'c2', title: '双周课', oddEven: 'even' })
    const list = expandCourses([odd, even], PERIODS, SEMESTER, [], '2026-03-02', '2026-03-15')
    expect(list.map((item) => item.title)).toEqual(['单周课', '双周课'])
  })

  it('转成日历条目时带课程分类与可识别的 id', () => {
    const [first] = expandCourses([makeCourse()], PERIODS, SEMESTER, [], '2026-03-01', '2026-03-05')
    const event = courseOccurrenceToEvent(first)
    expect(event.category).toBe('course')
    expect(event.id).toBe('course:c1:2026-03-02')
    expect(event.people).toBe('王老师')
    expect(event.title).toBe('高等数学')
  })
})

describe('课程仓储与排布联动', () => {
  it('从数据库读出课程与作息表后能正确排布', async () => {
    const store = await openDb('course-integration')
    const semesters = new SemestersRepository(store)
    const periods = new PeriodsRepository(store)
    const courses = new CoursesRepository(store)

    const semester = semesters.create({ name: '2026 春季', startDate: '2026-03-02', weeks: 18 })
    const periodList = periods.ensureDefaults()
    courses.create({
      semesterId: semester.id,
      title: '高等数学',
      weekday: 1,
      timeMode: 'period',
      startPeriod: 1,
      endPeriod: 2,
      weekFrom: 1,
      weekTo: 16,
      oddEven: 'all',
    })

    const list = expandCourses(courses.list(semester.id), periodList, semester, [], '2026-03-02', '2026-03-15')
    expect(list.length).toBe(2)
    expect(list[0].startAt).toBe('2026-03-02T08:00')
    expect(list[0].endAt).toBe('2026-03-02T09:40')
  })
})
