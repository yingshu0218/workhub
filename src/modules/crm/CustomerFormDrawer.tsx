import { useState } from 'react'
import { useCollection } from '@/queries/hooks'
import { customerRepo, newId } from '@/repositories'
import type { Customer, Transaction } from '@/db/types'
import { Button, Chip, Drawer, Field, inputCls } from '@/design-system/ui'
import { MatchCombobox } from '@/design-system/MatchCombobox'
import { createCustomerWithInit } from './hooks'

const DECISION_LEVELS: Customer['decisionLevel'][] = ['决策人', '影响者', '使用者', '把关人']
const TIERS: Customer['tier'][] = ['S', 'A', 'B', '潜在']
const STAGES = ['潜在接触', '需求确认', '方案沟通中', '合同谈判', '已成交 · 维护期', '久未跟进']

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
  const [industry, setIndustry] = useState('')
  const [title, setTitle] = useState('')
  const [decisionLevel, setDecisionLevel] = useState<Customer['decisionLevel']>('决策人')
  const [tier, setTier] = useState<Customer['tier']>('A')
  const [stage, setStage] = useState(STAGES[0])
  const [tagsRaw, setTagsRaw] = useState('')
  const [phone, setPhone] = useState('')
  const [wechat, setWechat] = useState('')
  const [email, setEmail] = useState('')
  const [address, setAddress] = useState('')
  const [healthScore, setHealthScore] = useState(60)
  // 第 4 步「跨模块关联初始化」状态（仅新建模式展示）
  const [initTodo, setInitTodo] = useState(true)
  const [initLog, setInitLog] = useState(false)
  const [initTxnId, setInitTxnId] = useState('')
  const [error, setError] = useState('')
  const [seedKey, setSeedKey] = useState(0)

  // 打开时重置（渲染期重置模式，同 TodoFormDrawer / TransactionFormDrawer）
  const openKey = `${open}-${customer?.id ?? 'new'}`
  const [lastKey, setLastKey] = useState('')
  if (openKey !== lastKey) {
    setLastKey(openKey)
    if (open) {
      setName(customer?.name ?? '')
      setCompany(customer?.company ?? '')
      setIndustry(customer?.industry ?? '')
      setTitle(customer?.title ?? '')
      setDecisionLevel(customer?.decisionLevel ?? '决策人')
      setTier(customer?.tier ?? 'A')
      setStage(customer?.stage ?? STAGES[0])
      setTagsRaw(customer?.tags.join(', ') ?? '')
      setPhone(customer?.phone ?? '')
      setWechat(customer?.wechat ?? '')
      setEmail(customer?.email ?? '')
      setAddress(customer?.address ?? '')
      setHealthScore(customer?.healthScore ?? 60)
      setInitTodo(true)
      setInitLog(false)
      setInitTxnId('')
      setError('')
      setSeedKey((k) => k + 1)
    }
  }

  const tags = [...new Set(
    tagsRaw
      .split(/[,,]/)
      .map((t) => t.trim().replace(/^#/, ''))
      .filter(Boolean),
  )]

  // 第 4 步可关联的交易：仅列出尚未归属任何客户的流水（已关联的可通过财务侧改）
  const transactions = useCollection<Transaction>('transactions')
  const linkableTxns = transactions.filter((t) => !t.customerId)

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
        industry: industry.trim(),
        title: title.trim(),
        decisionLevel,
        tier,
        stage,
        tags,
        phone: phone.trim(),
        wechat: wechat.trim(),
        email: email.trim(),
        address: address.trim(),
        healthScore: score,
      })
    } else {
      const record = {
        id: newId('cus'),
        name: name.trim(),
        company: company.trim(),
        industry: industry.trim(),
        title: title.trim(),
        decisionLevel,
        tier,
        stage,
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
        firstContactTodo: initTodo,
        openingLog: initLog,
        linkTransactionId: initTxnId || undefined,
      })
    }
    onClose()
  }

  return (
    <Drawer open={open} title={customer ? '编辑客户档案' : '新建客户档案'} onClose={onClose} width={460}>
      <div key={seedKey}>
        <StepHeader n={1} title="基础信息" />
        <Field label="客户姓名 *">
          <input
            className={inputCls}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="如：陆聪明"
            autoFocus
          />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="公司 / 组织">
            <input
              className={inputCls}
              value={company}
              onChange={(e) => setCompany(e.target.value)}
              placeholder="如：云峰智能科技有限公司"
            />
          </Field>
          <Field label="所属行业">
            <input
              className={inputCls}
              value={industry}
              onChange={(e) => setIndustry(e.target.value)}
              placeholder="企业软件 / SaaS / 工业软件"
            />
          </Field>
        </div>
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
                className={`flex-1 rounded-lg border px-2 py-1.5 text-[13px] transition-colors ${
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
        <Field label="跟进阶段">
          <input
            className={inputCls}
            value={stage}
            onChange={(e) => setStage(e.target.value)}
            placeholder="如：方案沟通中"
            list="crm-stage-options"
          />
          <datalist id="crm-stage-options">
            {STAGES.map((s) => (
              <option key={s} value={s} />
            ))}
          </datalist>
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
              onChange={(e) => setHealthScore(Math.max(0, Math.min(100, Number(e.target.value) || 0)))}
            />
          </div>
        </Field>
        {/* 第 4 步：跨模块关联初始化（仅新建模式，审计 Phase 3 P2-8） */}
        {!customer && (
          <div className="mt-4 rounded-xl bg-surface-container-low/60 p-3">
            <StepHeader n={4} title="跨模块关联初始化" />
            <label className="flex cursor-pointer items-center gap-2 py-1.5 text-[13px]">
              <input
                type="checkbox"
                className="accent-primary"
                checked={initTodo}
                onChange={(e) => setInitTodo(e.target.checked)}
              />
              创建首联待办「首联跟进：{name.trim() || '该客户'}」（P2 · 今天）
            </label>
            <label className="flex cursor-pointer items-center gap-2 py-1.5 text-[13px]">
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
        {error && <div className="mb-3 text-[12px] text-danger">{error}</div>}
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="tonal" onClick={onClose}>
            取消
          </Button>
          <Button icon="save" onClick={save}>
            {customer ? '保存修改' : '立即创建客户'}
          </Button>
        </div>
      </div>
    </Drawer>
  )
}

/** 四步表单分组指示器（1 基础信息 / 2 分层标签 / 3 联系客情 / 4 关联初始化） */
function StepHeader({ n, title }: { n: number; title: string }) {
  return (
    <div className="mb-2.5 mt-4 flex items-center gap-2">
      <span className="flex h-5 w-5 items-center justify-center rounded-full bg-primary-fixed text-[11px] font-bold text-primary">
        {n}
      </span>
      <span className="text-[11px] font-semibold uppercase tracking-wide text-on-surface-variant">
        {title}
      </span>
    </div>
  )
}
