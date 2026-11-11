import { build } from 'esbuild'
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
// 已部署迁移必须冻结；后续 schema 只能增加新编号迁移，不能覆盖旧检查点。
const frozen = {"1794355200_reliability.js": "2c62ca1c18a6dc7d2cbc99a7d0f42e32c83410de5d40c3db5d178c082e4e7a45", "1794355201_sync_metadata.js": "959642cf76a7db45f460ec3a8775729eb28a4d8beb94b5f58ca34ad99ed38026"}
for (const [name, expected] of Object.entries(frozen)) {
  const actual = createHash('sha256').update(readFileSync('pb_setup/pb_migrations/'+name)).digest('hex')
  if (actual !== expected) throw new Error('已部署迁移被改写，请新增迁移编号：'+name)
}
await build({ entryPoints: ['src/commands/core.ts'], bundle: true, platform: 'neutral', format: 'cjs', target: 'es2016', outfile: 'pb_setup/pb_hooks/command-core.js' })
