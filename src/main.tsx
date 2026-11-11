import { StrictMode, useEffect } from 'react'
import { createRoot } from 'react-dom/client'
import dayjs from 'dayjs'
import 'dayjs/locale/zh-cn'
import './storage/browser'
import './styles/index.css'
import AppRouter from './app/router'
import { AuthGate } from './app/AuthGate'
import { IdentityProvider } from './modules/identity'
import { isServerFirstWeb, isTauri } from './platform/env'
import { setStorageAdapter } from './storage'
import { createServerFirstAdapter } from './storage/serverFirst'
import { startClientSync } from './sync/clientSync'
import { installKeyboardListener } from './shared/shortcuts'
import { installModuleEffects } from './shared/effects'
import { syncEngine } from './sync/engine'
import { seedIfEmpty } from './db/seed'
import { useFocusStore } from './stores/focus'

dayjs.locale('zh-cn')
if (isServerFirstWeb()) setStorageAdapter(createServerFirstAdapter())
function AuthenticatedApp() {
  useEffect(() => {
    // 会话子树随server/owner/generation重挂，旧页面状态与查询订阅随之销毁。
    useFocusStore.getState().abort()
    const disposeEffects = installModuleEffects()
    if (isServerFirstWeb()) {
      const stop = startClientSync()
      return () => {
        stop()
        useFocusStore.getState().abort()
        disposeEffects?.()
      }
    }
    void seedIfEmpty().then(() => syncEngine.start())
    return () => {
      syncEngine.stop()
      useFocusStore.getState().abort()
      disposeEffects?.()
    }
  }, [])
  return (
    <IdentityProvider>
      <AppRouter />
    </IdentityProvider>
  )
}
function Bootstrap() {
  useEffect(() => {
    installKeyboardListener()
    if (import.meta.env.PROD && !isTauri() && 'serviceWorker' in navigator)
      void navigator.serviceWorker.register('/sw.js').catch(() => {})
  }, [])
  return (
    <AuthGate>
      <AuthenticatedApp />
    </AuthGate>
  )
}
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Bootstrap />
  </StrictMode>,
)
