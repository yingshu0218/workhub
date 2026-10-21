import { useState } from 'react'
import { Button, Chip, Field, Modal, inputCls, useAutoFocus } from '@/design-system/ui'
import type { Customer, CustomerGroup } from '@/db/types'
import { matchGroup } from '@/db/types'
import { normalizeTags } from './shared'
import { createCustomerGroup, updateCustomerGroup, useTagSuggestions } from './hooks'
import { useFormReset } from '@/shared/useFormReset'

/**
 * 新建 / 编辑分组弹层 + 标签规则字段（**自 CrmPage.tsx 拆出** · 审计 C-7 · 2026-10-21）
 *
 * 两者放同一文件：`TagRuleField` 只被 `GroupEditorDrawer` 使用（include/exclude 两处调用），
 * 构成「分组规则编辑」的完整闭环；且二者**全仓无第二处 import**（实测）。
 *
 * ⚠️ 保留 `mode` 的既有语义（2026-10-17 双模式）：**创建时选定、编辑时不可改** ——
 * 改模式意味着「成员来源」整个换掉（手动名单 ↔ 标签规则），静默换会让既有成员凭空消失。
 *
 * 语义与拆分前逐行一致（仅移动代码 + 补齐 import）。
 */
export function GroupEditorDrawer({
  group,
  customers,
  open,
  onClose,
}: {
  group: CustomerGroup | null
  customers: Customer[]
  open: boolean
  onClose: () => void
}) {
  const [name, setName] = useState('')
  const [includeRaw, setIncludeRaw] = useState('')
  const [excludeRaw, setExcludeRaw] = useState('')
  const [error, setError] = useState('')
  /**
   * 分组模式（2026-10-17 双模式）：**创建时选定、编辑时不可改**——改模式意味着
   * 「成员来源」整个换掉（手动名单 ↔ 标签规则），静默换会让既有成员凭空消失。
   * 编辑存量分组时回显其 kind（缺省 rule = 存量兼容）。
   */
  const [mode, setMode] = useState<'manual' | 'rule'>('rule')
  const nameRef = useAutoFocus<HTMLInputElement>(open)

  // 打开时重置（收口 C-10：骨架走 useFormReset）
  const openKey = `${open}-${group?.id ?? 'new'}`
  useFormReset(openKey, open, (isOpen) => {
    if (!isOpen) return
    setName(group?.name ?? '')
    setMode(group?.kind ?? 'rule')
    setIncludeRaw(group?.includeTags.join(', ') ?? '')
    setExcludeRaw(group?.excludeTags.join(', ') ?? '')
    setError('')
  })

  // 标签归一化抽共享工具（Issue #63）：配组界面与客户表单共用，避免打错字导致分组失效
  const includeTags = normalizeTags(includeRaw)
  const excludeTags = normalizeTags(excludeRaw)

  // 联想候选：现有客户 tags 实时 distinct（按热度排序），非强制 —— 手打照旧
  const suggestions = useTagSuggestions(customers)
  const draftGroup: CustomerGroup = {
    id: group?.id ?? 'draft',
    name: name.trim(),
    includeTags,
    excludeTags,
    sortOrder: group?.sortOrder ?? 0,
    createdAt: group?.createdAt ?? 0,
    updatedAt: 0,
    deleted: 0,
    rev: 0,
  }
  const previewCount = customers.filter((c) => matchGroup(c, draftGroup)).length

  async function save() {
    if (!name.trim()) {
      setError('请填写分组名称')
      return
    }
    // 错误处理（审计 P1 同类项）：此前无 try/catch，落库失败的 Promise 无人处理 → 静默失败零提示。
    try {
      if (mode === 'manual') {
        // 手动分组：只存名字与模式，成员由客户详情单选归属（无标签规则）
        if (group) {
          await updateCustomerGroup(group.id, { name: name.trim(), kind: 'manual' })
        } else {
          await createCustomerGroup({ name, includeTags: [], excludeTags: [], kind: 'manual' })
        }
        onClose()
        return
      }
      if (includeTags.length === 0) {
        setError('至少选择一个须包含的标签')
        return
      }
      if (group) {
        await updateCustomerGroup(group.id, { name: name.trim(), includeTags, excludeTags })
      } else {
        await createCustomerGroup({ name, includeTags, excludeTags, kind: 'rule' })
      }
      onClose()
    } catch (e) {
      setError(e instanceof Error ? `保存失败：${e.message}` : '保存失败，请重试')
    }
  }

  return (
    <Modal open={open} title={group ? '编辑分组' : '新建分组'} onClose={onClose} size="md">
      <Field label="分组名称 *">
        <input
          ref={nameRef}
          className={inputCls}
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="如：重点培育"
        />
      </Field>
      {/* 模式选择（2026-10-17 双模式）：创建时选定、编辑时只读展示（改模式=成员来源整个换掉） */}
      <Field label="分组模式">
        <div className="flex gap-2">
          {(
            [
              ['manual', '手动分组', '在客户详情里手动选择归属，一个客户只属一个手动分组'],
              ['rule', '标签分组', '按标签规则自动圈人，客户可同时命中多个'],
            ] as const
          ).map(([id, label, tip]) => {
            const disabled = Boolean(group) && mode !== id
            return (
              <button
                key={id}
                type="button"
                disabled={disabled}
                title={group ? '编辑时不可更改分组模式' : tip}
                onClick={() => setMode(id)}
                className={`flex-1 rounded-lg border px-3 py-2 text-left text-[0.9286rem] transition-colors ${
                  mode === id
                    ? 'border-primary bg-primary-fixed/10 font-semibold text-primary'
                    : disabled
                      ? 'border-outline-variant/30 text-outline/60'
                      : 'border-outline-variant/50 text-on-surface-variant hover:bg-surface-hover'
                }`}
              >
                {label}
              </button>
            )
          })}
        </div>
      </Field>
      {mode === 'manual' && (
        <div className="mb-4 rounded-lg bg-surface-container-low px-3 py-2.5 text-[0.9286rem] text-on-surface-variant">
          手动分组的成员在**客户详情页**手动选择归属（单选）；创建后到客户详情里把客户加入本组。
        </div>
      )}
      {mode === 'rule' && (
        <>
          <TagRuleField
            label="须包含标签（全部命中，AND）"
            raw={includeRaw}
            onRawChange={setIncludeRaw}
            tags={includeTags}
            suggestions={suggestions.filter((t) => !includeTags.includes(t))}
            placeholder="如：续约意向, 大客户"
            onPick={(t) => setIncludeRaw((r) => (r.trim() ? `${r.trim()}, ${t}` : t))}
          />
          <TagRuleField
            label="排除标签（命中任一即剔除，NOT）"
            raw={excludeRaw}
            onRawChange={setExcludeRaw}
            tags={excludeTags}
            suggestions={suggestions.filter((t) => !excludeTags.includes(t))}
            placeholder="如：已流失"
            onPick={(t) => setExcludeRaw((r) => (r.trim() ? `${r.trim()}, ${t}` : t))}
          />
          <div className="mb-4 rounded-lg bg-surface-container-low px-3 py-2.5 text-[0.9286rem]">
            <span className="text-on-surface-variant">实时预览命中：</span>
            <span className="font-bold text-primary">{previewCount}</span>
            <span className="text-on-surface-variant"> 位客户</span>
          </div>
        </>
      )}
      {error && <div className="mb-3 text-[0.8929rem] text-danger">{error}</div>}
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>
          取消
        </Button>
        <Button onClick={() => void save()}>{group ? '保存' : '创建'}</Button>
      </div>
    </Modal>
  )
}

/** 标签规则输入：手打 + 聚合联想点击补入，已选回显 Chip 可删 */
export function TagRuleField({
  label,
  raw,
  onRawChange,
  tags,
  suggestions,
  placeholder,
  onPick,
}: {
  label: string
  raw: string
  onRawChange: (v: string) => void
  tags: string[]
  suggestions: string[]
  placeholder: string
  onPick: (tag: string) => void
}) {
  return (
    <Field label={label}>
      <input
        className={inputCls}
        value={raw}
        onChange={(e) => onRawChange(e.target.value)}
        placeholder={placeholder}
      />
      {tags.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {tags.map((t) => (
            <button key={t} onClick={() => onRawChange(tags.filter((x) => x !== t).join(', '))}>
              <Chip tone="gray">#{t} ×</Chip>
            </button>
          ))}
        </div>
      )}
      {suggestions.length > 0 && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <span className="text-[0.7857rem] text-outline">联想：</span>
          {suggestions.slice(0, 8).map((t) => (
            <button
              key={t}
              onClick={() => onPick(t)}
              className="rounded-full border border-outline-variant px-2 py-0.5 text-[0.8214rem] text-on-surface-variant transition-colors hover:border-primary hover:text-primary"
            >
              #{t}
            </button>
          ))}
        </div>
      )}
    </Field>
  )
}
