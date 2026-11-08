/**
 * 应用包版本（`package.json` 的 `version`）。
 *
 * 刻意不在源码里写死字面量：构建期由 vite/vitest 的 `define` 注入真实值，
 * 这样发版只改 `package.json` 一处，页面不会出现「显示旧版本」的漂移。
 *
 * ⚠️ 与项目里程碑版本（git tag / CHANGELOG 的 `/^v\d+\.\d+\.\d+$/`）**不是同一个号**，
 * 两者刻意不同步，语义见 AGENTS.md 第 7 节。
 */
export const APP_VERSION: string = __APP_VERSION__
