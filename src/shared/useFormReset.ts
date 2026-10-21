import { useState } from 'react'

/**
 * 弹层（Modal / Drawer）表单的「打开时重置回填」骨架（**收口 C-10 · 2026-10-21**）
 *
 * ## 抽这个的理由
 *
 * 本仓有 **7 处**（5 个 `*FormDrawer` + `GroupEditorDrawer` + `TodoPage` 的待办表单）
 * 各自手写了**同一套**「渲染期重置」代码：
 *
 * ```tsx
 * const openKey = `${open}-${record?.id ?? 'new'}`
 * const [lastKey, setLastKey] = useState('')
 * if (openKey !== lastKey) {
 *   setLastKey(openKey)
 *   if (open) { setName(...); setError(''); setSeedKey((k) => k + 1) }
 * }
 * ```
 *
 * 抄了 7 遍的后果不是「重复难看」，而是**细节已经漂移**（keys 拼法、要不要 `if (open)`、
 * 要不要 `seedKey` 各不相同）—— 这正是本仓反复踩的「多处同源实现一定会各自演化」。
 *
 * ## 为什么是「渲染期重置」而不是 `useEffect`
 *
 * 这是既有设计（原注释写「渲染期重置模式，同 TodoFormDrawer」），**不改语义**：
 * 渲染期同步重置 → 弹层第一帧就已是回填后的值，不会闪一帧空表单。
 * 用 `useEffect` 会晚一帧，属**可感知的行为变化**，故沿用渲染期做法。
 *
 * ## 设计取舍：显式传 `open`，不从 key 里猜
 *
 * `open` **作为独立参数显式传入**，不靠解析 key 前缀推断 ——
 * 后者是「看着简洁但改 key 拼法就静默失效」的隐式耦合，本仓已有多起此类教训。
 *
 * ## 覆盖的变体（都在参数里显式表达，不靠调用方绕开）
 *
 * | 变体 | 表现 | 本 hook 的处理 |
 * |---|---|---|
 * | key 含额外变量 | `TransactionFormDrawer` 的 key 是 `${open}-${defaultLedgerId}-${id}` | `key` 接受任意字符串，由调用方拼 |
 * | id 用 `?? 'new'` 还是 `?? ''` | 两种都有 | **无行为差异**（只需「与上次不同」），调用方自定 |
 * | 要不要 `if (open)` | 多数包，`HabitFormDrawer` 不包（字段均有 `?? 默认值` 兜底） | **不代劳**：`reset` 由调用方写，包不包逐处可见 |
 * | 要不要 `seedKey` | 4 处有（强制重建子 DOM，清除非受控状态）、2 处无 | 提供；**不用就不解构** |
 *
 * ## 用法
 *
 * ```tsx
 * const openKey = `${open}-${record?.id ?? 'new'}`
 * const { seedKey } = useFormReset(openKey, open, (isOpen) => {
 *   if (!isOpen) return
 *   setName(record?.name ?? '')
 *   setError('')
 * })
 * // 需要强制重建子 DOM 时：<div key={seedKey}>
 * ```
 *
 * @param key 打开标识：变化即触发重置。由调用方按需拼（可含任意额外变量）
 * @param open 本次是否处于打开态（**显式传入**，不解析 key）
 * @param reset 重置回调，入参为 `open`；**关闭时是否也重置由调用方决定**
 * @returns `seedKey` —— 递增计数；**仅在打开时递增**（与既有 4 处行为一致），
 *          用于 `<div key={seedKey}>` 强制重建子树（清空非受控状态）
 */
export function useFormReset(
  key: string,
  open: boolean,
  reset: (open: boolean) => void,
): { seedKey: number } {
  const [lastKey, setLastKey] = useState('')
  const [seedKey, setSeedKey] = useState(0)

  if (key !== lastKey) {
    setLastKey(key)
    reset(open)
    // ⚠️ 只在打开时递增（既有 4 处 `setSeedKey` 都在 `if (open)` 内）：
    // 关闭时也递增会多一次子树重建 —— 弹层正在关闭虽看不出差别，
    // 但那是**无谓的额外渲染**，且会让 `seedKey` 的含义从「第几次打开」变成「第几次变化」。
    if (open) setSeedKey((k) => k + 1)
  }

  return { seedKey }
}