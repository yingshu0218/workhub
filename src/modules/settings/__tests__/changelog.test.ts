import { describe, expect, it } from 'vitest'
import { CHANGELOG_ENTRIES, LATEST_RELEASE, parseChangelog } from '../changelog'

/**
 * 更新日志解析的边界锁。
 *
 * 页面的「更新日志」直接读仓库根目录 `CHANGELOG.md`（唯一事实源），
 * 解析一旦切错段，页面不会报错、只会**少一个版本或多一段记法约定** —— 属静默错误。
 */
describe('parseChangelog', () => {
  it('只收版本小节与「未发布」，跳过记法约定 / 更早等非版本章节', () => {
    const entries = parseChangelog(`# 更新日志

## 未发布

- 暂无

## v2.0.0 · 2026-12-01

**大版本**

- 变化一

---

## 更早（未打 tag · 2026-09-06 ~ 09-13）

- 老内容

## 记法约定

- 粒度：版本级
`)
    expect(entries.map((e) => e.version)).toEqual(['未发布', 'v2.0.0'])
    expect(entries[0].isUnreleased).toBe(true)
    expect(entries[1]).toMatchObject({
      version: 'v2.0.0',
      date: '2026-12-01',
      title: '大版本',
      isUnreleased: false,
    })
    expect(entries[1].body).toContain('变化一')
  })

  it('正文里的 ### 小标题不会切断版本段', () => {
    const [entry] = parseChangelog(`## v1.0.0 · 2026-09-14

### 子标题

- 仍然属于 v1.0.0
`)
    expect(entry.version).toBe('v1.0.0')
    expect(entry.body).toContain('### 子标题')
    expect(entry.body).toContain('仍然属于 v1.0.0')
  })

  it('真实 CHANGELOG：未发布在最前，最新已发布版本为 v1.3.0', () => {
    expect(CHANGELOG_ENTRIES[0]?.isUnreleased).toBe(true)
    expect(LATEST_RELEASE?.version).toBe('v1.3.0')
    expect(LATEST_RELEASE?.date).toBe('2026-10-28')
    expect(LATEST_RELEASE?.title).toBe('Android 客户端 + 平台化交付')
    expect(CHANGELOG_ENTRIES.some((e) => e.version === 'v1.0.0')).toBe(true)
    expect(CHANGELOG_ENTRIES.some((e) => e.version.includes('记法'))).toBe(false)
  })

  it('每个已发布版本都有日期（版本号与日期成对出现，页面不显示空列）', () => {
    for (const entry of CHANGELOG_ENTRIES.filter((e) => !e.isUnreleased)) {
      expect(entry.date, `${entry.version} 缺少日期`).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    }
  })
})
