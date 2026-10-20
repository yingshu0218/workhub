import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { Icon } from './Icon'
import { usePresence } from '@/shared/usePresence'

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
  /** 已触发关闭、正在播退出动画 —— 此时仍在 DOM 上，动画播完由 ToastRow 通知移除 */
  leaving?: boolean
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
    // 先标记出场，再由单条 Toast 在动画播完后真正移除（见 ToastRow）
    setItems((list) => list.map((t) => (t.id === id ? { ...t, leaving: true } : t)))
  }, [])

  /** presence 播完出场后的真实移除（ToastRow 回调） */
  const remove = useCallback((id: number) => {
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
        {items.map((t) => (
          <ToastRow key={t.id} item={t} onDismiss={() => dismiss(t.id)} onRemove={() => remove(t.id)} />
        ))}
      </div>
    </ToastContext.Provider>
  )
}

/**
 * 单条 Toast：用 presence 把「已请求关闭」与「已离开 DOM」拆开，
 * 让顶部滑入 / 上滑淡出都有机会播完（原先是直接 filter 掉、没有任何退出过程）。
 */
function ToastRow({
  item,
  onDismiss,
  onRemove,
}: {
  item: ToastItem
  onDismiss: () => void
  onRemove: () => void
}) {
  const { present, phase, ref } = usePresence(!item.leaving, 150)
  const closing = phase === 'out'

  // 出场播完 → 通知上层的列表把这条真正移除
  useEffect(() => {
    if (!present) onRemove()
  }, [present, onRemove])

  if (!present) return null
  const style = TONE_STYLE[item.tone]
  return (
    <div
      ref={ref}
      className={`pointer-events-auto flex max-w-[420px] items-start gap-2 rounded-xl border border-outline-variant/40 bg-surface-container-lowest px-4 py-2.5 text-[0.9286rem] shadow-[0_8px_32px_rgba(0,0,0,0.16)] ${
        closing ? 'anim-toast-out' : 'anim-toast-in'
      }`}
    >
      <Icon name={style.icon} size={18} className={`mt-0.5 shrink-0 ${style.cls}`} />
      <span className="leading-relaxed">{item.message}</span>
      <button
        className="ml-1 shrink-0 text-outline transition-colors hover:text-on-surface"
        onClick={onDismiss}
        title="关闭"
      >
        <Icon name="close" size={16} />
      </button>
    </div>
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
