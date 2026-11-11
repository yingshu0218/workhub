// @vitest-environment jsdom
import { it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor, act, cleanup } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import 'fake-indexeddb/auto'
const { query } = vi.hoisted(() => ({ query: vi.fn() }))
vi.mock('@/domain/personal', () => ({
  queryPersonal: query,
  cancelPersonal: vi.fn(),
  previewPersonal: vi.fn(),
  commitPersonal: vi.fn(),
}))
import RecordPage from '@/modules/activities/RecordPage'
import { activateClientSession } from '@/storage/clientSession'
it('a normal mirror refresh preserves an unsubmitted body edit separately from the authoritative body', async () => {
  localStorage.clear()
  activateClientSession('draft-owner', 'draft-generation', 6)
  const row = {
      id: 'draft-a',
      title: '主题',
      revision: 1,
      occurredAt: 1,
      details: { summary: { text: '原正文', nextOffset: null } },
    },
    result = { generation: 'draft-generation', watermark: 1, items: [row] }
  let release: (v: unknown) => void = () => {}
  query
    .mockResolvedValueOnce(result)
    .mockImplementationOnce(
      () =>
        new Promise((r) => {
          release = r
        }),
    )
    .mockResolvedValue(result)
  render(
    <MemoryRouter initialEntries={['/activities/draft-a']}>
      <Routes>
        <Route path="/activities/:id" element={<RecordPage />} />
      </Routes>
    </MemoryRouter>,
  )
  await waitFor(() => expect(screen.getByRole('button', { name: '纠正事件' })).toBeTruthy())
  fireEvent.click(screen.getByRole('button', { name: '纠正事件' }))
  fireEvent.change(screen.getByLabelText('当前事实摘要'), {
    target: { value: '我还没提交的新正文' },
  })
  act(() => window.dispatchEvent(new Event('workhub:changed')))
  await waitFor(() => expect(screen.getByRole('status').textContent).toContain('正在读取'))
  await act(async () => release(result))
  if (!screen.queryByLabelText('当前事实摘要'))
    fireEvent.click(screen.getByRole('button', { name: '纠正事件' }))
  expect((screen.getByLabelText('当前事实摘要') as HTMLTextAreaElement).value).toBe(
    '我还没提交的新正文',
  )
  cleanup()
})
