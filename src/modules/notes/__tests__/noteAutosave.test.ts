// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Note } from '@/db/types'
import {
  NoteAutosaveController,
  noteDraftKey,
  readNoteDraft,
  writeNoteDraft,
  type NoteAutosaveState,
  type NoteEditSnapshot,
} from '../noteAutosave'

const mockSession = vi.hoisted(() => ({ key: undefined as string | undefined }))
vi.mock('@/storage/clientSession', () => ({
  clientSession: () => (mockSession.key ? { key: mockSession.key } : undefined),
}))

function note(overrides: Partial<Note> = {}): Note {
  return {
    id: 'note-race',
    title: '旧标题',
    markdown: '旧正文',
    tags: [],
    createdAt: 1,
    updatedAt: 1,
    deleted: 0,
    rev: 1,
    ...overrides,
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((yes, no) => {
    resolve = yes
    reject = no
  })
  return { promise, resolve, reject }
}

function snapshot(overrides: Partial<NoteEditSnapshot> = {}): NoteEditSnapshot {
  return { title: '旧标题', markdown: '旧正文', tags: [], ...overrides }
}

beforeEach(() => {
  vi.useFakeTimers()
  localStorage.clear()
  mockSession.key = undefined
})

afterEach(() => {
  vi.useRealTimers()
  localStorage.clear()
  mockSession.key = undefined
  vi.restoreAllMocks()
})

describe('note autosave serial queue', () => {
  it('does not let a disposed controller receipt clear a newer same-note draft', async () => {
    const first = deferred<Note>()
    const c1 = new NoteAutosaveController('note-race', note(), {
      save: vi.fn(() => first.promise),
      reload: async () => note(),
      readConflict: async () => ({}),
      recoverOriginal: async () => false,
      hasPendingRequest: () => false,
      onStatus() {},
      onConflict() {},
    })
    c1.edit(snapshot({ markdown: 'c1 pending write' }))
    const c1Write = c1.flush()
    c1.dispose()

    const c2Save = vi.fn(async () => {
      throw new TypeError('c2 response unknown')
    })
    const c2 = new NoteAutosaveController('note-race', note(), {
      save: c2Save,
      reload: async () => note(),
      readConflict: async () => ({}),
      recoverOriginal: async () => false,
      hasPendingRequest: () => false,
      onStatus() {},
      onConflict() {},
    })
    c2.edit(snapshot({ markdown: 'c2 newer draft' }))
    const c2Draft = readNoteDraft('note-race')
    expect(c2Draft?.markdown).toBe('c2 newer draft')

    first.resolve(note({ markdown: 'c1 pending write', rev: 2 }))
    await expect(c1Write).resolves.toBe(true)
    expect(readNoteDraft('note-race')?.draftId).toBe(c2Draft?.draftId)

    await expect(c2.flush()).resolves.toBe(false)
    expect(c2Save).toHaveBeenCalledTimes(1)
    expect(readNoteDraft('note-race')).toMatchObject({
      markdown: 'c2 newer draft',
      baseRev: 1,
      draftId: c2Draft?.draftId,
    })
    c2.dispose()
  })

  it('keeps the newer controller draft when a disposed older request fails late', async () => {
    const first = deferred<Note>()
    const c1 = new NoteAutosaveController('note-race', note(), {
      save: vi.fn(() => first.promise),
      reload: async () => note(),
      readConflict: async () => ({}),
      recoverOriginal: async () => false,
      hasPendingRequest: () => false,
      onStatus() {},
      onConflict() {},
    })
    c1.edit(snapshot({ markdown: 'c1 pending write' }))
    const c1Write = c1.flush()
    c1.dispose()

    const c2 = new NoteAutosaveController('note-race', note(), {
      save: async () => note(),
      reload: async () => note(),
      readConflict: async () => ({}),
      recoverOriginal: async () => false,
      hasPendingRequest: () => false,
      onStatus() {},
      onConflict() {},
    })
    c2.edit(snapshot({ markdown: 'c2 newer draft' }))
    const c2Draft = readNoteDraft('note-race')
    first.reject(new Error('c1 failed late'))
    await expect(c1Write).resolves.toBe(false)

    expect(readNoteDraft('note-race')?.draftId).toBe(c2Draft?.draftId)
    expect(readNoteDraft('note-race')?.markdown).toBe('c2 newer draft')
    c2.dispose()
  })

  it('merges a delayed older receipt before saving the newest title and body', async () => {
    const first = deferred<Note>()
    const second = deferred<Note>()
    let current = note()
    const sent: Array<{ baseRev: number; title: string; markdown: string }> = []
    const states: NoteAutosaveState[] = []
    const controller = new NoteAutosaveController('note-race', current, {
      async save(value, expectedRev) {
        sent.push({ baseRev: expectedRev, title: value.title, markdown: value.markdown })
        if (sent.length === 1) current = await first.promise
        else if (sent.length === 2) current = await second.promise
        return current
      },
      async reload() {
        return current
      },
      async readConflict() {
        return {}
      },
      async recoverOriginal() {
        return false
      },
      hasPendingRequest: () => false,
      onStatus(state) {
        states.push(state)
      },
      onConflict() {},
    })

    controller.edit(snapshot({ title: 'T1' }))
    const completion = controller.flush()
    expect(sent).toEqual([{ baseRev: 1, title: 'T1', markdown: '旧正文' }])

    controller.edit(snapshot({ title: 'T1', markdown: 'B1' }))
    controller.edit(snapshot({ title: 'T1', markdown: 'B2' }))
    await vi.advanceTimersByTimeAsync(800)
    expect(sent).toHaveLength(1)
    expect(readNoteDraft('note-race')?.markdown).toBe('B2')

    first.resolve(note({ title: 'T1', rev: 2 }))
    await Promise.resolve()
    await Promise.resolve()
    expect(sent).toEqual([
      { baseRev: 1, title: 'T1', markdown: '旧正文' },
      { baseRev: 2, title: 'T1', markdown: 'B2' },
    ])
    expect(states.at(-1)).not.toBe('saved')

    second.resolve(note({ title: 'T1', markdown: 'B2', rev: 3 }))
    await expect(completion).resolves.toBe(true)
    expect(current).toMatchObject({ title: 'T1', markdown: 'B2', rev: 3 })
    expect(states.at(-1)).toBe('saved')
    expect(localStorage.getItem(noteDraftKey('note-race'))).toBeNull()
  })

  it('keeps a later title edit when the delayed first snapshot changed only the body', async () => {
    const first = deferred<Note>()
    const second = deferred<Note>()
    let current = note()
    const sent: Array<{ baseRev: number; title: string; markdown: string }> = []
    const controller = new NoteAutosaveController('note-race', current, {
      async save(value, expectedRev) {
        sent.push({ baseRev: expectedRev, title: value.title, markdown: value.markdown })
        current = await (sent.length === 1 ? first.promise : second.promise)
        return current
      },
      async reload() {
        return current
      },
      async readConflict() {
        return {}
      },
      async recoverOriginal() {
        return false
      },
      hasPendingRequest: () => false,
      onStatus() {},
      onConflict() {},
    })

    controller.edit(snapshot({ markdown: 'B1' }))
    const completion = controller.flush()
    controller.edit(snapshot({ title: 'T1', markdown: 'B1' }))
    expect(sent).toEqual([{ baseRev: 1, title: '旧标题', markdown: 'B1' }])

    first.resolve(note({ markdown: 'B1', rev: 2 }))
    await Promise.resolve()
    await Promise.resolve()
    expect(sent).toEqual([
      { baseRev: 1, title: '旧标题', markdown: 'B1' },
      { baseRev: 2, title: 'T1', markdown: 'B1' },
    ])

    second.resolve(note({ title: 'T1', markdown: 'B1', rev: 3 }))
    await expect(completion).resolves.toBe(true)
    expect(current).toMatchObject({ title: 'T1', markdown: 'B1', rev: 3 })
    controller.dispose()
  })

  it('keeps a definite failure as a draft until the user retries', async () => {
    let current = note()
    const save = vi
      .fn<(...args: Parameters<import('../noteAutosave').NoteAutosaveHooks['save']>) => Promise<Note>>()
      .mockRejectedValueOnce(new Error('VALIDATION_FAILED: rejected'))
      .mockImplementation(async (value) => {
        current = { ...current, ...value, rev: current.rev + 1 }
        return current
      })
    const states: NoteAutosaveState[] = []
    const controller = new NoteAutosaveController('note-race', current, {
      save,
      reload: async () => current,
      readConflict: async () => ({}),
      recoverOriginal: async () => false,
      hasPendingRequest: () => false,
      onStatus(state) {
        states.push(state)
      },
      onConflict() {},
    })

    controller.edit(snapshot({ markdown: '要保留的正文' }))
    await expect(controller.flush()).resolves.toBe(false)
    expect(states.at(-1)).toBe('failed')
    expect(readNoteDraft('note-race')?.markdown).toBe('要保留的正文')
    controller.edit(snapshot({ markdown: '用户继续编辑' }))
    await vi.advanceTimersByTimeAsync(800)
    expect(save).toHaveBeenCalledTimes(1)

    await expect(controller.retryFailed()).resolves.toBe(true)
    expect(save).toHaveBeenCalledTimes(2)
    expect(current.markdown).toBe('用户继续编辑')
    expect(localStorage.getItem(noteDraftKey('note-race'))).toBeNull()
  })

  it('checks an unknown result with the original request before saving newer edits', async () => {
    let current = note()
    const recoverCalls: boolean[] = []
    let callCount = 0
    const controller = new NoteAutosaveController('note-race', current, {
      async save(value) {
        callCount += 1
        if (callCount === 1) throw new TypeError('network response lost')
        current = { ...current, ...value, rev: current.rev + 1 }
        return current
      },
      async reload() {
        return current
      },
      async readConflict() {
        return {
          title: current.title,
          markdown: current.markdown,
          tags: current.tags,
          revision: current.rev,
          generation: 'generation-1',
        }
      },
      async recoverOriginal(retryOriginal, pending) {
        recoverCalls.push(retryOriginal)
        expect(pending).toMatchObject({ baseRev: 1, snapshot: { title: 'T1', markdown: '旧正文' } })
        if (!retryOriginal) return false
        current = note({ title: 'T1', rev: 2 })
        return { requestId: 'original-note-request', generation: 'generation-1', revision: 2 }
      },
      hasPendingRequest: () => true,
      onStatus() {},
      onConflict() {},
    })

    controller.edit(snapshot({ title: 'T1' }))
    await expect(controller.flush()).resolves.toBe(false)
    controller.edit(snapshot({ title: 'T1', markdown: 'B2' }))
    await expect(controller.checkUnknown(false)).resolves.toBe(false)
    expect(recoverCalls).toEqual([false])
    await expect(controller.checkUnknown(true)).resolves.toBe(true)
    expect(recoverCalls).toEqual([false, true])
    expect(callCount).toBe(2)
    expect(current).toMatchObject({ title: 'T1', markdown: 'B2', rev: 3 })
  })

  it('keeps the exact submitted draft when another client advances after an unknown write', async () => {
    let local = note()
    const remote = { title: '远端正文版本', tags: ['remote'], revision: 3, generation: 'generation-1', markdown: '远端正文' }
    const states: NoteAutosaveState[] = []
    const onConflict = vi.fn()
    const save = vi.fn(async (value: NoteEditSnapshot) => {
      local = note({ ...value, rev: 2 })
      throw new TypeError('response lost after server commit')
    })
    const controller = new NoteAutosaveController('note-race', local, {
      save,
      reload: async () => local,
      readConflict: async () => remote,
      recoverOriginal: async () => ({ requestId: 'original-request', generation: 'generation-1', revision: 2 }),
      hasPendingRequest: () => false,
      onStatus(state) { states.push(state) },
      onConflict,
    })

    controller.edit(snapshot({ title: '本端已提交标题' }))
    await expect(controller.flush()).resolves.toBe(false)
    local = note({ title: '远端正文版本', markdown: '远端正文', tags: ['remote'], rev: 3 })
    await expect(controller.checkUnknown(false)).resolves.toBe(false)

    expect(states.at(-1)).toBe('conflict')
    expect(onConflict).toHaveBeenCalledWith(remote)
    expect(save).toHaveBeenCalledTimes(1)
    expect(readNoteDraft('note-race')).toMatchObject({
      title: '本端已提交标题',
      markdown: '旧正文',
      baseRev: 1,
    })
  })

  it('keeps later local edits as a draft when unknown recovery finds a newer remote revision', async () => {
    let local = note()
    const remote = { title: '远端标题', tags: [], revision: 3, generation: 'generation-1', markdown: '远端正文' }
    const save = vi.fn(async (value: NoteEditSnapshot) => {
      local = note({ ...value, rev: 2 })
      throw new TypeError('response lost after server commit')
    })
    const controller = new NoteAutosaveController('note-race', local, {
      save,
      reload: async () => local,
      readConflict: async () => remote,
      recoverOriginal: async () => ({ requestId: 'original-request', generation: 'generation-1', revision: 2 }),
      hasPendingRequest: () => false,
      onStatus() {},
      onConflict() {},
    })

    controller.edit(snapshot({ title: '本端原请求', markdown: '本端原正文' }))
    await expect(controller.flush()).resolves.toBe(false)
    controller.edit(snapshot({ title: '本端后续标题', markdown: '本端后续正文' }))
    local = note({ title: '远端标题', markdown: '远端正文', rev: 3 })
    await expect(controller.checkUnknown(false)).resolves.toBe(false)

    expect(save).toHaveBeenCalledTimes(1)
    expect(readNoteDraft('note-race')).toMatchObject({
      title: '本端后续标题',
      markdown: '本端后续正文',
      baseRev: 1,
    })
  })

  it('rehydrates the original unknown request after refresh without rebinding it to later edits', async () => {
    const original = snapshot({ title: 'p1 original title', markdown: 'p1 original body' })
    const later = snapshot({ title: 'p1 later title', markdown: 'p1 later body' })
    const draft = writeNoteDraft('note-race', later, 4)
    const states: NoteAutosaveState[] = []
    const onConflict = vi.fn()
    const recoverOriginal = vi.fn(async (_retry: boolean, pending: { snapshot: NoteEditSnapshot; baseRev: number }) => {
      expect(pending).toEqual({ snapshot: original, baseRev: 4 })
      return { requestId: 'original-request', generation: 'generation-1', revision: 5 }
    })
    const remote = {
      title: 'p2 newer title',
      markdown: 'p2 newer body',
      tags: ['remote'],
      revision: 6,
      generation: 'generation-1',
    }
    const controller = new NoteAutosaveController(
      'note-race',
      note({ title: remote.title, markdown: remote.markdown, tags: remote.tags, rev: 6 }),
      {
        save: vi.fn(async () => note()),
        reload: async () => note({ title: remote.title, markdown: remote.markdown, tags: remote.tags, rev: 6 }),
        readConflict: async () => remote,
        recoverOriginal,
        hasPendingRequest: () => true,
        onStatus(state) { states.push(state) },
        onConflict,
      },
    )

    expect(controller.restoreUnknownRequest(original, 4, draft)).toBe(true)
    expect(states.at(-1)).toBe('unknown')
    await expect(controller.checkUnknown(false)).resolves.toBe(false)

    expect(recoverOriginal).toHaveBeenCalledTimes(1)
    expect(states.at(-1)).toBe('conflict')
    expect(onConflict).toHaveBeenCalledWith(remote)
    expect(readNoteDraft('note-race')).toMatchObject({
      title: 'p1 later title',
      markdown: 'p1 later body',
      baseRev: 4,
    })
  })

  it('saves a rehydrated later draft at the revision confirmed for the original request', async () => {
    const original = snapshot({ title: 'B1 title', markdown: 'B1 body' })
    const later = snapshot({ title: 'B2 title', markdown: 'B2 body' })
    const draft = writeNoteDraft('note-race', later, 1)
    const saved = note({ title: 'B1 title', markdown: 'B1 body', rev: 2 })
    const save = vi.fn(async (value: NoteEditSnapshot, expectedRev: number) => {
      expect(expectedRev).toBe(2)
      expect(value).toEqual(later)
      return note({ ...value, rev: 3 })
    })
    const controller = new NoteAutosaveController('note-race', saved, {
      save,
      reload: async () => saved,
      readConflict: async () => ({
        title: saved.title,
        markdown: saved.markdown,
        tags: saved.tags,
        revision: saved.rev,
        generation: 'generation-1',
      }),
      recoverOriginal: async () => ({
        requestId: 'original-request',
        generation: 'generation-1',
        revision: 2,
      }),
      hasPendingRequest: () => true,
      onStatus() {},
      onConflict() {},
    })

    expect(controller.restoreUnknownRequest(original, 1, draft)).toBe(true)
    await expect(controller.checkUnknown(false)).resolves.toBe(true)

    expect(save).toHaveBeenCalledTimes(1)
    expect(readNoteDraft('note-race')).toBeNull()
    expect(controller.baseRevision).toBe(3)
  })

  it('hydrates the original snapshot before marking a no-later-input request saved', async () => {
    const original = snapshot({ title: 'B1 title', markdown: 'B1 body' })
    const saved = note({ title: 'B1 title', markdown: 'B1 body', rev: 2 })
    const events: string[] = []
    const onEditorSnapshot = vi.fn((value: NoteEditSnapshot) => {
      expect(value).toEqual(original)
      events.push('hydrated')
    })
    const controller = new NoteAutosaveController('note-race', note({ markdown: '', rev: 1 }), {
      save: vi.fn(async () => saved),
      reload: async () => saved,
      readConflict: async () => ({
        title: saved.title,
        markdown: saved.markdown,
        tags: saved.tags,
        revision: saved.rev,
        generation: 'generation-1',
      }),
      recoverOriginal: async () => ({
        requestId: 'original-request',
        generation: 'generation-1',
        revision: 2,
      }),
      hasPendingRequest: () => true,
      onStatus(state) {
        if (state === 'saved') events.push('saved')
      },
      onEditorSnapshot,
      onConflict() {},
    })

    expect(controller.restoreUnknownRequest(original, 1)).toBe(true)
    await expect(controller.checkUnknown(false)).resolves.toBe(true)

    expect(onEditorSnapshot).toHaveBeenCalledTimes(1)
    expect(events).toEqual(['hydrated', 'saved'])
    expect(controller.baseRevision).toBe(2)
  })

  it('discards a later recovery draft without resubmitting it after the original is confirmed', async () => {
    const original = snapshot({ title: 'B1 title', markdown: 'B1 body' })
    const later = snapshot({ title: 'B2 title', markdown: 'B2 body' })
    const draft = writeNoteDraft('note-race', later, 1)
    const saved = note({ title: 'B1 title', markdown: 'B1 body', rev: 2 })
    const recoverOriginal = vi.fn(async () => ({
      requestId: 'original-request',
      generation: 'generation-1',
      revision: 2,
    }))
    const save = vi.fn(async () => note({ title: 'B2 title', markdown: 'B2 body', rev: 3 }))
    const onEditorSnapshot = vi.fn()
    const controller = new NoteAutosaveController('note-race', note({ markdown: '', rev: 1 }), {
      save,
      reload: async () => saved,
      readConflict: async () => ({
        title: saved.title,
        markdown: saved.markdown,
        tags: saved.tags,
        revision: saved.rev,
        generation: 'generation-1',
      }),
      recoverOriginal,
      hasPendingRequest: () => true,
      onStatus() {},
      onEditorSnapshot,
      onConflict() {},
    })

    expect(controller.restoreUnknownRequest(original, 1, draft)).toBe(true)
    expect(controller.discardPendingRecoveryDraft()).toBe(true)
    expect(readNoteDraft('note-race')).toBeNull()
    expect(onEditorSnapshot).toHaveBeenLastCalledWith(original)

    await expect(controller.checkUnknown(false)).resolves.toBe(true)

    expect(recoverOriginal).toHaveBeenCalledWith(false, { snapshot: original, baseRev: 1 })
    expect(save).not.toHaveBeenCalled()
    expect(onEditorSnapshot).toHaveBeenLastCalledWith(original)
    expect(controller.baseRevision).toBe(2)
  })

  it('keeps a rehydrated unknown request and later draft when the request is not found', async () => {
    const original = snapshot({ title: 'original title', markdown: 'original body' })
    const persistedLater = writeNoteDraft(
      'note-race',
      snapshot({ title: 'later title', markdown: 'later body' }),
      4,
    )
    const laterEdit = snapshot({ title: 'latest title', markdown: 'latest body' })
    const recoverOriginal = vi.fn(
      async (_retry: boolean, pending: { snapshot: NoteEditSnapshot; baseRev: number }): Promise<false> => {
        expect(pending).toEqual({ snapshot: original, baseRev: 4 })
        return false
      },
    )
    const save = vi.fn(async () => note({ rev: 5 }))
    const states: NoteAutosaveState[] = []
    const controller = new NoteAutosaveController('note-race', note({ rev: 8 }), {
      save,
      reload: async () => note({ rev: 8 }),
      readConflict: async () => ({}),
      recoverOriginal,
      hasPendingRequest: () => true,
      onStatus(state) { states.push(state) },
      onConflict() {},
    })

    expect(controller.restoreUnknownRequest(original, 4, persistedLater)).toBe(true)
    controller.edit(laterEdit)
    await expect(controller.checkUnknown(false)).resolves.toBe(false)

    expect(recoverOriginal).toHaveBeenCalledWith(false, { snapshot: original, baseRev: 4 })
    expect(states.at(-1)).toBe('unknown')
    expect(save).not.toHaveBeenCalled()
    expect(readNoteDraft('note-race')).toMatchObject({
      title: 'latest title',
      markdown: 'latest body',
      baseRev: 4,
    })
  })

  it('preserves the original request and draft when recovery reports a generation change', async () => {
    const original = snapshot({ title: 'original title', markdown: 'original body' })
    const later = writeNoteDraft(
      'note-race',
      snapshot({ title: 'later title', markdown: 'later body' }),
      4,
    )
    const recoverOriginal = vi.fn(
      async (_retry: boolean, pending: { snapshot: NoteEditSnapshot; baseRev: number }) => {
        expect(pending).toEqual({ snapshot: original, baseRev: 4 })
        throw new Error('SESSION_CHANGED: generation expired')
      },
    )
    const save = vi.fn(async () => note({ rev: 5 }))
    const states: NoteAutosaveState[] = []
    const controller = new NoteAutosaveController('note-race', note({ rev: 8 }), {
      save,
      reload: async () => note({ rev: 8 }),
      readConflict: async () => ({}),
      recoverOriginal,
      hasPendingRequest: () => true,
      onStatus(state) { states.push(state) },
      onConflict() {},
    })

    expect(controller.restoreUnknownRequest(original, 4, later)).toBe(true)
    await expect(controller.checkUnknown(false)).resolves.toBe(false)

    expect(recoverOriginal).toHaveBeenCalledWith(false, { snapshot: original, baseRev: 4 })
    expect(states.at(-1)).toBe('unknown')
    expect(save).not.toHaveBeenCalled()
    expect(readNoteDraft('note-race')).toMatchObject({
      title: 'later title',
      markdown: 'later body',
      baseRev: 4,
    })
  })

  it('does not report a committed unknown request as saved when the same revision has different content', async () => {
    const submitted = snapshot({ title: '提交标题', markdown: '提交正文' })
    const divergent = {
      title: '不同正文',
      markdown: '后来内容',
      tags: [],
      revision: 2,
      generation: 'generation-1',
    }
    const states: NoteAutosaveState[] = []
    const controller = new NoteAutosaveController('note-race', note(), {
      save: async () => { throw new TypeError('response lost') },
      reload: async () => note({ title: divergent.title, markdown: divergent.markdown, rev: 2 }),
      readConflict: async () => divergent,
      recoverOriginal: async () => ({ requestId: 'original-request', generation: 'generation-1', revision: 2 }),
      hasPendingRequest: () => false,
      onStatus(state) { states.push(state) },
      onConflict() {},
    })
    controller.edit(submitted)
    await expect(controller.flush()).resolves.toBe(false)
    await expect(controller.checkUnknown(false)).resolves.toBe(false)
    expect(states.at(-1)).toBe('conflict')
    expect(readNoteDraft('note-race')).toMatchObject({
      title: '提交标题',
      markdown: '提交正文',
      baseRev: 1,
    })
  })

  it('keeps the editor base revision when a synced mirror has already advanced', async () => {
    const states: NoteAutosaveState[] = []
    const save = vi.fn(async (_value: NoteEditSnapshot, expectedRev: number) => {
      expect(expectedRev).toBe(1)
      throw new Error('VERSION_CONFLICT: notes/note-race')
    })
    const controller = new NoteAutosaveController('note-race', note(), {
      save,
      reload: async () => note({ title: '远端标题', markdown: '远端正文', rev: 2 }),
      readConflict: async () => ({ title: '远端标题', revision: 2, generation: 'generation-1', markdown: '远端正文', tags: [] }),
      recoverOriginal: async () => false,
      hasPendingRequest: () => false,
      onStatus(state) { states.push(state) },
      onConflict() {},
    })

    controller.edit(snapshot({ title: '只改标题' }))
    await expect(controller.flush()).resolves.toBe(false)
    expect(save).toHaveBeenCalledTimes(1)
    expect(states.at(-1)).toBe('conflict')
    expect(readNoteDraft('note-race')?.baseRev).toBe(1)
  })

  it('restores an old draft against its saved base revision and keeps it on conflict', async () => {
    const states: NoteAutosaveState[] = []
    const authoritative = {
      title: '远端标题',
      tags: ['server'],
      revision: 5,
      generation: 'generation-1',
      markdown: '远端正文',
    }
    const onConflict = vi.fn()
    const save = vi.fn(async (_value: NoteEditSnapshot, expectedRev: number) => {
      expect(expectedRev).toBe(4)
      throw new Error('VERSION_CONFLICT: notes/note-race')
    })
    const controller = new NoteAutosaveController(
      'note-race',
      note({ title: '远端标题', markdown: '远端正文', tags: ['server'], rev: 5 }),
      {
        save,
        reload: async () => note({ title: '远端标题', markdown: '远端正文', tags: ['server'], rev: 5 }),
        readConflict: async () => authoritative,
        recoverOriginal: async () => false,
        hasPendingRequest: () => false,
        onStatus(state) { states.push(state) },
        onConflict,
      },
    )
    const draft = {
      version: 1 as const,
      noteId: 'note-race',
      title: '本端旧标题',
      markdown: '本端旧正文',
      tags: ['local'],
      baseRev: 4,
      savedAt: 1,
    }

    expect(controller.restoreDraft(draft)).toBe(true)
    controller.edit({ title: draft.title, markdown: draft.markdown, tags: draft.tags })
    await expect(controller.flush()).resolves.toBe(false)

    expect(save).toHaveBeenCalledTimes(1)
    expect(states.at(-1)).toBe('conflict')
    expect(onConflict).toHaveBeenCalledWith(authoritative)
    expect(readNoteDraft('note-race')).toMatchObject({
      title: '本端旧标题',
      markdown: '本端旧正文',
      baseRev: 4,
    })
    controller.dispose()
  })

  it('keeps drafts in the identity where the editor opened and blocks writes after a session switch', async () => {
    mockSession.key = 'server-owner-generation-a-schema-6'
    const states: NoteAutosaveState[] = []
    const save = vi.fn(async () => note({ rev: 2 }))
    const controller = new NoteAutosaveController('note-race', note(), {
      save,
      reload: async () => note(),
      readConflict: async () => ({}),
      recoverOriginal: async () => false,
      hasPendingRequest: () => false,
      onStatus(state) { states.push(state) },
      onConflict() {},
    })

    controller.edit(snapshot({ markdown: '原身份草稿' }))
    mockSession.key = 'server-owner-generation-b-schema-6'
    controller.edit(snapshot({ markdown: '切换后仍在旧编辑器中的文字' }))
    await expect(controller.flush()).resolves.toBe(false)

    expect(save).not.toHaveBeenCalled()
    expect(states.at(-1)).toBe('conflict')
    expect(readNoteDraft('note-race', { sessionKey: 'server-owner-generation-a-schema-6' })).toMatchObject({
      markdown: '切换后仍在旧编辑器中的文字',
      baseRev: 1,
    })
    expect(readNoteDraft('note-race', { sessionKey: 'server-owner-generation-b-schema-6' })).toBeNull()
  })

  it('shows the authoritative conflict and never resubmits local edits automatically', async () => {
    const authoritative = { title: '他端标题', revision: 9, markdown: '他端正文' }
    const readConflict = vi.fn(async () => authoritative)
    const onConflict = vi.fn()
    const save = vi.fn(async () => {
      throw new Error('VERSION_CONFLICT: notes/note-race')
    })
    const states: NoteAutosaveState[] = []
    const controller = new NoteAutosaveController('note-race', note(), {
      save,
      reload: async () => note(),
      readConflict,
      recoverOriginal: async () => false,
      hasPendingRequest: () => false,
      onStatus(state) {
        states.push(state)
      },
      onConflict,
    })

    controller.edit(snapshot({ markdown: '本端草稿' }))
    await expect(controller.flush()).resolves.toBe(false)
    controller.edit(snapshot({ markdown: '继续保留本端' }))
    await vi.advanceTimersByTimeAsync(800)
    expect(states.at(-1)).toBe('conflict')
    expect(readConflict).toHaveBeenCalledTimes(1)
    expect(onConflict).toHaveBeenCalledWith(authoritative)
    expect(save).toHaveBeenCalledTimes(1)
    expect(readNoteDraft('note-race')?.markdown).toBe('继续保留本端')
  })

  it('attempts the latest snapshot on route disposal while keeping the draft until its receipt', async () => {
    const saving = deferred<Note>()
    const save = vi.fn(() => saving.promise)
    const controller = new NoteAutosaveController('note-race', note(), {
      save,
      reload: async () => note(),
      readConflict: async () => ({}),
      recoverOriginal: async () => false,
      hasPendingRequest: () => false,
      onStatus() {},
      onConflict() {},
    })

    controller.edit(snapshot({ title: '离页标题', markdown: '离页正文' }))
    controller.dispose()
    expect(save).toHaveBeenCalledTimes(1)
    expect(readNoteDraft('note-race')?.markdown).toBe('离页正文')
    saving.resolve(note({ title: '离页标题', markdown: '离页正文', rev: 2 }))
    await Promise.resolve()
    await Promise.resolve()
    expect(localStorage.getItem(noteDraftKey('note-race'))).toBeNull()
  })

  it('accepts and saves edits again after a failed delete reopens the controller', async () => {
    let current = note()
    const save = vi.fn(async (value: NoteEditSnapshot) => {
      current = note({ ...value, rev: current.rev + 1 })
      return current
    })
    const controller = new NoteAutosaveController('note-race', current, {
      save,
      reload: async () => current,
      readConflict: async () => ({}),
      recoverOriginal: async () => false,
      hasPendingRequest: () => false,
      onStatus() {},
      onConflict() {},
    })

    controller.invalidate()
    controller.edit(snapshot({ markdown: '删除期间的输入' }))
    expect(readNoteDraft('note-race')).toBeNull()

    controller.resumeAfterFailedDelete()
    controller.edit(snapshot({ markdown: '删除失败后继续编辑' }))
    expect(readNoteDraft('note-race')?.markdown).toBe('删除失败后继续编辑')
    await expect(controller.flush()).resolves.toBe(true)
    expect(save).toHaveBeenCalledWith(snapshot({ markdown: '删除失败后继续编辑' }), 1)
    expect(current.markdown).toBe('删除失败后继续编辑')
    expect(localStorage.getItem(noteDraftKey('note-race'))).toBeNull()
  })
})
