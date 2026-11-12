import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'node:path'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { relayPlugin } from './scripts/vite-relay-plugin.mjs'
import { tauriCspPlugin } from './scripts/vite-tauri-plugin.mjs'

const dirname = path.dirname(fileURLToPath(import.meta.url))

/**
 * 应用包版本只从 `package.json` 取，构建期注入 —— 不在源码里再抄一份，
 * 否则发版时必有一次「页面显示旧版本」的漂移（AGENTS.md 第 7 节的两套版本号）。
 */
const pkgVersion = (
  JSON.parse(readFileSync(path.resolve(dirname, 'package.json'), 'utf8')) as { version: string }
).version

// Tauri 的 debug APK 也使用 Vite production bundle。仅 Android debug 构建可注入明文许可；
// release 即使继承了 VITE_* 环境变量也只能得到 false。
const androidDebugHttp =
  process.env.TAURI_ENV_PLATFORM === 'android' &&
  process.env.TAURI_ENV_DEBUG === 'true' &&
  process.env.VITE_WORKHUB_ANDROID_DEBUG_HTTP === '1'

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(pkgVersion),
    __WORKHUB_ANDROID_DEBUG_HTTP__: JSON.stringify(androidDebugHttp),
  },
  // Relay 内嵌进 dev/preview server（Issue #33）：同源 `/relay`，一条命令跑通，无需第二个进程/端口。
  // 同源 → 现有 CSP `connect-src 'self'` 本身即覆盖 ws/wss 同源，**不再需要注入额外 ws 源**。
  //
  // tauriCspPlugin：仅在 Tauri 原生壳构建时生效（靠 TAURI_ENV_PLATFORM 判定），
  // 给页面 CSP 的 connect-src 追加 `ipc:` / `http://ipc.localhost`。
  // 不加会「页面正常但所有原生 invoke 被 CSP 静默拦掉」，原因见该插件头部注释。
  plugins: [react(), tailwindcss(), relayPlugin(), tauriCspPlugin()],
  resolve: {
    alias: { '@': path.resolve(dirname, 'src') },
  },
  server: { port: 5173 },
  build: {
    rollupOptions: {
      output: {
        // Phase 7 代码分割：重依赖独立分包，消除 500KB 主包警告，提升首屏与缓存命中
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined
          if (id.includes('@codemirror') || /[\\/]node_modules[\\/](crelt|style-mod|w3c-keyname)[\\/]/.test(id)) {
            return 'codemirror'
          }
          if (id.includes('d3-force')) return 'd3-force'
          if (/[\\/]node_modules[\\/](react|react-dom|react-router|react-router-dom|scheduler|@remix-run)[\\/]/.test(id)) {
            return 'react-vendor'
          }
          return 'vendor'
        },
      },
    },
  },
})
