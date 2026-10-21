import { db } from '@/db/db'
import { storage } from '@/storage'
import { newId } from '@/repositories'
import { useCollection, useQuery } from '@/queries/hooks'
import type { Project, ProjectMilestone, Todo, Transaction, Note, Interaction } from '@/db/types'
import { isTodoOpen } from '@/modules/todo/domain'
import { toLinkFieldPatch, txnProjectIds } from '@/repositories'

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

/** 订阅单个项目（useRecord 已过滤软删） */
export function useProject(id: string | undefined): Project | undefined {
  return useCollection<Project>('projects').find((p) => p.id === id)
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
        ? db.transactions
            .filter((t) => !t.deleted)
            .toArray()
            .then((rows) =>
              rows
                .filter((t) => txnProjectIds(t).includes(projectId))
                .sort((a, b) => b.occurredAt - a.occurredAt),
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
        ? db.interactions
            .where('projectId')
            .equals(projectId)
            .filter((i) => !i.deleted)
            .reverse()
            .sortBy('at')
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

/** 项目表单用：客户选项投影 */
export interface ProjectCustomerOption {
  id: string
  name: string
  company: string
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
  const now = Date.now()
  const prev = input.id ? await db.projects.get(input.id) : undefined
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
  const now = Date.now()
  const prev = input.id ? await db.projectMilestones.get(input.id) : undefined
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
    await tx.put('projectMilestones', { ...prev, deleted: 1, updatedAt: now, rev: prev.rev + 1 })
    await tx.enqueue('projectMilestones', id, 'delete', now)
  })
  storage.requestSync()
}

/**
 * 项目级联删除（照 deleteCustomerCascade / deleteTodoListCascade 纪律，单事务）：
 * 1. 软删项目 + 软删名下全部里程碑（里程碑是项目专属刻度，随项目消亡）
 * 2. 解绑弱引用：transactions/todos/notes/interactions 的 projectId 置 undefined
 *    —— 账目/待办/笔记不能因项目没了而消失（「待办只是一次」语义），只清关联。
 * 项目不存在时静默返回（幂等）。
 */
export async function deleteProjectCascade(projectId: string): Promise<void> {
  const now = Date.now()
  await storage.transaction(
    ['projects', 'projectMilestones', 'transactions', 'todos', 'notes', 'interactions', 'syncQueue'],
    async (tx) => {
      const prev = await tx.get<Project>('projects', projectId)
      if (!prev || prev.deleted) return

      await tx.put('projects', { ...prev, deleted: 1, updatedAt: now, rev: prev.rev + 1 })
      await tx.enqueue('projects', projectId, 'delete', now)

      const milestones = (await tx.list<ProjectMilestone>('projectMilestones')).filter(
        (m) => m.projectId === projectId && !m.deleted,
      )
      for (const m of milestones) {
        await tx.put('projectMilestones', { ...m, deleted: 1, updatedAt: now, rev: m.rev + 1 })
        await tx.enqueue('projectMilestones', m.id, 'delete', now)
      }

      // 单值弱引用表（todos/notes/interactions）：projectId 置 undefined 即解绑
      const unbindSingle = async (
        table: 'todos' | 'notes' | 'interactions',
        records: { id: string; rev: number; deleted?: number }[],
      ) => {
        for (const r of records) {
          if (r.deleted) continue
          await tx.update(table, r.id, { projectId: undefined, updatedAt: now, rev: r.rev + 1 })
          await tx.enqueue(table, r.id, 'upsert', now)
        }
      }
      // transactions 关联已数组化（Issue #140 v11）：projectId 旧键已删，走 projectIds 数组解绑。
      // 不能写 `projectId: undefined` —— 既解不掉 projectIds 里的项目，还按「双写不双读」留下一个
      // 永不读取的旧键；必须走 toLinkFieldPatch('projectIds', …)（空数组不落键）。
      const txns = (await tx.list<Transaction>('transactions'))
        .filter((t) => !t.deleted)
        .filter((t) => txnProjectIds(t).includes(projectId))
      for (const txn of txns) {
        await tx.update('transactions', txn.id, {
          ...toLinkFieldPatch('projectIds', txnProjectIds(txn).filter((id) => id !== projectId)),
          updatedAt: now,
          rev: txn.rev + 1,
        })
        await tx.enqueue('transactions', txn.id, 'upsert', now)
      }

      const [todos, notes, interactions] = await Promise.all([
        tx.list<Todo>('todos'),
        tx.list<Note>('notes'),
        tx.list<Interaction>('interactions'),
      ])
      await unbindSingle(
        'todos',
        todos.filter((r) => r.projectId === projectId),
      )
      await unbindSingle(
        'notes',
        notes.filter((r) => r.projectId === projectId),
      )
      await unbindSingle(
        'interactions',
        interactions.filter((r) => r.projectId === projectId),
      )
    },
  )
  storage.requestSync()
}

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
