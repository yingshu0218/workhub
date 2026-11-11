import { useEffect, useRef, useState } from 'react'
import { queryPersonal } from '@/domain/personal'
import { Button } from '@/design-system/ui'
import type { Value } from '@/queries/personal'
const LABELS: Record<string, string> = {
  phone: '电话',
  email: '邮箱',
  wechat: '微信',
  address: '地址',
  company: '机构',
  title: '职务',
  desc: '详细内容',
  note: '备注',
  markdown: '笔记正文',
}
export default function RecordFields({
  row,
  table,
  generation,
  onError,
}: {
  row: Value
  table: string
  generation: string
  onError: () => void
}) {
  const fields = (row.details || {}) as Record<string, { text: string; nextOffset: number | null }>
  const [tails, setTails] = useState<Record<string, { text: string; nextOffset: number | null }>>(
      {},
    ),
    [busy, setBusy] = useState(false),
    alive = useRef(true)
  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])
  async function more(field: string) {
    if (busy) return
    setBusy(true)
    try {
      const offset = tails[field]?.nextOffset ?? fields[field].nextOffset
      const result = await queryPersonal('get_record', {
        table,
        id: row.id,
        generation,
        revision: row.revision,
        fields: [field],
        bodyOffset: offset,
      })
      if (!alive.current) return
      const next = ((result.items as Value[])[0].details as typeof fields)[field]
      setTails((old) => ({
        ...old,
        [field]: { text: (old[field]?.text || '') + next.text, nextOffset: next.nextOffset },
      }))
    } catch {
      if (alive.current) {
        setTails({})
        onError()
      }
    } finally {
      if (alive.current) setBusy(false)
    }
  }
  return (
    <dl className="space-y-4">
      {Object.entries(fields).map(([field, value]) => (
        <div key={field}>
          <dt className="text-sm text-outline">{LABELS[field] || field}</dt>
          <dd className="whitespace-pre-wrap break-words">
            {value.text}
            {tails[field]?.text}
            {!value.text && !tails[field]?.text ? '未填写' : ''}
          </dd>
          {(tails[field] ? tails[field].nextOffset : value.nextOffset) != null ? (
            <Button variant="ghost" disabled={busy} onClick={() => void more(field)}>
              继续读取{LABELS[field] || field}
            </Button>
          ) : null}
        </div>
      ))}
    </dl>
  )
}
