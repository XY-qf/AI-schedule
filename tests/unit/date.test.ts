import { describe, expect, it } from '../helpers/expect'
import {
  addDays,
  addMonths,
  combineDateTime,
  datesOfMonthDay,
  daysInMonth,
  diffDays,
  endOfMonth,
  endOfWeekMonday,
  enumerateDates,
  formatChineseDate,
  formatDate,
  formatDateTime,
  formatRelativeDayLabel,
  formatTime,
  isValidDateTimeString,
  isValidDateString,
  isValidTimeString,
  minutesOfTime,
  pad2Safe,
  parseDate,
  parseDateTime,
  sameDay,
  semesterWeekIndex,
  isOddWeek,
  startOfMonth,
  startOfWeekMonday,
  timeFromMinutes,
  weekdayIndex,
} from '../../src/shared/date'

describe('日期字符串校验', () => {
  it('接受合法日期并拒绝非法日期', () => {
    expect(isValidDateString('2026-03-04')).toBe(true)
    expect(isValidDateString('2024-02-29')).toBe(true) // 闰年
    expect(isValidDateString('2026-02-29')).toBe(false) // 平年
    expect(isValidDateString('2026-13-01')).toBe(false)
    expect(isValidDateString('2026-3-4')).toBe(false)
    expect(isValidDateString('')).toBe(false)
  })

  it('校验时刻字符串', () => {
    expect(isValidTimeString('00:00')).toBe(true)
    expect(isValidTimeString('23:59')).toBe(true)
    expect(isValidTimeString('24:00')).toBe(false)
    expect(isValidTimeString('7:05')).toBe(false)
    expect(isValidTimeString('12:60')).toBe(false)
  })

  it('校验日期时间字符串', () => {
    expect(isValidDateTimeString('2026-03-04T19:30')).toBe(true)
    expect(isValidDateTimeString('2026-03-04 19:30')).toBe(false)
    expect(isValidDateTimeString('2026-03-04T24:00')).toBe(false)
  })
})

describe('解析与格式化', () => {
  it('日期往返一致', () => {
    const d = parseDate('2026-03-04')
    expect(d.getFullYear()).toBe(2026)
    expect(d.getMonth()).toBe(2)
    expect(d.getDate()).toBe(4)
    expect(d.getHours()).toBe(0)
    expect(formatDate(d)).toBe('2026-03-04')
  })

  it('日期时间往返一致', () => {
    const d = parseDateTime('2026-03-04T19:30')
    expect(formatDateTime(d)).toBe('2026-03-04T19:30')
    expect(formatTime(d)).toBe('19:30')
  })

  it('补零', () => {
    expect(formatDate(new Date(2026, 0, 5))).toBe('2026-01-05')
    expect(formatTime(new Date(2026, 0, 5, 8, 3))).toBe('08:03')
  })
})

describe('时间算术', () => {
  it('addDays 跨月跨年正确', () => {
    expect(formatDate(addDays(parseDate('2026-01-31'), 1))).toBe('2026-02-01')
    expect(formatDate(addDays(parseDate('2025-12-31'), 1))).toBe('2026-01-01')
    expect(formatDate(addDays(parseDate('2026-03-01'), -1))).toBe('2026-02-28')
  })

  it('addMonths 目标月天数不足时回退到当月最后一天', () => {
    expect(formatDate(addMonths(parseDate('2026-01-31'), 1))).toBe('2026-02-28')
    expect(formatDate(addMonths(parseDate('2024-01-31'), 1))).toBe('2024-02-29')
    expect(formatDate(addMonths(parseDate('2026-03-15'), 1))).toBe('2026-04-15')
    expect(formatDate(addMonths(parseDate('2026-03-15'), -3))).toBe('2025-12-15')
  })

  it('diffDays 按日历天数计算', () => {
    expect(diffDays(parseDate('2026-03-01'), parseDate('2026-03-04'))).toBe(3)
    expect(diffDays(parseDate('2026-03-04'), parseDate('2026-03-01'))).toBe(-3)
    expect(diffDays(parseDate('2026-02-28'), parseDate('2026-03-01'))).toBe(1)
  })

  it('sameDay 忽略时刻', () => {
    expect(sameDay(parseDateTime('2026-03-04T00:01'), parseDateTime('2026-03-04T23:59'))).toBe(true)
    expect(sameDay(parseDateTime('2026-03-04T23:59'), parseDateTime('2026-03-05T00:00'))).toBe(false)
  })

  it('星期序号：周一为 1，周日为 7', () => {
    expect(weekdayIndex(parseDate('2026-03-02'))).toBe(1) // 周一
    expect(weekdayIndex(parseDate('2026-03-07'))).toBe(6) // 周六
    expect(weekdayIndex(parseDate('2026-03-08'))).toBe(7) // 周日
  })
})

describe('周边界', () => {
  it('startOfWeekMonday 对周一到周日都返回本周周一', () => {
    for (let day = 2; day <= 8; day += 1) {
      const d = parseDate(`2026-03-0${day}`)
      expect(formatDate(startOfWeekMonday(d))).toBe('2026-03-02')
    }
  })

  it('endOfWeekMonday 返回周日 23:59', () => {
    const end = endOfWeekMonday(parseDate('2026-03-04'))
    expect(formatDate(end)).toBe('2026-03-08')
    expect(end.getHours()).toBe(23)
    expect(end.getMinutes()).toBe(59)
  })
})

describe('月份边界', () => {
  it('daysInMonth 处理闰年', () => {
    expect(daysInMonth(2026, 2)).toBe(28)
    expect(daysInMonth(2024, 2)).toBe(29)
    expect(daysInMonth(2026, 4)).toBe(30)
    expect(daysInMonth(2026, 12)).toBe(31)
  })

  it('startOfMonth / endOfMonth', () => {
    expect(formatDate(startOfMonth(parseDate('2026-03-17')))).toBe('2026-03-01')
    expect(formatDate(endOfMonth(parseDate('2026-03-17')))).toBe('2026-03-31')
  })

  it('datesOfMonthDay 跳过不存在的日期', () => {
    expect(datesOfMonthDay(2026, 2, 31)).toEqual([])
    expect(datesOfMonthDay(2026, 2, 29)).toEqual([])
    expect(datesOfMonthDay(2024, 2, 29)).toEqual(['2024-02-29'])
    expect(datesOfMonthDay(2026, 3, 5)).toEqual(['2026-03-05'])
  })
})

describe('时刻换算', () => {
  it('minutesOfTime 与 timeFromMinutes 互逆', () => {
    expect(minutesOfTime('00:00')).toBe(0)
    expect(minutesOfTime('19:30')).toBe(19 * 60 + 30)
    expect(timeFromMinutes(19 * 60 + 30)).toBe('19:30')
    expect(timeFromMinutes(0)).toBe('00:00')
  })

  it('24:00 视作一天结束', () => {
    expect(minutesOfTime('24:00')).toBe(1440)
    expect(timeFromMinutes(1440)).toBe('24:00')
  })

  it('超出范围的分钟数被夹紧', () => {
    expect(timeFromMinutes(-10)).toBe('00:00')
    expect(timeFromMinutes(2000)).toBe('24:00')
  })

  it('combineDateTime 处理 24:00 落到次日零点', () => {
    expect(combineDateTime('2026-03-04', '19:30')).toBe('2026-03-04T19:30')
    expect(combineDateTime('2026-03-04', '24:00')).toBe('2026-03-05T00:00')
    expect(combineDateTime('2026-12-31', '24:00')).toBe('2027-01-01T00:00')
  })
})

describe('区间枚举', () => {
  it('enumerateDates 含两端', () => {
    expect(enumerateDates('2026-03-01', '2026-03-03')).toEqual([
      '2026-03-01',
      '2026-03-02',
      '2026-03-03',
    ])
    expect(enumerateDates('2026-03-01', '2026-03-01')).toEqual(['2026-03-01'])
  })

  it('起始晚于结束时返回空数组', () => {
    expect(enumerateDates('2026-03-05', '2026-03-01')).toEqual([])
  })

  it('跨月边界正确', () => {
    const list = enumerateDates('2026-02-27', '2026-03-02')
    expect(list).toEqual(['2026-02-27', '2026-02-28', '2026-03-01', '2026-03-02'])
  })
})

describe('学期周次', () => {
  const start = '2026-03-02' // 第 1 周周一

  it('学期第一天是第 1 周', () => {
    expect(semesterWeekIndex(start, parseDate('2026-03-02'))).toBe(1)
    expect(semesterWeekIndex(start, parseDate('2026-03-08'))).toBe(1)
    expect(semesterWeekIndex(start, parseDate('2026-03-09'))).toBe(2)
    expect(semesterWeekIndex(start, parseDate('2026-03-15'))).toBe(2)
  })

  it('学期开始之前返回 0', () => {
    expect(semesterWeekIndex(start, parseDate('2026-03-01'))).toBe(0)
  })

  it('单双周判定以第 1 周为单周', () => {
    expect(isOddWeek(1)).toBe(true)
    expect(isOddWeek(2)).toBe(false)
    expect(isOddWeek(16)).toBe(false)
    expect(isOddWeek(17)).toBe(true)
  })
})

describe('中文显示', () => {
  it('格式化为“3月4日 周三”', () => {
    expect(formatChineseDate(parseDate('2026-03-04'))).toBe('3月4日 周三')
    expect(formatChineseDate(parseDate('2026-03-04'), true)).toBe('2026年3月4日 周三')
  })

  it('相对日期标签', () => {
    const today = parseDate('2026-03-04')
    expect(formatRelativeDayLabel(today, today)).toBe('今天 · 3月4日 周三')
    expect(formatRelativeDayLabel(parseDate('2026-03-05'), today)).toBe('明天 · 3月5日 周四')
    expect(formatRelativeDayLabel(parseDate('2026-03-03'), today)).toBe('昨天 · 3月3日 周二')
    expect(formatRelativeDayLabel(parseDate('2026-03-09'), today)).toBe('3月9日 周一')
  })
})

describe('非法输入', () => {
  it('parseDate 抛错而不是返回 Invalid Date', () => {
    expect(() => parseDate('abc')).toThrow()
  })
})

// 保证 pad2 内部实现可被间接验证（不额外导出）
describe('两位补零在极端值下的表现', () => {
  it('个位数月份与日期补零', () => {
    expect(formatDate(new Date(2026, 8, 9))).toBe('2026-09-09')
    expect(pad2Safe(5)).toBe('05')
  })
})
