import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * 出场动画的「存活层」。
 *
 * 解决的问题：全仓弹层原先是 `if (!open) return null` —— 关闭瞬间组件就从树上摘掉，
 * CSS 出场动画根本没有机会播（元素已经不在 DOM 里了）。于是所有弹层都是「啪」地消失。
 *
 * 做法：把「是否 open」与「是否挂载」拆成两件事。
 *  · open 变 true  → present = true，phase = 'in'
 *  · open 变 false → 保持挂载、phase = 'out'，等出场动画播完再 present = false
 *
 * 为什么以定时器为主、animationend 只作提前收口 ——
 * jsdom / happy-dom **不派发 animationend**（它们不跑样式引擎），
 * 而本仓库有 8 个测试文件直接断言弹层 DOM 的存在与否。
 * 若只依赖 animationend，关掉弹层后组件会永远留在树上、断言全红。
 * 定时器在测试环境同样可靠，且 waitFor 默认 1000ms 足够容纳 200~300ms 的出场时长。
 * 真实浏览器里两者都到，先到的那个赢（`done` 幂等守卫）。
 *
 * 降级（两处都必须立即卸载，不能等）：
 *  · 操作系统 `prefers-reduced-motion: reduce`（WCAG 2.1 SC 2.3.3，无条件生效）
 *  · 应用内设置 `<html data-motion="off">`（由 effects.ts 写入）
 * 此时 duration 视为 0 → 同步卸载。这同时保证了「无障碍场景」与「测试环境」行为一致。
 */

/** 与 styles/index.css 的 --motion-duration-base 对齐的兜底基时（降级判定前使用） */
const DEFAULT_DURATION_MS = 200

type Phase = 'in' | 'out'

export interface Presence<T extends HTMLElement = HTMLDivElement> {
  /** 是否应挂载在 DOM 上（含「正在播出场」这一小段） */
  present: boolean
  /** 当前方向：入场 / 出场 */
  phase: Phase
  /**
   * 挂到弹层根节点上，用于监听 animationend 做提前收口。
   *
   * 刻意用 callback ref 而非 RefObject：调用方常需要拿到同一个节点做别的事
   * （如 EntityHoverCard 的「点外关闭」子树判定），`RefObject.current` 在 React 18
   * 类型里是只读的、无法在另一个 ref callback 里赋值；而 callback ref 两边都能收。
   * 同时它是稳定引用（useCallback 空依赖），不会因重渲染被反复摘挂。
   */
  ref: (node: T | null) => void
}

/**
 * 是否处于「动效关闭」状态：系统偏好优先，其次看应用内 data-motion。
 *
 * 导出给 useRowExit 复用 —— 降级判定必须**只有一处实现**：
 * 两处各写一份，迟早会出现「弹层已经不动了、列表还在动」这类不一致。
 */
export function isMotionOff(): boolean {
  if (typeof window === 'undefined') return false
  if (typeof window.matchMedia === 'function') {
    try {
      if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return true
    } catch {
      /* 某些内嵌 WebView 的实现会抛错，退化为不看系统偏好 */
    }
  }
  return document.documentElement.dataset.motion === 'off'
}

/**
 * @param open      受控开合（弹层的 open prop）
 * @param duration  出场时长（ms）；缺省用基时。应与该弹层的 .anim-*-out 时长一致。
 */
export function usePresence<T extends HTMLElement = HTMLDivElement>(
  open: boolean,
  duration: number = DEFAULT_DURATION_MS,
): Presence<T> {
  const [present, setPresent] = useState(open)
  const [phase, setPhase] = useState<Phase>(open ? 'in' : 'out')
  const nodeRef = useRef<T | null>(null)
  const detachRef = useRef<(() => void) | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  /** 幂等守卫：animationend 与定时器可能都到，只允许卸载一次 */
  const done = useRef(false)
  /** 卸载后不再 setState */
  const alive = useRef(true)
  /** 收口函数放 ref：effect 与 ref callback 两处都要调它，且必须是最新闭包 */
  const finishRef = useRef<() => void>(() => {})

  const clear = useCallback(() => {
    if (timer.current !== null) {
      clearTimeout(timer.current)
      timer.current = null
    }
  }, [])

  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
      clear()
      detachRef.current?.()
      detachRef.current = null
    }
  }, [clear])

  useEffect(() => {
    if (open) {
      // 入场：立即挂载（若上一次出场还没播完就被重新打开，这里直接接管）
      clear()
      done.current = false
      setPresent(true)
      setPhase('in')
      return
    }

    // 关闭：从未挂载过就没什么可播的
    if (!present) return

    // 降级：立即卸载，不播出场
    if (isMotionOff() || duration <= 0) {
      setPresent(false)
      setPhase('out')
      return
    }

    done.current = false
    setPhase('out')

    const finish = () => {
      if (done.current || !alive.current) return
      done.current = true
      clear()
      setPresent(false)
    }
    finishRef.current = finish
    timer.current = setTimeout(finish, duration)

    return clear
    // ⚠️ 依赖里刻意不含 present：它只是「是否值得播」的前置判断，
    // 若把它放进依赖，出场开始后 present 变化会重启 effect、把定时器重置成死循环。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, duration, clear])

  const ref = useCallback((node: T | null) => {
    // 节点变化 / 卸载：先摘掉上一份监听，杜绝泄漏
    detachRef.current?.()
    detachRef.current = null
    nodeRef.current = node
    if (!node) return

    // animationend 提前收口（真实浏览器里通常比定时器先到）。
    // 只认根节点自身发出的动画，忽略子元素冒泡上来的。
    const onEnd = (e: AnimationEvent) => {
      if (e.target === node && finishRef.current) finishRef.current()
    }
    node.addEventListener('animationend', onEnd)
    detachRef.current = () => node.removeEventListener('animationend', onEnd)
  }, [])

  return { present, phase, ref }
}