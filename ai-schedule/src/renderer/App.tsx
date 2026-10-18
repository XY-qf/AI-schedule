import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { NavBar, StatusBar, Toolbar } from './components/Layout'
import { Button, SegmentedControl } from './components/Controls'
import { Toast } from './components/Feedback'
import { WeekView } from './components/WeekView'
import { MonthView } from './components/MonthView'
import { ListView } from './components/ListView'
import { DayView } from './components/DayView'
import { EventDialog } from './components/EventDialog'
import { DetailPanel } from './components/DetailPanel'
import { CourseTablePage } from './components/CourseTablePage'
import { CourseDialog } from './components/CourseDialog'
import { AiCourseComposer } from './components/AiCourseComposer'
import { AiEventComposer } from './components/AiEventComposer'
import { AiStatusBadge } from './components/AiStatusBadge'
import { resolveAiConfig } from './ai/config'
import { createAiRuntime } from './ai/runtime'
import type { AiEngineFactory, AiStatus, DraftRepeat } from './ai/types'
import { SemesterDialog } from './components/SemesterDialog'
import { PeriodsDialog } from './components/PeriodsDialog'
import { CourseMoveDialog } from './components/CourseMoveDialog'
import { CategoryPage } from './components/CategoryPage'
import { TodoPage } from './components/TodoPage'
import { SettingsPage } from './components/SettingsPage'
import { ContextMenu, type ContextMenuItem } from './components/ContextMenu'
import { ScopeDialog } from './components/ScopeDialog'
import { type RepeatPayload } from './components/EventDialog'
import { expandEvents, parseOccurrenceId } from '../shared/occurrences'
import type { RecRule, SeriesException } from '../shared/recurrence'
import type { RecurrencePayload } from '../shared/ipc'
import { EmptyState } from './components/Feedback'
import type { BackupInfo } from '../shared/ipc'
import { getApi } from './api'
import { PAGE_LABEL, VIEWS, VIEW_LABEL, type PageKey, type ViewKey } from '../shared/navigation'
import { shiftAnchor, viewTitle, weekRangeLabel } from '../shared/viewTitle'
import { addDays, formatDate, parseDate, shiftDateTimeString, startOfWeekMonday } from '../shared/date'
import type {
  Course,
  CourseInput,
  EventInput,
  EventItem,
  Period,
  PeriodInput,
  Semester,
  SemesterInput,
} from '../shared/entities'
import { courseOccurrenceToEvent, expandCourses } from '../shared/courseSchedule'
import type { PreloadApi } from '../shared/ipc'

export interface AppStatus {
  dataFilePath: string
  lastBackupAt: string | null
  backupFailed: boolean
  eventCount: number
  dataDirMissing: boolean
}

export interface AppProps {
  initialPage?: PageKey
  initialView?: ViewKey
  initialAnchor?: Date
  status?: AppStatus | null
  /** 页面或视图变化时通知外层（主进程用来记住上次位置） */
  onNavigate?: (page: PageKey, view: ViewKey) => void
  /** 数据接口，默认取 window.api；测试可注入假实现 */
  api?: PreloadApi
  /** 固定“今天”，便于测试 */
  today?: Date
  /** 提示条自动消失时间（毫秒） */
  toastTimeoutMs?: number
  /** AI 引擎工厂：测试注入假引擎，正常运行时按需加载真实引擎 */
  aiEngineFactory?: AiEngineFactory
  /** 主进程启用的 GPU 兼容模式（off / gpu-sandbox / in-process / software） */
}

interface ToastState {
  message: string
  undo?: () => Promise<void>
}

interface DialogState {
  mode: 'create' | 'edit'
  initial: EventItem | null
  defaults: {
    date: string
    startTime: string
    category?: 'course' | 'activity' | 'life'
    kind?: 'timed' | 'allDay' | 'todo'
  }
}

const FALLBACK_STATUS: AppStatus = {
  dataFilePath: '文档\\AI日程\\schedule.db',
  lastBackupAt: null,
  backupFailed: false,
  eventCount: 0,
  dataDirMissing: false,
}

export function App({
  initialPage = 'calendar',
  initialView = 'week',
  initialAnchor,
  status = null,
  onNavigate,
  api,
  today,
  toastTimeoutMs = 5000,
  aiEngineFactory,
}: AppProps): ReactNode {
  const client = api ?? getApi()
  const now = today ?? new Date()

  const [page, setPage] = useState<PageKey>(initialPage)
  const [view, setView] = useState<ViewKey>(initialView)
  const [anchor, setAnchor] = useState<Date>(initialAnchor ?? now)
  const [editing, setEditing] = useState(false)
  const [events, setEvents] = useState<EventItem[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [dialog, setDialog] = useState<DialogState | null>(null)
  const [toast, setToast] = useState<ToastState | null>(null)
  const [aiModelOptions, setAiModelOptions] = useState<string[]>([])

  const [semesters, setSemesters] = useState<Semester[]>([])
  const [periods, setPeriods] = useState<Period[]>([])
  const [courses, setCourses] = useState<Course[]>([])        // 添加新课程
  const [currentSemesterId, setCurrentSemesterId] = useState<string | null>(null)
  const [semesterDialog, setSemesterDialog] = useState<{ mode: 'create' | 'edit' } | null>(null)
  const [periodsOpen, setPeriodsOpen] = useState(false)
  const [courseDialog, setCourseDialog] = useState<{
    mode: 'create' | 'edit'
    initial: Course | null
    defaults: { weekday: number; periodIndex: number }
  } | null>(null)
  const [courseExceptions, setCourseExceptions] = useState<
    Array<{
      id: string
      courseId: string
      originalDate: string
      action: 'moved' | 'cancelled'
      startAt: string | null
      endAt: string | null
      note: string | null
    }>
  >([])
  const [moveDialogOpen, setMoveDialogOpen] = useState(false)
  const [recurrences, setRecurrences] = useState<RecRule[]>([])
  const [eventExceptions, setEventExceptions] = useState<SeriesException[]>([])
  const [pendingScope, setPendingScope] = useState<{
    action: 'edit' | 'delete'
    masterId: string
    originalDate: string
    input?: EventInput
  } | null>(null)
  const [backups, setBackups] = useState<BackupInfo[]>([])
  const [menu, setMenu] = useState<{ id: string; x: number; y: number } | null>(null)
  const [preferences, setPreferences] = useState<Record<string, string>>({})
  const [appInfo, setAppInfo] = useState<{ version: string; dataDir: string }>({
    version: '1.0.0',
    dataDir: '',
  })

  const resolvedStatus = status ?? FALLBACK_STATUS

  const todayKey = formatDate(now)

  const range = useMemo(() => {
    if (page === 'todo' || page === 'activity' || page === 'life') {
      const base = parseDate(todayKey)
      return { start: formatDate(addDays(base, -365)), end: formatDate(addDays(base, 365)) }
    }
    if (view === 'day') {
      return { start: formatDate(anchor), end: formatDate(anchor) }
    }
    if (view === 'month') {
      const first = new Date(anchor.getFullYear(), anchor.getMonth(), 1)
      const gridStart = startOfWeekMonday(first)
      return { start: formatDate(gridStart), end: formatDate(addDays(gridStart, 41)) }
    }
    if (view === 'list') {
      return { start: formatDate(anchor), end: formatDate(addDays(anchor, 29)) }
    }
    const start = startOfWeekMonday(anchor)
    return { start: formatDate(start), end: formatDate(addDays(start, 6)) }
  }, [page, view, anchor, todayKey])

  const refresh = useCallback(async () => {
    try {
      // 必须取全部：重复日程的母事件可能早在几个月前，未来的待办也不在当周范围里，
      // 只按视图范围取会导致「重复日程只显示一周」「待办不显示」。
      const list = await client.listAllEvents()
      setEvents(list)
    } catch {
      setEvents([])
    }
  }, [client, range.start, range.end])

  useEffect(() => {
    void refresh()
  }, [refresh])

  /* ---------------- 课程表相关数据 ---------------- */

  const loadCourseData = useCallback(async () => {
    try {
      const [semesterList, periodList, exceptionList] = await Promise.all([
        client.listSemesters(),
        client.listPeriods(),
        client.listCourseExceptions(),
      ])
      setSemesters(semesterList)
      setPeriods(periodList)
      setCourseExceptions(exceptionList)
      const current = semesterList.find((item) => item.isCurrent) ?? semesterList[0] ?? null
      setCurrentSemesterId(current?.id ?? null)
      setCourses(current ? await client.listCourses(current.id) : [])
    } catch {
      setSemesters([])
      setPeriods([])
      setCourses([])
    }
  }, [client])

  const loadRecurrences = useCallback(async () => {
    try {
      const [rules, exceptions] = await Promise.all([
        client.listRecurrences(),
        client.listEventExceptions(),
      ])
      setRecurrences(rules)
      setEventExceptions(exceptions)
    } catch {
      setRecurrences([])
      setEventExceptions([])
    }
  }, [client])

  useEffect(() => {
    void loadRecurrences()
  }, [loadRecurrences])

  const reloadCourseExceptions = useCallback(async () => {
    try {
      setCourseExceptions(await client.listCourseExceptions())
    } catch {
      setCourseExceptions([])
    }
  }, [client])

  /* ---------------- 设置、备份与偏好 ---------------- */

  const loadSettingsData = useCallback(async () => {
    try {
      const [backupList, prefs, info] = await Promise.all([
        client.getBackups(),
        client.getPreferences(),
        client.getAppInfo(),
      ])
      setBackups(backupList)
      setPreferences(prefs)
      setAppInfo(info)
    } catch {
      /* 设置读不出来不影响日历使用 */
    }
  }, [client])

  useEffect(() => {
    void loadSettingsData()
  }, [loadSettingsData])

  // 类别颜色以 CSS 变量注入，改一处全局生效
  useEffect(() => {
    const root = document.documentElement
    const mapping: Array<[string, string]> = [
      ['color.course', '--color-course'],
      ['color.activity', '--color-activity'],
      ['color.life', '--color-life'],
    ]
    for (const [key, variable] of mapping) {
      const value = preferences[key]
      if (value) root.style.setProperty(variable, value)
    }
  }, [preferences])

  const showTodoInCalendar = (preferences['display.showTodo'] ?? '1') !== '0'

  /** 一条数据都没有时给引导页，而不是空的网格 */
  const isFirstRun = semesters.length === 0 && events.length === 0

  useEffect(() => {
    void loadCourseData()
  }, [loadCourseData])

  const currentSemester = useMemo(
    () => semesters.find((item) => item.id === currentSemesterId) ?? null,
    [semesters, currentSemesterId],
  )

  /** 课程按规则排出来的实例，转成日历条目（只读，不写库）。 */
  const courseEvents = useMemo(() => {
    if (!currentSemester) return []
    try {
      return expandCourses(courses, periods, currentSemester, courseExceptions, range.start, range.end).map(
        courseOccurrenceToEvent,
      )
    } catch {
      return []
    }
  }, [courses, periods, currentSemester, courseExceptions, range.start, range.end])

  /** 重复日程按规则展开成多个实例 */
  const expandedEvents = useMemo(
    () =>
      expandEvents({
        events,
        rules: recurrences,
        exceptions: eventExceptions,
        rangeStart: range.start,
        rangeEnd: range.end,
      }),
    [events, recurrences, eventExceptions, range.start, range.end],
  )

  /** 日历上显示的全部条目：日程 + 课程实例。 */
  const allEvents = useMemo(
    () => [...(expandedEvents as EventItem[]), ...courseEvents],
    [expandedEvents, courseEvents],
  )

  const calendarEvents = useMemo(
    () => (showTodoInCalendar ? allEvents : allEvents.filter((event) => event.kind !== 'todo')),
    [allEvents, showTodoInCalendar],
  )

  /** 编辑弹窗里要回填的重复规则 */
  const dialogRepeat = useMemo(() => {
    const ruleId = dialog?.initial?.recurrenceId
    if (!ruleId) return null
    const rule = recurrences.find((item) => item.id === ruleId)
    if (!rule) return null
    return { freq: rule.freq, untilDate: rule.untilDate, maxCount: rule.maxCount }
  }, [dialog?.initial?.recurrenceId, recurrences])

  const selected = useMemo(
    () => allEvents.find((event) => event.id === selectedId) ?? null,
    [allEvents, selectedId],
  )

  const navigate = useCallback(
    (nextPage: PageKey, nextView: ViewKey) => {
      setPage(nextPage)
      setView(nextView)
      onNavigate?.(nextPage, nextView)
    },
    [onNavigate],
  )

  const handleSelectPage = useCallback(
    (nextPage: PageKey) => navigate(nextPage, view),
    [navigate, view],
  )

  const handleChangeView = useCallback(
    (nextView: ViewKey) => navigate(page, nextView),
    [navigate, page],
  )

  const title = useMemo(() => {
    if (page === 'calendar') return viewTitle(view, anchor)
    return PAGE_LABEL[page]
  }, [page, view, anchor])

  const move = (direction: 1 | -1): void => {
    setAnchor((current) => shiftAnchor(view, current, direction))
    setSelectedId(null)
  }

  /** 主进程菜单 / 托盘触发的动作 */
  useEffect(() => {
    if (typeof client.onMenuAction !== 'function') return
    client.onMenuAction((action) => {
      if (action === 'new') openCreate()
      else if (action === 'today') {
        setAnchor(new Date())
        setSelectedId(null)
      } else if (action === 'prev') move(-1)
      else if (action === 'next') move(1)
      else if (action === 'settings') setPage('settings')
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, view, today])

  const openCreate = (defaults?: Partial<DialogState['defaults']>): void => {
    setDialog({
      mode: 'create',
      initial: null,
      defaults: {
        date: defaults?.date ?? formatDate(anchor),
        startTime: defaults?.startTime ?? '09:00',
        category: defaults?.category,
        kind: defaults?.kind,
      },
    })
  }

  const handleOpenEditor = (id: string): void => {
    if (!editing) {
      // 浏览态双击只打开详情，修改必须先进编辑态
      setSelectedId(id)
      return
    }
    // 重复日程的某一次只在展开后的列表里，不能在原始 events 里找
    const target = allEvents.find((event) => event.id === id)
    if (!target) return
    setDialog({ mode: 'edit', initial: target, defaults: { date: '', startTime: '09:00' } })
  }

  const toRulePayload = (repeat: RepeatPayload | DraftRepeat): RecurrencePayload => ({
    freq: repeat.freq as RecurrencePayload['freq'],
    untilDate: repeat.untilDate,
    maxCount: repeat.maxCount,
    byWeekdays: repeat.byWeekdays ?? null,
    intervalValue: repeat.intervalValue ?? null,
    intervalUnit: repeat.intervalUnit ?? null,
  })

  const handleSave = async (input: EventInput, repeat: RepeatPayload | null): Promise<void> => {
    if (!dialog) return
    try {
      // 编辑的是重复日程里的某一次：先问作用范围
      if (dialog.mode === 'edit' && dialog.initial) {
        const occurrence = parseOccurrenceId(dialog.initial.id)
        if (occurrence) {
          setPendingScope({
            action: 'edit',
            masterId: occurrence.masterId,
            originalDate: occurrence.originalDate,
            input,
          })
          setDialog(null)
          return
        }
      }

      if (dialog.mode === 'create') {
        let recurrenceId: string | null = null
        if (repeat) {
          const rule = await client.createRecurrence(toRulePayload(repeat))
          recurrenceId = rule.id
        }
        await client.createEvent({ ...input, recurrenceId })
      } else if (dialog.initial) {
        const master = events.find((item) => item.id === dialog.initial?.id)
        let recurrenceId: string | null = master?.recurrenceId ?? null
        if (repeat) {
          if (recurrenceId) await client.updateRecurrence(recurrenceId, toRulePayload(repeat))
          else recurrenceId = (await client.createRecurrence(toRulePayload(repeat))).id
        } else if (recurrenceId) {
          await client.deleteRecurrence(recurrenceId)
          recurrenceId = null
        }
        await client.updateEvent(dialog.initial.id, { ...input, recurrenceId })
      }
      setDialog(null)
      await refresh()
      await loadRecurrences()
      setToast({ message: '已保存' })
    } catch (error) {
      setToast({ message: `保存失败：${String((error as Error).message ?? error)}` })
    }
  }

  /** 「这一次及以后」：老系列截止到前一天，之后的部分另起新系列。 */
  const cutSeriesAt = async (master: EventItem, originalDate: string): Promise<void> => {
    if (!master.recurrenceId) return
    const previousDay = formatDate(addDays(parseDate(originalDate), -1))
    await client.updateRecurrence(master.recurrenceId, { untilDate: previousDay })
  }

  /**
   * 把「这一次及以后」拆成两个系列。
   *
   * 原实现让新日程复用老规则，老规则的截止日又被截断到前一天，
   * 于是新系列一次都展开不出来——日程直接消失（用户反馈第 11 条）。
   * 这里给新系列单独建一条规则，截止日沿用原来的。
   */
  const splitSeriesFollowing = async (
    master: EventItem,
    originalDate: string,
    input: EventInput,
  ): Promise<void> => {
    const oldRule = recurrences.find((item) => item.id === master.recurrenceId) ?? null
    const isFirstOccurrence = (master.startAt ?? '').slice(0, 10) >= originalDate

    if (isFirstOccurrence || !master.recurrenceId) {
      // 从第一次就改，等于改整个系列
      await client.updateEvent(master.id, input)
      return
    }

    await cutSeriesAt(master, originalDate)
    const newRule = await client.createRecurrence({
      freq: oldRule?.freq ?? 'weekly',
      intervalValue: oldRule?.intervalValue ?? null,
      intervalUnit: oldRule?.intervalUnit ?? null,
      byWeekdays: oldRule?.byWeekdays ?? null,
      untilDate: oldRule?.untilDate ?? null,
      maxCount: null,
    })
    await client.createEvent({ ...input, recurrenceId: newRule.id })
  }

  /** 三选一之后就按选择落地：仅这一次 / 这一次及以后 / 全部。 */
  const applyScope = async (scope: 'single' | 'following' | 'all'): Promise<void> => {
    const pending = pendingScope
    setPendingScope(null)
    if (!pending) return
    const master = events.find((item) => item.id === pending.masterId)
    if (!master) return
    try {
      if (pending.action === 'delete') {
        if (scope === 'single') {
          await client.upsertEventException({
            seriesId: pending.masterId,
            originalDate: pending.originalDate,
            action: 'skipped',
          })
        } else if (scope === 'all') {
          await client.deleteEvent(pending.masterId)
          if (master.recurrenceId) await client.deleteRecurrence(master.recurrenceId)
        } else {
          await cutSeriesAt(master, pending.originalDate)
        }
        setSelectedId(null)
        setToast({ message: '已删除' })
      } else if (pending.input) {
        if (scope === 'single') {
          await client.upsertEventException({
            seriesId: pending.masterId,
            originalDate: pending.originalDate,
            action: 'modified',
            startAt: pending.input.startAt ?? null,
            endAt: pending.input.endAt ?? null,
            title: pending.input.title,
            location: pending.input.location ?? null,
            people: pending.input.people ?? null,
            note: pending.input.note ?? null,
          })
        } else if (scope === 'all') {
          await client.updateEvent(pending.masterId, pending.input)
        } else {
          await splitSeriesFollowing(master, pending.originalDate, pending.input)
        }
        setToast({ message: '已保存' })
      }
      await refresh()
      await loadRecurrences()
    } catch (error) {
      setToast({ message: `操作失败：${String((error as Error).message ?? error)}` })
    }
  }

  const handleDelete = async (): Promise<void> => {
    if (!dialog?.initial) return
    const target = dialog.initial
    const occurrence = parseOccurrenceId(target.id)
    if (occurrence) {
      setPendingScope({
        action: 'delete',
        masterId: occurrence.masterId,
        originalDate: occurrence.originalDate,
      })
      setDialog(null)
      return
    }
    try {
      await client.deleteEvent(target.id)
      setDialog(null)
      setSelectedId(null)
      await refresh()
      setToast({
        message: '已删除',
        undo: async () => {
          await client.createEvent({
            title: target.title,
            category: target.category,
            kind: target.kind,
            startAt: target.startAt,
            endAt: target.endAt,
            dueAt: target.dueAt,
            location: target.location,
            people: target.people,
            note: target.note,
          })
        },
      })
    } catch (error) {
      setToast({ message: `删除失败：${String((error as Error).message ?? error)}` })
    }
  }

  /**
   * 统一的「改时间」入口：普通日程直接改，课程块写调课例外，
   * 重复日程的某一次写改期例外——否则拖到课程块或重复块上会毫无反应（用户反馈第 5 条）。
   */
  const applyReschedule = async (
    target: EventItem,
    nextStart: string | null,
    nextEnd: string | null,
  ): Promise<{ undo?: () => Promise<void> }> => {
    const parts = target.id.split(':')
    if (parts[0] === 'course' && parts.length >= 3) {
      const courseId = parts[1]
      const originalDate = parts.slice(2).join(':')
      await client.setCourseException({
        courseId,
        originalDate,
        action: 'moved',
        startAt: nextStart,
        endAt: nextEnd,
      })
      await reloadCourseExceptions()
      return {
        undo: async () => {
          await client.clearCourseException(courseId, originalDate)
        },
      }
    }

    const occurrence = parseOccurrenceId(target.id)
    if (occurrence) {
      const saved = await client.upsertEventException({
        seriesId: occurrence.masterId,
        originalDate: occurrence.originalDate,
        action: 'modified',
        startAt: nextStart,
        endAt: nextEnd,
      })
      return {
        undo: async () => {
          await client.deleteEventException(saved.id)
        },
      }
    }

    await client.updateEvent(target.id, { startAt: nextStart, endAt: nextEnd })
    return {
      undo: async () => {
        await client.updateEvent(target.id, { startAt: target.startAt, endAt: target.endAt })
      },
    }
  }

  /** 编辑态拖动日程块：整体平移若干分钟（可撤销）。 */
  const handleMoveEvent = async (id: string, deltaMinutes: number): Promise<void> => {
    const target = allEvents.find((event) => event.id === id)
    if (!target?.startAt) {
      setToast({ message: '这条日程不能拖动' })
      return
    }
    try {
      const { undo } = await applyReschedule(
        target,
        shiftDateTimeString(target.startAt, deltaMinutes),
        target.endAt ? shiftDateTimeString(target.endAt, deltaMinutes) : null,
      )
      await refresh()
      setToast({ message: `已移动「${target.title}」`, undo })
    } catch (error) {
      setToast({ message: `移动失败：${String((error as Error).message ?? error)}` })
    }
  }

  /** 编辑态拉下边缘：只改结束时间（可撤销）。 */
  const handleResizeEvent = async (id: string, deltaMinutes: number): Promise<void> => {
    const target = allEvents.find((event) => event.id === id)
    if (!target?.endAt) {
      setToast({ message: '这条日程不能改时长' })
      return
    }
    try {
      const { undo } = await applyReschedule(
        target,
        target.startAt,
        shiftDateTimeString(target.endAt, deltaMinutes),
      )
      await refresh()
      setToast({ message: `已调整「${target.title}」时长`, undo })
    } catch (error) {
      setToast({ message: `调整失败：${String((error as Error).message ?? error)}` })
    }
  }

  const handleToggleDone = async (event: EventItem): Promise<void> => {
    try {
      await client.setEventDone(event.id, !event.done)
      await refresh()
    } catch (error) {
      setToast({ message: `操作失败：${String((error as Error).message ?? error)}` })
    }
  }

  const handleUndo = async (): Promise<void> => {
    const action = toast?.undo
    setToast(null)
    if (!action) return
    try {
      await action()
      await refresh()
    } catch (error) {
      setToast({ message: `撤销失败：${String((error as Error).message ?? error)}` })
    }
  }

  // 提示条自动消失（默认 5 秒）
  useEffect(() => {
    if (!toast) return undefined
    const timer = setTimeout(() => setToast(null), toastTimeoutMs)
    return () => clearTimeout(timer)
  }, [toast, toastTimeoutMs])

  const handleToolbarCreate = (): void => openCreate()

  /* ---------------- 右键菜单 ---------------- */

  const handleDuplicate = async (event: EventItem): Promise<void> => {
    try {
      await client.createEvent({
        title: `${event.title}（副本）`,
        category: event.category,
        kind: event.kind,
        startAt: event.startAt,
        endAt: event.endAt,
        dueAt: event.dueAt,
        location: event.location,
        people: event.people,
        note: event.note,
      })
      await refresh()
      setToast({ message: '已复制一份' })
    } catch (error) {
      setToast({ message: `复制失败：${String((error as Error).message ?? error)}` })
    }
  }

  const handleMenuSelect = (key: string): void => {
    const target = allEvents.find((event) => event.id === menu?.id)
    if (!target) return
    if (key === 'detail') setSelectedId(target.id)
    if (key === 'edit') handleOpenEditor(target.id)
    if (key === 'done') void handleToggleDone(target)
    if (key === 'duplicate') void handleDuplicate(target)
    if (key === 'delete') {
      setDialog({ mode: 'edit', initial: target, defaults: { date: '', startTime: '09:00' } })
    }
  }

  const menuItems = useMemo<ContextMenuItem[]>(() => {
    const target = allEvents.find((event) => event.id === menu?.id)
    if (!target) return []
    const isCourse = target.id.startsWith('course:')
    const items: ContextMenuItem[] = [{ key: 'detail', label: '查看详情' }]
    if (editing && !isCourse) {
      items.push({ key: 'edit', label: '编辑' })
      items.push({ key: 'duplicate', label: '复制一份' })
    }
    items.push({ key: 'done', label: target.done ? '取消完成' : '标记完成' })
    if (editing && !isCourse) items.push({ key: 'delete', label: '删除', danger: true })
    return items
  }, [allEvents, menu?.id, editing])

  const handleSetPreference = (key: string, value: string): void => {
    setPreferences((current) => ({ ...current, [key]: value }))
    void client.setPreference(key, value)
  }

  const handleBackupNow = async (): Promise<void> => {
    try {
      await client.backupNow()
      setBackups(await client.getBackups())
      setToast({ message: '已备份' })
    } catch (error) {
      setToast({ message: `备份失败：${String((error as Error).message ?? error)}` })
    }
  }

  const handleRestore = (fileName: string): void => {
    void client.restoreBackup(fileName)
  }

  /* ---------------- 学期与课程操作 ---------------- */

  const handleSaveSemester = async (input: SemesterInput): Promise<void> => {
    try {
      const editing = semesterDialog?.mode === 'edit' ? currentSemester : null
      if (editing) await client.updateSemester(editing.id, input)
      else await client.createSemester(input)
      setSemesterDialog(null)
      await loadCourseData()
      setToast({ message: '已保存学期' })
    } catch (error) {
      setToast({ message: `保存学期失败：${String((error as Error).message ?? error)}` })
    }
  }

  const handleDeleteSemester = async (): Promise<void> => {
    if (!currentSemester) return
    try {
      await client.deleteSemester(currentSemester.id)
      setSemesterDialog(null)
      await loadCourseData()
      setToast({ message: '已删除学期（连同其课程）' })
    } catch (error) {
      setToast({ message: `删除学期失败：${String((error as Error).message ?? error)}` })
    }
  }

  const handleSelectSemester = async (id: string): Promise<void> => {
    try {
      await client.setCurrentSemester(id)
      setCurrentSemesterId(id)
      setCourses(await client.listCourses(id))
      const list = await client.listSemesters()
      setSemesters(list)
    } catch (error) {
      setToast({ message: `切换学期失败：${String((error as Error).message ?? error)}` })
    }
  }

  const handleSaveCourse = async (input: CourseInput): Promise<void> => {
    if (!courseDialog) return
    try {
      if (courseDialog.mode === 'create') await client.createCourse(input)
      else if (courseDialog.initial) await client.updateCourse(courseDialog.initial.id, input)
      setCourseDialog(null)
      if (currentSemesterId) setCourses(await client.listCourses(currentSemesterId))
      setToast({ message: '已保存课程' })
    } catch (error) {
      setToast({ message: `保存课程失败：${String((error as Error).message ?? error)}` })
    }
  }

  const handleDeleteCourse = async (): Promise<void> => {
    if (!courseDialog?.initial) return
    try {
      await client.deleteCourse(courseDialog.initial.id)
      setCourseDialog(null)
      if (currentSemesterId) setCourses(await client.listCourses(currentSemesterId))
      setToast({ message: '已删除课程' })
    } catch (error) {
      setToast({ message: `删除课程失败：${String((error as Error).message ?? error)}` })
    }
  }

  /* ---------------- AI 课程助手 ---------------- */

  const aiConfig = useMemo(() => resolveAiConfig(preferences), [preferences])

  /** AI 运行期状态放在 App 里，两个入口共用同一个模型实例，也供右下角状态窗读取 */
  const [aiRuntime] = useState(() => createAiRuntime(aiEngineFactory))
  const [aiStatus, setAiStatus] = useState<AiStatus>(() => aiRuntime.getStatus())

  useEffect(() => {
    setAiStatus(aiRuntime.getStatus())
    return aiRuntime.subscribe(() => setAiStatus(aiRuntime.getStatus()))
  }, [aiRuntime])

  useEffect(() => {
    aiRuntime.configure(aiConfig)
  }, [aiRuntime, aiConfig])

  useEffect(() => () => aiRuntime.dispose(), [aiRuntime])

  /** AI 草稿经用户确认后，逐条写进课程表 */
  /** 设置页的「测试连接」：用当前配置发一条最小请求 */
  /** 设置页「读取可用模型」：GET /models，列出 Key 能用的模型 id */
  const handleFetchAiModels = async (): Promise<void> => {
    try {
      const result = await client.aiModels({ baseUrl: aiConfig.baseUrl, apiKey: aiConfig.apiKey })
      if (!result.ok) {
        setToast({ message: `读取模型失败：${result.error ?? '未知错误'}` })
        return
      }
      setAiModelOptions(result.models)
      setToast({
        message: result.models.length > 0
          ? `可用模型 ${result.models.length} 个，点一下名字即可选用`
          : '接口没有返回模型列表',
      })
    } catch (error) {
      setToast({ message: `读取模型失败：${String((error as Error)?.message ?? error)}` })
    }
  }

  const handleTestAi = async (): Promise<void> => {
    try {
      const outcome = await client.aiChat(
        {
          id: `test-${Date.now()}`,
          baseUrl: aiConfig.baseUrl,
          model: aiConfig.model,
          apiKey: aiConfig.apiKey,
          messages: [{ role: 'user', content: '只回复两个字：收到' }],
          maxTokens: 16,
          temperature: 0,
          timeoutMs: 30_000,
        },
        () => undefined,
      )
      setToast({
        message: outcome.ok
          ? `连接正常：${aiConfig.model}`
          : `连接失败：${outcome.error ?? '未知错误'}`,
      })
    } catch (error) {
      setToast({ message: `连接失败：${String((error as Error)?.message ?? error)}` })
    }
  }

  const handleAddAiCourses = async (inputs: CourseInput[]): Promise<number> => {
    if (!currentSemesterId) throw new Error('请先新建学期')
    let added = 0
    for (const input of inputs) {
      await client.createCourse({ ...input, semesterId: currentSemesterId })
      added += 1
    }
    setCourses(await client.listCourses(currentSemesterId))
    setToast({ message: `已加入 ${added} 门课程` })
    return added
  }

  /** AI 草稿经用户确认后，逐条写进日历 */
  const handleAddAiEvents = async (
    items: Array<{ input: EventInput; repeat: DraftRepeat | null }>,
  ): Promise<number> => {
    let added = 0
    for (const item of items) {
      let recurrenceId: string | null = null
      // 有重复规则就先把规则建出来，再挂到日程上
      if (item.repeat) {
        const rule = await client.createRecurrence(toRulePayload(item.repeat))
        recurrenceId = rule.id
      }
      await client.createEvent({ ...item.input, recurrenceId })
      added += 1
    }
    await refresh()
    if (items.some((item) => item.repeat)) await loadRecurrences()
    setToast({ message: `已加入 ${added} 条日程` })
    return added
  }

  const handleSavePeriods = async (items: PeriodInput[]): Promise<void> => {    try {
      setPeriods(await client.savePeriods(items))
      setPeriodsOpen(false)
      setToast({ message: '已保存作息时间表' })
    } catch (error) {
      setToast({ message: `保存作息表失败：${String((error as Error).message ?? error)}` })
    }
  }

  const handleResetPeriods = async (): Promise<void> => {
    try {
      setPeriods(await client.resetPeriods())
      setPeriodsOpen(false)
      setToast({ message: '已恢复默认作息' })
    } catch (error) {
      setToast({ message: `恢复默认失败：${String((error as Error).message ?? error)}` })
    }
  }

  /* ---------------- 课程单次的改期 / 停课 ---------------- */

  const selectedCourse = useMemo(() => {
    if (!selectedId || !selectedId.startsWith('course:')) return null
    const parts = selectedId.split(':')
    const courseId = parts[1]
    const date = parts[2]
    return courseId && date ? { courseId, date } : null
  }, [selectedId])

  const selectedCourseException = useMemo(() => {
    if (!selectedCourse) return null
    return (
      courseExceptions.find(
        (item) => item.courseId === selectedCourse.courseId && item.originalDate === selectedCourse.date,
      ) ?? null
    )
  }, [courseExceptions, selectedCourse])

  const handleCancelCourseOnce = async (): Promise<void> => {
    if (!selectedCourse) return
    try {
      await client.setCourseException({
        courseId: selectedCourse.courseId,
        originalDate: selectedCourse.date,
        action: 'cancelled',
      })
      await reloadCourseExceptions()
      setSelectedId(null)
      setToast({ message: '本次课已停课' })
    } catch (error) {
      setToast({ message: `停课失败：${String((error as Error).message ?? error)}` })
    }
  }

  const handleClearCourseException = async (): Promise<void> => {
    if (!selectedCourse) return
    try {
      await client.clearCourseException(selectedCourse.courseId, selectedCourse.date)
      await reloadCourseExceptions()
      setSelectedId(null)
      setToast({ message: '已撤销这次调整' })
    } catch (error) {
      setToast({ message: `撤销失败：${String((error as Error).message ?? error)}` })
    }
  }

  const handleMoveCourseOnce = async (payload: {
    date: string
    startTime: string
    endTime: string
  }): Promise<void> => {
    if (!selectedCourse) return
    try {
      await client.setCourseException({
        courseId: selectedCourse.courseId,
        originalDate: selectedCourse.date,
        action: 'moved',
        startAt: `${payload.date}T${payload.startTime}`,
        endAt: `${payload.date}T${payload.endTime}`,
      })
      await reloadCourseExceptions()
      setMoveDialogOpen(false)
      setSelectedId(null)
      setToast({ message: '这一次课已改期' })
    } catch (error) {
      setToast({ message: `改期失败：${String((error as Error).message ?? error)}` })
    }
  }

  // 快捷键（PRD 第 11 章）：← → 翻页、T 回今天、Ctrl+N 新建、Esc 关闭
  useEffect(() => {
    const handler = (event: KeyboardEvent): void => {
      const target = event.target as HTMLElement | null
      const tag = target?.tagName
      const inField = tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA'

      if (event.key === 'Escape') {
        if (dialog) setDialog(null)
        else if (selectedId) setSelectedId(null)
        return
      }
      if (inField) return

      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'n') {
        event.preventDefault()
        openCreate()
        return
      }
      if (event.key === 'ArrowLeft') {
        event.preventDefault()
        move(-1)
        return
      }
      if (event.key === 'ArrowRight') {
        event.preventDefault()
        move(1)
        return
      }
      if (event.key.toLowerCase() === 't') {
        setAnchor(new Date())
        setSelectedId(null)
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dialog, selectedId, view, anchor])

  return (
    <div className="app-shell">
      <NavBar page={page} onSelect={handleSelectPage} />
      <Toolbar
        title={title}
        editing={editing}
        onPrev={() => move(-1)}
        onNext={() => move(1)}
        onToday={() => {
          setAnchor(now)
          setSelectedId(null)
        }}
        onCreate={handleToolbarCreate}
        onToggleEditing={() => setEditing((value) => !value)}
      />
      <main className={`app-main${editing ? ' is-editing' : ''}`}>
        {page === 'calendar' ? (
          <section className="page" aria-label="日历">
            <div className="page__header">
              <SegmentedControl
                ariaLabel="切换日历视图"
                value={view}
                options={VIEWS.map((item) => ({ value: item, label: VIEW_LABEL[item] }))}
                onChange={handleChangeView}
              />
              <span className="toolbar-spacer" />
              <span className="page__subtitle">
                {view === 'week' ? weekRangeLabel(startOfWeekMonday(anchor)) : ''}
              </span>
            </div>
            <div className="page__ai page__ai--wide">
              <AiEventComposer
                today={now}
                config={aiConfig}
                runtime={aiRuntime}
                onAddEvents={handleAddAiEvents}
                defaultCategory="activity"
              />
            </div>
            <div className="page__body page__body--split">
              <div className="calendar-surface">
                {isFirstRun ? (
                  <EmptyState
                    title="还没有任何日程，从这三步开始"
                    description="先建课程表，整学期的课会自动排进日历；也可以先随手记一条。"
                    actions={
                      <>
                        <Button
                          variant="primary"
                          onClick={() => {
                            navigate('courseTable', 'week')
                            setSemesterDialog({ mode: 'create' })
                          }}
                        >
                          先建课程表
                        </Button>
                        <Button onClick={() => openCreate({ category: 'activity' })}>
                          加一条课外活动
                        </Button>
                        <Button onClick={() => openCreate({ category: 'life' })}>
                          加一条生活日程
                        </Button>
                      </>
                    }
                  />
                ) : view === 'week' ? (
                  <WeekView
                    weekStart={anchor}
                    events={calendarEvents}
                    today={now}
                    editing={editing}
                    onSelectEvent={(id) => setSelectedId(id)}
                    onOpenEditor={handleOpenEditor}
                    onCreateAt={(date, hour) =>
                      openCreate({ date, startTime: `${String(hour).padStart(2, '0')}:00` })
                    }
                    onMoveEvent={(id, delta) => void handleMoveEvent(id, delta)}
                    onResizeEvent={(id, delta) => void handleResizeEvent(id, delta)}
                    onContextMenuEvent={(id, x, y) => setMenu({ id, x, y })}
                  />
                ) : view === 'month' ? (
                  <MonthView
                    monthAnchor={anchor}
                    events={calendarEvents}
                    today={now}
                    editing={editing}
                    onSelectEvent={(id) => setSelectedId(id)}
                    onOpenEditor={handleOpenEditor}
                    onCreateAt={(date) => openCreate({ date, startTime: '09:00' })}
                    onShowMore={(date) => {
                      setAnchor(new Date(`${date}T00:00`))
                      navigate('calendar', 'day')
                    }}
                  />
                ) : view === 'list' ? (
                  <ListView
                    anchor={anchor}
                    events={calendarEvents}
                    today={now}
                    onSelectEvent={(id) => setSelectedId(id)}
                    onToggleDone={(id) => {
                      const target = events.find((event) => event.id === id)
                      if (target) void handleToggleDone(target)
                    }}
                  />
                ) : view === 'day' ? (
                  <DayView
                    date={anchor}
                    events={calendarEvents}
                    today={now}
                    editing={editing}
                    nowMinute={now.getHours() * 60 + now.getMinutes()}
                    onSelectEvent={(id) => setSelectedId(id)}
                    onOpenEditor={handleOpenEditor}
                    onCreateAt={(date, hour) =>
                      openCreate({ date, startTime: `${String(hour).padStart(2, '0')}:00` })
                    }
                    onMoveEvent={(id, delta) => void handleMoveEvent(id, delta)}
                    onResizeEvent={(id, delta) => void handleResizeEvent(id, delta)}
                    onContextMenuEvent={(id, x, y) => setMenu({ id, x, y })}
                  />
                ) : (
                  <p className="placeholder">{VIEW_LABEL[view]}视图（下一步实现）</p>
                )}
              </div>
              <DetailPanel
                event={selected}
                editing={editing}
                onClose={() => setSelectedId(null)}
                onEdit={() => selected && handleOpenEditor(selected.id)}
                onToggleDone={() => selected && void handleToggleDone(selected)}
                onDelete={() => {
                  if (!selected) return
                  setDialog({ mode: 'edit', initial: selected, defaults: { date: '', startTime: '09:00' } })
                }}
                courseOccurrence={selectedCourse}
                isCourseException={selectedCourseException !== null}
                onMoveCourseOnce={() => setMoveDialogOpen(true)}
                onCancelCourseOnce={() => void handleCancelCourseOnce()}
                onClearCourseException={() => void handleClearCourseException()}
              />
            </div>
          </section>
        ) : page === 'courseTable' ? (
          <CourseTablePage
            semesters={semesters}
            semester={currentSemester}
            periods={periods}
            courses={courses}
            today={now}
            aiSlot={
              <AiCourseComposer
                semester={currentSemester}
                periods={periods}
                existingCourses={courses}
                config={aiConfig}
                runtime={aiRuntime}
                onAddCourses={handleAddAiCourses}
              />
            }
            onSelectSemester={(id) => void handleSelectSemester(id)}
            onNewSemester={() => setSemesterDialog({ mode: 'create' })}
            onEditSemester={() => setSemesterDialog({ mode: 'edit' })}
            onOpenPeriods={() => setPeriodsOpen(true)}
            onCreateCourse={(weekday, periodIndex) =>
              setCourseDialog({ mode: 'create', initial: null, defaults: { weekday, periodIndex } })
            }
            onSelectCourse={(id) => {
              const target = courses.find((course) => course.id === id) ?? null
              if (target) setCourseDialog({ mode: 'edit', initial: target, defaults: { weekday: target.weekday, periodIndex: target.startPeriod ?? 1 } })
            }}
          />
        ) : page === 'activity' || page === 'life' ? (
          <CategoryPage
            category={page}
            events={events.filter((event) => event.category === page)}
            today={now}
            onCreate={() => openCreate({ category: page })}
            onSelect={(id) => setSelectedId(id)}
            onToggleDone={(id) => {
              const target = events.find((event) => event.id === id)
              if (target) void handleToggleDone(target)
            }}
          />
        ) : page === 'todo' ? (
          <TodoPage
            events={events.filter((event) => event.kind === 'todo')}
            today={now}
            onCreate={() => openCreate({ kind: 'todo', category: 'course' })}
            onSelect={(id) => setSelectedId(id)}
            onToggleDone={(id) => {
              const target = events.find((event) => event.id === id)
              if (target) void handleToggleDone(target)
            }}
          />
        ) : page === 'settings' ? (
          <SettingsPage
            dataFilePath={resolvedStatus.dataFilePath}
            dataDir={appInfo.dataDir}
            version={appInfo.version}
            backups={backups}
            preferences={preferences}
            onOpenFolder={() => void client.openDataFolder()}
            onBackupNow={() => void handleBackupNow()}
            onRestore={handleRestore}
            onSetPreference={handleSetPreference}
            onTestAi={() => void handleTestAi()}
            onFetchModels={() => void handleFetchAiModels()}
            modelOptions={aiModelOptions}
          />
        ) : (
          <section className="page" aria-label={PAGE_LABEL[page]}>
            <div className="page__header">
              <span className="page__title">{PAGE_LABEL[page]}</span>
            </div>
            <div className="page__body">
              <p className="placeholder">{PAGE_LABEL[page]}（下一步实现）</p>
            </div>
          </section>
        )}
      </main>
      <StatusBar
        dataFilePath={resolvedStatus.dataFilePath}
        lastBackupAt={resolvedStatus.lastBackupAt}
        backupFailed={resolvedStatus.backupFailed}
        eventCount={resolvedStatus.eventCount}
        dataDirMissing={resolvedStatus.dataDirMissing}
      />
      <EventDialog
        open={dialog !== null}
        mode={dialog?.mode ?? 'create'}
        initial={dialog?.initial ?? null}
        defaults={dialog?.defaults}
        siblingEvents={calendarEvents}
        initialRepeat={dialogRepeat}
        canDelete={editing}
        onSave={(input, repeat) => void handleSave(input, repeat)}
        onDelete={() => void handleDelete()}
        onClose={() => setDialog(null)}
      />
      <SemesterDialog
        open={semesterDialog !== null}
        mode={semesterDialog?.mode ?? 'create'}
        initial={currentSemester}
        canDelete={semesterDialog?.mode === 'edit'}
        onSave={(input) => void handleSaveSemester(input)}
        onDelete={() => void handleDeleteSemester()}
        onClose={() => setSemesterDialog(null)}
      />
      <PeriodsDialog
        open={periodsOpen}
        periods={periods}
        onSave={(items) => void handleSavePeriods(items)}
        onReset={() => void handleResetPeriods()}
        onClose={() => setPeriodsOpen(false)}
      />
      <CourseDialog
        open={courseDialog !== null}
        mode={courseDialog?.mode ?? 'create'}
        initial={courseDialog?.initial ?? null}
        semesterId={currentSemesterId ?? ''}
        periods={periods}
        defaults={courseDialog?.defaults}
        canDelete
        onSave={(input) => void handleSaveCourse(input)}
        onDelete={() => void handleDeleteCourse()}
        onClose={() => setCourseDialog(null)}
      />
      <CourseMoveDialog
        open={moveDialogOpen}
        courseTitle={selected?.title ?? ''}
        originalDate={selectedCourse?.date ?? ''}
        defaultStartTime={selected?.startAt?.slice(11, 16) ?? '08:00'}
        defaultEndTime={selected?.endAt?.slice(11, 16) ?? '09:40'}
        onSave={(payload) => void handleMoveCourseOnce(payload)}
        onClose={() => setMoveDialogOpen(false)}
      />
      <ScopeDialog
        open={pendingScope !== null}
        title={pendingScope?.action === 'delete' ? '删除重复日程' : '这次修改要应用到哪些日程？'}
        confirmLabel={pendingScope?.action === 'delete' ? '删除' : '确定'}
        danger={pendingScope?.action === 'delete'}
        onSelect={(scope) => void applyScope(scope)}
        onClose={() => setPendingScope(null)}
      />
      {menu ? (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          items={menuItems}
          onSelect={handleMenuSelect}
          onClose={() => setMenu(null)}
        />
      ) : null}
      <AiStatusBadge
        status={aiStatus}
        config={aiConfig}
        onAbort={() => aiRuntime.abort()}
        onOpenSettings={() => navigate('settings', view)}
      />
      {toast ? (
        <Toast
          message={toast.message}
          actionLabel={toast.undo ? '撤销' : undefined}
          onAction={toast.undo ? () => void handleUndo() : undefined}
          onClose={() => setToast(null)}
        />
      ) : null}
    </div>
  )
}
