import { useState } from 'react'
import MutationPanel from './MutationPanel'
import { inputCls } from '@/design-system/ui'
import { Icon } from '@/design-system/Icon'
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
      <h2 className="flex items-center gap-2 text-[1.0714rem] font-semibold">
        <Icon name="edit_note" className="text-primary" />
        随手记录
      </h2>
      <label className="block space-y-1.5 text-sm text-on-surface-variant">
        主题
        <input
          className={inputCls}
          placeholder="给这件事起个名字"
          value={draft.title}
          onChange={(e) => edit('title', e.target.value)}
        />
      </label>
      <label className="block space-y-1.5 text-sm text-on-surface-variant">
        发生日期
        <input
          type="date"
          className={inputCls}
          value={draft.date}
          onChange={(e) => edit('date', e.target.value)}
        />
      </label>
      <label className="block space-y-1.5 text-sm text-on-surface-variant">
        事实内容
        <textarea
          className={inputCls}
          rows={4}
          placeholder="记下发生了什么、和谁有关，稍后预览确认。"
          value={draft.summary}
          onChange={(e) => edit('summary', e.target.value)}
        />
      </label>
      <p className="text-sm text-outline">草稿自动保留，预览确认后记入时间线。</p>
    </MutationPanel>
  )
}
