import { useEffect, useState } from 'react'
import { Icon } from '@/design-system/Icon'
import { Avatar, Chip } from '@/design-system/ui'
import type { Customer, IntimacyLevel, ModuleConfigIntimacy } from '@/db/types'
import { INTIMACY_VISUAL } from '@/db/types'
import { staggerStyle } from '@/shared/stagger'
import { fmtRelative } from './shared'
import { resolveIntimacyLevel } from './intimacy'
import { resolveHealthScoreDisplay } from './healthScore'
import type { useIntimacyConfig } from './intimacy'

/**
 * 客户列表的展示层零件（**自 CrmPage.tsx 拆出** · 审计 C-7 · 2026-10-21）
 *
 * 三个纯展示组件（`IntimacyFilterMenu` / `CustomerRow` / `CustomerCard`）
 * 全部是 props 驱动、不依赖页面 state，且**全仓无第二处 import**（实测；
 * `stagger.ts` 只在注释里提过 `CustomerRow` 这个名字）。
 *
 * 统计卡 `StatCard` 已于审计第三批（2026-11-01）提到 `@/design-system/ui`，
 * 与 finance 的 `SummaryCard` 合并为一份实现 —— 原先两份只是「同款骨架各自演化」，
 * 保留两份只会让窄屏字号口径继续分叉。
 *
 * ⚠️ 因此本文件不含任何业务逻辑，只负责渲染与本地交互态（浮层开合 / 拖拽发起）。
 * 语义与拆分前逐行一致（仅移动代码 + 补齐 import）。
 */
export function IntimacyFilterMenu({
  cfg,
  counts,
  total,
  value,
  onChange,
}: {
  cfg: ModuleConfigIntimacy
  /** 各分层命中人数（与左侧分组计数同源，由页面按可见集算出） */
  counts: Record<string, number>
  /** 「全部客户」人数（= 可见集大小） */
  total: number
  value: 'all' | IntimacyLevel
  onChange: (next: 'all' | IntimacyLevel) => void
}) {
  const [open, setOpen] = useState(false)
  const active = value !== 'all'
  const current = cfg.levels.find((lv) => lv.key === value)

  useEffect(() => {
    if (!open) return
    const isInside = (target: Node | null) =>
      target instanceof Element ? !!target.closest('[data-dropdown-root]') : false
    const onDown = (e: MouseEvent) => {
      if (!isInside(e.target as Node)) setOpen(false)
    }
    window.addEventListener('mousedown', onDown)
    return () => window.removeEventListener('mousedown', onDown)
  }, [open])

  // Esc 关闭：走 window 捕获并在本层消费，避免冒泡给上层弹层顺手关掉别的东西
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.stopPropagation()
      setOpen(false)
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [open])

  const pick = (next: 'all' | IntimacyLevel) => {
    onChange(next)
    setOpen(false)
  }

  return (
    <div data-dropdown-root className="relative">
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label="按亲密度筛选"
        className={`flex h-9 items-center gap-1.5 rounded-lg border px-3 text-[0.9286rem] transition-colors ${
          active
            ? 'border-primary bg-primary-fixed font-medium text-primary'
            : 'border-outline-variant bg-surface-container-lowest text-on-surface-variant hover:border-primary hover:text-primary'
        }`}
        onClick={() => setOpen((v) => !v)}
      >
        <Icon name="tune" size={16} />
        <span className="whitespace-nowrap">
          亲密度 · {active ? (current?.name ?? value) : '全部'}
        </span>
        <Icon name="keyboard_arrow_down" size={16} className="text-outline" />
      </button>

      {open && (
        <div
          role="listbox"
          aria-label="亲密度分层"
          className="surface-card absolute left-0 top-full z-20 mt-1 w-60 py-1 shadow-lg"
        >
          <button
            type="button"
            role="option"
            aria-selected={!active}
            onClick={() => pick('all')}
            className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-[0.9286rem] transition-colors ${
              !active ? 'bg-primary-fixed text-primary' : 'hover:bg-surface-hover'
            }`}
          >
            <Icon name="group" size={15} className="shrink-0 text-outline" />
            <span className="min-w-0 flex-1 truncate">全部客户</span>
            <span className="shrink-0 text-[0.7857rem]">{total}</span>
          </button>
          {cfg.levels.map((lv) => (
            <button
              key={lv.key}
              type="button"
              role="option"
              aria-selected={value === lv.key}
              onClick={() => pick(lv.key)}
              className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-[0.9286rem] transition-colors ${
                value === lv.key ? 'bg-primary-fixed text-primary' : 'hover:bg-surface-hover'
              }`}
            >
              {/* 档位色沿用图谱圈层色（INTIMACY_VISUAL）：档位→颜色是同一个语义，
                  在此另写一套色板必然与图谱漂移 */}
              <span
                aria-hidden
                className="h-2 w-2 shrink-0 rounded-full"
                style={{ background: INTIMACY_VISUAL[lv.key].color }}
              />
              <span className="min-w-0 flex-1 truncate">
                {lv.key} · {lv.name}
              </span>
              <span className="shrink-0 text-[0.7857rem]">{counts[lv.key] ?? 0}</span>
            </button>
          ))}
          {active && (
            <button
              type="button"
              onClick={() => pick('all')}
              className="mt-1 w-full border-t border-outline-variant/40 px-3 pb-1 pt-2 text-left text-[0.8571rem] text-primary hover:underline"
            >
              清除筛选条件
            </button>
          )}
        </div>
      )}
    </div>
  )
}

export function CustomerRow({
  customer: c,
  intimacyCfg,
  scoreInputs,
  onOpen,
  index,
}: {
  customer: Customer
  intimacyCfg: ReturnType<typeof useIntimacyConfig>
  /** 未手动设置档位的客户的算法入参（批次查询结果，缺失即「未设置」文案的旧口径兜底） */
  scoreInputs: Record<string, Parameters<typeof resolveIntimacyLevel>[2]>
  onOpen: () => void
  /** 列表序号：仅用于错峰入场延迟（可选，不传则不参与错峰） */
  index?: number
}) {
  // 健康分档位（原亲密度，Issue #108）：手动优先 → 算法兜底。
  // 未手动设置时不再显示「未设置」——按用户拍板，算法推断的档位用括号标出，与详情页口径统一。
  const healthLevel = resolveHealthScoreDisplay(c, intimacyCfg, scoreInputs[c.id] ?? null)
  return (
    <div
      onClick={onOpen}
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData('application/x-nexus-customer', c.id)
        e.dataTransfer.effectAllowed = 'move'
      }}
      title="拖动到左侧分组可加入该分组（按分组规则补齐标签）"
      /* 错峰入场挂在行根：桌面 Card 用 `divide-y` 做分隔线、依赖直接子元素，
         故**不能**在外面包一层 div。 */
      style={staggerStyle(index)}
      className="anim-list-item group flex cursor-pointer items-center gap-4 px-2 py-3.5 transition-colors hover:bg-surface-hover-low"
    >
      <Avatar name={c.name} size={40} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-[1rem] font-semibold">{c.name}</span>
        </div>
        <div className="mt-0.5 truncate text-[0.8571rem] text-on-surface-variant">
          {c.company || '—'}
          {c.title ? ` · ${c.title}` : ''}
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-1.5">
          {c.tags.map((t) => (
            <Chip key={t} tone="gray">
              #{t}
            </Chip>
          ))}
        </div>
      </div>
      <div className="hidden w-32 shrink-0 md:block">
        <div className="flex items-center justify-between text-[0.7857rem]">
          <span className="text-on-surface-variant">健康分</span>
          <span
            className="font-bold"
            style={{
              color: healthLevel.color,
            }}
          >
            {healthLevel.label}
          </span>
        </div>
        <div className="mt-1 text-right text-[0.7857rem] text-outline">
          {healthLevel.manual ? '手动设置' : '算法推断 · 未手动设置'}
        </div>
      </div>
      <div className="hidden w-28 shrink-0 text-right lg:block">
        <div className="text-[0.8571rem] text-on-surface-variant">最近联系</div>
        <div className="text-[0.8571rem] font-medium">{fmtRelative(c.lastContactAt)}</div>
      </div>
      <Icon
        name="chevron_right"
        className="text-[1.2857rem] text-outline opacity-0 transition-opacity group-hover:opacity-100"
      />
    </div>
  )
}

/**
 * 窄屏客户卡（<768px，原型 03）：左头像 / 中姓名 + 健康分 chip + 一行次要信息 / 右最近联系。
 *
 * 为什么另起一份而不是让 CustomerRow 自己降级：桌面行是「头像 + 弹性主列 + 两个固定宽度
 * 指标列 + 尾巴图标」的四段横排，窄屏放不下固定列、也不该把一行折成三行 —— 结构与桌面不同，
 * 按仓库约定（`shared/useIsMobile.ts`）两侧各留一套结构。
 *
 * 右侧放「最近联系」而不是累计金额：客户档案里没有金额字段，列表页也没有按客户聚合成交额的
 * 领域查询（`useCustomerListStats` 只给全局待收款）。为避免在视图层直连 Dexie 现算，
 * 这里沿用桌面行右侧已经在显示的那个指标。
 */
export function CustomerCard({
  customer: c,
  intimacyCfg,
  scoreInputs,
  onOpen,
  index,
}: {
  customer: Customer
  intimacyCfg: ReturnType<typeof useIntimacyConfig>
  scoreInputs: Record<string, Parameters<typeof resolveIntimacyLevel>[2]>
  onOpen: () => void
  /** 列表序号：仅用于错峰入场延迟（可选，不传则不参与错峰） */
  index?: number
}) {
  const healthLevel = resolveHealthScoreDisplay(c, intimacyCfg, scoreInputs[c.id] ?? null)
  return (
    <button
      type="button"
      onClick={onOpen}
      style={staggerStyle(index)}
      /* 仍挂 .card 而不是自己拼 border/bg：皮肤层（skins.css）按 `.card` 改圆角/描边/阴影，
         自己拼一份就会在换皮肤时变成唯一不长皮肤的那张卡。 */
      className="anim-list-item card flex w-full cursor-pointer items-center gap-3 p-3 text-left"
    >
      <Avatar name={c.name} size={40} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="min-w-0 truncate text-[1rem] font-semibold">{c.name}</span>
          {/* 档位色与桌面同源（resolveHealthScoreDisplay）；底色取同色 12% 透明，
              另配一套 chip 色板会与图谱/详情页漂移 */}
          <span
            className="shrink-0 rounded-full px-2 py-0.5 text-[0.7857rem] font-medium"
            style={{ color: healthLevel.color, background: `${healthLevel.color}1f` }}
          >
            {healthLevel.label}
          </span>
        </div>
        <div className="mt-0.5 truncate text-[0.8571rem] text-on-surface-variant">
          {c.company || '—'}
          {c.title ? ` · ${c.title}` : ''}
        </div>
      </div>
      <div className="shrink-0 text-right">
        <div className="text-[0.7857rem] text-on-surface-variant">最近联系</div>
        <div className="text-[0.8571rem] font-medium">{fmtRelative(c.lastContactAt)}</div>
      </div>
    </button>
  )
}

/**
 * 客户分组菜单（桌面左栏 Card 与窄屏折叠入口共用一份）。
 *
 * 为什么要抽出来：窄屏没有固定左栏的位置，但分组是用户自己维护的筛选维度、不能跟着一起砍。
 * 两处各写一遍的话，「桌面能改名、手机改不了」是迟早的事。
 *
 * 拖拽排序的 dragGroupId 收在组件内部：它是纯瞬态交互态、页面其它地方不消费，
 * 两个实例各持一份即可（桌面拖拽不受移动端影响）。
 */
