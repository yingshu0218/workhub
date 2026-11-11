// @vitest-environment jsdom
import { it, expect } from 'vitest'
import { renderHook, waitFor, cleanup } from '@testing-library/react'
import 'fake-indexeddb/auto'
import { useForceGraph } from '@/modules/crm/graph/useForceGraph'
import type { GraphNode, GraphLink } from '@/modules/crm/graph/types'
const graph = {
  customers: [],
  projects: [],
  transactions: [],
  todos: [],
  notes: [],
  interactions: [],
  projectStatuses: {},
}
const size = { w: 900, h: 480 }
it('a deleted or unavailable graph clears previous private labels and nodes', async () => {
  const before = {
    nodes: [
      {
        id: 'activities/private',
        kind: 'activity',
        label: 'private erased source',
        radius: 20,
        color: '#000',
        fill: '#fff',
        slot: 'project',
        to: '/activities/private',
      } as GraphNode,
    ],
    links: [] as GraphLink[],
  }
  const hook = renderHook(({ prepared }) => useForceGraph({ graph, prepared, size }), {
    initialProps: { prepared: before },
  })
  await waitFor(() => expect(hook.result.current.nodes.length).toBe(1))
  hook.rerender({ prepared: { nodes: [], links: [] } })
  await waitFor(() => expect(hook.result.current.nodes.length).toBe(0))
  cleanup()
})
