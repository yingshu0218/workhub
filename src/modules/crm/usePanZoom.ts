import { useEffect, useRef, useState } from 'react'

/**
 * SVG 画布共享的缩放平移视图 hook（CrmCanvasPage / CustomerTimelinePage 复用）
 *
 * 视图变换模型：屏幕坐标 = world * scale + (tx, ty)
 * - wheel 缩放：trackpad 捏合（ctrl+wheel）与普通滚轮都生效；preventDefault 阻止页面滚动，
 *   因此走原生监听（passive:false），调用方用返回的 ref 绑定容器
 * - pointer 拖拽平移：走 React 合成事件（containerProps 直接展开到容器上）；
 *   onPanStart 返回 false 可拒绝本次拖拽（例如按在节点上由节点自行处理）
 * - 缩放以视口中心为锚点：缩放前后中心指向的世界点不动
 */

export const SCALE_MIN = 0.5
export const SCALE_MAX = 2
export const clampScale = (s: number) => Math.min(SCALE_MAX, Math.max(SCALE_MIN, s))

/** 视图变换：scale 缩放 + tx/ty 平移（SVG 用户坐标 → 屏幕坐标 = world * scale + t） */
export interface ViewState {
  scale: number
  tx: number
  ty: number
}
export const IDENTITY_VIEW: ViewState = { scale: 1, tx: 0, ty: 0 }

export interface PanZoomOptions {
  /** 容器（SVG 视口）尺寸，随 ResizeObserver 更新 */
  size: { w: number; h: number }
  /** 容器 pointerdown 时询问是否开始平移；返回 false 忽略（如点在节点上由节点自行处理） */
  onPanStart?: (e: React.PointerEvent) => boolean
}

export function usePanZoom({ size, onPanStart }: PanZoomOptions) {
  const [view, setView] = useState<ViewState>(IDENTITY_VIEW)
  const panStartRef = useRef<{ x: number; y: number; tx: number; ty: number } | null>(null)
  const onPanStartRef = useRef(onPanStart)
  onPanStartRef.current = onPanStart

  /** 以视口中心为锚点缩放到指定倍率 */
  function zoomTo(next: number) {
    const s = clampScale(next)
    setView((v) => {
      const k = s / v.scale
      return {
        scale: s,
        tx: size.w / 2 - (size.w / 2 - v.tx) * k,
        ty: size.h / 2 - (size.h / 2 - v.ty) * k,
      }
    })
  }

  /** 重置视图到初始状态 */
  function reset() {
    setView(IDENTITY_VIEW)
  }

  // 滚轮缩放：wheel 事件需 preventDefault，React 合成器为 passive，必须走原生监听
  const wrapRef = useRef<HTMLDivElement | null>(null)
  const sizeRef = useRef(size)
  sizeRef.current = size
  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      setView((v) => {
        const { w, h } = sizeRef.current
        const s = clampScale(v.scale * Math.exp(-e.deltaY * 0.002))
        const k = s / v.scale
        return {
          scale: s,
          tx: w / 2 - (w / 2 - v.tx) * k,
          ty: h / 2 - (h / 2 - v.ty) * k,
        }
      })
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

  /** 容器事件 props：背景空白按下拖拽 = 平移（可交互元素 onPointerDown stopPropagation 即不会误入） */
  const containerProps = {
    onPointerDown: (e: React.PointerEvent) => {
      if (onPanStartRef.current && !onPanStartRef.current(e)) return
      panStartRef.current = { x: e.clientX, y: e.clientY, tx: view.tx, ty: view.ty }
    },
    onPointerMove: (e: React.PointerEvent) => {
      const pan = panStartRef.current
      if (!pan) return
      setView((v) => ({ ...v, tx: pan.tx + (e.clientX - pan.x), ty: pan.ty + (e.clientY - pan.y) }))
    },
    onPointerUp: () => {
      panStartRef.current = null
    },
    // 触摸拖拽被系统手势中断时 pointerup 不会派发，pointercancel 兜底清理
    onPointerCancel: () => {
      panStartRef.current = null
    },
  }

  return { view, setView, zoomTo, reset, containerProps, wheelRef: wrapRef as React.MutableRefObject<HTMLDivElement | null> }
}
