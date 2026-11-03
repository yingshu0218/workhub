import { describe, expect, it } from 'vitest'
import { toLoginIdentity } from '@/shared/authIdentity'

/**
 * 登录标识归一化的行为锁（2026-11-03）
 *
 * 背景：PB 的 `users.passwordAuth.identityFields` 只有 email，页面/首启/同步登录
 * 三处必须同口径。此前同步登录漏了这层映射 → 桌面端接服务器时填「用户名」直接 400。
 */
describe('toLoginIdentity', () => {
  it('裸用户名补成占位邮箱（小写）', () => {
    expect(toLoginIdentity('gundam23')).toBe('gundam23@workhub.local')
    expect(toLoginIdentity('Alice')).toBe('alice@workhub.local')
  })

  it('真实邮箱原样保留（不动既有账号的大小写）', () => {
    expect(toLoginIdentity('Deploy@Nexus.local')).toBe('Deploy@Nexus.local')
  })

  it('首尾空白忽略；空输入返回空串', () => {
    expect(toLoginIdentity('  Bob  ')).toBe('bob@workhub.local')
    expect(toLoginIdentity('   ')).toBe('')
  })
})
