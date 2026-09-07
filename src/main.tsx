import { StrictMode, useEffect } from 'react'
import { createRoot } from 'react-dom/client'
import 'dayjs/locale/zh-cn'
import dayjs from 'dayjs'
import AppRouter from './app/router'
import './styles/index.css'
import { seedIfEmpty } from './db/seed'
import { syncEngine } from './sync/engine'
import { installKeyboardListener } from './shared/shortcuts'
import { installModuleEffects } from './shared/effects'

dayjs.locale('zh-cn')

function Bootstrap() {
  useEffect(() => {
    // 图标字体就绪门控：就绪（或 4s 超时兜底）后显示图标，杜绝裸文本闪现
    const showIcons = () => document.documentElement.classList.remove('icons-loading')
    try {
      Promise.race([
        document.fonts.load('24px "Material Symbols Rounded"'),
        new Promise((r) => setTimeout(r, 4000)),
      ]).then(showIcons, showIcons)
    } catch {
      showIcons()
    }
    // 持久化存储：防手机浏览器回收 IndexedDB（开发计划 2.3 多设备约定）
    if (navigator.storage?.persist) {
      void navigator.storage.persist().then((granted) => {
        if (!granted) console.warn('[storage] 持久化存储未获批，数据可能被浏览器回收')
      })
    }
    void seedIfEmpty().then((seeded) => {
      if (seeded) console.info('[seed] 演示数据写入完成')
    })
    syncEngine.start()
    installKeyboardListener()
    installModuleEffects()
    // PWA：仅生产构建注册 Service Worker（cache-first 静态资源，API 不缓存）
    if (import.meta.env.PROD && 'serviceWorker' in navigator) {
      window.addEventListener('load', () => {
        navigator.serviceWorker.register('/sw.js').catch((err) => {
          console.warn('[pwa] Service Worker 注册失败', err)
        })
      })
    }
    return () => syncEngine.stop()
  }, [])

  return <AppRouter />
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Bootstrap />
  </StrictMode>,
)
