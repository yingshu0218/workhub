# 寻鸽工作台 · 开发进度文档

> **本仓库的唯一进度事实来源。** 所有人（含 AI 开发代理）推进或变更任何开发工作，必须在**同一个 commit** 里同步更新本文件对应状态。README 底部的 Changelog 记录"发生了什么"，本文档记录"现在处于什么状态"——前者追加式流水，后者始终反映最新全貌。
**最后更新**：2026-09-10（Issue #86 功能配置页：业务模块规则配置从系统设置「数据管理」Tab 独立成 `/module-config` 页，注册表两级 `{ module, items }` 派生左栏模块 → 子菜单常显导航 + 右侧面板（子项路由可书签直达），系统设置改留指路牌并移除该 Tab；DataManagementTab 原样迁移为 CrmIntimacyConfig 业务逻辑零改写、moduleConfigs 同步表全不动；系统设置删「数据管理」Tab 8→7，导出/导入留在「数据与安全」零重叠；Issue #74 待办模块完整度修复：补齐 12 个缺失图标 + 图标完整性 CI 校验（npm run check:icons，接入 build 前置）、删除二次确认改应用风格 ConfirmDialog、打勾失败可见提示、列表行补归属副标题、接通逾期提醒开关、拖拽排序索引修正、doing 三态可达化、级联解绑含软删待办、移除死代码 assignTodoToList；Issue #74 待办打勾完成修复：完成态收口领域函数 `toggleTodoDone`（status + completedAt 成对写入，三处入口统一）+ 完成态同步合并本地优先（服务端缺字段回拉不再回滚完成状态）+ collections.json todos 补 sortOrder；Issue #54 主题风格体系：风格(skin)与配色解耦为独立持久化字段、先风格后配色；新增 glass/kid 风格包；皮肤层补齐导航 chrome（侧栏/页头/CRM 分组项语义化 .app-sidebar/.app-header/.app-nav-link）与裸 Tailwind 面板穿透；pixel 3px 描边贯穿、glass 深色弹窗对比度兜底、半径档全量走 var(--radius-*)；Issue #50 笔记 @提及浮层交互重构：顶部新增可见模糊匹配输入框（@ 唤起后自动聚焦，筛选词从正文迁入框内，正文 @ 后不再承载筛选词）+ 客户/待办/账本/项目四类横向 tab 统一「点选即插入」交互，移除重复 projectTab 锚点，所属项目选择收敛到右侧栏唯一入口；Issue #34 客户亲密度体系落地：Customer.intimacy 手动 7 档 + 算法兜底 + moduleConfigs 同步表 v9 + 设置页「数据管理」Tab + 图谱圈层/黑名单过滤；Issue #50 笔记关联体验升级：@提及浮层模糊匹配+键盘导航、编辑态关联主体/反向链接悬浮卡片；Issue #70 侧栏快速便签：左下角折叠单行捕获 → saveQuickCapture 落正式 Note，tag「速记」+ 默认目录，设置页「笔记偏好」选目录；Issue #101 服务端 Schema 补齐与部署实录：collections.json 为 noteFolders 补 tombstonePushed 字段与索引、补齐 customers.intimacy 字段定义；pb_hooks SYNC_COLLECTIONS 补 moduleConfigs/customerGroups；部署指南新增「服务端升级实录」7 步操作手册；Issue #107 新建表单改居中弹窗：新增 `design-system/ui.tsx` 的 `Modal`（size/elevated/响应式/Esc+遮罩，皮肤穿透 surface-card-dialog），确认与输入弹窗抬至 z-[60] 一处改动覆盖 9 个调用点，8 处表单抽屉迁移 Modal（凭证详情内编辑流水 elevated=z-[55]，形成 Detail z-50 → Form z-55 → Confirm z-60 三层），MatchCombobox 候选浮层改 portal 到 body（z-[70]）修复弹窗内裁切，新增 useAutoFocus 替代裸 autoFocus 修复打开表单页面跳滚，Drawer 保留给「参看」侧零改动；审计修复：useAutoFocus 感知 open 修复永不聚焦、useEscapeLayer Esc 栈逐层关闭、Combobox 浮层视口翻转） · 维护人：yingshu0218 / cnb.cMPXRmKswEA / npc/CodeBuddy

---

## 一、当前状态总览

| 项 | 状态 |
|---|---|
| 版本 | **v1 开发完成，已部署线上** |
| 线上地址 | http://8.153.19.221:9001（PocketBase 同域托管） |
| 里程碑 | M1-M6 全部验收 ✅ |
| 审计问题 | P0×2 / P1×19 / P2×60 **全部清零** |
| 同步机制完善 | P0-1 墓碑清理竞态修复 + P0-2 推送侧 LWW ✅（PR #6 评审中）；P1-3 服务端墓碑 cron ✅；P1-4 HTTPS（待用户操作） |
| Changelog | 第 59 条（README 底部） |

## 二、阶段进度（Phase 0-7）

| 阶段 | 内容 | 状态 |
|---|---|---|
| P0 | 基建：脚手架/设计 token/Dexie 数据层/同步骨架/布局壳 | ✅ |
| P1 | 待办 + 工作台（专注计时/NOW DOING/习惯闭环/速记便签） | ✅ |
| P2 | 财务中心（多账本/流水/记账/凭证溯源/附件） | ✅ |
| P3 | CRM（档案/智能管家/d3-force 关系画布 + Issue #11 三源统一时间轴投影 + 鱼骨时间线视图） | ✅ |
| P4 | 团队笔记（文件夹文件树 + CodeMirror+marked 双栏编辑/弹窗查看态/@提及/反向链接） | ✅ |
| P5 | 习惯 + 成就（热力图/奖杯引擎/EXP 推导/解锁弹窗） | ✅ |
| P6 | 灵感闪现规则引擎 + ⌘K 全局搜索 + 系统设置 | ✅ |
| P7 | PocketBase 同步实装 + 部署 + PWA + 代码分割 | ✅ |

## 三、里程碑验收状态

| 里程碑 | 交付物 | 验收 |
|---|---|---|
| M1 (P0-P1) | 布局壳 + 工作台 + 待办 | ✅ 专注计时→待办完成→指标卡实时更新 |
| M2 (P2) | 财务中心 | ✅ 记账→流水→凭证溯源跳转客户 |
| M3 (P3-P4) | CRM + 笔记 | ✅ 画布拖拽穿透、笔记 @客户双向链接、文件夹文件树 + 查看/编辑双态 + 列表固定行高/属性右置 + 弹窗查看（背景虚化，卡片编辑/关闭）（Issue #4 二轮反馈后）；Issue #11 客户详情页三源统一时间轴投影 + 鱼骨时间线视图（/crm/:id/timeline）+ 骨刺穿透深链定位 |
| M4 (P5) | 习惯 + 成就 | ✅ 打卡→EXP→奖杯解锁弹窗全链路 |
| M5 (P6-P7) | 灵感闪现 + 设置 + ⌘K | ✅ 权重引擎抽取、主题实时切换、全量导出 |
| M6 多端同步 | 离线写入 + 在线自动同步 | ✅ 推送 27 条落库、服务端记录拉取到新设备，实测通过 |

## 四、架构定案速览

- **终端路线**：Web 优先（当前）→ PWA 过渡（manifest+SW 已就绪，待 HTTPS 激活）→ Tauri 2 原生三端（Android/Win/mac）
- **数据**：本地 IndexedDB/Dexie 为读写源（可丢弃工作副本），服务端 PocketBase/SQLite 为**数据真源**，LWW 同步（updatedAt/deleted/rev + 变更队列）
- **存储抽象**：repository + 统一查询 Hook，组件零 Dexie 直连，未来可插拔换 SQLite
- **同步 Schema 升级**：模型演进必须重导入 `pb_setup/collections.json`（见 docs/部署指南.md「Schema 升级流程」章节）；服务端需升级至 17 collections（16 业务表 + sync_state；本地 Dexie v8）
- **图标**：内联 SVG（Icon 组件），已彻底移除 4.6MB 字体；新增图标往 `src/assets/icons/` 放 SVG
- **主题体系**：10 套风格主题包（`THEME_STYLES` as const satisfies 派生 `ThemeStyleId`，除 classic 外明暗两侧均完整 19 token）+ 12 强调色 + 12 字体预设（`FONT_PRESETS`/`FONT_STACKS` 定义于 shared/theme.ts；`SettingsAppearance.theme` 类型收窄为 `ThemeStyleId`；effects.ts 启动/切换先 removeProperty 清空 19 个 `--color-*` 再按侧覆盖，classic 空覆盖回退 index.css；字体仅映射 `--font-sans` 系统字体栈，不加载网络字体）

## 五、待办与挂起事项

### 需要用户操作（不阻塞开发）

| 事项 | 说明 |
|---|---|
| 绑定域名 + HTTPS | 激活 PWA 离线缓存/可安装、消除明文警告；绑好跑一次 certbot |
| 双端真机日常使用 | 手机+电脑配同步各一次，用几天验证 LWW/断网补传实际体验 |
| 服务端重导入 collections.json | 笔记文件夹上线需导入新表 noteFolders + notes.folderId 字段（Dexie v6）；Issue #34 亲密度配置新增 module_configs 集合 + customers.intimacy json 字段（Dexie v9，本地自动升版）；Issue #74 补 todos.sortOrder 字段（待办自定义顺序同步），见部署指南「Schema 升级流程」；完成后执行一次「全量推送」 |

### 待办事项打勾完成修复（Issue #74，已提 PR）

| 项 | 状态 |
|---|---|
| 根因 | 完成态由 `status` + `completedAt` 两字段表达，三个入口各自散写易漏字段；更关键的是**服务端 collections 缺字段时 PocketBase 静默丢弃**，本地「打勾完成」推送后服务端无 completedAt，随后远端记录以更新的 `updatedAt` 拉回整体覆盖本地，把 status 回滚成未完成（表现为「勾了又弹回去」） |
| 修复一：写入收口 | ✅ 新增领域函数 `src/modules/todo/toggle.ts` 的 `toggleTodoDone`：完成时 `status='done' + completedAt=now`，取消完成时 `status='todo' + completedAt 显式清空`；TodoPage / 工作台今日日程卡 / 灵感转待办三处入口统一调用 |
| 修复二：合并兜底 | ✅ `sync/pocketbaseAdapter.ts` mergeRemote 增加「待办完成态本地优先」：本地已完成而远端非完成时，保留本地 status/completedAt，仅合并远端其余字段（标题/描述编辑仍能同步），杜绝旧值回拉回滚完成态 |
| 修复三：Schema 补齐 | ✅ `pb_setup/collections.json` todos 补 `sortOrder` 字段（待办自定义顺序需跨设备同步） |
| 待人工 | ⚠️ 服务端需按「Schema 升级流程」重导入 collections.json 并执行一次「全量推送」（与既有 module_configs 待办合并为同一次操作） |

### 客户亲密度体系（Issue #34，已提 PR）

| 项 | 状态 |
|---|---|
| 数据模型 | ✅ Customer.intimacy?: { level: T1~T5/I6/I7, note?, updatedAt }（内嵌可选字段零迁移，tier 与 intimacy 语义正交互不读写）；算法最多推 T2、永不给出 T1/I6/I7 |
| 配置中心 | ✅ moduleConfigs 同步表（Dexie v9 + pb module_configs 集合，key 寻址 crm.intimacy）：等级名称/判据可编辑（key 固定）、黑名单屏蔽开关矩阵（默认只开图谱隐藏）、算法权重 30/30/20/20 + 切档阈值 85/70/50（归一化 + 单调校验） |
| 配置页 | ✅ Issue #86 独立成「功能配置」页 `/module-config`（左栏模块 → 子菜单，CRM·亲密度三配置区迁入 `src/modules/moduleConfig/CrmIntimacyConfig.tsx`）；系统设置移除「数据管理」Tab、改留指路牌；改动即时落库广播 moduleConfig:changed |
| 路径收敛 | ✅ 并行 PR（#90/#91 已合入主干、#92/#97/#98 待收敛）统一取 `/module-config`，目录 `module-config/` → `moduleConfig/`；避免合并顺序变化导致路由分裂，页面标题仍为「功能配置」（同 `/settings` 标题「系统设置」） |
| 消费链 | ✅ 客户详情亲密度选择器（隔离态降级留痕 note）、缩略卡亲密度徽章/备注、customer-only 图谱节点大小按档位（远近即大小）+ 亲密度图例、黑名单默认图谱隐藏；导出/恢复存档含 moduleConfigs |
| 待人工 | ⚠️ 服务端需重导入 collections.json（新增 module_configs 集合）+ 一次全量推送；⌘K/选择器/时间线黑名单屏蔽开关已留好口径，消费点接线为后续小增量 |

### 功能配置页（Issue #86，业务规则配置与系统设置切分）

| 项 | 状态 |
|---|---|
| 入口 | ✅ 侧栏「系统设置」上方并列新增「功能配置」（icon `tune`）；⌘K 快捷指令加一格「功能配置」 |
| 路由 | ✅ `/module-config/:moduleId/:itemId`（空路由/只给模块 → Navigate replace 补齐首个可用子项，子项可书签/⌘K 深链直达） |
| 页面结构 | ✅ 左栏模块分组 + 配置子菜单（二级）**常显**（不随模块数退化，复用 CRM/财务/笔记「max-w-[1200px] + 左列表 + 右内容」骨架）；注册表两级 `{ module, items }`，同模块新增配置域只加 items 不出重复条目 |
| 边界 | ✅ 功能配置 = 影响数据算出来结果的业务规则（写 moduleConfigs 同步表，多端一致）；系统设置 = 界面/通知/同步/导出等应用级偏好（写 settings singleton，不进同步） |
| 迁移 | ✅ `settings/DataManagementTab.tsx` → `moduleConfig/CrmIntimacyConfig.tsx`（git mv，逻辑零改写）；早期 `module-config/` 单层注册表版同期删除，以两级 `moduleConfig/registry.ts` 为准 |
| 复用 | ✅ 配置片段 `Section`/`Toggle` 抽到 `moduleConfig/parts.tsx`，供后续模块配置面板复用；配置逻辑零改写，仅容器外迁 |
| ⌘K 入口 | ✅ 快捷指令区单条「功能配置」入口（去重后不再重复两条）；无绑定快捷键的指令不渲染空 `kbd` 徽标 |

### CRM 客户时间线（Issue #11，已收尾）

| 项 | 状态 |
|---|---|
| P1 三源统一时间轴投影（timeline.ts + 详情页日志卡片重构） | ✅ 已合入 main（PR #15，R1/R2/R3 审计通过） |
| P2 客户时间线鱼骨视图（PR #17） | ✅ 已合入 main（R2 复核通过）；穿透深链（/todo?focus=、/finance?focus=）与拖拽保护已修复（907f03c） |
| P3 打磨 | ✅ 收尾 PR 落地：鱼头状态卡升级（tier 徽章 + HealthRing 健康环 + 最近联系）、骨刺等距防重叠布局、fitView「适应画布」、hover 浮层摘要（Chip 色系/优先级/待对账）、过滤 chips 计数、骨刺拖拽保护；usePanZoom 收敛单源（画布与鱼骨页共用 ./usePanZoom，移除 shared 副本） |
| 遗留提示 | 交易结算不刷新 lastContactAt（用户未拍板，可加一行事务内 update）；画布节点双击跳时间线入口未做（可后续小增量） |

### 表单关联字段模糊匹配（Issue #20，已提 PR）

| 项 | 状态 |
|---|---|
| 组件提升 | ✅ `MatchCombobox` 从财务抽屉私有实现提升为 `src/design-system/MatchCombobox.tsx` 共享组件（导出 MatchCombobox/MatchOption/fuzzyMatch/fuzzySort/archivedLast，复用 inputCls/Icon）；回显条支持点击重新展开候选；「不关联」图标由不存在的 block 改为 person_off |
| 落地范围 | ✅ 8 处实体关联字段：TodoPage 所属清单/所属项目/关联客户、财务抽屉关联项目、ProjectFormDrawer 挂靠客户、NoteEditorPage 所属项目（onChange 直写 moveNoteToProject）、CustomerFormDrawer 关联已有交易（去掉 slice(0,50) 截断）、dashboard 专注卡关联待办（空值用 placeholder 表达，onChange 逻辑不变） |
| 边界处理 | ✅ 归档项目 sub 标注「已归档」+ archivedLast 沉底；编辑态已选已完成待办单独并入 + sub「已完成」保证回显；客户 label 统一「公司 · 姓名」；枚举型/筛选器/账本归属等非实体关联字段保持 `<select>` |

### 同步机制完善（Issue #2，P0/P1 已实装待验收）

| 项 | 状态 |
|---|---|
| P0-1 墓碑清理与 delete 推送竞态 | ✅ tombstonePushed meta 标记：delete 推送成功才打标；cleanupTombstones 只清理带标记且超 30 天的墓碑，未推送的保留重试；确认推送的墓碑清理时对服务端同步物理删除 |
| P0-2 推送侧 LWW 服务端校验 | ✅ pbUpsert 查远端附带 updatedAt：远端更新且非墓碑 → 跳过推送（防旧数据迟到覆盖），由 pull 的 LWW 拉回新值 |
| P1-3 服务端墓碑定时清理 | ✅ pb_hooks 新增 tombstonePushed 盖戳钩子 + 每日 04:00 cron（清 tombstonePushed=1 且 updated 超 30 天的墓碑）；collections.json 13 张业务表加 tombstonePushed 字段（需重导入 Schema） |
| P1-4 HTTPS 部署补齐 PWA | ⏳ 需用户操作（绑域名 + certbot），代码无需改动 |
| PR #6 评审遗留（后续迭代，不阻塞合并） | ① pull 合并来的墓碑缺 tombstone_pushed 标记不会被本地清理；② delete 推送后立即物理删服务端记录，离线设备收敛窗口短——建议改为靠 cron 30 天清理 |

### Issue #11 后续提示

- 详情页双份查询（useCustomerTimeline + 独立 txn/todo hooks）当前量级可接受；鱼骨时间线页已单源消费，后续若再加视图请复用同一投影，避免多路拉取。
- 鱼骨穿透深链 focus 定位（/todo、/finance）已落地；TodoPage focus 消费基于 0ms 定时 + 渲染期 rowRefs，若未来改虚拟列表/懒加载需同步演进定位策略。

### 笔记关联体验升级（Issue #50，方案经 deepseek-v4-flash-version 审计）

| 项 | 状态 |
|---|---|
| 关联项目（右侧栏所属项目 MatchCombobox + Tab 联动） | ✅ 已合入 main（PR #53）；浮层内 projectTab 选择视图已移除（用户反馈与 @提及 Tab 视觉重复、交互割裂），所属项目选择收敛到右侧栏唯一入口 |
| PR-1 @提及浮层模糊匹配 + 键盘导航 | ✅ 已落地：复用 fuzzyMatch/fuzzySort/archivedLast（sub 仅参与匹配范围不参与排序）、归档项目沉底、↑↓/Enter 键盘选择、命中片段高亮、IME 期间不误触发；筛选词主输入迁移到浮层顶部可见输入框（自动聚焦），正文 @ 后不再续写筛选词，4 tab 统一交互 |
| 浮层交互重构（用户反馈，本轮） | ✅ 已落地：浮层顶部新增可见模糊匹配输入框（自动聚焦，筛选词迁出正文），下方客户/待办/账本/项目四类横向 tab 统一「点选即插入」交互；移除重复的 projectTab 联动锚点与 panelProject 割裂视图（所属项目选择保留右侧栏唯一入口）；保留键盘/IME/Esc/外点关闭与焦点保护，关闭自动归还 CodeMirror 焦点 |
| PR-2 编辑态关联主体/反向链接悬浮卡片 | ✅ 已落地：编辑态点击不再 navigate 就地弹卡（客户/待办/账本/项目摘要 + 反向链接标题/更新时间），卡片内「打开详情」走 jumpTarget 深链，实体已删显示占位；查看态保持直接跳转 |
| PR-3 账本/记账深链补全（A1） | ⏳ 待排期：jumpTarget.todo/ledger 补 focus 深链 + FinancePage ?ledger= 与 scope 双向同步 |
| A2 transaction 提及类型 | ⏸ 缓行（审计建议单独排期，动 NoteMention.type/MENTION_RE/TYPE_META 三处需同 commit 同步） |

### 侧栏快速便签（Issue #70，已提 PR）

| 项 | 状态 |
|---|---|
| 落库语义 | ✅ 每次保存直接 `noteRepo.put` 一条正式 Note（不做 QuickNote 暂存二次转化）：title=正文首行截 30 字、markdown=全文、folderId=设置默认目录（未设落未归档根层）、`mentions: extractMentions(content)`、自动打 tag「速记」（与 dashboard 卡片「速记归档」区分，两个入口可检索区分） |
| 共享领域函数 | ✅ `src/modules/notes/quickCapture.ts` 的 `saveQuickCapture({ content, folderId })` 收口建 Note 逻辑；后续 dashboard 卡片「归笔记」可迁移到它（顺带修不落 folderId 旧问题，非本 Issue 必做） |
| 侧栏 UI | ✅ `src/modules/notes/QuickCapture.tsx` 接入 `AppLayout.tsx` 底部 `border-t p-3` 区块顶部：折叠单行 → 点击展开单行输入，Enter 存、Esc/失焦收起、Shift+Enter 展开多行 textarea、mod+Enter 提交；保存即走，仅短暂提示「已记入 · 查看」跳转对应笔记，不内联历史 |
| 设置 | ✅ `Settings.notes.defaultFolderId?`（`SettingsNotes` 段）+ `DEFAULT_SETTINGS` 缺省 + `settingsRepo.mergeSettings/save` 三层合并补 notes 段；设置页「通用与快捷键」新增「笔记偏好」下拉选默认目录（NoteFolder + 未归档根层），实时生效 |

### 主题风格体系（Issue #54，方案/审计经 deepseek-v4-flash-version 与 glm-5.3-flash 交叉复核）

> 用户诉求：现有「主题」只是改配色，未真正换风格；正确顺序是**先换主题风格，再换配色**。参考图 1 童趣大圆角 / 图 2 少女玻璃拟态星闪 / 图 3 Sci-Fi 切角 HUD / 图 4 黑描边硬投影。

| 项 | 状态 |
|---|---|
| 风格与配色解耦（PR #56） | ✅ 已合入 main：新增 `settings.appearance.style` 独立持久化字段与 `SKIN_STYLES`（none/pixel/cartoon/cyber/glass）；设置页一级「界面风格」选择器（mini DOM 形态预览）+ 二级「配色主题」，两者自由组合互不污染；老用户 `style` 缺省回退主题 `recommendStyle`，视觉零突变 |
| 半径治理 | ✅ `--radius-sm/md/lg/xl/2xl/3xl` 全量档位联动，语义类圆角全引 `var(--radius-*)`；硬编码 `rounded-[10px]/[12px]` 清零；`--radius-card/--radius-xl-card` 死代码移除 |
| 皮肤穿透裸 Tailwind 面板（PR #56 补丁） | ✅ 新增 `--skin-shadow-dialog` 弹窗档 + `[class~=]` token 精确匹配兜底选择器（双锚定面板底 + rounded-xl/2xl/shadow-2xl），cyber 切角 / pixel 硬描边 / cartoon 贴纸 / glass 玻璃拟态可穿透 CommandPalette、TrophyUnlockToast、笔记弹窗、CustomerInfoCard 等裸面板；`none` 皮肤零新增规则 |
| glass 深色弹窗对比度 | ✅ token 级覆写 `:root.dark[data-skin='glass']` 的 `--skin-card-bg/--skin-input-bg` 至 80% 不透明度，一处覆写同时作用于语义类卡片、裸面板兜底段与输入框 |
| 导航 chrome 接入（PR #77） | ✅ `AppLayout` 侧栏/页头语义化（`.app-sidebar`/`.app-header`/`.app-nav-link`+`.is-active`，未复用 `.nav-item` 避免误伤页头搜索与设置页 Tab）；四套皮肤补导航项形态（pixel 直角硬描边硬投影 / cyber 霓虹光标等宽 / cartoon 胶囊粗描边 / glass 大圆角半透明胶囊）；CRM 左侧分组项挂 `app-nav-link` 复用；CRM 页 px 字号转 rem，全局 `text-[*px]` 清零 |
| 收尾修复（本次） | ✅ 删除 skins.css 与 index.css 重复的 `.surface-card-xl/.low` 通用档死代码；修 pixel 页头描边落空（`.app-header` 用 `border-b`，改设 `border-bottom-color`，与 sidebar 的 `border-right-color` 拆开）；补齐 PROGRESS/Changelog 留痕 |

### 新建表单改居中弹窗（Issue #107，方案经 glm-5.3-flash 审计 4 点并入）

| 项 | 状态 |
|---|---|
| 基础组件 | ✅ `design-system/ui.tsx` 新增 `Modal`：`size` md(`max-w-2xl`)/lg(`max-w-4xl`)/xl(预留) + `elevated` 分层 + 容器 `p-0 sm:p-6`、卡片 `h-full sm:h-auto rounded-none sm:rounded-2xl max-h-[100vh] sm:max-h-[90vh]`（窄屏全屏无圆角、桌面居中留边）+ Esc/遮罩关闭；复用 `surface-card-dialog` 皮肤穿透 |
| 层级收敛 | ✅ `ConfirmDialog`/`PromptDialog` z-50 → **z-[60]**（一处改动 9 个调用点全生效，确认框恒在 Modal 之上）；页面级 Modal 默认 z-50、弹窗内再开弹窗传 `elevated` → z-[55]；实例：凭证详情（z-50）→ 编辑流水（z-[55]）→ 删除确认（z-[60]）三层正确叠放 |
| 表单迁移 | ✅ 8 处：CustomerFormDrawer / LedgerFormDrawer / TransactionFormDrawer（elevated）/ HabitFormDrawer(md) / ProjectFormDrawer / TodoFormDrawer / CrmPage GroupEditorDrawer(md)；`Drawer` 保留不动（「参看」侧：TransactionDetailDrawer、笔记查看等） |
| Combobox 防裁切 | ✅ `MatchCombobox` 候选浮层改 `createPortal` 到 `document.body`，`z-[70]`；锚点按 `getBoundingClientRect` 定位并随 scroll(capture)/resize 重算；浮层内 mouse/pointer 事件 `stopPropagation`，防误触 Modal 遮罩关闭 |
| 焦点跳滚 | ✅ 新增 `useAutoFocus`（`focus({ preventScroll: true })`）替代裸 `autoFocus`，7 处表单首个输入框接入 |
| 零影响面 | ✅ 纯展示层：数据/同步/仓储零改动；8 个表单「渲染期重置」模式与容器无耦合，仅换外壳 |
| 未做（YAGNI） | ⏸ 全屏切换按钮、客户表单双列布局加分项（另立 commit/后续增量） |

### 未来项（已定但不急）

- Tauri 2 原生打包三端（repository 层已为 SQLite 预留）
- 灵感闪现接真 LLM（现为规则引擎，评分逻辑已模块化）
- 多工作区数据隔离、成员邀请流程
- 笔记多级子文件夹 / 拖拽移动（现为单层平铺 + 右键/行内移动）
- 笔记版本记录（轻量快照回滚）

## 六、更新规则（重要）

1. **同步时机**：任何改变"状态"的开发动作（完成一个阶段/修复一批问题/新增一个模块/部署变更），必须在**同一个 commit** 更新本文档对应表格与「最后更新」时间
2. **责任主体**：主 agent 与所有子 agent 都遵守；派工时 prompt 中必须包含本要求
3. **与 Changelog 的分工**：Changelog 只追加不修改（流水账），本文档原地更新（当前态快照）
4. **冲突处理**：若发现本文档与代码实际状态不符，以代码为准，并立即修正文档

---

*本文件由 yingshu0218 于 2026-09-07 建立。*
