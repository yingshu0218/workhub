import { useEffect, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { usePersonalQuery, type Value } from '@/queries/personal'
import { queryPersonal, cancelPersonal } from '@/domain/personal'
import { Button, Card, inputCls } from '@/design-system/ui'
import { formatFactTime, statusLabel } from '@/shared/records'
import { scopedClientKey } from '@/storage/clientSession'
import { downloadText } from '@/shared/download'
import RemovalPanel from './RemovalPanel'
import MutationPanel from './MutationPanel'

function PagedReferences({
  queryName,
  input,
  title,
}: {
  queryName: string
  input: Value
  title: string
}) {
  const [open, setOpen] = useState(false),
    query = usePersonalQuery(queryName, input, open)
  return (
    <section className="space-y-3 border-t border-outline-variant/30 pt-4">
      <Button variant="ghost" onClick={() => setOpen((v) => !v)}>
        {title}
      </Button>
      {open ? (
        <>
          {query.error ? <p role="alert">{query.error}</p> : null}
          <ul className="space-y-2">
            {query.data?.items.map((item, i) => (
              <li key={String(item.id || item.operationId || i)}>
                {item.path ? (
                  <Link className="text-primary" to={String(item.path)}>
                    {String(
                      item.title ||
                        item.name ||
                        item.summary ||
                        item.action ||
                        item.table ||
                        '操作',
                    )}
                  </Link>
                ) : (
                  String(item.table || '关联')
                )}
                {item.occurredAt ? ' · ' + formatFactTime(item.occurredAt) : ''}
                {item.beforeRev !== undefined
                  ? ' · 版本 ' + String(item.beforeRev) + ' → ' + String(item.afterRev)
                  : ''}
                {item.redacted ? ' · 内容已清理' : ''}
              </li>
            ))}
          </ul>
          {query.data?.nextCursor ? (
            <Button disabled={query.loading} onClick={() => void query.more()}>
              继续读取{title}
            </Button>
          ) : null}
        </>
      ) : null}
    </section>
  )
}
export default function RecordPage({ operation = false }: { operation?: boolean }) {
  const { id, requestId } = useParams()
  return (
    <Content
      key={(operation ? 'operation:' : 'activity:') + (id || requestId)}
      id={id || ''}
      requestId={requestId}
      operation={operation}
    />
  )
}
function Content({
  id,
  requestId,
  operation,
}: {
  id: string
  requestId?: string
  operation: boolean
}) {
  const query = usePersonalQuery(
    operation ? 'get_operation' : 'get_activity',
    operation ? (requestId ? { requestId } : { operationId: id }) : { id },
  )
  const row = query.data?.items[0]
  // 远端清理、刷新失败或版本变化均销毁正文尾段；未提交输入在独立草稿中保留。
  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <div className="flex justify-between">
        <Link className="text-primary" to="/timeline">
          返回时间线
        </Link>
        <Button variant="ghost" onClick={query.reload}>
          刷新
        </Button>
      </div>
      {query.error ? <p role="alert">{query.error}</p> : null}
      {query.loading && !row ? <p role="status">正在读取…</p> : null}
      {row ? (
        <Details
          key={String(row.id) + ':' + String(row.revision) + ':' + String(query.data?.watermark)}
          row={row}
          generation={query.data!.generation}
          operation={operation}
          reload={query.reload}
        />
      ) : null}
    </div>
  )
}
function Details({
  row,
  generation,
  operation,
  reload,
}: {
  row: Value
  generation: string
  operation: boolean
  reload: () => void
}) {
  const draftKey = scopedClientKey('workhub.draft.amend:' + row.id),
    initialSummary = String(
      (row.details as Record<string, { text: string }>)?.summary?.text || row.summary || '',
    )
  const [savedDraft] = useState<{ title?: string; summary?: string; revision?: number }>(() => {
    try {
      return JSON.parse(localStorage.getItem(draftKey) || 'null') || {}
    } catch {
      return {}
    }
  })
  const [editing, setEditing] = useState(!!savedDraft.title || !!savedDraft.summary),
    [title, setTitle] = useState(savedDraft.title ?? String(row.title || '')),
    [summary, setSummary] = useState(savedDraft.summary ?? initialSummary)
  const [baseRevision, setBaseRevision] = useState(savedDraft.revision ?? row.revision)

  const [tail, setTail] = useState(''),
    [next, setNext] = useState<number | null | undefined>(),
    [source, setSource] = useState(''),
    [sourceNext, setSourceNext] = useState<number | null | undefined>(),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [danger, setDanger] = useState('')
  const chunk = (row.details as Record<string, { text: string; nextOffset: number | null }>)
    ?.summary
  const alive = useRef(true)
  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])
  useEffect(() => {
    if (title !== String(row.title || '') || summary !== initialSummary)
      localStorage.setItem(draftKey, JSON.stringify({ title, summary, revision: baseRevision }))
  }, [title, summary, draftKey, row.title, initialSummary, baseRevision])
  const offset = next === undefined ? chunk?.nextOffset : next
  useEffect(() => {
    const clear = () => {
      setTail('')
      setSource('')
      setNext(null)
      setSourceNext(null)
    }
    window.addEventListener('workhub:changed', clear)
    return () => window.removeEventListener('workhub:changed', clear)
  }, [])
  async function read(sourceBody = false) {
    if (busy) return
    setBusy(true)
    setError('')
    try {
      const response = await queryPersonal('get_activity', {
        id: row.id,
        generation,
        revision: row.revision,
        ...(sourceBody
          ? { fields: [], includeSource: true, sourceOffset: sourceNext || 0 }
          : { fields: ['summary'], bodyOffset: offset }),
      })
      if (!alive.current) return
      const value = (response.items as Value[])[0]
      if (sourceBody) {
        const s = value.source as { text: string; nextOffset: number | null }
        setSource((text) => text + (s?.text || '未记录来源原话'))
        setSourceNext(s?.nextOffset ?? null)
      } else {
        const c = (value.details as Record<string, { text: string; nextOffset: number | null }>)
          .summary
        setTail((text) => text + c.text)
        setNext(c.nextOffset)
      }
    } catch (e) {
      if (!alive.current) return
      setTail('')
      setSource('')
      setError(String(e))
      reload()
    } finally {
      setBusy(false)
    }
  }
  async function cancel() {
    setBusy(true)
    try {
      await cancelPersonal({ requestId: String(row.requestId), generation })
      reload()
    } catch (e) {
      setError(String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <Card className="space-y-4 p-5 md:p-7">
        <h1 className="break-words text-[1.5714rem] font-bold">
          {operation ? '操作记录' : String(row.title || '事件')}
        </h1>
        {error ? <p role="alert">{error}</p> : null}
        {operation ? (
          <>
            <p>
              {statusLabel(row.status)} · {String(row.initiator || '原发起端')}
            </p>
            {row.status === 'awaiting_confirmation' ? (
              <>
                <p>请返回原发起端确认这份预览。</p>
                {row.canCancel ? (
                  <Button disabled={busy} onClick={() => void cancel()}>
                    撤回本端预览
                  </Button>
                ) : (
                  <p>该预览由另一客户端发起，请在原端撤回。</p>
                )}
              </>
            ) : null}
            <PagedReferences
              queryName="get_operation"
              input={{ operationId: row.id, view: 'effects' }}
              title="变更明细"
            />
            {row.status === 'committed' ? (
              <MutationPanel
                kind="undo"
                slot={'undo:' + row.id}
                label="预览撤销范围"
                input={{ operationId: row.id }}
              >
                <p>撤销会检查后续修改与依赖，不会直接抹掉后续工作。</p>
              </MutationPanel>
            ) : null}
          </>
        ) : (
          <>
            <p>
              发生：{formatFactTime(row.occurredAt, row.timePrecision, row.timeZone)}
              {row.occurredUntil
                ? ' 至 ' + formatFactTime(row.occurredUntil, row.timePrecision, row.timeZone)
                : ''}
            </p>
            <p>录入：{formatFactTime(row.recordedAt)}</p>
            <p className="text-sm text-outline">
              {row.timePrecision === 'date'
                ? '仅记录日期，未指定钟点'
                : String(row.timeZone || '时区未记录')}
            </p>
            <p className="whitespace-pre-wrap break-words rounded-lg bg-surface-container-low/60 p-4 leading-relaxed">
              {chunk?.text || String(row.summary || '')}
              {tail}
            </p>
            {offset != null ? (
              <Button disabled={busy} onClick={() => void read()}>
                继续读取正文
              </Button>
            ) : null}
            <Button
              variant="ghost"
              disabled={busy || sourceNext === null}
              onClick={() => void read(true)}
            >
              {source ? '继续读取来源' : '查看来源原话'}
            </Button>
            {source ? (
              <blockquote className="whitespace-pre-wrap break-words border-l-2 border-primary pl-4">
                {source}
              </blockquote>
            ) : null}
            <div className="flex flex-wrap gap-4 text-sm font-medium text-primary">
              <Link to={'/graph?table=activities&id=' + encodeURIComponent(String(row.id))}>
                事件图谱
              </Link>
              <Link to={'/timeline?focus=' + encodeURIComponent(String(row.id))}>在时间线定位</Link>
              {row.sourceOperationId ? (
                <Link to={'/operations/' + encodeURIComponent(String(row.sourceOperationId))}>
                  录入操作
                </Link>
              ) : null}
            </div>
            <PagedReferences
              queryName="get_record"
              input={{ table: 'activities', id: row.id, view: 'relations' }}
              title="关联对象"
            />
            <PagedReferences
              queryName="get_record"
              input={{ table: 'activities', id: row.id, view: 'history' }}
              title="修改历史"
            />
            <Button variant="tonal" onClick={() => setEditing((v) => !v)}>
              纠正事件
            </Button>
            <Button variant="ghost" onClick={() => setDanger((v) => (v ? '' : 'delete'))}>
              删除与隐私清理
            </Button>
          </>
        )}
      </Card>
      {!operation && editing ? (
        <MutationPanel
          kind="amend"
          slot={'amend:' + row.id}
          label="预览纠正内容"
          input={{
            changes: [
              {
                table: 'activities',
                id: row.id,
                expectedRev: baseRevision,
                patch: {
                  ...(title !== String(row.title || '') ? { title } : {}),
                  ...(summary !== initialSummary && summary !== initialSummary + tail
                    ? { summary }
                    : {}),
                },
              },
            ],
          }}
          onDone={() => {
            localStorage.removeItem(draftKey)
            reload()
          }}
        >
          {baseRevision !== row.revision ? (
            <div className="space-y-2">
              <p role="alert">草稿基于较早版本，请比较上方服务器内容；不会自动覆盖后续修改。</p>
              <Button
                variant="ghost"
                onClick={() => {
                  const previous = { title, summary, revision: baseRevision }
                  const key = scopedClientKey(
                    'workhub.draft.amend-backup:' + row.id + ':' + Date.now(),
                  )
                  localStorage.setItem(key, JSON.stringify(previous))
                  downloadText(
                    JSON.stringify(previous, null, 2),
                    '未提交纠错草稿.json',
                    'application/json',
                  )
                  localStorage.removeItem(draftKey)
                  setTitle(String(row.title || ''))
                  setSummary(initialSummary)
                  setBaseRevision(row.revision)
                }}
              >
                保留旧草稿副本，按当前版本重新编辑
              </Button>
            </div>
          ) : null}
          <label>
            主题
            <input className={inputCls} value={title} onChange={(e) => setTitle(e.target.value)} />
          </label>
          <label>
            当前事实摘要
            <textarea
              disabled={offset != null}
              className={inputCls}
              value={summary === initialSummary ? initialSummary + tail : summary}
              onChange={(e) => setSummary(e.target.value)}
            />
          </label>
          {offset != null ? <p>完整正文读取完毕后才可编辑正文；仅修改主题会保留原全文。</p> : null}
        </MutationPanel>
      ) : null}
      {!operation && danger ? <RemovalPanel row={row} onDone={reload} /> : null}
    </>
  )
}
