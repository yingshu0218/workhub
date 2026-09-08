import { useState } from 'react'
import { useCollection } from '@/queries/hooks'
import { newId, saveTransactionWithAttachments } from '@/repositories'
import { eventBus } from '@/shared/eventBus'
import type { PutInput } from '@/repositories/repository'
import type { Attachment } from '@/db/db'
import type { Customer, Ledger, Project, Todo, Transaction } from '@/db/types'
import { Button, Chip, Drawer, Field, inputCls } from '@/design-system/ui'
import { MatchCombobox, type MatchOption } from '@/design-system/MatchCombobox'
import dayjs from 'dayjs'

const CHANNELS = ['微信', '支付宝', '银行卡', '现金', '对公转账'] as const
const MAX_ATTACHMENT_SIZE = 5 * 1024 * 1024
/** 金额上限（元）：10 位数封顶 */
const MAX_AMOUNT = 9999999999

/** 记一笔账 / 编辑流水抽屉（对齐原型 04-finance-new-transaction） */
export default function TransactionFormDrawer({
  open,
  defaultLedgerId,
  editTxn,
  onClose,
}: {
  open: boolean
  /** 当前选中的账本 id；'all' 表示全部账本（回落到第一个账本） */
  defaultLedgerId: string
  /** 传入则为编辑模式：以旧记录为基底展开，仅覆盖表单字段 */
  editTxn?: Transaction | null
  onClose: () => void
}) {
  const ledgers = useCollection<Ledger>('ledgers')
  const customers = useCollection<Customer>('customers')
  const projects = useCollection<Project>('projects')
  const todos = useCollection<Todo>('todos')
  const openTodos = todos.filter((t) => t.status !== 'done')
  const [type, setType] = useState<Transaction['type']>('income')
  const [ledgerId, setLedgerId] = useState('')
  const [channel, setChannel] = useState<(typeof CHANNELS)[number]>('微信')
  const [summary, setSummary] = useState('')
  const [amount, setAmount] = useState('')
  const [occurredAt, setOccurredAt] = useState('')
  const [tagsRaw, setTagsRaw] = useState('')
  const [customerId, setCustomerId] = useState('')
  const [todoId, setTodoId] = useState('')
  const [projectId, setProjectId] = useState('')
  const [invoiceNo, setInvoiceNo] = useState('')
  const [note, setNote] = useState('')
  const [files, setFiles] = useState<File[]>([])
  const [error, setError] = useState('')
  const [seedKey, setSeedKey] = useState(0)

  // 打开时重置（渲染期重置模式，同 TodoFormDrawer）；编辑模式以旧记录回填
  const openKey = `${open}-${defaultLedgerId}-${editTxn?.id ?? ''}`
  const [lastKey, setLastKey] = useState('')
  if (openKey !== lastKey) {
    setLastKey(openKey)
    if (open) {
      if (editTxn) {
        setType(editTxn.type)
        setLedgerId(editTxn.ledgerId)
        setChannel(editTxn.channel as (typeof CHANNELS)[number])
        setSummary(editTxn.summary)
        setAmount(String(editTxn.amount))
        setOccurredAt(dayjs(editTxn.occurredAt).format('YYYY-MM-DDTHH:mm'))
        setTagsRaw(editTxn.tags.join(', '))
        setCustomerId(editTxn.customerId ?? '')
        setTodoId(editTxn.todoId ?? '')
        setProjectId(editTxn.projectId ?? '')
        setInvoiceNo(editTxn.invoiceNo ?? '')
        setNote(editTxn.note ?? '')
      } else {
        const fallback = ledgers[0]?.id ?? ''
        const initial = defaultLedgerId && defaultLedgerId !== 'all' ? defaultLedgerId : fallback
        setType('income')
        setLedgerId(initial)
        setChannel('微信')
        setSummary('')
        setAmount('')
        setOccurredAt(dayjs().format('YYYY-MM-DDTHH:mm'))
        setTagsRaw('')
        setCustomerId('')
        setTodoId('')
        setProjectId('')
        setInvoiceNo('')
        setNote('')
      }
      setFiles([])
      setError('')
      setSeedKey((k) => k + 1)
    }
  }

  // 待办候选：新建态=未完成待办；编辑态若已选待办已完成，单独并入 + sub 标注「已完成」，保证回显不丢
  const todoOptions: MatchOption[] = openTodos.map((t) => ({
    id: t.id,
    label: t.title,
    sub: t.priority,
    icon: 'task_alt',
  }))
  if (editTxn?.todoId && !openTodos.some((t) => t.id === editTxn.todoId)) {
    const done = todos.find((t) => t.id === editTxn.todoId)
    if (done) todoOptions.push({ id: done.id, label: done.title, sub: '已完成', icon: 'task_alt' })
  }

  const tags = [
    ...new Set(
      tagsRaw
        .split(/[,,]/)
        .map((t) => t.trim().replace(/^#/, ''))
        .filter(Boolean),
    ),
  ]

  async function save() {
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
    const txnId = editTxn?.id ?? newId('txn')
    // 编辑模式以旧记录展开为基底，保留 status/todoId 等表单外字段
    const record: PutInput<Transaction> = editTxn
      ? {
          ...editTxn,
          ledgerId,
          type,
          amount: amountNum,
          summary: summary.trim(),
          channel,
          occurredAt: occurredAt ? dayjs(occurredAt).valueOf() : Date.now(),
          tags,
          invoiceNo: invoiceNo.trim() || undefined,
          note: note.trim() || undefined,
          customerId: customerId || undefined,
          todoId: todoId || undefined,
          projectId: projectId || undefined,
        }
      : {
          id: txnId,
          ledgerId,
          type,
          amount: amountNum,
          summary: summary.trim(),
          channel,
          occurredAt: occurredAt ? dayjs(occurredAt).valueOf() : Date.now(),
          tags,
          invoiceNo: invoiceNo.trim() || undefined,
          note: note.trim() || undefined,
          customerId: customerId || undefined,
          todoId: todoId || undefined,
          projectId: projectId || undefined,
          status: '待对账',
        }
    // 附件存根：Blob 入 attachments 表，refId 指向交易；与交易同事务原子落库
    const attachments: Attachment[] = files.map((f) => ({
      id: newId('att'),
      refType: 'transaction',
      refId: txnId,
      name: f.name,
      mime: f.type,
      size: f.size,
      blob: f,
      createdAt: Date.now(),
    }))
    try {
      await saveTransactionWithAttachments(record, attachments)
      // 广播交易创建事件，供跨模块联动（如规则引擎、战成就）消费
      eventBus.emit('transaction:created', {
        transactionId: txnId,
        customerId: customerId || undefined,
      })
      onClose()
    } catch (e) {
      setError(e instanceof Error ? `保存失败：${e.message}` : '保存失败，请重试')
    }
  }

  return (
    <Drawer open={open} title={editTxn ? '编辑流水' : '记一笔账'} onClose={onClose} width={460}>
      <div key={seedKey}>
        <Field label="类型 *">
          <div className="flex gap-2">
            {(['income', 'expense'] as const).map((t) => (
              <button
                key={t}
                onClick={() => setType(t)}
                className={`rounded-lg border px-4 py-1.5 text-[13px] ${
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
        <div className="grid grid-cols-2 gap-3">
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
          <Field label="结算渠道 *">
            <select
              className={inputCls}
              value={channel}
              onChange={(e) => setChannel(e.target.value as (typeof CHANNELS)[number])}
            >
              {CHANNELS.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <Field label="交易名称 / 款项摘要 *">
          <input
            className={inputCls}
            value={summary}
            onChange={(e) => setSummary(e.target.value)}
            placeholder="如：深蓝科技二期交付结算凭据"
            autoFocus
          />
        </Field>
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
            type="datetime-local"
            className={inputCls}
            value={occurredAt}
            onChange={(e) => setOccurredAt(e.target.value)}
          />
        </Field>
        <Field label="业务标签（逗号分隔）">
          <input
            className={inputCls}
            value={tagsRaw}
            onChange={(e) => setTagsRaw(e.target.value)}
            placeholder="大客户回款, 合同款, 核心战略"
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
        <Field label="关联客户">
          <MatchCombobox
            value={customerId}
            options={customers.map((c) => ({
              id: c.id,
              label: `${c.company} · ${c.name}`,
              icon: 'person',
            }))}
            placeholder="输入公司或姓名模糊搜索，如：深蓝"
            emptyText="没有匹配的客户"
            onChange={setCustomerId}
          />
        </Field>
        <Field label="关联项目">
          <MatchCombobox
            value={projectId}
            options={projects.map((p) => ({
              id: p.id,
              label: p.name,
              sub: p.status === 'archived' ? '已归档' : undefined,
              archived: p.status === 'archived',
              icon: 'folder_open',
            }))}
            placeholder="输入项目名称模糊搜索"
            emptyText="没有匹配的项目"
            onChange={setProjectId}
          />
        </Field>
        <Field label="关联待办">
          <MatchCombobox
            value={todoId}
            options={todoOptions}
            placeholder="输入待办标题模糊搜索"
            emptyText={openTodos.length === 0 ? '暂无未完成待办' : '没有匹配的待办'}
            onChange={setTodoId}
          />
        </Field>
        <Field label="发票号">
          <input
            className={inputCls}
            value={invoiceNo}
            onChange={(e) => setInvoiceNo(e.target.value)}
            placeholder="如：INV-2026-0892"
          />
        </Field>
        <Field label="备注">
          <textarea
            className={`${inputCls} h-20 resize-none`}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </Field>
        <Field label={`附件存根（${files.length} 个，单文件 ≤ 5MB）`}>
          <input
            type="file"
            multiple
            className={`${inputCls} py-1.5`}
            onChange={(e) => {
              setFiles(Array.from(e.target.files ?? []))
              e.target.value = ''
            }}
          />
          {files.length > 0 && (
            <div className="mt-2 space-y-1.5">
              {files.map((f, i) => (
                <div
                  key={`${f.name}-${i}`}
                  className={`flex items-center justify-between rounded-lg border px-2.5 py-1.5 text-[12px] ${
                    f.size > MAX_ATTACHMENT_SIZE
                      ? 'border-danger/50 text-danger'
                      : 'border-outline-variant/40'
                  }`}
                >
                  <span className="truncate">{f.name}</span>
                  <span className="ml-2 shrink-0 text-outline">
                    {(f.size / 1024).toFixed(0)} KB
                  </span>
                </div>
              ))}
            </div>
          )}
        </Field>
        {error && <div className="mb-3 text-[12px] text-danger">{error}</div>}
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="tonal" onClick={onClose}>
            取消
          </Button>
          <Button icon="save" onClick={save}>
            {editTxn ? '保存修改' : '立即保存此笔流水'}
          </Button>
        </div>
      </div>
    </Drawer>
  )
}
