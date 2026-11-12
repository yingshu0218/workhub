// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import 'fake-indexeddb/auto'
import { db } from '@/db/db'
import { activateClientSession, clientSession, suspendClientSession } from '@/storage/clientSession'
import { createServerFirstAdapter } from '@/storage/serverFirst'
import { resetStorageAdapter, setStorageAdapter } from '@/storage'
import { saveMilestone, saveProject } from '../hooks'
import type { Command } from '@/commands/core'

function transport(captures: { owner: string; command: Command }[]) {
  let sequence = 0
  setStorageAdapter(createServerFirstAdapter({
    isSynced: () => true,
    transport: {
      generation: async () => clientSession()!.generation,
      lookup: async () => ({ committed: false }),
      commit: async (command) => {
        captures.push({ owner: clientSession()!.owner, command })
        return {
          operationId: 'synthetic-op', requestId: command.requestId,
          generation: command.generation, sequence: ++sequence,
          changes: command.writes.map((w) => ({ table: w.table, id: w.id, row: w.value ?? null })),
        }
      },
    },
  }))
}

afterEach(() => {
  vi.restoreAllMocks()
  resetStorageAdapter()
  suspendClientSession()
  localStorage.clear()
})

it('keeps A project input out of B POST and cache after a delayed real Dexie read', async () => {
  activateClientSession('project-preflight-a', 'generation-a', 6)
  const cache = db
  const prior = { id: 'private-project', name: 'A prior', color: '#fff', status: 'active', createdAt: 1, updatedAt: 1, rev: 1, deleted: 0 }
  await cache.projects.put(prior as never)
  let began: () => void = () => {}, release: (value: typeof prior) => void = () => {}
  const started = new Promise<void>((resolve) => { began = resolve })
  const held = new Promise<typeof prior>((resolve) => { release = resolve })
  vi.spyOn(cache.projects, 'get').mockImplementation(() => { began(); return held as never })
  const captures: { owner: string; command: Command }[] = []
  transport(captures)
  const pending = saveProject({ id: prior.id, name: 'A PRIVATE PROJECT', color: '#fff', status: 'active', note: 'A PRIVATE NOTE' })
  await started
  activateClientSession('project-preflight-b', 'generation-b', 6)
  release(prior)
  await expect(pending).rejects.toThrow('SESSION_CHANGED')
  expect(captures).toEqual([])
  expect(await db.projects.get(prior.id)).toBeUndefined()
})

it('keeps A milestone input out of B POST and cache after a delayed read', async () => {
  activateClientSession('milestone-preflight-a', 'generation-a', 6)
  const cache = db
  const prior = { id: 'private-milestone', projectId: 'a-project', name: 'A prior', weight: 1, status: 'planned', sortOrder: 0, createdAt: 1, updatedAt: 1, rev: 1, deleted: 0 }
  await cache.projectMilestones.put(prior as never)
  let began: () => void = () => {}, release: (value: typeof prior) => void = () => {}
  const started = new Promise<void>((resolve) => { began = resolve })
  const held = new Promise<typeof prior>((resolve) => { release = resolve })
  vi.spyOn(cache.projectMilestones, 'get').mockImplementation(() => { began(); return held as never })
  const captures: { owner: string; command: Command }[] = []
  transport(captures)
  const pending = saveMilestone({ id: prior.id, projectId: prior.projectId, name: 'A PRIVATE MILESTONE', weight: 1, status: 'planned' })
  await started
  activateClientSession('milestone-preflight-b', 'generation-b', 6)
  release(prior)
  await expect(pending).rejects.toThrow('SESSION_CHANGED')
  expect(captures).toEqual([])
  expect(await db.projectMilestones.get(prior.id)).toBeUndefined()
})

it('still commits normal project and milestone saves through the real module and adapter', async () => {
  activateClientSession('preflight-control', 'control-generation', 6)
  const captures: { owner: string; command: Command }[] = []
  transport(captures)
  const project = await saveProject({ name: 'CONTROL PROJECT', color: '#123456', status: 'active' })
  await saveMilestone({ projectId: project.id, name: 'CONTROL MILESTONE', weight: 2, status: 'planned' })
  expect(captures).toHaveLength(2)
  expect(captures.map((c) => c.owner)).toEqual(['preflight-control', 'preflight-control'])
  expect((await db.projects.get(project.id))?.name).toBe('CONTROL PROJECT')
  expect((await db.projectMilestones.toArray())[0]?.name).toBe('CONTROL MILESTONE')
})
