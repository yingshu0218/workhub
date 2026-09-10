import { db } from '@/db/db'
import { archivedLast, fuzzyMatch, fuzzySort, isProjectArchived } from '@/shared/search'

/**
 * 实体消解器 —— agentOps P1 第 3 步（方案 §9.7 第 3 步 / §2.2 resolveEntity / §2.3）
 *
 * 职责：把自然语言里的名称/指代（「深蓝科技」「王五」「出方案那个」）消解成**真实实体 id**。
 * 写工具的关联入参只接受本模块产出的 id（§2.3：拒绝原始字符串关联）。
 *
 * 四条纪律（缺一不可，全部有对照测试）：
 * 1. **候选池只走活记录**（与 useCollection 同源过滤 `deleted`），不直接扫 Dexie 原始行——
 *    否则会把已软删实体捡回来当关联目标，重演「悬挂弱引用」历史根因；
 * 2. **按 id 去重后再数唯一**：`fuzzySort` 只是排序器**不做去重**，
 *    两家公司同名（label 相同、id 不同）会被数成「候选唯一」从而静默关联到错 id；
 * 3. **去重后唯一才自动消解**，命中数 > 阈值（或 >1）一律反问，宁可不猜（§四开放问题裁定）；
 * 4. **空/过短输入前置拦截**：`fuzzyMatch('', q)` 恒真、`fuzzySort` 空查询返回全量，
 *    不拦住就会把整张表塞给调用方（外部 Agent 形态下等于把业务全量数据送出）。
 *
 * Project 归档态处理：候选池组装时经 `isProjectArchived` 做字段映射后沉底——
 * `archivedLast` 只认 `archived?: boolean`，直接对 repo 原始 Project 调它**完全不生效**（§9.7 第 3 步注）。
 */

/**
 * 可消解实体类型（与名称/标题字段一一对应）。
 * `note` / `noteFolder`（P2 动作扩面新增）：笔记与文件夹也要能自然语言关联，
 * 否则「把这条笔记挪到 Q3 复盘目录」这类指令只能靠猜 id。
 */
export type ResolvableType =
  | 'customer'
  | 'project'
  | 'todo'
  | 'ledger'
  | 'habit'
  | 'note'
  | 'noteFolder'

/** 消解候选（投影白名单：不含实体全字段，不含 relations/附件，见 §2.2） */
export interface ResolveCandidate {
  id: string
  type: ResolvableType
  /** 主文案（客户：公司 · 姓名；其余：名称/标题） */
  label: string
  /** 次要文案（归档/已完成等标注，供 Agent 转述用户） */
  sub?: string
  /** 归档/已完成标记（沉底依据，同时让 Agent 知道这是「旧的」） */
  archived?: boolean
}

/** 消解结果：唯一 → resolved；零候选/多候选/被拦截 → ambiguous（须反问，禁止猜） */
export interface ResolveResult {
  status: 'resolved' | 'ambiguous'
  /** 可直接用于写工具的 id（仅 status==='resolved' 时存在） */
  id?: string
  /** 候选列表（≤MAX_CANDIDATES，超出已按匹配质量截断） */
  candidates: ResolveCandidate[]
  /** ambiguous 时给 Agent 转述用户的可操作说明 */
  reason?: string
}

/** 候选返回上限（§2.2 resolveEntity 上限 10） */
export const MAX_CANDIDATES = 10

/**
 * 命中数阈值：命中候选（去重后）超过此数即强制反问。
 * 子序列匹配对短查询过宽（单字「张」会命中极多），`fuzzyMatch` 本身不做收窄，
 * 故阈值必须由本层把守（P2-1 口径）。
 */
export const AMBIGUOUS_THRESHOLD = 5

/** 查询最小长度：空/过短输入前置拦截（fuzzyMatch 空查询恒真，会把全表当候选返回） */
export const MIN_QUERY_LENGTH = 1

/** 单次读取上限保护：候选池分页兜底，防极端数据量下把整表读进内存 */
const MAX_SCAN = 500

function normalizeQuery(query: string): string {
  return query.trim()
}

/**
 * 候选池组装：全部实体只投影 label/sub/archived，且只取活记录。
 * Project 侧显式做 `status → archived` 字段映射（收口于 `isProjectArchived`）。
 */
async function buildPool(type: ResolvableType): Promise<ResolveCandidate[]> {
  const alive = <T extends { id: string; deleted?: 0 | 1 }>(rows: T[]) =>
    rows.filter((r) => !r.deleted).slice(0, MAX_SCAN)

  switch (type) {
    case 'customer': {
      const rows = alive(await db.customers.limit(MAX_SCAN).toArray())
      return rows.map((c) => ({
        id: c.id,
        type,
        label: c.company ? `${c.company} · ${c.name}` : c.name,
        sub: c.title || undefined,
      }))
    }
    case 'project': {
      const rows = alive(await db.projects.limit(MAX_SCAN).toArray())
      return rows.map((p) => ({
        id: p.id,
        type,
        label: p.name,
        sub: p.status === 'archived' ? '已归档' : p.status === 'paused' ? '已搁置' : '进行中',
        // 字段映射收口：archivedLast 只认 archived?: boolean，Project 用 status 表达
        archived: isProjectArchived(p),
      }))
    }
    case 'todo': {
      const rows = alive(await db.todos.limit(MAX_SCAN).toArray())
      return rows.map((t) => ({
        id: t.id,
        type,
        label: t.title,
        sub: t.status === 'done' ? '已完成' : t.priority,
        archived: t.status === 'done',
      }))
    }
    case 'ledger': {
      const rows = alive(await db.ledgers.limit(MAX_SCAN).toArray())
      return rows.map((l) => ({ id: l.id, type, label: l.name, sub: l.currency }))
    }
    case 'habit': {
      const rows = alive(await db.habits.limit(MAX_SCAN).toArray())
      return rows.map((h) => ({ id: h.id, type, label: h.name, sub: h.category || undefined }))
    }
    case 'note': {
      const rows = alive(await db.notes.limit(MAX_SCAN).toArray())
      return rows.map((n) => ({
        id: n.id,
        type,
        label: n.title,
        sub: n.tags.length ? n.tags.map((t) => `#${t}`).join(' ') : undefined,
      }))
    }
    case 'noteFolder': {
      const rows = alive(await db.noteFolders.limit(MAX_SCAN).toArray())
      return rows.map((f) => ({ id: f.id, type, label: f.name }))
    }
  }
}

/** 去重：同 id 只保留首条（`fuzzySort` 只排序不去重，唯一性必须按 id 判） */
function dedupeById(items: ResolveCandidate[]): ResolveCandidate[] {
  const seen = new Set<string>()
  const out: ResolveCandidate[] = []
  for (const it of items) {
    if (seen.has(it.id)) continue
    seen.add(it.id)
    out.push(it)
  }
  return out
}

/**
 * 消解单个实体引用。
 *
 * 判定顺序：空/过短拦截 → 过滤（label 主匹配，sub 参与命中判定不参与排序）
 * → 按 id 去重 → 排序（匹配质量）→ 归档沉底 → 阈值反问。
 */
export async function resolveEntity(
  query: string,
  type: ResolvableType,
): Promise<ResolveResult> {
  const q = normalizeQuery(query)
  if (q.length < MIN_QUERY_LENGTH) {
    return {
      status: 'ambiguous',
      candidates: [],
      reason: '请提供要关联的实体名称（不能为空），或先列出候选让我确认',
    }
  }

  const pool = await buildPool(type)
  const matched = pool.filter((c) => fuzzyMatch(c.label, q) || (c.sub ? fuzzyMatch(c.sub, q) : false))
  // 去重后重数唯一 —— 同 label 不同 id 的重名实体不得被误判为「候选唯一」
  const unique = dedupeById(matched)

  if (unique.length === 0) {
    return { status: 'ambiguous', candidates: [], reason: `没有找到匹配「${q}」的${labelOfType(type)}，请确认名称或先创建` }
  }

  const sorted = archivedLast(fuzzySort(unique, (c) => c.label, q)).slice(0, MAX_CANDIDATES)

  // 去重后唯一 id 才静默消解；命中过宽（超阈值）一律反问，即使排序第一看着很像
  if (unique.length === 1) {
    return { status: 'resolved', id: unique[0].id, candidates: sorted }
  }
  const tooBroad = unique.length > AMBIGUOUS_THRESHOLD
  return {
    status: 'ambiguous',
    candidates: sorted,
    reason: tooBroad
      ? `「${q}」命中过多（${unique.length} 条），请补充更精确的名称`
      : `「${q}」匹配到 ${unique.length} 个${labelOfType(type)}，请选择具体是哪一个`,
  }
}

function labelOfType(type: ResolvableType): string {
  return {
    customer: '客户',
    project: '项目',
    todo: '待办',
    ledger: '账本',
    habit: '习惯',
    note: '笔记',
    noteFolder: '笔记文件夹',
  }[type]
}

/** 批量消解（多工具链用；任一歧义即整体 ambiguous，由调用方逐条反问） */
export async function resolveMany(
  queries: { query: string; type: ResolvableType; key: string }[],
): Promise<{ resolved: Record<string, string>; ambiguous: { key: string; result: ResolveResult }[] }> {
  const resolved: Record<string, string> = {}
  const ambiguous: { key: string; result: ResolveResult }[] = []
  for (const item of queries) {
    const r = await resolveEntity(item.query, item.type)
    if (r.status === 'resolved' && r.id) resolved[item.key] = r.id
    else ambiguous.push({ key: item.key, result: r })
  }
  return { resolved, ambiguous }
}
