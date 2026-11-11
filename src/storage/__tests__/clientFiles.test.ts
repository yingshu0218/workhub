// @vitest-environment jsdom
import { it, expect, vi, afterEach } from 'vitest'
import 'fake-indexeddb/auto'
import { db } from '@/db/db'
import { activateClientSession } from '../clientSession'
import { saveAuthSession } from '@/shared/authToken'
import { attachmentBlob } from '../clientFiles'
afterEach(() => vi.unstubAllGlobals())
it('新设备只有文件元数据时按需通过统一鉴权入口下载，离线缺文件明确报错', async () => {
  activateClientSession('file-case', 'g', 6)
  saveAuthSession('owner-secret', 'owner', 'file-case')
  await db.attachments.put({ id: 'att', name: 'file.txt', deleted: 0, rev: 1 } as never)
  Object.defineProperty(navigator, 'onLine', { configurable: true, value: true })
  const fetcher = vi.fn(async (_url: string, _init?: RequestInit) => new Response('private bytes'))
  vi.stubGlobal('fetch', fetcher)
  expect(await (await attachmentBlob('att')).text()).toBe('private bytes')
  expect(fetcher.mock.calls[0]?.[0]).toBe('/api/workhub/attachments/att/file')
  Object.defineProperty(navigator, 'onLine', { configurable: true, value: false })
  await expect(attachmentBlob('att')).rejects.toThrow('离线缓存尚无')
})
