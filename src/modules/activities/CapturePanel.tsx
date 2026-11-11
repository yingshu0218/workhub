import { useState } from 'react'
import MutationPanel from './MutationPanel'
import { inputCls } from '@/design-system/ui'
import { scopedClientKey } from '@/storage/clientSession'

export default function CapturePanel({
  contactId,
  topicId,
}: {
  contactId?: string
  topicId?: string
}) {
  const key = scopedClientKey('workhub.draft.capture:' + (contactId || topicId || 'today'))
  const [draft, setDraft] = useState(() => {
    try {
      return (
        JSON.parse(localStorage.getItem(key) || 'null') || {
          title: '',
          summary: '',
          date: new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Shanghai' }),
        }
      )
    } catch {
      return { title: '', summary: '', date: '' }
    }
  })
  function edit(field: string, value: string) {
    const next = { ...draft, [field]: value }
    setDraft(next)
    localStorage.setItem(key, JSON.stringify(next))
  }
  return (
    <MutationPanel
      kind="capture"
      slot={'capture:' + (contactId || topicId || 'today')}
      label="预览记录"
      input={{
        activities: [
          {
            key: 'event',
            title: draft.title,
            summary: draft.summary,
            occurredAt: draft.date,
            timePrecision: 'date',
            timeZone: 'Asia/Shanghai',
            ...(contactId ? { contactIds: [contactId] } : {}),
            ...(topicId ? { topicIds: [topicId] } : {}),
          },
        ],
      }}
      onDone={() => {
        localStorage.removeItem(key)
        setDraft({ ...draft, title: '', summary: '' })
      }}
    >
      <h2 className="font-semibold">快速记录已发生的事</h2>
      <label className="block text-sm">
        主题
        <input
          className={inputCls}
          value={draft.title}
          onChange={(e) => edit('title', e.target.value)}
        />
      </label>
      <label className="block text-sm">
        发生日期
        <input
          type="date"
          className={inputCls}
          value={draft.date}
          onChange={(e) => edit('date', e.target.value)}
        />
      </label>
      <label className="block text-sm">
        事实内容
        <textarea
          className={inputCls}
          rows={3}
          value={draft.summary}
          onChange={(e) => edit('summary', e.target.value)}
        />
      </label>
      <p className="text-sm text-outline">
        草稿 · 尚未记入正式数据。复杂讲述可交给已授权的外部 Agent。
      </p>
    </MutationPanel>
  )
}
