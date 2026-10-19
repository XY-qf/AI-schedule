import fs from 'node:fs'
import path from 'node:path'
import { after, describe, expect, it } from '../helpers/expect'
import { DataStore } from '../../src/main/db/store'
import { SettingsRepository } from '../../src/main/db/settings'
import {
  DataDirectoryError,
  ensureDataDir,
  resolveAppPaths,
} from '../../src/main/paths'
import {
  DEFAULT_WINDOW_STATE,
  MIN_WINDOW_HEIGHT,
  MIN_WINDOW_WIDTH,
  loadWindowState,
  saveWindowState,
} from '../../src/main/windowState'
import { isPageKey, isViewKey, PAGE_LABEL, VIEW_LABEL } from '../../src/shared/navigation'

const wasmPath = require.resolve('sql.js/dist/sql-wasm.wasm')
const baseDir = path.join(__dirname, '..', '..', '.tmp-tests')

function freshDir(name: string): string {
  const dir = path.join(baseDir, name)
  fs.rmSync(dir, { recursive: true, force: true })
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

after(() => {
  fs.rmSync(baseDir, { recursive: true, force: true })
})

describe('数据路径推导', () => {
  it('全部落在文档目录下的 AI日程 文件夹里', () => {
    const paths = resolveAppPaths('C:\\Users\\someone\\Documents')
    expect(paths.dataDir).toBe('C:\\Users\\someone\\Documents\\AI日程')
    expect(paths.dbFile).toBe('C:\\Users\\someone\\Documents\\AI日程\\schedule.db')
    expect(paths.backupDir).toBe('C:\\Users\\someone\\Documents\\AI日程\\backups')
  })

  it('目录不存在时自动创建，并建好备份目录', () => {
    const root = freshDir('paths-ok')
    const paths = resolveAppPaths(root)
    ensureDataDir(paths)
    expect(fs.existsSync(paths.dataDir)).toBe(true)
    expect(fs.existsSync(paths.backupDir)).toBe(true)
    // 可重复调用
    ensureDataDir(paths)
  })

  it('目录无法创建时抛出明确的中文错误', () => {
    const paths = resolveAppPaths('Z:\\不存在的盘符\\documents')
    let caught: unknown = null
    try {
      ensureDataDir(paths)
    } catch (error) {
      caught = error
    }
    expect(caught instanceof DataDirectoryError).toBe(true)
    expect((caught as DataDirectoryError).message).toContain('数据目录不可用')
  })
})

describe('设置仓库', () => {
  async function openRepo(): Promise<{ store: DataStore; repo: SettingsRepository }> {
    const dir = freshDir('settings')
    const store = await DataStore.open({ filePath: path.join(dir, 'schedule.db'), wasmPath })
    return { store, repo: new SettingsRepository(store) }
  }

  it('写入后能读回，且支持数字与布尔', async () => {
    const { store, repo } = await openRepo()
    repo.set('a', 'hello')
    repo.set('n', 42)
    repo.set('b', true)
    expect(repo.get('a')).toBe('hello')
    expect(repo.getNumber('n')).toBe(42)
    expect(repo.getBoolean('b')).toBe(true)
    expect(repo.get('缺失的键')).toBeNull()
    expect(repo.getNumber('缺失的键')).toBeNull()
    store.close()
  })

  it('重复写入同一个键是覆盖而不是报错', async () => {
    const { store, repo } = await openRepo()
    repo.set('k', 'v1')
    repo.set('k', 'v2')
    expect(repo.get('k')).toBe('v2')
    const rows = store.all('SELECT key FROM settings WHERE key = ?', ['k'])
    expect(rows.length).toBe(1)
    store.close()
  })

  it('删除与批量写入', async () => {
    const { store, repo } = await openRepo()
    repo.setMany({ x: 1, y: 2 })
    expect(repo.all()).toEqual({ x: '1', y: '2' })
    repo.remove('x')
    expect(repo.get('x')).toBeNull()
    store.close()
  })
})

describe('窗口状态', () => {
  async function openRepo(): Promise<{ store: DataStore; repo: SettingsRepository }> {
    const dir = freshDir('window-state')
    const store = await DataStore.open({ filePath: path.join(dir, 'schedule.db'), wasmPath })
    return { store, repo: new SettingsRepository(store) }
  }

  it('首次启动返回默认值', async () => {
    const { store, repo } = await openRepo()
    expect(loadWindowState(repo)).toEqual(DEFAULT_WINDOW_STATE)
    store.close()
  })

  it('保存后能原样读回（含位置与最后页面）', async () => {
    const { store, repo } = await openRepo()
    saveWindowState(repo, {
      x: 120,
      y: 80,
      width: 1440,
      height: 900,
      maximized: false,
      lastPage: 'todo',
      lastView: 'month',
    })
    const loaded = loadWindowState(repo)
    expect(loaded.x).toBe(120)
    expect(loaded.y).toBe(80)
    expect(loaded.width).toBe(1440)
    expect(loaded.height).toBe(900)
    expect(loaded.lastPage).toBe('todo')
    expect(loaded.lastView).toBe('month')
    store.close()
  })

  it('尺寸小于最小值时被夹紧到最小值', async () => {
    const { store, repo } = await openRepo()
    saveWindowState(repo, { ...DEFAULT_WINDOW_STATE, width: 100, height: 100 })
    const loaded = loadWindowState(repo)
    expect(loaded.width).toBe(MIN_WINDOW_WIDTH)
    expect(loaded.height).toBe(MIN_WINDOW_HEIGHT)
    store.close()
  })

  it('页面或视图是非法值时退回默认值', async () => {
    const { store, repo } = await openRepo()
    repo.setMany({ 'app.lastPage': '不存在的页面', 'app.lastView': '不存在' })
    const loaded = loadWindowState(repo)
    expect(loaded.lastPage).toBe('calendar')
    expect(loaded.lastView).toBe('week')
    store.close()
  })

  it('非数字的尺寸不会让窗口变成 NaN', async () => {
    const { store, repo } = await openRepo()
    repo.setMany({ 'window.width': '宽', 'window.height': '' })
    const loaded = loadWindowState(repo)
    expect(loaded.width).toBe(DEFAULT_WINDOW_STATE.width)
    expect(loaded.height).toBe(DEFAULT_WINDOW_STATE.height)
    store.close()
  })
})

describe('导航键定义', () => {
  it('页面与视图键都有中文标签', () => {
    expect(PAGE_LABEL.calendar).toBe('日历')
    expect(PAGE_LABEL.settings).toBe('设置')
    expect(VIEW_LABEL.week).toBe('周')
    expect(isPageKey('todo')).toBe(true)
    expect(isPageKey('home')).toBe(false)
    expect(isViewKey('list')).toBe(true)
    expect(isViewKey('year')).toBe(false)
  })
})
