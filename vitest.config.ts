import { defineConfig } from 'vitest/config'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const dirname = path.dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  resolve: {
    alias: { '@': path.resolve(dirname, 'src'), '@relay': path.resolve(dirname, 'relay') },
  },
  test: {
    // 默认 node 环境跑纯数据/纯函数用例；组件用例（Issue #140 EntityLinkField / EntityHoverCard）
    // 通过文件头 `// @vitest-environment jsdom` 按文件切换，避免全量用例背上 DOM 环境开销。
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    // 全局测试基线（等待预算与 testTimeout 的理由见该文件头注释）
    setupFiles: ['./src/test/setup.ts'],
    /**
     * 默认 5000ms 对 jsdom + fake-indexeddb 用例偏紧：一个用例要等
     * IndexedDB 事务 → liveQuery → React 重渲染三跳，全量并发下实测单条可达 4.7s。
     * 放宽到 15000ms 只买「等待预算」，不改任何断言；真挂住的用例仍会在 15s 内失败。
     */
    testTimeout: 15_000,
    hookTimeout: 15_000,
  },
})
