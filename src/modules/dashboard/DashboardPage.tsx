import { useCollection } from '@/queries/hooks'
import { Card, Chip, PageHeader, Button, EmptyState } from '@/design-system/ui'
import type { Todo, Customer, Transaction } from '@/db/types'
import dayjs from 'dayjs'

/** Phase 0 验证版工作台：P1 将完整实现 Focus Synchronizer */
export default function DashboardPage() {
  const todos = useCollection<Todo>('todos')
  const customers = useCollection<Customer>('customers')
  const transactions = useCollection<Transaction>('transactions')

  const hour = dayjs().hour()
  const greeting = hour < 6 ? '凌晨好' : hour < 12 ? '早上好' : hour < 18 ? '下午好' : '晚上好'
  const openTodos = todos.filter((t) => t.status !== 'done')
  const income = transactions
    .filter((t) => t.type === 'income')
    .reduce((s, t) => s + t.amount, 0)

  return (
    <div className="mx-auto max-w-[1200px]">
      <PageHeader
        title={`${greeting}，陈致远`}
        subtitle={dayjs().format('M月D日 dddd')}
        actions={<Button icon="auto_awesome" variant="ghost">灵感闪现</Button>}
      />

      <div className="grid grid-cols-3 gap-4">
        <Card className="p-5">
          <div className="text-[12px] font-medium uppercase tracking-wide text-outline">深度专注</div>
          <div className="mt-1 text-[28px] font-bold text-primary">0<span className="text-[14px] text-outline"> 分钟</span></div>
          <div className="mt-1 text-[12px] text-on-surface-variant">Phase 1 实装专注计时</div>
        </Card>
        <Card className="p-5">
          <div className="text-[12px] font-medium uppercase tracking-wide text-outline">待办达成</div>
          <div className="mt-1 text-[28px] font-bold">
            {todos.length - openTodos.length}
            <span className="text-[14px] text-outline"> / {todos.length}</span>
          </div>
          <div className="mt-1 text-[12px] text-on-surface-variant">今日任务闭环</div>
        </Card>
        <Card className="p-5">
          <div className="text-[12px] font-medium uppercase tracking-wide text-outline">累计收款</div>
          <div className="mt-1 text-[28px] font-bold text-success">
            ¥{income.toLocaleString()}
          </div>
          <div className="mt-1 text-[12px] text-on-surface-variant">{customers.length} 位客户在册</div>
        </Card>
      </div>

      <div className="mt-6 grid grid-cols-[1fr_340px] gap-4">
        <Card className="p-5">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-[15px] font-semibold">今日待办</h2>
            <Chip tone="blue">{openTodos.length} 项待办</Chip>
          </div>
          {openTodos.length === 0 ? (
            <EmptyState icon="task_alt" title="全部完成" description="今日待办已清空" />
          ) : (
            <ul className="divide-y divide-outline-variant/30">
              {openTodos.map((t) => (
                <li key={t.id} className="flex items-center gap-3 py-2.5">
                  <span
                    className={`material-symbols-rounded ${
                      t.priority === 'P1' ? 'text-danger' : 'text-outline'
                    }`}
                  >
                    {t.status === 'doing' ? 'pending' : 'radio_button_unchecked'}
                  </span>
                  <div className="flex-1">
                    <div className="text-[13.5px] font-medium">{t.title}</div>
                    {t.dueAt && (
                      <div className="text-[12px] text-outline">
                        截止 {dayjs(t.dueAt).format('HH:mm')}
                      </div>
                    )}
                  </div>
                  <Chip tone={t.priority === 'P1' ? 'red' : t.priority === 'P2' ? 'amber' : 'gray'}>
                    {t.priority}
                  </Chip>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card className="p-5">
          <h2 className="mb-3 text-[15px] font-semibold">随手速记</h2>
          <EmptyState
            icon="sticky_note_2"
            title="Phase 1 实装"
            description="速记便签、一键转待办/归笔记"
          />
        </Card>
      </div>
    </div>
  )
}
