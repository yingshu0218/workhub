///
// 寻鸽工作台 · PocketBase JS 钩子（可选增强）
// 放置于 pb_hooks/ 目录，PocketBase 启动时自动加载（PocketBase >= 0.23）。
//
// 作用：
// 1. server_received_at 兜底排序 —— 客户端 updatedAt 依赖本机时钟，极端时钟偏差时
//    以服务端接收时间为准（开发计划 第八节「LWW 时钟偏差」预案）。
//    注：collections.json 已将 server_received_at 定义为 autodate 字段（服务端自动盖戳），
//    这里再显式 set 一次属于双保险，幂等无害。
// 2. 墓碑标记 —— 客户端 delete 推送为「PATCH 墓碑 → DELETE 物理删除」两步；钩子识别
//    deleted=1 的写入，统一盖 tombstonePushed=1 标记，供服务端 cron 定向清理墓碑；
//    记录恢复正常内容（deleted=0）时自动清零标记，不影响正常 LWW。
// 3. 服务端墓碑定时清理 —— cron 每日一次，物理删除 tombstonePushed=1 且超过保留期
//    的墓碑记录，防止服务端墓碑无限膨胀（客户端 pull 游标推进后不再重复拉取）。
// 4. 附带一个「固定共享令牌」的简单 API 层校验示例（默认注释），用于在不依赖
//    users 账号体系时挡住裸请求；生产环境仍建议走 users/auth-with-password。
///

// ── 1. 写入前盖服务端接收时间戳 + 墓碑标记（所有业务 collection） ──
// - server_received_at：autodate 已盖戳，这里显式 set 一次双保险（幂等）
// - tombstonePushed：deleted=1 的写入统一盖 1，供 cron 定向清理；deleted=0 清零
const SYNC_COLLECTIONS = [
  'workspaces', 'customers', 'interactions', 'ledgers', 'transactions',
  'todos', 'todoLists', 'notes', 'quickNotes', 'habits', 'habitLogs', 'trophies', 'attachments',
]

onRecordCreateRequest((e) => {
  e.record.set('server_received_at', new Date().toISOString())
  e.record.set('tombstonePushed', e.record.get('deleted') === 1 ? 1 : 0)
  e.next()
}, ...SYNC_COLLECTIONS)

onRecordUpdateRequest((e) => {
  e.record.set('server_received_at', new Date().toISOString())
  e.record.set('tombstonePushed', e.record.get('deleted') === 1 ? 1 : 0)
  e.next()
}, ...SYNC_COLLECTIONS)

// ── 3. 服务端墓碑定时清理：每日 04:00 物理删除超保留期的墓碑 ──
// 只清 tombstonePushed=1（确认收到过 delete）的记录，避免误删尚未被客户端确认的删除。
// 保留期 30 天，与客户端 cleanupTombstones 窗口一致。
const TOMBSTONE_RETENTION_MS = 30 * 24 * 60 * 60 * 1000

cronAdd('tombstoneCleanup', '0 4 * * *', () => {
  const cutoff = new Date(Date.now() - TOMBSTONE_RETENTION_MS).toISOString()
  let removed = 0
  for (const name of SYNC_COLLECTIONS) {
    const col = $app.findCollectionByNameOrId(name)
    const rows = $app.findRecordsByFilter(col, 'deleted = 1 && tombstonePushed = 1 && updated < {:cutoff}', '', 0, 0, { cutoff })
    for (const row of rows) {
      $app.delete(row)
      removed++
    }
  }
  console.log('[tombstoneCleanup] removed', removed)
})

// ── 4.（可选）简单共享令牌校验示例 ──
// 需求场景：内网部署、懒得维护 users 账号，只想挡住无关请求。
// 用法：取消注释，并在前端设置页把账号填成任意非空值、密码填成下面的 SHARED_TOKEN。
// 安全提示：这只是「挡门」级别，不是认证体系；对外网部署请继续使用 users 鉴权 + HTTPS。
//
// const SHARED_TOKEN = 'change-me-to-a-long-random-string'
//
// routerUse((e) => {
//   const path = e.request.url.path
//   if (!path.startsWith('/api/collections/')) {
//     e.next()
//     return
//   }
//   const auth = e.request.header.get('authorization') || ''
//   const token = auth.replace(/^Bearer\s+/i, '')
//   if (token === SHARED_TOKEN || e.auth !== null) {
//     e.next()
//     return
//   }
//   // 未携带令牌：放行 auth-with-password 登录端点，其余拒绝
//   if (path.endsWith('/auth-with-password')) {
//     e.next()
//     return
//   }
//   return e.json(401, { error: 'missing or invalid token' })
// })
