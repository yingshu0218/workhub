/**
 * 运行环境探测。
 *
 * 为什么单独抽一层：Tauri 原生壳与浏览器 **共用同一份前端产物**，但有些能力的语义
 * 两端不同（Service Worker、存储实现、通知、文件选择……）。这些分支必须先判断环境
 * 再走，否则拿到的是最难查的一类问题 —— 「浏览器好好的，原生端静默不生效」。
 *
 * 判定依据：Tauri v2 会在任何页面脚本执行之前，向 WebView 注入
 * `window.__TAURI_INTERNALS__`（v1 是 `window.__TAURI__`）。初始化脚本先于页面脚本
 * 执行，因此在 main.tsx 里同步判断是安全的，不需要 await。
 *
 * 刻意不依赖 `navigator.userAgent`：各平台 WebView 的 UA 拼装方式不一致，容易误判。
 */

declare global {
  interface Window {
    __TAURI_INTERNALS__?: unknown
    __TAURI__?: unknown
  }
}

/** 当前是否运行在 Tauri 原生壳内（桌面 / 移动端）。浏览器中恒为 false。 */
export function isTauri(): boolean {
  if (typeof window === 'undefined') return false
  return Boolean(window.__TAURI_INTERNALS__ ?? window.__TAURI__)
}

/** 当前是否运行在浏览器（Web / PWA）中。 */
export function isWeb(): boolean {
  return !isTauri()
}
