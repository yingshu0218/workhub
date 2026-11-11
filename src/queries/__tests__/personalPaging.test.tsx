// @vitest-environment jsdom
import { it, expect, vi } from 'vitest'
import { renderHook, act, waitFor, cleanup } from '@testing-library/react'
const { query } = vi.hoisted(() => ({ query: vi.fn() }))
vi.mock('@/domain/personal', () => ({ queryPersonal: query }))
import { usePersonalQuery } from '@/queries/personal'
it('an old next page must not overwrite a newly selected contact scope', async () => {
  let deliver: (value: unknown) => void = () => {}
  query.mockImplementation((_name: string, input: Record<string, unknown>) => {
    if (input.cursor)
      return new Promise((r) => {
        deliver = r
      })
    return Promise.resolve({
      generation: 'g',
      items: [{ id: input.contactId }],
      nextCursor: input.contactId === 'a' ? 'a-next' : null,
    })
  })
  const hook = renderHook(({ contactId }) => usePersonalQuery('search_activities', { contactId }), {
    initialProps: { contactId: 'a' },
  })
  await waitFor(() => expect(hook.result.current.data?.items[0].id).toBe('a'))
  let request: Promise<void>
  act(() => {
    request = hook.result.current.more()
  })
  hook.rerender({ contactId: 'b' })
  await waitFor(() => expect(hook.result.current.data?.items[0].id).toBe('b'))
  await act(async () => {
    deliver({ generation: 'g', items: [{ id: 'a2' }], nextCursor: null })
    await request
  })
  expect(hook.result.current.data?.items.map((x) => x.id)).toEqual(['b'])
  cleanup()
})
