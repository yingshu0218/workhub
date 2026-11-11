// @vitest-environment jsdom
import { it, expect, vi } from 'vitest'
import 'fake-indexeddb/auto'
const { request } = vi.hoisted(() => ({ request: vi.fn() }))
vi.mock('@/platform/request', () => ({ clientRequest: request }))
import { activateClientSession } from '@/storage/clientSession'
import { publishMirror } from '@/storage/clientMirror'
import { queryPersonal } from '@/domain/personal'
it('a source-purged activity cannot be returned by the old offline query cache', async () => {
  const session = activateClientSession('privacy-owner', 'privacy-generation', 6)
  Object.defineProperty(navigator, 'onLine', { get: () => true, configurable: true })
  request.mockResolvedValue({
    generation: session.generation,
    items: [
      {
        id: 'private-activity',
        title: 'private title',
        source: { text: 'erased sensitive source' },
      },
    ],
  })
  const input = { id: 'private-activity', includeSource: true }
  await queryPersonal('get_activity', input)
  await publishMirror(
    [{ table: 'activities', id: 'private-activity', row: null }],
    session,
    'new-cursor',
    false,
  )
  Object.defineProperty(navigator, 'onLine', { get: () => false, configurable: true })
  let result: unknown
  try {
    result = await queryPersonal('get_activity', input)
  } catch (e) {
    expect(String(e)).toMatch(/OFFLINE|CACHE|NOT_FOUND|DELETED/)
  }
  expect(JSON.stringify(result || {})).not.toContain('erased sensitive source')
})
