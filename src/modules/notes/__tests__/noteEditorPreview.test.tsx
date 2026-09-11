// @vitest-environment jsdom
/**
 * 笔记编辑界面「实时预览开关」回归（Issue #158）
 *
 * 背景：编辑态原来是左侧 markdown 源码 + 右侧实时预览的死双栏。需求是把右栏做成开关，
 * 关掉时左栏铺满、专注写作；开关与偏好必须落在**右栏头条**且默认打开（老用户体验不变）。
 *
 * 本用例锁死三条纪律，防止后续有人把开关挪走或改掉默认值：
 *   ① 默认开：不写任何偏好即双栏（LIVE PREVIEW + 渲染内容都在）；
 *   ② 关闭：右栏正文消失、左栏铺满，但**开关本体仍在页面上**，随时能开回来；
 *   ③ 偏好持久化：关闭写入 localStorage，重进编辑页仍为关闭（localStorage 新值优先于默认开）。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, cleanup, act } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import 'fake-indexeddb/auto'
import { db } from '@/db/db'
import { PREVIEW_ON_KEY, readPreviewPref, writePreviewPref } from '../NoteEditorPage'
import NoteEditorPage from '../NoteEditorPage'
import type { Note } from '@/db/types'

/** 最简笔记记录：正文一处加粗，渲染后会出现 <strong> 便于断言预览真的在渲染 */
function note(id: string, markdown = '正文 **加粗** 收尾'): Note {
  return {
    id,
    title: '预览开关用例',
    markdown,
    tags: [],
    mentions: [],
    backlinks: [],
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

beforeEach(async () => {
  await Promise.all(db.tables.map((t) => t.clear()))
  localStorage.clear()
})

afterEach(() => {
  cleanup()
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
  })
})

describe('② 关闭：右栏正文收起，开关常驻可切回', () => {
  it('点开关后正文消失、开关仍在；再点一次恢复渲染', async () => {
    await db.notes.put(note('n-toggle') as never)
    renderEditor('n-toggle')
    await screen.findByText('LIVE PREVIEW')

    act(() => switchEl().click())
    // 收起态是另一套节点（窄轨），断言必须重新取，不能复用收起前的引用
    expect(switchEl().getAttribute('aria-checked')).toBe('false')
    expect(previewBody()).toBeNull()
    // 开关本体必须留下，否则关掉就再也开不回来
    expect(switchEl()).toBeTruthy()

    act(() => switchEl().click())
    expect(switchEl().getAttribute('aria-checked')).toBe('true')
    expect(previewBody()?.querySelector('strong')).toBeTruthy()
  })

  it('同页双向切换互不残留：开→关→开 后 aria-checked 与内容一致', async () => {
    await db.notes.put(note('n-toggle-twice') as never)
    renderEditor('n-toggle-twice')
    await screen.findByText('LIVE PREVIEW')

    act(() => switchEl().click())
    act(() => switchEl().click())
    expect(switchEl().getAttribute('aria-checked')).toBe('true')
    expect(previewBody()).toBeTruthy()
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
    // 重进后直接是关闭态：无右栏正文、开关仍可点开（头条文案收起为窄轨竖排「实时预览」）
    expect(await screen.findByRole('switch', { name: '实时预览' })).toBeTruthy()
    expect(switchEl().getAttribute('aria-checked')).toBe('false')
    expect(previewBody()).toBeNull()
    expect(screen.queryByText('LIVE PREVIEW')).toBeNull()
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
