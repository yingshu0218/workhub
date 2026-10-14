import { useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button, PageHeader } from '@/design-system/ui'
import { useCanvasGraph } from './hooks'
import GraphCanvas from './graph/GraphCanvas'
import { SELF_NODE_ID, type GraphMode } from './graph/buildGraph'
import { useUserName } from '@/modules/identity'

/**
 * 客户关系画布（对齐原型 09-crm-canvas）—— 全景模式
 * 布局构建/d3 仿真/交互已抽入 graph/（GraphCanvas + useForceGraph + buildGraph 纯函数），
 * 本组件只剩页面外壳；无 focusId = 全量全景，含客户↔客户语义关系边（虚线曲线）
 *
 * ⚠️ 2026-10-14 用户裁决：**页面级的补充说明一律不显示** —— 副标题、图例、节点统计 chip、
 * 操作提示句整行移除，页面只留「标题 + 视图切换 + 返回」与画布本身。
 * 关系层的数据健康提示（悬挂关系 / 一条关系都没有）不在这里，改由画布内浮层**按需**出现
 * （见 GraphCanvas）：那是「出问题才提示」的告警，不是常驻旁白，两者性质不同。
 */
export default function CrmCanvasPage() {
  const graph = useCanvasGraph()
  const navigate = useNavigate()
  // 视图切换（Issue #34）：customer-only=纯客户关系网（默认，需求主视角）；mixed=原全景（客户+业务实体）
  const [mode, setMode] = useState<GraphMode>('customer-only')
  // 「我」的显示名（Issue #123）：画布中心自节点的唯一文案，取自当前用户身份（默认阿蓝）
  const userName = useUserName()
  // 首屏「以我为重心」：布局收敛后视图中心锚定到「我」自节点（固定画布中心，不漂移）
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

      <GraphCanvas
        graph={graph}
        mode={mode}
        style={{ height: 'calc(100vh - 11rem)', minHeight: 320 }}
        showReheat
        onGraphReady={handleGraphReady}
        fitAnchorId={fitAnchor ?? undefined}
        selfName={userName}
      />
    </div>
  )
}
