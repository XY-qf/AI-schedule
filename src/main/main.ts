import { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, protocol, shell, Tray } from 'electron'
import path from 'node:path'
import fs from 'node:fs'
import { Readable } from 'node:stream'
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
import { resolveRendererAsset } from './rendererProtocol'
import {
  clearBootPending,
  clearGpuCompatState,
  decideGpuCompat,
  markBootPending,
  readBootPending,
  readGpuCompatState,
  writeGpuCompatState,
} from './gpuCompat'
import { probeGpuLadder } from './gpuProbe'
import { gpuCompatSwitches } from '../shared/gpuCompat'
import { listModels, streamChat } from './aiClient'
import type { AiChatPayload, AiModelsPayload } from '../shared/aiChat'
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

// ---------------------------------------------------------------------------
// 打包后界面用自定义协议加载，而不是 file://。
//
// 原因：AI 课程助手要在渲染进程里跑 Web Worker + WebAssembly（ONNX Runtime），
// 还要从 Hugging Face 下载模型。file:// 下模块化 Worker、fetch 资源、
// WebGPU 的安全上下文都会被浏览器拦掉；换成注册为 secure 的 app:// 就没有这些问题。
// 万一协议加载失败会自动退回 file://，保证界面本身还能打开。
// ---------------------------------------------------------------------------
const RENDERER_SCHEME = 'app'
const RENDERER_ORIGIN = 'app://bundle'
const USE_FILE_PROTOCOL = process.env.AI_SCHEDULE_FILE_PROTOCOL === '1'

// ---------------------------------------------------------------------------
// GPU 兼容模式（分级）：某些机器上 Chromium 的 GPU 子进程起不来（error_code=18），
// 程序会直接崩在启动阶段。上次哪一级没走完就往下再降一级：
//   gpu-sandbox（保留硬件加速）→ in-process → software（保证能开）。
//
// 后来又加了两条，因为这个崩溃对用户来说太痛（必崩、JS 捕获不到）：
//   1. 开窗前先用同样开关起个探针进程实测（gpuProbe.ts），选第一级真能起来的，
//      避免「第一次启动必然崩一下」；
//   2. 启动成功后把这一级永久记住（retryAt=null），不再 7 天后又拿坏显卡试一次。
// ---------------------------------------------------------------------------
const gpuCompatFile = path.join(app.getPath('userData'), 'gpu-compat.json')
const bootPendingFile = path.join(app.getPath('userData'), 'boot.pending')
let gpuDecision = decideGpuCompat({
  argv: process.argv,
  env: process.env as Record<string, string | undefined>,
  lastPendingMode: readBootPending(bootPendingFile),
  state: readGpuCompatState(gpuCompatFile),
  now: Date.now(),
})

// 只知道「没有记录」或「上次崩了」时才值得花一两秒体检；已知可用就直接启动。
if (
  !SELFTEST &&
  process.env.AI_SCHEDULE_NO_GPU_PROBE !== '1' &&
  (gpuDecision.reason === null || gpuDecision.reason === 'crash')
) {
  const probed = probeGpuLadder()
  console.warn(`[gpu-compat] probe=${probed ?? 'all-failed'} (was ${gpuDecision.mode}/${gpuDecision.reason ?? 'unknown'})`)
  if (probed) gpuDecision = { mode: probed, reason: 'probe' }
}

for (const flag of gpuCompatSwitches(gpuDecision.mode)) {
  app.commandLine.appendSwitch(flag)
}
if (gpuDecision.mode !== 'off') {
  // 前半段用 ASCII：控制台/重定向日志的编码五花八门，中文容易变乱码
  console.warn(
    `[gpu-compat] mode=${gpuDecision.mode} reason=${gpuDecision.reason ?? 'unknown'} switches=${gpuCompatSwitches(gpuDecision.mode).join(',')}`,
  )
}
markBootPending(bootPendingFile, gpuDecision.mode, Date.now())

/**
 * 界面加载成功 = 这一级确实能用：永久记住它，下次直接用。
 *
 * 之前只有在「崩过一次」时才记、而且 7 天后会重试坏显卡——结果就是
 * 每隔一周用户会再看到一次同样的崩溃；手动加 `--in-process-gpu` 启动一次
 * 还会把崩溃记录洗掉，于是下次又从 off 崩起。现在无论怎么起来（自动探针、
 * 命令行、环境变量）都记下来，只有菜单里的「重新检测显卡」会清掉。
 */
function markBootCompleted(): void {
  clearBootPending(bootPendingFile)
  writeGpuCompatState(gpuCompatFile, { mode: gpuDecision.mode, retryAt: null })
}

/** 菜单里的「重新检测显卡」：忘掉记住的级别并重启，重新体检一次。 */
function resetGpuCompatAndRelaunch(): void {
  clearGpuCompatState(gpuCompatFile)
  clearBootPending(bootPendingFile)
  isQuitting = true
  app.relaunch()
  app.quit()
}

protocol.registerSchemesAsPrivileged([
  {
    scheme: RENDERER_SCHEME,
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      stream: true,
    },
  },
])

/** 界面资源的 MIME 与路径解析在 rendererProtocol.ts 里，便于单独测试。 */

/**
 * 把 app://bundle/xxx 映射到打包后的 dist/renderer/xxx。
 *
 * 用 fs 读而不是 net.fetch('file://…')：这样 asar 内的文件（以及 asarUnpack 出来的
 * 文件）都能按 Electron 的透明映射读到，26 MB 的 wasm 也不用整块读进内存。
 */
function registerRendererProtocol(): void {
  const rendererRoot = path.normalize(path.join(__dirname, '../renderer'))
  protocol.handle(RENDERER_SCHEME, async (request) => {
    try {
      const asset = resolveRendererAsset(rendererRoot, request.url)
      if (!asset) return new Response('Forbidden', { status: 403 })
      if (!fs.existsSync(asset.target)) return new Response('Not Found', { status: 404 })
      const stat = fs.statSync(asset.target)
      if (!stat.isFile()) return new Response('Not Found', { status: 404 })

      const body = Readable.toWeb(fs.createReadStream(asset.target)) as unknown as ReadableStream
      return new Response(body, {
        status: 200,
        headers: { 'content-type': asset.mime, 'content-length': String(stat.size) },
      })
    } catch (error) {
      return new Response(`界面资源加载失败：${String(error)}`, {
        status: 500,
        headers: { 'content-type': 'text/plain; charset=utf-8' },
      })
    }
  })
}


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

/**
 * 主进程兜底：把未捕获异常写进日志，而不是弹 Electron 默认的
 * 「A JavaScript error occurred in the main process」大白框。
 *
 * 本程序每次写入都即时落盘，单次异常不会丢数据；记录后继续运行，
 * 让用户仍能正常操作/退出。日志在 %APPDATA%\AI-Schedule\main-error.log。
 */
function logMainError(kind: string, error: unknown): void {
  const detail =
    error instanceof Error ? `${error.message}\n${error.stack ?? ''}` : String(error)
  console.error(`[main] ${kind}`, error)
  try {
    fs.appendFileSync(
      path.join(app.getPath('userData'), 'main-error.log'),
      `[${new Date().toISOString()}] ${kind}\n${detail}\n\n`,
      'utf8',
    )
  } catch {
    /* 日志写不出去也不能再抛 */
  }
}

process.on('uncaughtException', (error) => logMainError('uncaughtException', error))
process.on('unhandledRejection', (reason) => logMainError('unhandledRejection', reason))

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
/** 正在进行中的云端 AI 请求，用于「停止」 */
const activeChats = new Map<string, AbortController>()

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
  win.webContents.once('did-finish-load', () => markBootCompleted())

  // 远程控制/串流软件常把 Ctrl+Shift+I 吞掉，这里直接监听按键，F12 也能开
  win.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return
    const isF12 = input.key === 'F12'
    const isCtrlShiftI = input.control && input.shift && input.key.toLowerCase() === 'i'
    if (!isF12 && !isCtrlShiftI) return
    event.preventDefault()
    if (win.webContents.isDevToolsOpened()) win.webContents.closeDevTools()
    else win.webContents.openDevTools({ mode: 'detach' })
  })

  const gpuQuery = gpuDecision.mode !== 'off' ? `&gpuCompat=${gpuDecision.mode}` : ''
  const fileQuery: Record<string, string> = {
    page: bounds.lastPage,
    view: bounds.lastView,
  }
  if (gpuDecision.mode !== 'off') fileQuery.gpuCompat = gpuDecision.mode

  if (DEV_SERVER_URL) {
    const url = new URL(DEV_SERVER_URL)
    url.searchParams.set('page', bounds.lastPage)
    url.searchParams.set('view', bounds.lastView)
    if (gpuDecision.mode !== 'off') url.searchParams.set('gpuCompat', gpuDecision.mode)
    void win.loadURL(url.toString())
  } else if (USE_FILE_PROTOCOL) {
    void win.loadFile(path.join(__dirname, '../renderer/index.html'), { query: fileQuery })
  } else {
    const query = `?page=${encodeURIComponent(bounds.lastPage)}&view=${encodeURIComponent(bounds.lastView)}${gpuQuery}`
    let fellBack = false
    const fallbackToFile = (): void => {
      if (fellBack) return
      fellBack = true
      // 窗口/页面已经在退出流程里销毁时不能再 loadFile：同步会抛
      // 「Object has been destroyed」，变成一个无人处理的 Promise 拒绝
      try {
        if (win.isDestroyed() || win.webContents.isDestroyed()) return
        console.warn('自定义协议加载失败，退回 file:// 加载界面')
        void win
          .loadFile(path.join(__dirname, '../renderer/index.html'), { query: fileQuery })
          .catch((error) => console.warn('退回 file:// 也失败了', error))
      } catch (error) {
        console.warn('退回 file:// 也失败了', error)
      }
    }
    win.webContents.on('did-fail-load', (_event, errorCode, errorDescription, _url, isMainFrame) => {
      if (!isMainFrame) return
      console.warn('界面加载失败', errorCode, errorDescription)
      fallbackToFile()
    })
    void win.loadURL(`${RENDERER_ORIGIN}/index.html${query}`).catch(() => fallbackToFile())

    // 协议能返回 index.html、但脚本被挡住时窗口会是白屏，这里再兜一层：
    // 8 秒内 #root 一直没挂上东西就退回 file://（此时 AI 功能不可用，界面照常可用）。
    if (!SELFTEST) {
      let checks = 0
      const timer = setInterval(() => {
        checks += 1
        if (fellBack || win.isDestroyed()) {
          clearInterval(timer)
          return
        }
        void win.webContents
          .executeJavaScript(
            "Boolean(document.getElementById('root') && document.getElementById('root').childElementCount)",
            true,
          )
          .then((mounted: unknown) => {
            if (mounted) clearInterval(timer)
          })
          .catch(() => undefined)
        if (checks >= 16) {
          clearInterval(timer)
          console.warn('app:// 加载后界面一直没有挂载，退回 file://')
          fallbackToFile()
        }
      }, 500)
      win.once('closed', () => clearInterval(timer))
    }
  }

  const persist = (): void => {
    // 退出流程里数据仓库可能已经关了（重复 close、强制退出等）。
    // 这时保存窗口状态必然失败，但绝不能让它把异常抛到主进程，
    // 否则 Electron 会弹「A JavaScript error occurred in the main process」。
    if (!runtime?.settings || !runtime.store?.isOpen) return
    try {
      const normal = win.getNormalBounds()
      saveWindowState(runtime.settings, {
        ...runtime.windowState,
        x: normal.x,
        y: normal.y,
        width: normal.width,
        height: normal.height,
        maximized: win.isMaximized(),
      })
    } catch (error) {
      console.warn('保存窗口状态失败（不影响退出）', error)
    }
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
    // 恢复后重启，保证内存里不再有旧数据；app.exit 不走 will-quit，这里手动关库
    runtime?.store?.close()
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

  registerAiIpc()
}

/**
 * 云端 AI 的 IPC。
 *
 * 渲染进程不能直连第三方接口（自定义 app:// origin 会被 CORS 挡），
 * 所以由主进程代发请求，并把流式分片按请求 id 推回去。
 */
function registerAiIpc(): void {
  ipcMain.handle('ai:chat', async (event, payload: AiChatPayload) => {
    const apiKey = (payload.apiKey ?? '').trim() || (process.env.DEEPSEEK_API_KEY ?? '').trim() ||
      (process.env.SILICONFLOW_API_KEY ?? '').trim()
    if (!apiKey) {
      return { ok: false, error: '还没配置 API Key：请到「设置 → AI 助手」填写 DeepSeek 的 Key' }
    }
    if (!payload.baseUrl?.trim()) return { ok: false, error: '接口地址为空' }
    if (!payload.model?.trim()) return { ok: false, error: '模型名为空' }

    const controller = new AbortController()
    activeChats.set(payload.id, controller)
    const sender = event.sender
    const hasImage = payload.messages.some((message) => Array.isArray(message.content))
    console.log(
      `[ai] chat start model=${payload.model} image=${hasImage ? 'yes' : 'no'} tools=${payload.tools?.length ?? 0}`,
    )
    try {
      const result = await streamChat(payload, {
        apiKey,
        signal: controller.signal,
        onChunk: (chunk) => {
          if (!sender.isDestroyed()) sender.send('ai:chunk', payload.id, chunk)
        },
      })
      console.log(
        `[ai] chat done text=${result.text.length} chars toolCalls=${result.toolCalls.length} finish=${result.finishReason ?? '-'}`,
      )
      return {
        ok: true,
        text: result.text,
        toolCalls: result.toolCalls,
        finishReason: result.finishReason,
      }
    } catch (error) {
      const aborted = controller.signal.aborted
      const raw = String((error as Error)?.message ?? error)
      const base =
        aborted
          ? '已停止'
          : (error as Error)?.name === 'AbortError'
            ? '请求超时，请检查网络或稍后重试'
            : raw
      // 模型名写错是最常见的坑，给一句能直接照做的提示
      const message = /model/i.test(base) && /not\s*exist|不存在|invalid|unknown|无可用/i.test(base)
        ? `${base}（模型名可能不对：到「设置 → AI 助手」改模型，或跑 python scripts/ai-probe.py --list deepseek 看可用 id）`
        : base
      if (!sender.isDestroyed()) sender.send('ai:chunk', payload.id, { type: 'error', message })
      console.warn(`[ai] chat failed: ${message}`)
      return { ok: false, error: message }
    } finally {
      activeChats.delete(payload.id)
    }
  })

  ipcMain.on('ai:cancel', (_event, id: string) => {
    activeChats.get(id)?.abort()
  })

  ipcMain.handle('ai:models', async (_event, payload: AiModelsPayload) => {
    const apiKey = (payload.apiKey ?? '').trim() || (process.env.DEEPSEEK_API_KEY ?? '').trim() ||
      (process.env.SILICONFLOW_API_KEY ?? '').trim()
    if (!apiKey) return { ok: false, error: '还没配置 API Key', models: [] }
    if (!payload.baseUrl?.trim()) return { ok: false, error: '接口地址为空', models: [] }
    try {
      const models = await listModels({ baseUrl: payload.baseUrl, apiKey })
      return { ok: true, models }
    } catch (error) {
      return { ok: false, error: String((error as Error)?.message ?? error), models: [] }
    }
  })
}

// ---------------------------------------------------------------------------
// 单实例：重复点图标不应再开一个新窗（用户反馈第 3 条）
// ---------------------------------------------------------------------------
let mainWindow: BrowserWindow | null = null
let tray: Tray | null = null
let isQuitting = false
/** 退出时的备份只做一次：before-quit 可能被触发多轮（window-all-closed 里再 quit）。 */
let quitBackupDone = false

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
  if (!USE_FILE_PROTOCOL) registerRendererProtocol()
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

/**
 * 退出流程：
 *   before-quit（置 isQuitting、做最后一次备份）→ 窗口 close（保存窗口状态）
 *   → will-quit（关掉数据仓库）→ quit
 *
 * 关键点：数据仓库必须在 will-quit 关，不能在 before-quit 关。
 * 因为 before-quit 早于窗口的 close 事件，早关掉 store 的话，
 * close 里保存窗口状态就会抛「数据仓库已关闭」，并以
 * 「A JavaScript error occurred in the main process」的弹窗崩在用户面前
 * （从托盘/任务栏「退出」时必现）。
 */
app.on('before-quit', () => {
  isQuitting = true
  if (quitBackupDone) return
  quitBackupDone = true
  // 退出前再备份一份；备份失败不能阻塞退出，数据本身已经逐次落盘。
  try {
    if (backupService && runtime?.store) backupService.create(new Date(), 'quit')
  } catch (error) {
    console.warn('退出备份失败', error)
  }
})

/** 窗口都关完、窗口状态也保存过了，这时才关闭数据仓库。 */
app.on('will-quit', () => {
  runtime?.store?.close()
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
        onResetGpuCompat: resetGpuCompatAndRelaunch,
      }),
    ),
  )
}

app.on('window-all-closed', () => {
  // 已经在退出流程里就不用再 quit 一次，避免 before-quit 重复跑（重复备份/重复关库）
  if (process.platform !== 'darwin' && !isQuitting) app.quit()
})

export type { PreloadApi }
