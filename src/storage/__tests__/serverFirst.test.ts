// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from 'vitest'
import 'fake-indexeddb/auto'
import { db } from '@/db/db'
import { CommandError } from '@/storage/pocketbase'
import { createServerFirstAdapter } from '@/storage/serverFirst'
import type { CommandTransport } from '@/storage/commandPlan'
import type { Command } from '@/commands/core'
const row = { id:'c1', name:'甲', rev:1, updatedAt:1, deleted:0 }
const transport = (): CommandTransport => ({
  generation: async () => 'test-generation',
  lookup: async () => ({committed:false}),
  commit: vi.fn(async (c: Command) => ({operationId:'op', requestId:c.requestId, generation:c.generation, changes:c.writes.map(w=>({table:w.table,id:w.id,row:w.kind==='put'?w.value!:null}))})),
})
beforeEach(async()=>{await Promise.all(db.tables.map(t=>t.clear()));localStorage.clear()})
it('复合回调完成后只提交一个命令，成功后更新镜像',async()=>{
  const api=transport();const adapter=createServerFirstAdapter({transport:api})
  await adapter.transaction(['customers','syncQueue'],async tx=>{await tx.put('customers',row);expect(await db.customers.get(row.id)).toBeUndefined();await tx.update('customers',row.id,{name:'乙'})})
  expect(api.commit).toHaveBeenCalledTimes(1);expect((await db.customers.get(row.id))?.name).toBe('乙')
})
it('中途错误不发命令、不留下半条镜像',async()=>{
  const api=transport();const adapter=createServerFirstAdapter({transport:api})
  await expect(adapter.transaction(['customers','syncQueue'],async tx=>{await tx.put('customers',row);throw new Error('failure')})).rejects.toThrow('failure')
  expect(api.commit).not.toHaveBeenCalled();expect(await db.customers.count()).toBe(0)
})
it('版本冲突明确失败，不把跳过当保存成功',async()=>{
  const api=transport();api.commit=async()=>{throw new Error('VERSION_CONFLICT')}
  await db.customers.put(row as never)
  await expect(createServerFirstAdapter({transport:api}).transaction(['customers','syncQueue'],tx=>tx.update('customers',row.id,{name:'丙'}))).rejects.toThrow('VERSION_CONFLICT')
  expect((await db.customers.get(row.id))?.name).toBe('甲')
})
it('字段显式清空通过 null 传输，读集带原版本',async()=>{
  await db.customers.put({...row,phone:'123'} as never)
  const api=transport();await createServerFirstAdapter({transport:api}).transaction(['customers','syncQueue'],tx=>tx.update('customers',row.id,{phone:undefined}))
  const c=vi.mocked(api.commit).mock.calls[0][0]
  expect(c.writes[0].value?.phone).toBeNull();expect(c.reads).toContainEqual({table:'customers',id:'c1',rev:1})
})
it('响应丢失后重试发送原请求号和原计划',async()=>{
  let first:Command|undefined
  const api=transport();const commit=api.commit
  api.commit=vi.fn(async c=>{if(!first){first=structuredClone(c);throw new Error('response lost')} expect(c).toEqual(first);return commit(c)})
  const adapter=createServerFirstAdapter({transport:api})
  await expect(adapter.transaction(['customers','syncQueue'],tx=>tx.put('customers',row))).rejects.toThrow('lost')
  await adapter.transaction(['customers','syncQueue'],tx=>tx.put('customers',{...row,updatedAt:99}))
  expect(await db.customers.count()).toBe(1)
})
it('更新幽灵记录拒绝，回收站墓碑不会被本地物理删替代',async()=>{
  const adapter=createServerFirstAdapter({transport:transport()})
  await expect(adapter.transaction(['customers','syncQueue'],tx=>tx.update('customers','missing',{name:'ghost'}))).rejects.toThrow('NOT_FOUND')
  await adapter.transaction(['customers','syncQueue'],tx=>tx.put('customers',{...row,deleted:1}))
  expect((await db.customers.get(row.id))?.deleted).toBe(1)
})
it('本地专属表仍经本地事务，不触碰服务端',async()=>{
  const api=transport();await createServerFirstAdapter({transport:api}).transaction(['focusSessions','syncQueue'],tx=>tx.put('focusSessions',{id:'focus',startedAt:1}))
  expect(api.commit).not.toHaveBeenCalled();expect(await db.focusSessions.get('focus')).toBeTruthy()
})
it('旧页面的世代固定；恢复后不能取得新世代继续写旧草稿',async()=>{
  const api=transport();const adapter=createServerFirstAdapter({transport:api})
  await adapter.transaction(['customers','syncQueue'],tx=>tx.put('customers',row))
  api.generation=async()=> 'restored-generation'
  await expect(adapter.transaction(['customers','syncQueue'],tx=>tx.put('customers',{...row,id:'new-after-restore'}))).rejects.toThrow('RECOVERY_REVIEW_REQUIRED')
  expect(api.commit).toHaveBeenCalledTimes(1)
})

it('服务端提交后本地辅助表失败不伪报业务保存失败',async()=>{
 const api=transport();const adapter=createServerFirstAdapter({transport:api})
 await expect(adapter.transaction(['customers','settings','syncQueue'],async tx=>{
   await tx.put('customers',row)
   await tx.put('settings',{id:'missing-key'})
   return 'committed'
 })).resolves.toBe('committed')
 expect(api.commit).toHaveBeenCalledTimes(1);expect(await db.customers.count()).toBe(1)
})

it('REQUEST_REUSED 的 409 保留原 pending，不能当成从未提交',async()=>{
 const api=transport();api.commit=async()=>{throw new CommandError('REQUEST_REUSED: 已提交但参数不同',409)}
 const adapter=createServerFirstAdapter({transport:api})
 await expect(adapter.transaction(['customers','syncQueue'],tx=>tx.put('customers',row))).rejects.toThrow('REQUEST_REUSED')
 expect(Object.keys(localStorage).some(k=>k.startsWith('workhub.pending.'))).toBe(true)
})
