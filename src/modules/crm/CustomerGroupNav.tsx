import { useState } from 'react'
import { Icon } from '@/design-system/Icon'
import type { CustomerGroup } from '@/db/types'
import { deleteCustomerGroup, moveInOrder, reorderCustomerGroups } from './hooks'

/**
 * 客户分组左栏（**自 CrmPage.tsx 拆出** · 审计 C-7 · 2026-10-21）
 *
 * 拆分依据：本组件正文 288 行（CrmPage 内最大的一块），且**全仓无第二处 import**
 * （实测确认，除 `stagger.ts` 的注释里提过一次名字）→ 拆出零风险。
 *
 * 语义与拆分前逐行一致（仅移动代码 + 补齐 import）。`removeGroup` 是本组件
 * 确认弹窗的回调，随组件一起搬来。
 */
export function CustomerGroupNav({
  groups,
  counts,
  totalCount,
  selectedGroupId,
  onSelectGroup,
  onEditGroup,
  onCreateGroup,
  onDropCustomer,
  onDropCustomerToAll,
  touch = false,
}: {
  groups: CustomerGroup[]
  /** 各分组命中人数（由页面按可见集算出） */
  counts: Record<string, number>
  /** 「全部客户」人数（= 可见集大小） */
  totalCount: number
  selectedGroupId: string | null
  /** null = 切回「全部客户」 */
  onSelectGroup: (id: string | null) => void
  onEditGroup: (group: CustomerGroup) => void
  onCreateGroup: () => void
  /** 客户拖入分组（2026-10-16）：按分组规则补齐客户标签；缺省 = 不接收拖入 */
  onDropCustomer?: (customerId: string, groupId: string) => void
  /** 客户拖到「全部客户」= 清空手动分组归属（2026-10-17）；缺省 = 不接收 */
  onDropCustomerToAll?: (customerId: string) => void
  /**
   * 触摸端实例（窄屏折叠入口）。这里刻意用 prop 而不是 `md:` 类：
   * 本组件的桌面实例必须逐像素不变，而「常态 `hidden`、hover 才 `flex`」这套写法
   * 一旦两侧都挂上前缀，谁盖谁就要看 Tailwind 的生成顺序了 —— 拿不准就别赌。
   * 触摸端没有 hover，编辑/删除会永远点不到，故常显；拖拽手柄则整根藏掉。
   */
  touch?: boolean
}) {
  // 分组的拖拽排序（用例 #34）：记录被拖起的 id，落点由目标项决定
  const [dragGroupId, setDragGroupId] = useState<string | null>(null)
  /** 手柄常态不可见（避免与编辑/删除抢注意力），hover 或正在拖时才现形 */
  const handleCls = dragGroupId ? 'opacity-100' : 'opacity-0 group-hover/g:opacity-100'
  // 双模式分段渲染（2026-10-17）：手动组与规则组用小节标题分隔；段内保持既有排序相对顺序，
  // 拖拽排序仍作用于全局 ids 数组（reorderCustomerGroups 不分段）。
  const manualGroups = groups.filter((g) => (g.kind ?? 'rule') === 'manual')
  const ruleGroups = groups.filter((g) => (g.kind ?? 'rule') !== 'manual')

  return (
    <>
      <div className="mb-3 text-[0.8571rem] font-medium uppercase tracking-wide text-on-surface-variant">
        客户分组
      </div>
      <div className="flex flex-col gap-0.5">
        <button
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault()
            const droppedCustomer = e.dataTransfer.getData('application/x-nexus-customer')
            if (droppedCustomer) onDropCustomerToAll?.(droppedCustomer)
          }}
          title="点击查看全部客户；也可把客户拖到这里移出手动分组"
          onClick={() => onSelectGroup(null)}
          className={`app-nav-link flex items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[0.9286rem] transition-colors ${
            selectedGroupId === null
              ? 'bg-primary-fixed font-semibold text-primary'
              : 'text-on-surface-variant hover:bg-surface-hover-low hover:text-on-surface'
          }`}
        >
          <Icon
            name="group"
            size={16}
            className={selectedGroupId === null ? 'text-primary' : 'text-outline'}
          />
          <span className="min-w-0 flex-1 truncate">全部客户</span>
          <span
            className={`shrink-0 text-[0.7857rem] ${selectedGroupId === null ? 'text-primary/70' : 'text-outline'}`}
          >
            {totalCount}
          </span>
        </button>
      </div>

      {/* 我的分组：双模式（2026-10-17）—— 手动分组（详情页单选归属）与标签规则分组（自动圈人） */}
      <div className="mt-3 flex items-center justify-between border-t border-outline-variant/40 px-1 pt-2 pb-1">
        <span className="text-[0.7857rem] font-semibold uppercase tracking-wider text-outline">
          我的分组
        </span>
      </div>
      {manualGroups.length > 0 && (
        <>
          <div className="px-1 pt-1.5 pb-0.5 text-[0.7857rem] text-outline">
            手动分组
          </div>
          <div className="flex flex-col gap-0.5">
        {manualGroups.map((g) => (
          <div
            key={g.id}
            /* 拖拽排序（用例 #34）：内置分组（全部/S/A/B/潜在）是固定顺序不参与，
               只有自定义分组可拖 —— 它们的 sortOrder 才是用户语义上的「我的排序」 */
            draggable
            onDragStart={(e) => {
              setDragGroupId(g.id)
              e.dataTransfer.effectAllowed = 'move'
            }}
            onDragEnd={() => setDragGroupId(null)}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault()
              // 先判客户拖入（与排序拖拽共用落点）：带 customer 拖拽类型 → 加入分组
              const droppedCustomer = e.dataTransfer.getData('application/x-nexus-customer')
              if (droppedCustomer) {
                onDropCustomer?.(droppedCustomer, g.id)
                return
              }
              if (!dragGroupId || dragGroupId === g.id) return
              const ids = groups.map((x) => x.id)
              const from = ids.indexOf(dragGroupId)
              const to = ids.indexOf(g.id)
              if (from < 0 || to < 0) return
              void reorderCustomerGroups(moveInOrder(ids, from, to))
              setDragGroupId(null)
            }}
            className={`app-nav-link group/g flex items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[0.9286rem] transition-colors ${
              dragGroupId === g.id ? 'opacity-40' : ''
            } ${
              selectedGroupId === g.id
                ? 'bg-primary-fixed font-semibold text-primary'
                : 'text-on-surface-variant hover:bg-surface-hover-low hover:text-on-surface'
            }`}
          >
            {/* 拖拽手柄：仅作视觉提示（整行都可拖，与 /todo 清单、/finance 账本同款写法
                与同一个 ⠿ 字符），hover 或正在拖时可见，避免常态下与「编辑/删除」抢注意力。
                触摸端（<768px）整根藏掉：HTML5 拖拽在触屏上不生效，留着只会让人白试。 */}
            <span
              title="拖动调整分组顺序"
              className={`-ml-1 shrink-0 cursor-grab text-[1rem] leading-none text-outline/60 transition-opacity group-hover/g:text-outline ${
                touch ? 'hidden' : handleCls
              }`}
            >
              ⠿
            </span>
            <button
              className="flex min-w-0 flex-1 items-center gap-2 text-left"
              title="点击筛选该分组；也可把右侧客户拖到这里加入分组"
              onClick={() => onSelectGroup(selectedGroupId === g.id ? null : g.id)}
            >
              <Icon
                name="flag"
                size={16}
                className={selectedGroupId === g.id ? 'text-primary' : 'text-outline'}
              />
              <span className="min-w-0 flex-1 truncate">{g.name}</span>
              {(g.kind ?? 'rule') === 'manual' && (
                <span className="shrink-0 rounded bg-surface-container px-1 text-[0.7143rem] text-outline">
                  手动
                </span>
              )}
            </button>
            <span
              className={`shrink-0 text-[0.7857rem] ${selectedGroupId === g.id ? 'text-primary/70' : 'text-outline'}`}
            >
              {counts[g.id] ?? 0}
            </span>
            {/* 桌面常态藏、hover 显；触摸端没有 hover 可用，编辑/删除会永远点不到，故常显 */}
            <span
              className={`shrink-0 items-center gap-1 ${touch ? 'flex' : 'hidden group-hover/g:flex'}`}
            >
              <button
                title="编辑分组"
                className="text-outline hover:text-primary"
                onClick={() => onEditGroup(g)}
              >
                <Icon name="edit" size={14} />
              </button>
              <button
                title="删除分组"
                className="text-outline hover:text-danger"
                onClick={() => void removeGroup(g.id)}
              >
                <Icon name="delete" size={14} />
              </button>
            </span>
          </div>        ))}
          </div>
        </>
      )}
      <div className="mt-3 flex items-center justify-between border-t border-outline-variant/40 px-1 pt-2 pb-0.5">
        <span className="text-[0.7857rem] text-outline">
          标签分组
        </span>
      </div>
      <div className="flex flex-col gap-0.5">
        {ruleGroups.map((g) => (
          <div
            key={g.id}
            /* 拖拽排序（用例 #34）：内置分组（全部/S/A/B/潜在）是固定顺序不参与，
               只有自定义分组可拖 —— 它们的 sortOrder 才是用户语义上的「我的排序」 */
            draggable
            onDragStart={(e) => {
              setDragGroupId(g.id)
              e.dataTransfer.effectAllowed = 'move'
            }}
            onDragEnd={() => setDragGroupId(null)}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault()
              // 先判客户拖入（与排序拖拽共用落点）：带 customer 拖拽类型 → 加入分组
              const droppedCustomer = e.dataTransfer.getData('application/x-nexus-customer')
              if (droppedCustomer) {
                onDropCustomer?.(droppedCustomer, g.id)
                return
              }
              if (!dragGroupId || dragGroupId === g.id) return
              const ids = groups.map((x) => x.id)
              const from = ids.indexOf(dragGroupId)
              const to = ids.indexOf(g.id)
              if (from < 0 || to < 0) return
              void reorderCustomerGroups(moveInOrder(ids, from, to))
              setDragGroupId(null)
            }}
            className={`app-nav-link group/g flex items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[0.9286rem] transition-colors ${
              dragGroupId === g.id ? 'opacity-40' : ''
            } ${
              selectedGroupId === g.id
                ? 'bg-primary-fixed font-semibold text-primary'
                : 'text-on-surface-variant hover:bg-surface-hover-low hover:text-on-surface'
            }`}
          >
            {/* 拖拽手柄：仅作视觉提示（整行都可拖，与 /todo 清单、/finance 账本同款写法
                与同一个 ⠿ 字符），hover 或正在拖时可见，避免常态下与「编辑/删除」抢注意力。
                触摸端（<768px）整根藏掉：HTML5 拖拽在触屏上不生效，留着只会让人白试。 */}
            <span
              title="拖动调整分组顺序"
              className={`-ml-1 shrink-0 cursor-grab text-[1rem] leading-none text-outline/60 transition-opacity group-hover/g:text-outline ${
                touch ? 'hidden' : handleCls
              }`}
            >
              ⠿
            </span>
            <button
              className="flex min-w-0 flex-1 items-center gap-2 text-left"
              title="点击筛选该分组；也可把右侧客户拖到这里加入分组"
              onClick={() => onSelectGroup(selectedGroupId === g.id ? null : g.id)}
            >
              <Icon
                name="flag"
                size={16}
                className={selectedGroupId === g.id ? 'text-primary' : 'text-outline'}
              />
              <span className="min-w-0 flex-1 truncate">{g.name}</span>
              {(g.kind ?? 'rule') === 'manual' && (
                <span className="shrink-0 rounded bg-surface-container px-1 text-[0.7143rem] text-outline">
                  手动
                </span>
              )}
            </button>
            <span
              className={`shrink-0 text-[0.7857rem] ${selectedGroupId === g.id ? 'text-primary/70' : 'text-outline'}`}
            >
              {counts[g.id] ?? 0}
            </span>
            {/* 桌面常态藏、hover 显；触摸端没有 hover 可用，编辑/删除会永远点不到，故常显 */}
            <span
              className={`shrink-0 items-center gap-1 ${touch ? 'flex' : 'hidden group-hover/g:flex'}`}
            >
              <button
                title="编辑分组"
                className="text-outline hover:text-primary"
                onClick={() => onEditGroup(g)}
              >
                <Icon name="edit" size={14} />
              </button>
              <button
                title="删除分组"
                className="text-outline hover:text-danger"
                onClick={() => void removeGroup(g.id)}
              >
                <Icon name="delete" size={14} />
              </button>
            </span>
          </div>        ))}
      </div>
      <button
        onClick={onCreateGroup}
        className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-outline-variant px-2.5 py-2 text-[0.8929rem] text-on-surface-variant transition-colors hover:border-primary hover:text-primary"
      >
        <Icon name="add" size={15} />
        新建分组
      </button>
    </>
  )
}

async function removeGroup(id: string) {
  await deleteCustomerGroup(id)
}
