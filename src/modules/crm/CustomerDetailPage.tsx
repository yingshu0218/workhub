import { useState } from 'react'
import { Icon } from '@/design-system/Icon'
import { useNavigate, useParams } from 'react-router-dom'
import { useRecord } from '@/queries/hooks'
import type { Customer, Interaction } from '@/db/types'
import { deleteCustomerCascade, newId, saveInteractionAndTouchCustomer } from '@/repositories'
import { eventBus } from '@/shared/eventBus'
import {
  Avatar,
  Button,
  Card,
  Chip,
  EmptyState,
  inputCls,
  PageHeader,
} from '@/design-system/ui'
import dayjs from 'dayjs'
import CustomerFormDrawer from './CustomerFormDrawer'
import { useCustomerInteractions, useCustomerTodos, useCustomerTransactions } from './hooks'
import { fmtRelative, healthColor, tierChipTone } from './shared'

const INTERACTION_TYPES: Interaction['type'][] = ['电话', '会议', '邮件', '拜访']
const TYPE_ICONS: Record<Interaction['type'], string> = {
  电话: 'call',
  会议: 'groups',
  邮件: 'mail',
  拜访: 'directions_walk',
}

const fmtMoney = (n: number) => `¥${n.toLocaleString('zh-CN')}`

/** 客户智能管家详情页（对齐原型 10-crm-detail），路由 /crm/:id */
export default function CustomerDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const customer = useRecord<Customer>('customers', id)
  const transactions = useCustomerTransactions(id)
  const todos = useCustomerTodos(id)
  const interactions = useCustomerInteractions(id)
  const [editing, setEditing] = useState(false)

  if (!customer) {
    return (
      <div className="mx-auto max-w-[1200px]">
        <PageHeader title="客户详情" actions={<Button variant="ghost" icon="arrow_back" onClick={() => navigate('/crm')}>返回列表</Button>} />
        <Card className="p-6">
          <EmptyState icon="person_off" title="客户不存在或已删除" description="可能已被移除，返回列表查看其他客户" />
        </Card>
      </div>
    )
  }

  const hc = healthColor(customer.healthScore)

  function handleDelete(name: string, id: string) {
    const ok = confirm(
      `确定删除客户「${name}」？\n\n` +
        `将同时删除其名下 ${interactions.length} 条沟通日志，` +
        `并解绑 ${transactions.length} 笔交易流水与 ${todos.length} 项待办。`,
    )
    if (!ok) return
    void deleteCustomerCascade(id).then(() => navigate('/crm'))
  }

  return (
    <div className="mx-auto max-w-[1200px]">
      <PageHeader
        title="客户智能管家"
        subtitle={`${customer.company || '独立顾问'} · 跨模块协同，贯通商机、履约与资金流向回溯`}
        actions={
          <>
            <Button variant="ghost" icon="arrow_back" onClick={() => navigate('/crm')}>
              返回列表
            </Button>
            <Button icon="edit" onClick={() => setEditing(true)}>
              编辑档案
            </Button>
            <Button variant="danger" icon="person_remove" onClick={() => handleDelete(customer.name, customer.id)}>
              删除客户
            </Button>
          </>
        }
      />

      <div className="grid gap-4 lg:grid-cols-5">
        {/* 左列：档案头 + 渠道 + 迷你图谱 */}
        <div className="space-y-4 lg:col-span-2">
          {/* 档案头 */}
          <Card className="p-5">
            <div className="flex items-start gap-4">
              <Avatar name={customer.name} size={56} />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[18px] font-bold">{customer.name}</span>
                  <Chip tone={tierChipTone(customer.tier)}>{customer.tier === '潜在' ? '潜在' : `${customer.tier} 层`}</Chip>
                </div>
                <div className="mt-0.5 text-[13px] text-on-surface-variant">
                  {customer.company || '—'}
                  {customer.title ? ` · ${customer.title}` : ''}
                </div>
                <div className="mt-1 text-[12px] text-outline">
                  {customer.industry || '—'} · {customer.decisionLevel}
                </div>
              </div>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-1.5">
              <Chip tone="blue" icon="flag">
                {customer.stage}
              </Chip>
              {customer.tags.map((t) => (
                <Chip key={t} tone="gray">
                  #{t}
                </Chip>
              ))}
            </div>

            {/* 健康指数环形 */}
            <div className="mt-4 flex items-center gap-4 rounded-xl bg-surface-container-low/60 p-4">
              <HealthRing score={customer.healthScore} color={hc} />
              <div className="min-w-0">
                <div className="text-[13px] font-semibold">客情健康指数</div>
                <div className="mt-0.5 text-[12px] text-on-surface-variant">
                  最近联系 {fmtRelative(customer.lastContactAt)}
                </div>
                <div className="mt-1 text-[11px] text-outline">
                  {customer.healthScore >= 80 ? '互动频繁 · 关系稳固' : customer.healthScore >= 60 ? '跟进正常 · 保持节奏' : '久未跟进 · 建议立刻触达'}
                </div>
              </div>
            </div>
          </Card>

          {/* 联系渠道 */}
          <Card className="p-5">
            <div className="mb-3 text-[12px] font-medium uppercase tracking-wide text-on-surface-variant">
              即时通讯与联系渠道
            </div>
            <div className="space-y-2">
              <ChannelCard icon="call" label="手机号码" value={customer.phone} onCopy={() => copyText(customer.phone)} />
              <ChannelCard icon="chat" label="企业微信" value={customer.wechat} onCopy={() => copyText(customer.wechat)} />
              <ChannelCard icon="mail" label="工作邮箱" value={customer.email} onCopy={() => copyText(customer.email)} />
            </div>
            {customer.address && (
              <div className="mt-3 flex items-center gap-2 text-[12px] text-on-surface-variant">
                <Icon name="location_on" className="text-[16px] text-primary" />
                {customer.address}
              </div>
            )}
          </Card>

          {/* 迷你关系图谱 */}
          <Card className="p-5">
            <div className="mb-2 flex items-center justify-between">
              <div className="flex items-center gap-1.5 text-[12px] font-medium uppercase tracking-wide text-on-surface-variant">
                <Icon name="hub" className="text-[16px] text-primary" />
                跨系统关系图谱
              </div>
              <button
                className="text-[12px] font-semibold text-primary hover:underline"
                onClick={() => navigate('/crm/canvas')}
              >
                展开全屏图谱 →
              </button>
            </div>
            <MiniGraph customerName={customer.name} txCount={transactions.length} todoCount={todos.length} />
          </Card>
        </div>

        {/* 右列：关联业务 + 沟通日志 */}
        <div className="space-y-4 lg:col-span-3">
          {/* 关联业务 */}
          <Card className="p-5">
            <div className="mb-3 text-[12px] font-medium uppercase tracking-wide text-on-surface-variant">
              关联业务
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-xl bg-surface-container-low/60 p-4">
                <div className="flex items-center justify-between">
                  <span className="text-[12px] text-on-surface-variant">关联交易流水</span>
                  <Icon name="payments" className="text-[18px] text-success" />
                </div>
                <div className="mt-1 text-[20px] font-bold tracking-tight">{transactions.length} 笔</div>
                {transactions.length > 0 ? (
                  <div className="mt-2 space-y-1.5">
                    {transactions.slice(0, 3).map((t) => (
                      <div key={t.id} className="flex items-center justify-between text-[12px]">
                        <span className="truncate text-on-surface-variant">{t.summary}</span>
                        <span className={`ml-2 shrink-0 font-bold ${t.type === 'income' ? 'text-success' : 'text-danger'}`}>
                          {t.type === 'income' ? '+' : '-'}
                          {fmtMoney(t.amount)}
                        </span>
                      </div>
                    ))}
                    <div className="text-[11px] text-outline">
                      最近一笔 {dayjs(transactions[0].occurredAt).format('YYYY-MM-DD')}
                    </div>
                  </div>
                ) : (
                  <div className="mt-2 text-[11px] text-outline">暂无关联流水，在财务中心记账时可关联该客户</div>
                )}
              </div>
              <div className="rounded-xl bg-surface-container-low/60 p-4">
                <div className="flex items-center justify-between">
                  <span className="text-[12px] text-on-surface-variant">关联待办</span>
                  <Icon name="task_alt" className="text-[18px] text-primary" />
                </div>
                <div className="mt-1 text-[20px] font-bold tracking-tight">
                  {todos.filter((t) => t.status !== 'done').length} 项
                  <span className="ml-1.5 text-[12px] font-normal text-on-surface-variant">进行中</span>
                </div>
                {todos.length > 0 ? (
                  <div className="mt-2 space-y-1.5">
                    {todos.slice(0, 3).map((t) => (
                      <div key={t.id} className="flex items-center justify-between gap-2 text-[12px]">
                        <span className="truncate">{t.title}</span>
                        <Chip tone={t.priority === 'P1' ? 'red' : t.priority === 'P2' ? 'amber' : 'gray'}>{t.priority}</Chip>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="mt-2 text-[11px] text-outline">暂无关联待办</div>
                )}
              </div>
            </div>
          </Card>

          {/* 沟通日志 */}
          <Card className="p-5">
            <div className="mb-3 text-[12px] font-medium uppercase tracking-wide text-on-surface-variant">
              深度跟进与沟通日志
            </div>
            <QuickLog customerId={customer.id} />
            <div className="mt-4">
              {interactions.length === 0 ? (
                <div className="py-6 text-center text-[12px] text-outline">
                  暂无沟通记录，用上方「快速记一笔」开始跟进
                </div>
              ) : (
                <div className="relative space-y-4 border-l border-outline-variant/40 pl-4">
                  {interactions.map((it) => (
                    <div key={it.id} className="relative">
                      <span className="absolute -left-[22px] top-1 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-primary-fixed">
                        <span className="h-1.5 w-1.5 rounded-full bg-primary" />
                      </span>
                      <div className="flex flex-wrap items-center gap-2">
                        <Chip tone="blue" icon={TYPE_ICONS[it.type]}>
                          {it.type}
                        </Chip>
                        <span className="text-[12px] text-outline">{dayjs(it.at).format('YYYY-MM-DD HH:mm')}</span>
                      </div>
                      <p className="mt-1 rounded-lg bg-surface-container-low/50 px-3 py-2 text-[13px] leading-relaxed">
                        {it.content}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </Card>
        </div>
      </div>

      <CustomerFormDrawer open={editing} customer={customer} onClose={() => setEditing(false)} />
    </div>
  )
}

/** 健康指数环形（SVG） */
function HealthRing({ score, color }: { score: number; color: string }) {
  const r = 26
  const circ = 2 * Math.PI * r
  return (
    <svg width="72" height="72" viewBox="0 0 72 72" className="shrink-0">
      <circle cx="36" cy="36" r={r} fill="none" stroke="#dce9ff" strokeWidth="7" />
      <circle
        cx="36"
        cy="36"
        r={r}
        fill="none"
        stroke={color}
        strokeWidth="7"
        strokeLinecap="round"
        strokeDasharray={`${(score / 100) * circ} ${circ}`}
        transform="rotate(-90 36 36)"
      />
      <text x="36" y="40" textAnchor="middle" className="fill-on-surface" style={{ fontSize: 15, fontWeight: 700 }}>
        {score}
      </text>
    </svg>
  )
}

function ChannelCard({ icon, label, value, onCopy }: { icon: string; label: string; value: string; onCopy: () => void }) {
  const [copied, setCopied] = useState(false)
  return (
    <div className="flex items-center gap-3 rounded-xl border border-outline-variant/40 px-3 py-2.5">
      <Icon name={icon} size={18} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary-fixed text-primary" />
      <div className="min-w-0 flex-1">
        <div className="text-[11px] text-outline">{label}</div>
        <div className="truncate text-[13px] font-medium">{value || '—'}</div>
      </div>
      {value && (
        <button
          className="shrink-0 text-[11px] font-semibold text-primary hover:underline"
          onClick={() => {
            onCopy()
            setCopied(true)
            setTimeout(() => setCopied(false), 1500)
          }}
        >
          {copied ? '已复制' : '复制'}
        </button>
      )}
    </div>
  )
}

function copyText(text: string) {
  if (navigator.clipboard?.writeText) {
    void navigator.clipboard.writeText(text)
    return
  }
  // 非安全上下文兜底
  const el = document.createElement('textarea')
  el.value = text
  document.body.appendChild(el)
  el.select()
  document.execCommand('copy')
  document.body.removeChild(el)
}

/** 快速记一笔：类型 + 内容 → interactions 表，并联动刷新 lastContactAt */
function QuickLog({ customerId }: { customerId: string }) {
  const [type, setType] = useState<Interaction['type']>('电话')
  const [content, setContent] = useState('')
  const [saving, setSaving] = useState(false)

  async function save() {
    if (!content.trim() || saving) return
    setSaving(true)
    try {
      // 原子双写：日志落库 + 客户 lastContactAt 刷新在同一事务完成
      const at = Date.now()
      await saveInteractionAndTouchCustomer(
        { id: newId('itx'), customerId, type, content: content.trim(), at },
        customerId,
      )
      eventBus.emit('customer:contacted', { customerId })
      setContent('')
    } catch (err) {
      console.error('[QuickLog] 保存沟通日志失败', err)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="rounded-xl bg-surface-container-low/60 p-3">
      <div className="mb-2 flex items-center gap-1.5 text-[12px] font-semibold text-primary">
        <Icon name="bolt" className="text-[16px]" />
        快速记一笔
      </div>
      <div className="mb-2 flex gap-1.5">
        {INTERACTION_TYPES.map((t) => (
          <button
            key={t}
            onClick={() => setType(t)}
            className={`flex items-center gap-1 rounded-lg border px-2.5 py-1 text-[12px] transition-colors ${
              type === t
                ? 'border-primary bg-primary-fixed font-semibold text-primary'
                : 'border-outline-variant text-on-surface-variant hover:text-on-surface'
            }`}
          >
            <Icon name={TYPE_ICONS[t]} size={14} />
            {t}
          </button>
        ))}
      </div>
      <div className="flex gap-2">
        <input
          className={inputCls}
          value={content}
          onChange={(e) => setContent(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && !e.nativeEvent.isComposing && void save()}
          placeholder="如：确认了二期验收标准，下周回签合同…"
        />
        <Button icon="send" disabled={!content.trim() || saving} onClick={() => void save()}>
          记录
        </Button>
      </div>
    </div>
  )
}

/** 迷你关系图谱：客户居中，交易/待办环绕（静态 SVG 简版） */
function MiniGraph({ customerName, txCount, todoCount }: { customerName: string; txCount: number; todoCount: number }) {
  if (txCount === 0 && todoCount === 0) {
    return <div className="py-6 text-center text-[12px] text-outline">暂无关联交易与待办，图谱待建立</div>
  }
  const w = 320
  const h = 180
  const cx = w / 2
  const cy = h / 2
  const satellites = [
    ...Array.from({ length: txCount }, (_, i) => ({ kind: 'txn' as const, label: `交易 ${i + 1}` })),
    ...Array.from({ length: todoCount }, (_, i) => ({ kind: 'todo' as const, label: `待办 ${i + 1}` })),
  ]
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full">
      {satellites.map((s, i) => {
        const angle = (i / satellites.length) * 2 * Math.PI - Math.PI / 2
        const x = cx + Math.cos(angle) * 105
        const y = cy + Math.sin(angle) * 62
        const fill = s.kind === 'txn' ? '#006c49' : '#943700'
        return (
          <g key={`${s.kind}-${i}`}>
            <line x1={cx} y1={cy} x2={x} y2={y} stroke="#c3c6d7" strokeWidth="1.2" />
            <circle cx={x} cy={y} r={13} fill={s.kind === 'txn' ? '#6cf8bb' : '#ffede6'} stroke={fill} strokeWidth="1.4" />
            <text x={x} y={y + 3.5} textAnchor="middle" style={{ fontSize: 8, fontWeight: 600 }} fill={fill}>
              {s.kind === 'txn' ? '¥' : '!'}
            </text>
            <text x={x} y={y + 26} textAnchor="middle" style={{ fontSize: 9 }} fill="#434655">
              {s.label}
            </text>
          </g>
        )
      })}
      <circle cx={cx} cy={cy} r={24} fill="#dbe1ff" stroke="#004ac6" strokeWidth="1.6" />
      <text x={cx} y={cy + 4} textAnchor="middle" style={{ fontSize: 11, fontWeight: 700 }} fill="#004ac6">
        {customerName.slice(0, 4)}
      </text>
    </svg>
  )
}
