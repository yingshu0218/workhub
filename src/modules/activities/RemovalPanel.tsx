import { useState } from 'react'
import { usePersonalQuery, type Value } from '@/queries/personal'
import { Button, inputCls } from '@/design-system/ui'
import MutationPanel from './MutationPanel'
interface Target {
  table: string
  id: string
  expectedRev: number
}
function Choices({
  table,
  id,
  base,
  selected,
  choose,
  depth = 0,
}: {
  table: string
  id: string
  base: string
  selected: Target[]
  choose: (row: Value, on: boolean) => void
  depth?: number
}) {
  const query = usePersonalQuery('get_record', { table, id, view: 'relations', limit: 20 })
  return (
    <div className="space-y-2 border-l border-outline-variant pl-3">
      {query.error ? <p role="alert">{query.error}</p> : null}
      {query.data?.items
        .filter(
          (r) =>
            [
              'activities',
              'customers',
              'todos',
              'transactions',
              'notes',
              'attachments',
              'projects',
            ].includes(String(r.table)) && r.table + '/' + r.id !== base,
        )
        .map((row) => (
          <div key={String(row.table) + '/' + row.id}>
            <label className="flex gap-2">
              <input
                type="checkbox"
                checked={selected.some((t) => t.table === row.table && t.id === row.id)}
                onChange={(e) => choose(row, e.target.checked)}
              />
              <span>
                {String(row.title || row.name || row.summary || '关联记录')} · {String(row.table)}
              </span>
            </label>
            {row.table === 'attachments' && depth === 0 ? (
              <>
                <p className="text-sm text-outline">此附件的全部引用来源：</p>
                <Choices
                  table="attachments"
                  id={String(row.id)}
                  base={base}
                  selected={selected}
                  choose={choose}
                  depth={1}
                />
              </>
            ) : null}
          </div>
        ))}
      {query.data?.nextCursor ? (
        <Button variant="ghost" disabled={query.loading} onClick={() => void query.more()}>
          继续读取相关范围
        </Button>
      ) : null}
    </div>
  )
}
export default function RemovalPanel({ row, onDone }: { row: Value; onDone: () => void }) {
  const [kind, setKind] = useState('delete'),
    [selected, setSelected] = useState<Target[]>([])
  const base = { table: 'activities', id: String(row.id), expectedRev: Number(row.revision) }
  const choose = (r: Value, on: boolean) =>
    setSelected((old) =>
      on
        ? [
            ...old.filter((t) => t.table !== r.table || t.id !== r.id),
            { table: String(r.table), id: String(r.id), expectedRev: Number(r.revision) },
          ]
        : old.filter((t) => t.table !== r.table || t.id !== r.id),
    )
  return (
    <div className="space-y-3">
      <label>
        处理方式
        <select
          className={inputCls}
          value={kind}
          onChange={(e) => {
            setKind(e.target.value)
            setSelected([])
          }}
        >
          <option value="delete">移入回收站，保留独立流水与承诺</option>
          <option value="purge">彻底清理事件及来源痕迹</option>
        </select>
      </label>
      <MutationPanel
        key={kind}
        kind={kind}
        slot={kind + ':' + row.id}
        input={{ targets: [base, ...selected] }}
        label="预览影响范围"
        onDone={onDone}
      >
        <p>
          当前事件为必选。独立收支、承诺和其他事件默认保留；共享附件必须明确覆盖全部引用来源，范围不足时服务器会拒绝。
        </p>
        {kind === 'purge' ? (
          <Choices
            table="activities"
            id={String(row.id)}
            base={'activities/' + row.id}
            selected={selected}
            choose={choose}
          />
        ) : null}
      </MutationPanel>
    </div>
  )
}
