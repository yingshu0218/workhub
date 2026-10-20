import type { CSSProperties } from 'react'

/**
 * 列表错峰入场的统一步长与封顶（DESIGN.md「Motion · Rules」第 5 条）。
 */
export const STAGGER_STEP_MS = 20
export const STAGGER_CAP = 10

/**
 * 给列表项算一个错峰入场延迟，返回可直接喂给 `style` 的对象。
 *
 * 用法（配合 `.anim-list-item`）：
 * ```tsx
 * {list.map((item, i) => (
 *   <li key={item.id} className="anim-list-item" style={staggerStyle(i)}>…</li>
 * ))}
 * ```
 *
 * ## 为什么封顶
 * 1. **只错峰前 ~10 项**：第 11 项起本就在折线（fold）以下，给它们延迟只是
 *    让用户「多等一会儿才看到」，没有任何收益。
 * 2. **总时长恒定**：入场总时长 = `cap × step` = 200ms，与列表长度无关。
 *    否则月历热力格（28~31 格）全量错峰会拖到 600ms+，观感从「顺滑」变成「漏项」。
 * 3. 封顶后行为可预测：3 条和 300 条列表的入场节奏一致。
 *
 * ## 为什么返回 undefined 而不是 `{ animationDelay: '0ms' }`
 * 超出封顶的项**根本不写 `style` 属性**，DOM 更干净、也不会在 DevTools 里堆满
 * 无意义的 `0ms`。与既有的 CommandPalette 结果项写法保持一致。
 *
 * ## 为什么在 jsdom 里是确定性的（重要）
 * - 纯函数：无 `matchMedia`、无 `animationend`、无 `Date`、无 `Math.random`
 *   —— 输入相同必然输出相同，不会给既有 22 个 jsdom 用例引入时序不确定。
 * - 只产出内联 `animationDelay`；jsdom 不跑样式引擎，该属性对 DOM 断言不可见。
 * - **降级无需额外分支**：`data-motion=off` / `prefers-reduced-motion` 下，
 *   CSS 侧是 `animation: none !important`，delay 自然失去意义
 *   （不会出现「等 200ms 才出现」这种更糟的降级）。
 *
 * ## ⚠️ 必须与 `backwards` 填充配合
 * 入场类 `.anim-list-item` 用的是 `animation-fill-mode: backwards`：
 * 延迟期间显示 `from` 态（opacity 0）→ 错峰不会「先亮后跳」；
 * 动画结束后**释放填充** → 元素自身的 hover / active 正常工作。
 * 若哪天把它改回 `both`，同元素上的 hover 抬升会**静默失效**
 * （`src/styles/__tests__/motion.tokens.test.ts` 有锁）。
 */
export function staggerStyle(
  index: number | undefined,
  cap: number = STAGGER_CAP,
  step: number = STAGGER_STEP_MS,
): CSSProperties | undefined {
  // index 可缺省：行由子组件渲染时（CustomerRow / TransactionRow）序号是可选 prop，
  // 不传即「这条不参与错峰」——而不是报错或当成 0。
  if (index === undefined || !Number.isFinite(index) || index < 0 || index >= cap) {
    return undefined
  }
  return { animationDelay: `${index * step}ms` }
}