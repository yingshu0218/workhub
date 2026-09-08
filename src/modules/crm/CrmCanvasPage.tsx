import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button, Chip, PageHeader } from '@/design-system/ui'
import { useCanvasGraph } from './hooks'
import GraphCanvas from './graph/GraphCanvas'
import type { GraphMode } from './graph/buildGraph'

/**
 * 客户关系画布（对齐原型 09-crm-canvas）—— 全景模式
 * 布局构建/d3 仿真/交互已抽入 graph/（GraphCanvas + useForceGraph + buildGraph 纯函数），
 * 本组件只剩页面外壳；无 focusId = 全量全景，含客户↔客户语义关系边（虚线曲线 + 标签）
 */
export default function CrmCanvasPage() {
  const graph = useCanvasGraph()
  const navigate = useNavigate()
  // 视图切换（Issue #34）：customer-only=纯客户关系网（默认，需求主视角）；mixed=原全景（客户+业务实体）
  const [mode, setMode] = useState<GraphMode>('customer-only')

  return (
    <div className="mx-auto max-w-[1200px]">
      <PageHeader
        title="客户关系画布"
        subtitle={
          mode === 'customer-only'
            ? '客户关系网 · 主节点为客户，连线为分类关联与桥接弱边，单击节点查看缩略卡'
            : '力导向关系图 · 实线从属、虚线关联与桥接弱边；单击客户节点弹缩略卡，双击交易/待办/笔记穿透至详情'
        }
        actions={
          <>
            <div className="mr-2 flex overflow-hidden rounded-lg border border-outline-variant/50">
              <button
                className={`px-3 py-1.5 text-[13px] font-medium transition-colors ${
                  mode === 'customer-only' ? 'bg-primary text-on-primary' : 'text-on-surface-variant hover:bg-surface-container'
                }`}
                onClick={() => setMode('customer-only')}
              >
                客户关系
              </button>
              <button
                className={`px-3 py-1.5 text-[13px] font-medium transition-colors ${
                  mode === 'mixed' ? 'bg-primary text-on-primary' : 'text-on-surface-variant hover:bg-surface-container'
                }`}
                onClick={() => setMode('mixed')}
              >
                全景视图
              </button>
            </div>
            <Button variant="ghost" icon="arrow_back" onClick={() => navigate('/crm')}>
              返回客户列表
            </Button>
          </>
        }
      />

      {/* 图例 + 节点统计 */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Chip tone="blue" icon="person">{`客户 ${graph.customers.length}`}</Chip>
        {mode === 'mixed' && (
          <>
            <Chip tone="green" icon="payments">{`交易 ${graph.transactions.length}`}</Chip>
            <Chip tone="amber" icon="task_alt">{`待办 ${graph.todos.length}`}</Chip>
            <Chip tone="gray" icon="description">{`笔记 ${graph.notes.length}`}</Chip>
          </>
        )}
        {mode === 'mixed' ? (
          <>
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
          </>
        ) : (
          <span className="ml-2 inline-flex flex-wrap items-center gap-2 text-[11px] text-outline">
            <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full" style={{ background: '#6d43c4' }} />项目</span>
            <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full" style={{ background: '#0065b8' }} />事件</span>
            <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full" style={{ background: '#006c49' }} />财务</span>
            <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full" style={{ background: '#943700' }} />关联人物</span>
            <span className="inline-flex items-center gap-1">
              <svg width="22" height="8" className="inline-block">
                <line x1="0" y1="4" x2="22" y2="4" stroke="#8a94a6" strokeWidth="1" strokeDasharray="2 4" />
              </svg>
              项目/资金桥接
            </span>
          </span>
        )}
        <span className="text-[11px] text-outline">
          单击客户节点查看缩略卡 · 按住拖拽 · 滚轮缩放 · 空白处拖拽平移
        </span>
      </div>

      <GraphCanvas
        graph={graph}
        mode={mode}
        style={{ height: 'calc(100vh - 14rem)', minHeight: 320 }}
        showReheat
      />
    </div>
  )
}
