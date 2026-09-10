import { Avatar, Button, Chip } from '@/design-system/ui'
import { fmtRelative, tierChipTone } from '../shared'
import { useIntimacyConfig } from '../intimacy'
import { useCustomerScoreRows } from '../hooks'
import { resolveHealthScoreDisplay } from '../healthScore'
import type { Customer } from '@/db/types'

/**
 * 客户缩略信息卡（Issue #34）：点击图谱客户节点弹出，替代「单击即跳转」。
 * 数据走 useRecord 二次订阅的客户全量记录（审计口径：画布裁剪投影不含 lastContactAt/decisionLevel）,
 * 视觉范式对齐 CustomerDetailPage 头卡（Avatar + tierChipTone），
 * 「进入档案」按钮保留原 navigate(/crm/:id) 跳转能力。
 */
export default function CustomerInfoCard({
  customer,
  screen,
  onEnter,
  onClose,
}: {
  customer: Customer
  /** 节点屏幕坐标（视口内定位，浮层跟随节点） */
  screen: { x: number; y: number }
  onEnter: () => void
  onClose: () => void
}) {
  // 健康分（原亲密度，Issue #108）：手动档原样，未手动设置时也算出算法档位并用括号标注来源
  const cfg = useIntimacyConfig()
  const scoreRows = useCustomerScoreRows(customer.intimacy?.level ? [] : [customer.id])
  const health = resolveHealthScoreDisplay(customer, cfg, scoreRows[customer.id] ?? null)
  const intimacyNote = customer.intimacy?.note
  // 卡片约 240×230：贴近节点右下，靠近视口边缘时向内收（简单钳制，不做翻转）
  const left = Math.min(screen.x + 16, window.innerWidth - 268)
  const top = Math.min(screen.y + 10, window.innerHeight - 260)

  return (
    <div
      className="fixed z-50 w-60 rounded-2xl border border-outline-variant/50 bg-surface-container-lowest/98 p-4 shadow-xl backdrop-blur"
      style={{ left, top }}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="flex items-start gap-3">
        <Avatar name={customer.name} size={40} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="truncate text-[1rem] font-bold">{customer.name}</span>
            <Chip tone={tierChipTone(customer.tier)}>
              {customer.tier === '潜在' ? '潜在' : `${customer.tier} 层`}
            </Chip>
            {customer.decisionLevel && <Chip tone="gray">{customer.decisionLevel}</Chip>}
            <Chip
              tone={health.manual && health.levelKey === 'I7' ? 'red' : 'amber'}
              icon="favorite"
            >
              {health.label}
            </Chip>
          </div>
          <div className="mt-0.5 truncate text-[0.8571rem] text-on-surface-variant">
            {customer.company || '—'}
          </div>
        </div>
        <button
          className="-mt-1 -mr-1 flex h-6 w-6 items-center justify-center rounded-full text-on-surface-variant hover:bg-surface-container-high"
          title="关闭"
          onClick={onClose}
        >
          ×
        </button>
      </div>

      {/* 健康分档位（原健康指数移除，Issue #108）+ 最近联系 */}
      <div className="mt-3 space-y-1.5">
        <div className="flex items-center justify-between text-[0.8571rem]">
          <span className="text-on-surface-variant">健康分</span>
          <span className="font-bold" style={{ color: health.color }}>
            {health.label}
          </span>
        </div>
        <div className="text-[0.7857rem] text-outline">
          最近联系 {fmtRelative(customer.lastContactAt)}
        </div>
        {intimacyNote && (
          <div className="truncate text-[0.7857rem] text-outline" title={intimacyNote}>
            健康分备注：{intimacyNote}
          </div>
        )}
      </div>

      <Button className="mt-3 w-full" variant="tonal" icon="person" onClick={onEnter}>
        进入档案
      </Button>
    </div>
  )
}
