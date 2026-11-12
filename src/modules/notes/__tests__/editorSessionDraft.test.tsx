// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import 'fake-indexeddb/auto'
import { db } from '@/db/db'
import { noteRepo } from '@/repositories'
import { activateClientSession, scopedClientKey, suspendClientSession } from '@/storage/clientSession'
import { resetStorageAdapter } from '@/storage'
import { setStorageAdapter } from '@/storage'
import { createServerFirstAdapter } from '@/storage/serverFirst'
import NoteEditorPage from '../NoteEditorPage'

function editor(id: string) {
  return render(
    <MemoryRouter initialEntries={[`/notes/${id}?edit=1`]}>
      <Routes><Route path="/notes/:id" element={<NoteEditorPage />} /></Routes>
    </MemoryRouter>,
  )
}

function seed(id: string) {
  return { id, title: 'Original', markdown: 'Original body', tags: [], createdAt: 1, updatedAt: 1, deleted: 0, rev: 1 }
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  resetStorageAdapter()
  suspendClientSession()
  localStorage.clear()
})

it('keeps the original scoped draft when an old editor timer flushes after a switch', async () => {
  activateClientSession('editor-owner-a', 'editor-generation-a', 6)
  setStorageAdapter(createServerFirstAdapter({ isSynced: () => false }))
  await db.notes.put(seed('editor-stale') as never)
  const key = scopedClientKey('workhub.draft.note-editor:editor-stale')
  const view = editor('editor-stale')
  fireEvent.change(await screen.findByPlaceholderText('笔记标题…'), { target: { value: 'A PRIVATE TITLE' } })
  expect(JSON.parse(localStorage.getItem(key) || '{}').title).toBe('A PRIVATE TITLE')
  activateClientSession('editor-owner-b', 'editor-generation-b', 6)
  view.unmount()
  expect(JSON.parse(localStorage.getItem(key) || '{}').title).toBe('A PRIVATE TITLE')
  expect(await db.notes.get('editor-stale')).toBeUndefined()
})

it('an older flush cannot remove a newer edit draft, and a normal final save clears it', async () => {
  activateClientSession('editor-concurrent', 'editor-generation', 6)
  setStorageAdapter(createServerFirstAdapter({ isSynced: () => false }))
  await db.notes.put(seed('editor-concurrent-note') as never)
  const key = scopedClientKey('workhub.draft.note-editor:editor-concurrent-note')
  editor('editor-concurrent-note')
  const input = await screen.findByPlaceholderText('笔记标题…')
  const originalGet = noteRepo.get.bind(noteRepo)
  const releases: Array<() => void> = []
  vi.spyOn(noteRepo, 'get').mockImplementation((id) => new Promise((resolve, reject) => {
    releases.push(() => { originalGet(id).then(resolve, reject) })
  }))
  fireEvent.change(input, { target: { value: 'First edit' } })
  await vi.waitFor(() => expect(releases).toHaveLength(1), { timeout: 3000 })
  fireEvent.change(input, { target: { value: 'Second edit' } })
  expect(JSON.parse(localStorage.getItem(key) || '{}').title).toBe('Second edit')
  await vi.waitFor(() => expect(releases).toHaveLength(2), { timeout: 3000 })
  releases[0]()
  await vi.waitFor(async () => expect((await db.notes.get('editor-concurrent-note'))?.title).toBe('First edit'))
  expect(JSON.parse(localStorage.getItem(key) || '{}').title).toBe('Second edit')
  releases[1]()
  await vi.waitFor(async () => expect((await db.notes.get('editor-concurrent-note'))?.title).toBe('Second edit'))
  await vi.waitFor(() => expect(localStorage.getItem(key)).toBeNull())
})
