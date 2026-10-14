import { useEffect, useRef, useState } from 'react'
import { Button, inputCls } from '@/design-system/ui'
import {
  DEFAULT_INTIMACY_CONFIG,
  INTIMACY_LEVELS,
  type IntimacyLevel,
  type ModuleConfigIntimacy,
} from '@/db/types'
import { saveIntimacyConfig, useIntimacyConfig } from '@/modules/crm/intimacy'
import { isIntimacyTrustLevel } from '@/db/types'
import { Section, Toggle } from './parts'

/**
 * 客户管理模块 · 健康分配置（原「亲密度」改名，Issue #108；Issue #86 迁入「功能配置」页）。
 * 承载 CRM·客户 的三个配置区（配置本体自设置页「数据管理」Tab 原样迁入，业务逻辑零改写；
 * Section / Toggle 容器抽到 parts.tsx，供后续模块配置面板复用）：
 * ① 健康分等级维护（7 档 key 固定不可增删，name/desc 可编辑，改名零迁移）
 * ② 黑名单全局屏蔽（开关矩阵；2026-10-14 起画布不再参与屏蔽，剩搜索/选择器/时间线三面）
 * ③ 算法兜底与权重（总开关 + 4 因子滑杆 + 切档阈值，保存时归一化与单调性校验）
 * 配置写 moduleConfigs（同步表 crm.intimacy），改动即时落库广播 moduleConfig:changed。
 */

export default function CrmIntimacyConfig() {
  const cfg = useIntimacyConfig()

  /**
   * 编辑草稿模型：`cfg`（useLiveQuery 的库值）是唯一真源。
   * 三个草稿为 null 时界面直接展示 cfg；非 null 表示「有未提交的编辑」。
   *
   * ⚠️ 切勿写成 `useState(cfg.xxx)`：首帧 useLiveQuery 尚未解析时 cfg 是
   * DEFAULT_INTIMACY_CONFIG，而 useState 的初值只在首次渲染生效 → 库值到达后界面
   * 永不更新，用户看到的权重与库内实际生效值长期不一致（功能测试 #22）。
   */
  const [levelsDraft, setLevelsDraft] = useState<Record<
    IntimacyLevel,
    { name: string; desc: string }
  > | null>(null)
  const [weightsDraft, setWeightsDraft] = useState<
    ModuleConfigIntimacy['algorithm']['weights'] | null
  >(null)
  const [thresholdsDraft, setThresholdsDraft] = useState<
    ModuleConfigIntimacy['algorithm']['thresholds'] | null
  >(null)
  const [saved, setSaved] = useState('')
  const [error, setError] = useState('')

  const levelsValue =
    levelsDraft ??
    (Object.fromEntries(cfg.levels.map((l) => [l.key, { name: l.name, desc: l.desc }])) as Record<
      IntimacyLevel,
      { name: string; desc: string }
    >)
  const weights = weightsDraft ?? cfg.algorithm.weights
  const thresholds = thresholdsDraft ?? cfg.algorithm.thresholds

  /**
   * 滑杆的「提交」发生在 onMouseUp/onTouchEnd/onKeyUp，需要拿到本次操作后的最新值，
   * 而 React 事件批处理下 state 未必已提交 → onChange 内同步写入 ref 兜底。
   */
  const weightsRef = useRef(weights)

  // 库值追平草稿后自动清草稿：保存成功的值随即成为新库值，界面无缝切回库值、无闪回。
  useEffect(() => {
    const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)
    if (weightsDraft && same(weightsDraft, cfg.algorithm.weights)) setWeightsDraft(null)
    if (thresholdsDraft && same(thresholdsDraft, cfg.algorithm.thresholds)) setThresholdsDraft(null)
    if (levelsDraft) {
      const fromCfg = Object.fromEntries(
        cfg.levels.map((l) => [l.key, { name: l.name, desc: l.desc }]),
      )
      if (same(levelsDraft, fromCfg)) setLevelsDraft(null)
    }
  }, [cfg, weightsDraft, thresholdsDraft, levelsDraft])

  function flash(msg: string) {
    setSaved(msg)
    setError('')
    setTimeout(() => setSaved(''), 2200)
  }

  async function saveLevels() {
    await saveIntimacyConfig({
      levels: INTIMACY_LEVELS.map((k) => ({ key: k, ...levelsValue[k]! })),
    })
    flash('健康分等级名称已保存')
  }

  async function resetLevels() {
    // 先把默认名写进草稿（界面即时反馈），再落库；落库后库值与草稿一致，effect 自动清草稿。
    setLevelsDraft(
      Object.fromEntries(
        DEFAULT_INTIMACY_CONFIG.levels.map((l) => [l.key, { name: l.name, desc: l.desc }]),
      ) as Record<IntimacyLevel, { name: string; desc: string }>,
    )
    await saveIntimacyConfig({ levels: DEFAULT_INTIMACY_CONFIG.levels })
    flash('已恢复默认等级名称')
  }

  async function saveBlacklist(patch: Partial<typeof cfg.blacklist>) {
    await saveIntimacyConfig({ blacklist: patch })
    flash('黑名单屏蔽开关已保存')
  }

  /**
   * 保存算法配置。`okMessage` 用于区分「普通保存」与「自动修正后保存」：
   * 自动修正的提示必须走 flash（成功态）而不是 error —— flash 内部会 setError('')，
   * 两者并用时前脚 setError 后脚就被 flash 清掉，用户只看到「已保存」而看不到「已归一化」。
   * （功能测试 #22 复核时自动化始终捕不到归一化提示，根因即此。）
   */
  async function saveAlgorithm(
    patch: {
      enabled?: boolean
      weights?: typeof weights
      thresholds?: typeof thresholds
    },
    okMessage = '算法兜底配置已保存',
  ) {
    await saveIntimacyConfig({ algorithm: patch })
    flash(okMessage)
  }

  function applyWeights(next: typeof weights) {
    const total = next.contact + next.finance + next.todo + next.project
    if (total === 100) {
      void saveAlgorithm({ weights: next })
      return
    }
    // 权重和≠100：等比归一化到 100（收敛稿边界；全 0 回退默认）
    if (total <= 0) {
      const d = DEFAULT_INTIMACY_CONFIG.algorithm.weights
      weightsRef.current = d
      setWeightsDraft(d)
      void saveAlgorithm({ weights: d }, '权重不可全为 0，已回退默认权重')
      return
    }
    const norm = (v: number) => Math.round((v / total) * 100)
    const normalized = {
      contact: norm(next.contact),
      finance: norm(next.finance),
      todo: norm(next.todo),
      project: norm(next.project),
    }
    const diff =
      100 - (normalized.contact + normalized.finance + normalized.todo + normalized.project)
    if (diff !== 0) normalized.contact += diff // 余数补偿，保证和恒为 100
    // 草稿改写为归一化结果：否则草稿停留在用户拖出的原值，永远追不平库值、界面不回正
    weightsRef.current = normalized
    setWeightsDraft(normalized)
    void saveAlgorithm({ weights: normalized }, '权重和≠100，已自动归一化保存')
  }

  function applyThresholds(next: typeof thresholds) {
    // 单调递减校验（收敛稿边界：T2>T3>T4，否则切档逻辑出 bug）—— 失败属「阻止保存」
    if (!(next.t2 > next.t3 && next.t3 > next.t4 && next.t4 >= 0 && next.t2 <= 100)) {
      setError('阈值需满足 T2 > T3 > T4（0~100）')
      setTimeout(() => setError(''), 2600)
      setThresholdsDraft(null) // 撤销本次编辑，回落库值
      return
    }
    void saveAlgorithm({ thresholds: next })
  }

  const weightRows: { key: keyof typeof weights; label: string; desc: string }[] = [
    { key: 'contact', label: '联系频率', desc: '近 90 天沟通次数（衰减加权）' },
    { key: 'finance', label: '金钱往来', desc: '关联流水的双向金额（对数化）' },
    { key: 'todo', label: '事项', desc: '活跃待办数 + 完成率加成' },
    { key: 'project', label: '关联项目', desc: '名下项目数（进行中双倍权重）' },
  ]

  return (
    <div className="space-y-4">
      {error && (
        <div className="rounded-lg bg-danger-container/60 px-4 py-2.5 text-[0.8929rem] font-medium text-danger">
          {error}
        </div>
      )}
      {saved && (
        <div className="rounded-lg bg-success-container/60 px-4 py-2.5 text-[0.8929rem] font-medium text-success">
          {saved}
        </div>
      )}

      {/* ① 健康分等级维护 */}
      <Section
        icon="favorite"
        title="健康分等级维护"
        desc="7 档固定槽位（T1~T5 信任轴 + I6/I7 隔离态）不可增删，仅名称与判据描述可编辑；改名零数据迁移"
      >
        <div className="space-y-2">
          {INTIMACY_LEVELS.map((k) => {
            const row = levelsValue[k]!
            const isolation = !isIntimacyTrustLevel(k)
            return (
              <div key={k} className="flex items-center gap-2">
                <span
                  className={`w-9 shrink-0 rounded px-1.5 py-1 text-center text-[0.7857rem] font-bold ${
                    isolation
                      ? 'bg-danger-container/60 text-danger'
                      : 'bg-primary-fixed/60 text-primary'
                  }`}
                  title={k}
                >
                  {k}
                </span>
                <input
                  className={`${inputCls} w-32`}
                  value={row.name}
                  maxLength={8}
                  placeholder={DEFAULT_INTIMACY_CONFIG.levels.find((l) => l.key === k)!.name}
                  onChange={(e) =>
                    setLevelsDraft({ ...levelsValue, [k]: { ...row, name: e.target.value } })
                  }
                />
                <input
                  className={inputCls}
                  value={row.desc}
                  placeholder={DEFAULT_INTIMACY_CONFIG.levels.find((l) => l.key === k)!.desc}
                  onChange={(e) =>
                    setLevelsDraft({ ...levelsValue, [k]: { ...row, desc: e.target.value } })
                  }
                />
              </div>
            )
          })}
        </div>
        <div className="mt-3 flex justify-end gap-2">
          <Button variant="ghost" icon="restart_alt" onClick={() => void resetLevels()}>
            恢复默认
          </Button>
          <Button icon="save" onClick={() => void saveLevels()}>
            保存等级名称
          </Button>
        </div>
      </Section>

      {/* ② 黑名单全局屏蔽 */}
      <Section
        icon="block"
        title="黑名单全局屏蔽"
        desc="黑名单（I7）在各功能面的屏蔽范围。关系画布不参与屏蔽（画布与健康分已解耦，谁都不会被画布隐藏）；档案页/关联区始终保留，不丢数据"
      >
        <div className="space-y-3">
          {(
            [
              { key: 'hideInSearch', label: '全局搜索屏蔽', desc: '⌘K 搜索与全局搜索结果中隐藏' },
              {
                key: 'excludeFromPicker',
                label: '单据选择器排除',
                desc: '新建流水/待办/沟通时客户选择器不可选',
              },
              {
                key: 'hideInTimeline',
                label: '时间线隐藏',
                desc: '客户列表与时间线中隐藏（仅档案直接访问可见）',
              },
            ] as const
          ).map((row) => (
            <div key={row.key} className="flex items-center justify-between gap-4">
              <div>
                <div className="text-[0.9286rem] font-medium">{row.label}</div>
                <div className="text-[0.8214rem] text-on-surface-variant">{row.desc}</div>
              </div>
              <Toggle
                checked={cfg.blacklist[row.key]}
                onChange={(v) => void saveBlacklist({ [row.key]: v })}
              />
            </div>
          ))}
        </div>
      </Section>

      {/* ③ 算法兜底与权重 */}
      <Section
        icon="tune"
        title="算法兜底与权重"
        desc="未手动设置健康分的客户由算法兜底分档；手动设置始终最优先。硬约束：算法最多推到 T2，永不给出 T1/I6/I7"
      >
        <div className="mb-4 flex items-center justify-between">
          <div>
            <div className="text-[0.9286rem] font-medium">算法兜底</div>
            <div className="text-[0.8214rem] text-on-surface-variant">
              关闭后未设置客户一律落「照面」档
            </div>
          </div>
          <Toggle
            checked={cfg.algorithm.enabled}
            onChange={(v) => void saveAlgorithm({ enabled: v })}
          />
        </div>
        <div className="space-y-3">
          {weightRows.map((row) => (
            <div key={row.key} className="flex items-center gap-3">
              <div className="w-40 shrink-0">
                <div className="text-[0.9286rem] font-medium">{row.label}</div>
                <div className="text-[0.7857rem] text-on-surface-variant">{row.desc}</div>
              </div>
              {/* 权重滑杆 step=1：归一化会产出 1% 精度的权重（如 58%），而 step=5 会把显示
                  对齐到最近的 5 倍数（58→60），造成「界面显示值 ≠ 实际保存值」；权重是占比，
                  1% 粒度也符合预期（功能测试 #22 复核发现） */}
              <input
                type="range"
                min={0}
                max={100}
                step={1}
                className="h-1.5 flex-1 accent-primary"
                value={weights[row.key]}
                onChange={(e) => {
                  const next = { ...weights, [row.key]: Number(e.target.value) }
                  weightsRef.current = next
                  setWeightsDraft(next)
                }}
                onMouseUp={() => applyWeights(weightsRef.current)}
                onTouchEnd={() => applyWeights(weightsRef.current)}
                onKeyUp={() => applyWeights(weightsRef.current)}
              />
              <span className="w-10 text-right text-[0.8929rem] font-semibold tabular-nums">
                {weights[row.key]}%
              </span>
            </div>
          ))}
        </div>
        <div className="mt-4 border-t border-outline-variant/40 pt-3">
          <div className="mb-2 text-[0.9286rem] font-medium">切档阈值（单调递减）</div>
          <div className="flex flex-wrap items-center gap-4">
            {(
              [
                { key: 't2', label: '≥ 信赖 T2' },
                { key: 't3', label: '≥ 合作 T3' },
                { key: 't4', label: '≥ 一般 T4' },
              ] as const
            ).map((row) => (
              <label key={row.key} className="flex items-center gap-2 text-[0.8929rem]">
                <span className="text-on-surface-variant">{row.label}</span>
                <input
                  type="number"
                  min={0}
                  max={100}
                  className={`${inputCls} w-16`}
                  value={thresholds[row.key]}
                  onChange={(e) =>
                    setThresholdsDraft({ ...thresholds, [row.key]: Number(e.target.value) })
                  }
                  onBlur={() => applyThresholds(thresholds)}
                  onKeyDown={(e) => {
                    // 回车即提交（number input 不会因回车失焦，显式 blur 触发上面的校验保存）
                    if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
                  }}
                />
              </label>
            ))}
            <span className="text-[0.7857rem] text-outline">低于 T4 阈值 → 照面 T5</span>
          </div>
        </div>
      </Section>
    </div>
  )
}
