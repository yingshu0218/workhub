// @vitest-environment jsdom
import { it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { StrictMode } from 'react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
const { read } = vi.hoisted(() => ({ read: vi.fn() }))
vi.mock('@/domain/personal', () => ({
  queryPersonal: read,
  cancelPersonal: vi.fn(),
  previewPersonal: vi.fn(),
  commitPersonal: vi.fn(),
}))
vi.mock('@/queries/personal', () => ({
  usePersonalQuery: () => ({
    data: {
      generation: 'g',
      watermark: 1,
      items: [
        {
          id: 'a',
          title: '主题',
          revision: 2,
          details: { summary: { text: '正文首段', nextOffset: 4 } },
        },
      ],
    },
    reload: vi.fn(),
    error: '',
    loading: false,
  }),
}))
import RecordFields from '../RecordFields'
import RecordPage from '../RecordPage'
afterEach(() => {
  cleanup()
  read.mockReset()
  localStorage.clear()
})
it('联系人联系方式使用协议有界字段并可按同版本继续读取', async () => {
  read.mockResolvedValue({ items: [{ details: { phone: { text: '5678', nextOffset: null } } }] })
  render(
    <RecordFields
      row={{
        id: 'contact',
        revision: 2,
        details: {
          phone: { text: '1234', nextOffset: 4 },
          email: { text: 'person@example.test', nextOffset: null },
        },
      }}
      table="customers"
      generation="g"
      onError={vi.fn()}
    />,
  )
  expect(screen.getByText('person@example.test')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: '继续读取电话' }))
  expect(await screen.findByText('12345678')).toBeTruthy()
  expect(read.mock.calls[0][1]).toMatchObject({
    table: 'customers',
    id: 'contact',
    generation: 'g',
    revision: 2,
    bodyOffset: 4,
    fields: ['phone'],
  })
})
it('StrictMode effect重挂后正文续读仍可呈现', async () => {
  read.mockResolvedValue({
    items: [{ details: { summary: { text: '续页内容', nextOffset: null } } }],
  })
  render(
    <StrictMode>
      <MemoryRouter initialEntries={['/activities/a']}>
        <Routes>
          <Route path="/activities/:id" element={<RecordPage />} />
        </Routes>
      </MemoryRouter>
    </StrictMode>,
  )
  fireEvent.click(screen.getByRole('button', { name: '继续读取正文' }))
  await waitFor(() => expect(screen.getByText('正文首段续页内容')).toBeTruthy())
})
