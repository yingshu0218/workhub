/**
 * 黑名单全局屏蔽 · 四场景消费点回归（缺陷 D15）
 *
 * 缺陷形状：`hideInSearch` / `excludeFromPicker` / `hideInTimeline` 三个开关
 * **定义了、持久化了、UI 可切换、有文案** —— 却**没有任何代码读取它们**
 * （全仓只出现在「接口定义 / 默认值 / 配置归一化 / UI 标签」四处）。
 * 于是开关能切、能存、刷新后还在，**打开后毫无可见后果**。
 * 这是本项目第三次「定义了却没接线」（前两次：D12 的 `todoPriorityWeight` 零调用点、
 * #34 的 `sortOrder` 只有读取无写入侧）。
 *
 * 本测试锁两层：
 *   ① 行为层：`filterBlacklisted` / `hiddenCustomerIds` 的语义（开关关闭直通且引用稳定、
 *      只滤 I7、场景之间互不串味）；
 *   ② **结构层（本条最关键）**：四个场景**各自**都要有真实消费点 ——
 *      按文件名单条断言，删掉任何一个消费面都会红。原判「通过」正是只在
 *      「开关能切换并保存」这两层取了证，没验「谁在读它」。
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  filterBlacklisted,
  hiddenCustomerIds,
  isBlacklistHidden,
  isCustomerBlacklisted,
} from '../intimacy'
import {
  DEFAULT_INTIMACY_CONFIG,
  type IntimacyLevel,
  type ModuleConfigIntimacy,
} from '@/db/types'

/**
 * 只带判定所需字段的客户桩。
 * `CustomerIntimacy` 的 `updatedAt` 是必填（手动档位的落章时间），桩里一并给出 ——
 * 少一个字段 `npm run build` 里的 tsc 会直接把构建打断（本轮真被拦下来一次）。
 */
const c = (id: string, level?: IntimacyLevel) => ({
  id,
  intimacy: level ? { level, updatedAt: 1_700_000_000_000 } : undefined,
})

const base = [
  c('a', undefined),
  c('b', 'T1'),
  c('c', 'T4'),
  c('d', 'I6'),
  c('e', 'I7'),
  c('f', 'I7'),
]

/** 只打开指定场景的配置（其余保持默认） */
const withScene = (
  scene: keyof ModuleConfigIntimacy['blacklist'],
  on = true,
): ModuleConfigIntimacy => ({
  ...DEFAULT_INTIMACY_CONFIG,
  blacklist: { ...DEFAULT_INTIMACY_CONFIG.blacklist, [scene]: on },
})

describe('① filterBlacklisted：开关关闭直通、开启只滤 I7', () => {
  it('开关关闭时**原样返回同一引用**（不是拷贝，保证 useMemo 依赖稳定）', () => {
    const cfg = withScene('hideInTimeline', false)
    const out = filterBlacklisted(base, cfg, 'hideInTimeline')
    expect(out).toBe(base)
  })

  it('开关打开时只滤掉 I7（I6 / 手动 T 档 / 未设置都不受影响）', () => {
    const cfg = withScene('hideInTimeline', true)
    const out = filterBlacklisted(base, cfg, 'hideInTimeline')
    expect(out.map((x) => x.id)).toEqual(['a', 'b', 'c', 'd'])
    expect(out).not.toBe(base)
  })

  it('场景之间互不串味：打开 A 场景不影响 B 场景', () => {
    const cfg = withScene('hideInSearch', true)
    expect(filterBlacklisted(base, cfg, 'hideInSearch')).toHaveLength(4)
    expect(filterBlacklisted(base, cfg, 'excludeFromPicker')).toBe(base)
    expect(filterBlacklisted(base, cfg, 'hideInTimeline')).toBe(base)
  })

  it('默认配置（只开图谱）下，搜索/选择器/时间线三个场景都直通', () => {
    for (const scene of ['hideInSearch', 'excludeFromPicker', 'hideInTimeline'] as const) {
      expect(filterBlacklisted(base, DEFAULT_INTIMACY_CONFIG, scene)).toBe(base)
    }
  })
})

describe('② hiddenCustomerIds：供按 id 命中过滤的消费面（选择器 / 搜索）', () => {
  it('开关关闭时返回**同一个空集合常量**（引用稳定，可进 useMemo 依赖）', () => {
    const cfg = withScene('excludeFromPicker', false)
    const a = hiddenCustomerIds(base, cfg, 'excludeFromPicker')
    const b = hiddenCustomerIds(base, cfg, 'excludeFromPicker')
    expect(a.size).toBe(0)
    expect(a).toBe(b) // 每次新建 Set 会让下游 useMemo 永远重算
  })

  it('开关打开时只含 I7 的 id', () => {
    const cfg = withScene('excludeFromPicker', true)
    expect([...hiddenCustomerIds(base, cfg, 'excludeFromPicker')].sort()).toEqual(['e', 'f'])
  })

  it('与 filterBlacklisted 同一判定口径（不会出现两套屏蔽结果）', () => {
    const cfg = withScene('hideInSearch', true)
    const bySet = hiddenCustomerIds(base, cfg, 'hideInSearch')
    const byFilter = filterBlacklisted(base, cfg, 'hideInSearch')
    expect(byFilter.every((x) => !bySet.has(x.id))).toBe(true)
    expect(base.length - byFilter.length).toBe(bySet.size)
  })
})

describe('③ 既有判定语义不变（回归）', () => {
  it('isCustomerBlacklisted 只认手动档位恰好为 I7', () => {
    expect(isCustomerBlacklisted({ intimacy: { level: 'I7', updatedAt: 1 } })).toBe(true)
    expect(isCustomerBlacklisted({ intimacy: { level: 'I6', updatedAt: 1 } })).toBe(false)
    expect(isCustomerBlacklisted(undefined)).toBe(false)
  })

  it('isBlacklistHidden = 黑名单 ∧ 该场景开关', () => {
    const black = { intimacy: { level: 'I7' as const, updatedAt: 1 } }
    expect(isBlacklistHidden(black, withScene('hideInSearch', true), 'hideInSearch')).toBe(true)
    expect(isBlacklistHidden(black, withScene('hideInSearch', false), 'hideInSearch')).toBe(false)
    expect(
      isBlacklistHidden(
        { intimacy: { level: 'T1', updatedAt: 1 } },
        DEFAULT_INTIMACY_CONFIG,
        'hideInSearch',
      ),
    ).toBe(false)
  })
})

describe('④【结构层】三个场景各自的消费点必须存在（D15 的形状锁）', () => {
  const SRC = join(process.cwd(), 'src')
  const read = (rel: string) => readFileSync(join(SRC, rel), 'utf8')

  /**
   * 场景 → 消费面文件清单。
   * 这份清单本身就是「黑名单四场景在哪些地方生效」的事实来源；删掉任一消费点即红。
   */
  const SCENE_CONSUMERS: Record<keyof ModuleConfigIntimacy['blacklist'], string[]> = {
    // ⚠️ 2026-10-14：「图谱隐藏」场景已随「健康分与画布解耦」删除（画布不再屏蔽任何客户），
    // 剩下三个场景都是面向「查找 / 录入」的，与展示无关。
    // 全局搜索：⌘K（UI）与 Agent 读工具（桥侧）两条入口
    hideInSearch: ['app/CommandPalette.tsx', 'agent/reads.ts'],
    // 单据选择器：流水 / 待办 / 项目三个表单 + 笔记 @ 提及 + Agent 消解器
    excludeFromPicker: [
      'modules/finance/TransactionFormDrawer.tsx',
      'modules/todo/TodoFormDrawer.tsx',
      'modules/projects/ProjectFormDrawer.tsx',
      'modules/notes/NoteEditorPage.tsx',
      'agent/resolver.ts',
    ],
    // 时间线：客户列表与「全部客户时间线」（档案页/单客户时间线刻意不受影响）
    hideInTimeline: ['modules/crm/CrmPage.tsx', 'modules/crm/AllTimelinesPage.tsx'],
  }

  it('每个场景都至少有一个消费点（禁止再出现「定义了却没接线」）', () => {
    for (const [scene, files] of Object.entries(SCENE_CONSUMERS)) {
      expect(files.length, `${scene} 没有任何消费面`).toBeGreaterThan(0)
    }
    expect(Object.keys(SCENE_CONSUMERS).sort()).toEqual(
      ['excludeFromPicker', 'hideInSearch', 'hideInTimeline'].sort(),
    )
  })

  it.each(Object.entries(SCENE_CONSUMERS))(
    '场景 %s 的每个消费面都真的引用了该开关名',
    (scene, files: string[]) => {
      const missing: string[] = []
      for (const f of files) {
        const text = read(f)
        if (!text.includes(scene)) missing.push(f)
      }
      expect(missing, `以下文件引用了场景名但没出现 "${scene}"：${missing.join(', ')}`).toEqual([])
    },
  )

  it.each(Object.entries(SCENE_CONSUMERS))(
    '场景 %s 的每个消费面都走统一入口（filterBlacklisted / hiddenCustomerIds / isBlacklistHidden）',
    (_scene, files: string[]) => {
      const missing: string[] = []
      for (const f of files) {
        const text = read(f)
        const usesEntry =
          text.includes('filterBlacklisted(') ||
          text.includes('hiddenCustomerIds(') ||
          text.includes('isBlacklistHidden(')
        if (!usesEntry) missing.push(f)
      }
      // buildGraph 用的正是 isBlacklistHidden；其余用新入口
      expect(missing, `未走统一入口：${missing.join(', ')}`).toEqual([])
    },
  )

  it('共享判定入口只此一处（禁止在别处再手写 I7 字面量判断）', () => {
    const offenders: string[] = []
    const walkFiles = [
      'app/CommandPalette.tsx',
      'agent/reads.ts',
      'agent/resolver.ts',
      'modules/finance/TransactionFormDrawer.tsx',
      'modules/todo/TodoFormDrawer.tsx',
      'modules/projects/ProjectFormDrawer.tsx',
      'modules/crm/CrmPage.tsx',
      'modules/crm/AllTimelinesPage.tsx',
    ]
    for (const f of walkFiles) {
      const text = read(f)
      text.split('\n').forEach((line, i) => {
        if (/^\s*(\/\/|\*|\/\*)/.test(line)) return
        // 允许出现 'I7' 的地方：注释、档位选项数组（表单/图例）、与判定无关的展示
        if (/'I7'/.test(line) && !/intimacy|level|档位|黑名单/.test(line)) {
          offenders.push(`${f}:${i + 1}  ${line.trim().slice(0, 80)}`)
        }
      })
    }
    expect(offenders).toEqual([])
  })
})
