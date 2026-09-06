import { useState } from 'react'
import { customerRepo, newId } from '@/repositories'
import type { Customer } from '@/db/types'
import { Button, Chip, Drawer, Field, inputCls } from '@/design-system/ui'

const DECISION_LEVELS: Customer['decisionLevel'][] = ['决策人', '影响者', '使用者', '把关人']
const TIERS: Customer['tier'][] = ['S', 'A', 'B', '潜在']
const STAGES = ['潜在接触', '需求确认', '方案沟通中', '合同 negotiation', '已成交 · 维护期', '久未跟进']

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
      setError('')
      setSeedKey((k) => k + 1)
    }
  }

  const tags = tagsRaw
    .split(/[,,]/)
    .map((t) => t.trim().replace(/^#/, ''))
    .filter(Boolean)

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
      await customerRepo.put({
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
      })
    }
    onClose()
  }

  return (
    <Drawer open={open} title={customer ? '编辑客户档案' : '新建客户档案'} onClose={onClose} width={460}>
      <div key={seedKey}>
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
              onChange={(e) => setHealthScore(Number(e.target.value))}
            />
          </div>
        </Field>
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
