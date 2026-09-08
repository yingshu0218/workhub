import { useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useRecord } from '@/queries/hooks'
import type { Customer } from '@/db/types'
import { Button, Chip, EmptyState, PageHeader } from '@/design-system/ui'
import { useCanvasGraph } from './hooks'
import GraphCanvas from './graph/GraphCanvas'

/**
 * 单客户聚焦图谱（/crm/:id/graph，Issue #22 需求 ③）
 * 复用 GraphCanvas（focusId 数据裁剪：焦点客户 + 一跳邻居），与全景画布同壳零复制；
 * 头部「查看全部图谱 →」返回 /crm/canvas，形成 单客户 ⇄ 全部 双向闭环
 * 首屏焦点锁定（Issue #34）：布局收敛回调把视图中心锚到焦点客户，一进视图焦点主体即居中可见
 */
export default function CustomerGraphPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const customer = useRecord<Customer>('customers', id)
  const graph = useCanvasGraph()

  const focus = graph.customers.find((c) => c.id === id)
  const relCount = focus?.relations.length ?? 0

  // 布局收敛后锁定焦点：通知 GraphCanvas 以焦点客户为锚点再 fit（一次性，防重复触发）
  const [fitAnchor, setFitAnchor] = useState<string | null>(null)
  const anchorDoneRef = useRef(false)
  const handleGraphReady = () => {
    if (anchorDoneRef.current || !id) return
    anchorDoneRef.current = true
    setFitAnchor(id)
  }

  if (!customer) {
    return (
      <div className="mx-auto max-w-[1200px]">
        <PageHeader
          title="客户图谱"
          actions={<Button variant="ghost" icon="arrow_back" onClick={() => navigate('/crm')}>返回列表</Button>}
        />
        <EmptyState icon="person_off" title="客户不存在或已删除" description="可能已被移除，返回列表查看其他客户" />
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-[1200px]">
      <PageHeader
        title={`${customer.name} · 关系图谱`}
        subtitle="以该客户为主体的星型聚焦视图：业务实体 + 关联客户参与布局，二跳以外已裁剪"
        actions={
          <>
            <Button variant="ghost" icon="arrow_back" onClick={() => navigate(`/crm/${customer.id}`)}>
              返回档案
            </Button>
            <Button variant="tonal" icon="hub" onClick={() => navigate('/crm/canvas')}>
              查看全部图谱 →
            </Button>
          </>
        }
      />

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Chip tone="blue" icon="person">{`关联交易 ${graph.transactions.filter((t) => t.customerId === id).length}`}</Chip>
        <Chip tone="amber" icon="task_alt">{`关联待办 ${graph.todos.filter((t) => t.customerId === id).length}`}</Chip>
        <Chip tone="gray" icon="description">{`关联笔记 ${graph.notes.filter((n) => n.customerId === id).length}`}</Chip>
        <Chip tone="red" icon="link">{`关联客户 ${relCount}`}</Chip>
        <span className="ml-2 text-[11px] text-outline">
          虚线弧边为客户间分类关系 · 桥接弱边为二跳推导关联 · 单击客户节点查看缩略卡 · 按住拖拽 · 滚轮缩放
        </span>
      </div>

      <GraphCanvas
        graph={graph}
        focusId={id}
        style={{ height: 'calc(100vh - 16rem)', minHeight: 380 }}
        onGraphReady={handleGraphReady}
        fitAnchorId={fitAnchor ?? undefined}
      />
    </div>
  )
}
