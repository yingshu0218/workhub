import { useNavigate } from 'react-router-dom'
import { Button, EmptyState } from '@/design-system/ui'

/**
 * 404 兜底页（2026-10-14 修真实缺陷）：
 * 此前**没有 catch-all 路由** —— 地址敲错（例如把 `/module-config` 敲成 `/config`）不会落到应用里，
 * 而是直接命中 React Router 的**默认错误页**（英文大字 `Unexpected Application Error! 404 Not Found`），
 * 对中文用户既吓人又没有出路（连侧栏都没了，只能手动改地址）。
 *
 * 现在未知地址统一落到这里：仍在应用外壳内（侧栏照常可用），并给一条明确的返回路径。
 * ⚠️ 图标用已入库的 `search` —— `EmptyState` 的默认图标 `construction` 并不在
 * `src/assets/icons/`（默认值不会被 check:icons 扫到），用它会渲染成空白。
 */
export default function NotFoundPage() {
  const navigate = useNavigate()
  return (
    <div className="anim-enter mx-auto max-w-[1200px]">
      <EmptyState
        icon="search"
        title="页面不存在"
        description="地址可能输错了，或者这个入口已经调整过。"
      />
      <div className="mt-[-3rem] flex justify-center">
        <Button variant="ghost" icon="arrow_back" onClick={() => navigate('/')}>
          回到仪表盘
        </Button>
      </div>
    </div>
  )
}
