// @vitest-environment jsdom
/**
 * 全量对齐的行为锁（2026-11-03，服务端唯一真源）
 *
 * 核心判据只有一条：**远端有什么，本地就是什么**。围绕它锁四件事：
 *  ① 远端没有的本地行被物理删除（不是进回收站）；
 *  ② 远端有的行无条件覆盖本地 —— 即使本地 `updatedAt` 更新（旧 LWW 会跳过）；
 *  ③ 附件内容没变时跳过重下（否则每 60 秒重下一遍所有文件）；
 *  ④ 未登录直接抛错（没有「匿名离线」这条路）。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import 'fake-indexeddb/auto'
import { db } from '@/db/db'
import { convergeFromServer } from '@/sync/convergeFromServer'

type RemoteRow = { id: string } & Record<string, unknown>

/** 每张表的远端快照；未列出的表返回空数组 */
function remoteOf(map: Record<string, RemoteRow[]>) {
  return async (table: string): Promise<RemoteRow[]> => map[table] ?? []
}

const customer = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  workspaceId: 'ws-main',
  name: id,
  createdAt: 1,
  updatedAt: 1,
  deleted: 0,
  rev: 1,
  ...extra,
})

/** 远端行：PB 记录的 `id` 是哈希主键，本地 id 在 `localId` */
const remoteCustomer = (localId: string, extra: Record<string, unknown> = {}) => ({
  id: `pb-${localId}`,
  localId,
  workspaceId: 'ws-main',
  name: `${localId}-服务端`,
  createdAt: 1,
  updatedAt: 100,
  deleted: 0,
  rev: 3,
  ...extra,
})

describe('convergeFromServer：远端必胜', () => {
  beforeEach(async () => {
    await Promise.all([
      db.customers.clear(),
      db.attachments.clear(),
      db.syncQueue.clear(),
      db.meta.clear(),
      db.links.clear(),
    ])
  })

  it('远端没有的本地行被物理删除', async () => {
    await db.customers.put(customer('orphan') as never)
    const r = await convergeFromServer({ hasToken: () => true, listRemote: remoteOf({}) })
    expect(await db.customers.get('orphan')).toBeUndefined()
    expect(r.removed).toBe(1)
  })

  it('本地 updatedAt 更新也照样被远端覆盖（绕开 LWW）', async () => {
    await db.customers.put(customer('c1', { name: '本地改名', updatedAt: 999 }) as never)
    const r = await convergeFromServer({
      hasToken: () => true,
      listRemote: remoteOf({ customers: [remoteCustomer('c1')] }),
    })
    const local = await db.customers.get('c1')
    expect(local?.name).toBe('c1-服务端')
    expect(local?.updatedAt).toBe(100)
    expect(r.upserted).toBe(1)
  })

  it('未登录（无 token）直接抛错，不做任何删除', async () => {
    await db.customers.put(customer('keep') as never)
    await expect(convergeFromServer({ hasToken: () => false })).rejects.toThrow('未登录')
    expect(await db.customers.get('keep')).toBeTruthy()
  })

  it('附件内容没变 → 跳过重下，本地 blob 保留', async () => {
    // ⚠️ fake-indexeddb 不能可靠往返 Blob（structured clone 实现不含 Blob），
    // 这里用「有 size 的对象」这个最小等价形状；生产里存的是真 Blob，判据同样成立（见实现注释）。
    const blob = { size: 5, type: 'text/plain' }
    await db.attachments.put({
      id: 'a1',
      workspaceId: 'ws-main',
      name: 'a.png',
      file: 'a.png',
      blob,
      createdAt: 1,
      updatedAt: 7,
      deleted: 0,
      rev: 2,
    } as never)

    const loadAttachment = vi.fn(async () => new Blob(['x']))
    await convergeFromServer({
      hasToken: () => true,
      listRemote: remoteOf({
        attachments: [
          { id: 'pb-a1', localId: 'a1', name: 'a.png', file: 'a.png', createdAt: 1, updatedAt: 7 },
        ],
      }),
      loadAttachment,
    })

    expect(loadAttachment).not.toHaveBeenCalled()
    expect(await db.attachments.get('a1')).toBeTruthy()
  })

  it('附件时间戳变了 → 重新下载并替换 blob', async () => {
    await db.attachments.put({
      id: 'a2',
      workspaceId: 'ws-main',
      name: 'a2.png',
      file: 'a2.png',
      blob: new Blob(['old']),
      createdAt: 1,
      updatedAt: 7,
      deleted: 0,
      rev: 1,
    } as never)

    const fresh = new Blob(['new'])
    const loadAttachment = vi.fn(async () => fresh)
    await convergeFromServer({
      hasToken: () => true,
      listRemote: remoteOf({
        attachments: [
          { id: 'pb-a2', localId: 'a2', name: 'a2.png', file: 'a2.png', createdAt: 1, updatedAt: 8 },
        ],
      }),
      loadAttachment,
    })

    expect(loadAttachment).toHaveBeenCalledTimes(1)
    expect(await db.attachments.get('a2')).toBeTruthy()
  })
})
