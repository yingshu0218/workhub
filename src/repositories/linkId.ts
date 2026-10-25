import { sha256ToBase36_15 } from '@/sync/remoteNormalize'
import type { LinkEndpointTable, LinkKind, LinkMeta } from '@/db/types'

/**
 * link id 纯函数层（零 storage/db 运行时依赖）。
 *
 * 为什么单独成文件而不是放 links.ts：db.ts 的 Dexie upgrade（v15 旧关联字段迁移）
 * 也要算确定性 id —— links.ts 依赖 `@/storage`（→ browser.ts → db 实例），db.ts 再引它
 * 会构成「db → storage → db」运行时循环。本文件只依赖纯函数与类型，任何层可安全引入
 * （remoteNormalize 同理零运行时依赖，见其头注释）。
 */

/** 端点输入形态（与 Link 的平铺字段同构） */
export interface LinkEndpoint {
  type: LinkEndpointTable
  id: string
}

/**
 * 对称关系的 canonical 排序：kind='relation' 时按端点 id 字典序定 from/to ——
 * 任一端、任一设备发起都得到同一条记录（方向本无业务含义，今日 relations 是双侧镜像）。
 * 其余 kind 保持调用方给出的方向（from = 主动方/容器，to = 被指向方，方案 §2.3）。
 */
export function canonicalEndpoints(
  from: LinkEndpoint,
  to: LinkEndpoint,
  kind: LinkKind,
): [LinkEndpoint, LinkEndpoint] {
  if (kind !== 'relation') return [from, to]
  return from.id <= to.id ? [from, to] : [to, from]
}

/**
 * 同端点对同 kind 的多条语义区分（仅 relation 用）：label 参与 id 判重 ——
 * 同一对客户可保留多条不同语义关系（Issue #39 条目级去重口径），同语义则判重为一条。
 */
function discriminator(kind: LinkKind, meta?: LinkMeta): string {
  if (kind !== 'relation') return ''
  return `${meta?.label ?? ''}#${meta?.category ?? ''}`
}

/**
 * 确定性 link id：`lk-` + sha256ToBase36_15(seed)。
 * 同输入恒同 id → 重复建联幂等；双端离线各建同一关联时 LWW 直接合流、不产生重复
 * （先例：habitLogId 确定性打卡 id、同步层 localId→pbId 映射，hash 助手同一份）。
 * seed 用 `|` 分隔：端点 id 本身可含 `:`（newId 产物），hash 输入不解析、无歧义。
 */
export function buildLinkId(
  from: LinkEndpoint,
  to: LinkEndpoint,
  kind: LinkKind,
  meta?: LinkMeta,
): string {
  const [f, t] = canonicalEndpoints(from, to, kind)
  return `lk-${sha256ToBase36_15(`${f.type}:${f.id}|${t.type}:${t.id}|${kind}|${discriminator(kind, meta)}`)}`
}

// ─────────────────────── 旧关联字段 → links（v15 升级 + pull 侧归一化共用的单一映射） ───────────────────────

/**
 * 已完成「旧字段 → links」迁移的表（迁移族按 Phase 2 逐族扩大：attachments →
 * notes.mentions → transactions 数组 → customers.relations）。
 *
 * 这份清单是**代码所有权声明**：清单内的表，本地行不再持有旧关联键（upgrade 就地清、
 * pull 合并前剥）、旧关联只经 links 读写；清单外的表维持旧字段读写不动。
 * v15 upgrade 与 mergeRemote 的 strip/derive 都以它为闸门，逐族提交时只改这一处。
 */
export const MIGRATED_LINK_TABLES: ReadonlySet<string> = new Set([
  'attachments',
  'notes',
  'transactions',
  'customers',
])

/** 各表要剥掉的旧关联字段键（服务端列保留供老客户端降级，本地行不再落这些键） */
export const LEGACY_LINK_FIELDS: Record<string, readonly string[]> = {
  transactions: ['customerId', 'todoId', 'projectId', 'customerIds', 'todoIds', 'projectIds'],
  notes: ['mentions', 'backlinks'],
  customers: ['relations'],
  attachments: ['refType', 'refId'],
}

/** 就地剥掉旧关联键；不在迁移族内的表是 no-op（防止误伤未迁移族的读取方） */
export function stripLegacyLinkFields(table: string, rec: Record<string, unknown>): void {
  if (!MIGRATED_LINK_TABLES.has(table)) return
  for (const key of LEGACY_LINK_FIELDS[table] ?? []) delete rec[key]
}

/** 旧形态关联的 link 描述（端点存活性由调用方在落 link 前校验） */
export interface LegacyLinkSpec {
  from: LinkEndpoint
  to: LinkEndpoint
  kind: LinkKind
  meta?: LinkMeta
  createdAt?: number
}

const MENTION_TARGET: Record<string, LinkEndpointTable> = {
  customer: 'customers',
  todo: 'todos',
  ledger: 'ledgers',
  project: 'projects',
}

function idList(v: unknown): string[] {
  if (typeof v === 'string' && v) return [v]
  if (!Array.isArray(v)) return []
  return v.filter((x): x is string => typeof x === 'string' && !!x)
}

/**
 * 从旧形态关联字段提取 link 描述（四族统一入口：transactions 数组与旧单值 /
 * notes.mentions / customers.relations / attachments.refType）。纯函数、只读传入记录。
 * 同一记录只对「迁移族内」的表返回结果 —— 未迁移族的旧字段仍由原读写路径持有。
 */
export function legacyLinkSpecs(table: string, rec: Record<string, unknown>): LegacyLinkSpec[] {
  if (!MIGRATED_LINK_TABLES.has(table)) return []
  const rid = typeof rec.id === 'string' ? rec.id : ''
  if (!rid) return []
  const createdAt = typeof rec.createdAt === 'number' ? rec.createdAt : undefined

  if (table === 'transactions') {
    // 旧单值键（v11 前）与数组键并存归一（与 v11 upgrade 同口径：数组优先、单值兜底）
    const out: LegacyLinkSpec[] = []
    const from = { type: 'transactions' as const, id: rid }
    const pairs = [
      { field: 'customerIds', single: 'customerId', target: 'customers' as const },
      { field: 'todoIds', single: 'todoId', target: 'todos' as const },
      { field: 'projectIds', single: 'projectId', target: 'projects' as const },
    ]
    for (const p of pairs) {
      const ids = idList(rec[p.field]).length > 0 ? idList(rec[p.field]) : idList(rec[p.single])
      for (const id of new Set(ids)) {
        out.push({ from, to: { type: p.target, id }, kind: 'related', createdAt })
      }
    }
    return out
  }

  if (table === 'notes') {
    const out: LegacyLinkSpec[] = []
    const mentions = Array.isArray(rec.mentions) ? rec.mentions : []
    for (const m of mentions) {
      if (!m || typeof m !== 'object') continue
      const { type, id, label } = m as { type?: unknown; id?: unknown; label?: unknown }
      const target = MENTION_TARGET[typeof type === 'string' ? type : '']
      if (!target || typeof id !== 'string' || !id) continue
      out.push({
        from: { type: 'notes', id: rid },
        to: { type: target, id },
        kind: 'mention',
        ...(typeof label === 'string' && label ? { meta: { label } } : {}),
        createdAt,
      })
    }
    return out
  }

  if (table === 'customers') {
    const out: LegacyLinkSpec[] = []
    const rels = Array.isArray(rec.relations) ? rec.relations : []
    for (const r of rels) {
      if (!r || typeof r !== 'object') continue
      const { targetId, label, category } = r as {
        targetId?: unknown
        label?: unknown
        category?: unknown
      }
      if (typeof targetId !== 'string' || !targetId || targetId === rid) continue
      const meta: LinkMeta = { label: typeof label === 'string' ? label : '' }
      if (typeof category === 'string' && category) {
        meta.category = category as LinkMeta['category']
      }
      out.push({
        from: { type: 'customers', id: rid },
        to: { type: 'customers', id: targetId },
        kind: 'relation',
        meta,
        createdAt,
      })
    }
    return out
  }

  if (table === 'attachments') {
    if (rec.refType === 'transaction' && typeof rec.refId === 'string' && rec.refId) {
      return [
        {
          from: { type: 'transactions', id: rec.refId },
          to: { type: 'attachments', id: rid },
          kind: 'attachment',
          createdAt,
        },
      ]
    }
    return []
  }

  return []
}
