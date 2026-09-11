import { useState } from 'react'
import { createPortal } from 'react-dom'
import { EntityHoverCard, useEntityHover, type EntityHoverState } from './EntityHoverCard'
import { MatchCombobox, type MatchOption } from './MatchCombobox'
import { Icon } from './Icon'
import { chipTagStyle } from './ChipTagInput'

/**
 * 实体多选关联字段（Issue #140）：
 * 「模糊联想选中 → 固化成带实体 id 的芯片」+「芯片 hover 悬浮摘要卡」+「× 解绑」。
 *
 * - 与 ChipTagInput 的区别：值必须来自候选（携带实体 id），**不允许自由输入** ——
 *   否则悬浮卡查不到对象（弱引用纪律：无 id 的芯片是脏数据）。
 * - 联想层复用 MatchCombobox（模糊匹配 + 键盘导航 + 归档沉底，Issue #33）。
 * - 悬浮卡复用 EntityHoverCard（笔记 Issue #50 抽出的共享原子件），hover 150ms 延时防误触。
 * - 去重：onChange 回传前已按 id 去重（同实体重复芯片是脏数据）。
 */
export default function EntityLinkField({
  value,
  options,
  placeholder,
  emptyText,
  entityType,
  onChange,
}: {
  /** 已关联实体 id（去重数组） */
  value: string[]
  options: MatchOption[]
  placeholder: string
  emptyText: string
  /** 悬浮卡实体类型（决定摘要口径与详情跳转） */
  entityType: 'customer' | 'todo' | 'ledger' | 'project'
  onChange: (next: string[]) => void
}) {
  // MatchCombobox 是单值控件：value='' 显示联想输入，选中后立即回填并清空回显，
  // 这里用「影子选中 id + 每次渲染后回空」的方式复用它做纯联想输入
  const [shadow, setShadow] = useState('')
  const [hover, setHover] = useState<EntityHoverState | null>(null)
  const { onEnter, onLeave } = useEntityHover(setHover)

  function pick(id: string) {
    setShadow('')
    if (!id) return
    if (value.includes(id)) return
    onChange([...value, id])
  }

  function remove(id: string) {
    onChange(value.filter((x) => x !== id))
  }

  return (
    <div
      className={`${inputLikeCls} flex min-h-[38px] cursor-text flex-wrap items-center gap-1.5`}
      onMouseLeave={() => onLeave()}
    >
      {value.map((id) => {
        const opt = options.find((o) => o.id === id)
        const label = opt?.label ?? ''
        const missing = !opt
        return (
          <span
            key={id}
            className={`flex items-center gap-0.5 rounded-full px-2.5 py-0.5 text-[0.8571rem] font-medium ${
              missing ? 'bg-surface-container-high text-outline' : ''
            }`}
            style={missing ? undefined : chipTagStyle(label)}
            // hover 摘要：锚点取芯片右下角；已删除实体不弹卡（弱引用，无摘要可查）
            onMouseEnter={(e) => {
              if (missing) return
              const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
              onEnter({
                type: entityType,
                eid: id,
                label,
                anchor: { x: rect.right + 8, y: rect.top },
              })
            }}
            onMouseLeave={() => onLeave()}
            title={missing ? '原实体已删除' : undefined}
          >
            {missing ? (
              <>
                <Icon name="person_off" size={12} />
                已删除的关联
              </>
            ) : (
              label
            )}
            <button
              className="ml-0.5 opacity-60 transition-opacity hover:opacity-100"
              title="移除关联"
              onMouseDown={(e) => e.stopPropagation()}
              onClick={() => remove(id)}
            >
              ×
            </button>
          </span>
        )
      })}
      <div className="min-w-[140px] flex-1">
        <MatchCombobox
          value={shadow}
          options={options.filter((o) => !value.includes(o.id))}
          placeholder={value.length === 0 ? placeholder : ''}
          emptyText={emptyText}
          onChange={pick}
        />
      </div>
      {/* 悬浮摘要卡（portal 到 body，避免被表单抽屉裁切；z-[80] 高于 Modal z-[60]） */}
      {hover &&
        createPortal(
          <EntityHoverCard
            state={hover}
            onClose={() => setHover(null)}
            onOpenDetail={undefined}
          />,
          document.body,
        )}
    </div>
  )
}

const inputLikeCls = 'input'
