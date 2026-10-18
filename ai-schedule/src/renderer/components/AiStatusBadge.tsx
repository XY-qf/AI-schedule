import { useState, type ReactNode } from 'react'
import type { AiRuntimeConfig, AiStatus } from '../ai/types'
import { maskApiKey, resolveEffectiveModel } from '../ai/config'

export interface AiStatusBadgeProps {
  status: AiStatus
  config: AiRuntimeConfig
  onAbort: () => void
  onOpenSettings?: () => void
}

function phaseLabel(status: AiStatus, enabled: boolean): string {
  if (!enabled) return '已关闭'
  if (status.phase === 'error') return '出错'
  if (status.phase === 'generating') return '生成中'
  if (status.phase === 'connecting') return '连接中'
  return status.connected ? '运行正常' : '待命'
}

/**
 * 主界面右下角的 AI 状态窗：待命 / 连接中 / 生成中 / 运行正常 / 出错 / 已关闭，
 * 点一下展开可以看到用的哪个模型、Key 是否已填，并能直接停止。
 */
export function AiStatusBadge({
  status,
  config,
  onAbort,
  onOpenSettings,
}: AiStatusBadgeProps): ReactNode {
  const [expanded, setExpanded] = useState(false)
  const label = phaseLabel(status, config.enabled)
  const busy = status.phase === 'connecting' || status.phase === 'generating'
  const effectiveModel = resolveEffectiveModel(config)

  return (
    <div
      className={`ai-status ai-status--${config.enabled ? status.phase : 'off'}${expanded ? ' is-open' : ''}`}
      data-testid="ai-status-badge"
    >
      <button
        type="button"
        className="ai-status__chip"
        data-testid="ai-status-toggle"
        aria-expanded={expanded}
        onClick={() => setExpanded((current) => !current)}
      >
        <span className="ai-status__dot" aria-hidden />
        <span className="ai-status__label" data-testid="ai-status-label">
          AI · {label}
        </span>
      </button>

      {expanded ? (
        <div className="ai-status__card" data-testid="ai-status-detail">
          <div className="ai-status__card-head">
            <span>AI 助手</span>
            <button
              type="button"
              className="ai-status__close"
              aria-label="收起 AI 状态"
              onClick={() => setExpanded(false)}
            >
              ×
            </button>
          </div>
          <div className="ai-status__line" data-testid="ai-status-message">
            {status.message || label}
          </div>
          <dl className="ai-status__facts">
            <dt>模型</dt>
            <dd>
              {config.model}
              {effectiveModel !== config.model ? ` → ${effectiveModel}` : ''}
            </dd>
            <dt>接口</dt>
            <dd>{config.baseUrl}</dd>
            <dt>思考</dt>
            <dd>{config.thinking ? '开' : '关'}</dd>
            <dt>Key</dt>
            <dd>{maskApiKey(config.apiKey)}</dd>
          </dl>
          {config.apiKey ? null : (
            <p className="ai-status__note" data-testid="ai-status-nokey">
              还没有填 API Key：到「设置 → AI 助手」粘贴硅基流动的 Key 之后才能用。
            </p>
          )}
          <div className="ai-status__actions">
            {busy ? (
              <button type="button" className="btn btn--sm" data-testid="ai-status-abort" onClick={onAbort}>
                停止
              </button>
            ) : null}
            {onOpenSettings ? (
              <button type="button" className="btn btn--sm btn--ghost" onClick={onOpenSettings}>
                打开设置
              </button>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  )
}
