# 寻鸽工作台 · 开发进度文档

> **本仓库的唯一进度事实来源。** 所有人（含 AI 开发代理）推进或变更任何开发工作，必须在**同一个 commit** 里同步更新本文件对应状态。README 底部的 Changelog 记录"发生了什么"，本文档记录"现在处于什么状态"——前者追加式流水，后者始终反映最新全貌。
**最后更新**：2026-09-11（Issue #148 补做主线需求：**「左侧改文本框 + 事项设置全部右移」落地** —— 上轮审计指出此前的 #149/#153/#155 只做了「正文首行推导标题」「四档优先级」「写入口径收口」，而 08:29 明确要求的「左侧位置全部改成文本框，事项设置的菜单全部移到右侧」被一路跳过。本轮只做布局、不动字段口径：① **待办表单拆左右两栏** —— 左栏只放正文 `textarea`（`sm:flex-1 sm:min-w-0`，高度 `h-44`→`sm:h-72`）真正把面积留给输入；右栏新增 `aria-label="事项设置"` 面板（`surface-card-low`，桌面 `sm:w-[17.5rem]`）收纳优先级/状态/截止时间/所属清单/所属项目/关联客户**全部六项**；`<640px` 自动 `flex-col` 回退单栏堆叠，旧「底部两列栅格」（`grid grid-cols-2`）整体移除。② **弹窗 `size="md"`→`"lg"`**（672px→896px）：不升档拆两栏后正文反而更窄，与「把面积留给文本」相悖。③ **优先级/状态改可输入模糊下拉**（`MatchCombobox`，与「所属清单」同一套控件，支持输入过滤/↑↓/Enter/Esc），优先级仍保留「档位 + 象限」双行候选示意与行动指引文案，不因换控件丢掉四象限语义；状态亦改下拉以与「设置项统一右栏」对齐，「作废即终止事项」提示保留。④ **测试同步**：`deriveTitle.test.tsx` ③ 组原断言锁的是**旧布局**（底部双列栅格），重构为锁新结构（右栏含六项 / 正文不在右栏内 / 分区容器 `flex-col sm:flex-row` / 旧 `grid-cols-2` 已消失），④ 组「四档按钮组」改「下拉候选」并补「状态同为可输入下拉」。测试 398 → **404**，`tsc -b` / `eslint src` / `check:icons` / `vite build` 全绿，详见 README Changelog 91）
**上一版**：2026-09-11（Issue #148 后续：**待办优先级 P1/P2/P3 三档升级为四档「重要 × 紧急」**——高=重要紧急 / 中=重要不紧急 / 低=不重要紧急 / 无=不重要不紧急。① 新增收口模块 `modules/todo/priority.ts`（档位元数据 + 象限示意 + 行动指引 + Chip 色板 + 权重 + 读侧 `normalizeTodoPriority` + 写侧 `todoPrioritySchema` + `isHighPriority`/`matchesPriorityFilter`），展示与判定全仓走它。② **存量数据与已分发 Agent 契约双兼容**：读侧 `P1→high / P2→mid / P3→low`、未知值兜底 `mid`；写侧 zod `transform` 在校验期归一化，Agent 仍可传旧档位；**不升级 Dexie、不改远端 collections**（新旧档位都是无 Dexie 分隔符的短枚举，同一个 `priority` 索引与自由 text 字段继续可用）。③ 表单四档按钮组（带象限副标题与行动指引）、列表筛选 Chip 四档化（原「P1 紧急」单档开关）、行内 Chip/勾选框红点/CRM·项目·时间线·工作台日程·笔记财务选择器·灵感引擎权重·悬浮卡共 9 处展示与判定收口。④ `npm run gen:skills` 重生成 `docs/skills/*`（`priority` 枚举含旧别名、默认 `mid`）。新增 `priority.test.ts` 11 条 + `deriveTitle.test.tsx` 3 条，测试 348 → **362**；lint / tsc / check:icons / test / build 全绿，详见 README Changelog 89）
**更早**（2026-09-11）：Issue #140 审计整改（P0 回归修复）：审计复核 main `e8ec9e6` 发现 v11 数组化漏改两处 P0 —— `db.ts` v11 删掉了 transactions 的 `projectId` 索引但 `modules/projects/hooks.ts` 仍有两处 `where('projectId')`：① `useProjectTransactions` 抛 SchemaError 被 `useQuery` 吞成空列表（项目详情账目 tab 永远空白，静默降级）；② `deleteProjectCascade` 级联中途抛错（项目已软删、流水解绑未执行）。修复：① hook 改内存过滤（`txnProjectIds(t).includes(projectId)`，与 `deleteCustomerCascade` 同款纪律）；② 解绑按表拆开——transactions 走 `toLinkFieldPatch('projectIds', …)` 数组解绑（写 `projectId: undefined` 既解不掉数组还留旧键），todos/notes/interactions 单值弱引用仍置 undefined。同批收口：`agent/reads.projectTransaction` 投影补 `customerId/projectId/todoId` 单值过渡别名（=数组首元素，只读不落库，输出侧向后兼容已分发 Agent 契约）；`mergeRemote` 本地编辑保护分支多关联收口与 LWW 分支写法对齐；核查 `todoIds` 悬挂——`todoRepo.softDelete`（UI 与 `todo_deleteTodo` 同源）不级联清 `transactions.todoIds`，与「删除不级联、弱引用悬挂由读取端过滤」语义一致，维持现状。新增测试 5 条，测试 315 → **320**，lint / tsc / check:icons / build 全绿，详见 README Changelog 86）

**Issue #140 整改前**（2026-09-11，Issue #130 客户关系三轮（两段修复收敛至 PR #141 源分支）：① **服务端 json 字段拉回后统一反序列化**——PocketBase json 字段收到字符串会原样再存一次，pull 回来的 `tags`/`relations`/`intimacy` 可能是 JSON 字符串/普通字符串，`mergeRemoteRecord` 正常 LWW 分支直接整体落库致 `tags.join`/`relations.map` 抛 TypeError → CRM 白屏、关系静默回滚；新增 `rawJsonFromRemote` + `toSafeArrayField` 任何分支落库前还原、数组兜底，空字段不覆盖本地（`hasJsonValue`）。② **提交路径不再依赖失焦事件**——`ChipTagInput` 固化改到敲下分隔符（中英文逗号）那一刻、移除全部 `onBlur` 提交，保存路径 `settleDrafts` 结算输入草稿；分隔符收窄为逗号避免含空格客户名被拆散。详见 README Changelog 82/83/84；2026-09-11（Issue #134 工作台首页布局重构（二轮视觉对齐已随本轮追加，详见下方「二轮补充」）：随记纳入待办收集箱 + 顶部指标保持。① 首页主网格由「左 1fr 主战场 + 右 360px 窄列」改为 12 列制 = 左 7 列（现在专注 + 今日待办日程）/ 右 5 列（每日习惯闭环 + 随手速记暂存便签），原 360px 固定窄列导致标题挤压、速记输入区过小；小屏退化为单列堆叠。② 「随手速记」升级为首页右下角的**收集箱入口**：常驻可拖高 `textarea`（rows=4，随列宽自适应）取代原「一行 input + Enter 提交」；`转入待办` / `归入团队笔记` 两个大按钮**常显**（旧版藏在条目 hover 内、且需「先入库再 hover 转换」两步）；⌘/Ctrl+Enter 直接转待办；底部保留暂存区列表（逐条一键处置）。③ 急记转入待办**统一落在「收集箱」**（`listId` 缺省，与待办中心「收集箱 = 无归属未完成」同口径），不带 `dueAt`（收集箱不催办，截止时间留给待办中心补），首行作标题（60 字）、多行全文入 `desc`。④ 处置链路收口新增领域模块 `src/modules/notes/quickCapture.ts`：`saveQuickCapture`（→ Note）/ `captureToTodo`（→ 待办收集箱）/ `captureToNote`（→ Note 打「速记归档」）/ `convertQuickNote`（已入库速记的处置 + 回写 `convertedTo`），消除原卡片内联手拼 Todo/Note 字段（漏 folderId/mentions/同步触发）与侧栏入口各写一份的漂移。⑤ 「今日待办日程」**已完成项移出首页**——`isDueToday` 已含未完成判定，打勾后即时消失；完成后的去向是待办中心「已完成」视图，首页空态改为「今日已达成 N 项」文案；顶部「待办达成 N/M」指标口径保持不变（未动）。新增 `quickCapture.flow.test.ts` 11 条，测试 213 → **224**，lint / tsc / check:icons / build 全绿。

**Issue #140（2026-09-11，财务记账表单）**： 财务记账表单 2 列分栏 + 关联多值芯片 + 悬浮摘要：① 数据模型方案 A 数组化 —— `Transaction.customerId/todoId/projectId` → `customerIds/todoIds/projectIds?: string[]`，Dexie **v11** `upgrade()` 把旧单值包数组并**清掉旧键**（双写不双读，真源唯一；旧键留着会被"双读 fallback"反复引用、迟早写漏一处），`db.ts` v11 注释明确记录**索引策略变更**：放弃 `where('customerId')` 索引改内存过滤 `(t.customerIds ?? []).includes(cid)`，理由是 `multiEntry` 与同步队列「整记录 put 覆盖 + rev 递增」语义存在兼容坑、本表数据量级小（个人工作台千级），代价是全表扫描，数据到万级需重新评估；② 读取口径收口新增 `src/modules/finance/links.ts`（`txnCustomerIds/txnTodoIds/txnProjectIds` 兼容旧单值 / `normalizeTxnLinks` 远端归一化并删旧键 / `toLinkField` 空数组不落键 / `pruneTxnLinkIds` 去重 + 过滤已删实体 id），10+ 处读取点全部改走它——数组化最大的风险不是写错了，而是**读取点太多、每处各写一遍 `?? []` 必然漏一处**；③ **远端 schema 同批带上**（审计审计出的静默丢数据雷）：`pb_setup/collections.json` transactions 补 `customerIds/todoIds/projectIds` 三个 `json` 字段（照抄 `tags` 先例）、`src/sync/mergeRemote.ts` 的 `JSON_ARRAY_FIELDS` 并入这三键，并在**两条合并分支**（本地未推送编辑保护 / LWW）统一「远端能解析成数组才覆盖，否则保留本地」——挡住「服务端集合未升级 → 远端无键 → 本地刚选的关联被整体覆盖清空」与「老客户端仍推旧键 → 另存一份」两条丢数据路径，旧键值就地折进数组；④ 交互层抽共享原子件：`design-system/EntityHoverCard`（从笔记 `NoteEditorPage` 的 `MentionEntitySummary` + hoverCard 抽离，`{type,id}` 入参，摘要口径复用 `crm/healthScore.resolveHealthScoreDisplay` 单一来源，**内容全走 React 文本节点、禁 dangerouslySetInnerHTML**——客户自由文本不进 HTML 注入面）与 `design-system/EntityLinkField`（`MatchCombobox` 联想 + **带实体 id** 的芯片数组，禁用自由文本固化否则悬浮卡查不到对象；**芯片 hover 150ms 弹摘要卡**、移入卡片取消关闭窗口、Esc / 点外关闭，已关联候选不再出现在下拉防重复选）；⑤ `TransactionFormDrawer` 按「能塞的塞 2 列、长字段整行」重排：类型 / 交易名称 / 业务标签 / 关联客户·项目·待办 / 备注 / 附件整行，归属账本·结算渠道与金额·记账时间成对；三个关联字段改多值芯片，保存前去重 + 过滤已删实体（弱引用纪律：解绑不报错）；「已完结待办回填」分支同步改数组版；⑥ 全量改动面 ≈13 处收口：`agent/reads`（投影改数组、`customerId` 入参按**数组包含**匹配，单值入参契约不破）、`agent/schema`（关联字段 zod 兼容层：单值自动包数组 + 旧键别名，**已分发的 AI 工具调用不会校验失败**）、`agent/executor`、`repositories`（`deleteCustomerCascade` 数组版只移除被删客户、其余关联保留；`linkTransactionId` 追加进数组）、`crm/hooks`（图谱建边与健康分因子投影按客户展开，一笔款分摊多客户时各视角都能看到）、`crm/timeline`（全局时间轴多关联逐客户展开事件，只回填首个会让另一方鱼骨锚点整段缺失）、`crm/CustomerFormDrawer`、`inspiration/engine`、`projects/ProjectsPage`、`domain`（记录入口）与 `db/seed`；⑦ 新增测试 13 条（`modules/finance/__tests__/txnLinks.test.ts` 10 条：旧单值读取 / JSON 字符串 / 归一化删旧键 / 服务端未升级不丢关联 / 老客户端旧键折进数组 / 级联只解绑该客户 / 唯一关联清空不留空键；`db/__tests__/migrateV11.test.ts` 4 条：单值包数组 / 空值不落键 / 幂等 / schema 版本 11；`design-system/__tests__/entityLinkField.test.tsx` 8 条 jsdom：多选与解绑 / 退格删末个 / **hover 150ms 前不弹** / 摘要字段 / 实体失效占位 / Esc 关闭），既有断言同步改数组口径，测试 235 → **256**，lint / tsc / test 全绿；`vitest.config.ts` 新增 `*.test.tsx` 收集，组件用例按文件头 `// @vitest-environment jsdom` 切环境、默认仍 node 跑纯数据逻辑）

**历史**：2026-09-10（Issue #134 工作台首页布局重构（二轮视觉对齐已随本轮追加，详见下方「二轮补充」）：随记纳入待办收集箱 + 顶部指标保持。① 首页主网格由「左 1fr 主战场 + 右 360px 窄列」改为 12 列制 = 左 7 列（现在专注 + 今日待办日程）/ 右 5 列（每日习惯闭环 + 随手速记暂存便签），原 360px 固定窄列导致标题挤压、速记输入区过小；小屏退化为单列堆叠。② 「随手速记」升级为首页右下角的**收集箱入口**：常驻可拖高 `textarea`（rows=4，随列宽自适应）取代原「一行 input + Enter 提交」；`转入待办` / `归入团队笔记` 两个大按钮**常显**（旧版藏在条目 hover 内、且需「先入库再 hover 转换」两步）；⌘/Ctrl+Enter 直接转待办；底部保留暂存区列表（逐条一键处置）。③ 急记转入待办**统一落在「收集箱」**（`listId` 缺省，与待办中心「收集箱 = 无归属未完成」同口径），不带 `dueAt`（收集箱不催办，截止时间留给待办中心补），首行作标题（60 字）、多行全文入 `desc`。④ 处置链路收口新增领域模块 `src/modules/notes/quickCapture.ts`：`saveQuickCapture`（→ Note）/ `captureToTodo`（→ 待办收集箱）/ `captureToNote`（→ Note 打「速记归档」）/ `convertQuickNote`（已入库速记的处置 + 回写 `convertedTo`），消除原卡片内联手拼 Todo/Note 字段（漏 folderId/mentions/同步触发）与侧栏入口各写一份的漂移。⑤ 「今日待办日程」**已完成项移出首页**——`isDueToday` 已含未完成判定，打勾后即时消失；完成后的去向是待办中心「已完成」视图，首页空态改为「今日已达成 N 项」文案；顶部「待办达成 N/M」指标口径保持不变（未动）。新增 `quickCapture.flow.test.ts` 11 条，测试 213 → **224**，lint / tsc / check:icons / build 全绿。

**二轮补充（2026-09-10，Issue #134 视觉对齐 · 追加在 PR #136 源分支）**：① **卡片拉满列高**——主网格与两列改 `lg:grid-rows-[auto_minmax(0,1fr)]` + 列内 `min-h-0`，速记文本框才真正「更大」（上一轮仅 `rows=4` 定死高度，「更大的文本框」这一条只达成一半）；小屏仍单列堆叠。② **随手速记**：暂存区可折叠（本机偏好存 `localStorage`，隐私模式自动降级为展开）、内联只展示最新 5 条、折叠态常显「N 待处置 + 最近 X 分钟前」、每条补捕获时间、头部加「N 条已归档 →」（按 tag「速记归档」统计）、去掉冗余的「或先存入暂存区」（转入待办本身已保留原始文本，操作面 3 → 2）、草稿与暂存条目按钮主次统一。③ **每日习惯闭环**：补顶部进度条 + 头部「N / M 完成」读数 + 已完成/未完成分组（完成时间 · 动机语 / 排期 · 计划分钟）+「N 天连胜」+ 底部「习惯统计洞察 →」出口。④ **今日待办日程**：出口抽成 `CardExitLink`、空态抽成 `EmptyState`（图标 + 主文案 + 副文案），统一四卡的收尾与空态。⑤ **速记处置来源留痕**：`convertQuickNote`/`captureToTodo`/`captureToNote` 增可选 `channel`（dashboard/sidebar），待办 desc 追加来源行、笔记 markdown 末行补 `> 由…转入团队笔记`（重复处置不叠加），`QuickNote` 增 `convertedAt`/`convertedVia` 业务字段（不进同步 schema），处置后补 `syncEngine.requestSync()`；此前两个入口处置同一条速记在库内不可区分，出问题无从回溯。测试 224 → **229**。

**最新（2026-09-11，Issue #130 客户关系三轮 · 根因定为「服务端 json 字段未反序列化」）**：用户反馈「多端同步以后再说，我现在只关注功能性」——即上一轮（#138 芯片标签输入）后客户关系仍不通。本轮不再从表单侧猜，而是按真实编码链路复现，找到**真正的功能性根因**：`mergeRemoteRecord` 的**正常 LWW 分支直接整体落库**，只对「有本地未推送编辑」分支做了数组归一化。而 PocketBase 的 json 字段收到字符串时会把它当 JSON 原样再存一次（`tools/types.JSONRaw.Scan` 对 string 走 `json.UnmarshalJSON`；`core.JSONField.PrepareValue` 对字符串再包引号），于是 pull 回来的同一字段可能是三种形态：① 真数组/对象 ② JSON 字符串 ③ 普通字符串。后果：`customer.tags` 落成字符串 → CRM 列表 `c.tags.join(' ')` / 详情 `customer.tags.map` 抛 `TypeError` → **CRM 页面整块白屏**；`relations` 落成字符串 → 关系静默回滚成空；`intimacy` 落成字符串 → 亲密度档位丢失。修复：① 新增 `rawJsonFromRemote`（真值原样 / JSON 字符串解析 / 双层编码再剥一层 / 普通字符串不破坏 / 空值不误判）与 `toSafeArrayField`（数组型字段兜底，非数组降级为单元素数组，保证前端 `.map`/`.join` 永不抛错），`mergeRemoteRecord` 在任何分支落库前先还原 customers 的 json 字段；② 分支内「远端字段是否有值」统一改走 `hasJsonValue`，空字符串/null 不再覆盖本地已有关系。新增 `sync/__tests__/mergeJsonFieldRevive.test.ts` 12 条（含按 PB `PrepareValue` 编码规则逐条模拟的 push→pull 往返），测试 235 → **247**，tsc / lint / check:icons / build 全绿。

**历史**：2026-09-10（Issue #130 客户关系保存不生效与时间线视图空白修复：① 同步 pull 合并新增「本地未推送编辑保护」——队列中仍有该记录 upsert 时远端记录不得整体覆盖本地（原实现只比 updatedAt，服务端旧值会把刚落库的 relations 抹掉），customers 的 json 数组字段统一收口为「relations 按条目 id 取并集 / 其余数组字段本地有值时保留本地 / 统一归一化兼容服务端返回 JSON 字符串」；合并逻辑抽成 `src/sync/mergeRemote.ts`（纯数据逻辑可单测，附件 Blob 下载以回调注入）并补 7 条回归测试（含用户操作序列端到端核验）；② 时间线鱼骨视图自动「适应画布」——按「客户 + 筛选 + 容器尺寸」重新 fit（世界范围改按真实骨刺推导，不再写死 minY/maxY），悬停热区改透明矩形承接指针消除高亮抖动；③ 跨标签页同步排他锁（Web Locks，不可用自动降级）+ 切回前台立即对齐。同批修复抽模块引发的两处回归：pull 附件 Blob 还原未随合并逻辑搬迁（其他设备上传的附件拉回后 blob 为空）、本地编辑保护分支直接展开远端字段（JSON 字符串写回本地致前端 `.map` 抛错 + 数组内部条目被整体覆盖）。main 的 Issue #128 终态本地优先（完成/作废 + 对应时间戳成对保留）语义已随合并同步进 `mergeRemote.ts`。 Issue #132 新建客户支持关联客户：`CustomerFormDrawer` 的「关联客户」维护区原仅在编辑态渲染（`{customer && ...}`），新建档案时整块隐藏，导致新客户无法在创建时建立客户间语义关系。改为新建/编辑共用同一区块（`relations` 状态与「添加关联/逐条移除/同 目标+语义 判重/归类着色」逻辑零改动），新建分支把 `relations` 随记录一并落库（`createCustomerWithInit` 原样承载，仅在有值时写入可选字段）；新建态候选自然不含自身、编辑态仍以 id 显式排除；表单步骤编号顺延为 1 基础 /2 分层 /3 联系 /4 关联客户 /5 跨模块初始化。数据模型/同步/schema 零改动。 Issue #33 AI Agent 调用能力 agentOps P1：第 1 步复审核验 + 第 3 步消解器交付。① `fuzzyMatch`/`fuzzySort`/`archivedLast` 从 `design-system/MatchCombobox` 提升到 `shared/search`（`MatchCombobox` re-export 兼容，既有 5 个使用方与全仓唯一外部调用点 `NoteEditorPage` 零改动），消除 shared ↔ design-system 反向依赖；② Project 归档映射收口为 `shared/search.ts` 的 `isProjectArchived`/`toArchivedFlag`，4 处内联 `archived: p.status === 'archived'`（NoteEditorPage ×2 / TransactionFormDrawer / TodoPage）改走收口函数并补对照断言；③ 能力白名单落 `settings.ai` 段（新增 `SettingsAi`/`AiDomain` 类型 + `mergeSettings`/`settingsRepo.save` 分段合并同步扩展，settings 不在 SYNC_TABLES 故不进同步队列），闸门 `visibleToolNames`/`listVisibleTools`/`dispatchAgentTool` 在分发层实施「白名单外工具对桥不可见且调用被拒」；④ 新增消解器 `src/agent/resolver.ts` 与读工具 `resolveEntity`，落实「只取活记录 / 按 id 去重后数唯一 / 去重唯一才静默消解 / 命中超阈值反问 / 空输入前置拦截 / Project 归档沉底」六条纪律；新增 `resolver.test.ts`（8 条）+ `whitelist.test.ts`（5 条），agentOps 测试 21 → 34 条全绿。Issue #108 健康分展示口径统一（审计整改）：未手动设置档位时不再显示「未设置」——各页面统一走新增的 `crm/healthScore.ts` `resolveHealthScoreDisplay`，算法推断档位用**括号**包裹并标来源（如 `T2 信赖（算法）`），手动档位原样显示。落地 CRM 列表行 / 时间线鱼骨鱼头徽章 / 图谱缩略卡 / 笔记 @提及悬浮摘要 4 处；新增 `useCustomerScoreRows` 批次查询（走 customerId 索引，只算未手动设置档位的客户）与 `buildScoreInputFromRows` 纯函数，算法入参口径与图谱侧 `buildScoreInput` 完全一致。同批清理审计文档债：`pb_setup/collections.json` 删已废弃 `customers.healthScore` 字段、部署指南核对清单与升级实录同步、agent-bridge 文档移除 `crm_createCustomer.healthScore` 入参（改指 `intimacy`）、开发计划文档加「字段以 PROGRESS 为准」声明；Issue #108 客户详情页信息架构优化 P1+P2（第二增量）：详情页重构为「身份条 → 行动区 → 概览区 → 明细区」四段式，落实「概览给数字，明细给记录」。①身份条：档案头与健康分档位合并一卡，联系方式（手机/企微/邮箱）由原「即时通讯与联系渠道」3 卡整体迁入「资料」Tab 成列（保留复制能力，CopyChip），身份条仅留姓名/分层/公司职位/最近联系/建档摘要；决策层级/地址/标签/客户关系等全量属性唯一出处为「资料」Tab；②行动区（新增）：快速记一笔常驻 + 待跟进事项（进行中待办 Top4）/ 待对账款项（Top4）两栏，首屏即给下一步动作；③概览区（新增）：资金往来收支合计、名下项目数、沟通次数（近 7 天）、关联笔记数 4 张数字卡，点击下钻对应 Tab；④明细区（Tabs）：时间轴（沿用统一时间轴与「全部/沟通/财务/事件」筛选，默认沟通）/ 资金（完整流水表：日期/摘要/渠道/对账状态/金额）/ 项目（名下项目：色点/名称/预算/状态）/ 资料（档案属性 9 行 + 关联笔记，经 notes.mentions 反查，与图谱投影同口径）；⑤原「关联业务」3 卡（关联交易/名下项目/关联待办）拆解去重，数字进概览、记录进 Tab，消除与时间轴的一屏双份；⑥迷你关系图谱由常驻装饰 SVG 改为一行折叠入口（保留交易/待办计数 + 展开全屏图谱链接）。改动仅限 `CustomerDetailPage.tsx` 展示层，未触碰数据模型/同步引擎/`timeline.ts` 共享模块；关联笔记复用 `useCollection('notes')` 全表过滤（与 `useCanvasGraph` 同口径，笔记量级小）。Issue #108 客户详情页信息架构优化 P0：亲密度全局改名「健康分」（UI 文案/功能配置页/图谱图例，数据结构与算法零改动）；移除原 0-100 手动健康指数 healthScore（详情页环形、列表分数条、图谱缩略卡、鱼骨鱼头、灵感引擎上下文、笔记关联卡、CSV 导出、编辑表单滑杆全部摘除；Dexie 非索引字段直接删类型，存量残留无害零迁移）；时间轴待办 created/done 双事件合并单事件（推翻 Issue #11 决议并更新 timeline.ts 注释，锚点=已完成取 completedAt / 进行中取 createdAt，详情页+鱼骨+全部时间线三处待办事件点减半）；详情页时间轴默认筛选改「沟通」（TIMELINE_FILTERS 共享模块未动，只改详情页 useState 默认值，时间线页默认行为不变）；详情页页头删口号副标题、标题改客户名。模块内部代码标识（intimacy 目录/IntimacyPicker/useIntimacyConfig）保留不动；Issue #86 功能配置页：业务模块规则配置从系统设置「数据管理」Tab 独立成 `/module-config` 页，注册表两级 `{ module, items }` 派生左栏模块 → 子菜单常显导航 + 右侧面板（子项路由可书签直达），系统设置改留指路牌并移除该 Tab；DataManagementTab 原样迁移为 CrmIntimacyConfig 业务逻辑零改写、moduleConfigs 同步表全不动；系统设置删「数据管理」Tab 8→7，导出/导入留在「数据与安全」零重叠；Issue #74 待办模块完整度修复：补齐 12 个缺失图标 + 图标完整性 CI 校验（npm run check:icons，接入 build 前置）、删除二次确认改应用风格 ConfirmDialog、打勾失败可见提示、列表行补归属副标题、接通逾期提醒开关、拖拽排序索引修正、doing 三态可达化、级联解绑含软删待办、移除死代码 assignTodoToList；Issue #74 待办打勾完成修复：完成态收口领域函数 `toggleTodoDone`（status + completedAt 成对写入，三处入口统一）+ 完成态同步合并本地优先（服务端缺字段回拉不再回滚完成状态）+ collections.json todos 补 sortOrder；Issue #54 主题风格体系：风格(skin)与配色解耦为独立持久化字段、先风格后配色；新增 glass/kid 风格包；皮肤层补齐导航 chrome（侧栏/页头/CRM 分组项语义化 .app-sidebar/.app-header/.app-nav-link）与裸 Tailwind 面板穿透；pixel 3px 描边贯穿、glass 深色弹窗对比度兜底、半径档全量走 var(--radius-*)；Issue #50 笔记 @提及浮层交互重构：顶部新增可见模糊匹配输入框（@ 唤起后自动聚焦，筛选词从正文迁入框内，正文 @ 后不再承载筛选词）+ 客户/待办/账本/项目四类横向 tab 统一「点选即插入」交互，移除重复 projectTab 锚点，所属项目选择收敛到右侧栏唯一入口；Issue #34 客户亲密度体系落地：Customer.intimacy 手动 7 档 + 算法兜底 + moduleConfigs 同步表 v9 + 设置页「数据管理」Tab + 图谱圈层/黑名单过滤；Issue #50 笔记关联体验升级：@提及浮层模糊匹配+键盘导航、编辑态关联主体/反向链接悬浮卡片；Issue #70 侧栏快速便签：左下角折叠单行捕获 → saveQuickCapture 落正式 Note，tag「速记」+ 默认目录，设置页「笔记偏好」选目录；Issue #101 服务端 Schema 补齐与部署实录：collections.json 为 noteFolders 补 tombstonePushed 字段与索引、补齐 customers.intimacy 字段定义；pb_hooks SYNC_COLLECTIONS 补 moduleConfigs/customerGroups；部署指南新增「服务端升级实录」7 步操作手册；Issue #107 新建表单改居中弹窗：新增 `design-system/ui.tsx` 的 `Modal`（size/elevated/响应式/Esc+遮罩，皮肤穿透 surface-card-dialog），确认与输入弹窗抬至 z-[60] 一处改动覆盖 9 个调用点，8 处表单抽屉迁移 Modal（凭证详情内编辑流水 elevated=z-[55]，形成 Detail z-50 → Form z-55 → Confirm z-60 三层），MatchCombobox 候选浮层改 portal 到 body（z-[70]）修复弹窗内裁切，新增 useAutoFocus 替代裸 autoFocus 修复打开表单页面跳滚，Drawer 保留给「参看」侧零改动）；Issue #107 弹窗审计修复（PR #109 评审项）：useAutoFocus 感知 open 修复永不聚焦（7 处调用点传 open）、新增 useEscapeLayer 打开栈实现 Esc 逐层关闭（Modal/Drawer/ConfirmDialog/PromptDialog 全部接入；Issue #128 待办三态 + 侧栏选中修复：侧栏 `NavLink` 前缀匹配导致离开后色块仍高亮，新增 `AppLayout.isNavItemActive` 统一判定（`/` 精确、`/crm`·`/projects`·`/module-config` 按段、其余精确）；待办状态两态扩三态 `todo|done|voided` + `voidedAt`（与 `completedAt` 互斥成对写），领域层 `isTodoDone`/`isTodoVoided`/`isTodoFinished` 收口；待办中心新增「已完成」「已作废」菜单、移除「已完成」筛选 Chip、「全部待办」严格只装未完成；新增「作废/恢复」一等交互（区别于删除：不删记录、可恢复、不催办不计完成率）；跨模块口径对齐（工作台/CRM 健康分/项目详情/清单计数/⌘K/消解器/时间轴/同步适配器），`collections.json` todos 补 `voidedAt`；新增 17 条测试）

（Issue #33 AI Agent 调用能力 agentOps **P1 收尾 + P2 动作扩面**：① P1 四处「测试全绿但真实用法走不通」的缺口修复——relay 新增内置 MCP 工具 `confirm_preview`（中高风险操作「预览 → 取票 → 执行」的取票入口；此前票据只能由 relay 签发而 Agent 无从取票，非 `--dev` 下确认流程物理上走不通，确认闸门退化成「永远执行不了」）、分发层判定顺序改为「先判注册再判白名单」（未注册工具此前回「不在白名单内（域：未知）」，Agent 会误判为权限不足而反复重试）、`RiskLevel` 扩为 `low/medium/high` 三档（删除类为 high，预览标 `irreversible`、执行返回 `sideEffects` 受影响记录数）、默认账本唯一性收口为 `repositories.clearOtherDefaultLedgers(keepId?)`（UI 与 AI 此前各写一份，漂移出「双默认账本」会让记账静默挂到不确定账本）；② 新增**领域命令层 `src/domain/`**——`normalizeOccurredAt`/`resolveDefaultLedgerId`/`recordTransaction`/`createLedger` 为 UI 与 AI 的**共同实现体**，消除「记账时间口径 / 缺省账本策略」两份内联拼接（§7.1 要求 AI 记账与手工记账逐字段一致，两份实现下只能靠巧合成立），`fin_recordTransaction` 的 `ledgerId` 随之由必填改为可缺省以对齐 UI「全部账本视图自动选默认账本」行为；③ **P2 动作扩面**：新增 9 个写工具（todo_update/delete、crm_updateCustomer、project_create/update、note_create/update、note_createFolder、habit_deleteHabit）+ 3 个读工具（listProjects/listNotes/listNoteFolders），工具面 15 → 27，白名单新增独立 `project` 域，消解器扩 `note`/`noteFolder` 类型，`listNotes` 投影不含 markdown 正文（防上下文膨胀）；四条纪律不新增领域事件 / 删除走既有级联函数 / 幽灵记录一律可操作错误 / 关联校验前置；④ 修复待办深链定位「已完成」条目不可见（穿透入口最常指向已完成待办，而 focus effect 一律 `setChipDone(false)`，与下方「已完成同步勾上」的注释相矛盾）。测试 128 → **175**，另做**变异验证**（去掉 `confirm_preview` 暴露或去掉预览记录缓存，对应测试立刻失败），`gen:skills` 幂等校验通过。Issue #33 AI Agent 调用能力 agentOps P1 第 5 步：打卡收口 `checkinHabit`/`uncheckHabit` 收口原 3 处内联重复（HabitsPage/dashboard cards/shared effects）且仅实际新建才 emit、读工具集 `src/agent/reads.ts`（searchEntities/getCustomer/listTransactions/listTodos/listLedgers/listHabits，投影白名单 + 条数上限截断 + 只走活记录）、写工具 `habit_checkin`（幂等 + undo 不 emit）；新增 `step5.tools.test.ts` 16 条，agentOps 合计 65 条全绿。第 1 步复审核验 + 第 3 步消解器交付。① `fuzzyMatch`/`fuzzySort`/`archivedLast` 从 `design-system/MatchCombobox` 提升到 `shared/search`（`MatchCombobox` re-export 兼容，既有 5 个使用方与全仓唯一外部调用点 `NoteEditorPage` 零改动），消除 shared ↔ design-system 反向依赖；② Project 归档映射收口为 `shared/search.ts` 的 `isProjectArchived`/`toArchivedFlag`，4 处内联 `archived: p.status === 'archived'`（NoteEditorPage ×2 / TransactionFormDrawer / TodoPage）改走收口函数并补对照断言；③ 能力白名单落 `settings.ai` 段（新增 `SettingsAi`/`AiDomain` 类型 + `mergeSettings`/`settingsRepo.save` 分段合并同步扩展，settings 不在 SYNC_TABLES 故不进同步队列），闸门 `visibleToolNames`/`listVisibleTools`/`dispatchAgentTool` 在分发层实施「白名单外工具对桥不可见且调用被拒」；④ 新增消解器 `src/agent/resolver.ts` 与读工具 `resolveEntity`，落实「只取活记录 / 按 id 去重后数唯一 / 去重唯一才静默消解 / 命中超阈值反问 / 空输入前置拦截 / Project 归档沉底」六条纪律；新增 `resolver.test.ts`（8 条）+ `whitelist.test.ts`（5 条），agentOps 测试 21 → 34 条全绿。Issue #108 健康分展示口径统一（审计整改）：未手动设置档位时不再显示「未设置」——各页面统一走新增的 `crm/healthScore.ts` `resolveHealthScoreDisplay`，算法推断档位用**括号**包裹并标来源（如 `T2 信赖（算法）`），手动档位原样显示。落地 CRM 列表行 / 时间线鱼骨鱼头徽章 / 图谱缩略卡 / 笔记 @提及悬浮摘要 4 处；新增 `useCustomerScoreRows` 批次查询（走 customerId 索引，只算未手动设置档位的客户）与 `buildScoreInputFromRows` 纯函数，算法入参口径与图谱侧 `buildScoreInput` 完全一致。同批清理审计文档债：`pb_setup/collections.json` 删已废弃 `customers.healthScore` 字段、部署指南核对清单与升级实录同步、agent-bridge 文档移除 `crm_createCustomer.healthScore` 入参（改指 `intimacy`）、开发计划文档加「字段以 PROGRESS 为准」声明；Issue #108 客户详情页信息架构优化 P1+P2（第二增量）：详情页重构为「身份条 → 行动区 → 概览区 → 明细区」四段式，落实「概览给数字，明细给记录」。①身份条：档案头与健康分档位合并一卡，联系方式（手机/企微/邮箱）由原「即时通讯与联系渠道」3 卡整体迁入「资料」Tab 成列（保留复制能力，CopyChip），身份条仅留姓名/分层/公司职位/最近联系/建档摘要；决策层级/地址/标签/客户关系等全量属性唯一出处为「资料」Tab；②行动区（新增）：快速记一笔常驻 + 待跟进事项（进行中待办 Top4）/ 待对账款项（Top4）两栏，首屏即给下一步动作；③概览区（新增）：资金往来收支合计、名下项目数、沟通次数（近 7 天）、关联笔记数 4 张数字卡，点击下钻对应 Tab；④明细区（Tabs）：时间轴（沿用统一时间轴与「全部/沟通/财务/事件」筛选，默认沟通）/ 资金（完整流水表：日期/摘要/渠道/对账状态/金额）/ 项目（名下项目：色点/名称/预算/状态）/ 资料（档案属性 9 行 + 关联笔记，经 notes.mentions 反查，与图谱投影同口径）；⑤原「关联业务」3 卡（关联交易/名下项目/关联待办）拆解去重，数字进概览、记录进 Tab，消除与时间轴的一屏双份；⑥迷你关系图谱由常驻装饰 SVG 改为一行折叠入口（保留交易/待办计数 + 展开全屏图谱链接）。改动仅限 `CustomerDetailPage.tsx` 展示层，未触碰数据模型/同步引擎/`timeline.ts` 共享模块；关联笔记复用 `useCollection('notes')` 全表过滤（与 `useCanvasGraph` 同口径，笔记量级小）。Issue #108 客户详情页信息架构优化 P0：亲密度全局改名「健康分」（UI 文案/功能配置页/图谱图例，数据结构与算法零改动）；移除原 0-100 手动健康指数 healthScore（详情页环形、列表分数条、图谱缩略卡、鱼骨鱼头、灵感引擎上下文、笔记关联卡、CSV 导出、编辑表单滑杆全部摘除；Dexie 非索引字段直接删类型，存量残留无害零迁移）；时间轴待办 created/done 双事件合并单事件（推翻 Issue #11 决议并更新 timeline.ts 注释，锚点=已完成取 completedAt / 进行中取 createdAt，详情页+鱼骨+全部时间线三处待办事件点减半）；详情页时间轴默认筛选改「沟通」（TIMELINE_FILTERS 共享模块未动，只改详情页 useState 默认值，时间线页默认行为不变）；详情页页头删口号副标题、标题改客户名。模块内部代码标识（intimacy 目录/IntimacyPicker/useIntimacyConfig）保留不动；Issue #86 功能配置页：业务模块规则配置从系统设置「数据管理」Tab 独立成 `/module-config` 页，注册表两级 `{ module, items }` 派生左栏模块 → 子菜单常显导航 + 右侧面板（子项路由可书签直达），系统设置改留指路牌并移除该 Tab；DataManagementTab 原样迁移为 CrmIntimacyConfig 业务逻辑零改写、moduleConfigs 同步表全不动；系统设置删「数据管理」Tab 8→7，导出/导入留在「数据与安全」零重叠；Issue #74 待办模块完整度修复：补齐 12 个缺失图标 + 图标完整性 CI 校验（npm run check:icons，接入 build 前置）、删除二次确认改应用风格 ConfirmDialog、打勾失败可见提示、列表行补归属副标题、接通逾期提醒开关、拖拽排序索引修正、doing 三态可达化、级联解绑含软删待办、移除死代码 assignTodoToList；Issue #74 待办打勾完成修复：完成态收口领域函数 `toggleTodoDone`（status + completedAt 成对写入，三处入口统一）+ 完成态同步合并本地优先（服务端缺字段回拉不再回滚完成状态）+ collections.json todos 补 sortOrder；Issue #54 主题风格体系：风格(skin)与配色解耦为独立持久化字段、先风格后配色；新增 glass/kid 风格包；皮肤层补齐导航 chrome（侧栏/页头/CRM 分组项语义化 .app-sidebar/.app-header/.app-nav-link）与裸 Tailwind 面板穿透；pixel 3px 描边贯穿、glass 深色弹窗对比度兜底、半径档全量走 var(--radius-*)；Issue #50 笔记 @提及浮层交互重构：顶部新增可见模糊匹配输入框（@ 唤起后自动聚焦，筛选词从正文迁入框内，正文 @ 后不再承载筛选词）+ 客户/待办/账本/项目四类横向 tab 统一「点选即插入」交互，移除重复 projectTab 锚点，所属项目选择收敛到右侧栏唯一入口；Issue #34 客户亲密度体系落地：Customer.intimacy 手动 7 档 + 算法兜底 + moduleConfigs 同步表 v9 + 设置页「数据管理」Tab + 图谱圈层/黑名单过滤；Issue #50 笔记关联体验升级：@提及浮层模糊匹配+键盘导航、编辑态关联主体/反向链接悬浮卡片；Issue #70 侧栏快速便签：左下角折叠单行捕获 → saveQuickCapture 落正式 Note，tag「速记」+ 默认目录，设置页「笔记偏好」选目录；Issue #101 服务端 Schema 补齐与部署实录：collections.json 为 noteFolders 补 tombstonePushed 字段与索引、补齐 customers.intimacy 字段定义；pb_hooks SYNC_COLLECTIONS 补 moduleConfigs/customerGroups；部署指南新增「服务端升级实录」7 步操作手册；Issue #107 新建表单改居中弹窗：新增 `design-system/ui.tsx` 的 `Modal`（size/elevated/响应式/Esc+遮罩，皮肤穿透 surface-card-dialog），确认与输入弹窗抬至 z-[60] 一处改动覆盖 9 个调用点，8 处表单抽屉迁移 Modal（凭证详情内编辑流水 elevated=z-[55]，形成 Detail z-50 → Form z-55 → Confirm z-60 三层），MatchCombobox 候选浮层改 portal 到 body（z-[70]）修复弹窗内裁切，新增 useAutoFocus 替代裸 autoFocus 修复打开表单页面跳滚，Drawer 保留给「参看」侧零改动）；Issue #107 弹窗审计修复（PR #109 评审项）：useAutoFocus 感知 open 修复永不聚焦（7 处调用点传 open）、新增 useEscapeLayer 打开栈实现 Esc 逐层关闭（Modal/Drawer/ConfirmDialog/PromptDialog 全部接入）、MatchCombobox 浮层视口空间不足时向上翻转随 scroll/resize 重算；Issue #33 AI Agent 调用能力 agentOps P1 第 7 步（E2E 主干验收）：新增 `src/agent/__tests__/e2e.acceptance.test.ts`（8 例）+ `e2e.harness.ts` + `relay.harness.test.ts`（7 例）——链路为 MCP 客户端（真 WS）→ 真实 relay 子进程 → 页面内 `AgentBridge`（原样复用）→ agentOps → repositories → fake-indexeddb，harness 仅注入 Node 侧最小 `WebSocket`；§9.8 场景（resolveEntity 零候选 → 建客户「王五/深蓝科技」中风险预览→确认 → `fin_createLedger` 建默认账本 → 记 2000 支出 → 按 customerId 读回账目 → 记沟通并读回档案 → 建待办「周五回访王五」→ 查待办）跑通，四条补强断言（relay vs 手工 `transaction:created`/`customer:contacted` 载荷键集一致、编辑流水不再触发 created、读工具投影与条数限幅、无 token 被拒 + 白名单关闭域不出现在 tools 清单）全部通过。**E2E 暴露并修复 relay 三处缺陷**：① 连接分流缺失——Agent 端点（无 role）落进 browser 分支覆盖 `browserConn`，导致唤醒请求发回 Agent 自身、调用永久无响应，改为显式二分支；② 回包信封丢失 `ok`——`onBrowserMessage` 只 `resolve(data)`，下游 `res.ok !== true` 恒真，工具执行成功却一律回「执行失败」；③ `listTools` 信封错位——清单实际在 `data.tools`，取 `r.tools` 会静默丢光全部工具。三处均补真机回归（逐条验证「改回即挂」）。另新增 relay `--dev`（预览响应自动附一次性 confirmToken，仅本地联调/自动化）与 `WORKHUB_RELAY_DEBUG`（打印浏览器往返回包）；lint / tsc / build / test 全绿（128 条）（Issue #33 agentOps **审计整改 P0·confirmToken 参数绑定**：审计逐行核验发现「票据绑定参数」此前**说了没做**——`ConfirmTokenStore.issue` 只记签发、`redeem` 不校验参数，桥也只判「有没有票」，越权路径成立（预览记 100 元 → 取票 → 直接以记 10000 元执行，同票可执行任意参数），既有测试恰好缺这条负向用例。修复：新增 `argsFingerprint(tool,args)` 对规范化 `{tool,args}` 取 **sha256 全量摘要**（对象键递归排序、数组保序），`issue()` 写指纹、`redeem(token,fingerprint)` **先删后校**，`tools/call` 核销传当次执行参数指纹，`confirm_preview` 与 `--dev` 自动签发均把 `args` 交给签发方；预览缓存键由 32 位字符滚动弱哈希改为复用同一 sha256 指纹。配套回归 `confirm.binding.test.ts`（4 条，非 `--dev` 真实 relay 子进程），变异验证（`redeem` 改回单参调用对应用例立刻失败）。测试 175 → **180**。同批 PR 整合：重复的第 2 步 PR #126 关闭，以本 PR 为准） （同批 **待办深链终态可见性修复**：Issue #128 三态改造把「全部待办」收窄为只装未完成，而 `focus` 深链一律切 `selKind='all'`，穿透入口指向的已完成/已作废待办被挡在视图外（Issue #111 同款缺口合并后重现）；修复为纯函数 `todo/domain.resolveFocusViewKind(todos, focusId)` 按目标状态切视图，新增 `focusView.test.ts` 5 条 + 变异验证） （同批 **客户关系写入收口单一来源**：`crm_addRelation` 此前手写 update + syncQueue.add，与 UI 的 `customerRepo.put` 两套实现且漏 `syncEngine.requestSync()`（只能等 30s 心跳才推送）；新增 `repositories.addCustomerRelation` 收口，新增 `relation.singleSource.test.ts` 4 条） · 维护人：yingshu0218 / cnb.cMPXRmKswEA / npc/CodeBuddy ／ 同批：Issue #132 新建客户支持关联客户（`CustomerFormDrawer` 的「关联客户」维护区原仅在编辑态渲染（`{customer && ...}`），新建档案时整块隐藏，导致新客户无法在创建时建立客户间关系；改为新建/编辑共用同一区块，relations 状态与添加/移除/判重/归类逻辑零改动，新建分支把 relations 随记录一并落库，步骤编号顺延为 1 基础/2 分层/3 联系/4 关联客户/5 跨模块初始化；数据模型/同步/schema 零改动）。
---

## 一、当前状态总览

| 项 | 状态 |
|---|---|
| 版本 | **v1 开发完成，已部署线上** |
| 线上地址 | http://8.153.19.221:9001（PocketBase 同域托管） |
| 里程碑 | M1-M6 全部验收 ✅ |
| 审计问题 | P0×2 / P1×19 / P2×60 **全部清零** |
| 同步机制完善 | P0-1 墓碑清理竞态修复 + P0-2 推送侧 LWW ✅；P1-3 服务端墓碑 cron ✅；P1-4 HTTPS（待用户操作）；Issue #140 多关联 json 字段已入 `collections.json`（**自托管端需重新导入并重启**，见部署指南） |
| Changelog | 第 91 条（README 底部） |

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
| 服务端重导入 collections.json | 笔记文件夹上线需导入新表 noteFolders + notes.folderId 字段（Dexie v6）；Issue #34 亲密度配置新增 module_configs 集合 + customers.intimacy json 字段（Dexie v9，本地自动升版）；Issue #74 补 todos.sortOrder 字段（待办自定义顺序同步）；**Issue #128 补 todos.voidedAt 字段（待办作废时间跨设备同步，缺字段会导致作废态回拉时丢时间戳）**，见部署指南「Schema 升级流程」；完成后执行一次「全量推送」 |

### 工作台首页布局重构与随记收集箱（Issue #134，已提 PR）

| 变更点 | 状态 |
|---|---|
| 主网格 12 列制 | ✅ 由「左 1fr + 右 360px」改为左 7 列（NOW DOING + 今日待办日程）/ 右 5 列（每日习惯闭环 + 随手速记），对齐原型 01；小屏单列堆叠 |
| 随手速记 → 收集箱入口 | ✅ 常驻可拖高 `textarea`（rows=4）+ `N 字符已录入 · 本地缓存已就绪` 状态行；`转入待办`/`归入团队笔记` 双按钮常显（原 hover 显隐两步操作）；⌘/Ctrl+Enter 转待办；暂存区列表保留逐条处置 |
| 转入待办落「收集箱」 | ✅ `captureToTodo` 恒定 `listId` 缺省（收集箱 = 无归属未完成，与待办中心同口径）、不带 `dueAt`、干净未完成态（不受完成率/今日日程污染）；首行标题 60 字、多行全文入 `desc` |
| 处置链路收口 | ✅ 新增 `src/modules/notes/quickCapture.ts` 唯一实现体：`saveQuickCapture` / `captureToTodo` / `captureToNote`（tag「速记归档」）/ `convertQuickNote`（回写 `convertedTo` + 发 `quicknote:convert`）；卡片不再内联手拼记录字段（原实现漏 `folderId`/`mentions`/同步触发） |
| 待办完成后移出首页 | ✅ 「今日待办日程」只渲染未完成（`isDueToday` 内含 `isTodoOpen`），打勾即时消失；移除原「已完成划线区」（与「移出首页」相悖）；空态补「今日已达成 N 项」文案。顶部「待办达成 N/M」口径未动 |
| 测试 | ✅ 新增 `quickCapture.flow.test.ts` 11 条（收集箱归属 / 初始态干净 / 标题截断与 desc 保真 / 处置回写与目标 id / 幂等离场），合计 224 条全绿；lint / tsc / check:icons / build 全绿 |
| 顶部指标改剩余口径（三轮） | ✅ 「待办达成 N/M」改为「今日待办 · 还剩 N 项」（`isDueToday` 同源，打勾减一，归零显「今日已清空」）；已完成条目不可见 + 完成率读数已无意义，剩余量才是行动读数 |
| 速记处置态同步修复（三轮） | ✅ `mergeRemote` 新增 `keepLocalConverted`（本地已处置 + 远端未处置 → 处置态成对保留，不再「复活」回待处置）；`convertedAt`/`convertedVia` 纳入 `collections.json` 同步契约 |
| 测试（三轮） | ✅ 合计 **238** 条全绿（新增处置态合并 3 条 + 变异验证）；lint / tsc / check:icons / build 全绿 |

### 待办三态与侧栏选中修复（Issue #128，已提 PR）

| 变更点 | 状态 |
|---|---|
| 侧栏菜单高亮不消失 | ✅ 根因是 `NavLink` 前缀匹配（`/todo` 在 `/module-config` 下仍被判 active）；新增 `AppLayout.isNavItemActive(pathname, to)` 唯一判定入口（`/` 仅根路径；`/crm`·`/projects`·`/module-config` 按段匹配；其余精确匹配），4 个调用点统一改走；抽出纯函数配 5 条对照测试 |
| 待办状态扩三态 | ✅ `todo` \| `done` \| `voided`，新增 `voidedAt`（与 `completedAt` **互斥**，成对写入）；领域层 `isTodoDone`/`isTodoVoided`/`isTodoFinished` + `todoStatusLabel` 全站收口，禁止再内联 `status === 'done'` 判据 |
| 「全部待办」口径 | ✅ 严格只装未完成：已完成、已作废都不混入（原「已完成」筛选 Chip 已移除，由新菜单取代） |
| 新增两个菜单 | ✅ 左栏终态区「已完成」「已作废」，与未完成视图以分隔线分组，带状态徽标、不显示 P1 Chip |
| 作废动作 | ✅ 行内常显「作废」按钮（删除仍为 hover 显隐，两者意图不同不并排混淆）；`voidTodo`/`restoreTodo` 单点收口、幂等不重复入队；作废**不等于删除**——记录保留、可恢复、不催办、不计完成率 |
| 跨模块口径 | ✅ 工作台「今日已完成」、CRM 健康分入参 `doneTodos`、项目详情待办列、清单未完成计数、⌘K 搜索状态前缀、agent 消解器候选标注（终态沉底）、CRM 时间轴「作废待办」灰标（锚点 `voidedAt`）、同步适配器终态本地优先（补 `voidedAt` 保留） |
| 待人工 | ⚠️ 服务端需重导入 collections.json 让 `todos.voidedAt` 生效（并入上方同一次操作） |
| 审计整改（第二轮） | ✅ ① `backfillTodoVoidedAt` 原为死代码（无调用点），已接入启动链（`main.tsx` seed → `backfillTodoCompletedAt` → `backfillTodoVoidedAt`）并补 2 条测试（补盖 + 入队 + 幂等）；② 深链 `?focus=<id>` 并入 `baseScope` 时未过视图闸门，已作废/已完成条目会被并进「全部待办」并计入「N 条未完成」，新增 `inFocusScope` 按当前视图状态过滤；③ `NAV_CHILD_PREFIXED` 由硬编码白名单改为从 `NAV_ITEMS.childPrefixed` 派生（仅 `/module-config` 因不在 `NAV_ITEMS` 中单独登记），新增带子路由菜单无需再手工同步 |

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

### AI Agent 调用能力（Issue #33，agentOps P1：第 1~7 步已交付）

方案：`docs/agent-bridge-skill-v0.4.md`（v0.8 终稿，三方审计收敛）。外部 Agent 自带意图理解，
应用只暴露 agentOps 单一写入口，Local-First 零破坏。

| 项 | 状态 |
|---|---|
| 第 1 步 agentOps 门面 + 事件对齐测试 | ✅ 已合入 main（PR #120）：zod 校验 / 风险分级 / 事件声明表单点收口（事务 commit 后 emit）/ 记账日期范围校验 / lastContactAt 只前进 / 待办幂等 |
| 第 2 步 事件下沉 repositories | ✅ 三边界落地：①`saveTransactionWithAttachments` create 门控（仅新 id 发 `transaction:created`，修 §9.5 bug1 编辑误发）；②`saveInteractionAndTouchCustomer` 统一 emit `customer:contacted`（修 §9.5 bug2 项目跟进漏发）；③两事件均在事务 commit 之后 emit。返回类型改 `{ id, created }` |
| 事件单点收口 | ✅ UI（`TransactionFormDrawer` / `CustomerDetailPage`）与 agentOps（`executor`）内联 emit 全部移除，杜绝双发；`SUNK_EVENTS` 标记已下沉事件，`emitDeclared` 对已下沉事件直接抛错 |
| `createCustomerWithInit` 下沉 | ✅ 由 `@/agent/` 移入 `src/repositories/index.ts`，`modules/crm/hooks.ts` 改为从 `@/repositories` re-export（UI 引用路径不变），行为逐行等价、不新增事件 |
| fuzzy 基建提升到 shared | ✅ `fuzzyMatch`/`fuzzySort`/`archivedLast` 迁至 `shared/search.ts`，`MatchCombobox` 保留 re-export（5 个使用方零改动），内部消费改 `@/shared/search` 引入，杜绝 shared ↔ design-system 反向依赖 |
| Project 归档映射收口 | ✅ `isProjectArchived`/`toArchivedFlag` 收口 4 处内联映射（NoteEditorPage ×2 / TransactionFormDrawer / TodoPage）；`ProjectsPage` 用 `select` 展示归档项目（同判据、不在候选链路）不参与断言 |
| 能力白名单 | ✅ settings `ai` 段（`SettingsAi`/`AiDomain`，仅本地不进同步）+ `DEFAULT_AI_DOMAINS` 兜底；`visibleToolNames`/`listVisibleTools` 出 tools 清单、`dispatchAgentTool` 分发闸门（白名单外直接拒绝，不含来源判断）。⚠️ 白名单**配置页 UI 壳**仍待交付 |
| 消解器 `resolveEntity` | ✅ `src/agent/resolver.ts`：候选池只走活记录（同 `useCollection` 过滤 `deleted`）、按 id 去重后数唯一、去重后唯一才静默消解、命中数 > 5 强制反问、空/过短输入前置拦截、候选上限 10 且投影仅 `id/type/label/sub/archived`（不含 relations 与全字段）、Project 归档态先映射后沉底 |
| 第 5 步 打卡收口 `checkinHabit` | ✅ 收口原 3 处内联重复（`HabitsPage` / `dashboard/cards` / `shared/effects` 专注联动）：`checkinHabit(habitId,date,{evidence})` 返回 `{created}` 且**仅实际新建才 emit** `habit:checked`（事务 commit 后），`uncheckHabit` 软删确定性 `habitLogId` 派生 id、不 emit；`dashboard` 软删入口由「按 existing.id 删」统一为确定性 id，消除两套删除语义 |
| 第 5 步 读工具集 | ✅ `src/agent/reads.ts`：`searchEntities`（≤20，复用 `searchAll` 6 实体投影，notes 字段裁剪不含 markdown）/ `getCustomer`（投影不含 relations 全量，仅 `relationCount`）/ `listTransactions`（≤50，金额/日期/状态/customerId/ledgerId，不含附件）/ `listTodos` / `listLedgers` / `listHabits`（各 ≤50）；一律只走活记录、超限**截断并返回 `truncated`** |
| 第 5 步 写工具 `habit_checkin` | ✅ 走收口函数，幂等（目标态语义，重试安全），`undo:true` 取消打卡不 emit，习惯不存在返回可操作错误；白名单域 `habit` |
| 第 4 步 本地 Relay | ✅ `relay/`（Node 进程，零新增依赖）：`ws-server.mjs` 最小 RFC6455 服务端（node:http 升级握手 + crypto 校验 + 掩码解帧/分片/ping-pong/close）、`mcp-relay.mjs` 标准 MCP 路由（`initialize`/`tools/list`/`tools/call`/`ping`）+ 接入 token 校验 + 一次性 `confirmToken` 台账（5 分钟 TTL、核销即删、防重放）、`index.mjs` 双入口同进程（stdio `--stdio` 与 WS 并存）。只绑 `127.0.0.1:8787`，**只转发、零特权**（不 import repositories） |
| 第 4 步 浏览器侧桥 | ✅ `src/agent/bridge.ts`：浏览器**主动连出** relay（Outbound WS，浏览器无 listen 能力）；`tools/list` 经白名单过滤（关闭的域不出现）、`tools/call` 只走 `dispatchAgentTool` 唯一入口、中风险无 `confirmToken` 只回预览材料；`src/agent/install.ts` 按 settings `ai` 段决定连/断（缺省关，零影响） |
| 第 4 步 CSP 注入 | ✅ `vite.config.ts` 新增 `cspRelayPlugin`（`apply:'serve'`）：仅 dev/本地自用构建经 `transformIndexHtml` 向 `connect-src` 追加 `ws://127.0.0.1:8787`；**生产构建 CSP 不含 `ws:`**（已断言） |
| 第 4 步 白名单配置页 | ✅ 设置页新增「AI Agent 桥」标签（`settings/AiBridgeSection.tsx`）：启用开关 / relay 地址 / 接入 token（生成·复制·重置）/ 按域能力白名单开关（关闭即对桥不可见）；token 仅存本地 `settings.ai`，不进同步 |
| 第 6 步 skill 文件首版 | ✅ `docs/skills/`（15 个工具各一份 + `README.md` + `mcp-tools.json`），由 `scripts/gen-skills.mjs` 从 **`src/agent/skillSource.ts`（agentOps zod schema）同一份定义**生成；含参数表（`zodToJsonSchema`）/副作用/风险级/幂等语义/实体引用规则/典型说法/确认流程 |
| 第 7 步 E2E 主干验收 | ✅ `src/agent/__tests__/e2e.acceptance.test.ts`（8 例）+ `e2e.harness.ts`：MCP 客户端（真 WS）→ **真实 relay 子进程** → 页面内 `AgentBridge`（原样复用）→ agentOps → repositories → `fake-indexeddb`；harness 仅注入 Node 侧最小 `WebSocket`（Node 无原生实现）。§9.8 场景（resolveEntity 零候选 → 建客户「王五/深蓝科技」预览→确认 → `fin_createLedger` 建默认账本 → 记 2000 支出 `status=待对账` → 按 customerId 读回账目 → 记沟通读回档案 → 建待办「周五回访王五」→ 查待办）跑通 |
| 第 7 步 补强断言 | ✅ ①relay 记一笔/记沟通 vs 手工调 repository，`transaction:created`/`customer:contacted` 载荷键集逐字段一致；②编辑流水**不再**触发 `transaction:created` 且不新增记录；③读工具投影不含 attachments/relations 全量与条数上限；④无/错 token 被拒 + 白名单关闭域在 `tools/list` 中直接不出现且点名调用被闸门拒绝 |
| 第 7 步 relay 缺陷修复 | ✅ E2E 暴露三处（均补 `relay.harness.test.ts` 真机回归，逐条验证「改回即挂」）：①**连接分流缺失**——Agent 端点（无 `role`）落进 browser 分支覆盖 `browserConn`，唤醒请求发回 Agent 自身致**调用永久无响应**，改为显式二分支（`role==='browser'` 走页面桥 / `role===null` 走标准 MCP 路由）；②**回包信封丢 `ok`**——`onBrowserMessage` 只 `resolve(data)`，下游 `res.ok !== true` 恒真，工具执行成功却一律回「执行失败」，改为 `resolve({ok,data})`；③**`listTools` 信封错位**——清单实际在 `data.tools`，取 `r.tools` 会**静默丢光全部工具** |
| 第 7 步 relay 运维增量 | ✅ `--dev`：**仅本地联调/自动化**下预览响应自动附一次性 `confirmToken`（供脚本跑通「预览→确认→执行」；非 dev 不签发，避免架空确认闸门）；`WORKHUB_RELAY_DEBUG=1`：打印浏览器往返回包，供排查「有回包但客户端收不到」 |
| 测试 | ✅ `eventSink.test.ts` 15、`resolver.test.ts` 8、`whitelist.test.ts` 5、`agentOps.alignment.test.ts` 21、`step5.tools.test.ts` 16、**`relay.bridge.test.ts` 17**（token 拒绝/白名单/confirmToken 一次性与超时/协议完备/真实 WS 帧握手）、**`bridge.test.ts` 9**（zod→JSON Schema 单源、预览拦截、白名单闸门、真实 WS 往返）、**`skill.parity.test.ts` 6**（实现↔skill 源↔生成产物三方一致）、**`csp.test.ts` 4**、**`aiSettings.test.ts` 4**、**`e2e.acceptance.test.ts` 8**（§9.8 主干 + 四条补强）、**`relay.harness.test.ts` 7**（relay 真机回归）；agentOps 合计 **112 条全绿**（全仓 128 条） |
| 未开工（P2 起） | ⏳ 新模块全量动作、UI/AI 事件漂移收口、会话历史落 settings、撤销栈、能力白名单配置页扩展、离线规则模板兜底；编辑/删除/高风险变更按方案押 P1 后半或 P2 |

**四轮补充（2026-09-11，Issue #134 「今日到期 / 逾期」分开展示）**：① **首页「今日待办日程」按两段渲染**——此前「今天」口径（`isDueToday` = 今日到期 ∪ 逾期未完成）混在一列按截止时间排序，逾期条目会被「今天还没到点」的条目稀释，而恰恰是逾期最需要被看见。现拆为**两个互斥分组**：**已逾期**置顶（红色组头 + 左侧 danger 竖条 + 浅红底 + 「已逾期 2 天 3 小时」时长文案，提示「先补这些」）、**今日到期**在后（蓝色组头 + `HH:mm 到期` + 「按计划推进」）；顶部加「N 逾期」胶囊（为 0 不显示）。② **口径拆分与互斥保证**——新增 `isTodoOverdue`（未完成 + 截止**时刻**早于此刻，按时刻而非自然日：今天 09:00 的待办过了 09:00 就是逾期，否则「逾期」列在当天永远为空）与 `isTodoDueToday`（未完成 + 截止落在今天 + **未过点**，滤掉 `isTodoOverdue` 以保证与逾期组互斥、同一条待办不会在两列重复计数）；两者并集恒等于 `isDueToday`，即**拆分不改变「今天」总量，只改变呈现粒度**（`isDueToday` 保留为含集口径，供待办中心「今天」视图与指标卡使用）。③ **指标卡同步拆数**——「今日待办 · 还剩 N 项」下补一行副读数「今日到期 X · 逾期 Y」（逾期为 0 时不显示逾期项），与日程卡分组同源。④ **待办中心新增「逾期」入口**——左栏智能清单在「今天」之后插入「逾期」（原「今天」不变，含集口径不变；「逾期」是它的收窄子视图，逾期提醒条点进去仍落在「今天」）；新建待办兜底可见性判断同步补 `overdue` 分支。新增 `src/modules/todo/__tests__/dueOverdue.test.ts` 10 条（含并集等价与互斥断言），测试 238 → **248**；lint / tsc / check:icons / build 全绿。

**五轮补充（2026-09-11，Issue #134 逾期改按天口径）**：四轮的逾期按**时刻**判定（今天 09:00 的待办过了 09:00 就进「逾期」组），但用户口径里的「逾期」是**跨天未完成**（过了期限还没交），不是「当天钟点过了」——当天的钟点过了仍在「今日到期」里按计划推进即可，跨天未完成才叫逾期。① `isTodoOverdue` 改为按天：`dayjs(dueAt).format('YYYY-MM-DD') < todayStr`，参数由 `now: Dayjs` 换成 `todayStr: string`（默认取当天）；`isTodoDueToday` 去掉 `!isTodoOverdue` 过滤——按天口径下两组天然互斥（今天 vs 今天之前），今日已过点条目留在「今日到期」组。② 新增 `overdueDays`（今天 - 截止日，自然日差，恒 >= 1），供「已逾期 N 天」催办文案；首页日程卡去掉原「已逾期 X 天 Y 小时」的时分粒度，统一为「已逾期 N 天」。③ 调用点全部改传 `todayStr`：`DashboardPage` 指标卡副读数、`TodayTodosCard` 两分组、`TodoPage` 逾期清单计数 / `overdue` 视图过滤 / 列表行内「已逾期 N 天」标记 / 新建兜底可见性。修复当天的分组两列来回横跳与逾期天数随时分秒跳动的问题。`dueOverdue.test.ts` 重写为 16 条（按天判定 / 两组互斥 / 并集等价 / `overdueDays` 自然日差 / 终态与无截止不进组），测试 248 → **254**；lint / tsc / check:icons / build 全绿。

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
