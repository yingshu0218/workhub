import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { queryPersonal, cancelPersonal } from '@/domain/personal'
import { Button, Card } from '@/design-system/ui'

type Value = Record<string, unknown>
interface Chunk { text: string; nextOffset: number | null; revision: number; truncated: boolean }
function dateLabel(row: Value) {
  try { return new Intl.DateTimeFormat('zh-CN',{timeZone:String(row.timeZone || 'Asia/Shanghai'),dateStyle:'medium',...(row.timePrecision==='date'?{}:{timeStyle:'short'})}).format(Number(row.occurredAt)) }
  catch { return new Date(Number(row.occurredAt)).toISOString() }
}

/** 详情仅消费权威查询；完整时间线/图谱在下一交付复用相同路径与响应。 */
export default function RecordPage({ operation = false }: { operation?: boolean }) {
  const { id } = useParams()
  return <RecordContent key={(operation ? 'operation:' : 'activity:') + id} id={id || ''} operation={operation} />
}
function RecordContent({ id, operation }: { id: string; operation: boolean }) {
  const [response, setResponse] = useState<Value | null>(null)
  const [error, setError] = useState('')
  const [refresh, setRefresh] = useState(0)
  const [tail, setTail] = useState('')
  const [next, setNext] = useState<number | null | undefined>(undefined)
  const [busy, setBusy] = useState(false)
  const [extraEffects,setExtraEffects] = useState<Value[]>([])
  const [effectCursor,setEffectCursor] = useState<string | null | undefined>()
  useEffect(() => {
    let active = true
    void queryPersonal(operation ? 'get_operation' : 'get_activity', operation ? { operationId: id } : { id }).then(data => { if (active) setResponse(data) }).catch((e: Error) => { if (active) setError(e.message) })
    return () => { active = false }
  }, [id, operation, refresh])
  const row = (response?.items as Value[] | undefined)?.[0]
  const summary = (row?.details as Record<string, Chunk> | undefined)?.summary
  const continuation = next === undefined ? summary?.nextOffset : next
  async function continueBody() {
    if (!row || continuation == null || busy) return
    setBusy(true)
    try {
      const data = await queryPersonal('get_activity', { id: row.id, generation: response?.generation, revision: row.revision, fields: ['summary'], bodyOffset: continuation })
      const chunk = ((data.items as Value[])[0].details as Record<string, Chunk>).summary
      setTail(text => text + chunk.text); setNext(chunk.nextOffset)
    } catch (e) { setError((e as Error).message) } finally { setBusy(false) }
  }
  async function cancel() {
    if (!row || busy) return
    setBusy(true)
    try { await cancelPersonal({ requestId: String(row.requestId), generation: String(row.generation) }); setRefresh(n => n + 1) } catch (e) { setError((e as Error).message) } finally { setBusy(false) }
  }
  async function moreEffects() {
    if(!row || busy)return
    setBusy(true)
    try {
      const input={operationId:id,view:'effects',generation:response?.generation,limit:50,...(effectCursor?{cursor:effectCursor}:{})}
      let data=await queryPersonal('get_operation',input)
      if(effectCursor===undefined && data.nextCursor)data=await queryPersonal('get_operation',{...input,cursor:data.nextCursor})
      setExtraEffects(items=>[...items,...data.items as Value[]]);setEffectCursor(data.nextCursor as string | null)
    }catch(e){setError((e as Error).message)}finally{setBusy(false)}
  }
  return <div className="mx-auto flex w-full max-w-4xl flex-col gap-5 p-5">
    <div className="flex items-center justify-between"><Link to="/" className="text-primary underline">返回今天</Link><Button variant="ghost" icon="refresh" onClick={() => { setError(''); setTail(''); setNext(undefined); setRefresh(n => n + 1) }}>刷新</Button></div>
    {error ? <div role="alert" className="rounded-xl bg-error-container p-4 text-on-error-container">{error}</div> : null}
    {!row && !error ? <p role="status">正在读取…</p> : null}
    {row ? <Card className="space-y-4 p-5">
      <h1 className="text-2xl font-semibold">{operation ? '操作记录' : String(row.title || '事件')}</h1>
      {operation ? <>
        <p>{({committed:'已提交',awaiting_confirmation:'待确认',cancelled:'已撤回'} as Record<string,string>)[String(row.status)] || String(row.status)}</p>
        {row.status === 'awaiting_confirmation' ? <Button variant="tonal" disabled={busy} onClick={() => void cancel()}>撤回这份预览</Button> : null}
        <ul className="space-y-2">{[...((row.effects || []) as Value[]),...extraEffects].map(effect => <li key={String(effect.id)}>{effect.path ? <Link className="text-primary underline" to={String(effect.path)}>{String(effect.table)} · {String(effect.action)}</Link> : String(effect.table)}{effect.redacted ? ' · 内容已清理' : ''}</li>)}</ul>
        {row.effectsTruncated && effectCursor!==null ? <Button variant="ghost" disabled={busy} onClick={()=>void moreEffects()}>继续读取变更</Button> : null}
      </> : <>
        <p className="text-sm text-on-surface-variant">{dateLabel(row)} · {row.timePrecision === 'date' ? '日期精度' : '实际发生'}</p>
        <p className="whitespace-pre-wrap break-words">{summary?.text || String(row.summary || '')}{tail}</p>
        {continuation != null ? <Button variant="ghost" disabled={busy} onClick={() => void continueBody()}>继续读取正文</Button> : null}
        {row.sourceOperationId ? <Link className="inline-block text-primary underline" to={'/operations/' + encodeURIComponent(String(row.sourceOperationId))}>查看录入与修改来源</Link> : null}
        <ul className="space-y-2">{((row.related || []) as Value[]).map(ref => <li key={String(ref.table)+':'+String(ref.id)}>{ref.path ? <Link className="text-primary underline" to={String(ref.path)}>{String(ref.title || ref.name || ref.summary || ref.table)}</Link> : String(ref.title || ref.name || ref.table)}</li>)}</ul>
        {row.relatedTruncated ? <p>关联较多，请按此事件继续查询。</p> : null}
      </>}
    </Card> : null}
  </div>
}
