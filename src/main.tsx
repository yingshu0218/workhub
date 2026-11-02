import { StrictMode, useEffect } from 'react'
import { createRoot } from 'react-dom/client'
import 'dayjs/locale/zh-cn'
import dayjs from 'dayjs'
// 浏览器端 StorageAdapter 注册（Dexie）：eager 加载，保证执行链首个 storage 调用前已就绪
import './storage/browser'
import AppRouter from './app/router'
import { AuthGate } from './app/AuthGate'
import './styles/index.css'
import { backfillDemoRelations, seedIfEmpty } from './db/seed'
import { sweepExpiredTrash } from './modules/trash/retention'
import { reconcileOrphansOnce } from './sync/reconcile'
import { backfillTodoCompletedAt, backfillTodoVoidedAt } from './modules/todo/backfill'
import { syncEngine } from './sync/engine'
import { autoConfigureSameOriginSync } from './sync/pocketbaseAdapter'
import { installKeyboardListener } from './shared/shortcuts'
import { installModuleEffects } from './shared/effects'
import { installAgentBridge } from './agent/install'
import { IdentityProvider } from './modules/identity'
import { isTauri, isServerFirstWeb } from './platform/env'
import { setStorageAdapter } from './storage'
import { createServerFirstAdapter } from './storage/serverFirst'
import { convergeFromServer, startServerFirstLoop, stopServerFirstLoop } from './sync/convergeFromServer'

dayjs.locale('zh-cn')

/**
 * 服务端唯一真源（2026-11-03 用户裁决）：Web 生产环境把写入适配器换成「直写 PB」。
 *
 * ⚠️ 必须在模块体里换、且晚于 `./storage/browser` 的副作用注册（import 提升保证顺序）：
 * 早于任何 `storage.*` 调用，晚于 Dexie 注册，才能「覆盖」而不是「未注册」。
 */
const SERVER_FIRST = isServerFirstWeb()
if (SERVER_FIRST) {
  setStorageAdapter(createServerFirstAdapter())
  console.info('[server-first] Web 端启用「服务端唯一真源」：写直达 PocketBase，本地仅镜像')
}

function Bootstrap() {
  useEffect(() => {
    // 持久化存储：防手机浏览器回收 IndexedDB（开发计划 2.3 多设备约定）
    if (navigator.storage?.persist) {
      void navigator.storage.persist().then((granted) => {
        if (!granted) console.warn('[storage] 持久化存储未获批，数据可能被浏览器回收')
      })
    }
    // ⚠️ 演示种子**只在开发模式**写入（2026-10-28 用户拍板）。
    // `seedIfEmpty()` 的判据只有「customers 为空」——生产里跑它，等于每次清库都被灌回来，
    // 正式站永远回不到空库。注意：后面的存量兜底与同源自动同步在所有环境都要跑，
    // 所以只把 seed 这一步换成 dev 分支，不要把整条链塞进 if。
    const seeding = !SERVER_FIRST && import.meta.env.DEV ? seedIfEmpty() : Promise.resolve(false)
    void seeding
      .then((seeded) => {
        if (seeded) console.info('[seed] 演示数据写入完成')
      })
      // 一次性清掉历史遗留的演示种子残留（本地库不会自己变空：同步只合并不删除）。
      // 放在同步之前 —— 否则会先把这些「无主」记录当成本地增量推上去。
      // 回收站保留期清扫：与同步无关（本地模式也要清），24h 节流在模块内部
      .then(() => sweepExpiredTrash())
      .then((n) => {
        if (n) console.info(`[trash] ${n} 条超过保留期的记录已彻底删除`)
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
      // 同源自动同步（2026-10-15 用户拍板）：Web 版与 PB 同源部署时打开即自动启用。
      // ⚠️ 必须挂在 seed 链尾部——2026-10-16 实测：与 seed 并发时 settings 未建档，
      // autoConfigure 永远早退 → 用户停在「仅本机」看不到服务端数据。
      .then(() => (SERVER_FIRST ? false : autoConfigureSameOriginSync()))
      .then((configured) => {
        if (configured) {
          console.info('[sync] 检测到同源 PocketBase，已自动启用同步')
          void syncEngine
            .syncNow('auto-config') // 立即拉一轮，首屏数据即刻收敛
            // 首轮拉完再对账：远端没有的本地「已同步」行 = 孤儿 → 送进回收站（不物理删）
            .then(() => reconcileOrphansOnce())
            .then((n) => {
              if (n) console.info(`[reconcile] ${n} 条孤儿记录已移入回收站（冲突删除）`)
            })
            .catch((err) => console.warn('[reconcile] 对账失败（不影响正常同步）', err))
        }
      })
      .catch((err) => console.warn('[sync] 同源自动同步检测失败（本地模式照常）', err))
    if (SERVER_FIRST) {
      // 服务端唯一真源：没有队列、没有 LWW，改为「启动对齐 + 周期对齐」（convergeFromServer）
      void convergeFromServer()
        .then((r) =>
          console.info(`[server-first] 已与服务端对齐：写入 ${r.upserted} 条、清理 ${r.removed} 条`),
        )
        .catch((err) => console.warn('[server-first] 首轮对齐失败（未登录/未连通，登录后自动重试）', err))
      startServerFirstLoop()
    } else {
      syncEngine.start()
    }
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
      stopServerFirstLoop()
      syncEngine.stop()
      disposeBridge?.()
    }
  }, [])

  return (
    <IdentityProvider>
      {/* 登录守卫：容器配了管理员才启用（未配置时 fail-open，不挡人） */}
      <AuthGate>
        <AppRouter />
      </AuthGate>
    </IdentityProvider>
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Bootstrap />
  </StrictMode>,
)
