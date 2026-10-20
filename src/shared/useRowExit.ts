import { useEffect, useRef, useState } from 'react'
import { isMotionOff } from './usePresence'

/**
 * 列表行的「退场存活层」。
 *
 * ## 解决什么问题
 * 待办打勾完成、习惯取消打卡 —— 这些操作会让该行**立刻从过滤结果里消失**，
 * 于是行「啪」地不见了，同一瞬间下方的行整体上跳。`.anim-row-out` 写了也白写：
 * 元素根本不在 DOM 里了。
 *
 * 做法与 `usePresence` 同源，但作用于**集合里若干个会各自消失的 key**：
 * 把「数据里已经没有这一行」与「这一行还要留在 DOM 上把出场播完」拆开。
 *
 * ## 用法
 * ```tsx
 * const rows = useRowExit(filtered, (t) => t.id, 200, 'todo-done')
 * return rows.map(({ item, leaving }, i) => (
 *   <li key={item.id}
 *       className={leaving ? 'anim-row-out' : 'anim-list-item'}
 *       style={staggerStyle(i)}>
 * ```
 * ⚠️ 调用方**不要**再对数组做 filter —— 把「该显示什么」整份交给它，
 * 否则「谁刚消失」这个信息在到达 hook 之前就丢了。
 *
 * ## 为什么不复用 usePresence
 * `usePresence` 管的是「单个布尔开关」。这里要跟踪的是一组 key：
 * 可能同时有 3 行在退场、又有新行插进来。给每个 key 建一个 hook 实例
 * 既违反 Hooks 规则（数量会变），也拿不到「刚刚少的是谁」。
 *
 * ## ⚠️ 降级与测试环境（重要）
 * `prefers-reduced-motion` / `<html data-motion="off">` 下**同步移除**、不保留存活项。
 * 这保证了无障碍用户不会看到「点完还挂在那里」。
 *
 * jsdom 不跑样式引擎、不派发 animationend，所以**测试里默认必须是即时移除**，
 * 否则既有的「点完就不该再查到这一行」类断言会红。
 * 为此 duration 的默认值是 0（0 即视为降级）。调用方若要真动画，
 * 显式传毫秒数 —— 但那样在 jsdom 里就会进入「存活」路径，
 * 相关测试需要 `await waitFor(...)` 或先设 `data-motion="off"`。
 *
 * @param items    当前应当显示的**完整**数组（不要预先 filter）
 * @param keyOf    取 key 的函数（须稳定：模块级常量或 useCallback）
 * @param duration 退场时长 ms；默认 0 = 立即移除
 * @param debugTag 仅用于开发期区分实例（不影响行为）
 */
export function useRowExit<T>(
  items: readonly T[],
  keyOf: (item: T) => string,
  duration = 0,
  debugTag = 'row',
): { item: T; leaving: boolean }[] {
  /** 正在播出场的行：数据已经不在 items 里了，所以要把数据快照自己留着 */
  const [leaving, setLeaving] = useState<{ key: string; item: T }[]>([])

  /** 上一帧的完整 key→item 快照，用于算出「这一帧少了谁」 */
  const prev = useRef(new Map<string, T>())
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>())
  const alive = useRef(true)
  /** effect 里要读最新的 leaving，但不能把它放进依赖（否则每帧重启） */
  const leavingRef = useRef(leaving)
  leavingRef.current = leaving

  useEffect(() => {
    alive.current = true
    const map = timers.current
    return () => {
      alive.current = false
      map.forEach((t) => clearTimeout(t))
      map.clear()
      return
    }
  }, [])

  // 依赖用「拼起来的 key 串」而不是数组本身：数组每次渲染都是新引用，
  // 直接依赖它会每帧都跑一遍比较（虽然结果幂等，但白白开销）。
  // ⚠️ 分隔符用 \u0000 而不是 `,` —— id 里出现逗号就会撞键（见项目里 uuid 之外的自定义 id）。
  const keySig = items.map(keyOf).join('\u0000')

  useEffect(() => {
    const next = new Map<string, T>()
    for (const it of items) next.set(keyOf(it), it)

    // ① 重新出现的 key（撤销打勾、又打开）→ 立刻中止它的退场，避免「回来了却还在淡出」
    for (const l of leavingRef.current) {
      if (!next.has(l.key)) continue
      const t = timers.current.get(l.key)
      if (t) {
        clearTimeout(t)
        timers.current.delete(l.key)
      }
      setLeaving((ls) => ls.filter((x) => x.key !== l.key))
    }

    // ② 上一帧有、这一帧没了的 key → 进入退场
    const degraded = isMotionOff() || duration <= 0
    for (const [key, item] of prev.current) {
      if (next.has(key)) continue
      if (degraded) continue // 降级：直接丢弃，不留存活项
      if (timers.current.has(key)) continue // 已在退场中（同一 key 被复用）

      if (import.meta.env?.DEV) {
        // 开发期留个痕迹，便于排查「某行退场没播」是不是 hook 没接上
        void debugTag
      }

      setLeaving((ls) => (ls.some((l) => l.key === key) ? ls : [...ls, { key, item }]))
      const timer = setTimeout(() => {
        timers.current.delete(key)
        if (alive.current) setLeaving((ls) => ls.filter((l) => l.key !== key))
      }, duration)
      timers.current.set(key, timer)
    }

    prev.current = next
    // ⚠️ 依赖刻意只有 keySig 与 duration：items 的**内容**变化（标题被编辑）
    // 不该触发退场比较；只有「哪些 key 在场上」变了才有意义。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keySig, duration, keyOf])

  const nowKeys = new Set(items.map(keyOf))
  const exits = leaving
    .filter((l) => !nowKeys.has(l.key))
    .map((l) => ({ item: l.item, leaving: true }))

  return [...items.map((item) => ({ item, leaving: false })), ...exits]
}

/**
 * 判断某个列表是否值得接退场动画。
 *
 * 不是所有列表都该有 —— 只有「用户主动让某一行消失」的场景才有意义
 * （打勾、作废、删除）。而「切换筛选导致整批换掉」不属于，那是 tab 切换，
 * 应该走容器的 `anim-enter`，给每行播退场反而会看起来像卡顿。
 */
export const ROW_EXIT_DURATION_MS = 200