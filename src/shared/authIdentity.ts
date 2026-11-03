/**
 * 登录标识归一化（2026-11-03 抽出）
 *
 * 为什么要有这一层：PB 0.40 的 `users` 集合 `passwordAuth.identityFields` **只有 email**
 * —— 文本字段没有 UNIQUE 约束，加 username 必被拒。而用户习惯输「用户名」。
 * 于是约定：不含 `@` 的输入补成 `<小写>@workhub.local` 的占位邮箱，含 `@` 的原样保留。
 *
 * ⚠️ 这是**三处必须同口径**的规则：页面登录（AuthGate）、首启建号（setupRoutes）、
 * 同步登录（pocketbaseAdapter.login）。少一处就会出现「页面能登、同步登不上」这种
 * 最难查的形态。此前只在前两处实现，桌面端接服务器时同步登录用的仍是裸用户名 → 400。
 */

export function toLoginIdentity(raw: string): string {
  const v = String(raw ?? '').trim()
  if (!v) return ''
  // 含 @ 的真实邮箱原样保留，避免动到既有账号
  return v.includes('@') ? v : `${v.toLowerCase()}@workhub.local`
}
