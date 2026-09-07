import { useMemo, useState } from 'react'
import { Icon } from '@/design-system/Icon'
import { useNavigate } from 'react-router-dom'
import { noteRepo, newId } from '@/repositories'
import { Button, Card, EmptyState, PageHeader, inputCls } from '@/design-system/ui'
import dayjs from 'dayjs'
import { tagStyle } from './shared'
import { useNoteList } from './hooks'

/** 相对时间（列表行右侧） */
function fmtTime(ts: number): string {
  const d = dayjs(ts)
  if (d.isSame(dayjs(), 'day')) return d.format('HH:mm')
  if (d.isSame(dayjs().subtract(1, 'day'), 'day')) return '昨日'
  return d.format('MM-DD')
}

/** 团队笔记列表页（对齐原型 12-team-notes 左栏文件体系），路由 /notes */
export default function NotesPage() {
  const navigate = useNavigate()
  // 投影查询（审计 P2-6）：只取 id/title/tags/mentions/updatedAt，markdown 不进列表内存
  const notes = useNoteList()
  const [keyword, setKeyword] = useState('')
  const [activeTag, setActiveTag] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)

  /** 标签聚合（含计数），按引用次数降序 */
  const tagCloud = useMemo(() => {
    const counts = new Map<string, number>()
    notes.forEach((n) => n.tags.forEach((t) => counts.set(t, (counts.get(t) ?? 0) + 1)))
    return [...counts.entries()].sort((a, b) => b[1] - a[1])
  }, [notes])

  const list = useMemo(() => {
    const kw = keyword.trim().toLowerCase()
    return notes
      .filter((n) => {
        if (activeTag && !n.tags.includes(activeTag)) return false
        if (!kw) return true
        // 搜索范围：标题 + 标签 + 提及实体名（投影行不含 markdown 正文）
        return [n.title, n.tags.join(' '), n.mentions.map((m) => m.label).join(' ')]
          .join(' ')
          .toLowerCase()
          .includes(kw)
      })
      .sort((a, b) => b.updatedAt - a.updatedAt)
  }, [notes, keyword, activeTag])

  /** 新建空笔记并直接进入编辑页 */
  async function createNote() {
    if (creating) return
    setCreating(true)
    try {
      const id = newId('note')
      await noteRepo.put({
        id,
        title: '未命名笔记',
        markdown: '',
        tags: [],
        backlinks: [],
        mentions: [],
        createdAt: Date.now(),
      })
      navigate(`/notes/${id}`)
    } finally {
      setCreating(false)
    }
  }

  return (
    <div className="mx-auto max-w-[1200px]">
      <PageHeader
        title="团队笔记"
        subtitle="Markdown 双栏编辑 · @提及实体 · 双向链接 · 智能彩色标签"
        actions={
          <Button icon="add" onClick={() => void createNote()} disabled={creating}>
            新建笔记
          </Button>
        }
      />

      <div className="flex gap-4">
        {/* 左栏：文件体系（搜索 + 智能彩色标签云） */}
        <Card className="w-64 shrink-0 self-start p-4">
          <div className="mb-3 text-[12px] font-medium uppercase tracking-wide text-on-surface-variant">
            文库体系（{notes.length}）
          </div>
          <input
            className={inputCls}
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            placeholder="搜索笔记、标签、实体…"
          />
          <div className="mb-2 mt-4 text-[12px] font-medium uppercase tracking-wide text-on-surface-variant">
            智能彩色标签
          </div>
          {tagCloud.length === 0 ? (
            <div className="text-[12px] text-outline">暂无标签</div>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {tagCloud.map(([tag, count]) => {
                const active = activeTag === tag
                return (
                  <button
                    key={tag}
                    onClick={() => setActiveTag(active ? null : tag)}
                    className="rounded-full px-2.5 py-0.5 text-[12px] font-medium transition-opacity hover:opacity-80"
                    style={{
                      ...tagStyle(tag),
                      outline: active ? '2px solid currentColor' : 'none',
                      outlineOffset: 1,
                    }}
                    title={`${count} 篇笔记`}
                  >
                    #{tag} · {count}
                  </button>
                )
              })}
            </div>
          )}
        </Card>

        {/* 右侧：笔记列表（updatedAt 降序） */}
        {list.length === 0 ? (
          <Card className="flex-1 p-6">
            <EmptyState
              icon="description"
              title={notes.length === 0 ? '还没有笔记' : '没有符合条件的笔记'}
              description={
                notes.length === 0 ? '点击右上角「新建笔记」开始记录' : '调整关键字或标签筛选条件'
              }
            />
          </Card>
        ) : (
          <Card className="flex-1 divide-y divide-outline-variant/30 px-5">
            {list.map((n) => (
              <div
                key={n.id}
                onClick={() => navigate(`/notes/${n.id}`)}
                className="group cursor-pointer py-3.5 transition-colors hover:bg-surface-container-low/40"
              >
                <div className="flex items-center gap-2">
                  <Icon name="description" className="text-[18px] text-primary" />
                  <span className="truncate text-[14px] font-medium group-hover:text-primary">{n.title}</span>
                  <span className="ml-auto shrink-0 text-[11px] text-outline">{fmtTime(n.updatedAt)}</span>
                </div>
                {/* 投影行不含 markdown，摘要以关联实体替代（正文点击进入编辑页查看） */}
                {n.mentions.length > 0 && (
                  <p className="mt-0.5 line-clamp-1 pl-[26px] text-[12.5px] leading-relaxed text-on-surface-variant">
                    关联：{n.mentions.map((m) => `@${m.label}`).join('、')}
                  </p>
                )}
                <div className="mt-1.5 flex flex-wrap items-center gap-1.5 pl-[26px]">
                  {n.tags.map((t) => (
                    <span
                      key={t}
                      className="rounded-full px-2 py-0.5 text-[11px] font-medium"
                      style={tagStyle(t)}
                    >
                      #{t}
                    </span>
                  ))}
                  {n.mentions.length > 0 && (
                    <span
                      className="flex items-center gap-0.5 text-[11px] text-outline"
                      title={n.mentions.map((m) => m.label).join('、')}
                    >
                      <Icon name="hub" size={13} />
                      {n.mentions.length} 个关联
                    </span>
                  )}
                </div>
              </div>
            ))}
          </Card>
        )}
      </div>
    </div>
  )
}
