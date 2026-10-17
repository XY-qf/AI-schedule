import { describe, expect, it } from '../helpers/expect'
import { cleanup, fireEvent, render, screen } from '../helpers/ui'
import { App } from '../../src/renderer/App'
import { SettingsPage } from '../../src/renderer/components/SettingsPage'
import { parseDate } from '../../src/shared/date'
import type { EventItem } from '../../src/shared/entities'
import type { PreloadApi } from '../../src/shared/ipc'
import { EMPTY_COURSE_API } from '../helpers/apiExtras'

const TODAY = parseDate('2026-03-04')

describe('设置页组件', () => {
  function renderSettings(props: Partial<Parameters<typeof SettingsPage>[0]> = {}) {
    const calls: string[] = []
    render(
      <SettingsPage
        dataFilePath={'C:\\Users\\me\\Documents\\AI日程\\schedule.db'}
        dataDir={'C:\\Users\\me\\Documents\\AI日程'}
        version="1.0.0"
        backups={[
          { fileName: 'schedule-2026-03-04_0900.db', sizeBytes: 20480, createdAt: '2026-03-04 09:00' },
          { fileName: 'schedule-2026-03-03_0900.db', sizeBytes: 1024, createdAt: '2026-03-03 09:00' },
        ]}
        preferences={{}}
        onOpenFolder={() => calls.push('open')}
        onBackupNow={() => calls.push('backup')}
        onRestore={(fileName) => calls.push(`restore:${fileName}`)}
        onSetPreference={(key, value) => calls.push(`pref:${key}=${value}`)}
        {...props}
      />,
    )
    return calls
  }

  it('显示数据位置、版本与数据目录', () => {
    renderSettings()
    expect(screen.getByTestId('data-path').textContent).toContain('schedule.db')
    const text = document.body.textContent ?? ''
    expect(text).toContain('1.0.0')
    expect(text).toContain('C:\\Users\\me\\Documents\\AI日程')
    cleanup()
  })

  it('打开文件夹与立即备份回传', () => {
    const calls = renderSettings()
    fireEvent.click(screen.getByRole('button', { name: '打开所在文件夹' }))
    fireEvent.click(screen.getByRole('button', { name: '立即备份' }))
    expect(calls).toEqual(['open', 'backup'])
    cleanup()
  })

  it('列出备份并显示时间与大小', () => {
    renderSettings()
    expect(screen.getByTestId('backup-schedule-2026-03-04_0900.db').textContent).toContain('2026-03-04 09:00')
    expect(screen.getByTestId('backup-schedule-2026-03-04_0900.db').textContent).toContain('20 KB')
    expect(screen.getByTestId('backup-schedule-2026-03-03_0900.db').textContent).toContain('1 KB')
    cleanup()
  })

  it('恢复需要二次确认，取消不会恢复', () => {
    const calls = renderSettings()
    fireEvent.click(screen.getAllByRole('button', { name: '从这份恢复' })[0])
    expect(document.body.textContent).toContain('将用「schedule-2026-03-04_0900.db」的数据覆盖当前数据')
    fireEvent.click(screen.getByRole('button', { name: '取消' }))
    expect(calls).toEqual([])
    expect(document.body.textContent).not.toContain('将用「')
    cleanup()
  })

  it('确认后才真正恢复', () => {
    const calls = renderSettings()
    fireEvent.click(screen.getAllByRole('button', { name: '从这份恢复' })[1])
    fireEvent.click(screen.getByRole('button', { name: '确定恢复' }))
    expect(calls).toEqual(['restore:schedule-2026-03-03_0900.db'])
    cleanup()
  })

  it('没有备份时给出提示', () => {
    renderSettings({ backups: [] })
    expect(document.body.textContent).toContain('还没有备份')
    cleanup()
  })

  it('改颜色与显示偏好都会回传', () => {
    const calls = renderSettings()
    fireEvent.change(screen.getByLabelText('课内颜色'), { target: { value: '#ff0000' } })
    fireEvent.click(screen.getByLabelText('在日历的全天条里显示待办'))
    expect(calls).toEqual(['pref:color.course=#ff0000', 'pref:display.showTodo=0'])
    cleanup()
  })

  it('已关闭显示待办时勾选框是未选中', () => {
    renderSettings({ preferences: { 'display.showTodo': '0' } })
    expect((screen.getByLabelText('在日历的全天条里显示待办') as HTMLInputElement).checked).toBe(false)
    cleanup()
  })
})

describe('首次使用引导', () => {
  function makeApi(events: EventItem[] = []): PreloadApi {
    return {
      ...EMPTY_COURSE_API,
      getStatus: async () => ({
        dataFilePath: 'x',
        lastBackupAt: null,
        backupFailed: false,
        eventCount: events.length,
        dataDirMissing: false,
        dataDirMessage: null,
      }),
      rememberLocation: async () => undefined,
      openDataFolder: async () => undefined,
      getPlatform: async () => ({ electron: '', node: '' }),
      listAllEvents: async () => events,
      listEvents: async () => events,
      createEvent: async () => {
        throw new Error('未实现')
      },
      updateEvent: async () => {
        throw new Error('未实现')
      },
      deleteEvent: async () => undefined,
      setEventDone: async () => undefined,
    }
  }

  it('一条数据都没有时显示引导页与三个入口', async () => {
    render(<App today={TODAY} initialAnchor={TODAY} api={makeApi()} />)
    expect(await screen.findByText('还没有任何日程，从这三步开始')).toBeTruthy()
    expect(screen.getByRole('button', { name: '先建课程表' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '加一条课外活动' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '加一条生活日程' })).toBeTruthy()
    cleanup()
  })

  it('有数据时不再显示引导页', async () => {
    const events: EventItem[] = [
      {
        id: 'e1',
        title: '高数',
        category: 'course',
        kind: 'timed',
        startAt: '2026-03-02T08:00',
        endAt: '2026-03-02T09:40',
        dueAt: null,
        location: null,
        people: null,
        note: null,
        done: false,
        recurrenceId: null,
        createdAt: '',
        updatedAt: '',
      },
    ]
    render(<App today={TODAY} initialAnchor={TODAY} api={makeApi(events)} />)
    await screen.findByTestId('week-allday')
    expect(screen.queryByText('还没有任何日程，从这三步开始')).toBeNull()
    cleanup()
  })

  it('点“先建课程表”会跳到课程表页并打开学期弹窗', async () => {
    render(<App today={TODAY} initialAnchor={TODAY} api={makeApi()} />)
    fireEvent.click(await screen.findByRole('button', { name: '先建课程表' }))
    expect(await screen.findByRole('dialog')).toBeTruthy()
    expect(screen.getByRole('dialog').textContent).toContain('新建学期')
    cleanup()
  })

  it('点“加一条课外活动”打开新建弹窗且类别预选', async () => {
    render(<App today={TODAY} initialAnchor={TODAY} api={makeApi()} />)
    fireEvent.click(await screen.findByRole('button', { name: '加一条课外活动' }))
    expect((screen.getByLabelText('类别') as HTMLSelectElement).value).toBe('activity')
    cleanup()
  })
})

describe('设置页接入应用', () => {
  it('点导航“设置”进入设置页并显示版本', async () => {
    const api: PreloadApi = {
      ...EMPTY_COURSE_API,
      getStatus: async () => ({
        dataFilePath: 'D:\\data\\schedule.db',
        lastBackupAt: '2026-03-04 09:00',
        backupFailed: false,
        eventCount: 0,
        dataDirMissing: false,
        dataDirMessage: null,
      }),
      rememberLocation: async () => undefined,
      openDataFolder: async () => undefined,
      getPlatform: async () => ({ electron: '', node: '' }),
      listAllEvents: async () => [],
      listEvents: async () => [],
      createEvent: async () => {
        throw new Error('未实现')
      },
      updateEvent: async () => {
        throw new Error('未实现')
      },
      deleteEvent: async () => undefined,
      setEventDone: async () => undefined,
      getAppInfo: async () => ({ version: '9.9.9', dataDir: 'C:\\docs\\AI日程' }),
    }
    render(<App today={TODAY} initialAnchor={TODAY} api={api} initialPage="settings" />)
    expect(await screen.findByTestId('settings-data')).toBeTruthy()
    expect(document.body.textContent).toContain('9.9.9')
    cleanup()
  })
})
