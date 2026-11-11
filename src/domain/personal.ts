import { getAuthToken } from '@/shared/authToken'

/** UI 与 Agent 使用同一个 PB 服务；这里仅负责 HTTP，不复制事实投影或变更计划。 */
export async function personalRequest(path: string, body: unknown, headers: Record<string, string> = {}): Promise<Record<string, unknown>> {
  const token = getAuthToken()
  if (!token) throw new Error('UNAUTHORIZED: 请先登录')
  const response = await fetch('/api/workhub/' + path, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: token, ...headers }, body: JSON.stringify(body) })
  const data = await response.json() as Record<string, unknown>
  if (!response.ok) throw new Error(String(data.error || '请求失败'))
  return data
}
export function queryPersonal(name: string, input: unknown = {}) { return personalRequest('personal/query', { name, input }) }
export function previewPersonal(kind: string, input: unknown, context: { requestId: string; generation: string }) { return personalRequest('personal/preview', { kind, input, ...context }) }
export function commitPersonal(context: { requestId: string; generation: string; previewId: string; planFingerprint: string }) { return personalRequest('personal/commit', context, { 'X-Workhub-Plan': context.planFingerprint }) }
export function cancelPersonal(context: {requestId:string;generation:string}) { return personalRequest('personal/cancel',context) }
