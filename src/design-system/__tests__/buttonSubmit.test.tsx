// @vitest-environment jsdom
/**
 * Button 的 `type` 透传（2026-11-02）。
 *
 * 背景：认证表单原先各自写原生 `<button type="submit">`，理由是 Button 不透传 type。
 * 现在 Button 支持 type 后，三处表单统一回设计系统组件 —— 这条用例锁住「提交意图」，
 * 免得日后给 Button 补默认 `type="button"` 时把表单静默改坏。
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { FormEvent } from 'react'
import { Button } from '../ui'

afterEach(cleanup)

describe('Button type 透传', () => {
  it('type="submit" 能触发表单提交', () => {
    const onSubmit = vi.fn((e: FormEvent<HTMLFormElement>) => e.preventDefault())
    render(
      <form onSubmit={onSubmit}>
        <Button type="submit">提交</Button>
      </form>,
    )

    fireEvent.click(screen.getByRole('button', { name: '提交' }))
    expect(onSubmit).toHaveBeenCalledTimes(1)
  })
})
