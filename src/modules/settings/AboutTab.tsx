import { useState } from 'react'
import { Icon } from '@/design-system/Icon'
import { Section } from './settingsUi'
import { CHANGELOG_ENTRIES, LATEST_RELEASE } from './changelog'
import { APP_VERSION } from '@/shared/appInfo'
import { NOTE_PROSE_CSS, renderMarkdown } from '@/modules/notes/shared'

/**
 * 「关于」tab：应用版本 + 更新日志。
 *
 * 两个版本号刻意并列展示，别合并成一个：
 * - **应用版本** = `package.json` 的 version（原生壳产物名取自它，当前仍是 0.x）
 * - **最新发布** = CHANGELOG 里最新的已发布里程碑（git tag，如 v1.3.0）
 * 两者不同步是既定口径（AGENTS.md 第 7 节），页面上说清楚比让人以为「版本号错了」好。
 */
export function AboutTab() {
  // 默认展开最新已发布版本；没有已发布版本时退到第一条（通常是「未发布」）
  const [expanded, setExpanded] = useState<string | null>(
    LATEST_RELEASE?.version ?? CHANGELOG_ENTRIES[0]?.version ?? null,
  )

  return (
    <div className="anim-enter space-y-4">
      {/* 笔记模块的正文排版复用：更新日志本身就是 Markdown，不必再写一套 prose */}
      <style>{NOTE_PROSE_CSS}</style>

      <Section icon="info" title="版本信息">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="rounded-xl border border-outline-variant/40 px-4 py-3">
            <div className="text-[0.8214rem] text-on-surface-variant">应用版本</div>
            <div className="mt-0.5 text-[1.1429rem] font-semibold tabular-nums">{APP_VERSION}</div>
          </div>
          <div className="rounded-xl border border-outline-variant/40 px-4 py-3">
            <div className="text-[0.8214rem] text-on-surface-variant">最新发布</div>
            <div className="mt-0.5 text-[1.1429rem] font-semibold tabular-nums">
              {LATEST_RELEASE
                ? `${LATEST_RELEASE.version}${LATEST_RELEASE.date ? ` · ${LATEST_RELEASE.date}` : ''}`
                : '—'}
            </div>
          </div>
        </div>
      </Section>

      <Section icon="article" title="更新日志" desc="每个版本更新了什么，点版本行展开">
        {CHANGELOG_ENTRIES.length === 0 ? (
          <div className="py-6 text-center text-[0.9286rem] text-on-surface-variant">
            暂无更新日志
          </div>
        ) : (
          <div className="divide-y divide-outline-variant/40">
            {CHANGELOG_ENTRIES.map((entry) => {
              const open = expanded === entry.version
              return (
                <div key={entry.version}>
                  <button
                    className="flex w-full items-center gap-2 px-1 py-3 text-left"
                    aria-expanded={open}
                    onClick={() => setExpanded(open ? null : entry.version)}
                  >
                    <span className="shrink-0 text-[0.9643rem] font-semibold">{entry.version}</span>
                    {entry.isUnreleased && (
                      <span className="shrink-0 rounded bg-primary-fixed px-1.5 py-0.5 text-[0.7143rem] font-medium text-primary">
                        未发布
                      </span>
                    )}
                    {entry.title && (
                      <span className="truncate text-[0.8571rem] text-on-surface-variant">
                        {entry.title}
                      </span>
                    )}
                    {entry.date && (
                      <span className="ml-auto shrink-0 text-[0.8214rem] tabular-nums text-outline">
                        {entry.date}
                      </span>
                    )}
                    <Icon
                      name="keyboard_arrow_down"
                      className={`shrink-0 text-[1.2857rem] text-outline transition-transform duration-150 ${
                        open ? 'rotate-180' : ''
                      }`}
                    />
                  </button>

                  {open && (
                    <div className="pb-4">
                      {entry.body ? (
                        <div
                          className="note-prose pr-2"
                          dangerouslySetInnerHTML={{ __html: renderMarkdown(entry.body) }}
                        />
                      ) : (
                        <div className="px-1 text-[0.9286rem] text-on-surface-variant">
                          暂无更新内容
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </Section>
    </div>
  )
}
