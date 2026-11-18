// @vitest-environment jsdom
/**
 * 笔记编辑界面「实时预览开关」回归（Issue #158）
 *
 * 背景：编辑态原来是左侧 markdown 源码 + 右侧实时预览的死双栏。需求是把右栏做成开关，
 * 默认打开（老用户体验不变），关掉时右栏整条收起、编辑栏居中专注写作。
 *
 * 二轮（本轮）落位变更：开关从右栏头条挪到**顶部工具条**（眼睛图标左侧），编辑态全程可见，
 * 右栏收起后不再保留窄轨；关闭时编辑栏**居中不展开**，`xl` 详情侧栏一并收起。
 *
 * 本用例锁死四条纪律，防止后续有人把开关挪走、改掉默认值或把「关闭」做回整宽：
 *   ① 默认开：不写任何偏好即双栏（LIVE PREVIEW + 渲染内容都在）；
 *   ② 关闭：右栏正文消失、**不留窄轨**，开关仍在顶部工具条可切回，且编辑栏**居中不展开**；
 *   ③ 偏好持久化：关闭写入 localStorage，重进编辑页仍为关闭（localStorage 新值优先于默认开）；
 *   ④ 开关落位：编辑态开关必须挂在顶部工具条（与「N 字」胶囊同区），不得回到右栏头条 / 窄轨。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, cleanup, act, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import 'fake-indexeddb/auto'
import { db } from '@/db/db'
import * as repositories from '@/repositories'
import * as serverFirst from '@/storage/serverFirst'
import {
  PREVIEW_ON_KEY,
  readAuthoritativeNote,
  readPreviewPref,
  writePreviewPref,
} from '../NoteEditorPage'
import * as personal from '@/domain/personal'
import NoteEditorPage from '../NoteEditorPage'
import type { Note } from '@/db/types'
import { readNoteDraft, writeNoteDraft } from '../noteAutosave'
import { payloadIntent } from '@/storage/commandPlan'

const mockSession = vi.hoisted(() => ({
  value: undefined as { key: string; generation: string } | undefined,
}))
vi.mock('@/storage/clientSession', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/storage/clientSession')>()
  return {
    ...actual,
    clientSession: () => mockSession.value as ReturnType<typeof actual.clientSession>,
  }
})

/** 最简笔记记录：正文一处加粗，渲染后会出现 <strong> 便于断言预览真的在渲染 */
function note(id: string, markdown = '正文 **加粗** 收尾'): Note {
  return {
    id,
    title: '预览开关用例',
    markdown,
    tags: [],
    createdAt: 0,
    updatedAt: 0,
    deleted: 0 as const,
    rev: 0,
  }
}

function renderEditor(id: string) {
  return render(
    <MemoryRouter initialEntries={[`/notes/${id}?edit=1`]}>
      <Routes>
        <Route path="/notes/:id" element={<NoteEditorPage />} />
      </Routes>
    </MemoryRouter>,
  )
}

/** 右栏正文容器（预览渲染处）是否存在 */
function previewBody(): HTMLElement | null {
  return document.querySelector('.note-prose')
}

/** 预览开关本体（role=switch） */
function switchEl(): HTMLElement {
  return screen.getByRole('switch', { name: '实时预览' })
}

/** 编辑栏（markdown 源码栏）：关闭预览后负责「居中不展开」 */
function editorPane(): HTMLElement {
  const el = document.querySelector('[data-testid="note-editor-pane"]') as HTMLElement | null
  if (!el) throw new Error('editor pane missing')
  return el
}

/** 外层容器：卡片装饰（白底/边框/圆角/阴影）的挂载点，关态应移交给编辑栏自身 */
function editorShell(): HTMLElement {
  const el = document.querySelector('[data-testid="note-editor-shell"]') as HTMLElement | null
  if (!el) throw new Error('editor shell missing')
  return el
}

/** 详情侧栏（反向链接 / @提及）：编辑态关预览时应整条收起 */
function detailAside(): HTMLElement {
  const el = document.querySelector('[data-testid="note-detail-aside"]') as HTMLElement | null
  if (!el) throw new Error('detail aside missing')
  return el
}

beforeEach(async () => {
  await Promise.all(db.tables.map((t) => t.clear()))
  localStorage.clear()
  mockSession.value = undefined
})

afterEach(() => {
  cleanup()
  mockSession.value = undefined
  vi.restoreAllMocks()
})

describe('① 默认开：不写偏好即维持双栏', () => {
  it('编辑态出现 LIVE PREVIEW 头条、渲染内容与开关，且开关为选中态', async () => {
    await db.notes.put(note('n-default') as never)
    renderEditor('n-default')

    expect(await screen.findByText('LIVE PREVIEW')).toBeTruthy()
    expect(await screen.findByText('MARKDOWN SOURCE EDITOR')).toBeTruthy()
    // 预览真的在渲染：markdown 已转成 DOM
    expect(previewBody()?.querySelector('strong')).toBeTruthy()
    expect(switchEl().getAttribute('aria-checked')).toBe('true')
    // 开关落在顶部工具条（「N 字」胶囊同区），不是右栏头条里的节点
    expect(editorPane().contains(switchEl())).toBe(false)
    expect(previewBody()?.closest('div.flex')?.contains(switchEl())).toBe(false)
    // 开态编辑栏不居中收窄
    expect(editorPane().className).not.toContain('max-w-[56rem]')
  })
})

describe('② 关闭：右栏正文收起，开关常驻可切回', () => {
  it('点开关后正文消失、开关仍在；再点一次恢复渲染', async () => {
    await db.notes.put(note('n-toggle') as never)
    renderEditor('n-toggle')
    await screen.findByText('LIVE PREVIEW')

    act(() => switchEl().click())
    expect(switchEl().getAttribute('aria-checked')).toBe('false')
    expect(previewBody()).toBeNull()
    // 右栏整条不渲染：不得留下承载开关的窄轨（二轮已取消窄轨形态）
    expect(screen.queryByText('LIVE PREVIEW')).toBeNull()
    expect(document.querySelector('span[style*="vertical-rl"]')).toBeNull()
    // 开关本体必须留下（顶部工具条常驻），否则关掉就再也开不回来
    expect(switchEl()).toBeTruthy()
    // 编辑栏居中不展开：收窄到可读行宽，而不是整宽铺满
    expect(editorPane().className).toContain('mx-auto')
    expect(editorPane().className).toContain('max-w-[56rem]')
    // 详情侧栏一并收起，编辑栏才真正在容器里居中
    expect(detailAside().className).toContain('hidden')
    expect(detailAside().className).not.toContain('xl:flex')

    act(() => switchEl().click())
    expect(switchEl().getAttribute('aria-checked')).toBe('true')
    expect(previewBody()?.querySelector('strong')).toBeTruthy()
    expect(editorPane().className).not.toContain('max-w-[56rem]')
    expect(detailAside().className).toContain('xl:flex')
  })

  it('关态卡片不出现横条断层：装饰从外层容器移交居中编辑栏自身', async () => {
    await db.notes.put(note('n-card') as never)
    renderEditor('n-card')
    await screen.findByText('LIVE PREVIEW')

    // 开态：外层容器承载卡片装饰，编辑栏自身不叠一层装饰
    expect(editorShell().className).toContain('surface-card-xl')
    expect(editorPane().className).not.toContain('surface-card-xl')

    act(() => switchEl().click())
    // 关态：外层容器去装饰（否则横条收窄 56rem、卡片边框铺满整宽 → 右端灰底硬边断层），
    // 卡片视觉落在居中的编辑栏上，头条与卡片边界重合
    expect(editorShell().className).not.toContain('surface-card-xl')
    expect(editorPane().className).toContain('surface-card-xl')
    expect(editorPane().className).toContain('mx-auto')
    expect(editorPane().className).toContain('max-w-[56rem]')

    // 切回开态恢复原装修，不残留
    act(() => switchEl().click())
    expect(editorShell().className).toContain('surface-card-xl')
    expect(editorPane().className).not.toContain('surface-card-xl')
  })

  it('同页双向切换互不残留：开→关→开 后 aria-checked 与内容一致', async () => {
    await db.notes.put(note('n-toggle-twice') as never)
    renderEditor('n-toggle-twice')
    await screen.findByText('LIVE PREVIEW')

    act(() => switchEl().click())
    act(() => switchEl().click())
    expect(switchEl().getAttribute('aria-checked')).toBe('true')
    expect(previewBody()).toBeTruthy()
    // 收放两轮后不残留：无窄轨、无居中态
    expect(document.querySelector('span[style*="vertical-rl"]')).toBeNull()
    expect(editorPane().className).not.toContain('max-w-[56rem]')
  })
})

describe('③ 偏好持久化：localStorage 决定初次渲染', () => {
  it('关闭写入 localStorage，重进编辑页仍是关闭态', async () => {
    await db.notes.put(note('n-persist') as never)
    const view = renderEditor('n-persist')
    await screen.findByText('LIVE PREVIEW')

    act(() => switchEl().click())
    expect(localStorage.getItem(PREVIEW_ON_KEY)).toBe('0')

    view.unmount()
    renderEditor('n-persist')
    // 重进后直接是关闭态：无右栏正文、无窄轨，开关仍在顶部工具条可点开
    expect(await screen.findByRole('switch', { name: '实时预览' })).toBeTruthy()
    expect(switchEl().getAttribute('aria-checked')).toBe('false')
    expect(previewBody()).toBeNull()
    expect(screen.queryByText('LIVE PREVIEW')).toBeNull()
    expect(document.querySelector('span[style*="vertical-rl"]')).toBeNull()
    expect(editorPane().className).toContain('max-w-[56rem]')
  })

  it('查看态不受开关影响：仍是整宽预览且无开关', async () => {
    await db.notes.put(note('n-view') as never)
    render(
      <MemoryRouter initialEntries={['/notes/n-view']}>
        <Routes>
          <Route path="/notes/:id" element={<NoteEditorPage />} />
        </Routes>
      </MemoryRouter>,
    )
    // 先拿到页面（编辑按钮证明是查看态）
    expect(await screen.findByRole('button', { name: /编辑/ })).toBeTruthy()
    expect(previewBody()?.querySelector('strong')).toBeTruthy()
    expect(screen.queryByRole('switch')).toBeNull()
    // 查看态仍由外层容器承载卡片装修，不被关态规则误伤（整宽渲染无断层）
    expect(editorShell().className).toContain('surface-card-xl')
  })
})

describe('④ 偏好读写兜底', () => {
  it('缺省读为 true；写 0 读 false、写 1 读 true', () => {
    expect(readPreviewPref()).toBe(true)
    writePreviewPref(false)
    expect(readPreviewPref()).toBe(false)
    writePreviewPref(true)
    expect(readPreviewPref()).toBe(true)
  })

  it('localStorage 不可用（隐私模式）时读退化为默认开，不抛错', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied')
    })
    expect(readPreviewPref()).toBe(true)
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('denied')
    })
    expect(() => writePreviewPref(false)).not.toThrow()
  })
})

describe('⑤ 刷新后未知请求草稿与编辑器内容一致', () => {
  it('未知请求期间丢弃 B2 后核对只确认 B1，不提交被丢弃草稿', async () => {
    const id = 'n-discard-unknown-later-draft'
    const generation = 'generation-1'
    const sessionKey = 'server-owner-generation-1-schema-6'
    const original = { title: 'B1 title', markdown: 'B1 body', tags: [] }
    const later = { title: 'B2 title', markdown: 'B2 body', tags: [] }
    mockSession.value = { key: sessionKey, generation }
    await db.notes.put({ ...note(id, ''), title: 'Before', rev: 1 } as never)
    writeNoteDraft(id, later, 1, { sessionKey })

    const writes = [
      {
        table: 'notes',
        id,
        kind: 'put' as const,
        value: { ...note(id, original.markdown), ...original, rev: 2 },
      },
    ]
    const command = {
      protocol: 1 as const,
      generation,
      requestId: `ui_${id}_2`,
      intent: payloadIntent(writes),
      reads: [{ table: 'notes', id, rev: 1 }],
      scans: [],
      writes,
    }
    localStorage.setItem(`workhub.pending.${command.requestId}:${sessionKey}`, JSON.stringify(command))

    vi.spyOn(serverFirst, 'recoverPendingCommand').mockImplementation(async () => {
      await db.notes.put({ ...note(id, original.markdown), ...original, rev: 2 } as never)
      localStorage.removeItem(`workhub.pending.${command.requestId}:${sessionKey}`)
      return true
    })
    vi.spyOn(personal, 'queryPersonal').mockResolvedValue({
      cached: false,
      generation,
      items: [
        {
          id,
          title: original.title,
          tags: original.tags,
          revision: 2,
          details: { markdown: { text: original.markdown, nextOffset: null, revision: 2 } },
        },
      ],
    } as never)
    const save = vi.spyOn(repositories, 'saveNoteWithMentionsAndRevision')

    renderEditor(id)
    expect(await screen.findByRole('button', { name: '核对原请求' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '丢弃草稿' }))
    expect(readNoteDraft(id, { sessionKey })).toBeNull()
    expect(document.querySelector('.cm-content')?.textContent).toBe('B1 body')
    fireEvent.click(screen.getByRole('button', { name: '核对原请求' }))

    await waitFor(() => {
      expect(screen.queryByRole('alert')).toBeNull()
      expect(screen.queryByText(/发现一份未确认的本端草稿/)).toBeNull()
    })
    expect(save).not.toHaveBeenCalled()
    expect(document.querySelector('.cm-content')?.textContent).toBe('B1 body')
    expect(readNoteDraft(id, { sessionKey })).toBeNull()
  })

  it('核对无后续输入的原请求后先恢复 B1，再允许只改标题', async () => {
    const id = 'n-unknown-original-hydration'
    const generation = 'generation-1'
    const sessionKey = 'server-owner-generation-1-schema-6'
    const original = { title: 'B1 title', markdown: 'B1 body', tags: [] }
    mockSession.value = { key: sessionKey, generation }
    await db.notes.put({ ...note(id, ''), title: 'Before', rev: 1 } as never)
    writeNoteDraft(id, original, 1, { sessionKey })

    const writes = [
      {
        table: 'notes',
        id,
        kind: 'put' as const,
        value: { ...note(id, original.markdown), ...original, rev: 2 },
      },
    ]
    const command = {
      protocol: 1 as const,
      generation,
      requestId: `ui_${id}_2`,
      intent: payloadIntent(writes),
      reads: [{ table: 'notes', id, rev: 1 }],
      scans: [],
      writes,
    }
    localStorage.setItem(`workhub.pending.${command.requestId}:${sessionKey}`, JSON.stringify(command))

    vi.spyOn(serverFirst, 'recoverPendingCommand').mockImplementation(async (_table, noteId) => {
      await db.notes.put({ ...note(id, original.markdown), ...original, rev: 2 } as never)
      localStorage.removeItem(`workhub.pending.${command.requestId}:${sessionKey}`)
      expect(noteId).toBe(id)
      return true
    })
    vi.spyOn(personal, 'queryPersonal').mockResolvedValue({
      cached: false,
      generation,
      items: [
        {
          id,
          title: original.title,
          tags: original.tags,
          revision: 2,
          details: { markdown: { text: original.markdown, nextOffset: null, revision: 2 } },
        },
      ],
    } as never)
    const save = vi.spyOn(repositories, 'saveNoteWithMentionsAndRevision').mockImplementation(
      async (next) => ({ ...note(id, next.markdown), ...next, rev: 3 }),
    )

    renderEditor(id)
    expect(await screen.findByRole('button', { name: '核对原请求' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '核对原请求' }))

    await waitFor(() => {
      expect(document.querySelector('.cm-content')?.textContent).toBe('B1 body')
      expect(screen.getByPlaceholderText('笔记标题…')).toHaveProperty('value', 'B1 title')
      expect(screen.queryByRole('alert')).toBeNull()
    })

    fireEvent.change(screen.getByPlaceholderText('笔记标题…'), { target: { value: 'B1 renamed' } })
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1), { timeout: 3000 })
    expect(save.mock.calls[0]?.[0]).toMatchObject({
      rev: 2,
      title: 'B1 renamed',
      markdown: 'B1 body',
    })
  })

  it('在核对原请求前把后续草稿显示在编辑器中', async () => {
    const id = 'n-unknown-hydration'
    const generation = 'generation-1'
    const sessionKey = 'server-owner-generation-1-schema-6'
    mockSession.value = { key: sessionKey, generation }
    await db.notes.put(
      note(id, 'B1 body') as Note & { rev: number },
    )
    await db.notes.update(id, { title: 'B1 title', rev: 2 })
    const later = writeNoteDraft(
      id,
      { title: 'B2 title', markdown: 'B2 body', tags: [] },
      1,
      { sessionKey },
    )
    const writes = [
      {
        table: 'notes',
        id,
        kind: 'put' as const,
        value: { ...note(id, 'B1 body'), title: 'B1 title', rev: 2 },
      },
    ]
    const command = {
      protocol: 1 as const,
      generation,
      requestId: `ui_${id}_2`,
      intent: payloadIntent(writes),
      reads: [{ table: 'notes', id, rev: 1 }],
      scans: [],
      writes,
    }
    localStorage.setItem(`workhub.pending.${command.requestId}:${sessionKey}`, JSON.stringify(command))

    renderEditor(id)

    expect(await screen.findByText('MARKDOWN SOURCE EDITOR')).toBeTruthy()
    await waitFor(() => {
      expect(document.querySelector('.cm-content')?.textContent).toBe('B2 body')
      expect(screen.getByPlaceholderText('笔记标题…')).toHaveProperty('value', 'B2 title')
    })
    expect(screen.getByRole('button', { name: '核对原请求' })).toBeTruthy()
    expect(readNoteDraft(id, { sessionKey })?.draftId).toBe(later?.draftId)
  })
})

describe('④ 开关落位：编辑态必须在顶部工具条，不得回到右栏 / 窄轨', () => {
  it('开关与「N 字」胶囊同处顶部工具条，且不在编辑栏与预览栏内', async () => {
    await db.notes.put(note('n-placement') as never)
    renderEditor('n-placement')
    await screen.findByText('LIVE PREVIEW')

    const badge = screen.getByText(/字$/).parentElement as HTMLElement
    expect(badge.contains(switchEl()) || badge.parentElement?.contains(switchEl())).toBe(true)
    // 开关不属于编辑栏（源码栏）也不属于预览栏
    expect(editorPane().contains(switchEl())).toBe(false)
    expect(previewBody()?.closest('div.flex')?.contains(switchEl())).toBe(false)
  })

  it('查看态无开关（查看态本就只有整宽预览）', async () => {
    await db.notes.put(note('n-view-noswitch') as never)
    render(
      <MemoryRouter initialEntries={['/notes/n-view-noswitch']}>
        <Routes>
          <Route path="/notes/:id" element={<NoteEditorPage />} />
        </Routes>
      </MemoryRouter>,
    )
    expect(await screen.findByRole('button', { name: /编辑/ })).toBeTruthy()
    expect(screen.queryByRole('switch')).toBeNull()
  })
})

describe('authoritative conflict note read', () => {
  it('pins generation and revision when reading the next body chunk', async () => {
    const requests: Array<Record<string, unknown>> = []
    vi.spyOn(personal, 'queryPersonal').mockImplementation(async (_name, input) => {
      const request = input as Record<string, unknown>
      requests.push(request)
      const offset = Number(request.bodyOffset)
      return {
        cached: false,
        generation: 'generation-17',
        items: [
          {
            id: 'n-long',
            title: '服务器标题',
            tags: ['server'],
            revision: 17,
            details: {
              markdown: {
                text: offset === 0 ? 'x'.repeat(4000) : '正文尾段',
                nextOffset: offset === 0 ? 4000 : null,
                revision: 17,
              },
            },
          },
        ],
      }
    })

    const result = await readAuthoritativeNote('n-long')

    expect(requests).toHaveLength(2)
    expect(requests[0]).toMatchObject({ table: 'notes', id: 'n-long', bodyOffset: 0 })
    expect(requests[1]).toMatchObject({
      table: 'notes',
      id: 'n-long',
      bodyOffset: 4000,
      generation: 'generation-17',
      revision: 17,
    })
    expect(result).toMatchObject({
      title: '服务器标题',
      tags: ['server'],
      revision: 17,
      markdown: `${'x'.repeat(4000)}正文尾段`,
      truncated: false,
    })
  })

  it('restores an older draft in edit mode using its base revision and keeps it on conflict', async () => {
    const serverNote = {
      ...note('n-recovered-conflict', '远端正文'),
      title: '远端标题',
      tags: ['server'],
      rev: 5,
    }
    await db.notes.put(serverNote as never)
    writeNoteDraft(
      serverNote.id,
      { title: '本端旧标题', markdown: '本端旧正文', tags: ['local'] },
      4,
    )
    vi.spyOn(personal, 'queryPersonal').mockResolvedValue({
      cached: false,
      generation: 'generation-1',
      items: [
        {
          id: serverNote.id,
          title: '远端标题',
          tags: ['server'],
          revision: 5,
          details: { markdown: { text: '远端正文', nextOffset: null, revision: 5 } },
        },
      ],
    } as never)
    const save = vi
      .spyOn(repositories, 'saveNoteWithMentionsAndRevision')
      .mockRejectedValue(new Error('VERSION_CONFLICT: notes/n-recovered-conflict'))
    renderEditor(serverNote.id)

    fireEvent.click(await screen.findByRole('button', { name: '恢复草稿并编辑' }))

    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toContain('服务器已有更新版本')
      expect(save).toHaveBeenCalledTimes(1)
    })
    expect(save.mock.calls[0]?.[0]).toMatchObject({
      rev: 4,
      title: '本端旧标题',
      markdown: '本端旧正文',
      tags: ['local'],
    })
    expect(document.querySelector('.cm-content')?.textContent).toBe('本端旧正文')
    expect(screen.getByText(/服务器当前版本 · rev 5/)).toBeTruthy()
    expect(screen.getByText('远端正文')).toBeTruthy()
    expect(readNoteDraft(serverNote.id)).toMatchObject({
      title: '本端旧标题',
      markdown: '本端旧正文',
      baseRev: 4,
    })
  })
})

describe('delete failure recovery', () => {
  it('shows the delete error and preserves later edits as a local draft', async () => {
    await db.notes.put(note('n-delete-failure') as never)
    vi.spyOn(repositories, 'deleteNoteCascade').mockRejectedValueOnce(
      new Error('STORAGE_UNAVAILABLE'),
    )
    vi.spyOn(repositories, 'saveNoteWithMentionsAndRevision').mockImplementation(
      async (next) => ({ ...note('n-delete-failure'), ...next, rev: 1 }),
    )
    renderEditor('n-delete-failure')

    fireEvent.click(await screen.findByRole('button', { name: '删除' }))
    const deleteButtons = screen.getAllByRole('button', { name: '删除' })
    fireEvent.click(deleteButtons[deleteButtons.length - 1])

    expect((await screen.findByRole('alert')).textContent).toContain(
      '笔记仍保留：STORAGE_UNAVAILABLE',
    )
    fireEvent.change(screen.getByDisplayValue('预览开关用例'), {
      target: { value: '删除失败后仍可编辑' },
    })
    expect(readNoteDraft('n-delete-failure')?.title).toBe('删除失败后仍可编辑')
  })
})
