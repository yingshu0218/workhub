import { readInteractionProjection } from '@/queries/activities'
import { db } from '@/db/db'
import { storage } from '@/storage'
import { newId } from '@/repositories'
import { useCollection, useQuery } from '@/queries/hooks'
import type { Project, ProjectMilestone, Todo, Transaction, Note, Interaction } from '@/db/types'
import { isTodoOpen } from '@/modules/todo/domain'
import { captureClientWriteSession } from '@/modules/clientWriteSession'

/**
 * 项目模块数据层（组件禁止直连 Dexie）
 * 项目 = 跨模块「主题容器」：账/待办/笔记/跟进日志用可选 projectId 弱引用挂上来；
 * 统计一律从源记录实时推导，项目表不存快照（仓库铁律）。
 */

const PROJECT_STATUS_META: Record<
  Project['status'],
  { label: string; tone: 'green' | 'amber' | 'gray' }
> = {
  active: { label: '进行中', tone: 'green' },
  paused: { label: '已搁置', tone: 'amber' },
  archived: { label: '已归档', tone: 'gray' },
}

export function projectStatusMeta(status: Project['status']) {
  return PROJECT_STATUS_META[status]
}

/** 订阅项目列表（归档项目沉底，再按创建时间） */
export function useProjects(): Project[] {
  return useCollection<Project>('projects')
}

/** 某项目的全部里程碑（sortOrder 稳定排序） */
export function useProjectMilestones(projectId: string | undefined): ProjectMilestone[] {
  const list = useQuery<ProjectMilestone[]>(
    () =>
      projectId
        ? db.projectMilestones
            .where('projectId')
            .equals(projectId)
            .filter((m) => !m.deleted)
            .sortBy('sortOrder')
        : Promise.resolve([]),
    [projectId],
  )
  return list ?? []
}

/** 某项目关联的账目流水（按时间倒序） */
export function useProjectTransactions(projectId: string | undefined): Transaction[] {
  const list = useQuery<Transaction[]>(
    () =>
      projectId
        ? // 关联已迁 links（v15）：按 [toType+toId] 索引反查流水 id 再取行（与 useCustomerTransactions 同口径）
          db.links
            .where('[toType+toId]')
            .equals(['projects', projectId])
            .filter((l) => !l.deleted && l.kind === 'related' && l.fromType === 'transactions')
            .toArray()
            .then((ls) => db.transactions.bulkGet(ls.map((l) => l.fromId)))
            .then((rows) =>
              rows.filter((t): t is Transaction => !!t && !t.deleted).sort(
                (a, b) => b.occurredAt - a.occurredAt,
              ),
            )
        : Promise.resolve([]),
    [projectId],
  )
  return list ?? []
}

/** 某项目关联的待办 */
export function useProjectTodos(projectId: string | undefined): Todo[] {
  const list = useQuery<Todo[]>(
    () =>
      projectId
        ? db.todos
            .where('projectId')
            .equals(projectId)
            .filter((t) => !t.deleted)
            .toArray()
        : Promise.resolve([]),
    [projectId],
  )
  return list ?? []
}

/** 某项目归属的笔记（资料聚合落点） */
export function useProjectNotes(projectId: string | undefined): Note[] {
  const list = useQuery<Note[]>(
    () =>
      projectId
        ? db.notes
            .where('projectId')
            .equals(projectId)
            .filter((n) => !n.deleted)
            .toArray()
        : Promise.resolve([]),
    [projectId],
  )
  return list ?? []
}

/** 某项目的跟进日志（复用 CRM Interaction，按时间倒序） */
export function useProjectInteractions(projectId: string | undefined): Interaction[] {
  const list = useQuery<Interaction[]>(
    () =>
      projectId
        ? readInteractionProjection({projectId})
        : Promise.resolve([]),
    [projectId],
  )
  return list ?? []
}

/**
 * 项目进度实时推导（不存快照）：
 * - 有里程碑：Σ(done×weight) / Σ(weight)
 * - 无里程碑：fallback 项目下待办完成率；连待办也没有则 0
 */
export function useProjectProgress(projectId: string | undefined): {
  percent: number
  source: 'milestone' | 'todo' | 'none'
} {
  const milestones = useProjectMilestones(projectId)
  const todos = useProjectTodos(projectId)
  if (milestones.length > 0) {
    const totalW = milestones.reduce((s, m) => s + (m.weight > 0 ? m.weight : 1), 0)
    const doneW = milestones
      .filter((m) => m.status === 'done')
      .reduce((s, m) => s + (m.weight > 0 ? m.weight : 1), 0)
    return { percent: totalW > 0 ? Math.round((doneW / totalW) * 100) : 0, source: 'milestone' }
  }
  if (todos.length > 0) {
    const done = todos.filter((t) => !isTodoOpen(t)).length
    return { percent: Math.round((done / todos.length) * 100), source: 'todo' }
  }
  return { percent: 0, source: 'none' }
}

/** 新建/编辑项目 */
export async function saveProject(input: {
  id?: string
  name: string
  color: string
  status: Project['status']
  customerId?: string
  budget?: number
  note?: string
}): Promise<Project> {
  const checkSession = captureClientWriteSession()
  const now = Date.now()
  const prev = input.id ? await db.projects.get(input.id) : undefined
  checkSession()
  const record: Project = {
    id: input.id ?? newId('pj'),
    name: input.name.trim(),
    color: input.color,
    status: input.status,
    customerId: input.customerId || undefined,
    budget: input.budget,
    note: input.note?.trim() || undefined,
    createdAt: prev?.createdAt ?? now,
    updatedAt: now,
    deleted: 0,
    rev: (prev?.rev ?? 0) + 1,
  }
  await storage.transaction(['projects', 'syncQueue'], async (tx) => {
    await tx.put('projects', record)
    await tx.enqueue('projects', record.id, 'upsert', now)
  })
  storage.requestSync()
  return record
}

/** 里程碑落库（新建/编辑/状态流转统一入口） */
export async function saveMilestone(input: {
  id?: string
  projectId: string
  name: string
  dueAt?: number
  weight: number
  status: ProjectMilestone['status']
  sortOrder?: number
}): Promise<void> {
  const checkSession = captureClientWriteSession()
  const now = Date.now()
  const prev = input.id ? await db.projectMilestones.get(input.id) : undefined
  checkSession()
  const record: ProjectMilestone = {
    id: input.id ?? newId('ms'),
    projectId: input.projectId,
    name: input.name.trim(),
    dueAt: input.dueAt,
    weight: input.weight > 0 ? Math.round(input.weight) : 1,
    status: input.status,
    sortOrder: input.sortOrder ?? prev?.sortOrder ?? 0,
    createdAt: prev?.createdAt ?? now,
    updatedAt: now,
    deleted: 0,
    rev: (prev?.rev ?? 0) + 1,
  }
  await storage.transaction(['projectMilestones', 'syncQueue'], async (tx) => {
    await tx.put('projectMilestones', record)
    await tx.enqueue('projectMilestones', record.id, 'upsert', now)
  })
  storage.requestSync()
}

/** 删除里程碑（软删墓碑，照 deleteTodoListCascade 纪律） */
export async function deleteMilestone(id: string): Promise<void> {
  const now = Date.now()
  await storage.transaction(['projectMilestones', 'syncQueue'], async (tx) => {
    const prev = await tx.get<ProjectMilestone>('projectMilestones', id)
    if (!prev || prev.deleted) return
    await tx.put('projectMilestones', {
      ...prev,
      deleted: 1,
      updatedAt: now,
      rev: prev.rev + 1,
      deletedAt: now,
      restoredAt: undefined,
      trashSnapshot: undefined,
    })
    await tx.enqueue('projectMilestones', id, 'delete', now)
  })
  storage.requestSync()
}

/**
 * 项目级联删除（软删项目 + 里程碑，解绑四表 projectId）。
 *
 * ⚠️ **实现已下沉到 `@/repositories`（2026-10-21）**：级联语义属落库口径，与
 * `deleteCustomerCascade` 同处才谈得上「单一事实源」；本文件带 React 查询钩子，
 * agentOps 引用它会被绑到 UI 层。这里只做 re-export，UI / 测试导入路径不变。
 */
export { deleteProjectCascade } from '@/repositories'

/** 笔记归属项目（projectId=undefined 即移出项目；照 moveNoteToFolder 纪律） */
export async function moveNoteToProject(
  noteId: string,
  projectId: string | undefined,
): Promise<void> {
  const now = Date.now()
  await storage.transaction(['notes', 'syncQueue'], async (tx) => {
    const prev = await tx.get<Note>('notes', noteId)
    if (!prev || prev.deleted) return
    await tx.put('notes', { ...prev, projectId, updatedAt: now, rev: prev.rev + 1 })
    await tx.enqueue('notes', noteId, 'upsert', now)
  })
  storage.requestSync()
}
