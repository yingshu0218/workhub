import { db } from '@/db/db'
import { endpointFetch } from '@/platform/endpoint'
import { getAuthToken } from '@/shared/authToken'
import { clientSession, requireClientSession } from './clientSession'
export async function attachmentBlob(id: string): Promise<Blob> {
  const context = clientSession(),
    cache = db,
    row = await cache.attachments.get(id)
  if (context) requireClientSession(context)
  if (!row || row.deleted) throw new Error('附件不存在或已删除')
  // 联网时重新验证元数据，避免另一设备清理后仍下载旧缓存。
  if (!navigator.onLine) {
    if (row.blob instanceof Blob) return row.blob
    throw new Error('离线缓存尚无此附件文件，请联网下载')
  }
  const response = await endpointFetch(
    '/api/workhub/attachments/' + encodeURIComponent(id) + '/file',
    { headers: { Authorization: getAuthToken() } },
  )
  if (!response.ok) throw new Error('附件文件不可用或访问被拒绝')
  const blob = await response.blob()
  if (context) requireClientSession(context)
  // 文件按需读取，不把Blob写回业务事务；清理后的旧响应也不能重新入库。
  return blob
}
