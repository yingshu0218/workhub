import { useEffect, useRef, useState } from 'react'
import { Icon } from '@/design-system/Icon'
import { useCollection } from '@/queries/hooks'
import { newId, saveTransactionWithAttachments } from '@/repositories'
import { eventBus } from '@/shared/eventBus'
import type { PutInput } from '@/repositories/repository'
import type { Attachment } from '@/db/db'
import type { Customer, Ledger, Project, Todo, Transaction } from '@/db/types'
import { Button, Chip, Drawer, Field, inputCls } from '@/design-system/ui'
import dayjs from 'dayjs'

const CHANNELS = ['微信', '支付宝', '银行卡', '现金', '对公转账'] as const
const MAX_ATTACHMENT_SIZE = 5 * 1024 * 1024
/** 金额上限（元）：10 位数封顶 */
const MAX_AMOUNT = 9999999999

/** 模糊匹配：全部子序列命中即算匹配（如「深科」命中「深蓝科技」），优先级：前缀 > 子串 > 子序列 */
function fuzzyMatch(text: string, query: string): boolean {
  const t = text.toLowerCase()
  const q = query.toLowerCase().trim()
  if (!q) return true
  const idx = t.indexOf(q)
  if (idx >= 0) return true
  // 子序列回退
  let i = 0
  for (const ch of t) {
    if (ch === q[i]) i++
    if (i >= q.length) return true
  }
  return false
}

/** 按匹配质量排序：子串命中在前，同质量按原顺序 */
function fuzzySort<T>(items: T[], labelOf: (item: T) => string, query: string): T[] {
  const q = query.toLowerCase().trim()
  if (!q) return items
  return [...items]
    .map((item, i) => ({ item, i, score: labelOf(item).toLowerCase().indexOf(q) }))
    .sort((a, b) => {
      if (a.score !== b.score) {
        if (a.score < 0) return 1
        if (b.score < 0) return -1
        return a.score - b.score
      }
      return a.i - b.i
    })
    .map((x) => x.item)
}

interface MatchOption {
  id: string
  /** 主文案（客户：公司 · 姓名；待办：标题） */
  label: string
  /** 次要文案（待办优先级等） */
  sub?: string
  icon?: string
}

/**
 * 可输入模糊匹配下拉（关联客户 / 关联待办共用）：
 * 手动输入即时过滤（子串 + 子序列），无输入展开全量候选；键盘 ↑↓ 选择、Enter 确认、Esc 关闭；
 * 点选候选项后清空输入框并显示已选回显条（可清除）；「不关联」选项置于列表首位。
 */
function MatchCombobox({
  value,
  options,
  placeholder,
  emptyText,
  onChange,
}: {
  value: string
  options: MatchOption[]
  placeholder: string
  emptyText: string
  onChange: (id: string) => void
}) {
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [activeIdx, setActiveIdx] = useState(0)
  const boxRef = useRef<HTMLDivElement>(null)

  const selected = options.find((o) => o.id === value)
  const filtered = fuzzySort(
    options.filter((o) => fuzzyMatch(o.label, query)),
    (o) => o.label,
    query,
  )
  // 「不关联」恒在首位（仅无已选时展示）
  const listItems: MatchOption[] = selected ? filtered : [{ id: '', label: '不关联' }, ...filtered]
  const safeIdx = Math.min(activeIdx, Math.max(0, listItems.length - 1))

  // 点外部关闭
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  function commit(id: string) {
    onChange(id)
    setQuery('')
    setOpen(false)
  }

  function onKey(e: React.KeyboardEvent) {
    if (!open) {
      if (e.key === 'ArrowDown' || e.key === 'Enter') {
        setOpen(true)
        e.preventDefault()
      }
      return
    }
    if (e.key === 'ArrowDown') {
      setActiveIdx(Math.min(safeIdx + 1, listItems.length - 1))
      e.preventDefault()
    } else if (e.key === 'ArrowUp') {
      setActiveIdx(Math.max(safeIdx - 1, 0))
      e.preventDefault()
    } else if (e.key === 'Enter') {
      const item = listItems[safeIdx]
      if (item) commit(item.id)
      e.preventDefault()
    } else if (e.key === 'Escape') {
      setOpen(false)
    }
  }

  return (
    <div ref={boxRef} className="relative">
      {/* 已选回显条 */}
      {selected ? (
        <div className="flex items-center justify-between rounded-lg border border-outline-variant/40 bg-surface-container-low px-3 py-2">
          <span className="flex min-w-0 items-center gap-2 text-[13px]">
            <Icon name={selected.icon ?? 'person'} size={16} className="shrink-0 text-primary" />
            <span className="truncate font-medium">{selected.label}</span>
            {selected.sub && (
              <span className="shrink-0 text-[11px] text-outline">{selected.sub}</span>
            )}
          </span>
          <button
            className="shrink-0 rounded p-0.5 text-outline transition-colors hover:bg-surface-container-high hover:text-on-surface"
            title="清除关联"
            onClick={() => commit('')}
          >
            <Icon name="close" size={16} />
          </button>
        </div>
      ) : (
        <input
          className={inputCls}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value)
            setOpen(true)
            setActiveIdx(0)
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKey}
          placeholder={placeholder}
        />
      )}
      {open && !selected && (
        <div className="absolute z-30 mt-1 max-h-56 w-full overflow-y-auto rounded-lg border border-outline-variant/40 bg-surface-container-lowest py-1 shadow-lg">
          {listItems.length === 0 ? (
            <div className="px-3 py-2 text-[12px] text-outline">{emptyText}</div>
          ) : (
            listItems.map((o, i) => (
              <button
                key={o.id || '__none__'}
                onClick={() => commit(o.id)}
                onMouseEnter={() => setActiveIdx(i)}
                className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-[13px] transition-colors ${
                  i === safeIdx ? 'bg-primary-fixed text-primary' : 'hover:bg-surface-container'
                }`}
              >
                <Icon
                  name={o.id ? (o.icon ?? 'person') : 'block'}
                  size={15}
                  className="shrink-0 text-outline"
                />
                <span className="min-w-0 flex-1 truncate">{o.label}</span>
                {o.sub && <span className="shrink-0 text-[11px] text-outline">{o.sub}</span>}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  )
}

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
          <select className={inputCls} value={projectId} onChange={(e) => setProjectId(e.target.value)}>
            <option value="">不关联</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
                {p.status === 'archived' ? '（已归档）' : ''}
              </option>
            ))}
          </select>
        </Field>
        <Field label="关联待办">
          <MatchCombobox
            value={todoId}
            options={openTodos.map((t) => ({
              id: t.id,
              label: t.title,
              sub: t.priority,
              icon: 'task_alt',
            }))}
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
