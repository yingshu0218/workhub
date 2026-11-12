import { useState } from 'react'
import { saveLedger, newId } from '@/repositories'
import { nextLedgerSortOrder } from './hooks'
import { useFormReset } from '@/shared/useFormReset'
import type { Ledger } from '@/db/types'
import { Button, Field, Modal, inputCls, useAutoFocus } from '@/design-system/ui'
import { captureClientWriteSession } from '@/modules/clientWriteSession'

const CURRENCIES = ['CNY', 'USD', 'EUR'] as const
const CYCLES = ['月结', '季结', '年结', '不封账'] as const

const CURRENCY_LABELS: Record<(typeof CURRENCIES)[number], string> = {
  CNY: 'CNY · 人民币 ¥',
  USD: 'USD · 美元 $',
  EUR: 'EUR · 欧元 €',
}

/** 新建 / 编辑财务账本抽屉（对齐原型 05-finance-new-ledger） */
export default function LedgerFormDrawer({
  open,
  editLedger,
  onClose,
}: {
  open: boolean
  /** 传入则为编辑模式：以旧账本为基底，仅覆盖表单字段 */
  editLedger?: Ledger | null
  onClose: () => void
}) {
  const [name, setName] = useState('')
  const [currency, setCurrency] = useState<(typeof CURRENCIES)[number]>('CNY')
  const [opening, setOpening] = useState('0')
  const [cycle, setCycle] = useState<Ledger['closingCycle']>('月结')
  const [isDefault, setIsDefault] = useState(false)
  const [error, setError] = useState('')
  const nameRef = useAutoFocus<HTMLInputElement>(open)

  // 打开时重置（收口 C-10：骨架走 useFormReset）；编辑模式回填旧值
  const openKey = `${open}-${editLedger?.id ?? ''}`
  const { seedKey } = useFormReset(openKey, open, (isOpen) => {
    if (!isOpen) return
    {
      if (editLedger) {
        setName(editLedger.name)
        setCurrency(
          (CURRENCIES as readonly string[]).includes(editLedger.currency)
            ? (editLedger.currency as (typeof CURRENCIES)[number])
            : 'CNY',
        )
        setOpening(String(editLedger.openingBalance))
        setCycle(editLedger.closingCycle)
        setIsDefault(!!editLedger.isDefault)
      } else {
        setName('')
        setCurrency('CNY')
        setOpening('0')
        setCycle('月结')
        setIsDefault(false)
      }
      setError('')
    }
  })

  async function save() {
    if (!name.trim()) {
      setError('账本名称不能为空')
      return
    }
    const openingNum = Number(opening)
    if (!opening.trim() || Number.isNaN(openingNum) || openingNum < 0) {
      setError('期初建账金额需为不小于 0 的数字')
      return
    }
    // 设为默认账本：先清掉其它账本的 isDefault，保证全局唯一。
    // 收口到 repositories（P1 补强）：与 agentOps 的 fin_createLedger 共用同一实现，
    // 消除「UI 一处 / AI 一处」两条内联路径漂移出「双默认账本」的可能。
    // 错误处理（审计 P1）：此前无 try/catch，落库失败的 Promise 无人处理 → 静默失败零提示。
    try {
      const checkSession = captureClientWriteSession()
      if (editLedger) {
        await saveLedger({
          ...editLedger,
          name: name.trim(),
          currency,
          openingBalance: openingNum,
          closingCycle: cycle,
          // 未勾选时移除默认标记（可选字段，缺省即非默认）
          isDefault,
        })
      } else {
        const sortOrder = await nextLedgerSortOrder()
        checkSession()
        await saveLedger({
          id: newId('ldg'),
          name: name.trim(),
          currency,
          openingBalance: openingNum,
          closingCycle: cycle,
          // 新账本排到左侧树末尾
          sortOrder,
          createdAt: Date.now(),
          isDefault,
        })
      }
      onClose()
    } catch (e) {
      setError(e instanceof Error ? `保存失败：${e.message}` : '保存失败，请重试')
    }
  }

  return (
    <Modal open={open} title={editLedger ? '编辑财务账本' : '新建财务账本'} onClose={onClose}>
      <div key={seedKey}>
        <Field label="账本名称 *">
          <input
            ref={nameRef}
            className={inputCls}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="如：2025 新零售业务出海专账"
          />
        </Field>
        <Field label="结算主币种">
          <select
            className={inputCls}
            value={currency}
            onChange={(e) => setCurrency(e.target.value as (typeof CURRENCIES)[number])}
          >
            {CURRENCIES.map((c) => (
              <option key={c} value={c}>
                {CURRENCY_LABELS[c]}
              </option>
            ))}
          </select>
        </Field>
        <Field label="期初建账金额">
          <input
            type="number"
            min={0}
            className={inputCls}
            value={opening}
            onChange={(e) => setOpening(e.target.value)}
            placeholder="结余起算基数"
          />
        </Field>
        <Field label="结账封账周期">
          <div className="flex gap-2">
            {CYCLES.map((c) => (
              <button
                key={c}
                onClick={() => setCycle(c)}
                className={`rounded-lg border px-3 py-1.5 text-[0.9286rem] ${
                  cycle === c
                    ? 'border-primary bg-primary-fixed font-semibold text-primary'
                    : 'border-outline-variant text-on-surface-variant'
                }`}
              >
                {c}
              </button>
            ))}
          </div>
        </Field>
        <Field label="默认账本">
          <button
            type="button"
            onClick={() => setIsDefault(!isDefault)}
            className={`flex w-full items-center justify-between rounded-lg border px-3 py-2 text-[0.9286rem] transition-colors ${
              isDefault
                ? 'border-primary bg-primary-fixed text-primary'
                : 'border-outline-variant text-on-surface-variant hover:text-on-surface'
            }`}
          >
            <span>新建记账时默认选中此账本</span>
            <span
              className={`flex h-5 w-9 items-center rounded-full p-0.5 transition-colors ${
                isDefault ? 'bg-primary' : 'bg-outline-variant'
              }`}
            >
              <span
                className={`h-4 w-4 rounded-full bg-white shadow transition-transform ${
                  isDefault ? 'translate-x-4' : ''
                }`}
              />
            </span>
          </button>
        </Field>
        {error && <div className="mb-3 text-[0.8571rem] text-danger">{error}</div>}
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="tonal" onClick={onClose}>
            取消
          </Button>
          <Button icon="check" onClick={save}>
            {editLedger ? '保存修改' : '立即创建账本'}
          </Button>
        </div>
      </div>
    </Modal>
  )
}

