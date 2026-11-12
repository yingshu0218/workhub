// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import 'fake-indexeddb/auto'
const { request } = vi.hoisted(() => ({ request: vi.fn() }))
vi.mock('@/platform/request', () => ({ clientRequest: request }))
import { db } from '@/db/db'
import { connectionEpoch, invalidateConnection } from '@/platform/endpoint'
import { commitPersonal } from '@/domain/personal'
import { activateClientSession, requireClientSession } from '@/storage/clientSession'
import { publishMirror } from '@/storage/clientMirror'
import { resetStorageAdapter, setStorageAdapter, storage } from '@/storage'
import type { StorageAdapter } from '@/storage/types'

beforeEach(() => request.mockReset())
afterEach(() => resetStorageAdapter())

it('rejects an A→B→A session even when its key is unchanged', () => {
  const first = activateClientSession('aba-owner-a', 'shared-generation', 6)
  activateClientSession('aba-owner-b', 'shared-generation', 6)
  const second = activateClientSession('aba-owner-a', 'shared-generation', 6)
  expect(second.key).toBe(first.key)
  expect(second).not.toBe(first)
  expect(() => requireClientSession(first)).toThrow('SESSION_CHANGED')
  expect(() => requireClientSession(second)).not.toThrow()
  expect(activateClientSession('aba-owner-a', 'shared-generation', 6)).toBe(second)
  const epoch = connectionEpoch()
  invalidateConnection()
  expect(connectionEpoch()).toBeGreaterThan(epoch)
  expect(() => requireClientSession(second)).toThrow('SESSION_CHANGED')
})

it('does not dispatch an old transaction after delayed adapter initialization', async () => {
  activateClientSession('facade-owner-a', 'shared-generation', 6)
  const transaction = vi.fn(async () => undefined)
  setStorageAdapter({ transaction, requestSync() {} } as unknown as StorageAdapter)
  const pending = storage.transaction(['customers'], async () => 'old owner input')
  activateClientSession('facade-owner-b', 'shared-generation', 6)
  await expect(pending).rejects.toThrow('SESSION_CHANGED')
  expect(transaction).not.toHaveBeenCalled()
})

it('does not apply a late personal receipt to another owner with the same generation', async () => {
  activateClientSession('receipt-owner-a', 'shared-generation', 6)
  let deliver: (value: Record<string, unknown>) => void = () => {}
  request.mockImplementationOnce(() => new Promise((resolve) => { deliver = resolve }))
  const pending = commitPersonal({ requestId: 'old-owner-request', generation: 'shared-generation', previewId: 'preview', planFingerprint: 'plan' })
  activateClientSession('receipt-owner-b', 'shared-generation', 6)
  deliver({ generation: 'shared-generation', sequence: 1, changes: [{ table: 'customers', id: 'private-old-row', row: { id: 'private-old-row', name: 'old owner private', rev: 1 } }] })
  await expect(pending).rejects.toThrow('SESSION_CHANGED')
  expect(await db.customers.get('private-old-row')).toBeUndefined()
})

it('rolls back mirror rows when the connection changes inside its transaction', async () => {
  const session = activateClientSession('mirror-rollback-owner', 'mirror-generation', 6)
  const cache = db
  const originalDelete = cache.meta.delete.bind(cache.meta)
  const deleteSpy = vi.spyOn(cache.meta, 'delete').mockImplementation((key) =>
    originalDelete(key).then((result) => {
      if (key === 'client:stage') invalidateConnection()
      return result
    }),
  )
  try {
    await expect(publishMirror([{ table: 'customers', id: 'rolled-back-row', row: { id: 'rolled-back-row', name: 'should not commit', rev: 1 } }], session, 'cursor-1')).rejects.toThrow('SESSION_CHANGED')
    expect(await cache.customers.get('rolled-back-row')).toBeUndefined()
    expect(await cache.meta.get('client:cursor')).toBeUndefined()
  } finally {
    deleteSpy.mockRestore()
  }
})
