/// <reference types="vite/client" />

/**
 * 构建期从 `package.json` 注入的应用包版本（见 vite.config.ts / vitest.config.ts 的 define）。
 * 这里声明一次，避免各消费方各自 `declare` 而类型逐渐分叉。
 */
declare const __APP_VERSION__: string
declare const __WORKHUB_ANDROID_DEBUG_HTTP__: boolean
