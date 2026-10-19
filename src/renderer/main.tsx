import React, { useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { App, type AppStatus } from './App'
import { readInitialLocation } from './initialLocation'
import './styles/global.css'

/** 在没有 Electron（纯浏览器预览或测试）时使用的兜底状态。 */
const FALLBACK: AppStatus = {
  dataFilePath: '文档\\AI日程\\schedule.db',
  lastBackupAt: null,
  backupFailed: false,
  eventCount: 0,
  dataDirMissing: false,
}

function Root(): React.ReactElement {
  const [status, setStatus] = useState<AppStatus | null>(null)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    let cancelled = false
    const api = window.api
    if (!api) {
      setStatus(FALLBACK)
      setReady(true)
      return () => {
        cancelled = true
      }
    }
    api
      .getStatus()
      .then((payload) => {
        if (cancelled) return
        setStatus({
          dataFilePath: payload.dataFilePath,
          lastBackupAt: payload.lastBackupAt,
          backupFailed: payload.backupFailed,
          eventCount: payload.eventCount,
          dataDirMissing: payload.dataDirMissing,
        })
      })
      .catch(() => {
        if (!cancelled) setStatus(FALLBACK)
      })
      .finally(() => {
        if (!cancelled) setReady(true)
      })
    return () => {
      cancelled = true
    }
  }, [])

  if (!ready) return <div className="placeholder">正在加载…</div>

  const initial = readInitialLocation(window.location.search)
  return (
    <App
      status={status}
      initialPage={initial.page}
      initialView={initial.view}
      onNavigate={(page, view) => {
        window.api?.rememberLocation(page, view).catch(() => undefined)
      }}
    />
  )
}

const container = document.getElementById('root')
if (!container) throw new Error('缺少 #root 容器')

createRoot(container).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>,
)
