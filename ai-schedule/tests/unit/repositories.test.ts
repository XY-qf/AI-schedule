import fs from 'node:fs'
import path from 'node:path'
import { after, describe, expect, it } from '../helpers/expect'
import { DataStore } from '../../src/main/db/store'
import {
  CoursesRepository,
  EventsRepository,
  PeriodsRepository,
  SemestersRepository,
  eventDateSpan,
} from '../../src/main/db/repositories'
import { ValidationError } from '../../src/shared/entities'
import type { CourseInput } from '../../src/shared/entities'

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

describe('日程仓储', () => {
  it('创建后能读回，字段与默认值正确', async () => {
    const store = await openDb('repo-events')
    const repo = new EventsRepository(store)
    const created = repo.create({
      title: '篮球训练',
      category: 'activity',
      kind: 'timed',
      startAt: '2026-03-04T19:30',
      endAt: '2026-03-04T21:00',
      location: '体育馆',
      note: '带水',
    })
    expect(created.title).toBe('篮球训练')
    expect(created.category).toBe('activity')
    expect(created.done).toBe(false)
    expect(created.location).toBe('体育馆')
    expect(repo.count()).toBe(1)
    expect(repo.get(created.id)?.note).toBe('带水')
  })

  it('标题为空被拦下，且不会写入数据库', async () => {
    const store = await openDb('repo-events-invalid')
    const repo = new EventsRepository(store)
    let caught: unknown = null
    try {
      repo.create({ title: '   ', category: 'life', kind: 'timed', startAt: '2026-03-04T08:00', endAt: '2026-03-04T09:00' })
    } catch (error) {
      caught = error
    }
    expect(caught instanceof ValidationError).toBe(true)
    expect((caught as ValidationError).messages).toContain('请填写标题')
    expect(repo.count()).toBe(0)
  })

  it('结束时间早于开始时间被拦下', async () => {
    const store = await openDb('repo-events-time')
    const repo = new EventsRepository(store)
    let messages: string[] = []
    try {
      repo.create({ title: '倒挂', category: 'life', kind: 'timed', startAt: '2026-03-04T10:00', endAt: '2026-03-04T09:00' })
    } catch (error) {
      messages = (error as ValidationError).messages
    }
    expect(messages).toContain('结束时间要晚于开始时间')
  })

  it('待办必须填截止日期', async () => {
    const store = await openDb('repo-events-todo')
    const repo = new EventsRepository(store)
    let messages: string[] = []
    try {
      repo.create({ title: '交报告', category: 'course', kind: 'todo', dueAt: null })
    } catch (error) {
      messages = (error as ValidationError).messages
    }
    expect(messages).toContain('请选择截止日期')

    const ok = repo.create({ title: '交报告', category: 'course', kind: 'todo', dueAt: '2026-03-08' })
    expect(ok.kind).toBe('todo')
  })

  it('全天事件用日期而非时刻', async () => {
    const store = await openDb('repo-events-allday')
    const repo = new EventsRepository(store)
    const created = repo.create({ title: '回家', category: 'life', kind: 'allDay', startAt: '2026-03-07', endAt: '2026-03-08' })
    expect(created.startAt).toBe('2026-03-07')
    expect(eventDateSpan(created)).toEqual({ start: '2026-03-07', end: '2026-03-08' })
  })

  it('按时间窗筛选：跨天事件在区间内的每一天都能取到', async () => {
    const store = await openDb('repo-events-range')
    const repo = new EventsRepository(store)
    repo.create({ title: '外地比赛', category: 'activity', kind: 'allDay', startAt: '2026-04-01', endAt: '2026-04-03' })
    repo.create({ title: '单日', category: 'life', kind: 'timed', startAt: '2026-03-04T08:00', endAt: '2026-03-04T09:00' })
    repo.create({ title: '待办', category: 'course', kind: 'todo', dueAt: '2026-04-02' })

    expect(repo.listInRange('2026-03-02', '2026-03-08').map((e) => e.title)).toEqual(['单日'])
    expect(repo.listInRange('2026-04-01', '2026-04-01').map((e) => e.title)).toEqual(['外地比赛'])
    expect(repo.listInRange('2026-04-02', '2026-04-02').map((e) => e.title).sort()).toEqual(['外地比赛', '待办'])
    expect(repo.listInRange('2026-05-01', '2026-05-07')).toEqual([])
  })

  it('更新与完成标记', async () => {
    const store = await openDb('repo-events-update')
    const repo = new EventsRepository(store)
    const created = repo.create({ title: '旧标题', category: 'life', kind: 'timed', startAt: '2026-03-04T08:00', endAt: '2026-03-04T09:00' })
    const updated = repo.update(created.id, { title: '新标题', location: '图书馆' })
    expect(updated.title).toBe('新标题')
    expect(updated.location).toBe('图书馆')
    expect(updated.startAt).toBe('2026-03-04T08:00')

    repo.setDone(created.id, true)
    expect(repo.get(created.id)?.done).toBe(true)
    repo.setDone(created.id, false)
    expect(repo.get(created.id)?.done).toBe(false)
  })

  it('删除后查不到', async () => {
    const store = await openDb('repo-events-remove')
    const repo = new EventsRepository(store)
    const created = repo.create({ title: '临时', category: 'life', kind: 'timed', startAt: '2026-03-04T08:00', endAt: '2026-03-04T09:00' })
    repo.remove(created.id)
    expect(repo.get(created.id)).toBeNull()
    expect(repo.count()).toBe(0)
  })

  it('更新不存在的日程会报错', async () => {
    const store = await openDb('repo-events-missing')
    const repo = new EventsRepository(store)
    expect(() => repo.update('nope', { title: 'x' })).toThrow('日程不存在')
  })
})

describe('学期仓储', () => {
  it('第一个学期自动成为当前学期', async () => {
    const store = await openDb('repo-semesters')
    const repo = new SemestersRepository(store)
    const first = repo.create({ name: '2026 春季', startDate: '2026-03-02', weeks: 18 })
    expect(first.isCurrent).toBe(true)
    expect(repo.current()?.id).toBe(first.id)
  })

  it('第二个学期默认不是当前，可手动切换', async () => {
    const store = await openDb('repo-semesters-2')
    const repo = new SemestersRepository(store)
    const first = repo.create({ name: '2026 春季', startDate: '2026-03-02', weeks: 18 })
    const second = repo.create({ name: '2026 秋季', startDate: '2026-09-07', weeks: 18 })
    expect(second.isCurrent).toBe(false)
    repo.setCurrent(second.id)
    expect(repo.current()?.id).toBe(second.id)
    expect(repo.list().filter((item) => item.isCurrent).length).toBe(1)
    expect(repo.list()[0].id).toBe(second.id) // 按开学日期倒序
    expect(first.id).not.toBe(second.id)
  })

  it('学期信息不合规被拦下', async () => {
    const store = await openDb('repo-semesters-invalid')
    const repo = new SemestersRepository(store)
    const messages: string[] = []
    try {
      repo.create({ name: '', startDate: '2026-3-2', weeks: 0 })
    } catch (error) {
      messages.push(...(error as ValidationError).messages)
    }
    expect(messages).toContain('请填写学期名称')
    expect(messages).toContain('请选择开学日期')
    expect(messages).toContain('总周数需在 1 到 60 之间')
  })

  it('删除学期会连带删除其课程与调课记录，不影响其他学期', async () => {
    const store = await openDb('repo-semesters-remove')
    const semesters = new SemestersRepository(store)
    const courses = new CoursesRepository(store)
    const a = semesters.create({ name: 'A', startDate: '2026-03-02', weeks: 18 })
    const b = semesters.create({ name: 'B', startDate: '2026-09-07', weeks: 18 })
    const courseA = courses.create({
      semesterId: a.id, title: '高数', weekday: 1, timeMode: 'period',
      startPeriod: 1, endPeriod: 2, weekFrom: 1, weekTo: 16, oddEven: 'all',
    })
    courses.create({
      semesterId: b.id, title: '物理', weekday: 2, timeMode: 'period',
      startPeriod: 3, endPeriod: 4, weekFrom: 1, weekTo: 16, oddEven: 'all',
    })
    store.run(
      `INSERT INTO course_exceptions (id, course_id, original_date, action, created_at, updated_at)
       VALUES ('x1', ?, '2026-04-06', 'cancelled', '', '')`,
      [courseA.id],
    )

    semesters.remove(a.id)
    expect(semesters.get(a.id)).toBeNull()
    expect(courses.list(a.id)).toEqual([])
    expect(store.all('SELECT id FROM course_exceptions')).toEqual([])
    expect(courses.list(b.id).length).toBe(1)
  })
})

describe('作息时间表仓储', () => {
  it('空表时自动铺默认作息', async () => {
    const store = await openDb('repo-periods-default')
    const repo = new PeriodsRepository(store)
    const periods = repo.ensureDefaults()
    expect(periods.length).toBe(12)
    expect(periods[0].name).toBe('第 1 节')
    expect(periods[0].startTime).toBe('08:00')
    expect(periods[0].orderIndex).toBe(1)
    // 已有数据时不会重复铺
    expect(repo.ensureDefaults().length).toBe(12)
  })

  it('整表替换保持顺序', async () => {
    const store = await openDb('repo-periods-replace')
    const repo = new PeriodsRepository(store)
    repo.replaceAll([
      { name: '早读', startTime: '07:30', endTime: '08:00' },
      { name: '第 1 节', startTime: '08:10', endTime: '08:55' },
    ])
    const list = repo.list()
    expect(list.map((p) => p.name)).toEqual(['早读', '第 1 节'])
    expect(list.map((p) => p.orderIndex)).toEqual([1, 2])
  })

  it('作息时间不正确被拦下，原数据不受影响', async () => {
    const store = await openDb('repo-periods-invalid')
    const repo = new PeriodsRepository(store)
    repo.ensureDefaults()
    const messages: string[] = []
    try {
      repo.replaceAll([{ name: '第 1 节', startTime: '09:00', endTime: '08:00' }])
    } catch (error) {
      messages.push(...(error as ValidationError).messages)
    }
    expect(messages).toContain('请检查作息时间')
    expect(repo.list().length).toBe(12)
  })

  it('恢复默认', async () => {
    const store = await openDb('repo-periods-reset')
    const repo = new PeriodsRepository(store)
    repo.replaceAll([{ name: '唯一一节', startTime: '10:00', endTime: '11:00' }])
    expect(repo.resetDefaults().length).toBe(12)
  })
})

describe('课程仓储', () => {
  async function setup(name: string) {
    const store = await openDb(name)
    const semesters = new SemestersRepository(store)
    const courses = new CoursesRepository(store)
    const semester = semesters.create({ name: '2026 春季', startDate: '2026-03-02', weeks: 18 })
    return { store, semesters, courses, semester }
  }

  it('按节次录入的课程', async () => {
    const { courses, semester } = await setup('repo-courses-period')
    const course = courses.create({
      semesterId: semester.id, title: '高等数学', teacher: '王老师', location: 'A101',
      weekday: 1, timeMode: 'period', startPeriod: 1, endPeriod: 2,
      weekFrom: 1, weekTo: 16, oddEven: 'all',
    })
    expect(course.title).toBe('高等数学')
    expect(course.timeMode).toBe('period')
    expect(course.startPeriod).toBe(1)
    expect(course.startTime).toBeNull()
    expect(courses.count(semester.id)).toBe(1)
  })

  it('按具体时间与单双周录入的课程', async () => {
    const { courses, semester } = await setup('repo-courses-clock')
    const course = courses.create({
      semesterId: semester.id, title: '英语', weekday: 3, timeMode: 'clock',
      startTime: '10:00', endTime: '11:40', weekFrom: 1, weekTo: 18, oddEven: 'odd',
    })
    expect(course.oddEven).toBe('odd')
    expect(course.endTime).toBe('11:40')
  })

  it('缺少课名或时间被拦下', async () => {
    const { courses, semester } = await setup('repo-courses-invalid')
    const base: CourseInput = {
      semesterId: semester.id, title: '', weekday: 1, timeMode: 'period',
      startPeriod: 1, endPeriod: 2, weekFrom: 1, weekTo: 16, oddEven: 'all',
    }
    const messages: string[] = []
    try {
      courses.create(base)
    } catch (error) {
      messages.push(...(error as ValidationError).messages)
    }
    expect(messages).toContain('请填写课名')

    const noTime: string[] = []
    try {
      courses.create({ ...base, title: '物理', startPeriod: null, endPeriod: null })
    } catch (error) {
      noTime.push(...(error as ValidationError).messages)
    }
    expect(noTime).toContain('请填写课名与上课时间')
  })

  it('周次范围不合法被拦下', async () => {
    const { courses, semester } = await setup('repo-courses-weeks')
    const messages: string[] = []
    try {
      courses.create({
        semesterId: semester.id, title: '体育', weekday: 4, timeMode: 'period',
        startPeriod: 1, endPeriod: 2, weekFrom: 8, weekTo: 3, oddEven: 'all',
      })
    } catch (error) {
      messages.push(...(error as ValidationError).messages)
    }
    expect(messages).toContain('请填写正确的周次范围')
  })

  it('更新与删除课程', async () => {
    const { store, courses, semester } = await setup('repo-courses-update')
    const course = courses.create({
      semesterId: semester.id, title: '高数', weekday: 1, timeMode: 'period',
      startPeriod: 1, endPeriod: 2, weekFrom: 1, weekTo: 16, oddEven: 'all',
    })
    const updated = courses.update(course.id, { title: '高等数学', location: 'B203' })
    expect(updated.title).toBe('高等数学')
    expect(updated.location).toBe('B203')

    store.run(
      `INSERT INTO course_exceptions (id, course_id, original_date, action, created_at, updated_at)
       VALUES ('e1', ?, '2026-04-06', 'cancelled', '', '')`,
      [course.id],
    )
    courses.remove(course.id)
    expect(courses.get(course.id)).toBeNull()
    expect(store.all('SELECT id FROM course_exceptions')).toEqual([])
  })
})
