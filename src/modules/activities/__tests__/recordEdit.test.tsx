// @vitest-environment jsdom
import { it, expect, vi } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
const { captured } = vi.hoisted(() => ({
  captured: { value: undefined as Record<string, unknown> | undefined },
}))
vi.mock('@/queries/personal', () => ({
  usePersonalQuery: () => ({
    data: {
      generation: 'g',
      watermark: 2,
      items: [
        {
          id: 'long-a',
          title: '完整主题',
          revision: 2,
          occurredAt: 1,
          details: { summary: { text: '仅用于展示的首段', nextOffset: 400 } },
        },
      ],
    },
    reload: vi.fn(),
    error: '',
    loading: false,
  }),
}))
vi.mock('@/modules/activities/MutationPanel', () => ({
  default: (props: { input: Record<string, unknown>; children: unknown }) => {
    captured.value = props.input
    return props.children
  },
}))
import RecordPage from '@/modules/activities/RecordPage'
it('editing only the title must not overwrite a long body with its displayed first chunk', () => {
  render(
    <MemoryRouter initialEntries={['/activities/long-a']}>
      <Routes>
        <Route path="/activities/:id" element={<RecordPage />} />
      </Routes>
    </MemoryRouter>,
  )
  fireEvent.click(screen.getByRole('button', { name: '纠正事件' }))
  fireEvent.change(screen.getByLabelText('主题'), { target: { value: '改正主题' } })
  const changes = captured.value?.changes as { patch: Record<string, unknown> }[]
  expect(changes[0].patch.title).toBe('改正主题')
  expect(changes[0].patch).not.toHaveProperty('summary')
  cleanup()
})
