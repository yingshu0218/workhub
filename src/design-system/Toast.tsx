import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { Icon } from './Icon'

/**
 * 全局轻量提示（Toast）—— 替代浏览器原生 alert
 * 挂载于 AppLayout，任意模块通过 useToast() 调用：
 *   const toast = useToast()
 *   toast.success('已恢复 12 条记录')
 *   toast.error('海报生成失败：xxx')
 */

export type ToastTone = 'success' | 'error' | 'info'

export type ToastItem = {
  id: number
  tone: ToastTone
  message: string
}

type ToastApi = {
  show: (message: string, tone?: ToastTone) => void
  success: (message: string) => void
  error: (message: string) => void
  info: (message: string) => void
}

const ToastContext = createContext<ToastApi | null>(null)

const TOAST_DURATION = 3200

const TONE_STYLE: Record<ToastTone, { icon: string; cls: string }> = {
  success: { icon: 'check_circle', cls: 'text-success' },
  error: { icon: 'warning', cls: 'text-danger' },
  info: { icon: 'notifications_active', cls: 'text-primary' },
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([])
  const seq = useRef(0)

  const dismiss = useCallback((id: number) => {
    setItems((list) => list.filter((t) => t.id !== id))
  }, [])

  const show = useCallback(
    (message: string, tone: ToastTone = 'info') => {
      const id = ++seq.current
      setItems((list) => [...list, { id, tone, message }])
      window.setTimeout(() => dismiss(id), TOAST_DURATION)
    },
    [dismiss],
  )

  const api = useMemo<ToastApi>(
    () => ({
      show,
      success: (m: string) => show(m, 'success'),
      error: (m: string) => show(m, 'error'),
      info: (m: string) => show(m, 'info'),
    }),
    [show],
  )

  return (
    <ToastContext.Provider value={api}>
      {children}
      {/* 顶部居中堆叠，不阻塞交互 */}
      <div className="pointer-events-none fixed left-1/2 top-5 z-[70] flex -translate-x-1/2 flex-col items-center gap-2">
        {items.map((t) => {
          const style = TONE_STYLE[t.tone]
          return (
            <div
              key={t.id}
              className="pointer-events-auto flex max-w-[420px] items-start gap-2 rounded-xl border border-outline-variant/40 bg-surface-container-lowest px-4 py-2.5 text-[0.9286rem] shadow-[0_8px_32px_rgba(0,0,0,0.16)]"
            >
              <Icon name={style.icon} size={18} className={`mt-0.5 shrink-0 ${style.cls}`} />
              <span className="leading-relaxed">{t.message}</span>
              <button
                className="ml-1 shrink-0 text-outline transition-colors hover:text-on-surface"
                onClick={() => dismiss(t.id)}
                title="关闭"
              >
                <Icon name="close" size={16} />
              </button>
            </div>
          )
        })}
      </div>
    </ToastContext.Provider>
  )
}

/** 获取全局提示 API；未包裹 ToastProvider 时降级为 console 输出（不静默丢失） */
export function useToast(): ToastApi {
  const ctx = useContext(ToastContext)
  if (ctx) return ctx
  const fallback: ToastApi = {
    show: (m, tone) => console.info(`[toast:${tone ?? 'info'}] ${m}`),
    success: (m) => console.info(`[toast:success] ${m}`),
    error: (m) => console.error(`[toast:error] ${m}`),
    info: (m) => console.info(`[toast:info] ${m}`),
  }
  return fallback
}
