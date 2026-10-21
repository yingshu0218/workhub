import dayjs from 'dayjs'
import { Chip } from '@/design-system/ui'
import { Icon } from '@/design-system/Icon'
import type { Customer, Ledger, NoteMention, Project, Todo } from '@/db/types'
import { todoStatusLabel } from '@/modules/todo/domain'
import { todoPriorityFullLabel } from '@/modules/todo/priority'
import { resolveHealthScoreDisplay } from '@/modules/crm/healthScore'
import type { useIntimacyConfig } from '@/modules/crm/intimacy'
import { resolveIntimacyLevel } from '@/modules/crm/intimacy'

/** 保存态（主文件与 SaveBadge 共用；定义在此 = 单一事实源，主文件反向导入） */
export type SaveState = 'saved' | 'dirty' | 'saving'

/** 提及类型（等同 NoteMention 的 type 联合） */
export type MentionType = NoteMention['type']

/**
 * 笔记编辑页的展示层零件（**自 NoteEditorPage.tsx 拆出** · 审计 C-7 · 2026-10-21）
 *
 * 抽出的 6 个组件全部是**纯展示、props 驱动**、且**全仓无第二处引用**（实测）：
 * `PreviewSwitch` · `MentionHighlight` · `MentionEntitySummary` · `CardRow` · `EntityMissing` · `SaveBadge`。
 *
 * ⚠️ **刻意不合并到 `design-system/EntityHoverCard`**（虽然二者都在渲染「实体摘要卡」）：
 * - `EntityHoverCard` 是 Issue #140 抽出的**新版**（hover 触发 + portal + 跳转详情 + 走
 *   `resolveHealthScoreDisplay` 收口）；
 * - 本文件的 `MentionEntitySummary` 是 Issue #50 的**原版**（**点击触发**、NoteEditor 内的
 *   `hoverCard` state 驱动）。
 * 两者**交互模型不同**（hover vs 点击）—— 合并必然改动其中一方的交互，属**回归风险**。
 * 故本轮只做「把零件搬出主文件」，**不动实现**；真正的合并需要单独一轮（并补交互测试）。
 *
 * 语义与拆分前逐行一致（仅移动代码 + 补齐 import）。
 */
export function PreviewSwitch({ on, onToggle }: { on: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label="实时预览"
      title={`${on ? '关闭实时预览' : '开启实时预览'}（⌘/Ctrl+Shift+P）`}
      onClick={onToggle}
      className="flex shrink-0 items-center gap-1.5 rounded-md px-1.5 py-0.5 text-[0.8571rem] text-on-surface-variant transition-colors hover:bg-surface-hover-high hover:text-on-surface"
    >
      <span>预览</span>
      <span
        className={`flex h-4 w-7 shrink-0 items-center rounded-full px-[1px] transition-colors ${
          on ? 'bg-primary' : 'bg-surface-container-high'
        }`}
      >
        <span
          className={`h-3 w-3 rounded-full bg-white shadow-sm transition-transform ${
            on ? 'translate-x-3' : 'translate-x-0'
          }`}
        />
      </span>
    </button>
  )
}

export function MentionHighlight({ label, query }: { label: string; query: string }) {
  const kw = query.trim()
  if (!kw) return <>{label}</>
  const idx = label.toLowerCase().indexOf(kw.toLowerCase())
  if (idx < 0) return <>{label}</>
  return (
    <>
      {label.slice(0, idx)}
      <span className="font-semibold text-primary">{label.slice(idx, idx + kw.length)}</span>
      {label.slice(idx + kw.length)}
    </>
  )
}

/** 悬浮卡片实体摘要（按提及类型），数据缺失（实体已删）显示「已失效」占位 */
export function MentionEntitySummary({
  type,
  eid,
  customers,
  todos,
  ledgers,
  projects,
  intimacyCfg,
  scoreRows,
}: {
  type: MentionType
  eid: string
  customers: Customer[]
  todos: Todo[]
  ledgers: Ledger[]
  projects: Project[]
  intimacyCfg: ReturnType<typeof useIntimacyConfig>
  /** 未手动设置档位的客户的算法入参（批次查询结果，Issue #108 健康分兜底） */
  scoreRows: Record<string, Parameters<typeof resolveIntimacyLevel>[2]>
}) {
  if (type === 'customer') {
    const c = customers.find((x) => x.id === eid)
    if (!c) return <EntityMissing name="客户" />
    // 健康分口径与详情/列表统一：未手动设置时由算法推断并用括号标注（Issue #108）
    const health = resolveHealthScoreDisplay(c, intimacyCfg, scoreRows[c.id] ?? null)
    return (
      <>
        <CardRow label="公司" value={c.company || '—'} />
        <CardRow label="职位" value={c.title || '—'} />
        <CardRow label="健康分" value={health.label} />
      </>
    )
  }
  if (type === 'todo') {
    const t = todos.find((x) => x.id === eid)
    if (!t) return <EntityMissing name="待办" />
    return (
      <>
        <CardRow label="状态" value={todoStatusLabel(t)} />
        <CardRow label="优先级" value={todoPriorityFullLabel(t.priority)} />
        <CardRow label="截止" value={t.dueAt ? dayjs(t.dueAt).format('YYYY-MM-DD') : '无'} />
      </>
    )
  }
  if (type === 'ledger') {
    const l = ledgers.find((x) => x.id === eid)
    if (!l) return <EntityMissing name="账本" />
    return (
      <>
        <CardRow label="币种" value={l.currency} />
        <CardRow label="期初余额" value={String(l.openingBalance)} />
        <CardRow label="封账周期" value={l.closingCycle} />
      </>
    )
  }
  const pj = projects.find((x) => x.id === eid)
  if (!pj) return <EntityMissing name="项目" />
  return (
    <>
      <CardRow
        label="状态"
        value={pj.status === 'archived' ? '已归档' : pj.status === 'paused' ? '已搁置' : '进行中'}
      />
      {pj.customerId && (
        <CardRow
          label="挂靠客户"
          value={customers.find((c) => c.id === pj.customerId)?.name ?? '—'}
        />
      )}
    </>
  )
}

export function CardRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-0.5">
      <span className="shrink-0 text-[0.7857rem] text-outline">{label}</span>
      <span className="min-w-0 truncate text-right text-[0.8571rem] text-on-surface">{value}</span>
    </div>
  )
}

export function EntityMissing({ name }: { name: string }) {
  return (
    <div className="flex items-center gap-1.5 text-[0.8571rem] text-outline">
      <Icon name="person_off" size={14} />原{name}已删除或不存在
    </div>
  )
}

export function SaveBadge({ state, at }: { state: SaveState; at: number }) {
  if (state === 'saving')
    return (
      <Chip tone="blue" icon="sync">
        保存中…
      </Chip>
    )
  if (state === 'dirty')
    return (
      <Chip tone="gray" icon="edit">
        编辑中…
      </Chip>
    )
  return (
    <Chip tone="green" icon="cloud_done">
      已保存 {dayjs(at).format('HH:mm')}
    </Chip>
  )
}