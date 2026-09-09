import { useState } from 'react'
import { Icon } from '@/design-system/Icon'
import { Button, Card, inputCls } from '@/design-system/ui'
import { DEFAULT_INTIMACY_CONFIG, INTIMACY_LEVELS, type IntimacyLevel } from '@/db/types'
import { saveIntimacyConfig, useIntimacyConfig } from '@/modules/crm/intimacy'
import { isIntimacyTrustLevel } from '@/db/types'

/**
 * 「数据管理」设置页（Issue #34 收敛稿）：集中管理各功能模块的自定义配置。
 * 本期承载 CRM·客户 的三个配置区：
 * ① 亲密度等级维护（7 档 key 固定不可增删，name/desc 可编辑，改名零迁移）
 * ② 黑名单全局屏蔽（开关矩阵，默认只开图谱隐藏，副作用渐进开放）
 * ③ 算法兜底与权重（总开关 + 4 因子滑杆 + 切档阈值，保存时归一化与单调性校验）
 * 配置写 moduleConfigs（同步表），改动即时落库广播 moduleConfig:changed。
 */

function Section({
  icon,
  title,
  desc,
  children,
}: {
  icon: string
  title: string
  desc: string
  children: React.ReactNode
}) {
  return (
    <Card className="p-6">
      <div className="mb-4 flex items-center gap-2.5">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary-fixed text-primary">
          <Icon name={icon} size={18} />
        </div>
        <div className="flex-1">
          <h3 className="text-[1.0357rem] font-semibold">{title}</h3>
          <p className="mt-0.5 text-[0.8214rem] text-on-surface-variant">{desc}</p>
        </div>
      </div>
      {children}
    </Card>
  )
}

function Toggle({
  checked,
  onChange,
  disabled,
}: {
  checked: boolean
  onChange: (v: boolean) => void
  disabled?: boolean
}) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      className={`relative h-6 w-11 shrink-0 rounded-full transition-colors disabled:opacity-40 ${
        checked ? 'bg-primary' : 'bg-outline-variant'
      }`}
      onClick={() => onChange(!checked)}
    >
      <span
        className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${
          checked ? 'left-[22px]' : 'left-0.5'
        }`}
      />
    </button>
  )
}

export default function DataManagementTab() {
  const cfg = useIntimacyConfig()
  const [editingLevels, setEditingLevels] = useState<Record<IntimacyLevel, { name: string; desc: string }>>(
    () =>
      Object.fromEntries(cfg.levels.map((l) => [l.key, { name: l.name, desc: l.desc }])) as Record<
        IntimacyLevel,
        { name: string; desc: string }
      >,
  )
  const [weights, setWeights] = useState(cfg.algorithm.weights)
  const [thresholds, setThresholds] = useState(cfg.algorithm.thresholds)
  const [saved, setSaved] = useState('')
  const [error, setError] = useState('')

  function flash(msg: string) {
    setSaved(msg)
    setError('')
    setTimeout(() => setSaved(''), 2200)
  }

  async function saveLevels() {
    await saveIntimacyConfig({ levels: INTIMACY_LEVELS.map((k) => ({ key: k, ...editingLevels[k]! })) })
    flash('亲密度等级名称已保存')
  }

  async function resetLevels() {
    setEditingLevels(
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

  async function saveAlgorithm(patch: {
    enabled?: boolean
    weights?: typeof weights
    thresholds?: typeof thresholds
  }) {
    await saveIntimacyConfig({ algorithm: patch })
    flash('算法兜底配置已保存')
  }

  function applyWeights(next: typeof weights) {
    setWeights(next)
    const total = next.contact + next.finance + next.todo + next.project
    if (total === 100) {
      void saveAlgorithm({ weights: next })
      return
    }
    // 保存时归一化到 100（收敛稿边界：权重和≠100 时等比归一，全 0 回退默认并提示）
    if (total <= 0) {
      const d = DEFAULT_INTIMACY_CONFIG.algorithm.weights
      setWeights(d)
      void saveAlgorithm({ weights: d })
      setError('权重不可全为 0，已回退默认权重')
      setTimeout(() => setError(''), 2600)
      return
    }
    const norm = (v: number) => Math.round((v / total) * 100)
    const normalized = {
      contact: norm(next.contact),
      finance: norm(next.finance),
      todo: norm(next.todo),
      project: norm(next.project),
    }
    const diff = 100 - (normalized.contact + normalized.finance + normalized.todo + normalized.project)
    if (diff !== 0) normalized.contact += diff // 余数补偿，保证和恒为 100
    setWeights(normalized)
    void saveAlgorithm({ weights: normalized })
    setError('权重和≠100，已自动归一化保存')
    setTimeout(() => setError(''), 2600)
  }

  function applyThresholds(next: typeof thresholds) {
    // 单调递减校验（收敛稿边界：T2>T3>T4，否则切档逻辑出 bug）
    if (!(next.t2 > next.t3 && next.t3 > next.t4 && next.t4 >= 0 && next.t2 <= 100)) {
      setError('阈值需满足 T2 > T3 > T4（0~100）')
      setTimeout(() => setError(''), 2600)
      setThresholds(thresholds)
      return
    }
    setThresholds(next)
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

      {/* ① 亲密度等级维护 */}
      <Section
        icon="favorite"
        title="亲密度等级维护 · CRM 客户"
        desc="7 档固定槽位（T1~T5 信任轴 + I6/I7 隔离态）不可增删，仅名称与判据描述可编辑；改名零数据迁移"
      >
        <div className="space-y-2">
          {INTIMACY_LEVELS.map((k) => {
            const row = editingLevels[k]!
            const isolation = !isIntimacyTrustLevel(k)
            return (
              <div key={k} className="flex items-center gap-2">
                <span
                  className={`w-9 shrink-0 rounded px-1.5 py-1 text-center text-[0.7857rem] font-bold ${
                    isolation ? 'bg-danger-container/60 text-danger' : 'bg-primary-fixed/60 text-primary'
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
                    setEditingLevels((m) => ({ ...m, [k]: { ...row, name: e.target.value } }))
                  }
                />
                <input
                  className={inputCls}
                  value={row.desc}
                  placeholder={DEFAULT_INTIMACY_CONFIG.levels.find((l) => l.key === k)!.desc}
                  onChange={(e) =>
                    setEditingLevels((m) => ({ ...m, [k]: { ...row, desc: e.target.value } }))
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
        title="黑名单全局屏蔽 · CRM 客户"
        desc="黑名单（I7）在各功能面的屏蔽范围。默认只开图谱隐藏（图谱是经营视图）；档案页/关联区始终保留，不丢数据"
      >
        <div className="space-y-3">
          {(
            [
              { key: 'hideInGraph', label: '关系图谱隐藏', desc: '黑名单客户不再出现在客户关系画布' },
              { key: 'hideInSearch', label: '全局搜索屏蔽', desc: '⌘K 搜索与全局搜索结果中隐藏' },
              { key: 'excludeFromPicker', label: '单据选择器排除', desc: '新建流水/待办/沟通时客户选择器不可选' },
              { key: 'hideInTimeline', label: '时间线隐藏', desc: '客户列表与时间线中隐藏（仅档案直接访问可见）' },
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
        title="算法兜底与权重 · CRM 客户"
        desc="未手动设置亲密度的客户由算法兜底分档；手动设置始终最优先。硬约束：算法最多推到 T2，永不给出 T1/I6/I7"
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
              <input
                type="range"
                min={0}
                max={100}
                step={5}
                className="h-1.5 flex-1 accent-primary"
                value={weights[row.key]}
                onChange={(e) => setWeights({ ...weights, [row.key]: Number(e.target.value) })}
                onMouseUp={() => applyWeights(weights)}
                onTouchEnd={() => applyWeights(weights)}
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
                  onChange={(e) => setThresholds({ ...thresholds, [row.key]: Number(e.target.value) })}
                  onBlur={() => applyThresholds(thresholds)}
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
