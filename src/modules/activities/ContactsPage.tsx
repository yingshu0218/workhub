import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@/queries/hooks'
import { db } from '@/db/db'
import { Button, Card, PageHeader, inputCls } from '@/design-system/ui'
import CustomerFormDrawer from '@/modules/crm/CustomerFormDrawer'
export default function ContactsPage() {
  const [q, setQ] = useState(''),
    [page, setPage] = useState(0),
    [adding, setAdding] = useState(false)
  const rows = useQuery(
    () =>
      db.customers
        .filter(
          (c) =>
            !c.deleted &&
            (!q ||
              [c.name, c.preferredName, c.company, ...(c.aliases || [])].some((v) =>
                v?.toLowerCase().includes(q.toLowerCase()),
              )),
        )
        .offset(page * 50)
        .limit(51)
        .toArray(),
    [q, page],
  )
  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <PageHeader
        title="联系人"
        actions={
          <Button icon="add" onClick={() => setAdding(true)}>
            新建联系人
          </Button>
        }
      />
      <label className="block">
        姓名、别名或机构
        <input
          className={inputCls}
          value={q}
          onChange={(e) => {
            setQ(e.target.value)
            setPage(0)
          }}
        />
      </label>
      <div className="grid gap-3 sm:grid-cols-2">
        {rows?.slice(0, 50).map((contact) => (
          <Card key={contact.id} className="space-y-2 p-4">
            <Link
              className="text-lg font-semibold text-primary"
              to={'/crm/' + encodeURIComponent(contact.id)}
            >
              {contact.preferredName || contact.name}
            </Link>
            <p>{contact.company}</p>
            <p className="text-sm text-outline">{(contact.aliases || []).join('、')}</p>
          </Card>
        ))}
      </div>
      {rows && !rows.length ? <p>没有匹配的联系人。</p> : null}
      <div className="flex gap-4">
        <Button variant="ghost" disabled={!page} onClick={() => setPage((n) => n - 1)}>
          上一页
        </Button>
        <Button
          variant="ghost"
          disabled={!rows || rows.length <= 50}
          onClick={() => setPage((n) => n + 1)}
        >
          下一页
        </Button>
      </div>
      <CustomerFormDrawer open={adding} customer={null} onClose={() => setAdding(false)} />
    </div>
  )
}
