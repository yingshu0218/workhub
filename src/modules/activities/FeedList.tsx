import { Link } from 'react-router-dom'
import { Card } from '@/design-system/ui'
import { Icon } from '@/design-system/Icon'
import { formatFactTime, moneyLabel, statusLabel } from '@/shared/records'
import type { Value } from '@/queries/personal'
import { feedAppearance, moduleThemeStyle } from '@/shared/moduleTheme'
export function FeedList({ items }: { items: Value[] }) {
  return (
    <ul className="relative space-y-3 border-l border-outline-variant/50 pl-5">
      {items.map((item) => {
        const record = (item.record || item) as Value,
          before = record.before as Value | undefined,
          after = record.after as Value | undefined
        const appearance = feedAppearance(item)
        return (
          <li
            key={String(item.key || record.id)}
            className="module-theme relative min-w-0"
            data-module={appearance.module}
            style={moduleThemeStyle(appearance.module)}
          >
            <span className="absolute -left-[27px] top-5 h-3 w-3 rounded-full border-[3px] border-surface bg-primary" />
            <Card className="timeline-event-card space-y-2 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Link
                  className="min-w-0 break-words font-semibold text-on-surface hover:text-primary"
                  to={String(record.path || '/timeline')}
                >
                  {String(record.title || record.summary || '记录')}
                </Link>
                <span className="timeline-event-badge inline-flex max-w-full items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium">
                  <Icon name={appearance.icon} size={13} className="shrink-0" />
                  <span className="break-words">{appearance.label}</span>
                </span>
              </div>
              <p className="text-xs text-on-surface-variant">
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
                <p className="whitespace-pre-wrap break-words text-sm leading-relaxed">
                  {String(record.summary)}
                </p>
              ) : null}
              {record.amountMinor !== undefined ? (
                <p>
                  {moneyLabel(record.amountMinor, record.currency)} · {String(record.currency)}
                </p>
              ) : null}
              <div className="flex flex-wrap gap-4 pt-1 text-xs">
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
