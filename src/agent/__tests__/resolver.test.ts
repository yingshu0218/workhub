/**
 * 消解器对照测试（方案 §七.2 消解正确性 / §9.7 第 1 步注归档一致性断言）
 *
 * 覆盖四条纪律：
 *   ①候选池只走活记录（软删不参与）；②按 id 去重后再数唯一（重名必反问）；
 *   ③去重后唯一才静默消解、命中过阈值反问；④空/过短输入前置拦截。
 * 另覆盖 §9.7 第 1 步注：归档映射一致性（消解器 vs UI 4 处手工映射）。
 */
import { describe, it, expect, beforeEach } from 'vitest'
import 'fake-indexeddb/auto'
import { db } from '@/db/db'
import { resolveEntity, AMBIGUOUS_THRESHOLD } from '../resolver'
import { isProjectArchived, toArchivedFlag, archivedLast } from '@/shared/search'

const base = { updatedAt: 0, deleted: 0 as const, rev: 0 }

beforeEach(async () => {
  await Promise.all(db.tables.map((t) => t.clear()))
})

describe('纪律①：候选池只走活记录', () => {
  it('软删客户不参与消解', async () => {
    await db.customers.put({ ...base, id: 'c1', name: '王五', company: '深蓝科技', title: '', decisionLevel: '决策人', tags: [], phone: '', wechat: '', email: '', address: '', lastContactAt: 0, createdAt: 0, deleted: 1 })
    const r = await resolveEntity('王五', 'customer')
    expect(r.status).toBe('ambiguous')
    expect(r.candidates).toHaveLength(0)
    expect(r.reason).toContain('没有找到')
  })
})

describe('纪律②：按 id 去重后再数唯一（重名必反问）', () => {
  it('同 label 不同 id 的重名客户不得被误判为候选唯一', async () => {
    const mk = (id: string, name: string, company: string) => ({
      ...base, id, name, company, title: '', decisionLevel: '决策人' as const,
      tags: [], phone: '', wechat: '', email: '', address: '', lastContactAt: 0, createdAt: 0,
    })
    await db.customers.bulkPut([
      mk('c1', '张三', '深蓝科技'),
      mk('c2', '张三', '深蓝科技'),
    ])
    const r = await resolveEntity('深蓝科技', 'customer')
    expect(r.status).toBe('ambiguous')
    // 两条候选 label 完全相同，但 id 不同 → 必须反问，禁止静默关联
    expect(r.candidates.map((c) => c.label)).toEqual(['深蓝科技 · 张三', '深蓝科技 · 张三'])
    expect(new Set(r.candidates.map((c) => c.id)).size).toBe(2)
  })

  it('去重后唯一 id 才静默消解', async () => {
    await db.customers.put({
      ...base, id: 'c1', name: '王五', company: '深蓝科技', title: '采购经理',
      decisionLevel: '决策人', tags: [], phone: '', wechat: '', email: '', address: '',
      lastContactAt: 0, createdAt: 0,
    })
    const r = await resolveEntity('深蓝', 'customer')
    expect(r.status).toBe('resolved')
    expect(r.id).toBe('c1')
  })
})

describe('纪律③：命中过阈值强制反问', () => {
  it('命中数超过阈值即反问（不因排序第一看着像就自动消解）', async () => {
    const rows = Array.from({ length: AMBIGUOUS_THRESHOLD + 2 }, (_, i) => ({
      ...base, id: `l${i}`, name: `测试项目${i}`, color: '#000', status: 'active' as const,
      createdAt: 0,
    }))
    await db.projects.bulkPut(rows)
    const r = await resolveEntity('测试', 'project')
    expect(r.status).toBe('ambiguous')
    expect(r.reason).toContain('命中过多')
    // 候选上限 10（§2.2）
    expect(r.candidates.length).toBeLessThanOrEqual(10)
  })
})

describe('纪律④：空/过短输入前置拦截', () => {
  it('空查询短路，不返回全表', async () => {
    await db.habits.put({ ...base, id: 'h1', name: '阅读', icon: 'menu_book', color: '#000', category: '学习', schedule: '每日', targetMinutes: 30, motivationNote: '', crossModuleSync: false, createdAt: 0 })
    const r = await resolveEntity('   ', 'habit')
    expect(r.status).toBe('ambiguous')
    expect(r.candidates).toHaveLength(0)
    expect(r.reason).toContain('不能为空')
  })
})

describe('§9.7 第 1 步注：归档映射一致性对照断言', () => {
  it('消解器对归档项目的判定与 UI 4 处手工映射（status === "archived"）逐条一致', async () => {
    const projects = [
      { ...base, id: 'p1', name: '归档项目', color: '#000', status: 'archived' as const, createdAt: 0 },
      { ...base, id: 'p2', name: '归档项目二', color: '#000', status: 'paused' as const, createdAt: 0 },
      { ...base, id: 'p3', name: '归档项目三', color: '#000', status: 'active' as const, createdAt: 0 },
    ]
    await db.projects.bulkPut(projects)

    const r = await resolveEntity('归档项目', 'project')
    // UI 4 处手工映射的判据（NoteEditorPage ×2 / TransactionFormDrawer / TodoPage）
    const uiFlag = (p: { status: string }) => p.status === 'archived'

    for (const p of projects) {
      const candidate = r.candidates.find((c) => c.id === p.id)
      if (!candidate) continue
      // 收口函数 / 对象形态 / UI 内联判据 三者必须完全一致
      expect(candidate.archived).toBe(uiFlag(p))
      expect(candidate.archived).toBe(isProjectArchived(p))
      expect(toArchivedFlag(p).archived).toBe(uiFlag(p))
    }
  })

  it('归档项目在候选中沉底（archivedLast 只认 archived 标记，须先做字段映射）', async () => {
    await db.projects.bulkPut([
      { ...base, id: 'p-arch', name: '项目甲', color: '#000', status: 'archived' as const, createdAt: 0 },
      { ...base, id: 'p-live', name: '项目甲活', color: '#000', status: 'active' as const, createdAt: 0 },
    ])
    const r = await resolveEntity('项目甲', 'project')
    const first = r.candidates[0]
    expect(first.id).toBe('p-live')
    expect(first.archived).toBe(false)

    // 反向验证：不做字段映射（直接把 Project 喂给 archivedLast）则沉底完全不生效
    const raw = [
      { id: 'p-arch', label: '项目甲', status: 'archived' as const },
      { id: 'p-live', label: '项目甲活', status: 'active' as const },
    ]
    const naive = archivedLast(raw as { archived?: boolean }[])
    // 未映射 → 归档项未沉底（证明映射不可省）
    expect((naive[0] as unknown as { id: string }).id).toBe('p-arch')
  })
})

describe('消解投影白名单（§2.2）', () => {
  it('候选项只含 id/type/label/sub/archived，不含实体全字段与 relations', async () => {
    await db.customers.put({ ...base, id: 'c1', name: '王五', company: '深蓝', title: '经理', decisionLevel: '决策人', tags: ['x'], phone: '138', wechat: 'w', email: 'e', address: 'a', lastContactAt: 1, createdAt: 0, relations: [{ id: 'r1', targetId: 'c2', label: '同事' }] })
    const r = await resolveEntity('王五', 'customer')
    expect(Object.keys(r.candidates[0]).sort()).toEqual(['id', 'label', 'sub', 'type'])
  })
})
