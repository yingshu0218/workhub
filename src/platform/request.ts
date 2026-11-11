import { endpointFetch, connectionEpoch } from './endpoint'
import { getAuthToken } from '@/shared/authToken'
export class ClientRequestError extends Error {
  constructor(
    public code: string,
    message: string,
    public status = 0,
  ) {
    super(code + ': ' + message)
  }
}
export async function clientRequest(
  path: string,
  body?: unknown,
  headers: Record<string, string> = {},
): Promise<Record<string, unknown>> {
  const token = getAuthToken(),
    epoch = connectionEpoch()
  if (!token) throw new ClientRequestError('UNAUTHORIZED', '请先登录', 401)
  const response = await endpointFetch(path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      Authorization: token,
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...headers,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  const data = (await response.json()) as Record<string, unknown>
  if (epoch !== connectionEpoch()) throw new ClientRequestError('SESSION_CHANGED', '旧响应已丢弃')
  if (!response.ok) {
    if (response.status === 401 || response.status === 403 || response.status >= 500)
      window.dispatchEvent(
        new CustomEvent('workhub:auth-fault', { detail: { status: response.status } }),
      )
    throw new ClientRequestError(
      String(data.code || 'REQUEST_FAILED'),
      String(data.error || data.message || '请求失败'),
      response.status,
    )
  }
  return data
}
