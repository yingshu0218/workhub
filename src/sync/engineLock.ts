/**
 * 同步互斥锁 —— IndexedDB 跨标签页排他锁（Web Locks API，兼容性见下）
 *
 * 动机（多端同步接线）：同一浏览器多标签页 / 多窗口打开工作台时，每个标签页都跑一份
 * 同步引擎（30s 心跳 + 写入防抖）。没有互斥会出现两类问题：
 * - 重复推送：同一队列条目被两个标签页同时推送（服务端幂等 upsert 兜底，但浪费流量）
 * - 游标竞争：两个标签页各自推进同一份 pull 游标，可能相互覆盖导致丢增量
 *
 * 实现：`navigator.locks.request('nexus-sync', { ifAvailable: true })` —— 抢占式、
 * 释放即自愈（标签页关闭/崩溃时浏览器自动释放，无需心跳续约，也不会留下死锁）。
 * 拿不到锁的标签页跳过本轮同步，下一轮（30s 心跳）重试。
 *
 * 降级：不支持 Web Locks（如 iOS Safari < 15.4 / 老 Firefox）时返回 true 直接放行，
 * 退回「无锁但可用」；跨端场景（不同设备）天然无竞争，锁只在同浏览器多标签页才有意义。
 */

const LOCK_NAME = 'nexus-workspace-sync'

interface LockManagerLike {
  request(name: string, options: { ifAvailable: boolean }, cb: (lock: unknown) => Promise<void>): Promise<void>
}

function lockManager(): LockManagerLike | null {
  const nav = navigator as Navigator & { locks?: LockManagerLike }
  return typeof nav.locks?.request === 'function' ? nav.locks : null
}

/** 是否具备跨标签页排他能力（不支持时引擎退回单标签页语义） */
export function hasCrossTabLock(): boolean {
  return lockManager() !== null
}

/**
 * 尝试独占执行一次同步任务；拿到锁返回任务结果，未拿到（其他标签页正在同步）返回 undefined。
 * 任务抛错时锁仍会被释放（浏览器在回调 promise 结束后自动释放）。
 */
export async function withExclusiveSync<T>(
  task: () => Promise<T>,
): Promise<T | undefined> {
  const locks = lockManager()
  if (!locks) return await task()
  let result: T | undefined
  let ran = false
  await locks.request(LOCK_NAME, { ifAvailable: true }, async (lock) => {
    if (!lock) return // 其他标签页正在同步：本轮让路，下一轮心跳重试
    ran = true
    result = await task()
  })
  return ran ? result : undefined
}
