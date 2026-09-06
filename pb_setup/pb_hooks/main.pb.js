///
// 寻鸽工作台 · PocketBase JS 钩子（可选增强）
// 放置于 pb_hooks/ 目录，PocketBase 启动时自动加载（PocketBase >= 0.23）。
//
// 作用：
// 1. server_received_at 兜底排序 —— 客户端 updatedAt 依赖本机时钟，极端时钟偏差时
//    以服务端接收时间为准（开发计划 第八节「LWW 时钟偏差」预案）。
//    注：collections.json 已将 server_received_at 定义为 autodate 字段（服务端自动盖戳），
//    这里再显式 set 一次属于双保险，幂等无害。
// 2. 附带一个「固定共享令牌」的简单 API 层校验示例（默认注释），用于在不依赖
//    users 账号体系时挡住裸请求；生产环境仍建议走 users/auth-with-password。
///

// ── 1. 写入前盖服务端接收时间戳（所有业务 collection） ──
const SYNC_COLLECTIONS = [
  'workspaces', 'customers', 'interactions', 'ledgers', 'transactions',
  'todos', 'notes', 'quickNotes', 'habits', 'habitLogs', 'trophies', 'attachments',
]

onRecordCreateRequest((e) => {
  e.record.set('server_received_at', new Date().toISOString())
  e.next()
}, ...SYNC_COLLECTIONS)

onRecordUpdateRequest((e) => {
  e.record.set('server_received_at', new Date().toISOString())
  e.next()
}, ...SYNC_COLLECTIONS)

// ── 2.（可选）简单共享令牌校验示例 ──
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
