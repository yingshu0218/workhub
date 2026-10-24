/**
 * vitest 全局测试基线（`vitest.config.ts` 的 `setupFiles`）。
 *
 * ## 为什么需要它（2026-10-24）
 *
 * 本仓的组件/数据层用例几乎都跑在 jsdom + fake-indexeddb 上：每个用例要等
 * **IndexedDB 事务 → liveQuery 推送 → React 重渲染**三跳。测试库的默认等待预算却是
 * 按「同步 DOM 断言」定的（`findBy*` / `waitFor` 默认 1000ms）。单跑时毫秒级完成，
 * 全量并发（116 个 worker 抢 CPU）时经常来不及，表现为：
 *  - `Unable to find an element with the text: …`（等不到，不是不存在）
 *  - `Test timed out in 5000ms`
 * 两者都会被误读成「功能坏了」，实际是**等待预算不足**。实测同一份代码：
 * worker 启动 1.22s 时 3 条失败，5.69s 时 11 条失败 —— 失败数随机器负载漂移。
 *
 * ## 改了哪两个预算，为什么不是「把断言放宽」
 *
 * - `asyncUtilTimeout` 1000ms → 3000ms：只影响「最多等多久」，断言内容不变 ——
 *   真不存在时依然会失败（`waitFor` 仍会抛 TimeoutError），不会变成假绿。
 * - `testTimeout`（`vitest.config.ts`）5000ms → 15000ms：同理，只是给多步交互用例
 *   留出预算。**不要**为了「变绿」删断言或改成固定 sleep。
 *
 * ⚠️ 这两个值刻意不设得更大（如 30s）：真挂住（Promise 永不 resolve）的用例必须在
 * 有限时间内红掉，否则整套测试会变成「等十分钟然后失败」。
 */
import { configure } from '@testing-library/dom'

configure({ asyncUtilTimeout: 3000 })
