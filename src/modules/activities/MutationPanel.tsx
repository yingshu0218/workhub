import { ClientRequestError } from '@/platform/request'
import { useState, type ReactNode } from 'react'
import { previewPersonal, commitPersonal, cancelPersonal, queryPersonal } from '@/domain/personal'
import { clientSession, scopedClientKey } from '@/storage/clientSession'
import { notifyMirrorChanged } from '@/storage/clientMirror'
import { requestId } from '@/storage/commandPlan'
import { Button, Card } from '@/design-system/ui'
import { moneyLabel, formatFactTime, recordPath } from '@/shared/records'
import { Link } from 'react-router-dom'
import type { Value } from '@/queries/personal'

interface Pending {
  requestId: string
  generation: string
  input: Value
  preview?: Value
  committed?: boolean
}
export default function MutationPanel({
  kind,
  input,
  slot,
  label,
  children,
  onDone,
}: {
  kind: string
  input: Value
  slot: string
  label: string
  children?: ReactNode
  onDone?: () => void
}) {
  const key = scopedClientKey('workhub.action.' + slot)
  const [pending, setPending] = useState<Pending | undefined>(() => {
    try {
      return JSON.parse(localStorage.getItem(key) || 'null') || undefined
    } catch {
      return undefined
    }
  })
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [done, setDone] = useState(false)
  function save(next: Pending) {
    localStorage.setItem(key, JSON.stringify(next))
    setPending(next)
  }
  async function preview() {
    if (busy) return
    setBusy(true)
    setError('')
    try {
      if (!navigator.onLine) throw new Error('离线草稿尚未提交，可继续编辑，联网后预览')
      const generation =
        clientSession()?.generation ||
        String((await queryPersonal('list_operations', { limit: 1 })).generation)
      const context = pending || { requestId: requestId(), generation, input }
      // 预览失败也保留原请求；断线时不得悄悄换号重录。
      save(context)
      const result = await previewPersonal(kind, context.input, context)
      if (result.committed) {
        localStorage.removeItem(key)
        setPending(undefined)
        setDone(true)
        notifyMirrorChanged()
        onDone?.()
      } else save({ ...context, preview: result })
    } catch (e) {
      if (
        ((e instanceof ClientRequestError &&
          (e.status === 400 || (e.status === 409 && /CONFLICT|DELETED/.test(e.code)))) ||
          /^(Error: )?(INVALID_|LIMIT_EXCEEDED|EMPTY_|MONEY_|DATE_|CONFLICT:)/.test(String(e))) &&
        !/REQUEST_REUSED|RECOVERY|GENERATION|RESULT_UNKNOWN/.test(String(e))
      ) {
        localStorage.removeItem(key)
        setPending(undefined)
      }
      setError(String(e))
    } finally {
      setBusy(false)
    }
  }
  async function commit() {
    if (!pending?.preview || busy) return
    setBusy(true)
    setError('')
    try {
      await commitPersonal({
        ...pending,
        previewId: String(pending.preview.previewId),
        planFingerprint: String(pending.preview.planFingerprint),
      })
      localStorage.removeItem(key)
      setPending(undefined)
      setDone(true)
      onDone?.()
    } catch (e) {
      setError('结果待核对：' + String(e))
    } finally {
      setBusy(false)
    }
  }
  async function cancel() {
    if (!pending || busy) return
    setBusy(true)
    try {
      await cancelPersonal(pending)
      localStorage.removeItem(key)
      setPending(undefined)
      setError('')
    } catch (e) {
      setError(String(e))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Card className="space-y-4 p-5 md:p-6">
      <fieldset disabled={!!pending || busy} className="min-w-0 space-y-4 disabled:opacity-70">
        {children}
      </fieldset>
      {error ? (
        <p role="alert" className="break-words text-danger">
          {error}
        </p>
      ) : null}
      {done ? <p role="status">已提交到服务器</p> : null}
      {pending?.preview ? (
        <>
          <h3 className="font-semibold">确认本次变更</h3>
          <ul className="max-h-64 overflow-auto space-y-2">
            {((pending.preview.changes as Value[]) || []).map((change, i) => {
              const after = change.after as Value | undefined
              return (
                <li key={i} className="rounded-lg bg-surface-container-low p-3">
                  <span>
                    {String(
                      change.action === 'delete' ? '永久清理' : change.before ? '修改' : '新增',
                    )}{' '}
                    · {String(after?.title || after?.name || after?.summary || change.table)}
                  </span>
                  {after?.amountMinor !== undefined ? (
                    <p>
                      {moneyLabel(after.amountMinor, after.currency)} · {String(after.currency)}
                    </p>
                  ) : null}
                  {after?.occurredAt ? (
                    <p>
                      发生：{formatFactTime(after.occurredAt, after.timePrecision, after.timeZone)}
                    </p>
                  ) : null}
                  {after?.dueAt ? <p>截止：{formatFactTime(after.dueAt, 'date')}</p> : null}
                  {change.before !== undefined ? (
                    <p className="text-sm text-outline">基于版本 {String(change.before)}</p>
                  ) : null}
                  {after?.path ? (
                    <Link
                      className="ml-3 text-primary"
                      to={recordPath(String(change.table), change.id)}
                    >
                      对象详情
                    </Link>
                  ) : null}
                </li>
              )
            })}
          </ul>
          <p className="text-sm text-outline">确认后才会修改正式记录；查看详情不会自动确认。</p>
          <Button disabled={busy} onClick={() => void commit()}>
            确认并提交这份预览
          </Button>
        </>
      ) : (
        <Button disabled={busy} onClick={() => void preview()}>
          {busy ? '正在核对…' : pending ? '核对并重试原预览' : label}
        </Button>
      )}
      {pending ? (
        <>
          <Button variant="ghost" disabled={busy} onClick={() => void cancel()}>
            撤回本端预览
          </Button>
          <Link
            className="text-sm text-primary"
            to={'/operations/request/' + encodeURIComponent(pending.requestId)}
          >
            保留原请求 {pending.requestId.slice(0, 11)}…
          </Link>
        </>
      ) : null}
    </Card>
  )
}
