import RecordFields from './RecordFields'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { usePersonalQuery } from '@/queries/personal'
import { Button, Card, PageHeader } from '@/design-system/ui'
import { moneyLabel, recordPath, statusLabel, formatFactTime } from '@/shared/records'
export default function RecordsPage({ detail = false }: { detail?: boolean }) {
  const { table, id } = useParams(),
    [params] = useSearchParams(),
    kind = table || params.get('table') || 'transactions'
  const input = detail ? { table: kind, id } : { limit: 30, ...Object.fromEntries(params) }
  const query = usePersonalQuery(
    detail ? 'get_record' : kind === 'todos' ? 'query_tasks' : 'query_finance',
    input,
  )
  const relations = usePersonalQuery('get_record', { table: kind, id, view: 'relations' }, detail),
    history = usePersonalQuery('get_record', { table: kind, id, view: 'history' }, detail)
  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <PageHeader
        title={detail ? '记录详情' : kind === 'todos' ? '相关承诺' : '相关收支'}
        actions={
          <Button variant="ghost" onClick={query.reload}>
            刷新
          </Button>
        }
      />
      {query.error ? <p role="alert">{query.error}</p> : null}
      {query.loading ? <p role="status">正在读取…</p> : null}
      {query.data?.cached ? <p>离线缓存</p> : null}
      {query.data?.items.map((row) => (
        <Card key={String(row.id)} className="space-y-3 p-5">
          <Link
            className="break-words text-lg font-semibold text-primary"
            to={
              detail
                ? recordPath(kind, String(row.id))
                : '/record/' + kind + '/' + encodeURIComponent(String(row.id))
            }
          >
            {String(row.title || row.name || row.summary || kind)}
          </Link>
          {row.amountMinor != null ? (
            <p>
              {moneyLabel(row.amountMinor, row.currency)} · {statusLabel(row.status)}
            </p>
          ) : null}
          {row.dueAt ? <p>截止：{formatFactTime(row.dueAt, 'date')}</p> : null}
          {detail ? (
            <RecordFields
              key={
                String(row.id) + ':' + String(row.revision) + ':' + String(query.data?.watermark)
              }
              row={row}
              table={kind}
              generation={query.data!.generation}
              onError={query.reload}
            />
          ) : null}
        </Card>
      ))}
      {query.data?.nextCursor ? (
        <Button disabled={query.loading} onClick={() => void query.more()}>
          继续读取
        </Button>
      ) : null}
      {detail ? (
        <>
          {[
            [relations, '关联来源'],
            [history, '历史操作'],
          ].map(([result, title]) => {
            const r = result as typeof relations
            return (
              <Card key={String(title)} className="space-y-3 p-5">
                <h2 className="text-[1.0714rem] font-semibold">{String(title)}</h2>
                {r.error ? <p role="alert">{r.error}</p> : null}
                {r.data?.items.map((row, i) => (
                  <p key={String(row.id || i)}>
                    {row.path ? (
                      <Link className="text-primary" to={String(row.path)}>
                        {String(row.title || row.name || row.summary || row.table)}
                      </Link>
                    ) : (
                      String(row.table || row.action || '记录')
                    )}
                    {row.redacted ? ' · 内容已清理' : ''}
                  </p>
                ))}
                {r.data?.nextCursor ? (
                  <Button disabled={r.loading} onClick={() => void r.more()}>
                    继续读取
                  </Button>
                ) : null}
              </Card>
            )
          })}
        </>
      ) : null}
    </div>
  )
}
