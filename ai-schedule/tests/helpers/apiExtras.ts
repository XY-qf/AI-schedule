import type { PreloadApi } from '../../src/shared/ipc'

/**
 * 学期 / 作息表 / 课程相关接口的空实现。
 * 只测日历相关行为的测试可以直接展开这个对象，不必逐条写桩。
 */
export const EMPTY_COURSE_API: Pick<
  PreloadApi,
  | 'listSemesters'
  | 'createSemester'
  | 'updateSemester'
  | 'deleteSemester'
  | 'setCurrentSemester'
  | 'listPeriods'
  | 'savePeriods'
  | 'resetPeriods'
  | 'listCourses'
  | 'createCourse'
  | 'updateCourse'
  | 'deleteCourse'
  | 'setCourseException'
  | 'clearCourseException'
  | 'listCourseExceptions'
  | 'getBackups'
  | 'backupNow'
  | 'restoreBackup'
  | 'getPreferences'
  | 'setPreference'
  | 'getAppInfo'
  | 'onMenuAction'
  | 'listRecurrences'
  | 'createRecurrence'
  | 'updateRecurrence'
  | 'deleteRecurrence'
  | 'listEventExceptions'
  | 'upsertEventException'
  | 'deleteEventException'
> = {
  listSemesters: async () => [],
  createSemester: async () => {
    throw new Error('测试桩未实现')
  },
  updateSemester: async () => {
    throw new Error('测试桩未实现')
  },
  deleteSemester: async () => undefined,
  setCurrentSemester: async () => undefined,
  listPeriods: async () => [],
  savePeriods: async (items) =>
    items.map((item, index) => ({ id: `p${index + 1}`, orderIndex: index + 1, ...item })),
  resetPeriods: async () => [],
  listCourses: async () => [],
  createCourse: async () => {
    throw new Error('测试桩未实现')
  },
  updateCourse: async () => {
    throw new Error('测试桩未实现')
  },
  deleteCourse: async () => undefined,
  setCourseException: async () => undefined,
  clearCourseException: async () => undefined,
  listCourseExceptions: async () => [],
  getBackups: async () => [],
  backupNow: async () => ({ fileName: 'x', sizeBytes: 0, createdAt: '' }),
  restoreBackup: async () => undefined,
  getPreferences: async () => ({}),
  setPreference: async () => undefined,
  getAppInfo: async () => ({ version: '1.0.0', dataDir: '' }),
  onMenuAction: () => undefined,
  listRecurrences: async () => [],
  createRecurrence: async () => {
    throw new Error('测试桩未实现')
  },
  updateRecurrence: async () => {
    throw new Error('测试桩未实现')
  },
  deleteRecurrence: async () => undefined,
  listEventExceptions: async () => [],
  upsertEventException: async () => {
    throw new Error('测试桩未实现')
  },
  deleteEventException: async () => undefined,
}
