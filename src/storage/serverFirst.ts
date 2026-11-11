import { db } from '@/db/db'
import { getAuthToken } from '@/shared/authToken'
import { isSyncedTable } from '@/sync/pocketbaseAdapter'
import { CommandError, createPocketBaseAdapter } from './pocketbase'
import { stagePlan, planRequestId, payloadIntent, stable, type CommandTransport, type Receipt } from './commandPlan'
import type { StorageAdapter } from './types'
import type { Command, Row } from '@/commands/core'

// 对齐与提交共用互斥锁，避免旧全量快照覆盖刚提交的更高版本。
let recoveryTransport: CommandTransport | undefined
let sessionGeneration: string | undefined
export function pinCacheGeneration(value: string): void {
  if (sessionGeneration && sessionGeneration !== value) throw new Error('RECOVERY_REVIEW_REQUIRED: 数据已恢复，请先保存草稿并重新加载核对')
  sessionGeneration = value
}
let mirrorTail: Promise<unknown> = Promise.resolve()
export function withMirrorLock<T>(run: () => Promise<T>): Promise<T> {
  const next = mirrorTail.then(run, run)
  mirrorTail = next.catch(() => {})
  return next
}
export function installConvergeRunner(_run: () => Promise<unknown>): void { /* 保留旧调用接口，冲突由调用方明确展示 */ }
function tableOf(name: string) { return db.table(name) }
function definitiveRejection(error: unknown): boolean { return error instanceof CommandError && error.status >= 400 && error.status < 500 && error.status !== 401 && error.status !== 403 && !/REQUEST_REUSED|RECOVERY|GENERATION/.test(error.message) }
export interface ServerFirstDeps { transport: CommandTransport; isSynced(table: string): boolean }
export function createServerFirstAdapter(overrides: Partial<ServerFirstDeps> = {}): StorageAdapter {
  const remote = createPocketBaseAdapter({ baseUrl: '', token: getAuthToken })
  const deps = { transport: remote.transport, isSynced: isSyncedTable, ...overrides }
  recoveryTransport = deps.transport
  const source = {
    get: async (table: string, id: string) => await tableOf(table).get(id) as never,
    list: async (table: string) => await tableOf(table).toArray() as never,
  }
  async function mirror(receipt: Receipt) {
    for (const c of receipt.changes) {
      if (c.row) await tableOf(c.table).put(c.row)
      else await tableOf(c.table).delete(c.id)
    }
  }
  return {
    commandMode: true,
    ...source,
    transaction: (tables, fn) => withMirrorLock(async () => {
      const plan = stagePlan(source)
      const result = await fn(plan.tx)
      const writes = plan.writes()
      const online = writes.filter(w => deps.isSynced(w.table))
      if (online.length) {
        for (const w of online) if (w.table === 'attachments' && w.value && plan.uploads.has(w.id)) {
          if (!deps.transport.stageAttachment) throw new Error('附件暂存服务不可用')
          w.value.stagedFileId = await deps.transport.stageAttachment(w.value, plan.uploads.get(w.id)!)
        }
        const generation = await deps.transport.generation()
        pinCacheGeneration(generation)
        const command = plan.command(generation, planRequestId(online), payloadIntent(online))
        command.writes = online
        command.reads = command.reads.filter(r => deps.isSynced(r.table))
        command.scans = command.scans.filter(r => deps.isSynced(r.table))
        const pendingKey = 'workhub.pending.' + command.requestId
        let submitted = command
        const saved = localStorage.getItem(pendingKey)
        if (saved) {
          const pending = JSON.parse(saved) as Command
          if (pending.generation !== generation) throw new Error('RECOVERY_REVIEW_REQUIRED: 旧请求待核对，不能在新世代重录')
          if (stable(payloadIntent(pending.writes)) !== stable(payloadIntent(online))) throw new Error('RESULT_UNKNOWN: 请先核对上次提交结果，再修改这份输入')
          submitted = pending
        } else localStorage.setItem(pendingKey, JSON.stringify(command))
        let receipt: Receipt
        try { receipt = await deps.transport.commit(submitted) } catch (error) {
          if (definitiveRejection(error)) localStorage.removeItem(pendingKey)
          throw error
        }
        localStorage.removeItem(pendingKey)
        // 服务端已提交后镜像失败也不能让调用者以为事务失败而新建重复对象。
        try { await mirror(receipt) } catch (e) { console.warn('[command] 已提交，缓存待重建', e) }
      }
      const local = writes.filter(w => !deps.isSynced(w.table))
      try { if (local.length) await db.transaction('rw', tables.filter(t => !deps.isSynced(t)).map(t => tableOf(t)), async () => {
        for (const w of local) {
          if (w.kind === 'delete') await tableOf(w.table).delete(w.id)
          else await tableOf(w.table).put(w.value as Row)
        }
      })
      } catch (error) {
        if (!online.length) throw error
        console.warn('[command] 服务端已提交，本地辅助记录待重建', error)
      }
      return result
    }),
    requestSync() {},
  }
}

export function pendingCommandFor(table: string, id: string | null | undefined): Command | undefined {
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i)
    if (!key?.startsWith('workhub.pending.')) continue
    try {
      const command = JSON.parse(localStorage.getItem(key) || '') as Command
      if (command.writes.some(w => w.table === table && (id ? w.id === id : w.kind === 'put'))) return command
    } catch { /* 损坏的草稿保留，不能当作业务提交 */ }
  }
  return undefined
}
export async function recoverPendingCommand(table: string, id: string, retry = false): Promise<boolean> {
  const command = pendingCommandFor(table, id)
  if (!command) return false
  const remote = createPocketBaseAdapter({baseUrl:'',token:getAuthToken})
  const transport = recoveryTransport || remote.transport
  const result = await transport.lookup(command.requestId, command.generation, command.intent)
  if ((!result.committed || !result.receipt) && retry) {
    try { result.receipt = await transport.commit(command) } catch (error) {
      if (definitiveRejection(error)) localStorage.removeItem('workhub.pending.'+command.requestId)
      throw error
    }
    result.committed = true
  }
  if (!result.committed || !result.receipt) return false
  try { await withMirrorLock(async () => {
    for (const change of result.receipt!.changes) {
      if (change.row) await tableOf(change.table).put(change.row)
      else await tableOf(change.table).delete(change.id)
    }
  })
  } catch (error) { console.warn('[command] 已核对提交成功，缓存待重建',error) }
  localStorage.removeItem('workhub.pending.'+command.requestId)
  return true
}
