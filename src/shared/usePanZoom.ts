import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * 通用 SVG 画布缩放平移 Hook（Issue #11 P2：自 CrmCanvasPage 内联实现提炼）
 *
 * 视图变换：scale 缩放 + tx/ty 平移（SVG 用户坐标 → 屏幕坐标 = world * scale + t）
 * 能力：滚轮缩放（trackpad 捏合 ctrl+wheel 同样生效）/ 背景拖拽平移 / 视口中心锚定缩放
 *
 * 使用方说明（R2 审计后如实更正）：
 * - 当前仅 CustomerTimelinePage（鱼骨时间线）接入本 hook，抽取为单向。
 * - CrmCanvasPage 暂沿用其内联 view 变换（与早期实现同源），迁移共享 hook
 *   列入 P3（已知差异：画布 SCALE_MAX=2，本 hook 默认 maxScale=2.5，迁移时需对齐缩放边界）。
 */

export interface PanZoomView {
  scale: number
  tx: number
  ty: number
}

export const IDENTITY_VIEW: PanZoomView = { scale: 1, tx: 0, ty: 0 }

export function usePanZoom(options: { minScale?: number; maxScale?: number } = {}) {
  const { minScale = 0.5, maxScale = 2.5 } = options
  const wrapRef = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ w: 0, h: 0 })
  const [view, setView] = useState<PanZoomView>(IDENTITY_VIEW)
  const panStartRef = useRef<{ x: number; y: number; tx: number; ty: number } | null>(null)

  // 画布容器尺寸自适应
  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const ro = new ResizeObserver((entries) => {
      const r = entries[0].contentRect
      setSize({ w: Math.round(r.width), h: Math.round(r.height) })
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const clampScale = useCallback((s: number) => Math.min(maxScale, Math.max(minScale, s)), [minScale, maxScale])

  /** 以视口中心为锚点缩放到指定倍率：缩放前后中心指向的世界点不动 */
  const zoomTo = useCallback(
    (next: number) => {
      const s = clampScale(next)
      setView((v) => {
        const k = s / v.scale
        return {
          scale: s,
          tx: size.w / 2 - (size.w / 2 - v.tx) * k,
          ty: size.h / 2 - (size.h / 2 - v.ty) * k,
        }
      })
    },
    [clampScale, size.w, size.h],
  )

  // 滚轮缩放；preventDefault 阻止页面滚动
  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      setView((v) => {
        const s = clampScale(v.scale * Math.exp(-e.deltaY * 0.002))
        const k = s / v.scale
        return {
          scale: s,
          tx: size.w / 2 - (size.w / 2 - v.tx) * k,
          ty: size.h / 2 - (size.h / 2 - v.ty) * k,
        }
      })
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [size.w, size.h, clampScale])

  /** 背景空白处按下 = 开始平移（子元素 onPointerDown 已 stopPropagation 时不会误入此分支） */
  function panStart(e: React.PointerEvent) {
    panStartRef.current = { x: e.clientX, y: e.clientY, tx: view.tx, ty: view.ty }
  }

  /** 指针移动：平移中则更新视口，返回是否消费了该事件（供调用方区分节点拖拽） */
  function panMove(e: React.PointerEvent): boolean {
    const p = panStartRef.current
    if (!p) return false
    setView((v) => ({ ...v, tx: p.tx + (e.clientX - p.x), ty: p.ty + (e.clientY - p.y) }))
    return true
  }

  function panEnd() {
    panStartRef.current = null
  }

  // 触摸手势被系统中断时兜底清理平移状态
  const panCancel = panEnd

  return { wrapRef, size, view, setView, zoomTo, panStart, panMove, panEnd, panCancel, clampScale }
}
