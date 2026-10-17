import type { PreloadApi } from '../shared/ipc'

/** 没有 Electron 时（浏览器预览 / 组件测试）使用的空实现。 */
const fallback: PreloadApi = {
  getStatus: async () => ({
    dataFilePath: '文档\\AI日程\\schedule.db',
    lastBackupAt: null,
    backupFailed: false,
    eventCount: 0,
    dataDirMissing: false,
    dataDirMessage: null,
  }),
  rememberLocation: async () => undefined,
  openDataFolder: async () => undefined,
  getPlatform: async () => ({ electron: '—', node: '—' }),
  listEvents: async () => [],
  createEvent: async () => {
    throw new Error('当前环境不可保存日程')
  },
  updateEvent: async () => {
    throw new Error('当前环境不可保存日程')
  },
  deleteEvent: async () => undefined,
  setEventDone: async () => undefined,
  listSemesters: async () => [],
  createSemester: async () => {
    throw new Error('当前环境不可保存学期')
  },
  updateSemester: async () => {
    throw new Error('当前环境不可保存学期')
  },
  deleteSemester: async () => undefined,
  setCurrentSemester: async () => undefined,
  listPeriods: async () => [],
  savePeriods: async (items) => items.map((item, index) => ({ id: `p${index + 1}`, orderIndex: index + 1, ...item })),
  resetPeriods: async () => [],
  listCourses: async () => [],
  createCourse: async () => {
    throw new Error('当前环境不可保存课程')
  },
  updateCourse: async () => {
    throw new Error('当前环境不可保存课程')
  },
  deleteCourse: async () => undefined,
  setCourseException: async () => undefined,
  clearCourseException: async () => undefined,
  listCourseExceptions: async () => [],
  getBackups: async () => [],
  backupNow: async () => {
    throw new Error('当前环境不可备份')
  },
  restoreBackup: async () => undefined,
  getPreferences: async () => ({}),
  setPreference: async () => undefined,
  getAppInfo: async () => ({ version: '1.0.0', dataDir: '' }),
  listRecurrences: async () => [],
  createRecurrence: async () => {
    throw new Error('当前环境不可保存重复规则')
  },
  updateRecurrence: async () => {
    throw new Error('当前环境不可保存重复规则')
  },
  deleteRecurrence: async () => undefined,
  listEventExceptions: async () => [],
  upsertEventException: async () => {
    throw new Error('当前环境不可保存例外')
  },
  deleteEventException: async () => undefined,
}

export function getApi(): PreloadApi {
  return window.api ?? fallback
}
