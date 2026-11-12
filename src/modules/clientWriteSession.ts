import { clientSession, requireClientSession } from '@/storage/clientSession'
import { captureConnectionGuard } from '@/storage/connectionGuard'

/** 表单前置读取可能跨过切号边界，必须在首次 await 前固定这次输入的所属会话。 */
export function captureClientWriteSession(): () => void {
  const checkConnection = captureConnectionGuard()
  const session = clientSession()
  return () => {
    checkConnection()
    if (session) requireClientSession(session)
  }
}
