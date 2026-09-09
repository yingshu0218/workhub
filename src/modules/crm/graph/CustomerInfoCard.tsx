import { Avatar, Button, Chip } from '@/design-system/ui'
import { healthColor, fmtRelative, tierChipTone } from '../shared'
import { useIntimacyConfig, intimacyLevelName } from '../intimacy'
import type { Customer } from '@/db/types'

/**
 * 客户缩略信息卡（Issue #34）：点击图谱客户节点弹出，替代「单击即跳转」。
 * 数据走 useRecord 二次订阅的客户全量记录（审计口径：画布裁剪投影不含 lastContactAt/decisionLevel）,
 * 视觉范式对齐 CustomerDetailPage 头卡（Avatar + tierChipTone + healthColor），
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
  const hc = healthColor(customer.healthScore)
  // 亲密度手动档徽章（Issue #34）：未设置显示「未设置 · 算法兜底」口径，不误导为手动值
  const cfg = useIntimacyConfig()
  const intimacy = customer.intimacy?.level
    ? {
        name: intimacyLevelName(cfg, customer.intimacy.level),
        note: customer.intimacy.note,
        blacklisted: customer.intimacy.level === 'I7',
      }
    : null
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
            {intimacy && (
              <Chip tone={intimacy.blacklisted ? 'red' : 'amber'} icon="favorite">
                {intimacy.name}
              </Chip>
            )}
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

      {/* 健康指数 + 最近联系 */}
      <div className="mt-3 space-y-1.5">
        <div className="flex items-center justify-between text-[0.8571rem]">
          <span className="text-on-surface-variant">健康指数</span>
          <span className="font-bold" style={{ color: hc }}>
            {Math.round(customer.healthScore)}
          </span>
        </div>
        <div className="h-1.5 overflow-hidden rounded-full bg-surface-container-high">
          <div
            className="h-full rounded-full"
            style={{ width: `${customer.healthScore}%`, background: hc }}
          />
        </div>
        <div className="text-[0.7857rem] text-outline">
          最近联系 {fmtRelative(customer.lastContactAt)}
        </div>
        {intimacy?.note && (
          <div className="truncate text-[0.7857rem] text-outline" title={intimacy.note}>
            亲密度备注：{intimacy.note}
          </div>
        )}
      </div>

      <Button className="mt-3 w-full" variant="tonal" icon="person" onClick={onEnter}>
        进入档案
      </Button>
    </div>
  )
}
