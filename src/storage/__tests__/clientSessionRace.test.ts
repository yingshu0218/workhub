// @vitest-environment jsdom
import { it, expect, vi, beforeEach } from 'vitest'
import 'fake-indexeddb/auto'
import { activateClientSession, clientSession, scopedClientKey } from '@/storage/clientSession'
import { createServerFirstAdapter, recoverPendingCommand } from '@/storage/serverFirst'
import { db } from '@/db/db'
import type { Command } from '@/commands/core'
import type { CommandTransport } from '@/storage/commandPlan'
const receipt = (c: Command) => ({
  operationId: 'op',
  requestId: c.requestId,
  generation: c.generation,
  changes: c.writes.map((w) => ({ table: w.table, id: w.id, row: w.value || null })),
})
beforeEach(() => localStorage.clear())
it('a transaction queued under one identity must not execute in the next identity', async () => {
  activateClientSession('queued-a', 'queue-gen-a', 6)
  let release: () => void = () => {},
    started: () => void = () => {}
  const began = new Promise<void>((r) => {
      started = r
    }),
    held = new Promise<void>((r) => {
      release = r
    })
  const commit = vi.fn(async (c: Command) => receipt(c))
  const transport: CommandTransport = {
    generation: async () => clientSession()!.generation,
    commit,
    lookup: async () => ({ committed: false }),
  }
  const adapter = createServerFirstAdapter({ transport, isSynced: () => true })
  const first = adapter.transaction(['customers'], async () => {
    started()
    await held
  })
  await began
  const second = adapter.transaction(['customers'], async (tx) => {
    await tx.put('customers', {
      id: 'queued-secret',
      name: 'identity-a private content',
      rev: 1,
    } as never)
  })
  activateClientSession('queued-b', 'queue-gen-b', 6)
  release()
  try {
    await first
  } catch (e) {
    expect(String(e)).toMatch(/SESSION_CHANGED/)
  }
  try {
    await second
  } catch (e) {
    expect(String(e)).toMatch(/SESSION_CHANGED/)
  }
  expect(commit).not.toHaveBeenCalled()
  expect(await db.customers.get('queued-secret')).toBeUndefined()
})
it('a session change while obtaining generation cannot store the old intent under the new scope', async () => {
  activateClientSession('pending-a', 'pending-gen-a', 6)
  let deliver: (v: string) => void = () => {},
    started: () => void = () => {}
  const began = new Promise<void>((r) => {
    started = r
  })
  const transport: CommandTransport = {
    generation: () => {
      started()
      return new Promise((r) => {
        deliver = r
      })
    },
    commit: async (c) => receipt(c),
    lookup: async () => ({ committed: false }),
  }
  const adapter = createServerFirstAdapter({ transport, isSynced: () => true })
  const pending = adapter.transaction(['customers'], async (tx) => {
    await tx.put('customers', { id: 'private-a', name: 'identity-a secret', rev: 1 } as never)
  })
  await began
  const next = activateClientSession('pending-b', 'pending-gen-b', 6)
  deliver('pending-gen-a')
  await expect(pending).rejects.toThrow('SESSION_CHANGED')
  const contaminated = Array.from({ length: localStorage.length }, (_, i) =>
    localStorage.key(i)!,
  ).filter(
    (k) => k.endsWith(':' + next.key) && localStorage.getItem(k)?.includes('identity-a secret'),
  )
  expect(contaminated).toEqual([])
})
it('looking up an old committed receipt cannot replace a newer mirrored revision', async () => {
  const s = activateClientSession('recovery-a', 'recovery-gen-a', 6)
  const id = 'receipt-contact',
    old = { id, name: 'old', rev: 2, updatedAt: 2, deleted: 0 },
    current = { ...old, name: 'new', rev: 3, updatedAt: 3 }
  await db.customers.put(current as never)
  const command = {
    protocol: 1,
    generation: s.generation,
    requestId: 'recover-old',
    writes: [{ table: 'customers', id, kind: 'put', value: old }],
    reads: [],
    scans: [],
  } as Command
  localStorage.setItem(
    scopedClientKey('workhub.pending.' + command.requestId),
    JSON.stringify(command),
  )
  createServerFirstAdapter({
    transport: {
      generation: async () => s.generation,
      commit: async (c) => receipt(c),
      lookup: async () => ({ committed: true, receipt: receipt(command) }),
    },
    isSynced: () => true,
  })
  await expect(recoverPendingCommand('customers', id)).resolves.toBe(true)
  expect((await db.customers.get(id))?.rev).toBe(3)
})
