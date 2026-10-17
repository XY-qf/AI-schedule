import { contextBridge, ipcRenderer } from 'electron'
import type { PreloadApi, StatusPayload, RecurrencePayload, ExceptionPayload } from '../shared/ipc'
import type { PageKey, ViewKey } from '../shared/navigation'
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

const api: PreloadApi = {
  getStatus: (): Promise<StatusPayload> => ipcRenderer.invoke('status:get'),
  rememberLocation: (page: PageKey, view: ViewKey): Promise<void> =>
    ipcRenderer.invoke('app:rememberLocation', page, view),
  openDataFolder: (): Promise<void> => ipcRenderer.invoke('app:openDataFolder'),
  getPlatform: (): Promise<{ electron: string; node: string }> =>
    ipcRenderer.invoke('app:platform'),

  listEvents: (startDate: string, endDate: string): Promise<EventItem[]> =>
    ipcRenderer.invoke('events:list', startDate, endDate),
  createEvent: (input: EventInput): Promise<EventItem> => ipcRenderer.invoke('events:create', input),
  updateEvent: (id: string, patch: Partial<EventInput> & { done?: boolean }): Promise<EventItem> =>
    ipcRenderer.invoke('events:update', id, patch),
  deleteEvent: (id: string): Promise<void> => ipcRenderer.invoke('events:delete', id),
  setEventDone: (id: string, done: boolean): Promise<void> =>
    ipcRenderer.invoke('events:setDone', id, done),

  listSemesters: (): Promise<Semester[]> => ipcRenderer.invoke('semesters:list'),
  createSemester: (input: SemesterInput): Promise<Semester> =>
    ipcRenderer.invoke('semesters:create', input),
  updateSemester: (id: string, patch: Partial<SemesterInput>): Promise<Semester> =>
    ipcRenderer.invoke('semesters:update', id, patch),
  deleteSemester: (id: string): Promise<void> => ipcRenderer.invoke('semesters:delete', id),
  setCurrentSemester: (id: string): Promise<void> => ipcRenderer.invoke('semesters:setCurrent', id),

  listPeriods: (): Promise<Period[]> => ipcRenderer.invoke('periods:list'),
  savePeriods: (items: PeriodInput[]): Promise<Period[]> =>
    ipcRenderer.invoke('periods:save', items),
  resetPeriods: (): Promise<Period[]> => ipcRenderer.invoke('periods:reset'),

  listCourses: (semesterId: string): Promise<Course[]> =>
    ipcRenderer.invoke('courses:list', semesterId),
  createCourse: (input: CourseInput): Promise<Course> => ipcRenderer.invoke('courses:create', input),
  updateCourse: (id: string, patch: Partial<CourseInput>): Promise<Course> =>
    ipcRenderer.invoke('courses:update', id, patch),
  deleteCourse: (id: string): Promise<void> => ipcRenderer.invoke('courses:delete', id),
  setCourseException: (input): Promise<void> => ipcRenderer.invoke('courses:exception', input),
  clearCourseException: (courseId: string, originalDate: string): Promise<void> =>
    ipcRenderer.invoke('courses:clearException', courseId, originalDate),
  listCourseExceptions: () => ipcRenderer.invoke('courses:exceptions'),

  getBackups: () => ipcRenderer.invoke('backup:list'),
  backupNow: () => ipcRenderer.invoke('backup:now'),
  restoreBackup: (fileName: string) => ipcRenderer.invoke('backup:restore', fileName),
  getPreferences: () => ipcRenderer.invoke('prefs:all'),
  setPreference: (key: string, value: string) => ipcRenderer.invoke('prefs:set', key, value),
  getAppInfo: () => ipcRenderer.invoke('app:info'),

  listRecurrences: () => ipcRenderer.invoke('recurrences:list'),
  createRecurrence: (input: RecurrencePayload) => ipcRenderer.invoke('recurrences:create', input),
  updateRecurrence: (id: string, patch: Partial<RecurrencePayload>) =>
    ipcRenderer.invoke('recurrences:update', id, patch),
  deleteRecurrence: (id: string) => ipcRenderer.invoke('recurrences:delete', id),
  listEventExceptions: () => ipcRenderer.invoke('eventExceptions:list'),
  upsertEventException: (input: ExceptionPayload) => ipcRenderer.invoke('eventExceptions:upsert', input),
  deleteEventException: (id: string) => ipcRenderer.invoke('eventExceptions:delete', id),
}

contextBridge.exposeInMainWorld('api', api)
