import { useState } from 'react'
import { useCollection } from '@/queries/hooks'
import { customerRepo, newId } from '@/repositories'
import type { Customer, CustomerRelation, RelationCategory, Transaction } from '@/db/types'
import { RELATION_CATEGORIES } from '@/db/types'
import { Button, Chip, Field, Modal, inputCls, useAutoFocus } from '@/design-system/ui'
import { MatchCombobox } from '@/design-system/MatchCombobox'
import { createCustomerWithInit } from './hooks'
import { normalizeTags } from './shared'

/** 单条关系的稳定标识（Issue #39）：优先取条目 id，旧数据按 目标::语义 兜底（同对允许多条，可逐条删除） */
const relKey = (r: { id?: string; targetId: string; label: string }) =>
  r.id ?? `${r.targetId}::${r.label}`

const DECISION_LEVELS: Customer['decisionLevel'][] = ['决策人', '影响者', '使用者', '把关人']
const TIERS: Customer['tier'][] = ['S', 'A', 'B', '潜在']

/** 新建/编辑客户抽屉（复用；编辑以旧记录展开为基底，仅覆盖表单字段 —— 审计戒点 P0-2） */
export default function CustomerFormDrawer({
  open,
  customer,
  onClose,
}: {
  open: boolean
  /** 编辑目标；null 表示新建 */
  customer: Customer | null
  onClose: () => void
}) {
  const [name, setName] = useState('')
  const [company, setCompany] = useState('')
  const [title, setTitle] = useState('')
  const [decisionLevel, setDecisionLevel] = useState<Customer['decisionLevel']>('决策人')
  const [tier, setTier] = useState<Customer['tier']>('A')
  const [tagsRaw, setTagsRaw] = useState('')
  const [phone, setPhone] = useState('')
  const [wechat, setWechat] = useState('')
  const [email, setEmail] = useState('')
  const [address, setAddress] = useState('')
  const [healthScore, setHealthScore] = useState(60)
  // 关联客户维护区（仅编辑模式）：只能从已有客户中选，杜绝自由造目标 id 产生画布悬挂边
  const [relations, setRelations] = useState<CustomerRelation[]>([])
  const [relTarget, setRelTarget] = useState('')
  const [relLabel, setRelLabel] = useState('')
  const [relCategory, setRelCategory] = useState<RelationCategory | ''>('')
  // 第 4 步「跨模块关联初始化」状态（仅新建模式展示）
  const [initLog, setInitLog] = useState(false)
  const [initTxnId, setInitTxnId] = useState('')
  const [error, setError] = useState('')
  const [seedKey, setSeedKey] = useState(0)
  // 打开时聚焦姓名且不滚动页面
  const nameRef = useAutoFocus<HTMLInputElement>()

  // 打开时重置（渲染期重置模式，同 TodoFormDrawer / TransactionFormDrawer）
  const openKey = `${open}-${customer?.id ?? 'new'}`
  const [lastKey, setLastKey] = useState('')
  if (openKey !== lastKey) {
    setLastKey(openKey)
    if (open) {
      setName(customer?.name ?? '')
      setCompany(customer?.company ?? '')
      setTitle(customer?.title ?? '')
      setDecisionLevel(customer?.decisionLevel ?? '决策人')
      setTier(customer?.tier ?? 'A')
      setTagsRaw(customer?.tags.join(', ') ?? '')
      setPhone(customer?.phone ?? '')
      setWechat(customer?.wechat ?? '')
      setEmail(customer?.email ?? '')
      setAddress(customer?.address ?? '')
      setHealthScore(customer?.healthScore ?? 60)
      setRelations(customer?.relations ?? [])
      setRelTarget('')
      setRelLabel('')
      setInitLog(false)
      setInitTxnId('')
      setError('')
      setSeedKey((k) => k + 1)
    }
  }

  // 标签归一化抽共享工具（Issue #63）：客户表单与配组界面共用，避免打错字导致分组失效
  const tags = normalizeTags(tagsRaw)

  // 第 4 步可关联的交易：仅列出尚未归属任何客户的流水（已关联的可通过财务侧改）
  const transactions = useCollection<Transaction>('transactions')
  const linkableTxns = transactions.filter((t) => !t.customerId)

  // 关联客户候选：所有未删除客户（排除自己），只能从这里选目标
  const customers = useCollection<Customer>('customers')
  const relCandidates = customers.filter((c) => !customer || c.id !== customer.id)
  const REL_LABELS = ['转介绍人', '同一公司', '上下游', '竞对参照', '其他']

  async function save() {
    if (!name.trim()) {
      setError('请填写客户姓名')
      return
    }
    const score = Math.max(0, Math.min(100, Math.round(healthScore) || 0))
    if (customer) {
      // 编辑：旧记录为基底，只覆盖表单字段（保留 createdAt / 关联等）
      await customerRepo.put({
        ...customer,
        name: name.trim(),
        company: company.trim(),
        title: title.trim(),
        decisionLevel,
        tier,
        tags,
        phone: phone.trim(),
        wechat: wechat.trim(),
        email: email.trim(),
        address: address.trim(),
        healthScore: score,
        // relations 走下方维护区显式覆盖（state 初始值来自旧记录，不做静默丢失）
        relations,
      })
    } else {
      const record = {
        id: newId('cus'),
        name: name.trim(),
        company: company.trim(),
        title: title.trim(),
        decisionLevel,
        tier,
        tags,
        phone: phone.trim(),
        wechat: wechat.trim(),
        email: email.trim(),
        address: address.trim(),
        healthScore: score,
        lastContactAt: Date.now(),
        createdAt: Date.now(),
      }
      // 新建走「建档 + 关联初始化」同事务数据层函数，杜绝多步写半成品
      await createCustomerWithInit(record as Customer, {
        openingLog: initLog,
        linkTransactionId: initTxnId || undefined,
      })
    }
    onClose()
  }

  return (
    <Modal
      open={open}
      title={customer ? '编辑客户档案' : '新建客户档案'}
      onClose={onClose}
    >
      <div key={seedKey}>
        <StepHeader n={1} title="基础信息" />
        <Field label="客户姓名 *">
          <input
            ref={nameRef}
            className={inputCls}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="如：陆聪明"
          />
        </Field>
        <Field label="公司 / 组织">
          <input
            className={inputCls}
            value={company}
            onChange={(e) => setCompany(e.target.value)}
            placeholder="如：云峰智能科技有限公司"
          />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="职位 / 头衔">
            <input
              className={inputCls}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="如：技术副总裁"
            />
          </Field>
          <Field label="决策层级">
            <select
              className={inputCls}
              value={decisionLevel}
              onChange={(e) => setDecisionLevel(e.target.value as Customer['decisionLevel'])}
            >
              {DECISION_LEVELS.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <StepHeader n={2} title="分层与标签" />
        <Field label="客户分层">
          <div className="flex gap-2">
            {TIERS.map((t) => (
              <button
                key={t}
                onClick={() => setTier(t)}
                className={`flex-1 rounded-lg border px-2 py-1.5 text-[0.9286rem] transition-colors ${
                  tier === t
                    ? 'border-primary bg-primary-fixed font-semibold text-primary'
                    : 'border-outline-variant text-on-surface-variant'
                }`}
              >
                {t === '潜在' ? '潜在' : `${t} 层`}
              </button>
            ))}
          </div>
        </Field>
        <Field label="标签（逗号分隔）">
          <input
            className={inputCls}
            value={tagsRaw}
            onChange={(e) => setTagsRaw(e.target.value)}
            placeholder="高客单潜力, 关键决策者"
          />
          {tags.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {tags.map((t) => (
                <Chip key={t} tone="gray">
                  #{t}
                </Chip>
              ))}
            </div>
          )}
        </Field>
        <StepHeader n={3} title="联系方式与客情" />
        <div className="grid grid-cols-2 gap-3">
          <Field label="电话">
            <input
              className={inputCls}
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="+86 138 0000-0000"
            />
          </Field>
          <Field label="微信">
            <input
              className={inputCls}
              value={wechat}
              onChange={(e) => setWechat(e.target.value)}
              placeholder="个人或企业微信"
            />
          </Field>
        </div>
        <Field label="邮箱">
          <input
            className={inputCls}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="name@company.com"
          />
        </Field>
        <Field label="常用办公地点 / 地址">
          <input
            className={inputCls}
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            placeholder="如：上海浦东·张江科创园"
          />
        </Field>
        <Field label={`健康指数：${Math.round(healthScore)} / 100`}>
          <div className="flex items-center gap-3">
            <input
              type="range"
              min={0}
              max={100}
              step={1}
              className="h-1.5 flex-1 accent-primary"
              value={healthScore}
              onChange={(e) => setHealthScore(Number(e.target.value))}
            />
            <input
              type="number"
              min={0}
              max={100}
              className={`${inputCls} w-20`}
              value={Math.round(healthScore)}
              onChange={(e) =>
                setHealthScore(Math.max(0, Math.min(100, Number(e.target.value) || 0)))
              }
            />
          </div>
        </Field>
        {/* 关联客户维护区（仅编辑模式）：目标只能从已有客户选择，防止悬挂边 */}
        {customer && (
          <div className="mt-4 rounded-xl bg-surface-container-low/60 p-3">
            <StepHeader n={4} title="关联客户" />
            <div className="mb-2 flex flex-wrap gap-1.5">
              {relations.length === 0 && (
                <span className="text-[0.7857rem] text-outline">暂无关联客户</span>
              )}
              {relations.map((r) => {
                const target = relCandidates.find((c) => c.id === r.targetId)
                const catName = RELATION_CATEGORIES.find((c) => c.id === r.category)?.name
                return (
                  <span key={relKey(r)} className="inline-flex items-center">
                    <Chip tone="blue" icon="link">
                      {target ? `${target.name} · ${r.label}` : `${r.targetId} · ${r.label}`}
                      {catName ? `（${catName}）` : ''}
                    </Chip>
                    <button
                      className="-ml-1 h-4 w-4 rounded-full bg-surface-container-high text-[0.7143rem] leading-none text-on-surface-variant hover:text-danger"
                      title="移除该条关联"
                      onClick={() =>
                        setRelations((rs) => rs.filter((x) => relKey(x) !== relKey(r)))
                      }
                    >
                      ×
                    </button>
                  </span>
                )
              })}
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Field label="目标客户">
                <select
                  className={inputCls}
                  value={relTarget}
                  onChange={(e) => setRelTarget(e.target.value)}
                >
                  <option value="">选择已有客户…</option>
                  {relCandidates.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                      {c.company ? `（${c.company.slice(0, 8)}）` : ''}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="关系">
                <select
                  className={inputCls}
                  value={relLabel}
                  onChange={(e) => setRelLabel(e.target.value)}
                >
                  <option value="">关系语义…</option>
                  {REL_LABELS.map((l) => (
                    <option key={l} value={l}>
                      {l}
                    </option>
                  ))}
                </select>
              </Field>
              <div className="col-span-2">
                <Field label="归类（可选，用于图谱连线分组着色）">
                  <select
                    className={inputCls}
                    value={relCategory}
                    onChange={(e) => setRelCategory(e.target.value as RelationCategory | '')}
                  >
                    <option value="">未归类（图谱按「其他」展示）</option>
                    {RELATION_CATEGORIES.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </Field>
              </div>
            </div>
            <Button
              variant="tonal"
              icon="add"
              disabled={!relTarget || !relLabel}
              onClick={() => {
                if (!relTarget || !relLabel) return
                // 同 目标+语义 判重，防误操作重复（Issue #39）；同目标但语义不同允许多条并存
                if (relations.some((x) => x.targetId === relTarget && x.label === relLabel)) return
                setRelations((rs) => [
                  ...rs,
                  // 条目独立 id：支撑同对多语义并存、逐条删除与列表 key；category 可选（Issue #34）
                  {
                    id: newId('rel'),
                    targetId: relTarget,
                    label: relLabel,
                    ...(relCategory ? { category: relCategory } : {}),
                  },
                ])
                setRelTarget('')
                setRelLabel('')
                setRelCategory('')
              }}
            >
              添加关联
            </Button>
          </div>
        )}
        {/* 第 4 步：跨模块关联初始化（仅新建模式，审计 Phase 3 P2-8） */}
        {!customer && (
          <div className="mt-4 rounded-xl bg-surface-container-low/60 p-3">
            <StepHeader n={4} title="跨模块关联初始化" />
            <label className="flex cursor-pointer items-center gap-2 py-1.5 text-[0.9286rem]">
              <input
                type="checkbox"
                className="accent-primary"
                checked={initLog}
                onChange={(e) => setInitLog(e.target.checked)}
              />
              创建一条 opening 沟通日志（类型：拜访）
            </label>
            <Field label="关联已有交易（可选）">
              <MatchCombobox
                value={initTxnId}
                options={linkableTxns.map((t) => ({
                  id: t.id,
                  label: t.summary,
                  sub: `${t.type === 'income' ? '+' : '-'}¥${t.amount.toLocaleString('zh-CN')}`,
                  icon: 'payments',
                }))}
                placeholder="输入交易名称模糊搜索"
                emptyText={linkableTxns.length === 0 ? '暂无未归属客户的流水' : '没有匹配的交易'}
                onChange={setInitTxnId}
              />
            </Field>
          </div>
        )}
        {error && <div className="mb-3 text-[0.8571rem] text-danger">{error}</div>}
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="tonal" onClick={onClose}>
            取消
          </Button>
          <Button icon="save" onClick={save}>
            {customer ? '保存修改' : '立即创建客户'}
          </Button>
        </div>
      </div>
    </Modal>
  )
}

/** 四步表单分组指示器（1 基础信息 / 2 分层标签 / 3 联系客情 / 4 关联初始化） */
function StepHeader({ n, title }: { n: number; title: string }) {
  return (
    <div className="mb-2.5 mt-4 flex items-center gap-2">
      <span className="flex h-5 w-5 items-center justify-center rounded-full bg-primary-fixed text-[0.7857rem] font-bold text-primary">
        {n}
      </span>
      <span className="text-[0.7857rem] font-semibold uppercase tracking-wide text-on-surface-variant">
        {title}
      </span>
    </div>
  )
}
