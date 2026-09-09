import { Component, type ErrorInfo, type ReactNode } from 'react'
import { Icon } from '@/design-system/Icon'
import { Button } from '@/design-system/ui'

interface ErrorBoundaryProps {
  children: ReactNode
}

interface ErrorBoundaryState {
  error: Error | null
}

/**
 * 页面级错误边界（审计 Phase 6 P2 追加项）：
 * 包裹 AppLayout 的页面出口，单模块渲染崩溃只降级当前页面，
 * 侧栏 / 顶栏 / 全局弹层（⌘K、奖杯弹窗）不受影响，不再整树白屏。
 */
export default class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[ErrorBoundary] 页面渲染崩溃', error, info.componentStack)
  }

  private reset = () => this.setState({ error: null })

  render() {
    if (this.state.error) {
      return (
        <div className="flex h-full min-h-[50vh] flex-col items-center justify-center gap-4 py-20 text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-xl bg-danger-container text-danger">
            <Icon name="warning" size={32} fill />
          </div>
          <div>
            <div className="text-[1.1429rem] font-semibold">模块出错了</div>
            <div className="mt-1 max-w-[420px] text-[0.8929rem] leading-relaxed text-on-surface-variant">
              当前页面渲染发生异常，其他模块不受影响。可尝试重新加载本模块。
            </div>
            <div className="mt-2 max-w-[520px] truncate rounded bg-surface-container px-3 py-1.5 text-[0.7857rem] text-outline">
              {this.state.error.message}
            </div>
          </div>
          <Button size="sm" variant="tonal" onClick={this.reset}>
            <span className="flex items-center gap-1.5">
              <Icon name="refresh" size={16} />
              重试
            </span>
          </Button>
        </div>
      )
    }
    return this.props.children
  }
}
