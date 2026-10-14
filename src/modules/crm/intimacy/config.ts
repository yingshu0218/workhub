import { useMemo } from 'react'
import { db } from '@/db/db'
import { useQuery } from '@/queries/hooks'
import { newId } from '@/repositories'
import { syncEngine } from '@/sync/engine'
import { eventBus } from '@/shared/eventBus'
import {
  DEFAULT_INTIMACY_CONFIG,
  INTIMACY_CONFIG_ID,
  type IntimacyLevel,
  type ModuleConfig,
  type ModuleConfigIntimacy,
  type ModuleConfigBlacklist,
} from '@/db/types'

/**
 * 亲密度配置层（Issue #34 收敛稿）
 * moduleConfigs 表 crm.intimacy 记录（key 寻址全库一条），随同步多端一致——
 * 亲密度本身随 customers 记录同步，配置若存本地 settings 必然两端口径打架，故走同步表。
 * 读：缺省段位用 DEFAULT_INTIMACY_CONFIG 补齐（前向兼容，等价 settingsRepo.mergeSettings 范式）
 * 写：repository 事务盖章入队，写后广播 moduleConfig:changed 由消费端实时应用
 */

/** 深合并缺省值：存量/远端记录缺段位时逐层兜底（payload 是 unknown，需运行时校验形状） */
function mergeIntimacyPayload(raw: unknown): ModuleConfigIntimacy {
  const d = DEFAULT_INTIMACY_CONFIG
  const p = (raw ?? {}) as Partial<ModuleConfigIntimacy>
  const levels =
    Array.isArray(p.levels) && p.levels.length === d.levels.length
      ? p.levels.map((l, i) => ({
          key: d.levels[i]!.key,
          name: typeof l?.name === 'string' && l.name.trim() ? l.name : d.levels[i]!.name,
          desc: typeof l?.desc === 'string' ? l.desc : d.levels[i]!.desc,
        }))
      : d.levels
  const bl = (p.blacklist ?? {}) as Partial<ModuleConfigBlacklist>
  const alg = (p.algorithm ?? {}) as Partial<ModuleConfigIntimacy['algorithm']>
  const w = (alg.weights ?? {}) as Partial<ModuleConfigIntimacy['algorithm']['weights']>
  const th = (alg.thresholds ?? {}) as Partial<ModuleConfigIntimacy['algorithm']['thresholds']>
  return {
    levels,
    blacklist: {
      hideInSearch: bl.hideInSearch ?? d.blacklist.hideInSearch,
      excludeFromPicker: bl.excludeFromPicker ?? d.blacklist.excludeFromPicker,
      hideInTimeline: bl.hideInTimeline ?? d.blacklist.hideInTimeline,
    },
    algorithm: {
      enabled: alg.enabled ?? d.algorithm.enabled,
      weights: {
        contact: w.contact ?? d.algorithm.weights.contact,
        finance: w.finance ?? d.algorithm.weights.finance,
        todo: w.todo ?? d.algorithm.weights.todo,
        project: w.project ?? d.algorithm.weights.project,
      },
      thresholds: {
        t2: th.t2 ?? d.algorithm.thresholds.t2,
        t3: th.t3 ?? d.algorithm.thresholds.t3,
        t4: th.t4 ?? d.algorithm.thresholds.t4,
      },
    },
  }
}

/** 直读配置（非响应式场景：算法计算/过滤器等） */
export async function getIntimacyConfig(): Promise<ModuleConfigIntimacy> {
  const rec = (await db.moduleConfigs.get(INTIMACY_CONFIG_ID)) as ModuleConfig | undefined
  if (rec?.deleted) return DEFAULT_INTIMACY_CONFIG
  return mergeIntimacyPayload(rec?.payload)
}

/**
 * 响应式订阅配置（设置页/选择器/图谱图例实时刷新）
 *
 * ⚠️ 必须 useMemo 缓存返回值（2026-10-12 修复）：`mergeIntimacyPayload` 每次都构造**全新对象**
 * （含嵌套 levels/blacklist/algorithm），而它此前是「存过配置记录就每次渲染返回新引用」。
 * 消费方把它放进 `useEffect` / `useMemo` 依赖时会被打成**每帧重算**——最典型的受害者是
 * 客户关系画布：`useForceGraph` 依赖 intimacyCfg → 每次 tick 的 setState 引发重渲染 →
 * 新 cfg 引用 → 仿真被整体重建 → 布局永远收敛不了、`sim.on('end')` 不触发、以我为心的锚定失效。
 * 表现为「没配过健康分时正常、一旦在设置里存过配置画布就抽风」。这里按 `rec` 引用缓存，
 * 只有记录本身变化（真正改了配置）才产出新对象。
 */
export function useIntimacyConfig(): ModuleConfigIntimacy {
  const rec = useQuery<ModuleConfig | undefined>(
    async () => (await db.moduleConfigs.get(INTIMACY_CONFIG_ID)) as ModuleConfig | undefined,
    [],
  )
  return useMemo(
    () => (!rec || rec.deleted ? DEFAULT_INTIMACY_CONFIG : mergeIntimacyPayload(rec.payload)),
    [rec],
  )
}

/** 保存配置 patch：单事务读并写 + 同步入队，写后广播 moduleConfig:changed */
export async function saveIntimacyConfig(
  patch: {
    levels?: ModuleConfigIntimacy['levels']
    blacklist?: Partial<ModuleConfigIntimacy['blacklist']>
    algorithm?: {
      enabled?: boolean
      weights?: Partial<ModuleConfigIntimacy['algorithm']['weights']>
      thresholds?: Partial<ModuleConfigIntimacy['algorithm']['thresholds']>
    }
  },
): Promise<ModuleConfigIntimacy> {
  const now = Date.now()
  const merged = await db.transaction('rw', [db.moduleConfigs, db.syncQueue], async () => {
    const prev = (await db.moduleConfigs.get(INTIMACY_CONFIG_ID)) as ModuleConfig | undefined
    const base = mergeIntimacyPayload(prev?.payload)
    const next: ModuleConfigIntimacy = {
      levels: patch.levels ? mergeLevels(patch.levels) : base.levels,
      blacklist: { ...base.blacklist, ...(patch.blacklist ?? {}) },
      algorithm: {
        enabled: patch.algorithm?.enabled ?? base.algorithm.enabled,
        weights: { ...base.algorithm.weights, ...(patch.algorithm?.weights ?? {}) },
        thresholds: { ...base.algorithm.thresholds, ...(patch.algorithm?.thresholds ?? {}) },
      },
    }
    await db.moduleConfigs.put({
      id: INTIMACY_CONFIG_ID,
      payload: next,
      updatedAt: now,
      rev: (prev?.rev ?? 0) + 1,
      deleted: 0 as const,
    } as ModuleConfig)
    await db.syncQueue.add({
      table: 'moduleConfigs',
      recordId: INTIMACY_CONFIG_ID,
      op: 'upsert',
      createdAt: now,
    })
    return next
  })
  syncEngine.requestSync()
  eventBus.emit('moduleConfig:changed', { key: INTIMACY_CONFIG_ID })
  return merged
}

/** levels 行编辑校验：key 顺序锁定不可增删，name 空白回退默认名 */
function mergeLevels(rows: ModuleConfigIntimacy['levels']): ModuleConfigIntimacy['levels'] {
  const d = DEFAULT_INTIMACY_CONFIG
  return d.levels.map((def) => {
    const row = rows.find((r) => r.key === def.key)
    return {
      key: def.key,
      name: row && row.name.trim() ? row.name.trim() : def.name,
      desc: row && typeof row.desc === 'string' ? row.desc : def.desc,
    }
  })
}

/** 新建配置记录 id（若未来每模块多条时复用 newId 范式；当前 crm.intimacy 固定 key 寻址） */
export const newModuleConfigId = () => newId('mcfg')

/** 某客户按等级 key 取显示名（找不到时回退等级 key 本身，防配置脏数据破 UI） */
export function intimacyLevelName(cfg: ModuleConfigIntimacy, level: IntimacyLevel): string {
  return cfg.levels.find((l) => l.key === level)?.name ?? level
}
