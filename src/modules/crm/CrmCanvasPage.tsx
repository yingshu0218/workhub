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

  return (
    <div className="mx-auto max-w-[1200px]">
      <PageHeader
        title="客户关系画布"
        subtitle="力导向关系图 · 拖拽节点体验物理弹簧，点击客户节点穿透至档案"
        actions={
          <Button variant="ghost" icon="arrow_back" onClick={() => navigate('/crm')}>
            返回客户列表
          </Button>
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
          客户关联边
        </span>
        <span className="text-[11px] text-outline">
          单击客户节点跳转 · 双击交易/待办/笔记节点穿透 · 按住拖拽 · 滚轮缩放 · 空白处拖拽平移
        </span>
      </div>

      <GraphCanvas
        graph={graph}
        style={{ height: 'calc(100vh - 14rem)', minHeight: 320 }}
        showReheat
      />
    </div>
  )
}
