import { connectionEpoch, endpointBase } from '@/platform/endpoint'

/** 共享命令也需要防止旧异步输入续接；这里只依赖 endpoint，不把 Dexie 拖进服务端执行器。 */
export function captureConnectionGuard(): () => void {
  const epoch = connectionEpoch()
  const server = endpointBase()
  return () => {
    if (connectionEpoch() !== epoch || endpointBase() !== server)
      throw new Error('SESSION_CHANGED: 旧会话的输入不能写入当前账号')
  }
}
