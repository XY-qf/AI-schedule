import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import type { EventInput } from '../../shared/entities'
import { formatDate } from '../../shared/date'
import { Button } from './Controls'
import { EventDialog, type RepeatPayload } from './EventDialog'
import { useAiImage } from './useAiImage'
import {
  EVENT_CATEGORY_LABEL,
  EVENT_KIND_LABEL,
  applyEventToolCall,
  createManualEventDraft,
  draftFromEventInput,
  draftToEventInput,
  draftToEventItem,
  draftValidateProblems,
  normalizeRepeat,
  summarizeEventDraft,
  type EventDraftContext,
} from '../ai/eventDraft'
import { buildEventTask } from '../ai/eventTools'
import { maskApiKey } from '../ai/config'
import type { AiEngineEvent, AiRuntimeConfig, DraftEvent, DraftRepeat } from '../ai/types'
import type { AiRuntime } from '../ai/runtime'

export interface AiEventComposerProps {
  /** 固定"今天"，测试可注入 */
  today: Date
  config: AiRuntimeConfig
  runtime: AiRuntime
  /** 用户点「全部加入」时调用，返回真正写进去的条数 */
  /** 确认入库：带上各自的重复规则（null = 只这一次） */
  onAddEvents: (items: Array<{ input: EventInput; repeat: DraftRepeat | null }>) => Promise<number>
  /** 默认类别（从当前页面继承，例如在课外活动页就用 activity） */
  defaultCategory?: DraftEvent['category']
}


/**
 * 日历页的 AI 录入入口（"新建"旁边）。
 *
 * 与课程那套同构：一句话/截图 → tool call 改进"待确认列表" → 用户检查修改 → 确认入库。
 */
export function AiEventComposer({
  today,
  config,
  runtime,
  onAddEvents,
  defaultCategory = 'activity',
}: AiEventComposerProps): ReactNode {
  const [expanded, setExpanded] = useState(false)
  const [text, setText] = useState('')
  const [running, setRunning] = useState(false)
  const [saving, setSaving] = useState(false)
  const [status, setStatus] = useState<{ message: string; progress: number | null } | null>(null)
  const [answer, setAnswer] = useState('')
  const [log, setLog] = useState<string[]>([])
  const [drafts, setDrafts] = useState<DraftEvent[]>([])
  const [error, setError] = useState<string | null>(null)
  const [editingKey, setEditingKey] = useState<string | null>(null)

  const draftsRef = useRef<DraftEvent[]>([])
  const mounted = useRef(true)
  const todayKey = formatDate(today)

  /** 提示词里的"现在时间"：用组件传进来的 today（测试可控），而不是直接读系统时间 */
  const eventContext = (): EventDraftContext => ({ today: todayKey, now: today })

  useEffect(() => () => {
    mounted.current = false
  }, [])

  const image = useAiImage((message) => setError(message || null))

  useEffect(() => {
    draftsRef.current = drafts
  }, [drafts])

  const handleEvent = useCallback(
    (event: AiEngineEvent) => {
      if (event.type === 'status') {
        setStatus({ message: event.message, progress: event.progress })
        return
      }
      if (event.type === 'text') {
        setAnswer((current) => current + event.text)
        return
      }
      if (event.type === 'done') {
        setAnswer(event.text)
        setStatus(null)
        return
      }
      if (event.type === 'error') {
        setError(event.message)
        return
      }
      const context = eventContext()
      const result = applyEventToolCall(draftsRef.current, event.name, event.input, context)
      draftsRef.current = result.drafts
      setDrafts(result.drafts)
      if (result.message) setLog((current) => [...current, result.message!].slice(-6))
    },
    [todayKey],
  )

  const handleRun = async (): Promise<void> => {
    if (running) return
    const trimmed = text.trim()
    if (!trimmed && !image.image) {
      setError('先输入一句话，或粘贴/上传一张图')
      return
    }
    setRunning(true)
    setError(null)
    setAnswer('')
    setLog([])
    setStatus({ message: '正在准备 AI 模型…', progress: null })

    const spec = buildEventTask({
      text: trimmed,
      hasImage: Boolean(image.image),
      context: eventContext(),
      drafts: draftsRef.current,
    })

    try {
      await runtime.run('event', { spec, imageDataUrl: image.image?.dataUrl ?? null }, handleEvent)
    } catch (cause) {
      if (mounted.current) setError(`识别失败：${String((cause as Error)?.message ?? cause)}`)
    } finally {
      if (mounted.current) {
        setRunning(false)
        setStatus(null)
      }
    }
  }

  const updateDraft = (next: DraftEvent): void => {
    setDrafts((current) => {
      const list = current.map((item) => (item.key === next.key ? next : item))
      draftsRef.current = list
      return list
    })
  }

  const removeDraft = (key: string): void => {
    setDrafts((current) => {
      const list = current.filter((item) => item.key !== key)
      draftsRef.current = list
      return list
    })
  }

  const handleConfirm = async (): Promise<void> => {
    if (drafts.length === 0 || saving) return
    for (const [index, draft] of drafts.entries()) {
      const problems = draftValidateProblems(draft)
      if (problems.length > 0) {
        setError(`第 ${index + 1} 条（${draft.title || '未命名'}）还不能保存：${problems.join('；')}`)
        return
      }
    }
    setSaving(true)
    setError(null)
    try {
      const count = await onAddEvents(
        drafts.map((draft) => ({ input: draftToEventInput(draft), repeat: draft.repeat })),
      )
      setDrafts([])
      draftsRef.current = []
      setLog([])
      setAnswer('')
      setText('')
      image.setImage(null)
      setStatus({ message: `已加入日历：${count} 条`, progress: null })
    } catch (cause) {
      setError(`保存失败：${String((cause as Error)?.message ?? cause)}`)
    } finally {
      setSaving(false)
    }
  }

  if (!config.enabled) return null

  const editingDraft = editingKey ? drafts.find((item) => item.key === editingKey) ?? null : null
  const canRun = !running && (text.trim().length > 0 || image.image !== null)

  return (
    <div
      className="ai-composer ai-composer--event"
      data-testid="ai-event-entry"
      onPaste={image.handlePaste}
      onDrop={image.handleDrop}
      onDragOver={(event) => event.preventDefault()}
    >
      <div className="ai-composer__bar">
        <span className="ai-composer__badge">AI</span>
        <span className="ai-composer__title">用 AI 记日程</span>
        <span className="ai-composer__hint">
          一句话或一张图（群里发的活动截图也行）；识别结果先列在下面，确认后才进日历
        </span>
        <Button size="sm" data-testid="ai-event-toggle" onClick={() => setExpanded((current) => !current)}>
          {expanded ? '收起' : '展开'}
        </Button>
      </div>

      {expanded ? (
        <div className="ai-composer__panel">
          <div className="ai-composer__input-row">
            <textarea
              className="ai-composer__input"
              data-testid="ai-event-input"
              value={text}
              rows={3}
              placeholder="例如：明天下午 3 点和导师开会，实验室 302；周五前交实验报告"
              onChange={(event) => setText(event.target.value)}
            />
            {image.image ? (
              <div className="ai-composer__thumb" data-testid="ai-event-image-preview">
                <img src={image.image.dataUrl} alt={image.image.name} />
                <button
                  type="button"
                  className="ai-composer__thumb-remove"
                  aria-label="移除图片"
                  onClick={() => image.setImage(null)}
                >
                  ×
                </button>
              </div>
            ) : null}
          </div>

          <div className="ai-composer__actions">
            <input
              ref={image.fileRef}
              type="file"
              accept="image/*"
              data-testid="ai-event-file-input"
              style={{ display: 'none' }}
              onChange={(event) => {
                image.pickFiles(event.target.files)
                event.target.value = ''
              }}
            />
            <Button size="sm" data-testid="ai-event-pick-image" onClick={image.openPicker}>
              选择图片
            </Button>
            <Button
              size="sm"
              variant="ghost"
              data-testid="ai-event-add-manual"
              onClick={() =>
                setDrafts((current) => {
                  const next = [...current, createManualEventDraft({ today: todayKey }, { category: defaultCategory })]
                  draftsRef.current = next
                  return next
                })
              }
            >
              手动加一行
            </Button>
            <span className="toolbar-spacer" />
            {running ? (
              <Button size="sm" data-testid="ai-event-stop" onClick={() => runtime.abort()}>
                停止
              </Button>
            ) : null}
            <Button
              size="sm"
              variant="primary"
              data-testid="ai-event-run"
              disabled={!canRun}
              onClick={() => void handleRun()}
            >
              {running ? '识别中…' : '识别并填入'}
            </Button>
          </div>

          <p className="field__hint">
            {config.model} · 硅基流动接口 · Key {maskApiKey(config.apiKey)} ·
            重复日程请先按单次记录，确认后再改成每周/每月。
          </p>

          {status ? (
            <div className="ai-composer__status" role="status" data-testid="ai-event-status">
              <span>{status.message}</span>
              {status.progress !== null ? (
                <span className="ai-composer__progress" aria-hidden>
                  <span style={{ width: `${Math.round(status.progress * 100)}%` }} />
                </span>
              ) : null}
            </div>
          ) : null}

          {answer ? (
            <div className="ai-composer__answer" data-testid="ai-event-answer">
              {answer}
            </div>
          ) : null}

          {log.length > 0 ? (
            <ul className="ai-composer__log" data-testid="ai-event-log">
              {log.map((item, index) => (
                <li key={`${item}-${index}`}>{item}</li>
              ))}
            </ul>
          ) : null}

          {error ? (
            <div className="form-error" role="alert" data-testid="ai-event-error">
              {error}
            </div>
          ) : null}

          <div className="ai-composer__drafts" data-testid="ai-event-drafts">
            <div className="ai-composer__drafts-head">
              <span className="ai-composer__drafts-title">待确认的日程（{drafts.length}）</span>
              <span className="toolbar-spacer" />
              {drafts.length > 0 ? (
                <Button
                  size="sm"
                  variant="ghost"
                  data-testid="ai-event-clear"
                  onClick={() => {
                    setDrafts([])
                    draftsRef.current = []
                    setLog([])
                  }}
                >
                  清空
                </Button>
              ) : null}
              <Button
                size="sm"
                variant="primary"
                data-testid="ai-event-confirm"
                disabled={drafts.length === 0 || saving}
                onClick={() => void handleConfirm()}
              >
                {saving ? '正在加入…' : `全部加入日历${drafts.length > 0 ? `（${drafts.length}）` : ''}`}
              </Button>
            </div>

            {drafts.length === 0 ? (
              <p className="ai-composer__empty">识别到的日程会显示在这里，可以先逐条检查、修改，再统一加入。</p>
            ) : (
              <ul className="ai-composer__list">
                {drafts.map((draft, index) => {
                  const summary = summarizeEventDraft(draft)
                  return (
                    <li className="ai-composer__row" key={draft.key} data-testid="ai-event-draft-row">
                      <span className="ai-composer__row-index">{index + 1}</span>
                      <span className="ai-composer__row-title">
                        {draft.title || '（未命名）'}
                        <span className="ai-composer__tag ai-composer__tag--kind">
                          {EVENT_CATEGORY_LABEL[draft.category]}·{EVENT_KIND_LABEL[draft.kind]}
                        </span>
                        {summary.repeat ? (
                          <span className="ai-composer__tag ai-composer__tag--repeat" data-testid="ai-event-repeat">
                            {summary.repeat}
                          </span>
                        ) : null}
                        {draft.needsReview ? <span className="ai-composer__tag">待确认</span> : null}
                      </span>
                      <span className="ai-composer__row-meta">
                        {summary.when}
                        {summary.detail ? ` · ${summary.detail}` : ''}
                      </span>
                      <span className="toolbar-spacer" />
                      <Button
                        size="sm"
                        variant="ghost"
                        aria-label={`编辑 ${draft.title || '未命名'}`}
                        onClick={() => setEditingKey(draft.key)}
                      >
                        编辑
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        aria-label={`删除 ${draft.title || '未命名'}`}
                        onClick={() => removeDraft(draft.key)}
                      >
                        删除
                      </Button>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
        </div>
      ) : null}

      <EventDialog
        open={editingDraft !== null}
        mode="edit"
        initial={editingDraft ? draftToEventItem(editingDraft) : null}
        siblingEvents={[]}
        initialRepeat={editingDraft?.repeat ?? null}
        onSave={(input, repeat) => {
          if (!editingDraft) return
          // 弹窗里只改得到频次/截止/次数，星期与间隔按原样保留
          const merged: RepeatPayload | null = repeat
            ? {
                ...repeat,
                byWeekdays: editingDraft.repeat?.byWeekdays ?? null,
                intervalValue: editingDraft.repeat?.intervalValue ?? null,
                intervalUnit: editingDraft.repeat?.intervalUnit ?? null,
              }
            : null
          updateDraft(
            draftFromEventInput(
              input,
              editingDraft.key,
              merged ? normalizeRepeat(merged) : null,
            ),
          )
          setEditingKey(null)
        }}
        onClose={() => setEditingKey(null)}
      />
    </div>
  )
}
