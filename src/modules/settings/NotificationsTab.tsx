import { Section, Toggle } from './settingsUi'
import type { Settings } from '@/db/types'

/**
 * 「提醒与协同」tab（**自 SettingsPage.tsx 拆出** · 审计 C-7 · 2026-10-21）
 *
 * 拆分依据：8 个 tab 全部内联在 SettingsPage（曾 1648 行）；本 tab 只依赖
 * `settings` 与 `save` 两个入参，是最独立的一块。
 * 语义与拆分前逐行一致（仅移动代码 + 补齐 import）。
 */
export function NotificationsTab({
  settings,
  save,
}: {
  settings: Settings
  save: (patch: Partial<Settings>) => void
}) {
  return (
        <div className="anim-enter">
          <Section
            icon="notifications_active"
          title="通知推送与业务联动提醒"
          desc="开关即时持久化 · 本期仅存本地偏好，真实推送通道后续版本接入"
        >
          <div className="space-y-1">
            {(
              [
                {
                  key: 'desktopNotice',
                  title: '系统桌面弹窗通知',
                  desc: '当工作台切后台最小化时，通过系统 Notification API 发送横幅提示卡片',
                },
                {
                  key: 'soundAlerts',
                  title: '声音提示 (Sound Alerts)',
                  desc: '解锁奖杯、到期临门等重磅节点短促清晰提示',
                },
                {
                  key: 'webhook',
                  title: '企业微信 / 钉钉 Webhook 协同同步',
                  desc: '团队钉群机器人自动广播优先级看板更新与提醒完成消息',
                },
                {
                  key: 'dailyBrief',
                  title: '每日待办预告',
                  desc: '每天 09:00 依据事项清单草拟待办今日完成率简报',
                },
                {
                  key: 'todoDueWarning',
                  title: '任务逾期预警',
                  desc: '在待办事项临近截止前推送预警，避免项目节点延误',
                },
                {
                  key: 'habitReminder',
                  title: '打卡习惯晚间提醒',
                  desc: '入睡前温和提示今日自律习惯（阅读、代码复盘、健身）待打卡',
                },
                {
                  key: 'monthEndReconcile',
                  title: '月末流水对账与核算提醒',
                  desc: '每月最后 18:00 自动提醒核对当月流水与速算税额',
                },
                {
                  key: 'customerStaleAlert',
                  title: '客户久未跟进关键提醒',
                  desc: '当重要 VIP 客户超过 14 天无跟进记录，在工作台顶栏提示',
                },
              ] as const
            ).map((item) => (
              <div
                key={item.key}
                className="flex items-center gap-4 border-b border-outline-variant/20 py-3.5 last:border-0"
              >
                <div className="flex-1">
                  <div className="text-[0.9643rem] font-medium">{item.title}</div>
                  <div className="mt-0.5 text-[0.8214rem] text-on-surface-variant">{item.desc}</div>
                </div>
                <Toggle
                  checked={settings.notifications[item.key]}
                  onChange={(v) =>
                    save({ notifications: { ...settings.notifications, [item.key]: v } })
                  }
                />
              </div>
            ))}
            </div>
          </Section>
        </div>
  )
}
