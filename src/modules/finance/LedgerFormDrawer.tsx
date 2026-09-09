import { useState } from 'react'
import { ledgerRepo, newId } from '@/repositories'
import { nextLedgerSortOrder } from './hooks'
import type { Ledger } from '@/db/types'
import { Button, Drawer, Field, inputCls } from '@/design-system/ui'

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
  const [error, setError] = useState('')
  const [seedKey, setSeedKey] = useState(0)

  // 打开时重置（渲染期重置模式，同 TodoFormDrawer）；编辑模式回填旧值
  const openKey = `${open}-${editLedger?.id ?? ''}`
  const [lastKey, setLastKey] = useState('')
  if (openKey !== lastKey) {
    setLastKey(openKey)
    if (open) {
      if (editLedger) {
        setName(editLedger.name)
        setCurrency(
          (CURRENCIES as readonly string[]).includes(editLedger.currency)
            ? (editLedger.currency as (typeof CURRENCIES)[number])
            : 'CNY',
        )
        setOpening(String(editLedger.openingBalance))
        setCycle(editLedger.closingCycle)
      } else {
        setName('')
        setCurrency('CNY')
        setOpening('0')
        setCycle('月结')
      }
      setError('')
      setSeedKey((k) => k + 1)
    }
  }

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
    if (editLedger) {
      await ledgerRepo.put({
        ...editLedger,
        name: name.trim(),
        currency,
        openingBalance: openingNum,
        closingCycle: cycle,
      })
    } else {
      await ledgerRepo.put({
        id: newId('ldg'),
        name: name.trim(),
        currency,
        openingBalance: openingNum,
        closingCycle: cycle,
        // 新账本排到左侧树末尾
        sortOrder: await nextLedgerSortOrder(),
        createdAt: Date.now(),
      })
    }
    onClose()
  }

  return (
    <Drawer open={open} title={editLedger ? '编辑财务账本' : '新建财务账本'} onClose={onClose}>
      <div key={seedKey}>
        <Field label="账本名称 *">
          <input
            className={inputCls}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="如：2025 新零售业务出海专账"
            autoFocus
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
    </Drawer>
  )
}
