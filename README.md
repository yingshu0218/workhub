# 寻鸽工作台 (Nexus Workspace)

> ⚠️ **本仓库当前处于开发阶段**：所有内容（设计资料、文档、代码）均在活跃迭代中，接口与结构可能随时调整，请勿用于生产环境。

## 仓库用途

本仓库是「寻鸽工作台」项目的**唯一主仓库**，集中管理：

- **设计资料**（`design/`）：21 页高保真原型 + 设计系统规范，作为开发实现的对齐基准
- **项目文档**（`docs/`）：开发计划、架构决策记录、**进度看板（`docs/PROGRESS.md`，实时状态以此为准）**
- **应用代码**（开发启动后新增）：Web 优先的单体应用

「寻鸽工作台」是一款面向个人/小团队的一体化数字工作台：CRM、财务、待办、笔记、习惯五大模块全链路闭环，外加游戏化成长体系（EXP 等级 / 奖杯收集）。

## 当前状态与终端路线

| 阶段 | 形态 | 状态 |
|---|---|---|
| 一（本期） | Web 浏览器优先（React + Vite + TS） | 🚧 开发中 |
| 二（过渡） | PWA（manifest + 基础 Service Worker） | 📋 已规划 |
| 三（终态） | Tauri 2 原生 App：Android / Windows / macOS | 📋 已规划 |

- **数据架构**：Local-First —— 本地 IndexedDB（Dexie）为离线读写源，自托管 PocketBase（自有云服务器）为数据真源，LWW（最后写入胜出）多端同步
- **明确原则**：浏览器本地数据是可丢弃的工作副本，清缓存/换设备登录即全量恢复；服务器数据才是持久真源

## 目录结构

```
├── design/                    # 设计资料
│   ├── DESIGN.md              # 设计系统规范（Team Blue #004AC6 / Inter / 4px 基线）
│   ├── README.md              # 21 页原型索引
│   └── prototypes/            # 01-dashboard ~ 21-profile（每页 code.html + screen.png）
├── docs/
│   └── 寻鸽工作台-开发计划.md  # 技术架构 / 数据模型 / Phase 0-7 排期 / 决策记录
└── README.md                  # 本文件
```

## 协作约定

- **进度文档（最高优先）**：[`docs/PROGRESS.md`](docs/PROGRESS.md) 是本仓库**唯一的进度事实来源**。任何开发变更（完成阶段/修复/部署/新增模块）必须在**同一个 commit** 里更新它的状态表格与「最后更新」时间。**保持它及时更新不是可选项**——它是所有人（包括 AI 开发代理）判断"现在做到哪了、接下来做什么"的唯一依据，文档滞后 = 进度失真 = 重复开发或漏做。审代码时先看它，动手前先读它
- **Changelog**：每次变更提交，必须在下方 Changelog 表格追加一行（序号 / 日期 / 变更摘要 / 提交人），序号按时间顺序递增，与代码提交同一次 commit 完成
- **提交署名**：统一使用 CNB 账号身份提交
- **设计对齐**：UI 实现以 `design/DESIGN.md` 与 `design/prototypes/` 截图为准

## Changelog

| 序号 | 日期 | 变更 | 提交人 |
|---|---|---|---|
| 1 | 2026-09-06 | 设计资料入库：21 页 Stitch 原型合并为单目录并语义化重命名（01-dashboard ~ 21-profile），补设计规范与页面索引 | yingshu0218 |
| 2 | 2026-09-06 | 开发计划补充多设备场景（2 人 × ≥4 端）适配约定：持久化存储申请 / 统计从源记录推导 / 同步绑定 workspace | yingshu0218 |
| 3 | 2026-09-06 | 定案终端路线三阶段：Web 优先 → PWA 过渡 → Tauri 2 原生三端；repository 层存储可插拔 | yingshu0218 |
| 4 | 2026-09-06 | 确立数据持久性模型：服务端为数据真源，本地 IndexedDB 为可丢弃离线工作副本 | yingshu0218 |
| 5 | 2026-09-06 | 定案存储演进路线：现用 Dexie/IndexedDB，条件触发时切 SQLite WASM；查询 Hook 抽象纳入 Phase 0 | yingshu0218 |
| 6 | 2026-09-06 | 重写根 README：仓库用途说明、开发阶段标识、Changelog 协作约定 | yingshu0218 |
| 7 | 2026-09-06 | Changelog 表格增加序号列 | yingshu0218 |
| 8 | 2026-09-06 | Phase 0 基建完成：Vite+React18+TS+Tailwind4 脚手架、设计 token 落地、Dexie 12 表 schema（含同步元数据）、repository/查询 Hook 存储抽象层、同步引擎骨架（LWW 队列+状态徽章）、布局壳与 12 条路由、持久化存储申请、原型演示种子数据、构建通过 | yingshu0218 |
| 9 | 2026-09-06 | 忽略并移除误提交的 tsbuildinfo 构建产物 | yingshu0218 |
| 10 | 2026-09-06 | Phase 1 完成：待办 CRUD（筛选/优先级/截止/关联客户）、NOW DOING 专注计时器（完成写入会话记录）、深度专注→习惯自动打卡联动、每日习惯闭环打卡与连击、速记便签转待办/归笔记、指标卡实时推导；浏览器端到端交互冒烟测试通过 | yingshu0218 |
| 11 | 2026-09-06 | 修复审计 P0×2 + P1×6（专注计时/编辑丢字段/打卡幂等/仓储事务/同步状态机/队列清理/抽象收口/墙钟计秒）；P2×9 挂起记录于审查报告 | yingshu0218 |
| 12 | 2026-09-06 | Phase 2 完成：财务中心（多账本 Tab、4 张汇总卡、流水筛选列表、记账抽屉含多附件 Blob、新建账本、凭证详情+业务溯源跳转、附件领域 Hook）；开发/校对双子 agent 工作流确立 | yingshu0218 |
| 13 | 2026-09-06 | Phase 3 完成：CRM（客户列表/四字段表单/详情页健康环形/沟通日志/d3-force 关系画布）；审计 P1×3 已修复（画布拖拽误跳转/日志双写原子化/客户级联删除） | yingshu0218 |
| 14 | 2026-09-06 | Phase 4+5 并行完成：团队笔记（CodeMirror+marked 双栏/@提及/双向链接）+ 习惯成就（月历热力图/奖杯引擎/PSN 弹窗/EXP 全推导）；审计 P1×4 已修复（DOMPurify/种子 id 口径/习惯级联删除/完成率周期口径）；审计报告见 docs/审查报告-Phase*.md | yingshu0218 |
| 15 | 2026-09-06 | Phase 6 完成：灵感闪现规则引擎（4 类候选权重推导+全屏决策态）、⌘K 全局搜索（5 实体投影）、系统设置 6 标签（settings 事务化+事件广播实时生效+深浅模式）；自主开发循环运行中，剩 Phase 7 | yingshu0218 |
| 16 | 2026-09-06 | Phase 7 完成：PocketBase 同步实装（原生 fetch 适配器/LWW/每表游标/墓碑清理/本地模式降级）、pb_setup 服务端套件、部署指南、PWA、代码分割；**v1 全部 8 个 Phase 开发完成** | yingshu0218 |
| 17 | 2026-09-06 | Phase 6 审计 P1×3 修复（灵感页回归壳/profile 入口/导出实装）；v1-验收清单.md 生成；待用户服务器部署后做 M6 同步验收 | yingshu0218 |
| 18 | 2026-09-07 | 修复同步 id 映射（哈希id+localId 唯一索引，PB 记录 id 合法性）；PocketBase 0.40.2 已部署至 8.153.19.221:9001（systemd/13 collections/同步账号/备份 cron），push-pull 全链路实测通过 | yingshu0218 |
| 19 | 2026-09-07 | M6 多端同步验收通过：全量推送 27 条落库、服务端记录拉取到新设备实测完成；v1 开发+验收闭环 | yingshu0218 |
| 20 | 2026-09-07 | 工作台补齐原型缺失的「今日待办日程」面板（TodayTodosCard），布局对齐原型 01；已部署验证 | yingshu0218 |
| 21 | 2026-09-07 | 待办页重构：左侧「清单」栏（今天/P1紧急/全部待办/已完成+实时计数）；图标字体 FOUC 修复（自托管+preload+block 显示，消除刷新时侧栏裸文本闪现） | yingshu0218 |
| 22 | 2026-09-07 | 图标字体加载门控：就绪前隐藏图标+宽度锁定，彻底消除刷新两阶段裸文本闪现 | yingshu0218 |
| 23 | 2026-09-07 | 刷新性能优化：Nginx 缓存头(immutable/gzip/SPA回退)+Inter 字体自托管，移除 Google Fonts 依赖；二次刷新资源全走本地缓存 | yingshu0218 |
| 24 | 2026-09-07 | 图标系统迁移内联 SVG：移除 4.6MB 图标字体与 FOUC 门控，新增 Icon 组件（87 图标+fill 变体），首次加载零大文件 | yingshu0218 |
| 25 | 2026-09-07 | 批次A：应用层+基建 P2 修复 13 项（ErrorBoundary/settings契约/危险区保护/导出完整化/事件补全/引擎并发/快捷键加固/搜索投影/CommandPalette/最长连击/奖杯海报/设置补齐） | yingshu0218 |
| 26 | 2026-09-07 | 批次B：财务+CRM+待办 P2 修复 17 项（金额校验/标签去重/交易分页/待对账toggle/负值示警/交易级联删除/transaction:created 接通/溯源带参/健康钳制/画布双击穿透+笔记节点/客户四步表单第4步关联初始化/阶段中文化/待办卡片口径/TodoPage ?new=1） | yingshu0218 |
| 27 | 2026-09-07 | 批次C：笔记+习惯+工作台+灵感 P2 修复 14 项（提及转义/代码块跳过/pagehide flush/删除竞态/徽章虚报/列表投影/直链loading/孤儿日志/月字文案/NOW DOING 关联引用卡/速记字符计数/稍后提醒真实调度/抽取池筛选+沉睡笔记候选） | yingshu0218 |
| 28 | 2026-09-07 | 清单系统上线：待办页左栏支持自定义清单（新建/重命名/删除/拖拽排序/待办归入），全链路同步实测通过；部署指南补 Schema 升级流程 | yingshu0218 |
| 29 | 2026-09-07 | 原型对齐批次：画布缩放控件/热力图稳态评语/下一里程碑卡/⌘K kbd 角标/笔记 Markdown 工具栏；PWA 补 192/512 PNG 图标 | yingshu0218 |
| 30 | 2026-09-07 | 同步机制完善：修复墓碑清理与 delete 推送竞态（tombstonePushed 标记）、推送侧接入 LWW 服务端校验、pb_hooks 新增墓碑盖戳钩子与每日 cron 清理、collections.json 13 表加 tombstonePushed 字段 | yingshu0218 |
| 30 | 2026-09-07 | 建立进度文档 docs/PROGRESS.md（阶段/里程碑/架构定案/待办全量快照+更新规则）；README 协作约定补进度文档维护要求（同 commit 更新，最高优先） | yingshu0218 |
| 31 | 2026-09-07 | 笔记模块 3 项增强/修复（Issue #4）：新增文件夹文件树体系（noteFolders 表 + notes.folderId，Dexie v6，PB collections 同步升级）、空文档首行 placeholder 撑高修复（改单行文案）、笔记列表进入只读查看态（?edit=1 显式编辑，新建笔记默认编辑）；PROGRESS.md / 部署指南同步更新 | cnb.cMPXRmKswEA |
| 32 | 2026-09-07 | 同步机制 P0 修复入库（Issue #2，PR #6）：P0-1 墓碑清理竞态修复 + P0-2 推送侧 LWW 服务端校验 + P1-3 服务端墓碑 cron；合并 main（笔记文件夹改动），解决 PROGRESS/部署指南冲突，Changelog 编号修正 | npc/CodeBuddy |
| 33 | 2026-09-07 | 风格主题体系升级（Issue #14）：8 套风格主题包（经典晴空/暖阳米白/森林薄荷/纸墨书卷/深海静谧/薄暮紫罗兰/玫瑰花园/碳黑极简，各含明暗双套变量）、强调色扩至 12 色、字体预设扩至 6 组 | npc/CodeBuddy |
| 33 | 2026-09-07 | 账本功能调整（Issue #9）：账本列表移至页面左侧树（对齐笔记页）并支持拖拽排序（Ledger 增 sortOrder，DB v7，同步/collections 同步扩展）；记一笔账的关联客户/关联待办改可输入模糊匹配 | npc/CodeBuddy |
| 33 | 2026-09-07 | 笔记模块 3 项交互修复（Issue #4 二轮验证反馈）：列表行固定行高不再随 hover 变化、tag/关联/文件夹等属性统一移到行尾、查看改为弹窗（背景虚化 + 居中卡片，卡片上编辑按钮跳转编辑视图，关闭/Esc 返回列表）；进度文档同步更新 | cnb.cMPXRmKswEA |
| 34 | 2026-09-07 | 风格主题扩充（Issue #14）：新增像素复古与 Q 版卡通两套风格主题包（各含明暗双套变量 + 推荐圆角），风格主题总数达 10 套 | npc/CodeBuddy |
| 35 | 2026-09-08 | 字体预设扩充（Issue #14）：字体组合 6 组 → 12 组，新增等宽极客/仿宋公文/飘逸草体/凌厉黑体/典丽宋体/元气圆黑；设置页字体网格自适应两列/三列布局 | npc/CodeBuddy |
| 36 | 2026-09-08 | Issue #14 审计修复：主题切换先清理旧 inline 变量再覆盖（防经典晴空/深浅互切残留污染）；楷体字体栈 `'serif'` 误引号修正为关键字 serif | npc/CodeBuddy(deepseek-v4-flash) |
| 37 | 2026-09-08 | Issue #14 复核补充：主题/字体类型单源化（THEME_STYLES as const satisfies 派生 ThemeStyleId，SettingsAppearance.theme 收窄）+ 主题 token 除 classic 外明暗两侧补齐 19 键 + gothic 字体栈移除不可命中的 'Source Han Sans SC Heavy' | npc/CodeBuddy(deepseek-v4-flash) |
| 38 | 2026-09-08 | Issue #11 客户三源统一时间轴：客户详情页沟通日志卡片重构为 interactions/transactions/todos 动态投影（无新表/无迁移），新增 /crm/:id/timeline 鱼骨时间线视图（共享 usePanZoom 缩放平移）；修复鱼骨待办/交易穿透（事件点补 recordId，/todo?focus= 与 /finance?focus= 深链定位 + 拖拽保护）；db/sync/schema 零侵入（PR #15） | npc/CodeBuddy |
| 39 | 2026-09-08 | Issue #11 收尾（PR #18）：合并 #15/#17 分叉，鱼骨时间线 P3 打磨落地——鱼头状态卡（tier 徽章 + HealthRing + 最近联系）、骨刺等距防重叠布局、fitView 适应画布、hover 浮层摘要（色系 Chip + 优先级 + 待对账）、过滤 chips 计数、骨刺拖拽保护；usePanZoom 收敛单源（画布/鱼骨页共用，移除 shared 副本与未用 svg） | npc/CodeBuddy |
| 40 | 2026-09-08 | Issue #19 新增同步服务配置说明（docs/同步服务配置说明.md）：人工操作分步手册，7 处关键步骤高亮（导入 collections / 建同步账号 / 保存并连接 / 全量推送 / 备份 cron / Schema 升级后全量推送 / 安全加固），附核对清单、故障排查与打印速查卡；审计修正：collections 口径对齐当前 17 张（16 业务表 + sync_state）、校验表名补全、noteFolders 无墓碑字段事实更正 | npc/CodeBuddy(deepseek-v4-flash) |
| 41 | 2026-09-08 | 部署指南标注环境阶段限定：8.153.19.221 为开发测试环境（正式上线非该服务器，需重新部署）；应用不硬编码服务器地址 | cnb.cMPXRmKswEA |
| 42 | 2026-09-08 | Issue #20 表单关联字段模糊输入匹配：财务抽屉私有 MatchCombobox 提升为 design-system 共享组件（含 fuzzyMatch/fuzzySort/archivedLast 工具与归档沉底），统一替换 8 处实体关联字段（TodoPage 清单/项目/客户、财务关联项目、项目挂靠客户、笔记所属项目、客户新建关联交易去 50 条截断、dashboard 专注卡选待办）；修复不存在图标 block→person_off、客户 label 统一「公司 · 姓名」、编辑态已完成待办回显 | npc/CodeBuddy(glm-5.3-flash) |
| 43 | 2026-09-08 | Issue #44 新建待办无反馈修复：TodoFormDrawer 新增 onSaved 回调，新建保存后若条目不在当前视图（默认「今天」仅显示当日截止项）则自动切换到「全部待办」，消除"保存成功但列表看不到"的错觉 | npc/CodeBuddy(glm-5.3-flash) |
| 44 | 2026-09-08 | Issue #34 客户亲密度体系落地：Customer.intimacy 手动 7 档（T1~T5 信任轴 + I6/I7 隔离态，隔离态降级留痕）+ 算法兜底 4 因子加权（手动最优先）；moduleConfigs 同步表（Dexie v9 + module_configs 集合）承载等级名称/黑名单屏蔽开关/算法权重阈值配置；设置页新增「数据管理」Tab；customer-only 图谱按亲密度档位渲染节点大小与图例、黑名单默认图谱隐藏 | npc/CodeBuddy(glm-5.3-flash) |
| 45 | 2026-09-08 | Issue #50 笔记关联体验升级：@提及浮层复用 fuzzyMatch/fuzzySort 模糊匹配（子串>子序列排序、sub 参与匹配、归档沉底）+ ↑↓/Enter 键盘导航 + 命中高亮；编辑态点击关联主体/反向链接改悬浮卡片就地看摘要（实体已删显示占位，「打开详情」保留深链跳转），查看态维持直接跳转 | npc/CodeBuddy(glm-5.3-flash) |
| 46 | 2026-09-08 | Issue #70 侧栏快速便签：左下角底部区块顶部折叠单行捕获，展开单行/多行输入（Enter 存、Esc/失焦收起、Shift+Enter 多行、mod+Enter 提交）；共享领域函数 saveQuickCapture 直接落正式 Note（title=正文首行截 30 字、markdown=全文、folderId=设置默认目录、mentions=extractMentions、自动 tag「速记」）；Settings.notes.defaultFolderId + DEFAULT_SETTINGS/mergeSettings/save 缺省合并；设置页「笔记偏好」下拉选默认目录 | npc/CodeBuddy(deepseek-v4-flash) |
| 47 | 2026-09-10 | 修复文件名大小写冲突：QuickCapture.tsx 重命名为 QuickCapturePanel.tsx（与 quickCapture.ts 在不区分大小写的文件系统上互相覆盖导致构建失败） | cnb.cMPXRmKswEA |
| 48 | 2026-09-10 | Issue #50 笔记 @提及浮层交互重构：浮层顶部新增可见模糊匹配输入框（@ 唤起后自动聚焦，筛选词从正文续写迁入框内，正文 @ 后不再承载筛选词），下方客户/待办/账本/项目四类横向 tab 统一为「点选即插入」同一交互；移除重复的 projectTab 联动锚点与 panelProject 割裂视图（所属项目选择保留在右侧栏 MatchCombobox 唯一入口）；保留 ↑↓/Enter 键盘导航、IME isComposing 守卫、Esc/外点关闭与 CodeMirror 焦点保护，关闭浮层自动归还焦点 | npc/CodeBuddy(glm-5.3-flash) |
| 49 | 2026-09-10 | Issue #54 主题风格体系：风格(skin)与配色解耦为独立持久化字段（settings.appearance.style + SKIN_STYLES none/pixel/cartoon/cyber/glass），先选风格再叠配色；设置页一级风格选择器（mini DOM 形态预览）+ 二级配色；皮肤层补导航 chrome（侧栏/页头/CRM 分组项语义化 app-sidebar/app-header/app-nav-link）与裸 Tailwind 面板穿透（--skin-shadow-dialog + [class~=] 双锚定兜底）；glass 深色弹窗 token 级对比度兜底、pixel 3px 描边贯穿、半径档全量 var(--radius-*)；收尾清重复通用档死代码 + 修 pixel 页头下边框 | npc/CodeBuddy(deepseek-v4-flash) |
| 50 | 2026-09-10 | 修复待办打勾完成不生效（Issue #74）：完成态改为「status + completedAt 成对写入」并收口为领域函数 `toggleTodoDone`（待办中心 / 工作台今日日程卡 / 灵感转待办三处入口统一），完成态同步合并改为本地优先（服务端 collections 缺字段导致旧值回拉覆盖时不再回滚完成状态）；`pb_setup/collections.json` todos 补 sortOrder 字段 | npc/CodeBuddy(deepseek-v4-flash) |
