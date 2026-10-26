/**
 * 待办表单抽屉（2026-10-26 审计整改：从 `TodoPage.tsx` 拆出）
 *
 * 拆分动机：`TodoPage` 一度同时承担「页面骨架 / 列表行 / 表单抽屉」三职（1529 行），
 * 而本仓其余 FormDrawer（客户 / 账本 / 习惯 / 项目）都已是独立文件 —— 这处属历史遗留。
 * 本次只搬运，**零逻辑改写**：字段、渲染期重置骨架、校验、错误提示一字未动。
 *
 * ⚠️ 调用方仍可从 `./TodoPage` 取 `TodoFormDrawer`（那里保留了同名再导出），
 * 既有 import 路径不破坏（与 `TodoDetailDrawer` 的处置一致）。
 */
import { useRef, useState } from 'react'
import dayjs from 'dayjs'
import { Icon } from '@/design-system/Icon'
import { toArchivedFlag } from '@/shared/search'
import { Button, Field, Modal, inputCls, useAutoFocus } from '@/design-system/ui'
import { MatchCombobox } from '@/design-system/MatchCombobox'
import { chipTagStyle } from '@/design-system/ChipTagInput'
import { useToast } from '@/design-system/Toast'
import { useCollection } from '@/queries/hooks'
import { newId, saveTodoWithList } from '@/repositories'
import type { Todo, Customer, Project } from '@/db/types'
import { hiddenCustomerIds, useIntimacyConfig } from '@/modules/crm/intimacy'
import { splitTodoText, toTodoText } from './title'
import {
  DEFAULT_TODO_PRIORITY,
  TODO_PRIORITY_CARD_STYLE,
  TODO_PRIORITY_LEVELS,
  TODO_PRIORITY_META,
  normalizeTodoPriority,
  type TodoPriority,
} from './priority'
import {
  TODO_TAG_MAX_COUNT,
  TODO_TAG_MAX_LENGTH,
  appendTodoTags,
  normalizeTodoTags,
  removeTodoTag,
  settleTagsFromText,
} from './tags'
import { useTodoListIdOf, useTodoListOptions } from './hooks'

export function TodoFormDrawer({
  open,
  todo,
  onClose,
  onSaved,
}: {
  open: boolean
  todo: Todo | null
  onClose: () => void
  /** 保存成功后回调（新建场景用于视图兜底切换，保证新条目立即可见） */
  onSaved?: (todo: Todo, listId?: string) => void
}) {
  const toast = useToast()
  const customers = useCollection<Customer>('customers')
  // 黑名单「单据选择器排除」（缺陷 D15）：被屏蔽客户不进候选，已关联的仍正常回显
  const pickerHiddenIds = hiddenCustomerIds(customers, useIntimacyConfig(), 'excludeFromPicker')
  const projects = useCollection<Project>('projects')
  // 标题不再是独立输入（Issue #148）：全文入正文，标题恒由正文首行推导
  const [desc, setDesc] = useState('')
  const [priority, setPriority] = useState<TodoPriority>(DEFAULT_TODO_PRIORITY)
  /**
   * 状态（Issue #148 后续）：**不进表单的常驻字段**。
   *
   * 为什么删掉：新建待办默认就是未完成，弹窗里再摆一个「未完成」下拉，等于让用户
   * 在一个只有单一可选值的字段里做选择 —— 用户说的「状态有点多余」就是这个。
   *
   * 唯一例外是**已作废条目**：作废是「终止」而非「删除」（记录保留），用户很可能
   * 正是在「这条不再推进」的语境下进来改字，或进来恢复。所以只给已作废条目一个
   * 「恢复为未完成」开关（默认不勾=保持作废），避免为了恢复先退出表单去详情里按一下。
   * 完成态不在这里写：它在列表勾选框 / 详情抽屉（`toggleTodoDone`，status 与 completedAt 成对写）。
   */
  const [restoreOnSave, setRestoreOnSave] = useState(false)
  const isVoidedEditing = todo?.status === 'voided'
  const [dueAt, setDueAt] = useState('')
  const [customerId, setCustomerId] = useState('')
  const [listId, setListId] = useState('')
  const [projectId, setProjectId] = useState('')
  // 标签（Issue #148）：`#` + 回车创建，或保存时从正文尾部的 `#词` 结算
  const [tags, setTags] = useState<string[]>([])
  const [tagDraft, setTagDraft] = useState('')
  const [tagNotice, setTagNotice] = useState('')
  const listOptions = useTodoListOptions()
  const formListIdOf = useTodoListIdOf()
  const [error, setError] = useState('')
  const [seedKey, setSeedKey] = useState(0)
  const tagInputRef = useRef<HTMLInputElement>(null)
  // 正文即标题来源，打开即聚焦正文（原先聚焦标题输入框）
  const descRef = useAutoFocus<HTMLTextAreaElement>(open)

  // 打开时重置
  const openKey = `${open}-${todo?.id ?? 'new'}`
  const [lastKey, setLastKey] = useState('')
  if (openKey !== lastKey) {
    setLastKey(openKey)
    // 编辑回填：标题与正文拼接，对齐「首行即标题」的拆分口径（拆不开时按标题拆分）
    setDesc(toTodoText(todo))
    // 回填归一化：存量 P1/P2/P3 数据在此转成四档，编辑保存后自然完成数据迁移。
    // 新建（todo 为 null）走**写侧缺省档**「无 · 白色卡片」，不走读侧脏数据兜底的「中」——
    // 两者刻意不同源（见 priority.ts 注释）：一个是「用户没表态」，一个是「字段写坏了」。
    setPriority(todo ? normalizeTodoPriority(todo.priority) : DEFAULT_TODO_PRIORITY)
    setDueAt(todo?.dueAt ? dayjs(todo.dueAt).format('YYYY-MM-DDTHH:mm') : '')
    setCustomerId(todo?.customerId ?? '')
    // 归属已迁 links（v16 member）：编辑回填走索引
    setListId(todo ? (formListIdOf.get(todo.id) ?? '') : '')
    setProjectId(todo?.projectId ?? '')
    setTags(normalizeTodoTags(todo?.tags ?? []))
    setRestoreOnSave(false)
    setTagDraft('')
    setTagNotice('')
    setError('')
    setSeedKey((k) => k + 1)
  }

  /** 追加标签（回车 / 逗号 / 失焦共用）；超上限给出提示而非静默丢弃 */
  function commitTags(raw: string) {
    const { tags: next, overflow } = appendTodoTags(tags, [raw])
    setTags(next)
    setTagDraft('')
    setTagNotice(overflow > 0 ? `最多 ${TODO_TAG_MAX_COUNT} 个标签` : '')
  }

  function onTagKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter' || e.key === '，' || e.key === ',') {
      e.preventDefault()
      if (tagDraft.trim()) commitTags(tagDraft)
      return
    }
    // 退格：输入框为空时删末枚（与笔记 / 客户标签同款手感）
    if (e.key === 'Backspace' && !tagDraft && tags.length > 0) {
      setTags(tags.slice(0, -1))
    }
  }

  async function save() {
    // 标签结算（Issue #148）：把未按回车的草稿与正文尾部残留的 `#词` 一并收成标签，
    // 避免「打了 # 没回车 → 标签变成备注文字」这种静默丢失。
    const settledDraft = appendTodoTags(tags, [tagDraft])
    const settledTail = settleTagsFromText(desc)
    const { tags: finalTags } = appendTodoTags(settledDraft.tags, settledTail.tags)
    const content = settledTail.text

    // 标题口径（Issue #148）：正文首行 trim 后作标题（截断 60 字，空正文回退「未命名待办」）。
    // 拆分走 `./title` 的 `splitTodoText` —— 与速记转待办、Agent 两条写入口共用同一实现，
    // 杜绝「同一动作多条命名规则」（本文件不再自行拼 title/desc）。
    if (!content.trim()) {
      setError('请先写下待办内容')
      return
    }
    const { title, desc: body } = splitTodoText(content)
    /*
     * 状态（Issue #148 后续）：表单已无状态字段，只有一种例外迁移 ——
     * 「已作废 → 勾了恢复 → 未完成」。其余一律原样保留 todo.status：
     * 未完成/已完成的条目改字保存不会改状态，也不会重盖 completedAt。
     */
    const reactivated = isVoidedEditing && restoreOnSave
    const nextStatus: Todo['status'] = !todo ? 'todo' : reactivated ? 'todo' : todo.status
    // 以旧记录展开为基底，仅覆盖表单字段，保留 habitId/ledgerId/completedAt 等
    const base: Todo = {
      ...todo,
      id: todo?.id ?? newId('td'),
      title,
      desc: body,
      priority,
      status: nextStatus,
      // 时间戳与 status 成对（Issue #128）：表单只可能产生「作废 → 未完成」这一种状态迁移，
      // 两个终态时间戳一并清空（与 `setTodoVoided(todo, false)` 同纪律，不留单边时间戳）；
      // 其余情况原样保留，表单不参与完成态写入。
      completedAt: reactivated ? undefined : todo?.completedAt,
      voidedAt: reactivated ? undefined : todo?.voidedAt,
      dueAt: dueAt ? dayjs(dueAt).valueOf() : undefined,
      tags: finalTags.length ? finalTags : undefined,
      customerId: customerId || undefined,
      projectId: projectId || undefined,
      createdAt: todo?.createdAt ?? Date.now(),
      updatedAt: 0,
      deleted: 0,
      rev: 0,
    }
    // 错误处理（审计 P1 同类项）：此前无 try/catch，落库失败的 Promise 无人处理 → 静默失败零提示。
    try {
      // 清单归属已迁 links（v16 member）：与待办行同事务（null = 移回收集箱）
      await saveTodoWithList(base, listId || null)
      if (reactivated) toast.success(`已恢复为未完成：${title}`)
      onSaved?.(base, listId || undefined)
      onClose()
    } catch (e) {
      setError(e instanceof Error ? `保存失败：${e.message}` : '保存失败，请重试')
    }
  }

  return (
    <Modal open={open} title={todo ? '编辑待办' : '新建待办'} onClose={onClose} size="lg">
      <div key={seedKey}>
        {/* 左右分区（Issue #148 后续）：
            - 左栏只放正文，独占可用高度（「把更大的面积留给文本输入」）；
            - 右栏「事项设置」收纳全部非正文字段（优先级/状态/截止时间/清单/项目/客户）；
            - 窄屏（<640px）自动回退单栏堆叠，正文在上、设置在下。 */}
        <div className="flex flex-col gap-5 sm:flex-row sm:items-start">
          {/* 左栏：正文。`sm:flex-1 sm:min-w-0` 保证长文本不会顶破栅格 */}
          <div className="sm:min-w-0 sm:flex-1">
            <Field label="待办内容 *">
              <textarea
                ref={descRef}
                className={`${inputCls} h-44 resize-none sm:h-72`}
                value={desc}
                onChange={(e) => setDesc(e.target.value)}
                placeholder={'第一行作为标题，其余行作为备注\n例如：跟进深蓝续约\n本周五前给出报价'}
              />
              <p className="mt-1.5 text-[0.7857rem] text-outline">
                第一行将作为待办标题，其余内容作为备注
              </p>
            </Field>

            {/* 标签行（Issue #148）：`#` 直接输入、回车成签，样式对齐笔记/客户的彩色小标签。
                这里刻意**不用 MatchCombobox / 弹层** —— 它嵌在表单里，弹层会顶掉输入态。
                正文下移后本行紧跟其后，视觉上属于「正文的延伸」而非右栏设置项。 */}
            <div className="mt-1">
              <div className="mb-1.5 text-[0.8571rem] font-medium text-on-surface-variant">
                标签
              </div>
              <div
                className="flex min-h-[38px] cursor-text flex-wrap items-center gap-1.5 rounded-lg border border-outline-variant bg-surface-container-lowest px-3 py-1.5"
                onClick={() => tagInputRef.current?.focus()}
              >
                {tags.map((t) => (
                  <span
                    key={t}
                    className="flex items-center gap-0.5 rounded-full px-2.5 py-0.5 text-[0.8571rem] font-medium"
                    style={chipTagStyle(t)}
                  >
                    #{t}
                    <button
                      type="button"
                      className="ml-0.5 opacity-60 transition-opacity hover:opacity-100"
                      title="移除标签"
                      onClick={(e) => {
                        e.stopPropagation()
                        setTags(removeTodoTag(tags, t))
                      }}
                    >
                      <Icon name="close" size={13} />
                    </button>
                  </span>
                ))}
                <input
                  ref={tagInputRef}
                  className="min-w-[7rem] flex-1 bg-transparent text-[0.9286rem] outline-none"
                  value={tagDraft}
                  maxLength={TODO_TAG_MAX_LENGTH + 1}
                  onChange={(e) => {
                    setTagNotice('')
                    setTagDraft(e.target.value)
                  }}
                  onKeyDown={onTagKeyDown}
                  onBlur={() => tagDraft.trim() && commitTags(tagDraft)}
                  placeholder={tags.length === 0 ? '# 输入标签，回车创建' : ''}
                />
              </div>
              <p
                className={`mt-1.5 text-[0.7857rem] ${tagNotice ? 'text-warning' : 'text-outline'}`}
              >
                {tagNotice || `输入 # 标签名后回车创建，最多 ${TODO_TAG_MAX_COUNT} 个`}
              </p>
            </div>
          </div>

          {/* 右栏：事项设置。窄屏与左栏同宽堆叠，桌面固定 280px 侧栏 */}
          <section aria-label="事项设置" className="shrink-0 surface-card-low p-4 sm:w-[17.5rem]">
            <h3 className="mb-3 text-[0.9286rem] font-semibold text-on-surface-variant">
              事项设置
            </h3>

            {/* 优先级（Issue #148 最新口径）：固定四档 → 直接点选的**彩色卡片**，
                红 / 橙 / 蓝 / 白 分别对应 高 / 中 / 低 / 无，白色「无」是默认档。
                不再用下拉：四张卡一屏铺开，点一下即选中，比下拉少一次交互。 */}
            <div className="mb-4">
              <div className="mb-1.5 text-[0.8571rem] font-medium text-on-surface-variant">
                优先级
              </div>
              <div role="radiogroup" aria-label="优先级" className="grid grid-cols-4 gap-1.5">
                {TODO_PRIORITY_LEVELS.map((p) => {
                  const meta = TODO_PRIORITY_META[p]
                  const style = TODO_PRIORITY_CARD_STYLE[p]
                  const selected = priority === p
                  return (
                    <button
                      key={p}
                      type="button"
                      role="radio"
                      aria-checked={selected}
                      title={`${meta.label} · ${meta.quadrant}｜${meta.hint}`}
                      className={`flex flex-col items-center gap-1 rounded-lg border px-1 py-2 transition-all ${
                        selected ? style.active : style.card
                      }`}
                      onClick={() => setPriority(p)}
                    >
                      <span className={`h-2.5 w-2.5 rounded-full ${style.swatch}`} />
                      <span className="text-[0.9286rem] font-semibold leading-none">
                        {meta.label}
                      </span>
                    </button>
                  )
                })}
              </div>
              <p className="mt-1.5 text-[0.7857rem] text-outline">
                {TODO_PRIORITY_META[priority].label} · {TODO_PRIORITY_META[priority].quadrant}
                {' — '}
                {TODO_PRIORITY_META[priority].hint}
              </p>
            </div>

            {/* 状态（Issue #148 后续）：**表单里没有状态字段** —— 新建默认就是未完成，
                让用户在只有一个可选值的下拉里做选择是多余的交互。
                完成态走列表勾选框 / 详情抽屉（`toggleTodoDone`，status 与 completedAt 成对写）；
                作废是终止而非删除，只给**已作废条目**一个原地恢复开关，其余终态写入不进表单。 */}
            {isVoidedEditing && (
              <Field label="状态">
                <label className="flex cursor-pointer items-start gap-2 rounded-lg border border-outline-variant/60 px-3 py-2 text-[0.9286rem] transition-colors hover:border-primary/60">
                  <input
                    type="checkbox"
                    className="mt-0.5 accent-primary"
                    checked={restoreOnSave}
                    onChange={(e) => setRestoreOnSave(e.target.checked)}
                  />
                  <span>
                    恢复为未完成
                    <span className="mt-0.5 block text-[0.7857rem] text-outline">
                      这条待办当前「已作废」。勾上并保存 = 恢复为未完成；不勾则保持作废状态，
                      仅更新正文与设置。
                    </span>
                  </span>
                </label>
              </Field>
            )}

            <Field label="截止时间">
              <input
                type="datetime-local"
                className={inputCls}
                value={dueAt}
                onChange={(e) => setDueAt(e.target.value)}
              />
            </Field>

            <Field label="所属清单">
              <MatchCombobox
                value={listId}
                options={listOptions.map((l) => ({ id: l.id, label: l.name, icon: 'folder' }))}
                placeholder="输入清单名称模糊搜索"
                emptyText="没有匹配的清单"
                onChange={setListId}
              />
            </Field>

            <Field label="所属项目">
              <MatchCombobox
                value={projectId}
                options={projects.map((p) => ({
                  id: p.id,
                  label: p.name,
                  sub: p.status === 'archived' ? '已归档' : undefined,
                  ...toArchivedFlag(p),
                  icon: 'folder_open',
                }))}
                placeholder="输入项目名称模糊搜索"
                emptyText="没有匹配的项目"
                onChange={setProjectId}
              />
            </Field>

            <Field label="关联客户">
              <MatchCombobox
                value={customerId}
                hiddenIds={pickerHiddenIds}
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
          </section>
        </div>
        {error && <div className="mb-3 text-[0.8571rem] text-danger">{error}</div>}
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="tonal" onClick={onClose}>
            取消
          </Button>
          <Button onClick={save}>{todo ? '保存修改' : '创建待办'}</Button>
        </div>
      </div>
    </Modal>
  )
}
