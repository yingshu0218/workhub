import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { relayPlugin } from './scripts/vite-relay-plugin.mjs'

const dirname = path.dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  // Relay 内嵌进 dev/preview server（Issue #33）：同源 `/relay`，一条命令跑通，无需第二个进程/端口。
  // 同源 → 现有 CSP `connect-src 'self'` 本身即覆盖 ws/wss 同源，**不再需要注入额外 ws 源**。
  plugins: [react(), tailwindcss(), relayPlugin()],
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
