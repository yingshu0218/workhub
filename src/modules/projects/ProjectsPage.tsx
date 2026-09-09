import { useMemo, useState } from 'react'
import { Icon } from '@/design-system/Icon'
import { useNavigate } from 'react-router-dom'
import { useCollection } from '@/queries/hooks'
import type { Todo, Transaction } from '@/db/types'
import { Button, Card, Chip, EmptyState, PageHeader } from '@/design-system/ui'
import dayjs from 'dayjs'
import ProjectFormDrawer from './ProjectFormDrawer'
import { projectStatusMeta, useProjects } from './hooks'

type ScopeFilter = 'active' | 'all' | 'archived'

/** 项目列表页（路由 /projects）：主题容器总览，点击进入项目详情聚合页 */
export default function ProjectsPage() {
  const navigate = useNavigate()
  const projects = useProjects()
  const todos = useCollection<Todo>('todos')
  const transactions = useCollection<Transaction>('transactions')
  const [scope, setScope] = useState<ScopeFilter>('active')
  const [creating, setCreating] = useState(false)

  const filtered = useMemo(() => {
    const list = projects.filter((p) =>
      scope === 'all'
        ? true
        : scope === 'archived'
          ? p.status === 'archived'
          : p.status !== 'archived',
    )
    // 非归档在前，组内按创建时间倒序
    return [...list].sort((a, b) => {
      const ra = a.status === 'archived' ? 1 : 0
      const rb = b.status === 'archived' ? 1 : 0
      if (ra !== rb) return ra - rb
      return b.createdAt - a.createdAt
    })
  }, [projects, scope])

  /** 每个项目的轻量统计（从源记录实时推导，不存快照） */
  const stats = useMemo(() => {
    const map = new Map<string, { income: number; expense: number; openTodos: number }>()
    for (const p of projects) {
      const txns = transactions.filter((t) => t.projectId === p.id)
      map.set(p.id, {
        income: txns.filter((t) => t.type === 'income').reduce((s, t) => s + t.amount, 0),
        expense: txns.filter((t) => t.type === 'expense').reduce((s, t) => s + t.amount, 0),
        openTodos: todos.filter((t) => t.projectId === p.id && t.status !== 'done').length,
      })
    }
    return map
  }, [projects, todos, transactions])

  const scopes: { key: ScopeFilter; label: string }[] = [
    { key: 'active', label: '进行中' },
    { key: 'all', label: '全部' },
    { key: 'archived', label: '已归档' },
  ]

  return (
    <div className="mx-auto max-w-[1200px]">
      <PageHeader
        title="项目"
        subtitle="跨模块主题容器：把账目、待办、笔记与跟进串在一件事上"
        actions={
          <Button icon="add" onClick={() => setCreating(true)}>
            新建项目
          </Button>
        }
      />

      <div className="mb-4 flex gap-1.5">
        {scopes.map((s) => (
          <button
            key={s.key}
            onClick={() => setScope(s.key)}
            className={`rounded-lg border px-3.5 py-1.5 text-[13px] transition-colors ${
              scope === s.key
                ? 'border-primary bg-primary-fixed font-semibold text-primary'
                : 'border-outline-variant/60 text-on-surface-variant hover:text-on-surface'
            }`}
          >
            {s.label}
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <Card className="p-6">
          <EmptyState
            icon="hub"
            title={scope === 'archived' ? '暂无归档项目' : '还没有项目'}
            description="项目用来承载长期事项：一笔笔账、一条条待办、一篇篇资料都挂在同一个主题下"
          />
        </Card>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {filtered.map((p) => {
            const st = stats.get(p.id) ?? { income: 0, expense: 0, openTodos: 0 }
            const meta = projectStatusMeta(p.status)
            return (
              <Card key={p.id} hover onClick={() => navigate(`/projects/${p.id}`)} className="p-5">
                <div className="flex items-start gap-3">
                  <span
                    className="mt-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-white"
                    style={{ background: p.color }}
                  >
                    <Icon name="hub" size={18} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-[15px] font-bold">{p.name}</span>
                      <Chip tone={meta.tone}>{meta.label}</Chip>
                    </div>
                    <div className="mt-0.5 text-[12px] text-outline">
                      创建于 {dayjs(p.createdAt).format('YYYY-MM-DD')}
                      {p.budget != null ? ` · 预算 ¥${p.budget.toLocaleString('zh-CN')}` : ''}
                    </div>
                  </div>
                </div>
                <div className="mt-4 grid grid-cols-3 gap-2 text-center">
                  <div className="rounded-lg bg-surface-container-low/60 py-2">
                    <div className="text-[13px] font-bold text-success">
                      +¥{st.income.toLocaleString('zh-CN')}
                    </div>
                    <div className="text-[11px] text-outline">收入</div>
                  </div>
                  <div className="rounded-lg bg-surface-container-low/60 py-2">
                    <div className="text-[13px] font-bold text-danger">
                      -¥{st.expense.toLocaleString('zh-CN')}
                    </div>
                    <div className="text-[11px] text-outline">支出</div>
                  </div>
                  <div className="rounded-lg bg-surface-container-low/60 py-2">
                    <div className="text-[13px] font-bold text-primary">{st.openTodos}</div>
                    <div className="text-[11px] text-outline">进行中待办</div>
                  </div>
                </div>
              </Card>
            )
          })}
        </div>
      )}

      <ProjectFormDrawer open={creating} onClose={() => setCreating(false)} />
    </div>
  )
}
