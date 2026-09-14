/**
 * 输入法组合态守卫 —— **单一实现**（用例 #44「中文输入法不误触」）
 *
 * 背景：中文/日文输入法在「候选未确认」阶段按 Enter，语义是**选字**而不是「确认/提交」。
 * 若把这一下 Enter 当成业务快捷键处理，就会出现「拼音还没上屏就把内容提交了 / 浮层被关掉」
 * ——用户在真实输入时高频遇到，但**纯键盘自动化极难复现**（无头环境驱动不了系统候选窗口），
 * 所以这条纪律只能靠「收口 + 单测」保证，不能靠端到端脚本。
 *
 * 两个判据都必要：
 * - `isComposing`：标准字段，组合期间 keydown 事件为 true；
 * - `keyCode === 229`：部分浏览器/输入法在组合态只给 229（`key` 可能是 `Process` 而非 `Enter`），
 *   只看 `isComposing` 会漏；两者取或。
 *
 * ⚠️ 此前这里有 **5 处内联实现**（`shared/shortcuts.ts`、`app/CommandPalette.tsx`、
 * 笔记提及浮层、项目进展输入、客户沟通小结输入），写法一致但各写一遍 ——
 * 新增一处输入框时很容易漏掉守卫（本仓已多次出现「一处接了、另一处漏了」的缺陷形状，见 D11/D13）。
 * 收敛到本函数后，`ime.guard.test.ts` 会扫描源码拒绝新的内联判据，防止再散开。
 */

/** 只依赖事件上真正会用到的两个字段，避免为测试构造完整 KeyboardEvent */
export interface ComposingLikeEvent {
  isComposing?: boolean
  keyCode?: number
}

/**
 * 事件是否处于输入法组合态（组合期间调用方应直接放行、不做任何业务处理）。
 *
 * 用法（KeyboardEvent 与 React 合成事件皆可）：
 * ```ts
 * if (isImeComposing(e.nativeEvent)) return
 * ```
 */
export function isImeComposing(e: ComposingLikeEvent | null | undefined): boolean {
  if (!e) return false
  return e.isComposing === true || e.keyCode === 229
}
