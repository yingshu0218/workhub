import { build } from 'esbuild'
import { readFileSync, writeFileSync } from 'node:fs'
// CommonJS 供 PB require，ES2016 避开未经验证的新宿主 API。
await build({ entryPoints: ['src/commands/core.ts'], bundle: true, platform: 'neutral', format: 'cjs', target: 'es2016', outfile: 'pb_setup/pb_hooks/command-core.js' })
// 初始化迁移自含 schema，既支持空库也支持存量增量；不依赖运行时网络导入。
const schema = JSON.parse(readFileSync('pb_setup/collections.json', 'utf8'))
const template = readFileSync('pb_setup/reliability-migration.js', 'utf8')
writeFileSync('pb_setup/pb_migrations/1794355200_reliability.js', template.replace('__SCHEMA__', JSON.stringify(schema)))
