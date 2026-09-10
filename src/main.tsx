import { StrictMode, useEffect } from 'react'
import { createRoot } from 'react-dom/client'
import 'dayjs/locale/zh-cn'
import dayjs from 'dayjs'
import AppRouter from './app/router'
import './styles/index.css'
import { seedIfEmpty } from './db/seed'
import { backfillTodoCompletedAt, backfillTodoVoidedAt } from './modules/todo/domain'
import { syncEngine } from './sync/engine'
import { installKeyboardListener } from './shared/shortcuts'
import { installModuleEffects } from './shared/effects'
import { installAgentBridge } from './agent/install'
import { IdentityProvider } from './modules/identity'

dayjs.locale('zh-cn')

function Bootstrap() {
  useEffect(() => {
    // 持久化存储：防手机浏览器回收 IndexedDB（开发计划 2.3 多设备约定）
    if (navigator.storage?.persist) {
      void navigator.storage.persist().then((granted) => {
        if (!granted) console.warn('[storage] 持久化存储未获批，数据可能被浏览器回收')
      })
    }
    void seedIfEmpty()
      .then((seeded) => {
        if (seeded) console.info('[seed] 演示数据写入完成')
      })
      // 存量兜底：done 无 completedAt 的待办补盖完成时间（幂等，Issue #74 口径统一）
      .then(() => backfillTodoCompletedAt())
      .then((n) => {
        if (n) console.info(`[migrate] 补齐 ${n} 条待办的 completedAt`)
      })
      // 存量兜底：voided 无 voidedAt 的待办补盖作废时间（同上，Issue #128 三态口径）
      .then(() => backfillTodoVoidedAt())
      .then((n) => {
        if (n) console.info(`[migrate] 补齐 ${n} 条待办的 voidedAt`)
      })
    syncEngine.start()
    installKeyboardListener()
    installModuleEffects()
    // AI Agent 桥：按 settings `ai` 段决定是否连出本地 relay（缺省关，零影响）
    let disposeBridge: (() => void) | undefined
    void installAgentBridge().then((d) => {
      disposeBridge = d
    })
    // PWA：仅生产构建注册 Service Worker（cache-first 静态资源，API 不缓存）
    if (import.meta.env.PROD && 'serviceWorker' in navigator) {
      window.addEventListener('load', () => {
        navigator.serviceWorker.register('/sw.js').catch((err) => {
          console.warn('[pwa] Service Worker 注册失败', err)
        })
      })
    }
    return () => {
      syncEngine.stop()
      disposeBridge?.()
    }
  }, [])

  return (
    <IdentityProvider>
      <AppRouter />
    </IdentityProvider>
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Bootstrap />
  </StrictMode>,
)
