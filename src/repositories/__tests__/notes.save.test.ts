import { beforeEach, describe, expect, it } from 'vitest'
import 'fake-indexeddb/auto'
import { db } from '@/db/db'
import { customerRepo, saveNoteWithMentionsAndRevision } from '@/repositories'
import type { Note } from '@/db/types'

beforeEach(async () => {
  await Promise.all(db.tables.map((table) => table.clear()))
})

describe('saveNoteWithMentionsAndRevision', () => {
  it('returns each committed rev and keeps body plus mention links in the same transaction', async () => {
    await customerRepo.put({
      id: 'customer-note-target',
      name: '目标客户',
      company: '',
      title: '',
      decisionLevel: '决策人',
      tags: [],
      phone: '',
      wechat: '',
      email: '',
      address: '',
      lastContactAt: 0,
      createdAt: 1,
    })
    const first = await saveNoteWithMentionsAndRevision({
      id: 'note-mention-atomic',
      title: 'T1',
      markdown: '正文 @[目标客户](customer:customer-note-target)',
      tags: ['初始'],
      createdAt: 1,
      deleted: 0,
      rev: 0,
    })
    const active = (await db.links.toArray()).filter(
      (link) => link.kind === 'mention' && link.fromId === first.id && !link.deleted,
    )
    expect(first).toMatchObject({ title: 'T1', rev: 1 })
    expect(active).toHaveLength(1)

    const second = await saveNoteWithMentionsAndRevision({
      ...first,
      title: 'T2',
      markdown: '正文已删除提及',
    })
    const row = await db.notes.get(first.id)
    const links = (await db.links.toArray()).filter(
      (link) => link.kind === 'mention' && link.fromId === first.id,
    )
    expect(second).toMatchObject({ title: 'T2', markdown: '正文已删除提及', rev: 2 })
    expect(row).toMatchObject({ title: 'T2', markdown: '正文已删除提及', rev: 2 })
    expect(links).toHaveLength(1)
    expect(links[0].deleted).toBe(1)
  })

  it('rejects an older editor rev without changing the body or mention links', async () => {
    const base: Note = {
      id: 'note-stale',
      title: '当前标题',
      markdown: '当前正文',
      tags: [],
      createdAt: 1,
      updatedAt: 1,
      deleted: 0,
      rev: 2,
    }
    await db.notes.put(base)
    await expect(
      saveNoteWithMentionsAndRevision({ ...base, rev: 1, markdown: '旧编辑器正文' }),
    ).rejects.toThrow('VERSION_CONFLICT')
    expect(await db.notes.get(base.id)).toMatchObject({ title: '当前标题', markdown: '当前正文', rev: 2 })
  })
})
