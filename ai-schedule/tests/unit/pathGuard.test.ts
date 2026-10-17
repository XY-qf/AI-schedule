import { describe, expect, it } from '../helpers/expect'
import { checkExecutablePath, isAsciiPath, pathGuardMessage } from '../../src/main/pathGuard'

describe('路径守卫', () => {
  it('纯英文路径放行', () => {
    expect(isAsciiPath('C:\\AI-Schedule\\AI-Schedule.exe')).toBe(true)
    expect(isAsciiPath('C:\\Program Files\\AI-Schedule\\app.exe')).toBe(true)
    expect(checkExecutablePath('C:\\AI-Schedule\\AI-Schedule.exe')).toBeNull()
  })

  it('中文文件名被拦下', () => {
    expect(isAsciiPath('C:\\ai-test\\AI日程.exe')).toBe(false)
  })

  it('英文文件名但中文父目录也被拦下（实测会崩）', () => {
    expect(isAsciiPath('C:\\Users\\王一钧\\Desktop\\_test\\app.exe')).toBe(false)
    expect(checkExecutablePath('C:\\Users\\王一钧\\Desktop\\app.exe')).not.toBeNull()
  })

  it('提示里给出当前路径和正确的做法', () => {
    const message = pathGuardMessage('C:\\Users\\王一钧\\Desktop\\AI日程\\AI日程.exe')
    expect(message).toContain('含有中文')
    expect(message).toContain('C:\\Users\\王一钧\\Desktop\\AI日程\\AI日程.exe')
    expect(message).toContain('C:\\AI-Schedule')
  })

  it('全角符号与 emoji 也算非 ASCII', () => {
    expect(isAsciiPath('C:\\ai＿test\\app.exe')).toBe(false)
    expect(isAsciiPath('C:\\ai😀\\app.exe')).toBe(false)
  })
})
