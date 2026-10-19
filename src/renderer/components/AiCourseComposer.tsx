import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { Course, CourseInput, Period, Semester } from '../../shared/entities'
import { validateCourseInput } from '../../shared/entities'
import { Button, Checkbox } from './Controls'
import { CourseDialog } from './CourseDialog'
import { useAiImage } from './useAiImage'
import {
  WEEKDAY_LABEL,
  applyDraftToolCall,
  createManualDraft,
  draftFromCourseInput,
  draftToCourse,
  draftToCourseInput,
  findExistingCourse,
  splitDuplicates,
  summarizeDraft,
} from '../ai/draft'
import { buildCourseTask } from '../ai/tools'
import { maskApiKey } from '../ai/config'
import type { AiEngineEvent, AiRuntimeConfig, CoursePromptContext, DraftCourse } from '../ai/types'
import type { AiRuntime } from '../ai/runtime'

export interface AiCourseComposerProps {
  semester: Semester | null
  periods: Period[]
  /** 课表里已有的课程：既交给模型避免重复，也在确认时再拦一道 */
  existingCourses?: Course[]
  config: AiRuntimeConfig
  runtime: AiRuntime
  /** 用户点「全部加入」时调用，返回真正写进去的门数 */
  onAddCourses: (inputs: CourseInput[]) => Promise<number>
}

/**
 * 提示词上下文：这里带上"现在时间"，模型才能算准"本周还剩哪些课"。
 * 每次调用都重新取 new Date()，不缓存。
 */
function courseContext(semester: Semester | null, periods: Period[]): CoursePromptContext {
  return {
    semesterWeeks: semester?.weeks ?? 18,
    periods,
    now: new Date(),
    semesterStartDate: semester?.startDate,
  }
}


/**
 * 课程表页顶部的 AI 录入入口。
 *
 * 流程：自然语言/截图 → 云端 Qwen3.5-4B → tool call 修改草稿列表
 * → 用户逐条检查、修改、删除 → 确认后一次性写入课程表。
 */
export function AiCourseComposer({
  semester,
  periods,
  existingCourses = [],
  config,
  runtime,
  onAddCourses,
}: AiCourseComposerProps): ReactNode {
  const [expanded, setExpanded] = useState(false)
  const [text, setText] = useState('')
  const [running, setRunning] = useState(false)
  const [saving, setSaving] = useState(false)
  const [status, setStatus] = useState<{ message: string; progress: number | null } | null>(null)
  const [answer, setAnswer] = useState('')
  const [log, setLog] = useState<string[]>([])
  const [drafts, setDrafts] = useState<DraftCourse[]>([])
  const [error, setError] = useState<string | null>(null)
  const [editingKey, setEditingKey] = useState<string | null>(null)

  const [textOnly, setTextOnly] = useState(false)
  const draftsRef = useRef<DraftCourse[]>([])
  const mounted = useRef(true)
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
      // tool-call：模型改的是「编辑界面里的草稿」，不是数据库
      const context = courseContext(semester, periods)
      const result = applyDraftToolCall(draftsRef.current, event.name, event.input, context)
      draftsRef.current = result.drafts
      setDrafts(result.drafts)
      if (result.message) setLog((current) => [...current, result.message!].slice(-6))
    },
    [periods, semester?.weeks],
  )

  const handleRun = async (): Promise<void> => {
    if (running || !semester) return
    const trimmed = text.trim()
    if (!trimmed && !image.image) {
      setError('先输入一句话，或粘贴/上传一张课程表截图')
      return
    }
    setRunning(true)
    setError(null)
    setAnswer('')
    setLog([])
    setStatus({ message: '正在准备 AI 模型…', progress: null })

    const spec = buildCourseTask({
      text: trimmed,
      hasImage: Boolean(image.image),
      context: courseContext(semester, periods),
      drafts: draftsRef.current,
      existing: existingCourses,
    })

    try {
      await runtime.run(
        'course',
        { spec, imageDataUrl: textOnly ? null : (image.image?.dataUrl ?? null) },
        handleEvent,
      )
    } catch (cause) {
      if (mounted.current) setError(`识别失败：${String((cause as Error)?.message ?? cause)}`)
    } finally {
      if (mounted.current) {
        setRunning(false)
        setStatus(null)
      }
    }
  }

  const handleStop = (): void => {
    runtime.abort()
    setStatus({ message: '正在停止…', progress: null })
  }

  const updateDraft = (next: DraftCourse): void => {
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
    if (!semester || drafts.length === 0 || saving) return
    // 结算前再拦一道重复：模型可能还是把已有的课又加了一遍
    const split = splitDuplicates(drafts, existingCourses, periods)
    const targets = split.keep.length > 0 ? split.keep : drafts
    const inputs = targets.map((draft) => draftToCourseInput(draft, semester.id))
    for (const [index, input] of inputs.entries()) {
      const problems = validateCourseInput(input)
      if (problems.length > 0) {
        setError(`第 ${index + 1} 门（${input.title || '未命名'}）还不能保存：${problems.join('；')}`)
        return
      }
    }
    if (split.keep.length === 0) {
      setError(
        split.existingCount > 0
          ? '这些课程课表里都已经有了，不需要重复添加'
          : '这一批里有重复的课程，请先删掉重复的那几条',
      )
      return
    }
    setSaving(true)
    setError(null)
    try {
      const count = await onAddCourses(inputs)
      const skipped = split.duplicates.length
      setDrafts([])
      draftsRef.current = []
      setLog([])
      setAnswer('')
      setText('')
      image.setImage(null)
      setStatus({
        message: skipped > 0
          ? `已加入课程表：${count} 门（跳过 ${skipped} 门重复的）`
          : `已加入课程表：${count} 门`,
        progress: null,
      })
    } catch (cause) {
      setError(`保存失败：${String((cause as Error)?.message ?? cause)}`)
    } finally {
      setSaving(false)
    }
  }

  if (!config.enabled) return null

  const editingDraft = editingKey ? drafts.find((item) => item.key === editingKey) ?? null : null
  const canRun = Boolean(semester) && !running && (text.trim().length > 0 || image.image !== null)
  const duplicateKeys = useMemo(() => {
    const hits = new Set<string>()
    const seen: Course[] = []
    for (const draft of drafts) {
      if (findExistingCourse(draft, existingCourses, periods) || findExistingCourse(draft, seen, periods)) {
        hits.add(draft.key)
      } else {
        seen.push(draftToCourse(draft))
      }
    }
    return hits
  }, [drafts, existingCourses, periods])

  return (
    <div
      className="ai-composer"
      data-testid="ai-course-entry"
      onPaste={image.handlePaste}
      onDrop={image.handleDrop}
      onDragOver={(event) => event.preventDefault()}
    >
      <div className="ai-composer__bar">
        <span className="ai-composer__badge">AI</span>
        <span className="ai-composer__title">用 AI 添加课程</span>
        <span className="ai-composer__hint">
          输入一句话，或粘贴 / 上传课程表截图；识别结果先放进下方列表，确认后再加入课程表
        </span>
        <Button size="sm" data-testid="ai-toggle" onClick={() => setExpanded((current) => !current)}>
          {expanded ? '收起' : '展开'}
        </Button>
      </div>

      {expanded ? (
        <div className="ai-composer__panel">
          <div className="ai-composer__input-row">
            <textarea
              className="ai-composer__input"
              data-testid="ai-input"
              value={text}
              rows={3}
              placeholder={
                image.image
                  ? '可再补一句说明，例如「只处理周一到周五的课」'
                  : '例如：每周一 1-2 节高等数学，A101，第 1-16 周；周三 3-4 节大学英语，单周'
              }
              onChange={(event) => setText(event.target.value)}
            />
            {image.image ? (
              <div className="ai-composer__thumb" data-testid="ai-image-preview">
                <img src={image.image.dataUrl} alt={image.image.name} />
                <button
                  type="button"
                  className="ai-composer__thumb-remove"
                  aria-label="移除截图"
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
              data-testid="ai-file-input"
              style={{ display: 'none' }}
              onChange={(event) => {
                image.pickFiles(event.target.files)
                event.target.value = ''
              }}
            />
            <Button size="sm" data-testid="ai-pick-image" onClick={image.openPicker}>
              选择截图
            </Button>
            <Button
              size="sm"
              variant="ghost"
              data-testid="ai-add-manual"
              onClick={() =>
                setDrafts((current) => {
                  const next = [
                    ...current,
                    createManualDraft({ semesterWeeks: semester?.weeks ?? 18, periods }, { title: '' }),
                  ]
                  draftsRef.current = next
                  return next
                })
              }
            >
              手动加一行
            </Button>
            <Checkbox
              id="ai-text-only"
              label="只发文字"
              checked={textOnly}
              onChange={setTextOnly}
            />
            <span className="toolbar-spacer" />
            {running ? (
              <Button size="sm" data-testid="ai-stop" onClick={handleStop}>
                停止
              </Button>
            ) : null}
            <Button
              size="sm"
              variant="primary"
              data-testid="ai-run"
              disabled={!canRun}
              onClick={() => void handleRun()}
            >
              {running ? '识别中…' : '识别并填入'}
            </Button>
          </div>

          <p className="field__hint">
            {config.model} · 硅基流动接口 · Key {maskApiKey(config.apiKey)} ·
            识别结果只写进下方的待确认列表，确认后才进课程表。
          </p>

          {!semester ? (
            <p className="ai-composer__warn" role="status">
              还没有学期：请先在右上角「新建学期」，AI 才能把课程放进课表。
            </p>
          ) : null}

          {status ? (
            <div className="ai-composer__status" role="status" data-testid="ai-status">
              <span>{status.message}</span>
              {status.progress !== null ? (
                <span className="ai-composer__progress" aria-hidden>
                  <span style={{ width: `${Math.round(status.progress * 100)}%` }} />
                </span>
              ) : null}
            </div>
          ) : null}

          {answer ? (
            <div className="ai-composer__answer" data-testid="ai-answer">
              {answer}
            </div>
          ) : null}

          {log.length > 0 ? (
            <ul className="ai-composer__log" data-testid="ai-log">
              {log.map((item, index) => (
                <li key={`${item}-${index}`}>{item}</li>
              ))}
            </ul>
          ) : null}

          {error ? (
            <div className="form-error" role="alert" data-testid="ai-error">
              {error}
            </div>
          ) : null}

          <div className="ai-composer__drafts" data-testid="ai-drafts">
            <div className="ai-composer__drafts-head">
              <span className="ai-composer__drafts-title">
                待确认的课程（{drafts.length}
                {duplicateKeys.size > 0 ? `，其中 ${duplicateKeys.size} 门课表里已有` : ''}）
              </span>
              <span className="toolbar-spacer" />
              {drafts.length > 0 ? (
                <Button
                  size="sm"
                  variant="ghost"
                  data-testid="ai-clear"
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
                data-testid="ai-confirm"
                disabled={drafts.length === 0 || saving}
                onClick={() => void handleConfirm()}
              >
                {saving ? '正在加入…' : `全部加入课程表${drafts.length > 0 ? `（${drafts.length}）` : ''}`}
              </Button>
            </div>

            {drafts.length === 0 ? (
              <p className="ai-composer__empty">识别到的课程会显示在这里，可以先逐条检查、修改，再统一加入。</p>
            ) : (
              <ul className="ai-composer__list">
                {drafts.map((draft, index) => {
                  const summary = summarizeDraft(draft, periods)
                  const duplicate = duplicateKeys.has(draft.key)
                  return (
                    <li
                      className={`ai-composer__row${duplicate ? ' ai-composer__row--dup' : ''}`}
                      key={draft.key}
                      data-testid="ai-draft-row"
                    >
                      <span className="ai-composer__row-index">{index + 1}</span>
                      <span className="ai-composer__row-title">
                        {WEEKDAY_LABEL[draft.weekday - 1]} {draft.title || '（未命名）'}
                        {draft.needsReview ? <span className="ai-composer__tag">待确认</span> : null}
                        {duplicate ? (
                          <span className="ai-composer__tag ai-composer__tag--dup" data-testid="ai-draft-dup">
                            已存在
                          </span>
                        ) : null}
                      </span>
                      <span className="ai-composer__row-meta">
                        {summary.time} · {summary.weeks}
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

      <CourseDialog
        open={editingDraft !== null}
        mode="edit"
        initial={editingDraft ? draftToCourse(editingDraft) : null}
        semesterId={semester?.id ?? ''}
        periods={periods}
        onSave={(input) => {
          if (!editingDraft) return
          updateDraft(draftFromCourseInput(input, editingDraft.key))
          setEditingKey(null)
        }}
        onClose={() => setEditingKey(null)}
      />
    </div>
  )
}
