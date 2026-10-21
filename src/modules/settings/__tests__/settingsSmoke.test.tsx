// @vitest-environment jsdom
/**
 * SettingsPage 渲染冒烟锁（审计 C-7 拆分前置 · 2026-10-21）
 *
 * ## 为什么先建这条锁，再拆文件
 *
 * `SettingsPage.tsx` 原为 1648 行、**8 个 tab 全部内联**，且**全仓零测试覆盖**（实测）。
 * 这种组合下做「拆分重构」是危险的：拆完 `tsc`/`lint`/全量测试都会全绿，
 * 但**某个 tab 白屏不会有任何信号** —— 正是本项目多次踩过的「测试全绿 ≠ 可用」。
 *
 * 故先建立本文件作为**拆分的安全网**：逐 tab 切换并断言「有实质内容渲染」，
 * 拆分前后都必须全绿。它是「行为未变」的可执行证据，而不是靠肉眼。
 *
 * 判据刻意用**宽松的内容存在性**（不是精确快照）——目的是抓「整块消失/抛错」，
 * 不是锁 UI 细节（细节会随设计迭代变化，锁太死会变成维护负担）。
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import 'fake-indexeddb/auto'
import { db } from '@/db/db'
import SettingsPage from '../SettingsPage'

/** 8 个 tab 的标签文本（**逐字取自 `SettingsPage.tsx` 的 `TABS` 常量，不凭印象**） */
const TABS: { label: string; marker: string }[] = [
  { label: '外观与主题', marker: '界面风格' },
  { label: '色彩与密度', marker: '圆角与信息密度' },
  { label: '字体与排版', marker: '字体组合' },
  { label: '通用与快捷键', marker: '通用偏好设定' },
  { label: '提醒与协同', marker: '通知推送与业务联动提醒' },
  { label: '云端同步', marker: '自托管同步服务' },
  { label: '数据与安全', marker: '数据导出与多格式打包' },
  { label: 'AI Agent 桥', marker: 'AI Agent 桥' },
]

beforeEach(async () => {
  await Promise.all(db.tables.map((t) => t.clear()))
})

describe('SettingsPage 冒烟：8 个 tab 都能渲染出实质内容', () => {
  it('默认进入「外观与主题」且有内容', async () => {
    render(
      <MemoryRouter>
        <SettingsPage />
      </MemoryRouter>,
    )
    // 设置页标题（PageHeader）应渲染
    await waitFor(() => {
      expect(document.body.textContent ?? '').toContain('外观与主题')
    })
    // 首屏有实质内容（不是空壳）：正文长度下限
    expect((document.body.textContent ?? '').length).toBeGreaterThan(80)
  })

  it('逐个 tab 切换均有实质内容渲染（无白屏、无抛错）', async () => {
    const user = userEvent.setup()
    render(
      <MemoryRouter>
        <SettingsPage />
      </MemoryRouter>,
    )
    // 等首屏就绪
    await waitFor(() => expect((document.body.textContent ?? '').length).toBeGreaterThan(80))

    const results: { tab: string; ok: boolean; detail: string }[] = []
    for (const { label, marker } of TABS) {
      // ⚠️ 同一 tab 名在页面里出现多次（导航按钮 + 内容区标题）→ 取第一个 button（左侧导航）。
      // 实测：queryByRole 会抛 "Found multiple elements"。
      const btn = screen.queryAllByRole('button', { name: label })[0]
      if (!btn) {
        results.push({ tab: label, ok: false, detail: '未找到导航按钮' })
        continue
      }
      await user.click(btn)
      /**
       * ★ 判据演进史（三轮，全部由变异校验逼出来 —— 值得留档）：
       * ① `body.textContent.includes(label)` → **假绿**：被导航按钮自身满足，删掉整个内容块也全绿。
       * ② `document.querySelector('.anim-enter')` 取第一个 → **仍假绿**：各 tab 是兄弟节点，
       *    条件为假时不留节点但其它 tab 的 `.anim-enter` 还在 DOM 里，取到的未必是本 tab。
       * ③ 现判据：断言**该 tab 独有的标记文本**在 DOM 中出现（取自各 tab 的 `Section title`）。
       *    这是「内容真的渲染出来了」的充分证据 —— 已用变异校验证实能抓回退。
       */
      const ok = await waitFor(
        () => {
          expect(document.body.textContent ?? '').toContain(marker)
          return true
        },
        { timeout: 3000 },
      )
        .then(() => true)
        .catch(() => false)
      results.push({ tab: label, ok, detail: ok ? marker : `缺标记文本「${marker}」` })
    }

    // 8 个 tab 全部可点且渲染非空
    const bad = results.filter((r) => !r.ok).map((r) => `${r.tab}：${r.detail}`)
    expect(bad).toEqual([])
    expect(results.length).toBe(TABS.length)
  })
})