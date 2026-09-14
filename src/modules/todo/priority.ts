/**
 * 待办优先级 —— 四档「重要 × 紧急」（Issue #148 后续）
 *
 * 旧口径 P1/P2/P3 只表达「紧急程度」，表达不了「重要但不紧急」这类
 * 必须排进计划、却不该被当成救火的事项。改为四象限：
 *
 * | 档位 | 含义 | 重要 | 紧急 |
 * |---|---|---|---|
 * | `high` 高 | 重要紧急 —— 立刻做 | ✅ | ✅ |
 * | `mid`  中 | 重要不紧急 —— 排进计划 | ✅ | ❌ |
 * | `low`  低 | 不重要紧急 —— 能交就交 | ❌ | ✅ |
 * | `none` 无 | 不重要不紧急 —— 有空再说 | ❌ | ❌ |
 *
 * 兼容（存量 P1/P2/P3 数据 + 已分发的 Agent 工具契约）：
 * - 读：`normalizeTodoPriority` 把旧档映射为 `P1→high / P2→mid / P3→low`，未知值兜底 `mid`；
 * - 写：Agent 侧入参仍接受 `P1/P2/P3`（别名），落库统一写新档位。
 *
 * 展示与判定一律走本模块，禁止各模块内联 `priority === 'high' ? …` 三元。
 */
import type { Todo } from '@/db/types'

export const TODO_PRIORITY_LEVELS = ['high', 'mid', 'low', 'none'] as const
export type TodoPriority = (typeof TODO_PRIORITY_LEVELS)[number]

/** 旧档位别名（存量数据 + Agent 已分发契约），仅用于读侧归一化与写侧入参兼容 */
export const LEGACY_PRIORITY_ALIAS: Record<string, TodoPriority> = {
  P1: 'high',
  P2: 'mid',
  P3: 'low',
}

export interface PriorityMeta {
  /** 中文档位名 */
  label: string
  /** 象限示意（重要紧急 / 重要不紧急 / 不重要紧急 / 不重要不紧急） */
  quadrant: string
  /** 一句话行动指引，用于下拉说明与行内提示 */
  hint: string
  /** 设计系统 Chip 色板 */
  tone: 'red' | 'amber' | 'blue' | 'gray'
  /** 排序权重（越大越优先） */
  weight: number
}

export const TODO_PRIORITY_META: Record<TodoPriority, PriorityMeta> = {
  high: {
    label: '高',
    quadrant: '重要紧急',
    hint: '立刻做：救火与关键节点，别排期',
    tone: 'red',
    weight: 100,
  },
  mid: {
    label: '中',
    quadrant: '重要不紧急',
    hint: '排进计划：长期价值最高的一档',
    tone: 'amber',
    weight: 75,
  },
  low: {
    label: '低',
    quadrant: '不重要紧急',
    hint: '能交就交：催得急，但价值有限',
    tone: 'blue',
    weight: 55,
  },
  none: {
    label: '无',
    quadrant: '不重要不紧急',
    hint: '有空再说：不催办，不占今日日程',
    tone: 'gray',
    weight: 30,
  },
}

/**
 * 新建待办缺省档位（Issue #148 最新口径：**白色卡片「无」为默认**）。
 *
 * 四档卡片里「无 / 不重要不紧急」是白色，也是表单的初始选中档 —— 用户没表态就按
 * 「不催办、不占今日日程」处理，需要强调时再显式升到 高/中/低，
 * 避免默认给「中」把一堆随手记的事项都排进计划。
 */
export const DEFAULT_TODO_PRIORITY: TodoPriority = 'none'

/**
 * 读侧归一化：兼容存量 P1/P2/P3 与未知值。
 *
 * ⚠️ 未知值仍兜底「中」而不是缺省档「无」：读侧兜的是**脏数据**，
 * 语义上应保持「中性、需关注」，不能因为某个字段写坏了就把历史事项降级成「有空再说」。
 * 缺省档只作用于**新建**（写侧），两者刻意不同源。
 */
const UNKNOWN_PRIORITY_FALLBACK: TodoPriority = 'mid'

/** 读侧归一化实现（写侧缺省用 `DEFAULT_TODO_PRIORITY`，读侧兜底用 UNKNOWN_PRIORITY_FALLBACK） */
export function normalizeTodoPriority(raw: unknown): TodoPriority {
  if (typeof raw === 'string') {
    if ((TODO_PRIORITY_LEVELS as readonly string[]).includes(raw)) return raw as TodoPriority
    const alias = LEGACY_PRIORITY_ALIAS[raw]
    if (alias) return alias
  }
  return UNKNOWN_PRIORITY_FALLBACK
}

/** 写侧归一化：Agent 入参 `P1` → `high`，已是新档位则原样返回 */
export function toTodoPriority(raw: unknown): TodoPriority {
  return normalizeTodoPriority(raw)
}

/** 中文档位名（行内 Chip / 悬浮卡 / 时间轴） */
export function todoPriorityLabel(raw: unknown): string {
  return TODO_PRIORITY_META[normalizeTodoPriority(raw)].label
}

/**
 * 象限全称（示例：「高 · 重要紧急」）。
 * 用于需要一眼看懂语义的位置（下拉选项、悬浮摘要），列表行只用 label 保持紧凑。
 */
export function todoPriorityFullLabel(raw: unknown): string {
  const m = TODO_PRIORITY_META[normalizeTodoPriority(raw)]
  return `${m.label} · ${m.quadrant}`
}

/** Chip 色板 */
export function todoPriorityTone(raw: unknown): PriorityMeta['tone'] {
  return TODO_PRIORITY_META[normalizeTodoPriority(raw)].tone
}

/** 排序权重 */
export function todoPriorityWeight(raw: unknown): number {
  return TODO_PRIORITY_META[normalizeTodoPriority(raw)].weight
}

/** 是否高优先级（原 P1 口径的「紧急标记」收口点） */
export function isHighPriority(t: Pick<Todo, 'priority'>): boolean {
  return normalizeTodoPriority(t.priority) === 'high'
}

/**
 * 档位比较器（缺陷 D12 / 用例 #158）：高 → 中 → 低 → 无。
 *
 * 返回负数表示 a 应排在 b 之前（`Array.prototype.sort` 约定）。
 * 只比档位、不比时间 —— 同档位内的次序由调用方叠加二级比较器决定（见 `sortTodosByPriority`）。
 * 归一化在读侧完成，因此存量 `P1/P2/P3` 与写坏的字段值都能正确落位。
 */
export function compareTodoPriority(
  a: Pick<Todo, 'priority'>,
  b: Pick<Todo, 'priority'>,
): number {
  return todoPriorityWeight(b.priority) - todoPriorityWeight(a.priority)
}

/**
 * 待办列表两级排序（缺陷 D12 / 用例 #158）：**档位优先，创建时间兜底**。
 *
 * 为什么不是「纯时间序」：`high` 档的语义就是「立刻做，别排期」，若被一条后建的
 * `none` 档压在上面，档位选择在列表上就没有任何可见后果（用户会认为档位没生效）。
 *
 * 为什么不是「纯档位序」：同档位内必须保持稳定可预期的次序，否则每次读库顺序抖动、
 * 同一档位的事项看起来会「自己换位置」。用创建时间兜底最稳，且保留用户已有的
 * 升序 / 降序切换（该按钮现在是**同档位内**的时间轴方向）。
 *
 * 返回新数组，不改动入参（`useMemo` 依赖的源数组不可被原地排序）。
 */
export function sortTodosByPriority<T extends Pick<Todo, 'priority' | 'createdAt'>>(
  items: readonly T[],
  dir: 'asc' | 'desc' = 'asc',
): T[] {
  const byCreatedAt = (a: T, b: T) => {
    const d = (a.createdAt ?? 0) - (b.createdAt ?? 0)
    return dir === 'asc' ? d : -d
  }
  return [...items].sort((a, b) => compareTodoPriority(a, b) || byCreatedAt(a, b))
}

/** 高优先级筛选 Chip 的选中判定（列表行 / 兜底切换共用） */
export function matchesPriorityFilter(raw: unknown, filter: TodoPriority | null): boolean {
  if (!filter) return true
  return normalizeTodoPriority(raw) === filter
}

/**
 * 卡片式档位色板（Issue #148：优先级改「直接选择」的卡片样式）。
 *
 * 与行内 Chip 的 `tone`（Material 容器色）不同，卡片需要**明确边界 + 可辨识块面**，
 * 因此单独给一套卡片色：红 = 高、橙 = 中、蓝 = 低、白 = 无（默认档）。
 *
 * - `card`：未选中态（淡边框 + 淡底，悬停加深）；
 * - `active`：选中态（同色实描边 + 外环，块面更实）；
 * - `swatch`：卡片左上角色块（小圆点），保证浅色底上四档一眼可分。
 *
 * 「无」档用 `surface-container-lowest`（浅色下即白色）而非 `bg-white`：
 * 深色模式必须跟着翻转，写死白色会在深色下刺眼。
 * `swatch` 用 `outline` 而非 `gray`，深色下仍可见。
 */
export const TODO_PRIORITY_CARD_STYLE: Record<
  TodoPriority,
  { card: string; active: string; swatch: string }
> = {
  high: {
    card: 'border-danger/25 bg-danger-container/40 hover:border-danger/50',
    active: 'border-danger bg-danger-container/70 ring-2 ring-danger/25',
    swatch: 'bg-danger',
  },
  mid: {
    card: 'border-warning/25 bg-warning-container/45 hover:border-warning/50',
    active: 'border-warning bg-warning-container/70 ring-2 ring-warning/25',
    swatch: 'bg-warning',
  },
  low: {
    card: 'border-primary/20 bg-primary-fixed/45 hover:border-primary/45',
    active: 'border-primary bg-primary-fixed/70 ring-2 ring-primary/20',
    swatch: 'bg-primary',
  },
  none: {
    card: 'border-outline-variant/60 bg-surface-container-lowest hover:border-outline/70',
    active: 'border-outline bg-surface-container-lowest ring-2 ring-outline/20',
    swatch: 'bg-outline',
  },
}
