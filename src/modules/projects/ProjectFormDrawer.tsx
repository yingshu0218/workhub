import { useState } from 'react'
import type { Customer, Project } from '@/db/types'
import { useCollection } from '@/queries/hooks'
import { Button, Field, Modal, inputCls, useAutoFocus } from '@/design-system/ui'
import { MatchCombobox } from '@/design-system/MatchCombobox'
import { saveProject } from './hooks'

/** 预设项目色板（区分于客户/标签语义色，取低饱和稳重视觉） */
const COLOR_PRESETS = [
  '#004ac6',
  '#006c49',
  '#943700',
  '#6d43c4',
  '#b3266e',
  '#7d5260',
  '#4a4458',
  '#0b6bcb',
]

const STATUS_OPTIONS: { value: Project['status']; label: string }[] = [
  { value: 'active', label: '进行中' },
  { value: 'paused', label: '已搁置' },
  { value: 'archived', label: '已归档' },
]

/** 新建/编辑项目抽屉 */
export default function ProjectFormDrawer({
  open,
  project,
  onClose,
}: {
  open: boolean
  /** 传入则为编辑模式 */
  project?: Project | null
  onClose: () => void
}) {
  const [name, setName] = useState('')
  const [color, setColor] = useState(COLOR_PRESETS[0])
  const [status, setStatus] = useState<Project['status']>('active')
  const [customerId, setCustomerId] = useState('')
  const [budget, setBudget] = useState('')
  const [note, setNote] = useState('')
  const [error, setError] = useState('')
  const [seedKey, setSeedKey] = useState(0)
  const nameRef = useAutoFocus<HTMLInputElement>(open)

  // 客户候选：挂靠客户打通 CRM（客户详情「名下项目」/ 关系画布「客户→项目」层级）
  const customers = useCollection<Customer>('customers')

  // 打开时重置（渲染期重置模式，同 TransactionFormDrawer）
  const openKey = `${open}-${project?.id ?? 'new'}`
  const [lastKey, setLastKey] = useState('')
  if (openKey !== lastKey) {
    setLastKey(openKey)
    if (open) {
      setName(project?.name ?? '')
      setColor(project?.color ?? COLOR_PRESETS[0])
      setStatus(project?.status ?? 'active')
      setCustomerId(project?.customerId ?? '')
      setBudget(project?.budget != null ? String(project.budget) : '')
      setNote(project?.note ?? '')
      setError('')
      setSeedKey((k) => k + 1)
    }
  }

  async function save() {
    if (!name.trim()) {
      setError('请填写项目名称')
      return
    }
    const rawBudget = budget.trim() ? Number(budget.trim()) : undefined
    if (rawBudget != null && (!Number.isFinite(rawBudget) || rawBudget < 0)) {
      setError('预算必须为非负数')
      return
    }
    try {
      await saveProject({
        id: project?.id,
        name,
        color,
        status,
        customerId: customerId || undefined,
        budget: rawBudget,
        note,
      })
      onClose()
    } catch (e) {
      setError(e instanceof Error ? `保存失败：${e.message}` : '保存失败，请重试')
    }
  }

  return (
    <Modal open={open} title={project ? '编辑项目' : '新建项目'} onClose={onClose}>
      <div key={seedKey}>
        <Field label="项目名称 *">
          <input
            ref={nameRef}
            className={inputCls}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="如：深蓝科技二期交付 / 年度外包 / 装修工程"
          />
        </Field>
        <Field label="标识色">
          <div className="flex flex-wrap gap-2">
            {COLOR_PRESETS.map((c) => (
              <button
                key={c}
                onClick={() => setColor(c)}
                className={`h-8 w-8 rounded-full border-2 transition-transform ${
                  color === c ? 'scale-110 border-on-surface' : 'border-transparent'
                }`}
                style={{ background: c }}
                title={c}
              />
            ))}
          </div>
        </Field>
        <Field label="状态">
          <div className="flex gap-2">
            {STATUS_OPTIONS.map((s) => (
              <button
                key={s.value}
                onClick={() => setStatus(s.value)}
                className={`rounded-lg border px-4 py-1.5 text-[0.9286rem] ${
                  status === s.value
                    ? 'border-primary bg-primary-fixed font-semibold text-primary'
                    : 'border-outline-variant text-on-surface-variant'
                }`}
              >
                {s.label}
              </button>
            ))}
          </div>
        </Field>
        <Field label="挂靠客户（可选，打通 CRM 下钻）">
          <MatchCombobox
            value={customerId}
            options={customers.map((c) => ({
              id: c.id,
              label: c.company ? `${c.company} · ${c.name}` : c.name,
              icon: 'person',
            }))}
            placeholder="输入公司或姓名模糊搜索，如：深蓝"
            emptyText="没有匹配的客户"
            onChange={setCustomerId}
          />
        </Field>
        <Field label="项目预算（可选，仅展示对比）">
          <input
            type="number"
            min={0}
            className={inputCls}
            value={budget}
            onChange={(e) => setBudget(e.target.value)}
            placeholder="如 500000"
          />
        </Field>
        <Field label="备注">
          <textarea
            className={`${inputCls} h-20 resize-none`}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </Field>
        {error && <div className="mb-3 text-[0.8571rem] text-danger">{error}</div>}
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="tonal" onClick={onClose}>
            取消
          </Button>
          <Button icon="save" onClick={save}>
            {project ? '保存修改' : '创建项目'}
          </Button>
        </div>
      </div>
    </Modal>
  )
}
