// @vitest-environment jsdom
/**
 * 「画布上真的画出了关系边」渲染级回归锁（2026-10-14）
 *
 * 为什么需要它：连续两轮用户反馈「客户节点之间的连线不见了」，而**纯函数/数据层测试全绿** ——
 * buildGraph 出 3 条边、端点解析正常、坐标有限，可屏幕上就是没有线。也就是说：
 * 之前所有锁都只管到「数据里有没有边」，没有一条管到「DOM 里有没有画出来」。
 * 这个用例把 GraphCanvas 真渲染一遍（jsdom + 假 ResizeObserver 喂尺寸），直接数 SVG 里的
 * 关系边 `<path>`，把「数据有边但没画出来」这类断裂挡在合并之前。
 *
 * 反向对照：把 GraphCanvas 里关系边那个 `<g>` 整段注释掉 → 本用例转红。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import 'fake-indexeddb/auto'
import { render, cleanup, act, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { db } from '@/db/db'
import type { CanvasGraph } from '../../hooks'
import GraphCanvas from '../GraphCanvas'

/** 假 ResizeObserver：GraphCanvas 靠它拿容器尺寸，尺寸为 0 时整个仿真不会启动 */
class MockResizeObserver {
  static cbs: ResizeObserverCallback[] = []
  constructor(cb: ResizeObserverCallback) {
    MockResizeObserver.cbs.push(cb)
  }
  observe() {}
  unobserve() {}
  disconnect() {}
}
function fireResize(w: number, h: number) {
  act(() => {
    for (const cb of MockResizeObserver.cbs) {
      cb([{ contentRect: { width: w, height: h } } as ResizeObserverEntry], {} as ResizeObserver)
    }
  })
}

const cust = (id: string, name: string, relations: CanvasGraph['customers'][number]['relations']) => ({
  id,
  name,
  company: `${name}科技`,
  lastContactAt: 0,
  relations,
})

const graph: CanvasGraph = {
  customers: [
    cust('c1', '严伟强', [
      { targetId: 'c2', label: '项目合作', category: 'project' },
      { targetId: 'c3', label: '同行伙伴', category: 'person' },
    ]),
    cust('c2', '林晓棠', [
      { targetId: 'c1', label: '项目合作', category: 'project' },
      { targetId: 'c3', label: '转介绍人', category: 'person' },
    ]),
    cust('c3', '赵屹峰', [
      { targetId: 'c1', label: '同行伙伴', category: 'person' },
      { targetId: 'c2', label: '转介绍人', category: 'person' },
    ]),
    cust('c4', '阿头', []),
  ],
  projects: [],
  transactions: [],
  todos: [],
  interactions: [],
  notes: [],
  projectStatuses: {},
}

beforeEach(async () => {
  MockResizeObserver.cbs = []
  ;(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = MockResizeObserver
  await db.moduleConfigs.clear()
})

afterEach(() => {
  cleanup()
})

describe('GraphCanvas 客户关系视图：关系边必须真的画出来', () => {
  it('三条关系边都渲染成可见 path（且路径不是退化的零长度）', async () => {
    const { container } = render(
      <MemoryRouter>
        <GraphCanvas graph={graph} mode="customer-only" selfName="阿蓝" style={{ height: 600 }} />
      </MemoryRouter>,
    )
    fireResize(1200, 600)

    await waitFor(
      () => {
        expect(container.querySelectorAll('path[stroke-dasharray="5 4"]').length).toBe(3)
      },
      { timeout: 4000 },
    )

    // 逐条检查路径不是退化弧（两端重合会让线看不见 —— 这正是「数据有边但屏幕上没有」的形态之一）
    for (const p of container.querySelectorAll('path[stroke-dasharray="5 4"]')) {
      const d = p.getAttribute('d') ?? ''
      const nums = d.match(/-?\d+(\.\d+)?/g)?.map(Number) ?? []
      expect(nums.length).toBe(6) // M x,y Q cx,cy x,y
      const [x1, y1, , , x2, y2] = nums
      expect(Math.hypot(x2! - x1!, y2! - y1!)).toBeGreaterThan(1)
      // 坐标必须是有限数（NaN 会让整条 path 消失）
      expect(nums.every((n) => Number.isFinite(n))).toBe(true)
    }

    // 四个客户 + 一个「我」= 5 个节点也都在
    expect(container.querySelectorAll('circle').length).toBeGreaterThanOrEqual(5)
  }, 20_000)
})
