/**
 * Vite 插件：为 Tauri 原生壳放宽页面 CSP。
 *
 * ## 为什么需要它
 * index.html 里有一条严格 CSP（`connect-src 'self' blob: https: http:`）。Tauri v2 的
 * IPC（`invoke`）走的是自定义协议 —— macOS / Linux 是 `ipc://localhost`，Windows 是
 * `http://ipc.localhost`。两者都不在上面那条 connect-src 的放行范围内。
 *
 * 后果不是「报错」而是**静默失效**：页面照常渲染、`npm run build` 照常通过，但所有
 * 原生能力（`invoke`）被 CSP 拦掉。所以必须在构建期就把放行项加进去。
 *
 * ## 为什么不在 index.html 里直接写死
 * Web 端并不需要 `ipc:`。把它写进 Web 的 CSP 等于白白放宽浏览器侧策略（本项目把
 * CSP 定位为「纵深防御」，见 index.html 注释）。两个环境需求不同，就只能在构建期分叉。
 *
 * ## 判定方式
 * Tauri CLI 在跑 `beforeDevCommand` / `beforeBuildCommand` 时会注入 `TAURI_ENV_PLATFORM`，
 * 所以 `npm run dev` / `npm run build` 走浏览器路径，`tauri dev` / `tauri build` 走原生路径。
 *
 * ## 为什么带断言
 * 这里靠字符串锚点替换。将来若有人改动了 index.html 的 CSP，替换会静默失效并复现
 * 上面那个「界面正常但原生能力全废」的假绿。因此锚点缺失时**直接让构建失败**，
 * 把问题暴露在构建期而不是运行期。
 */

/** index.html 中 connect-src 的原文（锚点） */
const CONNECT_SRC_ANCHOR = "connect-src 'self' blob: https: http:"

/** 原生环境下追加 Tauri IPC 的两种协议来源 */
const CONNECT_SRC_TAURI = "connect-src 'self' blob: https: http: ipc: http://ipc.localhost"

export function tauriCspPlugin() {
  const isTauriBuild = Boolean(process.env.TAURI_ENV_PLATFORM)

  return {
    name: 'nexus:tauri-csp',
    transformIndexHtml: {
      order: 'pre',
      handler(html) {
        if (!isTauriBuild) return html

        if (!html.includes(CONNECT_SRC_ANCHOR)) {
          throw new Error(
            '[tauri-csp] 未能在 index.html 中找到 CSP 锚点：\n' +
              `  ${CONNECT_SRC_ANCHOR}\n` +
              'Tauri 构建要求 connect-src 放行 `ipc:` 与 `http://ipc.localhost`。\n' +
              'index.html 的 CSP 被修改后，必须同步更新 scripts/vite-tauri-plugin.mjs 的锚点。',
          )
        }

        return html.replace(CONNECT_SRC_ANCHOR, CONNECT_SRC_TAURI)
      },
    },
  }
}
