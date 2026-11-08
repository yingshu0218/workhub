import changelogRaw from '../../../CHANGELOG.md?raw'

/**
 * 更新日志解析（数据源 = 仓库根目录 `CHANGELOG.md`）。
 *
 * 为什么直接 `?raw` 引入而不是在前端再维护一份 JSON：
 * CHANGELOG 是本仓版本变更的**唯一事实源**（AGENTS.md 第 7 节），
 * 复制一份到 src 就会立刻出现「日志改了、页面没改」的漂移。
 *
 * 解析口径只认 `##` 二级标题里的两类小节：
 * - `## v1.3.0 · 2026-10-28`（项目里程碑版本，`version` / `date`）
 * - `## 未发布`
 * 文末的 `## 记法约定`、`## 更早（未打 tag …）` 不是版本，**不进入列表**。
 */
export interface ChangelogEntry {
  /** `v1.3.0` 或 `未发布` */
  version: string
  /** `2026-10-28`；未发布或无日期时为 null */
  date: string | null
  /** 版本小节里的第一行粗体摘要（如「Android 客户端 + 平台化交付」） */
  title: string | null
  /** 去掉标题行后的 Markdown 正文（可能为空） */
  body: string
  isUnreleased: boolean
}

const VERSION_RE = /^v\d+\.\d+\.\d+(?:[-+].*)?$/

/**
 * 纯函数：解析 changelog 文本。抽成独立函数是为了能用固定样例锁住边界
 * （标题行里有 `·`、正文里有 `---`、文末有非版本小节）。
 */
export function parseChangelog(md: string): ChangelogEntry[] {
  const sections: { label: string; lines: string[] }[] = []
  let current: { label: string; lines: string[] } | null = null

  for (const line of md.split(/\r?\n/)) {
    // 只认二级标题：`###` 是正文小标题，不能切段
    if (/^##\s+/.test(line) && !/^###/.test(line)) {
      current = { label: line.replace(/^##\s+/, '').trim(), lines: [] }
      sections.push(current)
      continue
    }
    current?.lines.push(line)
  }

  const entries: ChangelogEntry[] = []
  for (const { label, lines } of sections) {
    const [versionPart, datePart] = label.split('·').map((s) => s.trim())
    const isUnreleased = versionPart === '未发布'
    if (!isUnreleased && !VERSION_RE.test(versionPart)) continue

    let body = lines.join('\n').trim()
    let title: string | null = null

    // 首行粗体摘要单独提出来做行标题，避免在折叠状态下看不出这版做了什么
    const titleMatch = body.match(/^\*\*(.+?)\*\*\s*(?:\n|$)/)
    if (titleMatch) {
      title = titleMatch[1].trim()
      body = body.slice(titleMatch[0].length).trim()
    }

    entries.push({
      version: versionPart,
      date: isUnreleased ? null : datePart || null,
      title,
      body,
      isUnreleased,
    })
  }
  return entries
}

/** 构建期随包引入的完整更新日志（只读） */
export const CHANGELOG_ENTRIES: ChangelogEntry[] = parseChangelog(changelogRaw)

/** 最新一个已发布的里程碑版本（列表按文件顺序，未发布排在最前） */
export const LATEST_RELEASE: ChangelogEntry | null =
  CHANGELOG_ENTRIES.find((e) => !e.isUnreleased) ?? null
