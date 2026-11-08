// @vitest-environment jsdom
/**
 * 「关于」tab 渲染锁：版本号必须可见、更新日志必须真的展开。
 *
 * 只断言「文本在 DOM 里」会假绿（导航/标题都带版本号），
 * 所以这里同时验证折叠 → 展开的交互（点开旧版本后其正文出现）。
 */
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AboutTab } from '../AboutTab'
import { CHANGELOG_ENTRIES, LATEST_RELEASE } from '../changelog'
import { APP_VERSION } from '@/shared/appInfo'

afterEach(cleanup)

describe('AboutTab', () => {
  it('展示应用版本与最新发布版本', async () => {
    render(<AboutTab />)
    await waitFor(() => expect(screen.getByText('版本信息')).toBeTruthy())
    expect(screen.getByText(APP_VERSION)).toBeTruthy()
    expect(LATEST_RELEASE).not.toBeNull()
    expect(
      screen.getByText(`${LATEST_RELEASE!.version} · ${LATEST_RELEASE!.date}`),
    ).toBeTruthy()
  })

  it('默认展开最新版本，点击另一个版本后展开其更新内容', async () => {
    const user = userEvent.setup()
    render(<AboutTab />)

    // 默认展开：最新版本的摘要正文可见（v1.3.0 正文含「新增 Android 客户端」）
    await waitFor(() => expect(document.body.textContent).toContain('新增 Android 客户端'))

    // 找一个更早的已发布版本并点开
    const older = CHANGELOG_ENTRIES.find(
      (e) => !e.isUnreleased && e.version !== LATEST_RELEASE?.version && e.body,
    )
    expect(older).toBeTruthy()
    const row = screen.getByRole('button', { name: new RegExp(`^${older!.version}`) })
    await user.click(row)

    await waitFor(() => {
      // 展开态 aria-expanded=true，且该版本正文确实渲染（不只标题行）
      expect(row.getAttribute('aria-expanded')).toBe('true')
    })
  })
})
