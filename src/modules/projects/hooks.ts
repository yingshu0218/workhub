import { db } from '@/db/db'
import { newId } from '@/repositories'
import { useCollection, useQuery } from '@/queries/hooks'
import { syncEngine } from '@/sync/engine'
import type { Project, ProjectMilestone, Todo, Transaction, Note, Interaction } from '@/db/types'
import { isTodoOpen } from '@/modules/todo/domain'

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
            .where('projectId')
            .equals(projectId)
            .filter((t) => !t.deleted)
            .reverse()
            .sortBy('occurredAt')
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
  await db.transaction('rw', [db.projects, db.syncQueue], async () => {
    await db.projects.put(record)
    await db.syncQueue.add({ table: 'projects', recordId: record.id, op: 'upsert', createdAt: now })
  })
  syncEngine.requestSync()
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
  await db.transaction('rw', [db.projectMilestones, db.syncQueue], async () => {
    await db.projectMilestones.put(record)
    await db.syncQueue.add({
      table: 'projectMilestones',
      recordId: record.id,
      op: 'upsert',
      createdAt: now,
    })
  })
  syncEngine.requestSync()
}

/** 删除里程碑（软删墓碑，照 deleteTodoListCascade 纪律） */
export async function deleteMilestone(id: string): Promise<void> {
  const prev = await db.projectMilestones.get(id)
  if (!prev) return
  const now = Date.now()
  await db.transaction('rw', [db.projectMilestones, db.syncQueue], async () => {
    await db.projectMilestones.put({ ...prev, deleted: 1, updatedAt: now, rev: prev.rev + 1 })
    await db.syncQueue.add({
      table: 'projectMilestones',
      recordId: id,
      op: 'delete',
      createdAt: now,
    })
  })
  syncEngine.requestSync()
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
  await db.transaction(
    'rw',
    [
      db.projects,
      db.projectMilestones,
      db.transactions,
      db.todos,
      db.notes,
      db.interactions,
      db.syncQueue,
    ],
    async () => {
      const prev = await db.projects.get(projectId)
      if (!prev || prev.deleted) return

      await db.projects.put({ ...prev, deleted: 1, updatedAt: now, rev: prev.rev + 1 })
      await db.syncQueue.add({
        table: 'projects',
        recordId: projectId,
        op: 'delete',
        createdAt: now,
      })

      const milestones = await db.projectMilestones
        .where('projectId')
        .equals(projectId)
        .filter((m) => !m.deleted)
        .toArray()
      for (const m of milestones) {
        await db.projectMilestones.put({ ...m, deleted: 1, updatedAt: now, rev: m.rev + 1 })
        await db.syncQueue.add({
          table: 'projectMilestones',
          recordId: m.id,
          op: 'delete',
          createdAt: now,
        })
      }

      const unbind = async (
        table: 'transactions' | 'todos' | 'notes' | 'interactions',
        records: { id: string; rev: number; deleted?: number }[],
      ) => {
        for (const r of records) {
          if (r.deleted) continue
          await db[table].update(r.id, { projectId: undefined, updatedAt: now, rev: r.rev + 1 })
          await db.syncQueue.add({ table, recordId: r.id, op: 'upsert', createdAt: now })
        }
      }
      const [txns, todos, notes, interactions] = await Promise.all([
        db.transactions.where('projectId').equals(projectId).toArray(),
        db.todos.where('projectId').equals(projectId).toArray(),
        db.notes.where('projectId').equals(projectId).toArray(),
        db.interactions.where('projectId').equals(projectId).toArray(),
      ])
      await unbind('transactions', txns)
      await unbind('todos', todos)
      await unbind('notes', notes)
      await unbind('interactions', interactions)
    },
  )
  syncEngine.requestSync()
}

/** 笔记归属项目（projectId=undefined 即移出项目；照 moveNoteToFolder 纪律） */
export async function moveNoteToProject(
  noteId: string,
  projectId: string | undefined,
): Promise<void> {
  const prev = await db.notes.get(noteId)
  if (!prev || prev.deleted) return
  const now = Date.now()
  await db.transaction('rw', [db.notes, db.syncQueue], async () => {
    await db.notes.put({ ...prev, projectId, updatedAt: now, rev: prev.rev + 1 })
    await db.syncQueue.add({ table: 'notes', recordId: noteId, op: 'upsert', createdAt: now })
  })
  syncEngine.requestSync()
}
