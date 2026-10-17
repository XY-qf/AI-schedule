import type { PageKey, ViewKey } from './navigation'
import type {
  Course,
  CourseInput,
  EventInput,
  EventItem,
  Period,
  PeriodInput,
  RepeatFreq,
  Semester,
  SemesterInput,
} from './entities'
import type { RecRule, SeriesException } from './recurrence'

/** 新建/修改重复规则时传的内容。 */
export interface RecurrencePayload {
  freq: RepeatFreq
  intervalValue?: number | null
  intervalUnit?: 'day' | 'week' | null
  byWeekdays?: number[] | null
  untilDate?: string | null
  maxCount?: number | null
}

/** 重复日程某一次的例外。 */
export interface ExceptionPayload {
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

/** 主进程 → 界面 的状态数据。 */
export interface StatusPayload {
  /** 数据文件完整路径 */
  dataFilePath: string
  /** 上次备份时间；从未备份为 null */
  lastBackupAt: string | null
  /** 上次备份是否失败 */
  backupFailed: boolean
  /** 日程总条数 */
  eventCount: number
  /** 数据目录不可用（无法创建或不可写） */
  dataDirMissing: boolean
  /** 数据目录不可用时的说明 */
  dataDirMessage: string | null
}

/** 一份自动备份。 */
export interface BackupInfo {
  fileName: string
  sizeBytes: number
  createdAt: string
}

/** 界面可调用的接口（由 preload 暴露为 window.api）。 */
export interface PreloadApi {
  getStatus(): Promise<StatusPayload>
  rememberLocation(page: PageKey, view: ViewKey): Promise<void>
  openDataFolder(): Promise<void>
  getPlatform(): Promise<{ electron: string; node: string }>
  /** 取与 [startDate, endDate] 有交集的日程 */
  listEvents(startDate: string, endDate: string): Promise<EventItem[]>
  createEvent(input: EventInput): Promise<EventItem>
  updateEvent(id: string, patch: Partial<EventInput> & { done?: boolean }): Promise<EventItem>
  deleteEvent(id: string): Promise<void>
  setEventDone(id: string, done: boolean): Promise<void>

  /* ---- 学期 ---- */
  listSemesters(): Promise<Semester[]>
  createSemester(input: SemesterInput): Promise<Semester>
  updateSemester(id: string, patch: Partial<SemesterInput>): Promise<Semester>
  deleteSemester(id: string): Promise<void>
  setCurrentSemester(id: string): Promise<void>

  /* ---- 作息时间表 ---- */
  listPeriods(): Promise<Period[]>
  savePeriods(items: PeriodInput[]): Promise<Period[]>
  resetPeriods(): Promise<Period[]>

  /* ---- 课程 ---- */
  listCourses(semesterId: string): Promise<Course[]>
  createCourse(input: CourseInput): Promise<Course>
  updateCourse(id: string, patch: Partial<CourseInput>): Promise<Course>
  deleteCourse(id: string): Promise<void>
  /** 对某一次课改期或停课 */
  setCourseException(input: {
    courseId: string
    originalDate: string
    action: 'moved' | 'cancelled'
    startAt?: string | null
    endAt?: string | null
    note?: string | null
  }): Promise<void>
  clearCourseException(courseId: string, originalDate: string): Promise<void>
  listCourseExceptions(): Promise<
    Array<{
      id: string
      courseId: string
      originalDate: string
      action: 'moved' | 'cancelled'
      startAt: string | null
      endAt: string | null
      note: string | null
    }>
  >

  /* ---- 备份与设置 ---- */
  getBackups(): Promise<BackupInfo[]>
  backupNow(): Promise<BackupInfo>
  /** 恢复后应用会重启，调用方不必再做其它处理 */
  restoreBackup(fileName: string): Promise<void>
  getPreferences(): Promise<Record<string, string>>
  setPreference(key: string, value: string): Promise<void>
  getAppInfo(): Promise<{ version: string; dataDir: string }>

  /* ---- 重复规则与例外 ---- */
  listRecurrences(): Promise<RecRule[]>
  createRecurrence(input: RecurrencePayload): Promise<RecRule>
  updateRecurrence(id: string, patch: Partial<RecurrencePayload>): Promise<RecRule>
  deleteRecurrence(id: string): Promise<void>
  listEventExceptions(): Promise<SeriesException[]>
  upsertEventException(input: ExceptionPayload): Promise<SeriesException>
  deleteEventException(id: string): Promise<void>
}
