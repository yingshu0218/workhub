// @vitest-environment jsdom
import { it, expect, vi } from 'vitest'
import { useState } from 'react'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import 'fake-indexeddb/auto'
const { preview, cancel } = vi.hoisted(() => ({ preview: vi.fn(), cancel: vi.fn() }))
vi.mock('@/domain/personal', () => ({
  previewPersonal: preview,
  cancelPersonal: cancel,
  commitPersonal: vi.fn(),
  queryPersonal: vi.fn(),
}))
import MutationPanel from '@/modules/activities/MutationPanel'
import { ClientRequestError } from '@/platform/request'
import { activateClientSession } from '@/storage/clientSession'
function Fixture() {
  const [title, setTitle] = useState('')
  return (
    <MutationPanel
      kind="capture"
      input={{ activities: [{ key: 'a', title }] }}
      slot="root-validation"
      label="预览记录"
    >
      <label>
        主题
        <input value={title} onChange={(e) => setTitle(e.target.value)} />
      </label>
    </MutationPanel>
  )
}
it('a definite validation rejection leaves the unsubmitted draft editable', async () => {
  localStorage.clear()
  activateClientSession('validation-owner', 'validation-generation', 6)
  preview
    .mockRejectedValueOnce(new ClientRequestError('INVALID_INPUT', '主题不能为空', 400))
    .mockResolvedValue({ preview: true, previewId: 'valid', changes: [] })
  cancel.mockRejectedValue(
    Object.assign(new Error('FORBIDDEN: 操作归属'), { code: 'FORBIDDEN', status: 403 }),
  )
  render(
    <MemoryRouter>
      <Fixture />
    </MemoryRouter>,
  )
  fireEvent.click(screen.getByRole('button', { name: '预览记录' }))
  await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('INVALID_INPUT'))
  const input = screen.getByLabelText('主题') as HTMLInputElement
  expect(input.closest('fieldset')?.disabled).toBe(false)
  fireEvent.change(input, { target: { value: '改正的主题' } })
  fireEvent.click(screen.getByRole('button', { name: '预览记录' }))
  await waitFor(() => expect(preview).toHaveBeenCalledTimes(2))
  expect(preview.mock.calls[1][1].activities[0].title).toBe('改正的主题')
  cleanup()
})
it('明确版本冲突没有创建预览，仍允许保留并改正草稿', async () => {
  cleanup()
  localStorage.clear()
  activateClientSession('conflict-owner', 'conflict-generation', 6)
  preview.mockReset()
  preview.mockRejectedValue(new ClientRequestError('VERSION_CONFLICT', '已被另一设备修改', 409))
  render(
    <MemoryRouter>
      <Fixture />
    </MemoryRouter>,
  )
  fireEvent.click(screen.getByRole('button', { name: '预览记录' }))
  await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('VERSION_CONFLICT'))
  expect(screen.getByLabelText('主题').closest('fieldset')?.disabled).toBe(false)
  cleanup()
})
