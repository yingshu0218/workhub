import { useRef, useState } from 'react'
import { useCollection } from '@/queries/hooks'
import { useFormReset } from '@/shared/useFormReset'
import { newId, saveTransactionWithAttachments } from '@/repositories'
import { normalizeOccurredAt } from '@/domain'
import type { PutInput } from '@/repositories/repository'
import type { Attachment } from '@/db/db'
import type { Customer, Ledger, Project, Todo, Transaction } from '@/db/types'
import { Button, Chip, Field, Modal, inputCls, useAutoFocus } from '@/design-system/ui'
import { toArchivedFlag } from '@/shared/search'
import { hiddenCustomerIds, useIntimacyConfig } from '@/modules/crm/intimacy'
import EntityLinkField from '@/design-system/EntityLinkField'
import ChannelSelect from '@/design-system/ChannelSelect'
import { aliveIdSet, pruneTxnLinkIds, txnLinksOf } from './links'
import { useTxnLinkIndex } from './hooks'
import dayjs from 'dayjs'
import { isTodoOpen } from '@/modules/todo/domain'
import { todoPriorityFullLabel } from '@/modules/todo/priority'

/**
 * 结算渠道候选（Issue #151）。
 *
 * 记账**不强制**归因到某个渠道：用户常常先记一笔、对账时才知道走的哪个渠道/哪张卡，
 * 所以新建表单默认「未指定」（空值），并且该字段非必填 —— 空值落库为 `''`
 * （与 §9.4 口径一致：`agent/schema.ts` 里 `channel` 本就是 optional）。
 * 空值项「未指定」由 `ChannelSelect` 内置，这里只列真实渠道。
 */
const CHANNEL_OPTIONS = [
  { value: '微信', label: '微信 / 微信支付', icon: 'qr_code' },
  { value: '支付宝', label: '支付宝', icon: 'qr_code' },
  { value: '银行卡', label: '银行卡 / 转账', icon: 'credit_card' },
  { value: '现金', label: '现金', icon: 'payments' },
  { value: '对公转账', label: '对公转账', icon: 'account_balance_wallet' },
]

const MAX_ATTACHMENT_SIZE = 5 * 1024 * 1024
/** 金额上限（元）：10 位数封顶 */
const MAX_AMOUNT = 9999999999

/**
 * 记一笔账 / 编辑流水抽屉（对齐原型 04-finance-new-transaction）
 *
 * Issue #140 改版：
 * - **整体 2 列分栏**（「能塞的塞 2 列、长字段整行」）：类型/备注/附件整行，其余两两成对；
 *   业务标签 / 关联客户 / 关联项目 / 关联待办 归入「辅助信息区」两两成对（Issue #151，
 *   原 4 个整行，窄字段半列足够）；
 * - **关联客户 / 项目 / 待办改多值芯片**（`EntityLinkField`），芯片 hover 弹 `EntityHoverCard` 摘要；
 * - 数据层走 Issue #140 方案 A（`customerIds/todoIds/projectIds` 数组）。
 */
export default function TransactionFormDrawer({
  open,
  defaultLedgerId,
  editTxn,
  elevated,
  onClose,
}: {
  open: boolean
  /** 当前选中的账本 id；'all' 表示全部账本（回落到第一个账本） */
  defaultLedgerId: string
  /** 传入则为编辑模式：以旧记录为基底展开，仅覆盖表单字段 */
  editTxn?: Transaction | null
  /** 从凭证详情抽屉内打开时传 true，抬到更高层级 */
  elevated?: boolean
  onClose: () => void
}) {
  const ledgers = useCollection<Ledger>('ledgers')
  // 流水关联索引（v15 起关联迁 links）：编辑态回填选择集用
  const txnLinkIndex = useTxnLinkIndex()
  const customers = useCollection<Customer>('customers')
  // 黑名单「单据选择器排除」（缺陷 D15）：被屏蔽客户不进候选，但**已关联的仍正常回显**
  // （只滤候选不滤 options —— 见 EntityLinkField.hiddenIds 的说明）
  const pickerHiddenIds = hiddenCustomerIds(customers, useIntimacyConfig(), 'excludeFromPicker')
  const projects = useCollection<Project>('projects')
  const todos = useCollection<Todo>('todos')
  const openTodos = todos.filter(isTodoOpen)
  const [type, setType] = useState<Transaction['type']>('income')
  const [ledgerId, setLedgerId] = useState('')
  const [channel, setChannel] = useState('')
  const [summary, setSummary] = useState('')
  const [amount, setAmount] = useState('')
  const [occurredAt, setOccurredAt] = useState('')
  const [tags, setTags] = useState<string[]>([])
  const [tagInput, setTagInput] = useState('')
  const [customerIds, setCustomerIds] = useState<string[]>([])
  const [todoIds, setTodoIds] = useState<string[]>([])
  const [projectIds, setProjectIds] = useState<string[]>([])
  const [note, setNote] = useState('')
  const [files, setFiles] = useState<File[]>([])
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [error, setError] = useState('')
  const summaryRef = useAutoFocus<HTMLInputElement>(open)

  // 打开时重置（收口 C-10：骨架走 useFormReset）；编辑模式以旧记录回填
  const openKey = `${open}-${defaultLedgerId}-${editTxn?.id ?? ''}`
  const { seedKey } = useFormReset(openKey, open, (isOpen) => {
    if (!isOpen) return
  if (editTxn) {
    setType(editTxn.type)
    setLedgerId(editTxn.ledgerId)
    setChannel(editTxn.channel ?? '')
    setSummary(editTxn.summary)
    setAmount(String(editTxn.amount))
    setOccurredAt(dayjs(editTxn.occurredAt).format('YYYY-MM-DD'))
    setTags(editTxn.tags)
    setTagInput('')
    // 多关联回填（v15 起关联迁 links）：编辑态初始选择集来自 related link 索引
    const links = txnLinksOf(txnLinkIndex, editTxn.id)
    setCustomerIds(links.customerIds)
    setTodoIds(links.todoIds)
    setProjectIds(links.projectIds)
    setNote(editTxn.note ?? '')
  } else {
    // 归属账本默认值：左侧选中具体账本直接用；「全部账本」优先默认账本，再回落第一个
    const initial =
      defaultLedgerId && defaultLedgerId !== 'all'
        ? defaultLedgerId
        : (ledgers.find((l) => l.isDefault)?.id ?? ledgers[0]?.id ?? '')
    setType('income')
    setLedgerId(initial)
    setChannel('')
    setSummary('')
    setAmount('')
    setOccurredAt(dayjs().format('YYYY-MM-DD'))
    setTags([])
    setTagInput('')
    setCustomerIds([])
    setTodoIds([])
    setProjectIds([])
    setNote('')
  }
  setFiles([])
  setError('')
  })

  // 待办候选：新建态=未完成待办；编辑态若已选待办已完成，单独并入 + sub 标注「已完成」，保证回显不丢
  const todoOptions: { id: string; label: string; sub?: string; icon?: string }[] = openTodos.map((t) => ({
    id: t.id,
    label: t.title,
    sub: todoPriorityFullLabel(t.priority),
    icon: 'task_alt',
  }))
  // 多值版「已完结待办回填」：任一已选待办不在未完成列表时，把它的已完成记录补进候选
  for (const id of todoIds) {
    if (openTodos.some((t) => t.id === id)) continue
    const done = todos.find((t) => t.id === id)
    if (done) todoOptions.push({ id: done.id, label: done.title, sub: '已完成', icon: 'task_alt' })
  }

  /** 回车 / 逗号 / 失焦 → 将输入固化为标签：去 #、去重、去空 */
  function commitTag(raw?: string) {
    const text = (raw ?? tagInput).trim().replace(/^#/, '')
    if (!text) {
      setTagInput('')
      return
    }
    if (!tags.includes(text)) setTags([...tags, text])
    setTagInput('')
  }

  /** 退格：输入框为空时删除末个标签 */
  function onTagKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault()
      commitTag()
    } else if (e.key === 'Backspace' && !tagInput && tags.length > 0) {
      setTags(tags.slice(0, -1))
    }
  }

  const submitLock = useRef(false)
  const draftId = useRef<string | null>(null)
  const draftCreatedAt = useRef<number | null>(null)
  const attachmentIds = useRef(new Map<File, string>())
  async function save() {
    if (submitLock.current) return
    if (!summary.trim()) {
      setError('请填写交易名称')
      return
    }
    const rawAmount = Number(amount.trim())
    if (!amount.trim() || !Number.isFinite(rawAmount) || rawAmount <= 0) {
      setError('金额必须为正数')
      return
    }
    if (rawAmount > MAX_AMOUNT) {
      setError(`单笔金额不能超过 ${MAX_AMOUNT.toLocaleString('zh-CN')}`)
      return
    }
    // 按分归整；归整后与输入不一致说明超过两位小数精度（如 0.001），拒绝保存
    const amountNum = Math.round(rawAmount * 100) / 100
    if (Math.abs(amountNum - rawAmount) > 1e-9) {
      setError('金额最多支持两位小数（如 0.01），请调整后重试')
      return
    }
    if (!ledgerId) {
      setError('请先创建账本')
      return
    }
    const oversized = files.find((f) => f.size > MAX_ATTACHMENT_SIZE)
    if (oversized) {
      setError(`附件「${oversized.name}」超过单文件 5MB 限制`)
      return
    }
    const txnId = editTxn?.id ?? (draftId.current ??= newId('txn'))
    // 记账时间口径走领域层 `normalizeOccurredAt`（仅日期录入 → 落当天 00:00）。
    // 该口径与 agentOps 的 fin_recordTransaction 同源一份实现（P1 补强：消除 UI/AI 两份内联拼接）。
    const occurredAtMs = normalizeOccurredAt(occurredAt)
    // 关联写入纪律（Issue #140）：去重 + 过滤已删实体（弱引用：实体不存在仅解绑，不报错）。
    // v15 起关联迁 links：选择集作为 related 传给 saveTransactionWithAttachments，
    // 与流水行同事务 diff 同步（syncRelatedLinks 二次校验端点存活）。
    const related = {
      customerIds: pruneTxnLinkIds(customerIds, aliveIdSet(customers)),
      todoIds: pruneTxnLinkIds(todoIds, aliveIdSet(todos)),
      projectIds: pruneTxnLinkIds(projectIds, aliveIdSet(projects)),
    }
    // 编辑模式以旧记录展开为基底，保留 status 等表单外字段
    const record: PutInput<Transaction> = editTxn
      ? {
          ...editTxn,
          ledgerId,
          type,
          amount: amountNum,
          summary: summary.trim(),
          channel,
          occurredAt: occurredAtMs,
          tags,
          note: note.trim() || undefined,
        }
      : {
          id: txnId,
          ledgerId,
          type,
          amount: amountNum,
          summary: summary.trim(),
          channel,
          occurredAt: occurredAtMs,
          tags,
          note: note.trim() || undefined,
          status: '待对账',
        }
    // 附件存根：Blob 入 attachments 表，归属（流水→附件）由 saveTransactionWithAttachments
    // 在同一事务里写 kind='attachment' 的 link（Phase 2 起附件不再自带 refType/refId）。
    // 类型用 PutInput：同步盖章（updatedAt/rev/deleted）由 saveTransactionWithAttachments
    // 在同一事务内统一盖（与 transactions 同款），这里不应自带。
    const attachments: PutInput<Attachment>[] = files.map((f) => ({
      id: attachmentIds.current.get(f) ?? (() => { const id = newId('att'); attachmentIds.current.set(f, id); return id })(),
      name: f.name,
      mime: f.type,
      size: f.size,
      blob: f,
      createdAt: (draftCreatedAt.current ??= Date.now()),
    }))
    submitLock.current = true
    try {
      // 事件（transaction:created）已下沉 saveTransactionWithAttachments：事务 commit 后、
      // 仅新建时发出（编辑不再误发，修 §9.5 bug1）。UI 侧不再内联 emit，避免双发。
      await saveTransactionWithAttachments(record, attachments, related)
      draftId.current = null
      draftCreatedAt.current = null
      onClose()
    } catch (e) {
      setError(e instanceof Error ? `保存失败：${e.message}` : '保存失败，请重试')
    } finally { submitLock.current = false }
  }

  return (
    <Modal
      open={open}
      title={editTxn ? '编辑流水' : '记一笔账'}
      onClose={onClose}
      elevated={elevated}
    >
      <div key={seedKey}>
        {/* 类型：整行（按钮组，塞半列会挤） */}
        <Field label="类型 *">
          <div className="flex gap-2">
            {(['income', 'expense'] as const).map((t) => (
              <button
                key={t}
                onClick={() => setType(t)}
                className={`rounded-lg border px-4 py-1.5 text-[0.9286rem] ${
                  type === t
                    ? 'border-primary bg-primary-fixed font-semibold text-primary'
                    : 'border-outline-variant text-on-surface-variant'
                }`}
              >
                {t === 'income' ? '收入' : '支出'}
              </button>
            ))}
          </div>
        </Field>

        {/* 以下字段 2 列分栏（Issue #140）：能塞的成对占位，长字段 col-span-2 整行 */}
        <div className="grid grid-cols-2 gap-x-4 gap-y-3">
          <Field label="归属账本 *">
            <select
              className={inputCls}
              value={ledgerId}
              onChange={(e) => setLedgerId(e.target.value)}
            >
              {ledgers.length === 0 && <option value="">暂无账本</option>}
              {ledgers.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
          </Field>
          {/* 结算渠道（Issue #151）：非必填、默认「未指定」。
              换成 ChannelSelect（受控单选浮层）而不是原生 select / MatchCombobox：
              原生 select 的展开态由系统绘制、与皮肤层脱节，且展开后点外部不触发 mousedown；
              MatchCombobox 空值文案是「不关联」（语义是解除关联）且可输入，不适合固定枚举单选。 */}
          <Field label="结算渠道">
            <ChannelSelect value={channel} options={CHANNEL_OPTIONS} onChange={setChannel} />
          </Field>

          {/* 交易名称：整行（摘要文案长，半列会截断） */}
          <div className="col-span-2">
            <Field label="交易名称 / 款项摘要 *">
              <input
                ref={summaryRef}
                className={inputCls}
                value={summary}
                onChange={(e) => setSummary(e.target.value)}
                placeholder="如：深蓝科技二期交付结算凭据"
              />
            </Field>
          </div>

          <Field label="金额 *">
            <input
              type="number"
              min={0}
              step="0.01"
              className={inputCls}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0.00"
            />
          </Field>
          <Field label="记账时间">
            <input
              type="date"
              className={inputCls}
              value={occurredAt}
              onChange={(e) => setOccurredAt(e.target.value)}
            />
          </Field>

          {/* 辅助信息区（Issue #151）：业务标签与关联三件套改 2 列分栏
              —— 原为 4 个整行，窄字段半列足够且能大幅压缩表单高度。
              业务标签与关联客户成对（首行），关联项目与关联待办成对（次行）；
              行内高度不一致时各自顶部对齐（items-start），避免被邻居拉高。
              列间距取 gap-2，与同级「col-span-2 内再分栏」口径一致
              （TodoPage 双栏区 / CustomerFormDrawer 客户关系区），
              避免叠加外层 gap-x-4 后比同级栅格窄一档。 */}
          <div
            data-testid="txn-aux-links"
            className="col-span-2 grid grid-cols-1 items-start gap-2 sm:grid-cols-2"
          >
            <Field label="业务标签">
              <div
                className={`${inputCls} flex min-h-[38px] cursor-text flex-wrap items-center gap-1.5`}
                onClick={(e) =>
                  (e.currentTarget.querySelector('input') as HTMLInputElement)?.focus()
                }
              >
                {tags.map((t) => (
                  <Chip key={t} tone="gray">
                    #{t}
                    <button
                      className="ml-0.5 text-outline hover:text-danger"
                      title="删除标签"
                      onClick={() => setTags(tags.filter((x) => x !== t))}
                    >
                      ×
                    </button>
                  </Chip>
                ))}
                <input
                  className="min-w-[120px] flex-1 bg-transparent text-[0.9286rem] outline-none"
                  value={tagInput}
                  onChange={(e) => setTagInput(e.target.value)}
                  onKeyDown={onTagKeyDown}
                  onBlur={() => commitTag()}
                  placeholder={tags.length === 0 ? '输入后回车确认，如：大客户回款' : ''}
                />
              </div>
            </Field>

            <Field label="关联客户">
              <EntityLinkField
                type="customer"
                icon="person"
                hiddenIds={pickerHiddenIds}
                value={customerIds}
                options={customers.map((c) => ({
                  id: c.id,
                  label: `${c.company} · ${c.name}`,
                  icon: 'person',
                }))}
                placeholder="输入公司或姓名模糊搜索，可多选"
                emptyText="没有可关联的客户"
                onChange={setCustomerIds}
              />
            </Field>

            <Field label="关联项目">
              <EntityLinkField
                type="project"
                icon="folder_open"
                value={projectIds}
                options={projects.map((p) => ({
                  id: p.id,
                  label: p.name,
                  sub: p.status === 'archived' ? '已归档' : undefined,
                  ...toArchivedFlag(p),
                  icon: 'folder_open',
                }))}
                placeholder="输入项目名称模糊搜索，可多选"
                emptyText="没有可关联的项目"
                onChange={setProjectIds}
              />
            </Field>

            <Field label="关联待办">
              <EntityLinkField
                type="todo"
                icon="task_alt"
                value={todoIds}
                options={todoOptions}
                placeholder="输入待办标题模糊搜索，可多选"
                emptyText={openTodos.length === 0 ? '暂无未完成待办' : '没有可关联的待办'}
                onChange={setTodoIds}
              />
            </Field>
          </div>

          {/* 备注 / 附件：整行 */}
          <div className="col-span-2">
            <Field label="备注">
              <textarea
                className={`${inputCls} h-20 resize-none`}
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
            </Field>
          </div>
          <div className="col-span-2">
            <Field label={`附件（${files.length} 个，单文件 ≤ 5MB）`}>
              <div>
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  className="hidden"
                  onChange={(e) => {
                    // 多选追加，不覆盖已选；同名文件跳过
                    const picked = Array.from(e.target.files ?? [])
                    setFiles((prev) => {
                      const merged = [...prev]
                      for (const f of picked) {
                        if (!merged.some((x) => x.name === f.name && x.size === f.size))
                          merged.push(f)
                      }
                      return merged
                    })
                    e.target.value = ''
                  }}
                />
                <Button
                  variant="tonal"
                  icon="upload_file"
                  onClick={() => fileInputRef.current?.click()}
                >
                  上传附件
                </Button>
              </div>
              {files.length > 0 && (
                <div className="mt-2 space-y-1.5">
                  {files.map((f, i) => (
                    <div
                      key={`${f.name}-${i}`}
                      className={`flex items-center justify-between rounded-lg border px-2.5 py-1.5 text-[0.8571rem] ${
                        f.size > MAX_ATTACHMENT_SIZE
                          ? 'border-danger/50 text-danger'
                          : 'border-outline-variant/40'
                      }`}
                    >
                      <span className="truncate">
                        {f.name}
                        <span className="ml-2 shrink-0 text-outline">
                          {(f.size / 1024).toFixed(0)} KB
                        </span>
                      </span>
                      <button
                        className="ml-2 shrink-0 text-outline hover:text-danger"
                        title="移除附件"
                        onClick={() => setFiles(files.filter((_, idx) => idx !== i))}
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </Field>
          </div>
        </div>

        {error && <div className="mb-3 text-[0.8571rem] text-danger">{error}</div>}
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="tonal" onClick={onClose}>
            取消
          </Button>
          <Button icon="save" onClick={save}>
            {editTxn ? '保存修改' : '立即保存此笔流水'}
          </Button>
        </div>
      </div>
    </Modal>
  )
}
