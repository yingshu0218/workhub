#!/usr/bin/env node
/**
 * 构建服务端执行器（agentOps 服务端化 P2）：
 * 把 `src/agent/serverReads.ts`（10 个读工具 + PocketBaseAdapter，零 Dexie）打成
 * 单文件 ESM `dist-server/server-executor.mjs`，供 `scripts/serve.mjs` 在 Node 里动态 import。
 *
 * 为什么独立打包而不是复用 vite 的 dist/：dist 是浏览器 bundle（多 chunk + 立即执行副作用），
 * Node 不能按模块取函数；esbuild lib 模式出的单文件 ESM 才能被 serve.mjs `import()` 并调用
 * `initServerExecutor`。依赖只有 zod/dayjs（bundle 进来，服务端零 npm install）。
 *
 * 用法：`npm run build:server`（build 前置会自动跑；也可单独跑）。
 */
import { build } from 'esbuild'
import { fileURLToPath } from 'node:url'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
const outDir = join(root, 'dist-server')
const entry = join(root, 'src/agent/serverReads.ts')

// ⚠️ 服务端 bundle 禁带 Dexie：storage/index.ts 的兜底动态 import('./browser') 会被
// esbuild 静态解析打包，browser.ts 顶层的 `new NexusDB()` 在 Node 加载时即执行（炸）。
// 服务端执行器永远先经 initServerExecutor 注入 PocketBaseAdapter，兜底分支不该走到；
// 声明 external 让它保持惰性 import（bundle 加载时零执行）。若意外走到，报
// ERR_MODULE_NOT_FOUND（./browser）——这条报错本身就是「注入未完成就用了 storage」的信号。
const noBrowserInServerBundle = {
  name: 'no-browser-in-server-bundle',
  setup(build) {
    build.onResolve({ filter: /browser$/ }, (args) => {
      if (args.kind === 'dynamic-import' && args.importer.includes('storage')) {
        return { path: args.path, external: true }
      }
      return undefined
    })
  },
}

// 供 esbuild 解析 @/ 别名（与 tsconfig.app.json paths 一致；尝试 ts/tsx/index 解析）
const aliasPlugin = {
  name: 'alias-@',
  setup(build) {
    build.onResolve({ filter: /^@\// }, (args) => {
      const base = join(root, 'src', args.path.slice(2))
      for (const cand of [`${base}.ts`, `${base}.tsx`, join(base, 'index.ts'), join(base, 'index.tsx')]) {
        if (existsSync(cand)) return { path: cand }
      }
      return { path: base, external: false }
    })
  },
}

mkdirSync(outDir, { recursive: true })
const result = await build({
  entryPoints: [entry],
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node20',
  outfile: join(outDir, 'server-executor.mjs'),
  plugins: [noBrowserInServerBundle, aliasPlugin],
  // 外部化确保没有意外拖入 node 专属模块（预期依赖：zod/dayjs，全部 bundle）
  external: [],
  minify: false,
  sourcemap: false,
  logLevel: 'warning',
  metafile: true,
})

writeFileSync(
  join(outDir, 'build-meta.json'),
  JSON.stringify(
    {
      builtAt: new Date().toISOString(),
      inputs: Object.keys(result.metafile.inputs),
      outputs: Object.keys(result.metafile.outputs),
    },
    null,
    2,
  ),
)

const sizeKb = Math.round((result.metafile.outputs['server-executor.mjs']?.bytes ?? 0) / 102.4) / 10
process.stderr.write(`[build:server] dist-server/server-executor.mjs 生成（${sizeKb} KB）\n`)
