import { useState } from 'react'
import { Icon } from '@/design-system/Icon'
import { useNavigate, useParams } from 'react-router-dom'
import { useCollection, useRecord } from '@/queries/hooks'
import { isImeComposing } from '@/shared/ime'
import { db } from '@/db/db'
import { interactionRepo, newId, saveInteractionAndTouchCustomer } from '@/repositories'
import { nextSortOrder } from '@/repositories/sortOrder'
import type { PutInput } from '@/repositories/repository'
import type { Customer, Interaction, Project, ProjectMilestone } from '@/db/types'
import {
  Avatar,
  Button,
  Card,
  Chip,
  ConfirmDialog,
  EmptyState,
  PageHeader,
  inputCls,
} from '@/design-system/ui'
import dayjs from 'dayjs'
import { isTodoOpen, isTodoDone, isTodoVoided, isTodoFinished, hasTime } from '@/modules/todo/domain'
import { todoPriorityLabel, todoPriorityTone } from '@/modules/todo/priority'
import ProjectFormDrawer from './ProjectFormDrawer'
import { financeFocusPath } from '@/modules/finance/links'
import { staggerStyle } from '@/shared/stagger'
import {
  deleteMilestone,
  deleteProjectCascade,
  projectStatusMeta,
  saveMilestone,
  useProjectInteractions,
  useProjectMilestones,
  useProjectNotes,
  useProjectProgress,
  useProjectTodos,
  useProjectTransactions,
} from './hooks'

const fmtMoney = (n: number) => `¥${Math.abs(n).toLocaleString('zh-CN')}`

const MILESTONE_STATUS_META: Record<
  ProjectMilestone['status'],
  { label: string; tone: 'gray' | 'amber' | 'green' }
> = {
  planned: { label: '未开始', tone: 'gray' },
  inProgress: { label: '进行中', tone: 'amber' },
  done: { label: '已完成', tone: 'green' },
}

/** 项目详情聚合页（路由 /projects/:id）：项目全貌 —— 进度 / 里程碑 / 账 / 待办 / 资料 / 跟进 */
export default function ProjectDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const project = useRecord<Project>('projects', id)
  const milestones = useProjectMilestones(id)
  const transactions = useProjectTransactions(id)
  const todos = useProjectTodos(id)
  const notes = useProjectNotes(id)
  const interactions = useProjectInteractions(id)
  const progress = useProjectProgress(id)
  const customers = useCollection<Customer>('customers')
  const [editing, setEditing] = useState(false)
  // 删除项目确认（应用风格弹窗，替代 window.confirm）
  const [confirmDelete, setConfirmDelete] = useState(false)

  if (!project) {
    return (
      <div className="mx-auto max-w-[1200px]">
        <PageHeader
          title="项目详情"
          actions={
            <Button variant="ghost" icon="arrow_back" onClick={() => navigate('/projects')}>
              返回列表
            </Button>
          }
        />
        <Card className="p-6">
          <EmptyState
            icon="hub"
            title="项目不存在或已删除"
            description="可能已被移除，返回列表查看其他项目"
          />
        </Card>
      </div>
    )
  }

  const income = transactions.filter((t) => t.type === 'income').reduce((s, t) => s + t.amount, 0)
  const expense = transactions.filter((t) => t.type === 'expense').reduce((s, t) => s + t.amount, 0)
  const openTodos = todos.filter(isTodoOpen)
  // 作废条目（Issue #128）不属于未完成，也不出现在项目待办清单的默认口径里
  const visibleTodos = todos.filter((t) => !isTodoVoided(t))
  const customer = project.customerId
    ? customers.find((c) => c.id === project.customerId)
    : undefined
  const meta = projectStatusMeta(project.status)

  function handleDelete() {
    setConfirmDelete(true)
  }

  return (
    <div className="mx-auto max-w-[1200px]">
      <PageHeader
        title="项目"
        actions={
          <>
            <Button variant="ghost" icon="arrow_back" onClick={() => navigate('/projects')}>
              返回列表
            </Button>
            <Button icon="edit" onClick={() => setEditing(true)}>
              编辑项目
            </Button>
            <Button variant="danger" icon="delete" onClick={handleDelete}>
              删除项目
            </Button>
          </>
        }
      />

      <div className="grid gap-4 lg:grid-cols-5">
        {/* 左列：项目头 + 进度 + 里程碑 */}
        <div className="space-y-4 lg:col-span-2">
          <Card className="p-5">
            <div className="flex items-start gap-4">
              <span
                className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl text-white"
                style={{ background: project.color }}
              >
                <Icon name="hub" size={24} />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[1.2857rem] font-bold">{project.name}</span>
                  <Chip tone={meta.tone}>{meta.label}</Chip>
                </div>
                <div className="mt-0.5 text-[0.8571rem] text-outline">
                  创建于 {dayjs(project.createdAt).format('YYYY-MM-DD')}
                  {project.budget != null ? ` · 预算 ${fmtMoney(project.budget)}` : ''}
                </div>
                {customer && (
                  <button
                    className="mt-2 flex items-center gap-2 surface-card !bg-transparent px-2.5 py-1.5 text-left transition-colors hover:border-primary"
                    onClick={() => navigate(`/crm/${customer.id}`)}
                  >
                    <Avatar name={customer.name} size={22} />
                    <span className="min-w-0">
                      <span className="block truncate text-[0.8571rem] font-medium">
                        {customer.name}
                      </span>
                      <span className="block text-[0.75rem] text-outline">
                        {customer.company || '—'}
                      </span>
                    </span>
                    <Icon name="chevron_right" size={14} className="text-outline" />
                  </button>
                )}
              </div>
            </div>
            {project.note && (
              <p className="mt-3 rounded-lg bg-surface-container-low/60 px-3 py-2 text-[0.9286rem] leading-relaxed">
                {project.note}
              </p>
            )}
          </Card>

          <Card className="p-5">
            <div className="mb-3 flex items-center justify-between">
              <div className="flex items-center gap-1.5 text-[0.8571rem] font-medium uppercase tracking-wide text-on-surface-variant">
                <Icon name="track_changes" className="text-[1.1429rem] text-primary" />
                项目进度
              </div>
              <span className="text-[0.7857rem] text-outline">
                {progress.source === 'milestone'
                  ? '按里程碑权重推导'
                  : progress.source === 'todo'
                    ? '按待办完成率推导'
                    : '暂无可推导数据'}
              </span>
            </div>
            <div className="flex items-center gap-4">
              <ProgressRing percent={progress.percent} />
              <div className="min-w-0 flex-1 space-y-1.5 text-[0.8571rem]">
                <div className="flex justify-between">
                  <span className="text-on-surface-variant">累计收入</span>
                  <span className="font-bold text-success">+{fmtMoney(income)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-on-surface-variant">累计支出</span>
                  <span className="font-bold text-danger">-{fmtMoney(expense)}</span>
                </div>
                {project.budget != null && (
                  <div className="flex justify-between">
                    <span className="text-on-surface-variant">预算执行</span>
                    <span className="font-bold">
                      {project.budget > 0 ? Math.round((expense / project.budget) * 100) : 0}%
                    </span>
                  </div>
                )}
              </div>
            </div>
          </Card>

          <MilestoneCard projectId={project.id} milestones={milestones} />
        </div>

        {/* 右列：账 / 待办 / 资料 / 跟进 */}
        <div className="space-y-4 lg:col-span-3">
          <Card className="p-5">
            <div className="mb-3 flex items-center justify-between">
              <div className="flex items-center gap-1.5 text-[0.8571rem] font-medium uppercase tracking-wide text-on-surface-variant">
                <Icon name="payments" className="text-[1.1429rem] text-primary" />
                项目流水（{transactions.length}）
              </div>
              <button
                className="text-[0.8571rem] font-semibold text-primary hover:underline"
                onClick={() => navigate('/finance')}
              >
                去记账 →
              </button>
            </div>
            {transactions.length === 0 ? (
              <div className="py-4 text-center text-[0.8571rem] text-outline">
                暂无关联流水，在财务中心记账时选择本项目即可归集
              </div>
            ) : (
              <div className="space-y-1.5">
                {transactions.slice(0, 6).map((t, i) => (
                  <button
                    key={t.id}
                    type="button"
                    title="点击查看凭证详情"
                    style={staggerStyle(i)}
                    className="anim-list-item flex w-full cursor-pointer items-center justify-between rounded-lg bg-surface-container-low/50 px-3 py-2 text-left text-[0.8929rem] transition-colors hover:bg-surface-hover-low"
                    onClick={() => navigate(financeFocusPath(t.id))}
                  >
                    <span className="min-w-0 truncate">
                      <span className="text-outline">{dayjs(t.occurredAt).format('MM-DD')}</span>{' '}
                      {t.summary}
                    </span>
                    <span
                      className={`ml-2 shrink-0 font-bold ${t.type === 'income' ? 'text-success' : 'text-danger'}`}
                    >
                      {t.type === 'income' ? '+' : '-'}
                      {fmtMoney(t.amount)}
                    </span>
                  </button>
                ))}
                {transactions.length > 6 && (
                  <div className="text-center text-[0.7857rem] text-outline">
                    还有 {transactions.length - 6} 笔…
                  </div>
                )}
              </div>
            )}
          </Card>

          <Card className="p-5">
            <div className="mb-3 flex items-center justify-between">
              <div className="flex items-center gap-1.5 text-[0.8571rem] font-medium uppercase tracking-wide text-on-surface-variant">
                <Icon name="check_circle" className="text-[1.1429rem] text-primary" />
                项目待办（{openTodos.length} 未完成）
              </div>
              <button
                className="text-[0.8571rem] font-semibold text-primary hover:underline"
                onClick={() => navigate('/todo')}
              >
                去安排 →
              </button>
            </div>
            {visibleTodos.length === 0 ? (
              <div className="py-4 text-center text-[0.8571rem] text-outline">
                暂无关联待办，新建待办时选择本项目即可
              </div>
            ) : (
              <div className="space-y-1.5">
                {visibleTodos.slice(0, 6).map((t, i) => (
                  <div
                    key={t.id}
                    style={staggerStyle(i)}
                    className="anim-list-item flex items-center gap-2 rounded-lg bg-surface-container-low/50 px-3 py-2 text-[0.8929rem]"
                  >
                    {/* 三态标注（Issue #128）：完成=绿「完成」/ 作废=灰「已作废」/ 未完成=优先级 */}
                    <Chip
                      tone={
                        isTodoDone(t)
                          ? 'green'
                          : isTodoVoided(t)
                            ? 'gray'
                            : todoPriorityTone(t.priority)
                      }
                    >
                      {isTodoDone(t)
                        ? '完成'
                        : isTodoVoided(t)
                          ? '已作废'
                          : todoPriorityLabel(t.priority)}
                    </Chip>
                    <span
                      className={`min-w-0 truncate ${isTodoFinished(t) ? 'text-outline line-through' : ''}`}
                    >
                      {t.title}
                    </span>
                    {hasTime(t.dueAt) && (
                      <span className="ml-auto shrink-0 text-[0.7857rem] text-outline">
                        {dayjs(t.dueAt).format('MM-DD HH:mm')}
                      </span>
                    )}
                  </div>
                ))}
                {visibleTodos.length > 6 && (
                  <div className="text-center text-[0.7857rem] text-outline">
                    还有 {visibleTodos.length - 6} 项…
                  </div>
                )}
              </div>
            )}
          </Card>

          <Card className="p-5">
            <div className="mb-3 flex items-center justify-between">
              <div className="flex items-center gap-1.5 text-[0.8571rem] font-medium uppercase tracking-wide text-on-surface-variant">
                <Icon name="description" className="text-[1.1429rem] text-primary" />
                项目资料（{notes.length}）
              </div>
              <button
                className="text-[0.8571rem] font-semibold text-primary hover:underline"
                onClick={() => navigate('/notes')}
              >
                去写笔记 →
              </button>
            </div>
            {notes.length === 0 ? (
              <div className="py-4 text-center text-[0.8571rem] text-outline">
                暂无归属笔记，笔记编辑页「所属项目」选择本项目即可归集
              </div>
            ) : (
              <div className="space-y-1.5">
                {notes.map((n, i) => (
                  <button
                    key={n.id}
                    onClick={() => navigate(`/notes/${n.id}`)}
                    style={staggerStyle(i)}
                    className="anim-list-item flex w-full items-center gap-2 surface-card !bg-transparent px-3 py-2 text-left text-[0.8929rem] transition-colors hover:border-primary"
                  >
                    <Icon name="article" size={15} className="shrink-0 text-primary" />
                    <span className="min-w-0 flex-1 truncate">{n.title || '未命名笔记'}</span>
                    <span className="shrink-0 text-[0.7857rem] text-outline">
                      {dayjs(n.updatedAt).format('MM-DD')}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </Card>

          <Card className="p-5">
            <div className="mb-3 flex items-center gap-1.5 text-[0.8571rem] font-medium uppercase tracking-wide text-on-surface-variant">
              <Icon name="bolt" className="text-[1.1429rem] text-primary" />
              项目跟进
            </div>
            <QuickLog projectId={project.id} />
            <div className="mt-4">
              {interactions.length === 0 ? (
                <div className="py-4 text-center text-[0.8571rem] text-outline">
                  暂无跟进记录，用上方「快速记一笔」开始
                </div>
              ) : (
                <div className="relative space-y-4 border-l border-outline-variant/40 pl-4">
                  {interactions.map((it, i) => (
                    /* 错峰挂在**不设 position 的** wrapper 上：条目内 `absolute -left-[22px]`
                       仍向上找到外层 relative 容器，左侧竖线圆点定位不受影响。 */
                    <div key={it.id} className="anim-list-item" style={staggerStyle(i)}>
                      <div className="relative">
                        <span className="absolute -left-[22px] top-1 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-primary-fixed">
                          <span className="h-1.5 w-1.5 rounded-full bg-primary" />
                        </span>
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-[0.8571rem] text-outline">
                            {dayjs(it.at).format('YYYY-MM-DD HH:mm')}
                          </span>
                        </div>
                        <p className="mt-1 rounded-lg bg-surface-container-low/50 px-3 py-2 text-[0.9286rem] leading-relaxed">
                          {it.content}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </Card>
        </div>
      </div>

      <ProjectFormDrawer open={editing} project={project} onClose={() => setEditing(false)} />

      {/* 删除项目确认（应用风格弹窗，替代 window.confirm） */}
      <ConfirmDialog
        open={confirmDelete}
        title={`确定删除项目「${project.name}」？`}
        danger
        confirmText="删除"
        message={
          <>
            将同时删除 {milestones.length} 个里程碑，并解绑 {transactions.length} 笔流水、
            {todos.length} 项待办、{notes.length} 篇笔记与 {interactions.length}{' '}
            条跟进记录（记录本身保留）。
          </>
        }
        onCancel={() => setConfirmDelete(false)}
        onConfirm={() => {
          setConfirmDelete(false)
          void deleteProjectCascade(project.id).then(() => navigate('/projects'))
        }}
      />
    </div>
  )
}

/** 进度环形（里程碑/待办推导结果，不存快照） */
function ProgressRing({ percent }: { percent: number }) {
  const r = 26
  const circ = 2 * Math.PI * r
  const color = percent >= 100 ? '#006c49' : '#004ac6'
  return (
    <svg width="72" height="72" viewBox="0 0 72 72" className="shrink-0">
      <circle cx="36" cy="36" r={r} fill="none" stroke="#dce9ff" strokeWidth="7" />
      <circle
        cx="36"
        cy="36"
        r={r}
        fill="none"
        stroke={color}
        strokeWidth="7"
        strokeLinecap="round"
        strokeDasharray={`${(percent / 100) * circ} ${circ}`}
        transform="rotate(-90 36 36)"
      />
      <text
        x="36"
        y="40"
        textAnchor="middle"
        className="fill-on-surface"
        style={{ fontSize: 15, fontWeight: 700 }}
      >
        {percent}%
      </text>
    </svg>
  )
}

/** 里程碑卡片：增删 + 状态流转（阶段刻度，区别于一次性待办） */
function MilestoneCard({
  projectId,
  milestones,
}: {
  projectId: string
  milestones: ProjectMilestone[]
}) {
  const [adding, setAdding] = useState(false)
  const [name, setName] = useState('')
  const [weight, setWeight] = useState('1')
  const [dueAt, setDueAt] = useState('')
  const [error, setError] = useState('')

  async function add() {
    if (!name.trim()) {
      setError('请填写里程碑名称')
      return
    }
    const w = Number(weight.trim()) || 1
    if (w <= 0) {
      setError('权重必须为正数')
      return
    }
    await saveMilestone({
      projectId,
      name,
      weight: w,
      status: 'planned',
      dueAt: dueAt ? dayjs(dueAt).valueOf() : undefined,
      // 尾值收口（审计 C-9 同类项）：原为 `milestones.length` —— 删除里程碑后会与存活项重号。
      // 作用域限定「本项目内的里程碑」（不能退化成全表 max，否则会拿到别的项目的尾值）。
      sortOrder: await nextSortOrder('projectMilestones', (m) => m.projectId === projectId),
    })
    setName('')
    setWeight('1')
    setDueAt('')
    setError('')
    setAdding(false)
  }

  async function cycleStatus(m: ProjectMilestone) {
    const next: ProjectMilestone['status'] =
      m.status === 'planned' ? 'inProgress' : m.status === 'inProgress' ? 'done' : 'planned'
    await saveMilestone({
      id: m.id,
      projectId: m.projectId,
      name: m.name,
      weight: m.weight,
      status: next,
      dueAt: m.dueAt,
      sortOrder: m.sortOrder,
    })
  }

  return (
    <Card className="p-5">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-[0.8571rem] font-medium uppercase tracking-wide text-on-surface-variant">
          <Icon name="flag" className="text-[1.1429rem] text-primary" />
          里程碑（{milestones.length}）
        </div>
        <button
          className="text-[0.8571rem] font-semibold text-primary hover:underline"
          onClick={() => setAdding((v) => !v)}
        >
          {adding ? '收起' : '+ 添加'}
        </button>
      </div>

      {adding && (
        <div className="mb-3 space-y-2 surface-card-xl !bg-transparent p-3">
          <input
            className={inputCls}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="里程碑名称，如：方案定稿"
            autoFocus
          />
          <div className="grid grid-cols-2 gap-2">
            <input
              type="number"
              min={1}
              className={inputCls}
              value={weight}
              onChange={(e) => setWeight(e.target.value)}
              placeholder="权重"
              title="进度权重（正整数）"
            />
            <input
              type="date"
              className={inputCls}
              value={dueAt}
              onChange={(e) => setDueAt(e.target.value)}
            />
          </div>
          {error && <div className="text-[0.8571rem] text-danger">{error}</div>}
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="tonal" onClick={() => setAdding(false)}>
              取消
            </Button>
            <Button size="sm" icon="add" onClick={() => void add()}>
              添加
            </Button>
          </div>
        </div>
      )}

      {milestones.length === 0 ? (
        <div className="py-3 text-center text-[0.8571rem] text-outline">
          暂无里程碑；添加后进度按权重加权推导（无里程碑时按待办完成率）
        </div>
      ) : (
        <div className="space-y-1.5">
          {milestones.map((m, i) => {
            const meta = MILESTONE_STATUS_META[m.status]
            return (
              <div
                key={m.id}
                style={staggerStyle(i)}
                className="anim-list-item flex items-center gap-2 rounded-lg bg-surface-container-low/50 px-3 py-2"
              >
                <button
                  onClick={() => void cycleStatus(m)}
                  title="点击切换状态：未开始 → 进行中 → 已完成"
                  className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border transition-colors ${
                    m.status === 'done'
                      ? 'border-success bg-success text-white'
                      : m.status === 'inProgress'
                        ? 'border-warning bg-warning-container'
                        : 'border-outline-variant'
                  }`}
                >
                  {m.status === 'done' && <Icon name="check" size={12} />}
                  {m.status === 'inProgress' && (
                    <span className="h-2 w-2 rounded-full bg-warning" />
                  )}
                </button>
                <span
                  className={`min-w-0 flex-1 truncate text-[0.8929rem] ${m.status === 'done' ? 'text-outline line-through' : ''}`}
                >
                  {m.name}
                </span>
                <Chip tone={meta.tone}>{meta.label}</Chip>
                <span className="shrink-0 text-[0.7857rem] text-outline" title="进度权重">
                  ×{m.weight}
                </span>
                {hasTime(m.dueAt) && (
                  <span className="shrink-0 text-[0.7857rem] text-outline">
                    {dayjs(m.dueAt).format('MM-DD')}
                  </span>
                )}
                <button
                  className="shrink-0 text-outline transition-colors hover:text-danger"
                  title="删除里程碑"
                  onClick={() => void deleteMilestone(m.id)}
                >
                  <Icon name="close" size={14} />
                </button>
              </div>
            )
          })}
        </div>
      )}
    </Card>
  )
}

/** 项目快速跟进（复用 Interaction 表，projectId 归档） */
function QuickLog({ projectId }: { projectId: string }) {
  const [content, setContent] = useState('')
  const [saving, setSaving] = useState(false)

  async function save() {
    if (!content.trim() || saving) return
    setSaving(true)
    try {
      const at = Date.now()
      const interaction: PutInput<Interaction> = {
        id: newId('itx'),
        customerId: '',
        content: content.trim(),
        at,
        projectId,
      }
      // 有挂靠客户时复用原子双写刷新 lastContactAt；无客户直接落库
      const project = await db.projects.get(projectId)
      if (project?.customerId) {
        await saveInteractionAndTouchCustomer(interaction, project.customerId)
      } else {
        await interactionRepo.put(interaction)
      }
      setContent('')
    } catch (err) {
      console.error('[ProjectQuickLog] 保存跟进失败', err)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="rounded-xl bg-surface-container-low/60 p-3">
      <div className="mb-2 flex items-center gap-1.5 text-[0.8571rem] font-semibold text-primary">
        <Icon name="bolt" className="text-[1.1429rem]" />
        快速记一笔
      </div>
      <div className="flex gap-2">
        <input
          className={inputCls}
          value={content}
          onChange={(e) => setContent(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && !isImeComposing(e.nativeEvent) && void save()}
          placeholder="记录项目进展、阶段小结…"
        />
        <Button icon="send" disabled={!content.trim() || saving} onClick={() => void save()}>
          记录
        </Button>
      </div>
    </div>
  )
}
