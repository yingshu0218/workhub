import { useState } from 'react'
import { Icon } from '@/design-system/Icon'
import type { Habit } from '@/db/types'
import { habitRepo, newId } from '@/repositories'
import { Drawer, Field, inputCls, Button } from '@/design-system/ui'

/** 预设图标（material symbols 8 选 1） */
export const HABIT_ICONS = [
  'fitness_center',
  'menu_book',
  'briefcase',
  'savings',
  'brain',
  'spa',
  'code',
  'directions_run',
] as const

/** 预设色板 6 色 */
export const HABIT_COLORS = ['#2563eb', '#0f6e56', '#854f0b', '#b3261e', '#7c3aed', '#0369a1'] as const

type ScheduleKind = '每日' | '工作日' | '每周N次'

function parseSchedule(schedule: string): { kind: ScheduleKind; timesPerWeek: number } {
  if (schedule === '工作日') return { kind: '工作日', timesPerWeek: 5 }
  const m = schedule.match(/^每周(\d+)次$/)
  if (m) return { kind: '每周N次', timesPerWeek: Number(m[1]) }
  return { kind: '每日', timesPerWeek: 3 }
}

export function HabitFormDrawer({
  open,
  habit,
  onClose,
}: {
  open: boolean
  /** 编辑模式传入旧记录（以旧记录展开为基底），新建传 null */
  habit: Habit | null
  onClose: () => void
}) {
  const [name, setName] = useState('')
  const [icon, setIcon] = useState<string>(HABIT_ICONS[0])
  const [color, setColor] = useState<string>(HABIT_COLORS[0])
  const [kind, setKind] = useState<ScheduleKind>('每日')
  const [timesPerWeek, setTimesPerWeek] = useState(3)
  const [targetMinutes, setTargetMinutes] = useState(25)
  const [motivationNote, setMotivationNote] = useState('')
  const [category, setCategory] = useState('成长')
  const [crossModuleSync, setCrossModuleSync] = useState(false)
  const [error, setError] = useState('')

  // 打开时以旧记录为基底重置表单
  const openKey = `${open}-${habit?.id ?? 'new'}`
  const [lastKey, setLastKey] = useState('')
  if (openKey !== lastKey) {
    setLastKey(openKey)
    setName(habit?.name ?? '')
    setIcon(habit?.icon ?? HABIT_ICONS[0])
    setColor(habit?.color ?? HABIT_COLORS[0])
    const parsed = parseSchedule(habit?.schedule ?? '每日')
    setKind(parsed.kind)
    setTimesPerWeek(parsed.timesPerWeek)
    setTargetMinutes(habit?.targetMinutes ?? 25)
    setMotivationNote(habit?.motivationNote ?? '')
    setCategory(habit?.category ?? '成长')
    setCrossModuleSync(habit?.crossModuleSync ?? false)
    setError('')
  }

  function scheduleText(): string {
    if (kind === '工作日') return '工作日'
    if (kind === '每周N次') return `每周${Math.min(7, Math.max(1, timesPerWeek))}次`
    return '每日'
  }

  async function save() {
    if (!name.trim()) {
      setError('名称不能为空')
      return
    }
    // 以旧记录展开为基底，仅覆盖表单字段，保留 createdAt 等既有数据
    const base: Habit = {
      ...habit,
      id: habit?.id ?? newId('hb'),
      name: name.trim(),
      icon,
      color,
      category: category.trim() || '成长',
      schedule: scheduleText(),
      targetMinutes: Math.max(0, Math.round(targetMinutes) || 0),
      motivationNote: motivationNote.trim(),
      crossModuleSync,
      createdAt: habit?.createdAt ?? Date.now(),
      updatedAt: 0,
      deleted: 0,
      rev: 0,
    }
    await habitRepo.put(base)
    onClose()
  }

  return (
    <Drawer open={open} title={habit ? '编辑习惯' : '新建习惯'} onClose={onClose}>
      <div>
        <Field label="名称 *">
          <input
            className={inputCls}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="例如：晨间研读 25 分钟"
            autoFocus
          />
        </Field>

        <Field label="图标">
          <div className="flex flex-wrap gap-2">
            {HABIT_ICONS.map((ic) => (
              <button
                key={ic}
                onClick={() => setIcon(ic)}
                className={`flex h-10 w-10 items-center justify-center rounded-lg border transition-colors ${
                  icon === ic ? 'border-primary bg-primary-fixed text-primary' : 'border-outline-variant text-on-surface-variant hover:bg-surface-container-low'
                }`}
              >
                <Icon name={ic} size={22} />
              </button>
            ))}
          </div>
        </Field>

        <Field label="颜色">
          <div className="flex gap-2">
            {HABIT_COLORS.map((c) => (
              <button
                key={c}
                onClick={() => setColor(c)}
                className={`h-8 w-8 rounded-full transition-transform ${
                  color === c ? 'scale-110 ring-2 ring-on-surface ring-offset-2' : ''
                }`}
                style={{ background: c }}
              />
            ))}
          </div>
        </Field>

        <Field label="周期">
          <div className="flex items-center gap-2">
            {(['每日', '工作日', '每周N次'] as const).map((k) => (
              <button
                key={k}
                onClick={() => setKind(k)}
                className={`rounded-lg border px-3 py-1.5 text-[13px] transition-colors ${
                  kind === k ? 'border-primary bg-primary-fixed font-semibold text-primary' : 'border-outline-variant text-on-surface-variant'
                }`}
              >
                {k === '每周N次' ? '每周 N 次' : k}
              </button>
            ))}
            {kind === '每周N次' && (
              <select
                className="rounded-lg border border-outline-variant bg-surface-container-lowest px-2 py-1.5 text-[13px]"
                value={timesPerWeek}
                onChange={(e) => setTimesPerWeek(Number(e.target.value))}
              >
                {[1, 2, 3, 4, 5, 6, 7].map((n) => (
                  <option key={n} value={n}>{n}</option>
                ))}
              </select>
            )}
          </div>
        </Field>

        <Field label="目标分钟">
          <input
            type="number"
            min={0}
            className={inputCls}
            value={targetMinutes}
            onChange={(e) => setTargetMinutes(Number(e.target.value))}
          />
        </Field>

        <Field label="分类">
          <input
            className={inputCls}
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            placeholder="工作 / 商务 / 成长…"
          />
        </Field>

        <Field label="驱动愿景一句话">
          <input
            className={inputCls}
            value={motivationNote}
            onChange={(e) => setMotivationNote(e.target.value)}
            placeholder="为什么要坚持这个习惯？"
          />
        </Field>

        <Field label="跨模块联动">
          <button
            onClick={() => setCrossModuleSync(!crossModuleSync)}
            className="flex items-center gap-2 text-[13px]"
          >
            <Icon
              name={crossModuleSync ? 'toggle_on' : 'toggle_off'}
              size={24}
              className={crossModuleSync ? 'text-success' : 'text-outline'}
            />
            <span className={crossModuleSync ? 'font-medium' : 'text-on-surface-variant'}>
              深度专注完成时自动打卡本习惯（需分类为「工作」且时长达标）
            </span>
          </button>
        </Field>

        {error && <div className="mb-3 text-[12px] text-danger">{error}</div>}
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="tonal" onClick={onClose}>取消</Button>
          <Button onClick={() => void save()}>{habit ? '保存修改' : '创建习惯'}</Button>
        </div>
      </div>
    </Drawer>
  )
}
