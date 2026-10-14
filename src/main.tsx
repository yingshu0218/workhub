import { StrictMode, useEffect } from 'react'
import { createRoot } from 'react-dom/client'
import 'dayjs/locale/zh-cn'
import dayjs from 'dayjs'
import AppRouter from './app/router'
import './styles/index.css'
import { backfillDemoRelations, seedIfEmpty } from './db/seed'
import { backfillTodoCompletedAt, backfillTodoVoidedAt } from './modules/todo/domain'
import { syncEngine } from './sync/engine'
import { installKeyboardListener } from './shared/shortcuts'
import { installModuleEffects } from './shared/effects'
import { installAgentBridge } from './agent/install'
import { IdentityProvider } from './modules/identity'
import { isTauri } from './platform/env'

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
      // 存量兜底：老本地库补上演示客户关系（种子是后来才加的关系；三重边界见 seed.ts）
      .then(() => backfillDemoRelations())
      .then((n) => {
        if (n) console.info(`[seed] 补齐 ${n} 对演示客户关系（老本地库自愈）`)
      })
    syncEngine.start()
    installKeyboardListener()
    installModuleEffects()
    // AI Agent 桥：按 settings `ai` 段决定是否连出本地 relay（缺省关，零影响）
    let disposeBridge: (() => void) | undefined
    void installAgentBridge().then((d) => {
      disposeBridge = d
    })
    // PWA：仅「生产构建 + 浏览器环境」注册 Service Worker（cache-first 静态资源，API 不缓存）
    // ⚠️ 原生壳（Tauri）必须跳过：WebView 里的 SW 会让「代码改了但界面没变」，排查成本极高；
    // 且原生端资源本来自带加载，不需要 SW 缓存。环境判定见 src/platform/env.ts。
    // ⚠️ 不能只用 window.addEventListener('load', ...)：本段位于 React useEffect 内，
    // 实测 load 先于 useEffect 触发（load 166ms / useEffect 202ms），监听器挂上时事件已成过去，
    // register 永远不会被调用 → 首次访问 SW 注册数恒为 0、离线能力全程失效（功能测试 #192/#193）。
    // 故：已 complete 就直接注册，否则才等 load（{ once: true } 避免重复）。
    if (import.meta.env.PROD && !isTauri() && 'serviceWorker' in navigator) {
      const registerSW = () => {
        navigator.serviceWorker.register('/sw.js').catch((err) => {
          console.warn('[pwa] Service Worker 注册失败', err)
        })
      }
      if (document.readyState === 'complete') registerSW()
      else window.addEventListener('load', registerSW, { once: true })
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
