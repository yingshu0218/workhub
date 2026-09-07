import { useMemo, useState } from 'react'
import { Icon } from '@/design-system/Icon'
import { useNavigate } from 'react-router-dom'
import { noteRepo, newId } from '@/repositories'
import { Button, Card, EmptyState, PageHeader, inputCls } from '@/design-system/ui'
import dayjs from 'dayjs'
import { tagStyle } from './shared'
import { useNoteList, useNoteFolders, createNoteFolder, renameNoteFolder, deleteNoteFolderCascade, moveNoteToFolder } from './hooks'
import type { NoteFolder } from '@/db/types'

/** 相对时间（列表行右侧） */
function fmtTime(ts: number): string {
  const d = dayjs(ts)
  if (d.isSame(dayjs(), 'day')) return d.format('HH:mm')
  if (d.isSame(dayjs().subtract(1, 'day'), 'day')) return '昨日'
  return d.format('MM-DD')
}

type Scope = { kind: 'all' } | { kind: 'folder'; folder: NoteFolder } | { kind: 'root' }

/** 团队笔记列表页（文库体系：文件夹文件树 + 标签云），路由 /notes */
export default function NotesPage() {
  const navigate = useNavigate()
  // 投影查询（审计 P2-6）：只取 id/title/tags/mentions/updatedAt/folderId，markdown 不进列表内存
  const notes = useNoteList()
  const folders = useNoteFolders()
  const [keyword, setKeyword] = useState('')
  const [activeTag, setActiveTag] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [scope, setScope] = useState<Scope>({ kind: 'all' })
  const [newFolderName, setNewFolderName] = useState('')
  const [addingFolder, setAddingFolder] = useState(false)

  /** 标签聚合（含计数），按引用次数降序 */
  const tagCloud = useMemo(() => {
    const counts = new Map<string, number>()
    notes.forEach((n) => n.tags.forEach((t) => counts.set(t, (counts.get(t) ?? 0) + 1)))
    return [...counts.entries()].sort((a, b) => b[1] - a[1])
  }, [notes])

  const folderCounts = useMemo(() => {
    const counts = new Map<string, number>()
    notes.forEach((n) => {
      if (n.folderId) counts.set(n.folderId, (counts.get(n.folderId) ?? 0) + 1)
    })
    return counts
  }, [notes])

  const list = useMemo(() => {
    const kw = keyword.trim().toLowerCase()
    return notes
      .filter((n) => {
        // 文件树范围过滤：全部 / 指定文件夹 / 未归档根层
        if (scope.kind === 'folder' && n.folderId !== scope.folder.id) return false
        if (scope.kind === 'root' && n.folderId) return false
        if (activeTag && !n.tags.includes(activeTag)) return false
        if (!kw) return true
        // 搜索范围：标题 + 标签 + 提及实体名（投影行不含 markdown 正文）
        return [n.title, n.tags.join(' '), n.mentions.map((m) => m.label).join(' ')]
          .join(' ')
          .toLowerCase()
          .includes(kw)
      })
      .sort((a, b) => b.updatedAt - a.updatedAt)
  }, [notes, keyword, activeTag, scope])

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
        folderId: scope.kind === 'folder' ? scope.folder.id : undefined,
        createdAt: Date.now(),
      })
      navigate(`/notes/${id}?edit=1`)
    } finally {
      setCreating(false)
    }
  }

  async function handleAddFolder() {
    const name = newFolderName.trim()
    if (!name) return
    await createNoteFolder(name)
    setNewFolderName('')
    setAddingFolder(false)
  }

  async function handleRenameFolder(f: NoteFolder) {
    const name = window.prompt('重命名文件夹', f.name)?.trim()
    if (!name || name === f.name) return
    await renameNoteFolder(f.id, name)
    if (scope.kind === 'folder' && scope.folder.id === f.id) setScope({ kind: 'folder', folder: { ...f, name } })
  }

  async function handleDeleteFolder(f: NoteFolder) {
    const count = folderCounts.get(f.id) ?? 0
    if (!window.confirm(`确认删除文件夹「${f.name}」？${count > 0 ? `名下 ${count} 篇笔记将移回「未归档」。` : ''}`)) return
    await deleteNoteFolderCascade(f.id)
    if (scope.kind === 'folder' && scope.folder.id === f.id) setScope({ kind: 'all' })
  }

  function scopeLabel(): string {
    if (scope.kind === 'folder') return scope.folder.name
    if (scope.kind === 'root') return '未归档'
    return '全部笔记'
  }

  return (
    <div className="mx-auto max-w-[1200px]">
      <PageHeader
        title="团队笔记"
        subtitle="文件夹体系 · Markdown 双栏编辑 · @提及实体 · 双向链接 · 智能彩色标签"
        actions={
          <Button icon="add" onClick={() => void createNote()} disabled={creating}>
            新建笔记
          </Button>
        }
      />

      <div className="flex gap-4">
        {/* 左栏：文件树体系（文件夹 + 搜索 + 智能彩色标签云） */}
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

          {/* 文件夹文件树 */}
          <div className="mb-2 mt-4 flex items-center justify-between text-[12px] font-medium uppercase tracking-wide text-on-surface-variant">
            <span>文件夹</span>
            <button
              className="rounded p-0.5 text-outline transition-colors hover:bg-surface-container-high hover:text-on-surface"
              title="新建文件夹"
              onClick={() => {
                setAddingFolder(true)
                setNewFolderName('')
              }}
            >
              <Icon name="create_new_folder" size={16} />
            </button>
          </div>
          <div className="flex flex-col gap-0.5">
            <TreeNode
              icon="library_books"
              label="全部笔记"
              count={notes.length}
              active={scope.kind === 'all'}
              onClick={() => setScope({ kind: 'all' })}
            />
            {folders.map((f) => (
              <TreeNode
                key={f.id}
                icon="folder"
                label={f.name}
                count={folderCounts.get(f.id) ?? 0}
                active={scope.kind === 'folder' && scope.folder.id === f.id}
                onClick={() => setScope({ kind: 'folder', folder: f })}
                actions={
                  <>
                    <button
                      className="rounded p-0.5 text-outline transition-colors hover:bg-surface-container-high hover:text-on-surface"
                      title="重命名"
                      onClick={(e) => {
                        e.stopPropagation()
                        void handleRenameFolder(f)
                      }}
                    >
                      <Icon name="edit" size={13} />
                    </button>
                    <button
                      className="rounded p-0.5 text-outline transition-colors hover:bg-error-container hover:text-error"
                      title="删除文件夹"
                      onClick={(e) => {
                        e.stopPropagation()
                        void handleDeleteFolder(f)
                      }}
                    >
                      <Icon name="delete" size={13} />
                    </button>
                  </>
                }
              />
            ))}
            {folders.some((f) => folderCounts.get(f.id)) && (
              <TreeNode
                icon="folder_open"
                label="未归档"
                count={notes.filter((n) => !n.folderId).length}
                active={scope.kind === 'root'}
                onClick={() => setScope({ kind: 'root' })}
              />
            )}
          </div>
          {addingFolder && (
            <div className="mt-1.5 flex items-center gap-1">
              <input
                autoFocus
                className="min-w-0 flex-1 rounded-md border border-outline-variant bg-surface-container-lowest px-2 py-1 text-[12px] outline-none focus:border-primary"
                value={newFolderName}
                onChange={(e) => setNewFolderName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void handleAddFolder()
                  if (e.key === 'Escape') setAddingFolder(false)
                }}
                onBlur={() => void handleAddFolder()}
                placeholder="文件夹名称，回车确认"
              />
            </div>
          )}

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

        {/* 右侧：笔记列表（updatedAt 降序），点击进入只读查看页 */}
        {list.length === 0 ? (
          <Card className="flex-1 p-6">
            <EmptyState
              icon="description"
              title={notes.length === 0 ? '还没有笔记' : '没有符合条件的笔记'}
              description={
                notes.length === 0 ? '点击右上角「新建笔记」开始记录' : '调整关键字、文件夹或标签筛选条件'
              }
            />
          </Card>
        ) : (
          <Card className="flex-1 divide-y divide-outline-variant/30 px-5">
            <div className="flex items-center justify-between py-2 text-[12px] text-outline">
              <span>
                当前范围：<span className="font-medium text-on-surface-variant">{scopeLabel()}</span>
              </span>
              <span>{list.length} 篇</span>
            </div>
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
                {/* 投影行不含 markdown，摘要以关联实体替代（点击进入查看页阅读全文） */}
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
                  {(() => {
                    const f = folders.find((x) => x.id === n.folderId)
                    if (!f) return null
                    return (
                      <span className="flex items-center gap-0.5 rounded-full bg-surface-container-low px-2 py-0.5 text-[11px] text-on-surface-variant">
                        <Icon name="folder" size={12} />
                        {f.name}
                      </span>
                    )
                  })()}
                  {/* 归档/移动文件夹（阻止行点击冒泡） */}
                  <button
                    className="ml-auto hidden items-center gap-0.5 rounded-full px-2 py-0.5 text-[11px] text-outline transition-colors hover:bg-surface-container-high hover:text-on-surface group-hover:flex"
                    title="移动到文件夹"
                    onClick={async (e) => {
                      e.stopPropagation()
                      const options = [
                        ...(n.folderId ? ['（移回未归档）'] : []),
                        ...folders.filter((f) => f.id !== n.folderId).map((f) => f.name),
                      ]
                      if (options.length === 0) {
                        window.alert('暂无文件夹，可先在左栏「新建文件夹」')
                        return
                      }
                      const pick = window.prompt(
                        `移动「${n.title}」到：\n${folders.map((f, i) => `${i + 1}. ${f.name}`).join('\n')}${n.folderId ? '\n0. 移回未归档' : ''}\n\n输入编号：`,
                      )
                      if (pick === null) return
                      const idx = parseInt(pick, 10)
                      const targets = folders.filter((f) => f.id !== n.folderId)
                      if (n.folderId && idx === 0) {
                        await moveNoteToFolder(n.id, undefined)
                        return
                      }
                      const target = targets[idx - 1]
                      if (target) await moveNoteToFolder(n.id, target.id)
                    }}
                  >
                    <Icon name="drive_file_move" size={13} />
                    移动
                  </button>
                </div>
              </div>
            ))}
          </Card>
        )}
      </div>
    </div>
  )
}

/** 文件树节点（文件夹行） */
function TreeNode({
  icon,
  label,
  count,
  active,
  onClick,
  actions,
}: {
  icon: string
  label: string
  count: number
  active: boolean
  onClick: () => void
  actions?: React.ReactNode
}) {
  return (
    <div
      onClick={onClick}
      className={`group flex cursor-pointer items-center gap-1.5 rounded-lg px-2 py-1 text-[13px] transition-colors ${
        active
          ? 'bg-primary-container/15 font-medium text-primary'
          : 'text-on-surface-variant hover:bg-surface-container-low hover:text-on-surface'
      }`}
    >
      <Icon name={icon} size={16} className={active ? 'text-primary' : 'text-outline'} />
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {actions && (
        <span className="hidden items-center gap-0.5 group-hover:flex" onClick={(e) => e.stopPropagation()}>
          {actions}
        </span>
      )}
      <span className="shrink-0 text-[11px] text-outline group-hover:hidden">{count}</span>
      {actions && <span className="hidden shrink-0 text-[11px] text-outline group-hover:hidden">{count}</span>}
    </div>
  )
}
