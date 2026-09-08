import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button, Chip, PageHeader } from '@/design-system/ui'
import { useCanvasGraph } from './hooks'
import GraphCanvas from './graph/GraphCanvas'

/**
 * 客户关系画布（对齐原型 09-crm-canvas）—— 全景模式
 * 布局构建/d3 仿真/交互已抽入 graph/（GraphCanvas + useForceGraph + buildGraph 纯函数），
 * 本组件只剩页面外壳；无 focusId = 全量全景，含客户↔客户语义关系边（虚线曲线 + 标签）
 */
export default function CrmCanvasPage() {
  const graph = useCanvasGraph()
  const navigate = useNavigate()
  // 「客户关系视图」开关：默认全景（含业务实体节点），一键切换为纯客户关系图（Issue #34 ③）
  const [showEntities, setShowEntities] = useState(true)

  return (
    <div className="mx-auto max-w-[1200px]">
      <PageHeader
        title="客户关系画布"
        subtitle="力导向关系图 · 实线从属、虚线关联与桥接弱边；单击客户节点弹缩略卡"
        actions={
          <div className="flex items-center gap-2">
            <Button
              variant={showEntities ? 'primary' : 'ghost'}
              icon="hub"
              onClick={() => setShowEntities((v) => !v)}
            >
              {showEntities ? '客户关系视图' : '全景视图'}
            </Button>
            <Button variant="ghost" icon="arrow_back" onClick={() => navigate('/crm')}>
              返回客户列表
            </Button>
          </div>
        }
      />

      {/* 图例 + 节点统计 */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Chip tone="blue" icon="person">{`客户 ${graph.customers.length}`}</Chip>
        <Chip tone="green" icon="payments">{`交易 ${graph.transactions.length}`}</Chip>
        <Chip tone="amber" icon="task_alt">{`待办 ${graph.todos.length}`}</Chip>
        <Chip tone="gray" icon="description">{`笔记 ${graph.notes.length}`}</Chip>
        <span className="ml-2 inline-flex items-center gap-1 text-[11px] text-outline">
          <svg width="22" height="8" className="inline-block">
            <line x1="0" y1="4" x2="22" y2="4" stroke="#943700" strokeWidth="1.5" strokeDasharray="5 4" />
          </svg>
          客户关联边（relations）
        </span>
        <span className="ml-1 inline-flex items-center gap-1 text-[11px] text-outline">
          <svg width="22" height="8" className="inline-block">
            <line x1="0" y1="4" x2="22" y2="4" stroke="#8a94a6" strokeWidth="1" strokeDasharray="2 4" />
          </svg>
          项目/资金桥接
        </span>
        <span className="text-[11px] text-outline">
          单击客户节点弹卡 · 双击交易/待办/笔记穿透 · 按住拖拽 · 滚轮缩放
        </span>
      </div>

      <GraphCanvas
        graph={graph}
        style={{ height: 'calc(100vh - 14rem)', minHeight: 320 }}
        showReheat
        showEntities={showEntities}
      />
    </div>
  )
}
