import { useState } from 'react'
import { useCollection } from '@/queries/hooks'
import { attachmentRepo, newId, transactionRepo } from '@/repositories'
import type { Customer, Ledger, Transaction } from '@/db/types'
import { Button, Chip, Drawer, Field, inputCls } from '@/design-system/ui'
import dayjs from 'dayjs'

const CHANNELS = ['微信', '支付宝', '银行卡', '现金', '对公转账'] as const

/** 记一笔账抽屉（对齐原型 04-finance-new-transaction） */
export default function TransactionFormDrawer({
  open,
  defaultLedgerId,
  onClose,
}: {
  open: boolean
  /** 当前选中的账本 id；'all' 表示全部账本（回落到第一个账本） */
  defaultLedgerId: string
  onClose: () => void
}) {
  const ledgers = useCollection<Ledger>('ledgers')
  const customers = useCollection<Customer>('customers')
  const [type, setType] = useState<Transaction['type']>('income')
  const [ledgerId, setLedgerId] = useState('')
  const [channel, setChannel] = useState<(typeof CHANNELS)[number]>('微信')
  const [summary, setSummary] = useState('')
  const [amount, setAmount] = useState('')
  const [occurredAt, setOccurredAt] = useState('')
  const [tagsRaw, setTagsRaw] = useState('')
  const [customerId, setCustomerId] = useState('')
  const [invoiceNo, setInvoiceNo] = useState('')
  const [note, setNote] = useState('')
  const [files, setFiles] = useState<File[]>([])
  const [error, setError] = useState('')
  const [seedKey, setSeedKey] = useState(0)

  // 打开时重置（渲染期重置模式，同 TodoFormDrawer）
  const openKey = `${open}-${defaultLedgerId}`
  const [lastKey, setLastKey] = useState('')
  if (openKey !== lastKey) {
    setLastKey(openKey)
    if (open) {
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
      setInvoiceNo('')
      setNote('')
      setFiles([])
      setError('')
      setSeedKey((k) => k + 1)
    }
  }

  const tags = tagsRaw
    .split(/[,,]/)
    .map((t) => t.trim().replace(/^#/, ''))
    .filter(Boolean)

  async function save() {
    if (!summary.trim()) {
      setError('请填写交易名称')
      return
    }
    const amountNum = Number(amount)
    if (!amount.trim() || Number.isNaN(amountNum) || amountNum <= 0) {
      setError('金额必须为正数')
      return
    }
    if (!ledgerId) {
      setError('请先创建账本')
      return
    }
    const txnId = newId('txn')
    await transactionRepo.put({
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
      status: '待对账',
    })
    // 附件存根：Blob 入 attachments 表，refId 指向交易
    for (const f of files) {
      await attachmentRepo.put({
        id: newId('att'),
        refType: 'transaction',
        refId: txnId,
        name: f.name,
        mime: f.type,
        size: f.size,
        blob: f,
        createdAt: Date.now(),
      })
    }
    onClose()
  }

  return (
    <Drawer open={open} title="记一笔账" onClose={onClose} width={460}>
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
            <select className={inputCls} value={ledgerId} onChange={(e) => setLedgerId(e.target.value)}>
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
          <select className={inputCls} value={customerId} onChange={(e) => setCustomerId(e.target.value)}>
            <option value="">不关联</option>
            {customers.map((c) => (
              <option key={c.id} value={c.id}>
                {c.company} · {c.name}
              </option>
            ))}
          </select>
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
        <Field label={`附件存根（${files.length} 个）`}>
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
                  className="flex items-center justify-between rounded-lg border border-outline-variant/40 px-2.5 py-1.5 text-[12px]"
                >
                  <span className="truncate">{f.name}</span>
                  <span className="ml-2 shrink-0 text-outline">{(f.size / 1024).toFixed(0)} KB</span>
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
            立即保存此笔流水
          </Button>
        </div>
      </div>
    </Drawer>
  )
}
