import { Link } from 'react-router-dom'
import { Card } from '@/design-system/ui'
import { formatFactTime, moneyLabel, statusLabel } from '@/shared/records'
import type { Value } from '@/queries/personal'
export function FeedList({ items }: { items: Value[] }) {
  return (
    <ul className="space-y-3">
      {items.map((item) => {
        const record = (item.record || item) as Value,
          before = record.before as Value | undefined,
          after = record.after as Value | undefined
        return (
          <li key={String(item.key || record.id)}>
            <Card className="space-y-2 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Link
                  className="font-semibold text-primary"
                  to={String(record.path || '/timeline')}
                >
                  {String(record.title || record.summary || '记录')}
                </Link>
                <span className="text-xs text-outline">
                  {item.sourceType === 'task_change'
                    ? '承诺变化'
                    : item.sourceType === 'legacy_finance'
                      ? '独立收支'
                      : '已发生'}
                </span>
              </div>
              <p className="text-sm text-on-surface-variant">
                发生：
                {formatFactTime(
                  item.at || record.occurredAt,
                  record.timePrecision,
                  record.timeZone,
                )}
                {record.timePrecision === 'date' ? ' · 仅日期' : ''}
              </p>
              {record.recordedAt ? (
                <p className="text-xs text-outline">录入：{formatFactTime(record.recordedAt)}</p>
              ) : null}
              {item.sourceType === 'task_change' && before && after ? (
                <p>
                  {statusLabel(before.status)} → {statusLabel(after.status)}
                  {before.dueAt !== after.dueAt
                    ? ` · 截止：${formatFactTime(before.dueAt, 'date')} → ${formatFactTime(after.dueAt, 'date')}`
                    : ''}
                </p>
              ) : null}
              {record.summary && record.title ? (
                <p className="whitespace-pre-wrap break-words text-sm">{String(record.summary)}</p>
              ) : null}
              {record.amountMinor !== undefined ? (
                <p>
                  {moneyLabel(record.amountMinor, record.currency)} · {String(record.currency)}
                </p>
              ) : null}
              <div className="flex flex-wrap gap-4 text-sm">
                {record.table === 'activities' ? (
                  <Link
                    className="text-primary"
                    to={'/graph?table=activities&id=' + encodeURIComponent(String(record.id))}
                  >
                    查看事件图谱
                  </Link>
                ) : null}
                {item.operationId ? (
                  <Link
                    className="text-primary"
                    to={'/operations/' + encodeURIComponent(String(item.operationId))}
                  >
                    查看操作来源
                  </Link>
                ) : null}
              </div>
            </Card>
          </li>
        )
      })}
    </ul>
  )
}
