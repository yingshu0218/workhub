/**
 * 项目模块写路径（`projects/hooks.ts#saveProject / saveMilestone`）—— 项目模块的行为锁。
 *
 * 为什么补（2026-10-26 审计）：`modules/projects` 此前零专属测试，而这两处是**唯一写入口**
 * （页面表单都走它们）。历史教训就在这两个函数上：
 * - `sortOrder` 曾用 `length` 兜底 → 删中间项后新建会重号（已改为由调用方传 `nextSortOrder`，
 *   本文件锁住「缺省 0 / 编辑保留原值」，防止有人把全表 max 偷偷塞回数据层）；
 * - `createdAt` 若在编辑时被覆盖，项目列表的排序与「存在多久」全部失真。
 */
import { describe, it, expect, beforeEach } from 'vitest'
import 'fake-indexeddb/auto'
import { db } from '@/db/db'
import type { Project } from '@/db/types'

type ProjectStatus = Project['status']
import { saveProject, saveMilestone, projectStatusMeta } from '../hooks'

beforeEach(async () => {
  await Promise.all(db.tables.map((t) => t.clear()))
})

describe('projectStatusMeta', () => {
  it('三种状态都有展示口径（新增状态会在这里被逼着补）', () => {
    const all: ProjectStatus[] = ['active', 'paused', 'archived']
    for (const s of all) {
      const meta = projectStatusMeta(s)
      expect(meta, `状态 ${s} 无展示口径`).toBeTruthy()
      expect(meta.label.trim()).not.toBe('')
      expect(meta.tone.trim()).not.toBe('')
    }
    // 三种状态的 tone 互不相同（同一色档会让列表上无法区分）
    const tones = all.map((s) => projectStatusMeta(s).tone)
    expect(new Set(tones).size).toBe(all.length)
  })
})

describe('saveProject', () => {
  const base = { name: '  新项目  ', color: '#004AC6', status: 'active' as ProjectStatus }

  it('新建：名称 trim、rev 从 1 起、createdAt 落章、入队 upsert', async () => {
    const rec = await saveProject(base)
    expect(rec.name).toBe('新项目') // 前后空格裁掉
    expect(rec.rev).toBe(1)
    expect(rec.createdAt).toBeGreaterThan(0)
    expect(rec.deleted).toBe(0)

    const queued = await db.syncQueue.where('recordId').equals(rec.id).toArray()
    expect(queued.map((q) => q.op)).toEqual(['upsert'])
  })

  it('编辑：createdAt 保留、rev 递增（不是重新建一条）', async () => {
    const created = await saveProject(base)
    const edited = await saveProject({ ...base, id: created.id, name: '改过的名字' })

    expect(edited.id).toBe(created.id)
    expect(edited.name).toBe('改过的名字')
    expect(edited.createdAt).toBe(created.createdAt)
    expect(edited.rev).toBe(created.rev + 1)
    expect(await db.projects.count()).toBe(1)
  })

  it('可选字段的「空」统一收敛为 undefined（避免空串参与同步与展示）', async () => {
    const rec = await saveProject({ ...base, customerId: '', note: '   ' })
    expect(rec.customerId).toBeUndefined()
    expect(rec.note).toBeUndefined()
  })
})

describe('saveMilestone', () => {
  it('weight 取整且下限为 1（0/负数会被打回 1，避免权重总和为 0）', async () => {
    await saveMilestone({ projectId: 'p1', name: 'a', weight: 2.6, status: 'planned' })
    await saveMilestone({ projectId: 'p1', name: 'b', weight: 0, status: 'planned' })
    await saveMilestone({ projectId: 'p1', name: 'c', weight: -3, status: 'planned' })

    const rows = await db.projectMilestones.toArray()
    const byName = Object.fromEntries(rows.map((r) => [r.name, r.weight]))
    expect(byName.a).toBe(3)
    expect(byName.b).toBe(1)
    expect(byName.c).toBe(1)
  })

  it('新建缺省 sortOrder = 0；编辑保留原 sortOrder（排序语义不在数据层瞎猜）', async () => {
    await saveMilestone({ projectId: 'p1', name: 'a', weight: 1, status: 'planned' })
    const created = (await db.projectMilestones.toArray())[0]
    expect(created.sortOrder).toBe(0)

    await saveMilestone({ projectId: 'p1', id: created.id, name: 'a2', weight: 1, status: 'planned' })
    const edited = await db.projectMilestones.get(created.id)
    expect(edited?.sortOrder).toBe(0)
    expect(edited?.name).toBe('a2')
  })
})
