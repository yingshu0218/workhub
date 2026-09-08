import { useState } from 'react'
import { Icon } from '@/design-system/Icon'
import { Button, inputCls } from '@/design-system/ui'
import { customerRepo } from '@/repositories'
import type { Customer, CustomerIntimacy, IntimacyLevel } from '@/db/types'
import { INTIMACY_LEVELS, isIntimacyTrustLevel } from '@/db/types'
import { useIntimacyConfig, intimacyLevelName } from './config'

/**
 * 亲密度档位选择器（Issue #34 收敛稿）：客户详情头卡内嵌。
 * 7 档横向 chip（T1~I5 信任轴 / I6、I7 隔离态分色），选中即锁定（算法分不参与）；
 * 降级到隔离态（I6/I7）要求填写 note（留痕：三个月后自己知道为什么拉黑）；
 * 「清除手动设置」回到算法兜底档。写入走 customerRepo.put（盖章+入队+同步）。
 */
export default function IntimacyPicker({ customer }: { customer: Customer }) {
  const cfg = useIntimacyConfig()
  const current = customer.intimacy ?? null
  const [saving, setSaving] = useState(false)
  const [pendingLevel, setPendingLevel] = useState<IntimacyLevel | null>(null)
  const [note, setNote] = useState('')

  async function apply(level: IntimacyLevel | null, noteText?: string) {
    if (saving) return
    setSaving(true)
    try {
      const next: CustomerIntimacy | undefined = level
        ? { level, note: noteText?.trim() || undefined, updatedAt: Date.now() }
        : undefined
      await customerRepo.put({ ...customer, intimacy: next } as Customer)
    } finally {
      setSaving(false)
      setPendingLevel(null)
      setNote('')
    }
  }

  function pick(level: IntimacyLevel) {
    if (saving) return
    if (current?.level === level) return
    // 隔离态（I6/I7）人工降级留痕：弹 note 输入（收敛稿边界：拉黑不留原因，三个月后自己都懵）
    if (!isIntimacyTrustLevel(level)) {
      setPendingLevel(level)
      setNote('')
      return
    }
    void apply(level)
  }

  const pending = pendingLevel
  const nameOf = (l: IntimacyLevel) => intimacyLevelName(cfg, l)

  return (
    <div className="mt-3 rounded-xl bg-surface-container-low/60 p-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-[12px] font-medium uppercase tracking-wide text-on-surface-variant">
          <Icon name="favorite" className="text-[16px] text-primary" />
          亲密度
        </div>
        {current && (
          <button
            className="text-[11px] text-on-surface-variant hover:text-on-surface hover:underline"
            disabled={saving}
            onClick={() => void apply(null)}
            title="清除手动档位，回到算法兜底"
          >
            清除手动设置
          </button>
        )}
      </div>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {INTIMACY_LEVELS.map((l) => {
          const active = current?.level === l
          const isolation = !isIntimacyTrustLevel(l)
          return (
            <button
              key={l}
              disabled={saving}
              title={cfg.levels.find((x) => x.key === l)?.desc}
              className={`rounded-full border px-2.5 py-1 text-[12px] transition-colors disabled:opacity-50 ${
                active
                  ? 'border-transparent font-semibold text-white'
                  : 'border-outline-variant/50 text-on-surface-variant hover:text-on-surface'
              }`}
              style={active ? { background: isolation ? '#ba1a1a' : '#004ac6' } : undefined}
              onClick={() => pick(l)}
            >
              {nameOf(l)}
            </button>
          )
        })}
      </div>
      <div className="mt-1.5 text-[11px] text-outline">
        {current
          ? `手动设置${current.note ? ` · ${current.note}` : ''} · 算法分不参与`
          : '未手动设置 · 由算法按联系频率/金钱往来/事项/项目兜底'}
      </div>

      {pending && (
        <div className="mt-3 space-y-2 rounded-lg border border-outline-variant/50 p-3">
          <div className="text-[12px] font-medium">
            降级为「{nameOf(pending)}」，建议留下原因（可留空）
          </div>
          <input
            className={inputCls}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="如：2024 合作翻脸 / 频繁爽约…"
            onKeyDown={(e) => {
              if (e.key === 'Enter') void apply(pending, note)
            }}
          />
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setPendingLevel(null)}>
              取消
            </Button>
            <Button variant="tonal" icon="check" onClick={() => void apply(pending, note)}>
              确认{nameOf(pending)}
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
