import type { Customer, IntimacyLevel, ModuleConfigIntimacy } from '@/db/types'
import { intimacyLevelName, resolveIntimacyLevel } from './intimacy'

/**
 * 健康分展示口径收口（Issue #108 审计整改）。
 *
 * 背景：原「亲密度」改名「健康分」并移除手动 healthScore 后，健康分只剩一个来源
 * （`customer.intimacy` 手动 7 档 → 未设置走算法兜底）。但详情页走算法兜底、
 * 列表/鱼骨/图谱卡缺全量投影只显示「未设置」，同一概念两种呈现，容易被当成 bug。
 *
 * 约定（用户拍板）：**手动档位直接显示；未手动设置时由算法推断的档位用括号包裹**，
 * 形如 `T2 信赖（算法）`，一眼区分「人定的」和「算出来的」，杜绝两个页面口径打架。
 */
export interface HealthScoreDisplay {
  /** 是否手动设置（false = 算法推断） */
  manual: boolean
  /** 解析出的档位 key（算法兜底时也有值，档位名随配置可变故同时给出 key） */
  levelKey: IntimacyLevel
  /** 档位名（按配置取名，手动/算法一致口径，不含括号） */
  levelName: string
  /** 展示文本：手动档位原样；算法/默认档位加括号并标注来源，如 `T2 信赖（算法）` */
  label: string
  /** 色板：手动 I6/I7 隔离态红、手动信任轴蓝、未手动灰 */
  color: string
}

/**
 * 健康分展示口径（各页面唯一实现，禁止在组件里另写一套）。
 * @param customer 客户记录（只需 intimacy 字段）
 * @param cfg 健康分配置
 * @param scoreInput 算法入参；拿不到全量投影时传 null（此时按配置默认基线档位兜底）
 */
export function resolveHealthScoreDisplay(
  customer: Pick<Customer, 'intimacy'>,
  cfg: ModuleConfigIntimacy,
  scoreInput: Parameters<typeof resolveIntimacyLevel>[2] = null,
): HealthScoreDisplay {
  const { level, source } = resolveIntimacyLevel(customer, cfg, scoreInput)
  const name = intimacyLevelName(cfg, level)
  const manual = source === 'manual'
  return {
    manual,
    levelKey: level,
    levelName: name,
    // 未手动设置 → 括号括起并标「算法」，示意这个档位是算出来的而不是人定的
    label: manual ? name : `${name}（算法）`,
    color: manual ? (level === 'I7' ? '#ba1a1a' : '#004ac6') : '#8a94a6',
  }
}
