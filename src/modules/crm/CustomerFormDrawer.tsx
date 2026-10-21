import { useState } from 'react'
import { useCollection } from '@/queries/hooks'
import { customerRepo, newId } from '@/repositories'
import type { Customer, CustomerRelation, RelationCategory, Transaction } from '@/db/types'
import { RELATION_CATEGORIES } from '@/db/types'
import { Button, Field, Modal, inputCls, useAutoFocus } from '@/design-system/ui'
import { useFormReset } from '@/shared/useFormReset'
import { Icon } from '@/design-system/Icon'
import { MatchCombobox } from '@/design-system/MatchCombobox'
import ChipTagInput, { chipTagStyle, mergeDraftInto } from '@/design-system/ChipTagInput'
import { createCustomerWithInit } from './hooks'
import { txnCustomerIds } from '@/modules/finance/links'
import { canonicalTags } from '@/shared/tags'

/** 单条关系的稳定标识（Issue #39）：优先取条目 id，旧数据按 目标::语义 兜底（同对允许多条，可逐条删除） */
const relKey = (r: { id?: string; targetId: string; label: string }) =>
  r.id ?? `${r.targetId}::${r.label}`

/** 手动输入的客户名消解：精确名 → 公司名唯一命中 → 名字唯一包含；同名多人不猜（消解优先） */
function resolveTarget(
  raw: string,
  candidates: Customer[],
): { ok: true; record: Customer } | { ok: false; message: string } {
  const text = raw.trim()
  if (!text) return { ok: false, message: '请先输入关联客户' }
  const byName = candidates.filter((c) => c.name === text)
  if (byName.length === 1) return { ok: true, record: byName[0] }
  if (byName.length > 1) return { ok: false, message: `「${text}」有 ${byName.length} 位同名客户` }
  const fuzzy = candidates.filter((c) => c.name.includes(text) || c.company.includes(text))
  if (fuzzy.length === 1) return { ok: true, record: fuzzy[0] }
  if (fuzzy.length > 1) return { ok: false, message: `「${text}」匹配到 ${fuzzy.length} 位客户` }
  return { ok: false, message: `未找到客户「${text}」` }
}

const DECISION_LEVELS: Customer['decisionLevel'][] = ['决策人', '影响者', '使用者', '把关人']

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
  const [tags, setTags] = useState<string[]>([])
  /** 标签输入框里尚未敲下分隔符的草稿（保存时一并结算，避免「输了没回车就点保存」丢标签） */
  const [pendingTags, setPendingTags] = useState('')
  const [phone, setPhone] = useState('')
  const [wechat, setWechat] = useState('')
  const [email, setEmail] = useState('')
  const [address, setAddress] = useState('')
  // 关联客户维护区（新建/编辑均可用）：目标只能落到已有客户，杜绝自由造目标 id 产生画布悬挂边。
  // 交互改为芯片标签手动输入（用户需求）：客户名与关系语义各是一组可删芯片，回车/逗号固化。
  // 新建时新客户尚未入库，候选天然不含自身；编辑时候选以 id 显式排除自己。
  const [relations, setRelations] = useState<CustomerRelation[]>([])
  const [relTargets, setRelTargets] = useState<string[]>([])
  const [relLabels, setRelLabels] = useState<string[]>([])
  /**
   * 关系区两个输入框里尚未敲下分隔符的草稿（保存时一并结算）。
   * 与 pendingTags 同理：控件不做失焦固化，草稿的归属由保存路径决定。
   * 漏接这两个上报会造成「输了客户名/语义直接点保存 → 静默丢失」，
   * 与表单自带提示「无需点添加关系也行，保存时会自动配对」矛盾（功能测试 #144）。
   */
  const [pendingRelTargets, setPendingRelTargets] = useState('')
  const [pendingRelLabels, setPendingRelLabels] = useState('')
  const [relCategory, setRelCategory] = useState<RelationCategory | ''>('')
  // 第 4 步「跨模块关联初始化」状态（仅新建模式展示）
  const [initLog, setInitLog] = useState(false)
  const [initTxnId, setInitTxnId] = useState('')
  const [error, setError] = useState('')
  // 打开时聚焦姓名且不滚动页面
  const nameRef = useAutoFocus<HTMLInputElement>(open)

  // 打开时重置（收口 C-10：骨架走 useFormReset）
  const openKey = `${open}-${customer?.id ?? 'new'}`
  const { seedKey } = useFormReset(openKey, open, (isOpen) => {
    if (!isOpen) return
  setName(customer?.name ?? '')
  setCompany(customer?.company ?? '')
  setTitle(customer?.title ?? '')
  setDecisionLevel(customer?.decisionLevel ?? '决策人')
  setTags(customer?.tags ?? [])
  setPhone(customer?.phone ?? '')
  setWechat(customer?.wechat ?? '')
  setEmail(customer?.email ?? '')
  setAddress(customer?.address ?? '')
  setRelations(customer?.relations ?? [])
  setPendingTags('')
  setRelTargets([])
  setRelLabels([])
  setPendingRelTargets('')
  setPendingRelLabels('')
  setRelCategory('')
  setInitLog(false)
  setInitTxnId('')
  setError('')
  })

  // 第 4 步可关联的交易：仅列出尚未归属任何客户的流水（已关联的可通过财务侧改）
  const transactions = useCollection<Transaction>('transactions')
  // 多关联（Issue #140）：已关联任一客户的流水不再出现在候选（避免重复挂靠）
  const linkableTxns = transactions.filter((t) => txnCustomerIds(t).length === 0)

  // 关联客户候选：所有未删除客户（排除自己），只能从这里选目标
  const customers = useCollection<Customer>('customers')
  const relCandidates = customers.filter((c) => !customer || c.id !== customer.id)
  const REL_LABELS = ['转介绍人', '同一公司', '上下游', '竞对参照', '其他']

  /**
   * 把「输入框里的客户名 × 语义」配对成关系条目（单一来源）。
   * 两条路径共用：点「添加关系」显式提交、以及保存时结算遗留草稿。
   * 未解析出的客户名不静默丢弃，走 hints 回显（已解析到的照常写入）。
   */
  function pairPendingRelations(
    targetsRaw: string[],
    labelsRaw: string[],
  ): { added: CustomerRelation[]; hints: string[] } {
    const hints: string[] = []
    const targets: Customer[] = []
    for (const raw of targetsRaw) {
      const hit = resolveTarget(raw, relCandidates)
      if (hit.ok) {
        if (!targets.some((t) => t.id === hit.record.id)) targets.push(hit.record)
      } else hints.push(hit.message)
    }
    if (targets.length === 0) {
      if (hints.length === 0) hints.push('请先输入关联客户')
      return { added: [], hints }
    }
    const labels = labelsRaw.length > 0 ? labelsRaw : ['其他']
    const added: CustomerRelation[] = []
    for (const t of targets) {
      for (const l of labels) {
        // 条目独立 id：支撑同对多语义并存、逐条删除与列表 key；category 可选（Issue #34）
        added.push({
          id: newId('rel'),
          targetId: t.id,
          label: l,
          ...(relCategory ? { category: relCategory } : {}),
        })
      }
    }
    return { added, hints }
  }

  /** 把待配对条目并入现有关系（同「目标 + 语义」判重，Issue #39 允许多语义并存） */
  function withDedup(base: CustomerRelation[], added: CustomerRelation[]): CustomerRelation[] {
    const next = [...base]
    for (const r of added) {
      if (next.some((x) => x.targetId === r.targetId && x.label === r.label)) continue
      next.push(r)
    }
    return next
  }

  /**
   * 结算输入框草稿（保存路径）：
   * 控件现在「敲分隔符即固化」，正常不会有遗留草稿；但用户可能输入完直接点保存
   * （既不回车也不敲逗号）——此时若忽略草稿，观感依然是「保存不生效」。
   * 故保存前显式结算一次：标签并入 tags，客户名 × 语义配对并入 relations。
   */
  function settleDrafts(): { tags: string[]; relations: CustomerRelation[]; error: string } {
    // 标签走「标签语义」的唯一归一化（折叠大小写与 # 前缀）：
    // ① 并入未固化的草稿 ② 让存量里的旧写法（如 VIP）在下次保存时自然收敛为规范形式，
    // 避免标签栏出现 VIP / vip 两枚看起来一样的芯片（功能测试 #32）。
    const nextTags = canonicalTags(mergeDraftInto(tags, pendingTags))
    // 关系区同样结算草稿（功能测试 #144）：客户名与语义各按控件同款口径解析
    // （mergeDraftInto = 已固化片段 + 未固化草稿，逗号切分 + trim + 去空 + 去重，
    //  与控件回车路径完全一致）。注意关系**不是标签**，不折叠大小写。
    const pendingRelationDrafts = mergeDraftInto(relTargets, pendingRelTargets)
    if (pendingRelationDrafts.length === 0) {
      return { tags: nextTags, relations, error: '' }
    }
    const labels = mergeDraftInto(relLabels, pendingRelLabels)
    const { added, hints } = pairPendingRelations(pendingRelationDrafts, labels)
    return { tags: nextTags, relations: withDedup(relations, added), error: hints.join('；') }
  }

  /** 「添加关系」的显式确认：把草稿配对写入下方列表（列表本身就是可删芯片） */
  function commitRelations() {
    const { added, hints } = pairPendingRelations(relTargets, relLabels)
    if (added.length === 0) {
      setError(hints.join('；'))
      return
    }
    setRelations(withDedup(relations, added))
    setRelTargets([])
    setRelLabels([])
    setError(hints.join('；'))
  }

  async function save() {
    if (!name.trim()) {
      setError('请填写客户姓名')
      return
    }
    // 保存前结算草稿：手输完直接点保存也不丢（关系按 客户名 × 语义 配对，标签并入）
    const settled = settleDrafts()
    if (settled.error) {
      // 未解析出的客户名回显给用户（不静默丢弃），但已解析到的关系照常保存
      setError(settled.error)
    }
    // 错误处理（审计 P1：此前无 try/catch，落库失败的 Promise 无人处理）——
    // 配额超限 / 隐私模式 / IndexedDB 被回收时用户只看到「点保存没反应、抽屉不关」，
    // 静默失败且零提示。对齐 TransactionFormDrawer 的做法，失败转为可读错误。
    try {
      if (customer) {
        // 编辑：旧记录为基底，只覆盖表单字段（保留 createdAt 等）
        await customerRepo.put({
          ...customer,
          name: name.trim(),
          company: company.trim(),
          title: title.trim(),
          decisionLevel,
          tags: settled.tags,
          phone: phone.trim(),
          wechat: wechat.trim(),
          email: email.trim(),
          address: address.trim(),
          relations: settled.relations,
        })
      } else {
        const record = {
          id: newId('cus'),
          name: name.trim(),
          company: company.trim(),
          title: title.trim(),
          decisionLevel,
          tags: settled.tags,
          phone: phone.trim(),
          wechat: wechat.trim(),
          email: email.trim(),
          address: address.trim(),
          lastContactAt: Date.now(),
          createdAt: Date.now(),
          // 新建即关联：与编辑同一份 relations 状态，随记录一并落库（Issue #132）
          ...(settled.relations.length > 0 ? { relations: settled.relations } : {}),
        }
        // 新建走「建档 + 关联初始化」同事务数据层函数，杜绝多步写半成品
        await createCustomerWithInit(record as Customer, {
          openingLog: initLog,
          linkTransactionId: initTxnId || undefined,
        })
      }
      onClose()
    } catch (e) {
      setError(e instanceof Error ? `保存失败：${e.message}` : '保存失败，请重试')
    }
  }

  return (
    <Modal open={open} title={customer ? '编辑客户档案' : '新建客户档案'} onClose={onClose}>
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
        <StepHeader n={2} title="标签" />
        <Field label="标签（回车或逗号即固化）">
          <ChipTagInput
            value={tags}
            onChange={setTags}
            onDraftChange={setPendingTags}
            placeholder="输入后回车确认，如：高客单潜力"
            maxCount={20}
            onOverflow={() => setError('标签最多 20 个')}
          />
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
        {/* 关联客户维护区（新建/编辑共用）：
            交互按用户要求改为「芯片标签式手动输入」——关系列表就是一组可删芯片，
            下方两块 ChipTagInput 负责手动输入（客户名 / 关系语义），回车或逗号即固化（客户名/标签里的空格不会被拆开）。
            不再用下拉 + 弹层：抽屉里再叠弹层会把表单输入状态顶掉，关掉后与表单不同步。
            目标仍只能从已有客户选择（联想候选 + 唯一命中考验），杜绝自由造 id 产生画布悬挂边。 */}
        <div className="mt-4 rounded-xl bg-surface-container-low/60 p-3">
          <StepHeader n={4} title="客户关系" />
          <div className="mb-2 text-[0.8571rem] text-on-surface-variant">
            输入客户名与关系语义（回车或逗号即固化，无需点「添加关系」也行 ——
            保存时会自动配对），点「添加关系」可立即把两者两两配对写入下方列表。
          </div>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <Field label="关联客户（可手输名，或点联想）">
              <ChipTagInput
                value={relTargets}
                onChange={setRelTargets}
                onDraftChange={setPendingRelTargets}
                placeholder="输入客户名，回车或逗号固化"
                onOverflow={() => setError('一次最多添加 5 位关联客户')}
              />
            </Field>
            <Field label="关系语义（回车或逗号即固化）">
              <ChipTagInput
                value={relLabels}
                onChange={setRelLabels}
                onDraftChange={setPendingRelLabels}
                placeholder="如：转介绍人 / 同一公司"
                onOverflow={() => setError('一次最多添加 5 个关系语义')}
              />
            </Field>
          </div>
          <div className="mb-2 flex flex-wrap items-center gap-1.5">
            <span className="text-[0.7857rem] text-outline">常用：</span>
            {REL_LABELS.map((l) => (
              <button
                key={l}
                className="rounded-full border border-outline-variant px-2 py-0.5 text-[0.8214rem] text-on-surface-variant transition-colors hover:border-primary hover:text-primary"
                onClick={() => setRelLabels((ls) => (ls.includes(l) ? ls : [...ls, l]))}
              >
                {l}
              </button>
            ))}
          </div>
          <div className="mb-2 flex flex-wrap items-center gap-1.5">
            <span className="text-[0.7857rem] text-outline">客户联想：</span>
            {relCandidates.slice(0, 6).map((c) => (
              <button
                key={c.id}
                className="rounded-full border border-outline-variant px-2 py-0.5 text-[0.8214rem] text-on-surface-variant transition-colors hover:border-primary hover:text-primary"
                onClick={() => setRelTargets((ts) => (ts.includes(c.name) ? ts : [...ts, c.name]))}
              >
                {c.name}
              </button>
            ))}
            {relCandidates.length === 0 && (
              <span className="text-[0.7857rem] text-outline">暂无可关联的客户</span>
            )}
          </div>
          <div className="mb-3">
            <div className="mb-1.5 text-[0.8571rem] font-medium text-on-surface-variant">
              归类（可选，用于图谱连线分组着色）
            </div>
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
          </div>
          <Button variant="tonal" icon="add" onClick={commitRelations}>
            添加关系
          </Button>
          {relations.length > 0 && (
            <Button
              variant="ghost"
              icon="close"
              className="ml-2"
              onClick={() => {
                setRelations([])
                setError('')
              }}
            >
              清空关系
            </Button>
          )}
          <div className="mt-3 flex flex-wrap gap-1.5">
            {relations.length === 0 && (
              <span className="text-[0.7857rem] text-outline">当前无关联客户</span>
            )}
            {relations.map((r) => {
              const target = customers.find((c) => c.id === r.targetId)
              const catName = RELATION_CATEGORIES.find((c) => c.id === r.category)?.name
              const label = `${target ? target.name : r.targetId} · ${r.label}${
                catName ? `（${catName}）` : ''
              }`
              return (
                <span
                  key={relKey(r)}
                  className="flex items-center gap-0.5 rounded-full px-2.5 py-0.5 text-[0.8571rem] font-medium"
                  style={chipTagStyle(r.label)}
                >
                  <Icon name="link" size={13} />
                  {label}
                  <button
                    className="ml-0.5 opacity-60 transition-opacity hover:opacity-100"
                    title="移除该条关联"
                    onClick={() => setRelations((rs) => rs.filter((x) => relKey(x) !== relKey(r)))}
                  >
                    ×
                  </button>
                </span>
              )
            })}
          </div>
        </div>
        {/* 第 5 步：跨模块关联初始化（仅新建模式，审计 Phase 3 P2-8） */}
        {!customer && (
          <div className="mt-4 rounded-xl bg-surface-container-low/60 p-3">
            <StepHeader n={5} title="跨模块关联初始化" />
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
