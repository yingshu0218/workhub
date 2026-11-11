import { db } from '@/db/db'
import { clientSession, requireClientSession } from './clientSession'
import { pullClientChanges } from '@/sync/clientSync'
import { SYNC_TABLES } from '@/sync/remoteNormalize'
import { attachmentBlob } from './clientFiles'
const dataUrl = (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(blob)
  })
export async function exportBusinessCopy() {
  const session = clientSession()
  if (!session || !navigator.onLine) throw new Error('请联网验证身份后导出服务器业务副本')
  await pullClientChanges(true)
  requireClientSession(session)
  const cache = db,
    data: Record<string, unknown> = {}
  let mapped = new Set<string>()
  // 只读事务固定所有表的同一镜像时刻；不会导出其他身份的草稿或授权秘密。
  await cache.transaction(
    'r',
    SYNC_TABLES.map((t) => cache.table(t)),
    async () => {
      for (const table of SYNC_TABLES) {
        const rows = await cache.table(table).toArray()
        if (table === 'activities')
          mapped = new Set(
            rows
              .filter((row) => row.sourceTable === 'interactions')
              .map((row) => String(row.sourceId)),
          )
        data[table] = rows.filter((row) => !row.deleted)
      }
    },
  )
  data.interactions = (data.interactions as { id: string }[]).filter((r) => !mapped.has(r.id))
  const attachments = data.attachments as {
    id: string
    deleted?: number
    blob?: Blob
    remoteFile?: unknown
  }[]
  const files = []
  for (const { blob: _blob, remoteFile: _remote, ...row } of attachments) {
    requireClientSession(session)
    files.push({
      ...row,
      ...(!row.deleted ? { dataUrl: await dataUrl(await attachmentBlob(row.id)) } : {}),
    })
  }
  data.attachments = files
  requireClientSession(session)
  return {
    app: 'nexus-workspace',
    schemaVersion: 5,
    kind: 'business-copy',
    exportedAt: new Date().toISOString(),
    recovery:
      '业务迁移副本；不含操作回执、授权凭据、删除登记、队列和服务器恢复元数据。完整恢复请用经校验的冷备份。',
    data,
  }
}
