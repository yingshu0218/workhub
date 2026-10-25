import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useCollection, useRecordState, resolveRecordDisplay } from '@/queries/hooks'
import type { Todo, Customer, Project, Transaction } from '@/db/types'
import { Button, Chip, Drawer, EmptyState } from '@/design-system/ui'
import { Icon } from '@/design-system/Icon'
import dayjs from 'dayjs'
import { useFocusStore } from '@/stores/focus'
import { toggleTodoDone, voidTodo, restoreTodo } from './toggle'
import { financeFocusPath, txnLinksOf } from '@/modules/finance/links'
import { useTxnLinkIndex } from '@/modules/finance/hooks'
import {
  isTodoOpen,
  isTodoDone,
  isTodoVoided,
  isTodoOverdue,
  overdueDays,
  hasTime,
  todoStatusLabel,
} from './domain'
import { todoPriorityLabel, todoPriorityTone } from './priority'
import { useTodoLists, useTodoListIdOf } from './hooks'

/**
 * 待办详情抽屉（**自 TodoPage.tsx 拆出** · 审计 C-7 · 2026-10-21）
 *
 * 拆分理由：TodoPage.tsx 曾达 1767 行（页面 + 表单抽屉 + 详情抽屉 + 4 个辅助函数），
 * 而 `TodoDetailDrawer` 与其 3 个辅助函数（listNameOf / customerLabelOf / projectLabelOf）
 * **全仓无第二处 import** —— 拆出去零风险，只是把「一页三职」变成「一页一职」。
 *
 * 语义与拆分前逐行一致（本次仅移动代码 + 补齐 import，无任何逻辑改动）。
 */

export function TodoDetailDrawer({
  todoId,
  onClose,
  onEdit,
  onDelete,
}: {
  todoId: string | null
  onClose: () => void
  onEdit: (todo: Todo) => void
  onDelete: (todo: Todo) => void
}) {
  // 「未回填」与「查无此记录」必须分开（Issue #162）：useLiveQuery 首帧恒 undefined，
  // 直接当「不存在」会在打开抽屉的瞬间闪一帧误导性的空态提示
  const { record: todo, checked } = useRecordState<Todo>('todos', todoId ?? undefined)
  const display = resolveRecordDisplay(todoId ?? undefined, checked)
  const lists = useTodoLists()
  // 归属已迁 links（v16 member）：Map<todoId, listId> 索引代替行字段
  const listIdOf = useTodoListIdOf()
  const customers = useCollection<Customer>('customers')
  const projects = useCollection<Project>('projects')
  const transactions = useCollection<Transaction>('transactions')
  const navigate = useNavigate()
  const focus = useFocusStore()
  const todayStr = dayjs().format('YYYY-MM-DD')
  // 状态流转失败提示（与列表行同款：不静默失败）
  const [busy, setBusy] = useState(false)

  // 关联账目：related link 索引反查（v15 起关联迁 links；liveQuery 随保存/级联/恢复刷新）
  const txnLinkIndex = useTxnLinkIndex()
  const linkedTxns = todo
    ? transactions.filter((t) => txnLinksOf(txnLinkIndex, t.id).todoIds.includes(todo.id))
    : []

  /** 详情内动作统一包一层：执行期禁用按钮 + 失败可见提示（不静默吞错） */
  async function run(action: (t: Todo) => Promise<unknown>) {
    if (!todo || busy) return
    setBusy(true)
    try {
      await action(todo)
    } catch (err) {
      console.error('[todo] 详情内更新失败', err)
      window.alert('更新待办失败，请稍后重试。')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Drawer open={todoId !== null} title="待办详情" onClose={onClose} width={460}>
      {display !== 'ready' || !todo ? (
        // 加载中（首帧未回填）渲染空白，避免闪一帧「不存在」；
        // 真正查无此记录（checked=true 但 record 为空）才给空态
        display === 'ready' ? (
          <EmptyState
            icon="task_alt"
            title="待办不存在或已删除"
            description="可能已被移除，关闭后回列表查看其他待办"
          />
        ) : null
      ) : (
        <div className="space-y-5">
          {/* 主卡：状态 + 标题 + 正文全文（列表行只截断展示标题，详情给完整内容） */}
          <div
            className={`rounded-xl p-4 ${
              isTodoDone(todo)
                ? 'bg-success-container/30'
                : isTodoVoided(todo)
                  ? 'bg-surface-container-low'
                  : 'bg-primary-fixed/40'
            }`}
          >
            <div className="flex items-center justify-between gap-2">
              <Chip
                tone={isTodoDone(todo) ? 'green' : isTodoVoided(todo) ? 'gray' : 'blue'}
                icon={isTodoDone(todo) ? 'task_alt' : isTodoVoided(todo) ? 'block' : 'schedule'}
              >
                {todoStatusLabel(todo)}
              </Chip>
              <Chip tone={todoPriorityTone(todo.priority)}>
                {todoPriorityLabel(todo.priority)}
              </Chip>
            </div>
            <h3
              className={`mt-2 text-[1.2143rem] font-bold leading-snug ${
                isTodoOpen(todo) ? '' : 'text-outline line-through'
              }`}
            >
              {todo.title}
            </h3>
            {/* 正文即备注全文（Issue #148：标题由首行推导，desc 承载完整内容） */}
            {/* ⚠️ desc 必须兜底：类型上标为必填，但存量/同步/手写库的记录可能没有该字段，
                直接 .trim() 会抛 "Cannot read properties of undefined"，让整个待办模块白屏。
                与 modules/todo/title.ts 的 `(todo.desc ?? '')` 保持同口径（缺陷 D11）。 */}
            {(todo.desc ?? '').trim() ? (
              <p className="mt-2 whitespace-pre-wrap break-words text-[0.9286rem] text-on-surface-variant">
                {todo.desc}
              </p>
            ) : (
              <p className="mt-2 text-[0.8571rem] text-outline">无备注</p>
            )}
          </div>

          {/* 抽屉内行动作：与列表行口径一致（打勾 / 专注 / 作废恢复 / 编辑 / 删除） */}
          <div className="flex flex-wrap gap-2">
            {!isTodoVoided(todo) && (
              <Button
                variant={isTodoDone(todo) ? 'tonal' : 'primary'}
                icon={isTodoDone(todo) ? 'undo' : 'check_circle'}
                disabled={busy}
                onClick={() => void run((t) => toggleTodoDone(t))}
              >
                {isTodoDone(todo) ? '取消完成' : '标记完成'}
              </Button>
            )}
            {isTodoOpen(todo) && (
              <Button
                variant="tonal"
                icon="timer"
                disabled={busy}
                onClick={() => focus.start(todo.id, todo.title)}
              >
                开始专注
              </Button>
            )}
            {isTodoVoided(todo) ? (
              <Button
                variant="tonal"
                icon="restart_alt"
                disabled={busy}
                onClick={() => void run((t) => restoreTodo(t))}
              >
                恢复
              </Button>
            ) : (
              <Button
                variant="tonal"
                icon="block"
                disabled={busy}
                onClick={() => void run((t) => voidTodo(t))}
              >
                作废
              </Button>
            )}
            <Button variant="ghost" icon="edit" onClick={() => onEdit(todo)}>
              编辑
            </Button>
            <Button
              variant="danger"
              icon="delete"
              className="ml-auto"
              onClick={() => onDelete(todo)}
            >
              删除
            </Button>
          </div>

          {/* 基础明细：截止 / 创建 / 完成 / 作废时间与归属（归属走实时映射，失效 id 显式占位） */}
          <div className="grid grid-cols-2 gap-x-4 gap-y-3 rounded-xl bg-surface-container-low/50 p-4">
            <TodoDetailField label="截止时间">
              {todo.dueAt ? dayjs(todo.dueAt).format('YYYY-MM-DD HH:mm') : '未设置'}
            </TodoDetailField>
            <TodoDetailField label="创建时间">
              {dayjs(todo.createdAt).format('YYYY-MM-DD HH:mm')}
            </TodoDetailField>
            {isTodoDone(todo) && (
              <TodoDetailField label="完成时间">
                {todo.completedAt ? dayjs(todo.completedAt).format('YYYY-MM-DD HH:mm') : '—'}
              </TodoDetailField>
            )}
            {isTodoVoided(todo) && (
              <TodoDetailField label="作废时间">
                {todo.voidedAt ? dayjs(todo.voidedAt).format('YYYY-MM-DD HH:mm') : '—'}
              </TodoDetailField>
            )}
            <TodoDetailField label="所属清单">
              {listIdOf.get(todo.id)
                ? (listNameOf(lists, listIdOf.get(todo.id)!) ?? '已删除')
                : '未归入清单'}
            </TodoDetailField>
            <TodoDetailField label="关联客户">
              {todo.customerId
                ? (customerLabelOf(customers, todo.customerId) ?? '已删除')
                : '未关联'}
            </TodoDetailField>
            <TodoDetailField label="所属项目">
              {todo.projectId
                ? (projectLabelOf(projects, todo.projectId) ?? '已删除')
                : '未关联'}
            </TodoDetailField>
            {isTodoOpen(todo) && hasTime(todo.dueAt) && isTodoOverdue(todo, todayStr) && (
              <TodoDetailField label="逾期">
                <span className="text-danger">已逾期 {overdueDays(todo, todayStr)} 天</span>
              </TodoDetailField>
            )}
          </div>

          {/* 关联账目：从 transactions.todoIds 反查，点击穿透财务凭证详情（Issue #147 同款深链） */}
          <div>
            <div className="mb-2 text-[0.8571rem] font-medium uppercase tracking-wide text-on-surface-variant">
              关联账目（{linkedTxns.length}）
            </div>
            {linkedTxns.length === 0 ? (
              <div className="text-[0.8571rem] text-outline">暂无关联账目</div>
            ) : (
              <div className="space-y-1.5">
                {linkedTxns.map((txn) => (
                  <button
                    key={txn.id}
                    onClick={() => navigate(financeFocusPath(txn.id))}
                    className="flex w-full items-center justify-between rounded-xl bg-surface-container-low/60 p-3 text-left transition-colors hover:bg-surface-hover-low"
                  >
                    <div className="min-w-0">
                      <div className="truncate text-[0.9286rem] font-medium">{txn.summary}</div>
                      <div className="text-[0.8571rem] text-outline">
                        {dayjs(txn.occurredAt).format('YYYY-MM-DD')} ·{' '}
                        {txn.type === 'income' ? '收入' : '支出'} ¥
                        {txn.amount.toLocaleString('zh-CN')}
                      </div>
                    </div>
                    <span className="flex shrink-0 items-center gap-0.5 pl-2 text-[0.8571rem] font-semibold text-primary">
                      查看凭证
                      <Icon name="open_in_new" size={14} />
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </Drawer>
  )
}

/** 详情字段（标签在上、值在下；长文本允许换行） */
function TodoDetailField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[0.7857rem] font-medium text-on-surface-variant">{label}</span>
      <span className="break-all text-[0.9286rem]">{children}</span>
    </div>
  )
}

/** 清单名解析（导出给详情用，保持选择器稳定） */
function listNameOf(lists: { id: string; name: string }[], id: string): string | undefined {
  return lists.find((l) => l.id === id)?.name
}

function customerLabelOf(customers: Customer[], id: string): string | undefined {
  const c = customers.find((x) => x.id === id)
  if (!c) return undefined
  return c.company ? `${c.company} · ${c.name}` : c.name
}

function projectLabelOf(projects: Project[], id: string): string | undefined {
  return projects.find((p) => p.id === id)?.name
}

