import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { usePersonalQuery, type Value } from '@/queries/personal'
import { useRecord } from '@/queries/hooks'
import type { Customer } from '@/db/types'
import { Avatar, Button, Card } from '@/design-system/ui'
import { Icon } from '@/design-system/Icon'
import CustomerFormDrawer from '@/modules/crm/CustomerFormDrawer'
import { FeedList } from './FeedList'
import CapturePanel from './CapturePanel'
import EntityPicker from './EntityPicker'
import MutationPanel from './MutationPanel'
import { moneyLabel, recordPath } from '@/shared/records'
export default function ContactPage() {
  const { id } = useParams(),
    query = usePersonalQuery('get_contact_context', { id }),
    customer = useRecord<Customer>('customers', id),
    [editing, setEditing] = useState(false),
    [deleting, setDeleting] = useState(false),
    [merging, setMerging] = useState(false),
    [mergeTarget, setMergeTarget] = useState('')
  const target = usePersonalQuery(
    'get_record',
    { table: 'customers', id: mergeTarget },
    !!mergeTarget,
  )
  const contact = query.data?.items[0],
    recent = query.data?.recent as { items: Value[]; truncated: boolean } | undefined,
    tasks = query.data?.commitments as { items: Value[]; truncated: boolean } | undefined,
    finance = query.data?.finance as
      { totals: Record<string, { incomeMinor: number; expenseMinor: number }> } | undefined
  return (
    <div className="mx-auto max-w-[1200px] space-y-5">
      {query.error ? <p role="alert">{query.error}</p> : null}
      {query.loading ? <p role="status">正在读取联系人…</p> : null}
      {contact ? (
        <>
          <Card className="p-5 md:p-6">
            <div className="flex flex-wrap items-center gap-4">
              <Avatar name={String(contact.preferredName || contact.name)} size={56} />
              <div className="min-w-0 flex-1">
                <h1 className="break-words text-[1.5714rem] font-bold">
                  {String(contact.preferredName || contact.name)}
                </h1>
                <p className="mt-1 text-sm text-on-surface-variant">
                  {String(contact.company || '个人联系人')}
                </p>
              </div>
              <Button
                icon="edit"
                variant="ghost"
                disabled={!customer}
                onClick={() => setEditing(true)}
              >
                编辑资料
              </Button>
            </div>
            <nav className="mt-5 flex flex-wrap gap-x-5 gap-y-2 border-t border-outline-variant/30 pt-4 text-sm font-medium text-primary">
              <Link to={'/timeline?contactId=' + encodeURIComponent(id!)}>联系人时间线</Link>
              <Link to={'/graph?table=customers&id=' + encodeURIComponent(id!)}>关系图谱</Link>
              <Link to="/crm">全部联系人</Link>
            </nav>
          </Card>
          <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
            <section className="min-w-0 space-y-4">
              <h2 className="flex items-center gap-2 text-[1.0714rem] font-semibold">
                <Icon name="timeline" className="text-primary" />
                近期事件
              </h2>
              <FeedList items={recent?.items || []} />
              {recent?.truncated ? (
                <Link
                  className="text-primary"
                  to={'/timeline?contactId=' + encodeURIComponent(id!)}
                >
                  继续查看事件
                </Link>
              ) : null}
              <CapturePanel contactId={id} />
            </section>
            <section className="min-w-0 space-y-4 text-sm">
              <Card className="space-y-3 p-5">
                <h2 className="flex items-center gap-2 text-[1.0714rem] font-semibold">
                  <Icon name="check_circle" size={18} className="text-primary" />
                  未完成承诺
                </h2>
                <ul className="space-y-2">
                  {tasks?.items.map((task) => (
                    <li key={String(task.id)}>
                      <Link className="text-primary" to={String(task.path)}>
                        {String(task.title)}
                      </Link>
                    </li>
                  ))}
                </ul>
                <Link
                  className="text-primary"
                  to={'/records?table=todos&contactId=' + encodeURIComponent(id!)}
                >
                  {tasks?.truncated ? '继续查看全部相关承诺' : '全部相关承诺'}
                </Link>
                <Link
                  className="block text-primary"
                  to={'/timeline?contactId=' + encodeURIComponent(id!)}
                >
                  查看来源与执行变化
                </Link>
              </Card>
              <Card className="space-y-3 p-5">
                <h2 className="flex items-center gap-2 text-[1.0714rem] font-semibold">
                  <Icon name="account_balance_wallet" size={18} className="text-primary" />
                  相关收支
                </h2>
                {Object.entries(finance?.totals || {}).map(([currency, total]) => (
                  <p key={currency}>
                    {currency} · 收入 {moneyLabel(total.incomeMinor, currency)} · 支出{' '}
                    {moneyLabel(total.expenseMinor, currency)}
                  </p>
                ))}
                <Link
                  className="text-primary"
                  to={'/records?table=transactions&contactId=' + encodeURIComponent(id!)}
                >
                  查看相关流水
                </Link>
              </Card>
              <Card className="space-y-3 p-5">
                <h2 className="flex items-center gap-2 text-[1.0714rem] font-semibold">
                  <Icon name="group" size={18} className="text-primary" />
                  关系与资料
                </h2>
                <p>别名：{((contact.aliases as string[]) || []).join('、') || '未填写'}</p>
                <p>
                  类型：
                  {(
                    { person: '个人', organization: '机构', unspecified: '未指定' } as Record<
                      string,
                      string
                    >
                  )[String(contact.contactType)] || '未指定'}
                </p>
                <Link className="text-primary" to={recordPath('customers', id)}>
                  当前联系人
                </Link>
                <Link
                  className="ml-4 text-primary"
                  to={'/record/customers/' + encodeURIComponent(id!)}
                >
                  完整联系方式、关系与历史
                </Link>
                <p className="text-sm text-outline">公司与商务资料均为可选；健康分只作辅助。</p>
              </Card>
              <Button variant="ghost" onClick={() => setMerging((v) => !v)}>
                合并重复联系人
              </Button>
              {merging ? (
                <MutationPanel
                  kind="merge"
                  slot={'merge:' + id}
                  label="预览合并范围"
                  input={{
                    sourceId: id,
                    sourceRev: contact.revision,
                    targetId: mergeTarget,
                    targetRev: target.data?.items[0]?.revision,
                  }}
                  onDone={query.reload}
                >
                  <EntityPicker
                    table="customers"
                    label="合并到已有联系人"
                    value={mergeTarget}
                    onChange={setMergeTarget}
                  />
                  <p>
                    当前联系人会合并到所选身份，保留名称别名并迁移关联；确认预览前不会修改资料。
                  </p>
                </MutationPanel>
              ) : null}
              <Button variant="ghost" onClick={() => setDeleting((v) => !v)}>
                删除联系人
              </Button>
              {deleting ? (
                <MutationPanel
                  kind="delete"
                  slot={'contact-delete:' + id}
                  input={{ targets: [{ table: 'customers', id, expectedRev: contact.revision }] }}
                  label="预览解除身份关联"
                >
                  <p>保留经历、流水和承诺，只解除联系人身份关联。</p>
                </MutationPanel>
              ) : null}
            </section>
          </div>
        </>
      ) : null}
      <CustomerFormDrawer
        open={editing && !!customer}
        customer={customer || null}
        onClose={() => {
          setEditing(false)
          query.reload()
        }}
      />
    </div>
  )
}
