// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'

const { useQuery, cancel } = vi.hoisted(() => ({ useQuery: vi.fn(), cancel: vi.fn() }))
vi.mock('@/queries/personal', () => ({ usePersonalQuery: useQuery }))
vi.mock('@/domain/personal', () => ({
  queryPersonal: vi.fn(),
  cancelPersonal: cancel,
  previewPersonal: vi.fn(),
  commitPersonal: vi.fn(),
}))

import RecordPage from '../RecordPage'

function showOperation(overrides: Record<string, unknown> = {}) {
  useQuery.mockReturnValue({
    data: {
      generation: 'generation-current',
      watermark: 8,
      items: [
        {
          id: 'operation-agent-a',
          requestId: 'request-agent-a',
          generation: 'generation-current',
          status: 'awaiting_confirmation',
          initiator: 'Agent A',
          canCancel: false,
          ...overrides,
        },
      ],
    },
    reload: vi.fn(),
    error: '',
    loading: false,
  })
  render(
    <MemoryRouter initialEntries={['/operations/operation-agent-a']}>
      <Routes>
        <Route path="/operations/:id" element={<RecordPage operation />} />
      </Routes>
    </MemoryRouter>,
  )
}

afterEach(() => {
  cleanup()
  useQuery.mockReset()
  cancel.mockReset()
})

it('异端待确认操作只显示原端提示，不提供撤回按钮', () => {
  showOperation({ canCancel: false })

  expect(screen.getByText('该预览由另一客户端发起，请在原端撤回。')).toBeTruthy()
  expect(screen.queryByRole('button', { name: '撤回本端预览' })).toBeNull()
  expect(cancel).not.toHaveBeenCalled()
})

it('世代不匹配时隐藏撤回入口，即使旧投影残留 canCancel=true', () => {
  showOperation({ canCancel: true, generation: 'generation-old' })

  expect(screen.queryByRole('button', { name: '撤回本端预览' })).toBeNull()
  expect(cancel).not.toHaveBeenCalled()
})

it('当前世代的原发起端可以执行撤回', async () => {
  cancel.mockResolvedValue({ status: 'cancelled' })
  showOperation({ canCancel: true })

  fireEvent.click(screen.getByRole('button', { name: '撤回本端预览' }))
  await waitFor(() => expect(cancel).toHaveBeenCalledWith({
    requestId: 'request-agent-a',
    generation: 'generation-current',
  }))
})
