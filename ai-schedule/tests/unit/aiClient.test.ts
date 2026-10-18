import { describe, expect, it } from '../helpers/expect'
import { extractSseData, splitSseEvents } from '../../src/main/aiClient'

describe('SSE 解析', () => {
  it('按空行切事件，剩下的留在缓冲区', () => {
    const { events, rest } = splitSseEvents('data: a\n\ndata: b\n\ndata: half')
    expect(events).toHaveLength(2)
    expect(events[0]).toBe('data: a')
    expect(events[1]).toBe('data: b')
    expect(rest).toBe('data: half')
  })

  it('兼容 \\r\\n', () => {
    const { events } = splitSseEvents('data: {"a":1}\r\n\r\ndata: [DONE]\r\n\r\n')
    expect(events).toHaveLength(2)
    expect(extractSseData(events[0])).toBe('{"a":1}')
    expect(extractSseData(events[1])).toBe('[DONE]')
  })

  it('忽略注释行与 event 名', () => {
    const event = ': ping\nevent: message\ndata: {"ok":true}'
    expect(extractSseData(event)).toBe('{"ok":true}')
    expect(extractSseData(': keep-alive')).toBeNull()
  })

  it('多行 data 用换行拼起来', () => {
    expect(extractSseData('data: line1\ndata: line2')).toBe('line1\nline2')
  })
})
