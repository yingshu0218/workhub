import { useParams, useSearchParams } from 'react-router-dom'
import { Button, Card, PageHeader, inputCls } from '@/design-system/ui'
import { usePersonalQuery, type Value } from '@/queries/personal'
import EntityPicker from './EntityPicker'
import { FeedList } from './FeedList'
export default function TimelinePage() {
  const { id } = useParams(),
    [params, setParams] = useSearchParams()
  const input: Value = { limit: 30, timeZone: 'Asia/Shanghai' }
  for (const key of ['contactId', 'topicId', 'from', 'to', 'q', 'category', 'sourceType'])
    if (params.get(key)) input[key] = params.get(key)
  if (id) input.contactId = id
  const query = usePersonalQuery('search_activities', input)
  const focus = params.get('focus') || '',
    focused = usePersonalQuery('get_activity', { id: focus }, !!focus)
  function filter(key: string, value: string) {
    const next = new URLSearchParams(params)
    if (value) next.set(key, value)
    else next.delete(key)
    setParams(next)
  }
  return (
    <div className="mx-auto max-w-[1200px] space-y-5">
      <PageHeader
        title={id ? '联系人时间线' : '个人时间线'}
        actions={
          <Button variant="ghost" icon="refresh" onClick={query.reload}>
            刷新
          </Button>
        }
      />
      <Card className="grid gap-3 p-4 sm:grid-cols-3">
        {[
          ['q', '关键词', 'text'],
          ['from', '开始日期', 'date'],
          ['to', '结束日期', 'date'],
          ['category', '类别', 'text'],
        ].map(([key, label, type]) => (
          <label key={key} className="text-sm">
            {label}
            <input
              type={type}
              className={inputCls}
              value={String(input[key] || '')}
              disabled={!!id && key === 'contactId'}
              onChange={(e) => filter(key, e.target.value)}
            />
          </label>
        ))}
        <EntityPicker
          table="customers"
          label="联系人"
          value={String(input.contactId || '')}
          onChange={(v) => filter('contactId', v)}
        />
        <EntityPicker
          table="projects"
          label="事项"
          value={String(input.topicId || '')}
          onChange={(v) => filter('topicId', v)}
        />
        <label className="text-sm">
          来源
          <select
            className={inputCls}
            value={params.get('sourceType') || ''}
            onChange={(e) => filter('sourceType', e.target.value)}
          >
            <option value="">全部事实与变化</option>
            <option value="activity">经历</option>
            <option value="task_change">承诺变化</option>
            <option value="legacy_finance">独立收支</option>
          </select>
        </label>
      </Card>
      {focus ? (
        <Card className="border-primary p-4" aria-label="定位的事件">
          <h2 className="mb-3 font-semibold">定位的事件 · 独立于下方筛选范围</h2>
          {focused.error ? <p role="alert">{focused.error}</p> : null}
          {focused.loading ? <p>正在定位…</p> : null}
          {focused.data?.items[0] ? (
            <FeedList
              items={[
                {
                  key: 'focus:' + focus,
                  sourceType: 'activity',
                  sourceId: focus,
                  record: focused.data.items[0],
                  at: focused.data.items[0].occurredAt,
                },
              ]}
            />
          ) : null}
        </Card>
      ) : null}
      {query.error ? <p role="alert">{query.error}</p> : null}
      {query.loading && !query.data ? <p role="status">正在读取…</p> : null}
      {query.data?.cached ? <p>离线缓存 · 显示上次查询结果</p> : null}
      {query.data ? (
        <>
          <FeedList items={query.data.items} />
          {!query.data.items.length ? <p>该范围还没有记录；无联系人事件也会显示在这里。</p> : null}
          {query.data.nextCursor ? (
            <Button disabled={query.loading} onClick={() => void query.more()}>
              继续读取
            </Button>
          ) : null}
        </>
      ) : null}
    </div>
  )
}
