import { EmptyState, PageHeader } from '@/design-system/ui'

/** 模块占位页：Phase 1-6 逐个实装 */
export default function PlaceholderPage({
  title,
  subtitle,
  phase,
  icon,
}: {
  title: string
  subtitle: string
  phase: string
  icon: string
}) {
  return (
    <div className="mx-auto max-w-[1200px]">
      <PageHeader title={title} subtitle={subtitle} />
      <EmptyState
        icon={icon}
        title="该模块规划中"
        description={`按开发计划将于 ${phase} 实装，数据层与设计规范已就绪`}
      />
    </div>
  )
}
