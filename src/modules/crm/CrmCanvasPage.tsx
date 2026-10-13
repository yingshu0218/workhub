import { useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button, Chip, PageHeader } from '@/design-system/ui'
import { useCanvasGraph } from './hooks'
import { useIntimacyConfig } from './intimacy'
import GraphCanvas from './graph/GraphCanvas'
import { SELF_NODE_ID, type GraphMode } from './graph/buildGraph'
import { useUserName } from '@/modules/identity'

/**
 * 客户关系画布（对齐原型 09-crm-canvas）—— 全景模式
 * 布局构建/d3 仿真/交互已抽入 graph/（GraphCanvas + useForceGraph + buildGraph 纯函数），
 * 本组件只剩页面外壳；无 focusId = 全量全景，含客户↔客户语义关系边（虚线曲线 + 标签）
 */
export default function CrmCanvasPage() {
  const graph = useCanvasGraph()
  const navigate = useNavigate()
  const intimacyCfg = useIntimacyConfig()
  // 视图切换（Issue #34）：customer-only=纯客户关系网（默认，需求主视角）；mixed=原全景（客户+业务实体）
  const [mode, setMode] = useState<GraphMode>('customer-only')
  // 「我」的显示名（Issue #123）：画布中心自节点的唯一文案，取自当前用户身份（默认阿蓝）
  const userName = useUserName()
  // 首屏「以我为重心」（Issue #94）：布局收敛后视图中心锚定到「我」自节点（固定画布中心，不漂移）。
  // Issue #123 修正：锚点不再是「挑一个客户冒充我」——真自节点由 buildGraph 产出（kind='self'）
  const [fitAnchor, setFitAnchor] = useState<string | null>(null)
  const anchorDoneRef = useRef(false)
  const handleGraphReady = () => {
    if (anchorDoneRef.current) return
    anchorDoneRef.current = true
    setFitAnchor(SELF_NODE_ID)
  }

  return (
    <div className="mx-auto max-w-[1200px]">
      <PageHeader
        title="客户关系画布"
        subtitle={
          mode === 'customer-only'
            ? '以我为画布中心 · 我不与任何节点连线，客户围绕中心按健康分/关系分布，连线为客户间分类关联与桥接弱边'
            : '力导向关系图 · 实线从属、虚线关联与桥接弱边；单击客户节点弹缩略卡，双击交易/待办/笔记穿透至详情'
        }
        actions={
          <>
            <div className="mr-2 flex overflow-hidden surface-card !bg-transparent border-outline-variant/50">
              <button
                className={`px-3 py-1.5 text-[0.9286rem] font-medium transition-colors ${
                  mode === 'customer-only'
                    ? 'bg-primary text-on-primary'
                    : 'text-on-surface-variant hover:bg-surface-container'
                }`}
                onClick={() => setMode('customer-only')}
              >
                客户关系
              </button>
              <button
                className={`px-3 py-1.5 text-[0.9286rem] font-medium transition-colors ${
                  mode === 'mixed'
                    ? 'bg-primary text-on-primary'
                    : 'text-on-surface-variant hover:bg-surface-container'
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
        {/* 悬挂关系提示（2026-10-13）：关系条目指向已删除客户时会被投影层过滤，画布一条线都不画。
            不提示的话，「没有关系」与「关系全指错了」在界面上完全一样 —— 典型的假绿。
            两种视图都提示（数据健康与视角无关）。 */}
        {(graph.danglingRelations ?? 0) > 0 && (
          <span title="这些关系条目指向的客户已被删除或不存在，图谱不会为它们画线。到「客户档案 → 关系」里重新关联即可">
            <Chip tone="red" icon="link_off">{`${graph.danglingRelations} 条关系指向已删除客户`}</Chip>
          </span>
        )}
        {mode === 'customer-only' && (
          <Chip tone="green" icon="my_location">{`我：${userName}`}</Chip>
        )}
        {mode === 'mixed' && (
          <>
            <Chip tone="green" icon="payments">{`交易 ${graph.transactions.length}`}</Chip>
            <Chip tone="amber" icon="task_alt">{`待办 ${graph.todos.length}`}</Chip>
            <Chip tone="gray" icon="description">{`笔记 ${graph.notes.length}`}</Chip>
          </>
        )}
        {mode === 'mixed' ? (
          <>
            <span className="ml-2 inline-flex items-center gap-1 text-[0.7857rem] text-outline">
              <svg width="22" height="8" className="inline-block">
                <line
                  x1="0"
                  y1="4"
                  x2="22"
                  y2="4"
                  stroke="#943700"
                  strokeWidth="1.5"
                  strokeDasharray="5 4"
                />
              </svg>
              客户关联边（relations）
            </span>
            <span className="ml-1 inline-flex items-center gap-1 text-[0.7857rem] text-outline">
              <svg width="22" height="8" className="inline-block">
                <line
                  x1="0"
                  y1="4"
                  x2="22"
                  y2="4"
                  stroke="#8a94a6"
                  strokeWidth="1"
                  strokeDasharray="2 4"
                />
              </svg>
              项目/资金桥接
            </span>
          </>
        ) : (
          <span className="ml-2 inline-flex flex-wrap items-center gap-2 text-[0.7857rem] text-outline">
            <span className="inline-flex items-center gap-1">
              <span className="h-2.5 w-2.5 rounded-full" style={{ background: '#004ac6' }} />
              我（{userName}）· 画布中心（不连线）
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="h-2 w-2 rounded-full" style={{ background: '#6d43c4' }} />
              项目
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="h-2 w-2 rounded-full" style={{ background: '#0065b8' }} />
              事件
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="h-2 w-2 rounded-full" style={{ background: '#006c49' }} />
              财务
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="h-2 w-2 rounded-full" style={{ background: '#943700' }} />
              关联人物
            </span>
            <span className="inline-flex items-center gap-1">
              <svg width="22" height="8" className="inline-block">
                <line
                  x1="0"
                  y1="4"
                  x2="22"
                  y2="4"
                  stroke="#8a94a6"
                  strokeWidth="1"
                  strokeDasharray="2 4"
                />
              </svg>
              项目/资金桥接
            </span>
          </span>
        )}
        <span className="text-[0.7857rem] text-outline">
          单击客户节点查看缩略卡 · 按住拖拽 · 滚轮缩放 · 空白处拖拽平移
        </span>
      </div>

      <GraphCanvas
        graph={graph}
        mode={mode}
        intimacyCfg={intimacyCfg}
        style={{ height: 'calc(100vh - 14rem)', minHeight: 320 }}
        showReheat
        onGraphReady={handleGraphReady}
        fitAnchorId={fitAnchor ?? undefined}
        selfName={userName}
      />
    </div>
  )
}
