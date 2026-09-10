import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const dirname = path.dirname(fileURLToPath(import.meta.url))

/** relay 默认端口（与 relay/index.mjs DEFAULT_PORT 对齐） */
const RELAY_PORT = process.env.WORKHUB_RELAY_PORT || '8787'

/**
 * CSP：仅 dev/本地自用构建注入 `ws://127.0.0.1:<relay 端口>`（方案 §9.1）。
 *
 * 为什么按 mode 注入：CSP 全站生效，若在 index.html 里写死 `ws:` 会同时放开生产外连能力。
 * 生产构建 CSP 不含 `ws:`；relay 首版也只服务 dev/本地自用（生产 https 下浏览器禁连 ws://）。
 * 注入机制：`transformIndexHtml` 改写 meta CSP 的 connect-src，追加 relay 的 ws 源。
 */
function cspRelayPlugin(): Plugin {
  return {
    name: 'workhub-csp-relay',
    apply: 'serve',
    transformIndexHtml(html) {
      const wsSource = `ws://127.0.0.1:${RELAY_PORT}`
      return html.replace(
        /(connect-src[^;]*)(;)/,
        (_m, group1: string, semi: string) => (group1.includes(wsSource) ? `${group1}${semi}` : `${group1} ${wsSource}${semi}`),
      )
    },
  }
}

export default defineConfig({
  plugins: [react(), tailwindcss(), cspRelayPlugin()],
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
