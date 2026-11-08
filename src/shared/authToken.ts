/**
 * 登录态存储键与读取口（2026-11-03 抽出）
 *
 * 为什么单独成文件：`AuthGate.tsx` 与「服务端唯一真源」写入适配器（`storage/serverFirst.ts`）
 * 都要读同一个 token，而后者若 import AuthGate 会把 React 组件树拖进存储层。
 * 键名与读写只允许这一份，别在别处再写字面量。
 *
 * ⚠️ 这里只有「页面会话」的凭据，**不是**同步账号（`settings.sync.*`）。
 * 服务端唯一真源模式下，PB 请求直接用这里的 token 鉴权。
 */

export const AUTH_TOKEN_KEY = 'workhub.auth.token'
export const AUTH_IDENTITY_KEY = 'workhub.auth.identity'
export const AUTH_USERID_KEY = 'workhub.auth.userid'

/** 读当前页面会话 token；隐私模式 / 未登录时返回空串 */
export function getAuthToken(): string {
  try {
    return localStorage.getItem(AUTH_TOKEN_KEY) ?? ''
  } catch {
    return ''
  }
}

/** 读当前登录标识（授权页显示「用哪个账户授权」；隐私模式 / 未登录时返回空串） */
export function getAuthIdentity(): string {
  try {
    return localStorage.getItem(AUTH_IDENTITY_KEY) ?? ''
  } catch {
    return ''
  }
}

/** 清空页面会话（登出 / token 失效） */
export function clearAuthSession(): void {
  try {
    localStorage.removeItem(AUTH_TOKEN_KEY)
    localStorage.removeItem(AUTH_IDENTITY_KEY)
    localStorage.removeItem(AUTH_USERID_KEY)
  } catch {
    /* 隐私模式下 localStorage 不可用时静默 */
  }
}
