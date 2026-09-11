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
  },
})
