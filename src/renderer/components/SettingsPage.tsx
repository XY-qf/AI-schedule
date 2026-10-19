import { useEffect, useState, type ReactNode } from 'react'
import type { BackupInfo } from '../../shared/ipc'
import { Button, Checkbox, TextField } from './Controls'
import { AI_PREFERENCE_KEYS, DEFAULT_BASE_URL, DEFAULT_MODEL, maskApiKey, normalizeBaseUrl, thinkingSwitchedModel } from '../ai/config'

export interface SettingsPageProps {
  dataFilePath: string
  dataDir: string
  version: string
  backups: BackupInfo[]
  preferences: Record<string, string>
  onOpenFolder: () => void
  onBackupNow: () => void
  onRestore: (fileName: string) => void
  onSetPreference: (key: string, value: string) => void
  /** 用当前配置发一次最小请求，验证 Key / 网络 */
  onTestAi?: () => void
  /** 读取接口支持的模型列表（GET /models） */
  onFetchModels?: () => void
  /** 已读取到的模型 id */
  modelOptions?: string[]
}

const COLOR_KEYS = [
  { key: 'color.course', label: '课内' },
  { key: 'color.activity', label: '课外活动' },
  { key: 'color.life', label: '个人生活' },
] as const

const DEFAULT_COLORS: Record<string, string> = {
  'color.course': '#3b82f6',
  'color.activity': '#f59e0b',
  'color.life': '#10b981',
}

function sizeText(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

/** 文本框先落本地，失焦时才写设置——避免每敲一个字母就落一次库。 */
function PrefTextField({
  id,
  label,
  value,
  placeholder,
  hint,
  type,
  onCommit,
}: {
  id: string
  label: string
  value: string
  placeholder?: string
  hint?: string
  type?: string
  onCommit: (next: string) => void
}): ReactNode {
  const [draft, setDraft] = useState(value)
  useEffect(() => {
    setDraft(value)
  }, [value])
  return (
    <TextField
      id={id}
      label={label}
      type={type}
      value={draft}
      placeholder={placeholder}
      hint={hint}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => {
        if (draft !== value) onCommit(draft)
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter') event.currentTarget.blur()
      }}
    />
  )
}

/** 设置页（PRD 6.8）：数据与备份、类别颜色、显示偏好、关于。 */
export function SettingsPage({
  dataFilePath,
  dataDir,
  version,
  backups,
  preferences,
  onOpenFolder,
  onBackupNow,
  onRestore,
  onSetPreference,
  onTestAi,
  onFetchModels,
  modelOptions = [],
}: SettingsPageProps): ReactNode {
  const [pendingRestore, setPendingRestore] = useState<string | null>(null)
  const showTodo = (preferences['display.showTodo'] ?? '1') !== '0'
  const apiKey = preferences[AI_PREFERENCE_KEYS.apiKey] ?? ''
  const model = preferences[AI_PREFERENCE_KEYS.model] ?? DEFAULT_MODEL
  const baseUrl = preferences[AI_PREFERENCE_KEYS.baseUrl] ?? DEFAULT_BASE_URL
  const thinkingSwitched = thinkingSwitchedModel({
    enabled: true,
    baseUrl: normalizeBaseUrl(baseUrl),
    model,
    apiKey,
    temperature: 0.2,
    thinking: (preferences[AI_PREFERENCE_KEYS.thinking] ?? '1') !== '0',
  })

  return (
    <section className="page" aria-label="设置">
      <div className="page__header">
        <span className="page__title">设置</span>
      </div>
      <div className="page__body settings">
        <section className="settings__block" data-testid="settings-data">
          <h3 className="settings__title">数据与备份</h3>
          <div className="settings__row">
            <span className="settings__label">数据位置</span>
            <code className="settings__value" data-testid="data-path">
              {dataFilePath}
            </code>
            <Button size="sm" onClick={onOpenFolder}>
              打开所在文件夹
            </Button>
          </div>
          <p className="field__hint">
            数据只存在这台电脑上，程序不联网、不上传任何内容。退出时会自动备份，每天首次启动也会备份一次。
          </p>

          <div className="settings__row">
            <span className="settings__label">自动备份</span>
            <span className="settings__value">保留最近 10 份</span>
            <Button size="sm" variant="primary" onClick={onBackupNow}>
              立即备份
            </Button>
          </div>

          {backups.length === 0 ? (
            <p className="day-panel__empty">还没有备份</p>
          ) : (
            <div className="backup-list" data-testid="backup-list">
              {backups.map((backup) => (
                <div key={backup.fileName} className="backup-row" data-testid={`backup-${backup.fileName}`}>
                  <span className="backup-row__time">{backup.createdAt}</span>
                  <span className="backup-row__size">{sizeText(backup.sizeBytes)}</span>
                  <Button size="sm" onClick={() => setPendingRestore(backup.fileName)}>
                    从这份恢复
                  </Button>
                </div>
              ))}
            </div>
          )}

          {pendingRestore ? (
            <div className="settings__confirm" role="alert">
              将用「{pendingRestore}」的数据覆盖当前数据，恢复后程序会自动重启。
              <Button size="sm" onClick={() => setPendingRestore(null)}>
                取消
              </Button>
              <Button
                size="sm"
                variant="danger"
                onClick={() => {
                  onRestore(pendingRestore)
                  setPendingRestore(null)
                }}
              >
                确定恢复
              </Button>
            </div>
          ) : null}
        </section>

        <section className="settings__block">
          <h3 className="settings__title">类别颜色</h3>
          <div className="settings__colors">
            {COLOR_KEYS.map((item) => (
              <label key={item.key} className="settings__color">
                <input
                  type="color"
                  aria-label={`${item.label}颜色`}
                  value={preferences[item.key] ?? DEFAULT_COLORS[item.key]}
                  onChange={(event) => onSetPreference(item.key, event.target.value)}
                />
                <span>{item.label}</span>
              </label>
            ))}
          </div>
          <p className="field__hint">周起始日固定为周一；时间轴固定显示 00:00–24:00。</p>
        </section>

        <section className="settings__block">
          <h3 className="settings__title">显示</h3>
          <Checkbox
            id="show-todo"
            label="在日历的全天条里显示待办"
            checked={showTodo}
            onChange={(checked) => onSetPreference('display.showTodo', checked ? '1' : '0')}
          />
        </section>

        <section className="settings__block" data-testid="settings-ai">
          <h3 className="settings__title">AI 助手（云端）</h3>
          <Checkbox
            id="ai-enabled"
            label="在课程表页 / 日历页显示 AI 入口"
            checked={(preferences[AI_PREFERENCE_KEYS.enabled] ?? '1') !== '0'}
            onChange={(checked) => onSetPreference(AI_PREFERENCE_KEYS.enabled, checked ? '1' : '0')}
          />
          <PrefTextField
            id="ai-api-key"
            label="API Key"
            type="password"
            value={apiKey}
            placeholder="sk-…（硅基流动后台领取）"
            hint="Key 只保存在本机的数据文件里，请求由本程序直接发往硅基流动。"
            onCommit={(next) => onSetPreference(AI_PREFERENCE_KEYS.apiKey, next.trim())}
          />
          <div className="form-row">
            <PrefTextField
              id="ai-model"
              label="模型"
              value={model}
              placeholder={DEFAULT_MODEL}
              onCommit={(next) => onSetPreference(AI_PREFERENCE_KEYS.model, next.trim() || DEFAULT_MODEL)}
            />
            <PrefTextField
              id="ai-base-url"
              label="接口地址"
              value={baseUrl}
              placeholder={DEFAULT_BASE_URL}
              onCommit={(next) => onSetPreference(AI_PREFERENCE_KEYS.baseUrl, next.trim())}
            />
            <Button size="sm" data-testid="ai-fetch-models" onClick={onFetchModels} disabled={!onFetchModels}>
              读取可用模型
            </Button>
          </div>
          {modelOptions.length > 0 ? (
            <div className="settings__row" data-testid="ai-model-options">
              <span className="settings__label">接口返回的模型</span>
              <span className="settings__value">
                {modelOptions.map((id) => (
                  <button
                    type="button"
                    key={id}
                    className={`btn btn--sm${id === model ? ' btn--primary' : ' btn--ghost'}`}
                    style={{ marginRight: 6, marginBottom: 4 }}
                    onClick={() => onSetPreference(AI_PREFERENCE_KEYS.model, id)}
                  >
                    {id}
                  </button>
                ))}
              </span>
            </div>
          ) : null}
          <Checkbox
            id="ai-thinking"
            label="开启深度思考（DeepSeek 官方会切换到 deepseek-reasoner）"
            checked={(preferences[AI_PREFERENCE_KEYS.thinking] ?? '1') !== '0'}
            onChange={(checked) => onSetPreference(AI_PREFERENCE_KEYS.thinking, checked ? '1' : '0')}
          />
          {thinkingSwitched ? (
            <p className="field__hint" data-testid="ai-thinking-hint">
              思考开着：实际请求会使用 <b>{thinkingSwitched}</b>（官方接口的思考模型），而不是 {model}。
            </p>
          ) : null}
          <div className="settings__row">
            <span className="settings__label">自检</span>
            <span className="settings__value">
              用当前模型发一句「收到」，验证 Key 与网络是否可用
            </span>
            <Button size="sm" data-testid="ai-test" onClick={onTestAi} disabled={!onTestAi}>
              测试连接
            </Button>
          </div>
          <p className="field__hint">
            {apiKey.trim()
              ? `已填写 Key（${maskApiKey(apiKey)}）。`
              : '还没有填 Key：到 cloud.siliconflow.cn 注册后创建 API Key，粘到上面即可（默认模型 ' +
                DEFAULT_MODEL +
                ' 是免费额度）。'}
            识别结果只写进「待确认」列表，确认后才会进课程表/日历。
          </p>
        </section>

        <section className="settings__block">
          <h3 className="settings__title">关于</h3>
          <div className="settings__row">
            <span className="settings__label">版本</span>
            <span className="settings__value">{version}</span>
          </div>
          <div className="settings__row">
            <span className="settings__label">数据目录</span>
            <span className="settings__value">{dataDir}</span>
          </div>
          <p className="field__hint">个人单机使用，不需要账号，也没有手机端。</p>
        </section>
      </div>
    </section>
  )
}
