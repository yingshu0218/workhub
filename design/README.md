# 寻鸽工作台 (Nexus Workspace) 设计资料

> 本目录收录全部设计资料：设计系统规范 + Stitch 高保真原型（每页 = `code.html` 静态原型 + `screen.png` 截图）。
>
> 原型共 21 页，原始导出时因 Stitch 数量限制被拆成两个文件夹，现已**合并为单一 `prototypes/` 目录**并按业务流程统一编号命名。

## 目录结构

```
design/
├── DESIGN.md       # 设计系统规范（唯一一份）
├── README.md       # 本文件：页面索引与设计要点
└── prototypes/     # 全部 21 页原型（code.html + screen.png）
```

## 页面索引

### 业务主流程（01-07）

| 目录 | 页面 | 说明 |
|---|---|---|
| `01-dashboard` | 工作台首页 | Focus Synchronizer：NOW DOING 焦点任务、25min 专注计时、今日日程、习惯闭环、速记便签 |
| `02-inspiration-flash` | 灵感闪现 | AI（规则）决策引擎全屏态：抽取下一件最值得推进的事，关联客户/款项/笔记上下文 |
| `03-finance-center` | 财务中心 | 多账本流水总览 + 凭证详情抽屉（¥185,000 二期款示例） |
| `04-finance-new-transaction` | 记一笔账 | 新建交易表单：归属账本、结算渠道、业务标签、凭证附件 |
| `05-finance-new-ledger` | 新建财务账本 | 账本名称、结算币种、期初金额、结账周期 |
| `06-habit-new` | 新建自律习惯 | 弹窗：周期频次、智能排程、跨模块联动开关 |
| `07-habit-matrix` | 习惯矩阵与稳态追踪 | 21 天稳态热力图、活跃习惯清单、连击统计 |

### CRM 模块（08-11）

| 目录 | 页面 | 说明 |
|---|---|---|
| `08-crm-list` | 活跃客户与线索总览 | 客户列表 + 新建客户档案抽屉（S/A/B 分层、健康指数） |
| `09-crm-canvas` | 客户关系画布 | 力导向图：客户/账单/待办/笔记节点关联，拖拽弹簧物理 |
| `10-crm-detail` | 客户智能管家 | 客户详情：健康指数、联系渠道、跨系统图谱、沟通日志 |
| `11-global-search` | 全局搜索 | ⌘K 命令面板：跨模块检索 + 快捷指令 |

### 笔记与成就（12, 16, 19, 21）

| 目录 | 页面 | 说明 |
|---|---|---|
| `12-team-notes` | 团队笔记 | Markdown 双栏编辑器：源码 + 实时预览，@提及 CRM 客户/待办/账本 |
| `16-trophy-hall` | 成就殿堂 · 荣誉中心 | 奖杯墙：已获得/未解锁/解锁进度条 |
| `19-dashboard-account` | 工作台 · 账号切换 | 工作区管理下拉面板（Owner/Collaborator/Personal） |
| `21-profile` | 个人主页 | Lv.248 敏捷大师阶、EXP 进度、奖杯收集统计、PSN 风格解锁弹窗 |

### 系统设置（13-15, 17-18, 20）

| 目录 | 页面 | 说明 |
|---|---|---|
| `13-settings-typography` | 设置 · 字体与排版 | 中文字体组合、字号、行高实时预览 |
| `14-settings-appearance` | 设置 · 外观显示模式 | 深浅模式、窗口与侧边栏外观、页面底色 |
| `15-settings-theme` | 设置 · 主题定制 | 品牌强调色、组件圆角风格、界面信息密度 |
| `17-settings-shortcuts` | 设置 · 通用与快捷键 | 通用偏好、全局高频热键映射 |
| `18-settings-notifications` | 设置 · 提醒与协同 | 通知推送通道、待办日程提醒、财务与 CRM 联动提醒 |
| `20-settings-data-security` | 设置 · 数据与安全 | 本地主权协议、JSON/CSV/Markdown 导出、导入迁移、IndexedDB 缓存、危险区 |

## 设计系统要点（详见 DESIGN.md）

- 主色 Team Blue `#004AC6`（container `#2563EB`），语义色：绿=财务正向、橙红=紧急
- 字体 Inter + 中文系统栈，基准 14px / 1.6 行高
- 4px 间距基线，卡片 8px 圆角 + 1px 边框 + 柔和阴影，Material Symbols 图标
- 演示角色统一「陈致远 · Core Team」，示例数据围绕「深蓝科技」

## 查看方式

每个页面目录下的 `code.html` 为 Tailwind CDN 静态原型，浏览器直接打开即可预览；`screen.png` 为对应成品截图。
