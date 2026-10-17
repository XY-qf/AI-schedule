import { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, shell, Tray } from 'electron'
import path from 'node:path'
import fs from 'node:fs'
import { BackupService } from './services/backup'
import { checkExecutablePath } from './pathGuard'
import { buildMenuTemplate } from './appMenu'
import {
  CoursesRepository,
  EventsRepository,
  PeriodsRepository,
  SemestersRepository,
} from './db/repositories'
import { CourseExceptionsRepository, EventExceptionsRepository, RecurrencesRepository } from './db/recurrences'
import type { CourseInput, EventInput, PeriodInput, SemesterInput } from '../shared/entities'
import type { ExceptionPayload, RecurrencePayload } from '../shared/ipc'
import { DataStore, CorruptDataFileError } from './db/store'
import { SettingsRepository } from './db/settings'
import { buildStatusPayload, unavailableStatus } from './status'
import { DataDirectoryError, ensureDataDir, resolveAppPaths, type AppPaths } from './paths'
import {
  DEFAULT_WINDOW_STATE,
  loadWindowState,
  saveWindowState,
  type WindowState,
} from './windowState'
import { isPageKey, isViewKey } from '../shared/navigation'
import type { StatusPayload, PreloadApi } from '../shared/ipc'

// ---------------------------------------------------------------------------
// 启动前的路径检查：
// Windows 上的 Electron 无法从含中文的路径启动，会直接崩掉且没有任何提示。
// 这里提前拦下来，给使用者一段能看懂的中文说明。
// ---------------------------------------------------------------------------
{
  const pathProblem = checkExecutablePath(process.execPath)
  if (pathProblem) {
    try {
      const os = require('node:os')
      fs.writeFileSync(
        require('node:path').join(os.tmpdir(), 'ai-schedule-path-error.txt'),
        pathProblem,
        'utf8',
      )
    } catch {
      /* 写日志失败不影响提示 */
    }
    if (process.env.AI_SCHEDULE_NO_DIALOG !== '1') {
      dialog.showErrorBox('程序路径含有中文，无法启动', pathProblem)
    }
    app.exit(3)
  }
}

const DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL
const SELFTEST = process.env.AI_SCHEDULE_SELFTEST === '1'

/** 自检期把关键节点写到工作目录，便于排查启动失败。 */
function diag(name: string, payload: unknown): void {
  if (!SELFTEST) return
  try {
    fs.writeFileSync(
      path.join(process.cwd(), `.diag-${name}.json`),
      JSON.stringify(payload, null, 2),
      'utf8',
    )
  } catch {
    /* 诊断失败不影响主流程 */
  }
}

diag('boot', { argv: process.argv, versions: process.versions, execPath: process.execPath })

if (SELFTEST) {
  process.on('uncaughtException', (error) => {
    diag('uncaught', {
      message: String(error),
      stack: error instanceof Error ? error.stack : null,
    })
  })
  process.on('unhandledRejection', (reason) => {
    diag('rejection', { message: String(reason) })
  })
}

/** 运行时状态；数据目录不可用时 store 为 null，界面只显示错误提示。 */
interface RuntimeState {
  paths: AppPaths
  store: DataStore | null
  settings: SettingsRepository | null
  events: EventsRepository | null
  semesters: SemestersRepository | null
  periods: PeriodsRepository | null
  courses: CoursesRepository | null
  courseExceptions: CourseExceptionsRepository | null
  recurrences: RecurrencesRepository | null
  eventExceptions: EventExceptionsRepository | null
  windowState: WindowState
  dataDirMessage: string | null
}

let runtime: RuntimeState | null = null
let backupService: BackupService | null = null

function resolveWasmPath(): string {
  // 打包后 wasm 会被解压到 app.asar.unpacked，resolve 结果同样可用
  return require.resolve('sql.js/dist/sql-wasm.wasm')
}

function getStatus(): StatusPayload {
  if (!runtime) {
    return unavailableStatus(
      { dataDir: '', dbFile: '', backupDir: '' },
      '程序尚未初始化',
    )
  }
  if (!runtime.store || !runtime.settings) {
    return unavailableStatus(runtime.paths, runtime.dataDirMessage ?? '数据目录不可用')
  }
  return buildStatusPayload({
    store: runtime.store,
    settings: runtime.settings,
    paths: runtime.paths,
    dataDirMissing: false,
    dataDirMessage: runtime.dataDirMessage,
  })
}

async function bootstrap(): Promise<RuntimeState> {
  const paths = resolveAppPaths(app.getPath('documents'))
  let dataDirMessage: string | null = null
  let store: DataStore | null = null
  let settings: SettingsRepository | null = null
  let events: EventsRepository | null = null
  let semesters: SemestersRepository | null = null
  let periods: PeriodsRepository | null = null
  let courses: CoursesRepository | null = null
  let courseExceptions: CourseExceptionsRepository | null = null
  let recurrences: RecurrencesRepository | null = null
  let eventExceptions: EventExceptionsRepository | null = null

  try {
    ensureDataDir(paths)
    store = await DataStore.open({ filePath: paths.dbFile, wasmPath: resolveWasmPath() })
    settings = new SettingsRepository(store)
    events = new EventsRepository(store)
    semesters = new SemestersRepository(store)
    periods = new PeriodsRepository(store)
    courses = new CoursesRepository(store)
    courseExceptions = new CourseExceptionsRepository(store)
    recurrences = new RecurrencesRepository(store)
    eventExceptions = new EventExceptionsRepository(store)
  } catch (error) {
    if (error instanceof DataDirectoryError) {
      dataDirMessage = error.message
    } else if (error instanceof CorruptDataFileError) {
      dataDirMessage = `${error.message}。可以从备份恢复数据。`
    } else {
      dataDirMessage = `数据文件无法打开：${String(error)}`
    }
    dialog.showErrorBox('无法使用数据文件', dataDirMessage)
  }

  const windowState = settings ? loadWindowState(settings) : { ...DEFAULT_WINDOW_STATE }
  return {
    paths,
    store,
    settings,
    events,
    semesters,
    periods,
    courses,
    courseExceptions,
    recurrences,
    eventExceptions,
    windowState,
    dataDirMessage,
  }
}

function createMainWindow(state: RuntimeState): BrowserWindow {
  const bounds = state.windowState
  const win = new BrowserWindow({
    width: bounds.width,
    height: bounds.height,
    ...(bounds.x !== null && bounds.y !== null ? { x: bounds.x, y: bounds.y } : {}),
    minWidth: 1024,
    minHeight: 640,
    title: 'AI 日程',
    backgroundColor: '#f7f8fa',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  })

  if (bounds.maximized) win.maximize()
  mainWindow = win
  win.once('ready-to-show', () => win.show())

  if (DEV_SERVER_URL) {
    const url = new URL(DEV_SERVER_URL)
    url.searchParams.set('page', bounds.lastPage)
    url.searchParams.set('view', bounds.lastView)
    void win.loadURL(url.toString())
  } else {
    void win.loadFile(path.join(__dirname, '../renderer/index.html'), {
      query: { page: bounds.lastPage, view: bounds.lastView },
    })
  }

  const persist = (): void => {
    if (!runtime?.settings) return
    const normal = win.getNormalBounds()
    saveWindowState(runtime.settings, {
      ...runtime.windowState,
      x: normal.x,
      y: normal.y,
      width: normal.width,
      height: normal.height,
      maximized: win.isMaximized(),
    })
  }

  win.on('close', (event) => {
    persist()
    // 点叉号只隐藏窗口，程序继续在托盘里运行，为后续的提醒功能留出空间（反馈第 6 条）
    if (!isQuitting) {
      event.preventDefault()
      win.hide()
    }
  })

  return win
}

function registerIpc(): void {
  ipcMain.handle('status:get', () => getStatus())

  ipcMain.handle('app:rememberLocation', (_event, page: unknown, view: unknown) => {
    if (!runtime?.settings) return
    if (isPageKey(page)) {
      runtime.windowState = { ...runtime.windowState, lastPage: page }
      runtime.settings.set('app.lastPage', page)
    }
    if (isViewKey(view)) {
      runtime.windowState = { ...runtime.windowState, lastView: view }
      runtime.settings.set('app.lastView', view)
    }
  })

  ipcMain.handle('app:openDataFolder', async () => {
    if (!runtime) return
    await shell.openPath(runtime.paths.dataDir)
  })

  ipcMain.handle('app:platform', () => ({
    electron: process.versions.electron ?? 'unknown',
    node: process.versions.node,
  }))

  const requireEvents = (): EventsRepository => {
    if (!runtime?.events) throw new Error('数据目录不可用，暂时无法读写日程')
    return runtime.events
  }

  ipcMain.handle('events:list', (_event, startDate: unknown, endDate: unknown) => {
    if (typeof startDate !== 'string' || typeof endDate !== 'string') return []
    return requireEvents().listInRange(startDate, endDate)
  })

  ipcMain.handle('events:listAll', () => requireEvents().list())
  ipcMain.handle('events:create', (_event, input: EventInput) => requireEvents().create(input))

  ipcMain.handle('events:update', (_event, id: string, patch: Partial<EventInput> & { done?: boolean }) =>
    requireEvents().update(id, patch),
  )

  ipcMain.handle('events:delete', (_event, id: string) => {
    requireEvents().remove(id)
  })

  ipcMain.handle('events:setDone', (_event, id: string, done: boolean) => {
    requireEvents().setDone(id, Boolean(done))
  })

  const requireSemesters = (): SemestersRepository => {
    if (!runtime?.semesters) throw new Error('数据目录不可用，暂时无法读写学期')
    return runtime.semesters
  }
  const requirePeriods = (): PeriodsRepository => {
    if (!runtime?.periods) throw new Error('数据目录不可用，暂时无法读写作息时间表')
    return runtime.periods
  }
  const requireCourses = (): CoursesRepository => {
    if (!runtime?.courses) throw new Error('数据目录不可用，暂时无法读写课程')
    return runtime.courses
  }
  const requireRecurrences = (): RecurrencesRepository => {
    if (!runtime?.recurrences) throw new Error('数据目录不可用，暂时无法读写重复规则')
    return runtime.recurrences
  }
  const requireEventExceptions = (): EventExceptionsRepository => {
    if (!runtime?.eventExceptions) throw new Error('数据目录不可用，暂时无法读写重复日程的例外')
    return runtime.eventExceptions
  }
  const requireCourseExceptions = (): CourseExceptionsRepository => {
    if (!runtime?.courseExceptions) throw new Error('数据目录不可用，暂时无法读写调课记录')
    return runtime.courseExceptions
  }

  ipcMain.handle('semesters:list', () => requireSemesters().list())
  ipcMain.handle('semesters:create', (_event, input: SemesterInput) => requireSemesters().create(input))
  ipcMain.handle('semesters:update', (_event, id: string, patch: Partial<SemesterInput>) =>
    requireSemesters().update(id, patch),
  )
  ipcMain.handle('semesters:delete', (_event, id: string) => {
    requireSemesters().remove(id)
  })
  ipcMain.handle('semesters:setCurrent', (_event, id: string) => {
    requireSemesters().setCurrent(id)
  })

  ipcMain.handle('periods:list', () => requirePeriods().ensureDefaults())
  ipcMain.handle('periods:save', (_event, items: PeriodInput[]) => requirePeriods().replaceAll(items))
  ipcMain.handle('periods:reset', () => requirePeriods().resetDefaults())

  ipcMain.handle('courses:list', (_event, semesterId: string) => requireCourses().list(semesterId))
  ipcMain.handle('courses:create', (_event, input: CourseInput) => requireCourses().create(input))
  ipcMain.handle('courses:update', (_event, id: string, patch: Partial<CourseInput>) =>
    requireCourses().update(id, patch),
  )
  ipcMain.handle('courses:delete', (_event, id: string) => {
    requireCourses().remove(id)
  })
  ipcMain.handle(
    'courses:exception',
    (
      _event,
      input: {
        courseId: string
        originalDate: string
        action: 'moved' | 'cancelled'
        startAt?: string | null
        endAt?: string | null
        note?: string | null
      },
    ) => {
      requireCourseExceptions().upsert(input)
    },
  )
  ipcMain.handle('courses:exceptions', () => requireCourseExceptions().listAll())

  ipcMain.handle('backup:list', () => backupService?.list() ?? [])
  ipcMain.handle('backup:now', () => {
    if (!backupService) throw new Error('备份服务尚未就绪')
    return backupService.create(new Date(), 'manual')
  })
  ipcMain.handle('backup:restore', async (_event, fileName: string) => {
    if (!backupService) throw new Error('备份服务尚未就绪')
    await backupService.restore(fileName)
    // 恢复后重启，保证内存里不再有旧数据
    app.relaunch()
    app.exit(0)
  })
  ipcMain.handle('prefs:all', () => runtime?.settings?.all() ?? {})
  ipcMain.handle('prefs:set', (_event, key: string, value: string) => {
    if (typeof key !== 'string' || !runtime?.settings) return
    runtime.settings.set(key, String(value))
  })
  ipcMain.handle('recurrences:list', () => requireRecurrences().list())
  ipcMain.handle('recurrences:create', (_event, input: RecurrencePayload) => requireRecurrences().create(input))
  ipcMain.handle('recurrences:update', (_event, id: string, patch: Partial<RecurrencePayload>) =>
    requireRecurrences().update(id, patch),
  )
  ipcMain.handle('recurrences:delete', (_event, id: string) => {
    requireRecurrences().remove(id)
  })
  ipcMain.handle('eventExceptions:list', () => requireEventExceptions().listAll())
  ipcMain.handle('eventExceptions:upsert', (_event, input: ExceptionPayload) =>
    requireEventExceptions().upsert(input),
  )
  ipcMain.handle('eventExceptions:delete', (_event, id: string) => {
    requireEventExceptions().remove(id)
  })

  ipcMain.handle('app:info', () => ({
    version: app.getVersion(),
    dataDir: runtime?.paths.dataDir ?? '',
  }))
  ipcMain.handle('courses:clearException', (_event, courseId: string, originalDate: string) => {
    const existing = requireCourseExceptions().getByDate(courseId, originalDate)
    if (existing) requireCourseExceptions().remove(existing.id)
  })
}

// ---------------------------------------------------------------------------
// 单实例：重复点图标不应再开一个新窗（用户反馈第 3 条）
// ---------------------------------------------------------------------------
let mainWindow: BrowserWindow | null = null
let tray: Tray | null = null
let isQuitting = false

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    const win = mainWindow ?? BrowserWindow.getAllWindows()[0] ?? null
    if (!win) {
      if (runtime) mainWindow = createMainWindow(runtime)
      return
    }
    if (win.isMinimized()) win.restore()
    win.show()
    win.focus()
  })
}

app.whenReady().then(async () => {
  runtime = await bootstrap()
  registerIpc()
  setupBackup(runtime)
  const win = createMainWindow(runtime)
  setupMenu(win)
  setupTray(win)
  if (process.env.AI_SCHEDULE_SELFTEST === '1') void runSelfTest(win)

  app.on('activate', () => {
    const existing = BrowserWindow.getAllWindows()[0]
    if (existing) {
      existing.show()
      existing.focus()
      return
    }
    if (runtime) mainWindow = createMainWindow(runtime)
  })
})

/** 每日首次启动时做一次备份；失败只记录状态，不打断启动。 */
function setupBackup(state: RuntimeState): void {
  backupService = new BackupService({
    backupDir: state.paths.backupDir,
    dbFilePath: state.paths.dbFile,
    store: () => runtime?.store ?? null,
    settings: () => runtime?.settings ?? null,
    wasmPath: resolveWasmPath(),
  })
  if (!state.store || !state.settings) return
  try {
    backupService.runDailyIfNeeded()
  } catch (error) {
    console.warn('每日备份失败', error)
  }
}

/**
 * 自动化自检（仅开发期使用）：启动窗口后检查界面是否真的挂载、
 * preload 接口是否可用，把结果写到 .selftest.json 再退出。
 * 由 AI_SCHEDULE_SELFTEST=1 触发，正常使用不会走这里。
 */
async function runSelfTest(win: BrowserWindow): Promise<void> {
  const outFile = path.join(process.cwd(), '.selftest.json')
  const finish = (payload: unknown, code: number): void => {
    try {
      fs.writeFileSync(outFile, JSON.stringify(payload, null, 2), 'utf8')
    } catch {
      /* 写不出结果时只能靠退出码 */
    }
    app.exit(code)
  }

  const timer = setTimeout(() => finish({ ok: false, reason: '等待界面加载超时' }, 1), 25000)

  win.webContents.on('did-finish-load', () => {
    const probe = `(() => ({
      navItems: document.querySelectorAll('.app-nav .nav-item').length,
      toolbarTitle: (document.querySelector('[data-testid="toolbar-title"]') || {}).textContent || null,
      statusText: (document.querySelector('.app-status') || {}).textContent || null,
      hasApi: !!(window.api && typeof window.api.getStatus === 'function'),
      rootChildren: (document.getElementById('root') || {}).childElementCount || 0,
      bodyText: (document.body.textContent || '').replace(/\\s+/g, ' ').slice(0, 160)
    }))()`

    // 界面是异步渲染的，did-finish-load 时可能还是空的，这里轮询到画出来为止
    const startedAt = Date.now()
    const poll = async (): Promise<void> => {
      try {
        const result = (await win.webContents.executeJavaScript(probe)) as {
          navItems: number
          hasApi: boolean
        }
        const ready = result.navItems > 0 && result.hasApi
        if (ready || Date.now() - startedAt > 15000) {
          clearTimeout(timer)
          finish({ ok: ready, result, dataFilePath: runtime?.paths.dbFile ?? null }, ready ? 0 : 1)
          return
        }
        setTimeout(() => void poll(), 300)
      } catch (error) {
        clearTimeout(timer)
        finish({ ok: false, reason: String(error) }, 1)
      }
    }
    void poll()
  })
}

app.on('before-quit', () => {
  isQuitting = true
})

/** 托盘：关窗后还能从托盘重新打开或真正退出。 */
function setupTray(win: BrowserWindow): void {
  try {
    const iconPath = path.join(__dirname, '..', '..', 'resources', 'icon.ico')
    const image = nativeImage.createFromPath(iconPath)
    tray = new Tray(image.isEmpty() ? nativeImage.createEmpty() : image)
    tray.setToolTip('AI 日程')
    tray.setContextMenu(
      Menu.buildFromTemplate([
        {
          label: '显示主窗口',
          click: () => {
            win.show()
            win.focus()
          },
        },
        { label: '新建日程', click: () => win.webContents.send('menu:action', 'new') },
        { type: 'separator' },
        {
          label: '退出',
          click: () => {
            isQuitting = true
            app.quit()
          },
        },
      ]),
    )
    tray.on('click', () => {
      win.show()
      win.focus()
    })
  } catch (error) {
    console.warn('托盘创建失败', error)
  }
}

/** 全中文的应用菜单（反馈第 2 条）。 */
function setupMenu(win: BrowserWindow): void {
  const send = (action: string): void => {
    win.show()
    win.focus()
    win.webContents.send('menu:action', action)
  }
  Menu.setApplicationMenu(
    Menu.buildFromTemplate(
      buildMenuTemplate({
        onNewEvent: () => send('new'),
        onToday: () => send('today'),
        onPrev: () => send('prev'),
        onNext: () => send('next'),
        onOpenSettings: () => send('settings'),
        onQuit: () => {
          isQuitting = true
          app.quit()
        },
        onAbout: () => {
          dialog.showMessageBox(win, {
            type: 'info',
            title: '关于 AI 日程',
            message: 'AI 日程（个人版）1.0.0',
            detail: '本地存储，不联网。数据保存在「文档\\AI日程」目录。',
            buttons: ['好'],
          })
        },
        onReload: () => win.reload(),
        onToggleDevTools: () => win.webContents.toggleDevTools(),
      }),
    ),
  )
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => {
  // 退出前再备份一份；备份失败不能阻塞退出，数据本身已经逐次落盘。
  try {
    if (backupService && runtime?.store) backupService.create(new Date(), 'quit')
  } catch (error) {
    console.warn('退出备份失败', error)
  }
  runtime?.store?.close()
})

export type { PreloadApi }
