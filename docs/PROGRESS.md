# 寻鸽工作台 · 开发进度文档

> **本仓库的唯一进度事实来源。** 所有人（含 AI 开发代理）推进或变更任何开发工作，必须在**同一个 commit** 里同步更新本文件对应状态。CHANGELOG 记录版本级交付，逐项实施记录以本文件及 Git 提交历史为准。
>
> **当前口径（2026-11-12）**：产品为完全个人使用的助手；开发验证环境重新建立于用户授权的 `devtest` 独立目录，旧 9001 环境仍已停用。正式站未在本轮修改。历史轮次中的团队、Local-First Web 和旧环境描述不代表当前实现；见 [开发测试环境说明](开发测试环境说明.md)。

**最后更新**：2026-11-12（修复 devtest 公网访问与 HTTP 请求编号兼容）
- 用户反馈公网入口无法打开，实测服务正常但 `PUBLIC_HOST=127.0.0.1`。本实例改为 `0.0.0.0:9630`，外网首页及 JavaScript 资源均 200；Web/relay 9631、PB 9633 仍仅回环。账号、数据、服务资源限制未改。
- HTTP 页面没有 `crypto.randomUUID`，导致整组录入预览报错。请求编号统一复用已有 nanoid 的安全随机源；无新增依赖，保留已存请求号和原世代重试。
- 回归先复现 `TypeError: crypto.randomUUID is not a function`，修复后完整 `check:all` **1214 passed / 7 skipped**；覆盖 HTTP 缺失该 API 时的预览、重新挂载及原请求重试。
- 当前运行入口已复核登录开启、首启注册关闭、匿名 MCP/客户端接口 401，**30 项认证回归通过**。代码兼容补丁构建与部署证据待本轮收口；未运行浏览器或手机验收。
- 前轮 12 个提交已推送 GitHub `codex/reliability-20261111`，远端核对为 **a5787f6**；未合并 main、未打 tag。实际地址及凭据仍不写入仓库。

**上一轮**：2026-11-12（个人助手第三次交付完成：原库升级、实站放行与当前状态表复核）
- 实际 devtest **96fdfc6**（前置 **cec7233**），active/running、0重启，1 CPU/768 MiB。冷备份逐文件验证，原25表全行指纹、generation与凭据文件不变；原库文件数0。000/001/002冻结hash不变，新增003冻结为 `7c728ac0…91ded88`。
- 完整个人视图、名称筛选、事实图谱、来源/历史续页与互相定位、预览纠错/撤销/范围清理、个人设置已交付。生产Web/原生共用endpoint、身份/世代隔离镜像与真正有界增量；草稿和未知请求保留原上下文，旧队列不自动迁移或推送。
- 最终门禁 **1213 passed / 7 skipped**，图标/TypeScript/lint及Web/服务端构建通过。真实PB/MCP **18+10+2组**、同步/附件 **9组**、独立缓存/MCP **6组**；root独立同步/文件 **7组**、实际代码增强双缓存 **7组**通过。
- 实站独立/旧兼容命令冒烟通过；root **30项HTTP/WS认证**、MCP只读、**9项CORS**、原生来源认证/状态、匿名客户端路由拒绝、schema6/protocol1、26行快照和空增量readCount0通过；**80个当前运行文件SHA一致**。保留121个旧dist哈希资源，无额外PB hooks/迁移。
- 规模查询P95 **5.55–383.57ms**、复合提交 **93.52ms**；首轮快照76,546行/383页/83,472,611字节/21.44s，无变更0行、单改1行。不是浏览器/手机性能。未运行浏览器/Playwright、SDK/NDK、新APK、CI或真机；正式环境未涉及、未推送/打tag。
- 设备授权按源码核验补明宿主能力条件：注入issueAgentCredential时独立签发，旧宿主才回退共享过渡，不能只凭--login命令名判断身份。
- 当前状态表的版本、Schema、devtest与未来App口径已复核；历史APK与第二版门禁只作历史证据，不代表新版终端已交付。
- [完整A01–A34矩阵与边界](个人助手第三版验收-20261112.md)、[客户端协议](个人助手客户端协议-20261112.md)、[部署证据](个人助手第三版部署证据-20261112.json)、[规模原始JSON](个人助手第三版规模验收-20261112.json)。AGENTS/README已按当前事实收口，旧轮次保留为历史。

**上一轮**：2026-11-12（个人助手第三版界面完成，待保留原库升级 devtest）
- 今天/时间线/联系人/图谱成为主线；桌面与移动导航收口，待办/收支/笔记直接可达。事件、联系人与事项按名称搜索，发生/录入时间、仅日期精度、承诺变化、明确关系证据及分币种金额共用第二版查询。
- 来源、正文、关系、历史和 effects 有界续读；旧深链回到同一活动。纠错只提交改动字段，长正文读全后才可改；预览/撤销/范围清理/联系人合并保留确认边界。查询失败与清理销毁旧正文/图谱，未提交内容及原 rev 单独保存；明确校验/版本拒绝不锁死输入。
- 设置收为账号服务器、独立 Agent、数据备份、外观偏好、关于五组，保留既有主题与 d3-force。已建立可复跑 `test:clients`，区分服务器双游标与两个独立缓存进程。旧世代输入可见、可导出、可按原上下文核对。
- 最终真实 PB/MCP 基线 **18+10+2 组**、同步/附件 **9 组**、独立缓存串联 MCP **6 组**通过；独立 root 审计 **7+6 组**通过。固定规模 P95 查询 **5.55–383.57ms**、复合提交 **93.52ms**；首轮 **76,546 行/383 页/83,472,611 字节/21.44s**，无变化 **0 行**、单条变更 **1 行**。
- 新增快照修复保留删除登记/已覆盖水位回执拒绝，以及软删迁移活动不从冻结沟通导出原文的回归。最终完整门禁 **1213 passed / 7 skipped**，TypeScript、图标和 lint 通过。devtest 尚为 ba5eaba，下一步冷备份后保留原库增量升级，未涉及正式站、推送、浏览器或 APK。

**上一轮**：2026-11-12（个人助手第三版基础：在线客户端协议与隔离镜像，综合验收中）
- 生产 Web 与原生共用 VPS endpoint、在线认证、服务端命令；按 server/owner/generation/schema 隔离缓存、查询、草稿和未知请求。旧库与旧队列保留，只导出核对，不自动推送。
- 新增 1794355203：全局 effects 索引与现有附件保护；000/001/002 保持冻结。跨表快照、200 行增量页、操作水位、原子游标发布、软删/永久删除与恢复世代校验；晚快照/旧回执/排队跨账号写入均有反向回归。
- 认证完成后才安装同步与业务订阅；退出清理轮询/事件/计时。附件通过认证下载入口读取，匿名直链和删除后旧路径拒绝；原生前台恢复有接线与自动测试，不安装 SDK/NDK、不出新 APK。
- 独立审计真实同步/附件 **7 组**与两个独立客户端缓存串联 MCP **6 组**通过；已运行完整门禁 **1210 passed / 7 skipped**。当前候选仍在补最终规模与基线验收，devtest 尚为 ba5eaba，正式站未涉及。

**上一轮**：2026-11-12（个人助手第二次交付完成：P0 修复已部署、实站复核放行）
- root 实站匿名探针曾发现 `ffcefc6` 把空凭据与内部共享过渡哨兵混淆，已立即停服并修复。最终部署 **ba5eaba**，active/running、0 重启，768 MiB/1 CPU；正式站未涉及。
- HTTP/WS/stdio 外部入口先拒绝缺失/空白凭据；共享过渡改为显式 tagged 身份且仅由实际 constant-time 匹配共享秘密后构造；PB 不再把缺少 token 视作共享身份。失败重初始化清空旧会话；HTTP 头优先，不让空/错误头借查询串或正文升级。
- 完整门禁 **1188 passed / 7 skipped**；真实 PB/MCP **18 组**及原 **10+2 组**通过；root 再冻结审计 **10 组**通过，实际入口 **30 项 HTTP/WS 认证**与只读探针通过，**7 个关键文件本地/远端 SHA256 一致**。本方独立凭据原子录入/重试/撤销、20 项匿名拒绝及旧共享兼容入口冒烟通过，AUTO_CONFIRM=false。
- 两次原库冷备份校验通过；已有记录、回执、活动、独立凭据与 generation 保留，未改账号秘密；补齐实例缺失的 link 业务域配置。1794355200/5201/5202 已部署冻结，002 hash `f7ea8425…cceba88b` 未变。本地提交 **38305c9 → ffcefc6 → ba5eaba**，未推送。第二次交付可交第三版接续；协议、验收和多端边界见 [事件协议](个人助手事件协议-20261111.md)、[最终报告](个人助手第二版验收-20261111.md)。

**上一轮**：2026-11-11（个人助手第二次交付：候选验证完成，待原库升级）
- activities、多人/无联系人、别名与联系人化；1794355202 原库增量映射冻结沟通、canonical links/旧深链/历史回执/回收站快照，旧别名永久删除登记防复活。搜索与 schemaVersion=5 业务副本使用活动原字段。
- 24 个新公开工具（共 61 业务工具）：范围与游标查询、完整分币种汇总、整组预览提交、纠错/安全撤销/合并/保留事实删除/按来源清理、待确认操作和取消；独立散列凭据、撤销与世代、部署写域白名单、标准 MCP arguments 与计划绑定确认。
- 完整门禁 **1179 passed / 7 skipped**，生产 Web/服务端构建通过；真实 PB/MCP **17 组**、既有可靠性 **10+2 组**及 root 独立 **10 组**通过。固定 1000 联系人/10000 事件/10000 流水/5000 待办/50000 关联，768 MiB/1 CPU、30 样本：查询 P95 **7.91–377.71ms**，普通复合提交 **89.02ms**。此前失败和超标夹具保留；`test:personal` 先构建服务端与真实仓储夹具，避免拿旧 bundle 验新源码。
- **部署状态**：待将本候选增量部署到既有 devtest 原库；当前服务仍为 560f878。正式站未访问/未部署，未推送，未运行浏览器或手机真机验收。第三版负责完整视图、真正有界增量同步及 Android 共用接线。[协议与交接](个人助手事件协议-20261111.md)；[验收报告](个人助手第二版验收-20261111.md)。

**上一轮**：2026-11-11（生产入口实测修正：默认账本字段与未知提交保护）
- devtest 生产入口捕获 `UNKNOWN_FIELD: ledgers/isDefault`，保留失败日志；新增迁移 **1794355201** 补齐默认账本与统一 SyncMeta 持久字段。**1794355200 已冻结**，构建不再用当前 schema 覆盖旧迁移；保留已有开发数据升级。
- 新增 TypeScript 实体字段 ↔ PB schema 防漂移锁；失败/未知提交的关闭保护、重新挂载恢复原输入、按原世代查询/重试、已提交后的本地辅助表错误不伪报保存失败。
- 本机完整门禁 **1170 passed / 7 skipped**，生产 Web 与服务端构建通过，真实 PB **10+2 组通过**；默认账本真实 MCP、保留数据升级和新迁移/恢复回归均已通过；devtest 运行 **560f878**，服务 active/running、0 重启，回环 9630，768 MiB/1 CPU。两个已部署迁移检查点均已冻结；MCP 所有提交拒绝缺少稳定请求上下文的旧请求，不能在恢复后自动补新世代重录。补充金额累计溢出 `MONEY_RANGE`，不允许单笔合法时汇总静默丢分。提交 `2fa6c9c` → `d1e8e97` → `560f878`，未改写历史、未推送；[完整验收和交接](可靠性版本验收-20261111.md)。

**上一轮**：2026-11-11（个人助手可靠性版本：阶段一、二，待独立审计）
- 真实 PocketBase 0.40.2 + JSVM 共享纯核心，事务校验身份/世代/版本/关联/金额；业务、操作回执、明细、持久通知和删除登记原子提交。具体预览固定 ID 与版本，持久请求去重覆盖并发、重启及丢响应。
- 生产 Web、PocketBaseAdapter 与服务端 Agent 同一命令路径；普通账号旧集合直写关闭。显式清空、过时写/墓碑错误、回收站对齐、防复活、最小金额单位、币种固定、按流水 ID 去重及全量分币种汇总已落实；表单防双击并保留失败输入。
- relay 异常隔离/资源上限、多页稳定选主；PB 原子首启与注册规则迁移；生产认证 fail-closed；内容 ETag；可校验冷备份/隔离恢复、升级前 schema 迁移与恢复世代约束。
- **验证/部署状态**：真实 PB 主回归 10 组、旧库迁移与恢复 2 组已通过；`npm run check:all` 为 **1164 passed / 7 skipped**，`npm run build`、`build:server` 通过；devtest 开发部署验收结果待收口回写。完整协议与在线入口清单见 [可靠提交协议](可靠提交协议-20261111.md)。
- **边界**：本轮不访问正式数据、不升级正式站。activities、联系人别名、整组纠错撤销、新时间线/图谱、独立 Agent 凭据属于后两版；原生新版暂只读，旧离线队列必须导出核对，不能静默清空。浏览器验收继续未启用。

**上一轮**：2026-11-08（**一条命令 + 浏览器授权：`/authorize` 设备授权流**）
**背景**：用户要 WorkBuddy 式认证 —— 复制一条命令，弹出页面点当前账户授权，不再手抄 token、也不去翻容器日志。
**① relay**：新增 `/device/code`（无鉴权签 `device_code` + 8 位用户码，10 分钟）、`/device/approve|deny`（**必须站点登录态**，复用 `authorizeMint` 的 PB `auth-refresh` 校验）、`/device/token`（CLI 轮询；批准后**一次性**回 relay token）。设备码只存内存，重启即失效；签发与轮询分别限速。
**② 授权页**：新增 `/authorize`（`AuthorizePage`，放在 Shell 之外、仍在 AuthGate 内）：显示用户码与当前账户，可「授权 / 换个账户」；页面**只提交 `user_code`**，长期 token 不经过页面。
**③ CLI**：`npm run agent:setup -- --url wss://<站点>/relay --login`：请求设备码 → 打印并自动打开授权页 → 轮询 → 把 token 写入 `~/.workhub/relay.json`，再继续原有 MCP 配置写入。可复制的命令里**只有站点地址，没有 token**。
**④ 设置页**：「Agent 侧接入（复制即用）」命令改为 `--login`；`--print-prompt` 的一次性配对码路径保留。dev 的 vite 插件也注入 `authorizeMint`（本机 PB），本地能走通同一条授权链。
**⑤ 构建修复（CNB 实测）**：首次镜像构建在 `vite build` 阶段失败 —— `.dockerignore` 把 `CHANGELOG.md` 排除了，`?raw` 解析不到。已从排除清单移除（它是「关于」页的构建期数据源），并加注释防止再被当大件删掉。
> **本轮验证**：`relayHttp.test.ts` **+5 条**（签发 / 待授权轮询 / 批准兑换且一次性 / 拒绝 / 反代地址）+ `authorizePage.test.tsx` **3 条**（只提交 user_code / 未登录不发请求 / 服务端原话透传）+ `agentSetup.test.ts` **42 条**（+3：`--login`、`ws→http`、`wss→https`）+ `aiBridgePair.test.tsx` **+1 条**（命令含 `--login` 且不含 token）；`npm run check:all` 全绿 —— **1162 passed / 0 failed / 7 skipped**（144 文件 / 1169 用例）；`npm run build` 通过。

**上一轮**：2026-11-08（**修掉「首次配对前不能生成配对码」：后台页面可用登录态直接生成接入 token**）
**背景（用户实际卡点）**：设置页「生成配对码」在 `ai.bridgeToken` 为空时直接报「尚未配对，无法签发配对码」，而 `/pair/new` 又只认 relay token —— 首次接入的人既没有 token、又必须先有 token 才能签，形成死循环，只能去翻容器日志找引导码。
**① relay 增加第二鉴权通道**：`createRelay({ authorizeMint })`。`/pair/new` 仍优先认 `Bearer <relay token>`；未命中时交给宿主注入的回调（`scripts/serve.mjs` 用 PocketBase `users/auth-refresh` 校验**站点登录态**）。relay 本体仍不 import 任何业务代码。
**② 页面流程**：`AiBridgeSection` 取 `getAuthToken()`（AuthGate 写入的 PB 登录态）；本页尚无 relay token 时，「生成接入 token」= 签一次性码 → **立即兑换** → 把 relay 下发的长期 token 写入 `settings.ai.bridgeToken` 并重连。**token 仍由 relay 下发，页面不自造**（2026-10-28 事故的硬约束不变）。已有 token 时按钮仍是原语义：签 5 分钟一次性码给 Agent / 第二台设备。
**③ UI 口径**：按钮按状态显示「生成接入 token / 生成配对码」，说明改为「无需先配对，生成后复制到 MCP 客户端的 `Authorization: Bearer`」；启动日志引导码降级为兜底。
> **本轮验证**：`relayHttp.test.ts` **+2 条**（站点登录态可签码并兑换 / 错误登录态仍 401）+ `aiBridgePair.test.tsx` **7 条**（新增「未配对但已登录：签码并自动兑换写入 token」，改写「未登录时提示引导码兜底」）；`npm run check:all` 全绿。

**上上轮**：2026-11-08（**设置页新增「关于」：版本号 + 更新日志**）
**范围**：纯展示，不改业务数据、同步 schema 与任何写库路径。
**① 新 tab**：`SettingsPage` 的 `TABS` 增 `about`（图标 `info`），`AboutTab` 并列展示两个版本号 —— **应用版本**取 `package.json`（构建期 `__APP_VERSION__` 注入，vite / vitest 同源，源码不抄第二份）、**最新发布**取 CHANGELOG 中首个已发布里程碑。两者刻意不合并成一个号（AGENTS §7 的两套版本号）。
**② 更新日志**：新增 `modules/settings/changelog.ts`，`?raw` 引入仓库根 `CHANGELOG.md` 并解析 `##` 段落；只收 `vX.Y.Z` 与「未发布」，跳过「记法约定 / 更早（未打 tag）」；正文复用笔记模块 `renderMarkdown`（marked + DOMPurify）渲染，默认展开最新版本、点行折叠/展开。
**③ 为什么不在前端维护第二份日志**：CHANGELOG 是版本变更唯一事实源，复制一份必漂移；解析器抽成纯函数，边界（正文 `###` 小标题、`---`、非版本章节）由单测锁住。
> **本轮验证**：`changelog.test.ts` **4 条** + `aboutTab.test.tsx` **2 条**；`settingsSmoke` 由 8 tab 扩到 **9 tab**；`npm run check:all` 全绿；`npm run build` 通过（`__APP_VERSION__` 与 `CHANGELOG.md?raw` 均能从构建产物正常注入）。

**上上上轮**：2026-11-03（**停用「团队笔记」概念：速记只通向待办**）
**① 速记卡只留一个出口**：删掉「归入团队笔记」大按钮与暂存区每行的「归笔记」；`convertDraft` / `convertStashed` 收窄成只转待办，`to === 'note'` 的分支与提示语一并删除（不留「看着能用、其实没人调」的暗路）。领域函数 `convertQuickNote(..., 'note')` **保留**（有用例覆盖），将来恢复入口只需把按钮加回来；用户可见的「归入团队笔记」提示与归档链接 title 同步改口。
**② 通知项停用团队 Webhook**：「企业微信 / 钉钉 Webhook 协同同步」从通知设置列表移除；`settings.notifications.webhook` 字段保留，不迁移数据。
**③ 外观预览示例文案中性化**：「团队协作网格 / 在团队协作中」→「信息网格 / 在日常记录中」——那只是排版预览的假文案，但会让人以为真有能力。
**④ 笔记来源留痕改口**：`quickCapture.ts` 的 `noteOrigin` 从「由…转入团队笔记」改为「由…转入笔记」（3 条通道 + 对应用例断言）。这段文本会写进笔记正文，留着「团队」等于概念没删干净；已存在的旧笔记里的历史文本不动。
> **本轮验证**：`npx tsc -b` / `eslint` 干净；`npm run check:all` **全绿 —— 1142 passed / 0 failed / 7 skipped（141 个文件）**（无新增用例：改动是 UI 可见性与调用链收窄）。

**上一轮**：2026-11-03（**仪表盘去掉页面级标题；工作区收成单一「个人空间」**）
**① 删掉首页标题**：`AppLayout` 的 `TITLES['/'] = 'Focus Synchronizer'` 移除，路由为 `/` 时不再渲染页面级标题（仪表盘自己已有「下午好，阿蓝」问候，再挂一行英文名属纯旁白 —— 2026-10-14 已裁过「UI 不做页面级旁白」）。顺带说明：`NAV_ITEMS` 兜底会把 `/` 匹配成「工作台」，所以必须显式置空，不能只删映射。
**② 工作区改为单一「个人空间」**：`WORKSPACES` 从两项（`ws-main` 团队协作者 / `ws-personal` 个人空间）收成一项 `{ id: 'ws-main', sub: '个人空间' }`；`DEFAULT_WORKSPACE_SUB` 同步改为「个人空间」。切换器按 `WORKSPACES.length > 1` 判定：只有一项时不显示下拉箭头、点不开面板、也不再许「加入工作区（即将上线）」的愿 —— 单选项的"切换"是假的。等真有多工作区再放出来。
> **本轮验证**：`npx tsc -b` / `eslint` 干净；`npm run check:all` **全绿 —— 1142 passed / 0 failed / 7 skipped（141 个文件）**（本轮无新增用例：改动是渲染层文案与可见性）。

**上一轮**：2026-11-03（**Web 端改为「服务端唯一真源」：浏览器不再持有第二份真源**）
**背景（正式站实况）**：镜像部署后服务端 8 个业务集合全 0，浏览器打开却仍是 ¥18.5 万演示数据。根因是 Local-First 下浏览器本地库**本身就是一份真源**，同步只做 LWW 合并、从不删除本地多余行，于是「服务器被清空」在页面上不可见，两端都以为对方错。用户裁决：**Web 版就是服务器上的那一套；离线由桌面端承担，Web 不做离线兜底。**
**① 写入直达 PB**：新增 `storage/serverFirst.ts`（`createServerFirstAdapter`）—— `put/update/delete` 先打 PocketBase，**服务端成功后才落 Dexie**（Dexie 从此只是镜像）；`enqueue` 变 no-op（没有队列，也就没有「攒着等同步」的窗口）。被 LWW 判为过期或远端是墓碑时**不写镜像**，2s 去抖触发一次对齐，让镜像跟随服务端。
**② 启动与周期全量对齐**：新增 `sync/convergeFromServer.ts` —— 逐表拉服务端全量，**远端没有的本地行物理删除**；远端有的行**先删本地再 `mergeRemoteRecord`**（必然走「新建」分支 ⇒ 绕开 LWW 的「本地更新则不覆盖」，实现远端必胜）。复用既有归一化，不自写第二套（json 三形态、墓碑、localId 还原、link 派生都在那里）。`attachments` 一并纳入，但**内容没变就跳过重下**（比对 `updatedAt` + 本地是否已有文件）——否则每 60 秒把所有附件重下一遍。
**③ 只对 Web 生产生效**：`platform/env.ts#isServerFirstWeb()` = `import.meta.env.PROD && !isTauri()`。`main.tsx` 覆盖适配器注册，并跳过 seed / backfillDemoRelations / `autoConfigureSameOriginSync` / `syncEngine.start`；`AuthGate` 放行后动态 import 对齐一次（token 只有登录后才有，启动时对齐必然失败）。**桌面端与 dev 完全不变**。
**④ 摘掉 Web 的离线壳**：`public/sw.js` 导航从「network-first + 回退缓存 `index.html`」改为**只走网络**，断网返回 503 提示页；缓存名 bump 到 `nexus-static-v3`。旧行为是断网也能打开旧页面、再读本地库 —— 正是这次事故的复现路径。
**⑤ token 键收口**：新增 `shared/authToken.ts`（`AuthGate` 与服务端直连适配器共用同一份键与读取口），避免存储层反向依赖 React 组件。
**⑥ 徽章改说人话**：`sync/badge.ts` 增加 `mode: 'server'` 分支 —— Web 生产显示「服务器／无法连接／对齐中」，不再出现「仅本机／待推送 N 条」这种描述不存在对象的文案；`AppLayout` 按 `isServerFirstWeb()` 传 mode。
**⑥′ 对齐兼作连通性探测（真机验收当场发现并修）**：首版上线后徽章**永远停在「检测连接…」**——因为 server-first 下同步引擎没启动，而连通性一直是由引擎心跳写的。新增 `runConverge()`：对齐前写 `checking`，成功写 `online/synced/lastSyncAt`，失败写 `offline/lastError`；生产三处调用点（`main` / `AuthGate` / 设置页）全部改走它，`convergeFromServer` 保持纯函数供测试。
**⑦ 设置页换掉旧的同步表单**：server-first 下「云端同步」页签改为一张卡片（数据在服务器上 + 「以服务器为准重新对齐」按钮），隐藏服务器地址/同步账号/全量推送 —— 那套是「本地库 + 手动接中心」的旧模型。
**⑧ 补齐用例**：新增 `storage/__tests__/serverFirst.test.ts`（8 条）+ `sync/__tests__/convergeFromServer.test.ts`（7 条，含 `runConverge` 的 online/offline 状态上报），锁住「先服务端后镜像／跳过不写镜像／失败抛错不落库／本地专属表不上行／远端必胜／附件未变不重下／未登录抛错／对齐即探测」。⚠️ 两个坑记下来：① 测试里**不能 `vi.mock('@/sync/pocketbaseAdapter')`**（会把同模块其他导出抹成 undefined 拖挂并发用例），改用依赖注入；② **fake-indexeddb 不能可靠往返 Blob**，附件用例用「有 `size` 的对象」这个最小等价形状，实现侧的判据也据此写成鸭子类型（不用 `instanceof Blob`，跨 realm 会假阴性）。
**⑨ 为「桌面端连服务器」补一条前置修正**（用户 2026-11-03 决定：桌面端要连）：`ServerFirstAdapter` 的 `delete` 不再一律物理删——**活记录**先在服务端落墓碑（`deleted:1` + `updatedAt` + `rev+1`）再删镜像；**墓碑记录**才走物理删（说明墓碑已收敛，对应回收站 30 天清理）。不这么改，脱机设备只要还持有活副本，下次 push「查不到远端」就会 POST 新建，把已删记录复活。同时实测服务端对桌面端 origin 放行：`OPTIONS` 预检回 `access-control-allow-origin: *`、`allow-headers: authorization`，`index.html` 的 `connect-src` 已含 `https:` ⇒ **网络层无障碍，桌面端无需改代码即可接入**。
**⑩ 同步登录与页面登录同口径**：新增 `shared/authIdentity.ts#toLoginIdentity`（不含 `@` → `<小写>@workhub.local`），`AuthGate` 与 `pocketbaseAdapter.login` 同时改用它。此前同步登录直接发裸用户名，而 PB 的 `identityFields` 只有 email ⇒ **桌面端接服务器时填「用户名」必然 400**（页面能登、同步登不上，最难查的一类形态）。现在三处（页面 / 首启 / 同步）同一套映射。
> **本轮验证**：`npx tsc -b` 与 `eslint` 干净；新增 15 条用例全过（`serverFirst` 9 条含墓碑/物理删两条分支、`converge` 7 条含 `runConverge` 状态链）+ `authIdentity` 3 条；`npm run check:all` **全绿 —— 1142 passed / 0 failed / 7 skipped（141 个文件）**。
> **真机验收（2026-11-03 03:0x / 10:4x，正式站 `646a171` → `aaf6189`）**：无头 Chrome 持临时账号打开首页 —— 控制台出现 `[server-first] Web 端启用…` 与 `已与服务端对齐：写入 0 条、清理 0 条`；首屏全空（累计收款 ¥0 / 0 位客户 / 今日待办 0 / 暂存区 0），`18.5` 与「仅本机」字样均不出现；非登录页（token 生效）；徽章显示「服务器」。**写入链路也实测通过**：在页面「随手速记」输入并点「转入待办」后，服务端 `todos` 出现 1 条（`localId = ws-main:td:SxDBLyMaOL`，标题与输入一致）、`quickNotes` 1 条 —— 证明「写直达 PB」真的落到服务器，不只是写了浏览器镜像。验收后已删除该临时账号与 2 条测试记录，服务端恢复为空（`users=1` 仅用户本人账号，其余集合 0）。⚠️ 首轮发现徽章停在「检测连接…」，即上文 ⑥′。
⚠️ **仍待办**：`docs/多端App改造方案-Tauri.md` 里「桌面端是否要连服务器」还没定（当前按纯本地实现，**本轮不动桌面**）；server-first 只覆盖业务表，`focusSessions`／`trashBatches` 仍是纯本地（设计如此，不参与对齐）。

**上一轮**：2026-11-02（**认证口径复核与收尾**：用户名退成展示字段）
**范围**：接下面的「首启自助注册」，只补测试锁、统一文档口径、清理旧脚本，不新增功能。
**① 首启请求必须传原始用户名**：`/setup/user` 收用户输入，后端校验「不能含 @」并自行拼 `<用户名>@workhub.local`；只有登录端做映射（`AuthGate.toIdentity`）。`authGate.test.tsx` 补了请求体断言 —— 此前误传映射值也能全绿（已做变异校验：还原旧写法该用例变红）。
**② username 退成可选展示字段**：`passwordAuth.identityFields` 固定只有 `email`（0.40 文本字段无 UNIQUE，加 username 必被拒）；首启只 best-effort 补字段，**补不上就不往建号请求里带**（否则 PB 以未知字段 400，首启锁死）。旧的 `patch:users-auth` 脚本与 npm 命令已删除，已有部署无需任何 patch。
**③ 占位邮箱统一小写**（真机发现的边界）：PB 0.40 **不归一化邮箱大小写**（实测 `Alice@...` 与 `alice@...` 是两个值）。现在 `parseSetupInput` / `AuthGate.toIdentity` / `entrypoint` 三处都用 `<用户名 小写>@workhub.local`，username 仍按输入展示 —— 注册 `Alice` 后输 `Alice` 或 `alice` 都能登录。
**④ 兜底管理员只按 email 建号**：`entrypoint.mjs` 的 filter 不再引用可能不存在的 `username` 字段（新库查询会 unknown field 400）；建号也不写 username。
**⑤ 顺带**：`AuthGate` 三处表单统一用设计系统 `Button`（补 `type` 透传）；`todoRowDetail` 深链清参断言改为等待导航落地（修全量并发下的假红）。
> **本轮验证**：`setupRoutes.test.mjs` **14 条** + `authGate.test.tsx` **8 条** + `buttonSubmit.test.tsx` **1 条**；`npm run check:all` 全绿 —— **1123 passed / 0 failed / 7 skipped**（138 文件）。**真实 PB 0.40.2 空库冒烟全过**（临时目录、未进仓库）：全新库按 email filter 查询 200 / 兜底管理员建号 200 / `hasUsers=false` / setup 建号 200 / 映射邮箱自动登录 200 / 第二次 409 / 大写用户名归一化后大小写均可登录。
⚠️ **状态**：代码已提交，推送与线上部署以 git / 发布记录为准。

**上一轮**：2026-11-02（**首启自助注册：用户名与密码由用户自己设**）
**背景**：账号此前只能由容器按 `WORKHUB_ADMIN_USER/PASSWORD` 写死创建（`admin` + 公开默认密码 `password`），既不是用户自己的账号，还得靠「强制首改」补救。
**① 后端 `/setup/*`**（新增 `scripts/setupRoutes.mjs`，`scripts/serve.mjs` 挂载）：`GET /setup/status` 用超管凭据查 `users.totalItems === 0`；`POST /setup/user` 仅在空库时建号（否则 **409「已完成初始化」**），identity 3–32 位、密码 ≥8 位，PB 的 400 原话**透传**（重复用户名不吞成「创建失败」）。两条路由**刻意不用 `/api` 前缀** —— 那条被 entrypoint 整体转给 PB。页面无 token 也能调，但建出第一个账号后接口自动失效（判据是空库，不需要另加开关）。
**② 登录标识 = 邮箱，用户名只作展示**：PB 0.40 的文本字段没有 UNIQUE 约束，`identityFields` 里不能放 username。建号邮箱 = `<用户名>@workhub.local`（`parseSetupInput`），登录时前端把不含 `@` 的输入补成同一邮箱（`AuthGate.toIdentity`）—— 登录框写「用户名或邮箱」仍然成立。username 只用于展示，首启时 best-effort 补字段。
**③ 前端 `AuthGate`**：挂载先问 `/setup/status`，`needsSetup:true` 出「初始化工作台」（用户名 / 密码 / 确认密码，两次不一致就地报错），建号后**直接用该账号登录**进应用；`needsSetup:false` 保持原登录页。顺手删掉登录页那句「页面不提供自助注册」（已不成立，也属页面旁白）。
**④ `/relay/auth-status` 的启用判据**多一条「`users` 已有账号」：否则没配 `WORKHUB_ADMIN_*` 的部署在自助注册完仍回 `enabled:false` 直接放行，用户刚设的密码形同虚设。PB 不可用时仍按未启用处理，**fail-open 不变**。
⚠️ **与兜底管理员的关系**：`WORKHUB_ADMIN_*` 保留（env 配错/服务器异常时的自救入口，`entrypoint.mjs` 逻辑未动），但**两者取一** —— 配了它容器启动就建出 `admin`，首启引导随即不再出现。compose 的默认值已改为**空**（`6277aa4`），开箱即走页面自助注册；要用兜底管理员就显式填这两项（见 `deploy/docker/README.md`）。
> **本轮验证**：`scripts/__tests__/setupRoutes.test.mjs` **13 条** + `authGate.test.tsx` **+3 条**；`check:all` 全绿 —— **1121 passed / 7 skipped**。

更早轮次见 [本轮归档](PROGRESS-archive-20261111.md)。

## 一、当前状态总览

| 项 | 状态 |
|---|---|
| 个人助手第三版 | ✅ 完整视图/有界缓存及原库升级完成；devtest 96fdfc6；1213+7门禁、实站独立审计放行（Android/视觉边界见报告） |
| 版本 | 第三次交付（阶段五、六）完整个人视图、共享客户端协议和综合验收完成；前轮已推送 GitHub `codex/reliability-20261111`（a5787f6），未合并 main、未打 tag；本轮 HTTP 兼容补丁已通过 1214+7 门禁，待部署收口 |
| 全站回收站 | ✅ 代码与 `/trash` 页面已落盘；**服务端 Schema 已升级**（14 个集合 `restoredAt` + 7 个父级 `trashSnapshot`，2026-10-24 双站导入完成；2026-10-26 复查两站 `check:schema` 均「完全一致」） |
| 测试环境 | devtest 原库运行 **96fdfc6**，active/running、0重启，1 CPU/768 MiB；入口已开放 **9630 公网 HTTP**，首页/JS 200，登录开启、匿名 MCP/同步 401，30项认证通过；内部9631/9633仅回环，旧9001不使用。HTTP兼容补丁待部署 |
| 里程碑 | M1-M6 全部验收 ✅ |
| 服务端 Schema | 28个配置集合（20业务+8同步/命令/凭据，users由初始化管理），Dexie v18；**1794355200/5201/5202/5203均已部署冻结**。客户端缓存schema6/protocol1，业务副本schemaVersion5；后续只能新增迁移编号 |
| 审计问题 | 2026-10 历史批次 P0×2 / P1×19 / P2×60 **全部清零**。**2026-10-26 全仓复审**：P0 = 0 / P1 = 3 / P2 = 12（报告 `docs/审计报告-全仓-20261026.md`），其中 P1 三项已整改（事实源校正 / CI 门禁 / 文档口径），**`zod < 4.6.6` 高危仍待拍板**；P2 已修 10 项、3 项如实挂起 |
| 同步机制完善（历史问题跟踪，当前协议见第三版） | P0-1 墓碑清理竞态修复 + P0-2 推送侧 LWW ✅；P1-3 服务端墓碑 cron ✅；**P1-4 HTTPS/PWA 未闭环**（2026-10-09 更正，见下方 P1-4 行与「二、遗留问题」）；正式环境 `team.fpigeon.fun` 已上线（LE 证书 + `http→https` 301），但 **PWA 装机/离线能力需在该正式域名上复验**；Issue #140 多关联 json 字段已入 `collections.json`（**自托管端需重新导入并重启**，见部署指南） |
| 正式环境（历史台账，本轮未访问/未核验） | **https://team.fpigeon.fun** 已部署运行（2026-10-09）。CNB 制品库 `docker.cnb.cool/blueteam0715/workhub:latest` → 主机 `1204pigeon`(<PROD_HOST>) 的 `/opt/workhub/`，**单容器全包**（前端 + relay + PocketBase，同源路由；**不含 Tauri 手机端/桌面端**），只绑回环 `127.0.0.1:8790` + 宿主 nginx 反代（acme.sh 单独签发的 TLS）。数据持久化在 `/opt/workhub/data`；资源上限 768m / 1.0 核 / 256 PIDs。**已关闭 `users` 集合的公开注册**（PB 默认 `createRule` 为空 = 任何人可自助注册，而业务集合规则是「登录即可读写全部」→ 组合起来等于公网裸奔；现设为 Locked，账号改由超管手工建。⚠️ **该设置只存在数据卷的 `data.db` 里、不在代码里**，换机/重建空库后需重做一次）。流程、端口占用、排错与这条加固步骤见 `docs/Docker镜像构建与部署.md`。⚠️ **2026-10-21 已升级**：镜像 label `org.opencontainers.image.revision` = **`cd74317`**（此前停在 `20dac51`/10-10，落后 47 提交）。同批完成 schema 导入 → 业务集合 **19 → 20**（补 `agent_events` + `customers.groupId` + `customerGroups.kind`），`check:schema` 对线上输出「**完全一致**」。判据不靠猜：线上主包含 4 个新工具名（各 2 处）、容器日志确认「20 个集合均已存在，跳过导入（幂等）」。⚠️ **正式站业务数据全为 0 条**（自上线以来就是空库），故本次升级零数据风险。**现状台账 / 上线判据 / 首次验收清单 / 回滚口径见 [`docs/正式站状态与上线清单-20261026.md`](正式站状态与上线清单-20261026.md)**（2026-10-26 实测：镜像 `cd74317` 落后 main **26 提交**，schema 已 21 集合一致 —— 「新 schema + 旧代码」，**先部署再录数据**）。**2026-10-27 进展**：制品库 `latest` 已到 `a5f6bdf` 且**质量门禁每次 push 均通过**；**正式站已部署到 `a5f6bdf`**（容器 healthy / 21 集合幂等跳过导入 / 公网四端点 200 / `check:schema --prod` 完全一致），部署前已备份 `pb_data.bak-20261027-002612` 并打回滚 tag `workhub:rollback-20261027-002557`。⚠️ **本行此前写的「镜像 `cd74317`」是过时记录**：上机实测部署前实为 `ab0d253`（10-26，落后 main 仅 5 提交），误判来源与纠正判据见 `docs/正式站状态与上线清单-20261026.md §二` —— **判断线上版本只认主机 `docker image inspect` 的 revision label，不认文档记录**。**正式站部署无留痕机制**（`.deploy-state` 只记测试站）已列为待补 |
| 多端 App（Tauri v2） | **当前没有已交付并验证的新版正式App**。第三版仅完成未来原生端的endpoint、认证、隔离缓存、在线适配器和前台恢复基础接线/自动分支测试；未装SDK/NDK、未运行CI、未构建新APK或真机验证。旧2026-10/11构建产物只作[历史记录](多端App改造方案-Tauri.md)，不证明支持当前协议；旧库/队列保留待核对 |
| Changelog | **已改为版本级**（2026-10-09）：发版本时往根 `CHANGELOG.md` 追加一节，**不再逐条记流水**；日常记录见本文件与 git 提交历史。旧逐条表格（#1~#128）已归档至 `docs/CHANGELOG-详细流水-v1.0.0至v1.2.1.md` |

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
| M6 多端同步 | 当前为在线命令 + 有界增量缓存 | ✅ 独立双缓存/MCP 已验证；旧离线写入是历史里程碑，不代表当前客户端可离线复合入账 |

## 四、架构定案速览

- **终端路线**：Web 优先（当前）→ PWA 过渡（manifest+SW 已就绪，待 HTTPS 激活）→ Tauri 2 原生三端（Android/Win/mac）
- **数据**：本地 IndexedDB/Dexie 为读写源（可丢弃工作副本），服务端 PocketBase/SQLite 为**数据真源**，LWW 同步（updatedAt/deleted/rev + 变更队列）
- **存储抽象**：repository + 统一查询 Hook，组件零 Dexie 直连，未来可插拔换 SQLite
- **同步 Schema 升级**：模型演进必须重导入 `pb_setup/collections.json`（见 docs/部署指南.md「Schema 升级流程」章节）；服务端当前 **21 collections**（业务实体 19 + `sync_state` + `agent_events`），本地 Dexie 当前 **v16**（2026-10-26 实测）
- **图标**：内联 SVG（Icon 组件），已彻底移除 4.6MB 字体；新增图标往 `src/assets/icons/` 放 SVG
- **主题体系**：10 套风格主题包（`THEME_STYLES` as const satisfies 派生 `ThemeStyleId`，除 classic 外明暗两侧均完整 19 token）+ 12 强调色 + 12 字体预设（`FONT_PRESETS`/`FONT_STACKS` 定义于 shared/theme.ts；`SettingsAppearance.theme` 类型收窄为 `ThemeStyleId`；effects.ts 启动/切换先 removeProperty 清空 19 个 `--color-*` 再按侧覆盖，classic 空覆盖回退 index.css；字体仅映射 `--font-sans` 系统字体栈，不加载网络字体）

## 五、待办与挂起事项

### 需要用户操作（不阻塞开发）

| 事项 | 说明 |
|---|---|
| **正式站 AI 桥（唯一剩余）** | 新版已上线（`cd74317`）+ schema 已同步。需在浏览器打开 `https://team.fpigeon.fun` → 用 `demo@nexus.local` 登录（密码见 `.deploy.env` 的 `PROD_APP_PASSWORD`，2026-10-22 已重置并验证登录 200）→ 设置 → AI Agent 桥 → 启用。**这一步自动化不了**（桥的执行体在页面进程内、要访问 IndexedDB），启用后 `node relay/mcp-stdio-shim.mjs --verify` 才能列出 **37 个业务工具**（+ `confirm_preview` = 38 条 `tools/list`）；此前报 `-32001` **不是配置错** |
| 双端真机日常使用 | 手机+电脑配同步各一次，用几天验证 LWW/断网补传实际体验 |

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
| 列表页落位（2026-10-10 改版） | ✅ 分层**不再进左侧「客户分组」栏**（该栏只放用户自定义分组）；收进工具栏「亲密度」浮层，作为**与自定义分组叠加**的筛选条件；顶部统计卡一并去健康度化（客户总数 / 本月新增 / 待跟进 / 待回收款）。详见「最后更新」 |
| 待人工 | ⚠️ 服务端需重导入 collections.json（新增 module_configs 集合）+ 一次全量推送；⌘K/选择器/时间线黑名单屏蔽开关已留好口径，消费点接线为后续小增量 |
| 配置页状态模型修复（功能测试 #22） | ✅ 已修（Changelog #103 / D3）：原用 `useState(cfg.algorithm.weights)` 取初值，而 `useIntimacyConfig()` 首帧返回 DEFAULT（`useLiveQuery` 未完成），**`useState` 初值只认首次渲染** → 库内生效值（实测 `58/18/12/12`）与界面（恒为默认 `30/30/20/20`）长期脱节，用户无法得知生效值。改为「库值为真源 + 草稿覆盖」（`weightsDraft` / `thresholdsDraft` / `levelsDraft`，`null` 即展示库值，库值追平后自动清草稿）。顺带修：滑杆补 `onKeyUp`（原只绑 `mouseup`/`touchend`，键盘调整不保存）、自动修正提示改走 `flash`（原被 `flash` 的 `setError('')` 覆盖，导致「已归一化」提示看不见）、滑杆 `step` 5→1（避免归一化值 58% 被显示对齐成 60%） |

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
| P1-4 HTTPS 部署补齐 PWA | ⏸ **未闭环（2026-10-09 更正）**：原判「✅ 已闭环」的依据是一个**现已作废的接入域名** —— 测试环境实际是**明文 HTTP + IP**（无域名/无 HTTPS）。而 **PWA / Service Worker 必须 HTTPS 安全上下文**，故该结论不成立；需在**正式环境 `team.fpigeon.fun`**（CNB 镜像部署）上重新验证。（与 SW 注册时机无关的 `main.tsx` 注册缺陷已于 Changelog #103 / D2 修复，那部分结论仍有效） |
| 功能测试 #100 配置集合同步 404 | ✅ 已修（Changelog #103 / D1）：新增 `PB_COLLECTION_NAME` 映射 + `pbCollection(table)` 单一出口（`pocketbaseAdapter.ts` 内 8 处 URL 拼接全部收敛）；服务端 `module_configs` 与前端 `moduleConfigs` 的差异显式声明，并加 parity 测试锁定（含「不存在未声明的同物异名」反向断言） |
| 功能测试 #192 / #193 PWA 离线失效 | ✅ 已修（Changelog #103 / D2）：干净 profile 首次访问 `getRegistrations()` 由 **0 变 1**、`controller: true`；断网 reload 可正常打开且页面完整渲染 |
| P0-3 删除不跨设备传播（双端实测暴露，已修） | ✅ Changelog #114：delete 推送**只写墓碑、不做物理删除**（服务端保留墓碑供对端增量拉取，30 天由 cron 清理）；`mergeRemote` 的「本地未推送编辑保护」不再屏蔽**更新的远端墓碑**（`&& !revived.deleted`）。两条根因缺一仍会永久不一致。离线回归 5 例 + 线上复验（真实适配器打真实 PocketBase）双向验证；**测试环境尚未重新部署** |
| PR #6 评审遗留（后续迭代，不阻塞合并） | ① **已修（Changelog #117，方案 A+B）**：pull 落库的墓碑无 `tombstonePushed` 标记 → 原 `cleanupTombstones()` 只认标记，这类墓碑**永不被清**。现保留条件放宽为「**有标记 或 队列中已无该记录的待推送条目**」（A），并在 `mergeRemote` 远端墓碑分支加 `if (!local) return 'skip'`（B，不为从未持有的记录写墓碑）。「是墓碑就清」的方案 C 明确不做（会清掉 delete 尚未送达服务端的墓碑）。② **已修（Changelog #114）**：原「delete 推送后立即物理删服务端记录、离线设备收敛窗口短」正是 P0 本身 —— 已改为靠服务端 cron 30 天保留期清理，见上行 |

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

### AI Agent 调用能力（Issue #33，agentOps P1 七步 + P2 动作扩面已交付；共 27 个工具）

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
| 能力白名单 | ✅ settings `ai` 段（`SettingsAi`/`AiDomain`，仅本地不进同步）+ `DEFAULT_AI_DOMAINS` 兜底；`visibleToolNames`/`listVisibleTools` 出 tools 清单、`dispatchAgentTool` 分发闸门（白名单外直接拒绝，不含来源判断）；配置页已交付（`modules/settings/AiBridgeSection.tsx`：启用开关 / relay 地址 / token 生成·复制·重置 / 按域开关） |
| 消解器 `resolveEntity` | ✅ `src/agent/resolver.ts`：候选池只走活记录（同 `useCollection` 过滤 `deleted`）、按 id 去重后数唯一、去重后唯一才静默消解、命中数 > 5 强制反问、空/过短输入前置拦截、候选上限 10 且投影仅 `id/type/label/sub/archived`（不含 relations 与全字段）、Project 归档态先映射后沉底 |
| 第 5 步 打卡收口 `checkinHabit` | ✅ 收口原 3 处内联重复（`HabitsPage` / `dashboard/cards` / `shared/effects` 专注联动）：`checkinHabit(habitId,date,{evidence})` 返回 `{created}` 且**仅实际新建才 emit** `habit:checked`（事务 commit 后），`uncheckHabit` 软删确定性 `habitLogId` 派生 id、不 emit；`dashboard` 软删入口由「按 existing.id 删」统一为确定性 id，消除两套删除语义 |
| 第 5 步 读工具集 | ✅ `src/agent/reads.ts`：`searchEntities`（≤20，复用 `searchAll` 6 实体投影，notes 字段裁剪不含 markdown）/ `getCustomer`（投影不含 relations 全量，仅 `relationCount`）/ `listTransactions`（≤50，金额/日期/状态/customerId/ledgerId，不含附件）/ `listTodos` / `listLedgers` / `listHabits`（各 ≤50）；一律只走活记录、超限**截断并返回 `truncated`** |
| 第 5 步 写工具 `habit_checkin` | ✅ 走收口函数，幂等（目标态语义，重试安全），`undo:true` 取消打卡不 emit，习惯不存在返回可操作错误；白名单域 `habit` |
| 第 4 步 本地 Relay | ✅ `relay/`（Node 进程，零新增依赖）：`ws-server.mjs` 最小 RFC6455 服务端（node:http 升级握手 + crypto 校验 + 掩码解帧/分片/ping-pong/close）、`mcp-relay.mjs` 标准 MCP 路由（`initialize`/`tools/list`/`tools/call`/`ping`）+ 接入 token 校验 + 一次性 `confirmToken` 台账（5 分钟 TTL、核销即删、防重放）、`index.mjs` 双入口同进程（stdio `--stdio` 与 WS 并存）。只绑 `127.0.0.1:8787`，**只转发、零特权**（不 import repositories） |
| 第 4 步 浏览器侧桥 | ✅ `src/agent/bridge.ts`：浏览器**主动连出** relay（Outbound WS，浏览器无 listen 能力）；`tools/list` 经白名单过滤（关闭的域不出现）、`tools/call` 只走 `dispatchAgentTool` 唯一入口、中风险无 `confirmToken` 只回预览材料；`src/agent/install.ts` 按 settings `ai` 段决定连/断（缺省关，零影响） |
| 第 4 步 CSP | ✅ 已随「同源内嵌」收敛：`vite.config.ts` 现用 `relayPlugin`（`scripts/vite-relay-plugin.mjs`，`apply:'serve'`）把 relay 挂到 dev/preview 的 `/relay`，**不再注入任何 `ws:` 源**；生产 CSP 由 `index.html` 的 `connect-src 'self'` 覆盖同源 WS（`csp.test.ts` 断言产物不含 `ws:`）。历史上的 `cspRelayPlugin` 已删除 |
| 第 4 步 白名单配置页 | ✅ 设置页新增「AI Agent 桥」标签（`settings/AiBridgeSection.tsx`）：启用开关 / relay 地址 / 接入 token（生成·复制·重置）/ 按域能力白名单开关（关闭即对桥不可见）；token 仅存本地 `settings.ai`，不进同步 |
| 第 6 步 skill 文件 | ✅ `docs/skills/`（**27 个工具**各一份 + `README.md` + `mcp-tools.json`），由 `scripts/gen-skills.mjs` 从 **`src/agent/skillSource.ts`（agentOps zod schema）同一份定义**生成；含参数表（`zodToJsonSchema`）/副作用/风险级/幂等语义/实体引用规则/典型说法/确认流程。生成器**复用运行期同一份 `src/agent/jsonSchema.ts`**（此前有内联拷贝与运行期漂移，已修，见下方补录） |
| 第 7 步 E2E 主干验收 | ✅ `src/agent/__tests__/e2e.acceptance.test.ts`（8 例）+ `e2e.harness.ts`：MCP 客户端（真 WS）→ **真实 relay 子进程** → 页面内 `AgentBridge`（原样复用）→ agentOps → repositories → `fake-indexeddb`；harness 仅注入 Node 侧最小 `WebSocket`（Node 无原生实现）。§9.8 场景（resolveEntity 零候选 → 建客户「王五/深蓝科技」预览→确认 → `fin_createLedger` 建默认账本 → 记 2000 支出 `status=待对账` → 按 customerId 读回账目 → 记沟通读回档案 → 建待办「周五回访王五」→ 查待办）跑通 |
| 第 7 步 补强断言 | ✅ ①relay 记一笔/记沟通 vs 手工调 repository，`transaction:created`/`customer:contacted` 载荷键集逐字段一致；②编辑流水**不再**触发 `transaction:created` 且不新增记录；③读工具投影不含 attachments/relations 全量与条数上限；④无/错 token 被拒 + 白名单关闭域在 `tools/list` 中直接不出现且点名调用被闸门拒绝 |
| 第 7 步 relay 缺陷修复 | ✅ E2E 暴露三处（均补 `relay.harness.test.ts` 真机回归，逐条验证「改回即挂」）：①**连接分流缺失**——Agent 端点（无 `role`）落进 browser 分支覆盖 `browserConn`，唤醒请求发回 Agent 自身致**调用永久无响应**，改为显式二分支（`role==='browser'` 走页面桥 / `role===null` 走标准 MCP 路由）；②**回包信封丢 `ok`**——`onBrowserMessage` 只 `resolve(data)`，下游 `res.ok !== true` 恒真，工具执行成功却一律回「执行失败」，改为 `resolve({ok,data})`；③**`listTools` 信封错位**——清单实际在 `data.tools`，取 `r.tools` 会**静默丢光全部工具** |
| 第 7 步 relay 运维增量 | ✅ `--dev`：**仅本地联调/自动化**下预览响应自动附一次性 `confirmToken`（供脚本跑通「预览→确认→执行」；非 dev 不签发，避免架空确认闸门）；`WORKHUB_RELAY_DEBUG=1`：打印浏览器往返回包，供排查「有回包但客户端收不到」 |
| 测试 | ✅ `eventSink.test.ts` 15、`resolver.test.ts` 8、`whitelist.test.ts` 5、`agentOps.alignment.test.ts` 21、`step5.tools.test.ts` 16、**`relay.bridge.test.ts` 17**（token 拒绝/白名单/confirmToken 一次性与超时/协议完备/真实 WS 帧握手）、**`bridge.test.ts` 9**（zod→JSON Schema 单源、预览拦截、白名单闸门、真实 WS 往返）、**`skill.parity.test.ts` 6**（实现↔skill 源↔生成产物三方一致）、**`csp.test.ts` 4**、**`aiSettings.test.ts` 4**、**`e2e.acceptance.test.ts` 8**（§9.8 主干 + 四条补强）、**`relay.harness.test.ts` 7**（relay 真机回归）；agentOps 合计 **112 条全绿**（全仓 128 条） |
| 未开工（后续） | ⏳ 会话历史落 settings、撤销栈、离线规则模板兜底。观察项：`habit` 域无「创建习惯」工具（Agent 只能打卡 / 删除，无法新建）。注：P2 动作扩面（编辑/删除/高风险变更）与白名单配置页**均已交付**，不再属未开工 |

**四轮补充（2026-09-11，Issue #134 「今日到期 / 逾期」分开展示）**：① **首页「今日待办日程」按两段渲染**——此前「今天」口径（`isDueToday` = 今日到期 ∪ 逾期未完成）混在一列按截止时间排序，逾期条目会被「今天还没到点」的条目稀释，而恰恰是逾期最需要被看见。现拆为**两个互斥分组**：**已逾期**置顶（红色组头 + 左侧 danger 竖条 + 浅红底 + 「已逾期 2 天 3 小时」时长文案，提示「先补这些」）、**今日到期**在后（蓝色组头 + `HH:mm 到期` + 「按计划推进」）；顶部加「N 逾期」胶囊（为 0 不显示）。② **口径拆分与互斥保证**——新增 `isTodoOverdue`（未完成 + 截止**时刻**早于此刻，按时刻而非自然日：今天 09:00 的待办过了 09:00 就是逾期，否则「逾期」列在当天永远为空）与 `isTodoDueToday`（未完成 + 截止落在今天 + **未过点**，滤掉 `isTodoOverdue` 以保证与逾期组互斥、同一条待办不会在两列重复计数）；两者并集恒等于 `isDueToday`，即**拆分不改变「今天」总量，只改变呈现粒度**（`isDueToday` 保留为含集口径，供待办中心「今天」视图与指标卡使用）。③ **指标卡同步拆数**——「今日待办 · 还剩 N 项」下补一行副读数「今日到期 X · 逾期 Y」（逾期为 0 时不显示逾期项），与日程卡分组同源。④ **待办中心新增「逾期」入口**——左栏智能清单在「今天」之后插入「逾期」（原「今天」不变，含集口径不变；「逾期」是它的收窄子视图，逾期提醒条点进去仍落在「今天」）；新建待办兜底可见性判断同步补 `overdue` 分支。新增 `src/modules/todo/__tests__/dueOverdue.test.ts` 10 条（含并集等价与互斥断言），测试 238 → **248**；lint / tsc / check:icons / build 全绿。

**五轮补充（2026-09-11，Issue #134 逾期改按天口径）**：四轮的逾期按**时刻**判定（今天 09:00 的待办过了 09:00 就进「逾期」组），但用户口径里的「逾期」是**跨天未完成**（过了期限还没交），不是「当天钟点过了」——当天的钟点过了仍在「今日到期」里按计划推进即可，跨天未完成才叫逾期。① `isTodoOverdue` 改为按天：`dayjs(dueAt).format('YYYY-MM-DD') < todayStr`，参数由 `now: Dayjs` 换成 `todayStr: string`（默认取当天）；`isTodoDueToday` 去掉 `!isTodoOverdue` 过滤——按天口径下两组天然互斥（今天 vs 今天之前），今日已过点条目留在「今日到期」组。② 新增 `overdueDays`（今天 - 截止日，自然日差，恒 >= 1），供「已逾期 N 天」催办文案；首页日程卡去掉原「已逾期 X 天 Y 小时」的时分粒度，统一为「已逾期 N 天」。③ 调用点全部改传 `todayStr`：`DashboardPage` 指标卡副读数、`TodayTodosCard` 两分组、`TodoPage` 逾期清单计数 / `overdue` 视图过滤 / 列表行内「已逾期 N 天」标记 / 新建兜底可见性。修复当天的分组两列来回横跳与逾期天数随时分秒跳动的问题。`dueOverdue.test.ts` 重写为 16 条（按天判定 / 两组互斥 / 并集等价 / `overdueDays` 自然日差 / 终态与无截止不进组），测试 248 → **254**；lint / tsc / check:icons / build 全绿。

**六轮补充（2026-09-12，agentOps 功能性遍历审计 + 两处缺陷修复）**：以「从未适配过本项目的标准 MCP Agent」视角，经**真实 relay（非 `--dev`，强制走「预览 → `confirm_preview` 取票 → 执行」）+ 页面同款 AgentBridge + 真实 IndexedDB** 对 27 个工具逐个遍历，并补 26 条边界用例（新探针 `src/agent/__tests__/functional.sweep.test.ts`，审计报告 `docs/审查报告-agentOps功能遍历-20260912.md`）。① **正向 29/29 全通过**；边界 26 条中 24 条通过，**2 条暴露真缺陷**。② **P1-1 `todo_createTodo` 缺关联校验**：挂靠不存在的客户/项目**静默创建成功**（`executor.ts` 直接 `todoRepo.put`，三项无校验），而 `note_*` / `project_*` 乃至同族的 `todo_updateTodo` 同类场景均正确拒绝 —— create 路径单点遗漏，且 `todo_updateTodo` 自身也漏了 `listId`。修法：抽共用 `assertLinks()`，**6 处关联校验全部收口**（todo_create/update、note_create/update、project_create/update），消灭「每个函数各写一遍」的漂移源。③ **P1-2 生成器与运行期 schema 漂移**：`gen-skills.mjs` 内联了一份「与 `jsonSchema.ts` 同口径」的简化拷贝，运行期修好 union 分支后它没跟，导致 `fin_recordTransaction` 的 6 个关联字段在 skill 文档与 `mcp-tools.json` 里被生成成 `{"type":"number","enum":[null,null]}`（运行期真相是 `anyOf: [string, array]`）。修法：生成器改为复用运行期同一份实现（`skillSource` 再导出 `zodToJsonSchema`），并把 `buildToolsList()` 从 `bridge.ts` 抽出供测试调用，`skill.parity.test.ts` 新增「运行期 schema ↔ `mcp-tools.json` **逐字段深度比对**」与「`listTodos.priority` 不得标必填」两条回归锁 —— 原先只比工具集/风险/域，故此漂移在 464 条全绿下也无人发现。④ **P2-1 `listTodos.priority` 假必填**：zod 为 `.optional().transform(...)`，最外层 `ZodEffects` 被必填判定误判（全量 125 字段仅此 1 处）；后果是 Agent 依 schema 强行传该**过滤器**值，会静默过滤掉本应返回的待办；修法为 `isOptionalField()` 剥包装后再判（`z.string().nullable()` 仍为必填，不误伤）。⑤ 本轮一并补正本文件此前滞后之处（工具数、白名单配置页、`cspRelayPlugin`）。

**七轮补充（2026-09-12，relay 落位 + HTTPS 接入 + 线上验收）**：① **relay 落位（拓扑甲）**：宿主机 nginx 9001 继续托管静态与 `/api`，仅新增 `location /relay` 反代到 `serve.mjs`（systemd `nexus-relay.service`，`127.0.0.1:9100`）。三个不能省的配置：`HOST=127.0.0.1`（`serve.mjs` 默认绑 `0.0.0.0` 且自身没有 host 安全闸门，不设就绕过 nginx 暴露 9100）、`access_log off`（浏览器端点 token 在 URL query，否则凭证落 access.log）、`proxy_read_timeout` 放大到 3600s（relay 无周期性心跳，默认 60s 空闲会被掐断，表现为桥反复重连）。验证：公网 9001/relay 返回 101、`/api/health` 200、站点静态 200。② **HTTPS 接入**：`dev.fpigeon.fun` 经宿主机 80/443 的 docker nginx（容器 `anime-nginx`，宿主机 nginx 只管 9001/9088）接入，**复用既有通配符证书 `*.fpigeon.fun`**（无需重签），全量反代到 `172.18.0.1:9001`。副作用是好的：页面协议变 https 后桥自动推导 `wss://`，此前「relay token 明文过 HTTP」的风险随之消除。③ **验收脚本补 wss 支持**：`scripts/acceptance.mjs` 的 MiniWS 由纯 `node:net` 扩展为按 URL 协议选用 `node:tls`（证书校验保持开启），否则线上上 HTTPS 后验收脚本直接不可用。④ **线上遍历探针**：新增 `src/agent/__tests__/sweep.cases.ts`（本地/线上**同一套**用例与断言，默认走「读工具回读」口径；本地可注入 `records`/`bulkSeedTransactions` 加强为落库级核对）与 `functional.sweep.online.test.ts`（env 驱动，缺 env 则 skip），避免「线上再测一遍」退化成第二套实现。⑤ **前端产物部署 + 线上验收结果**：`wss://dev.fpigeon.fun/relay` 正向 **31/31**、边界 **26/26**、运行期 schema 与静态快照**零差异**，协议层 **11/11**。两个必须记住的教训：**(a)** 只部署 relay 而不重新构建前端，线上跑出的仍是**旧构建**的行为（`B1`/`B5` 照旧失败）—— 探针倒是因此证明了它测的是线上真实产物；**(b)** 探针自身要适配线上：`e2e.harness.ts` 的 `NodeWebSocket` 原本写死 `u.port || 80` 且无 TLS，连 `wss://` 会打到 80 端口拿到 301，需补 TLS（与 `acceptance.mjs` 同款修法）。另外，桥的启用已可用 puppeteer 自动化（桥的执行体在页面进程内，必须走浏览器 —— local-first 的硬边界）。（⚠️ 历史轮次：此处域名 `dev.fpigeon.fun` 已作废，测试环境现为 `http://<TEST_HOST>:9001` 明文 HTTP 无域名）

**八轮补充（2026-09-13，一键接入任意 Agent：`npm run agent:setup`）**：目标是「一条命令把本项目配进任意 Agent 工具」，对标飞书 CLI 的 `npx @larksuite/cli@latest install`（探测 → 写配置 → 提示重启）。① **先补传输层，否则配置写了也白写**：relay 的 Agent 端点是裸 WebSocket，而 Codex / Hermes / opencode / WorkBuddy 的 MCP 客户端只实现 stdio 与 Streamable HTTP —— **没有一家支持裸 WS**，直连方案物理不成立（客户端按 Streamable HTTP 发 POST，relay 只认 Upgrade 握手，426）。新增 `relay/mcp-stdio-shim.mjs`：对 Agent 讲标准 MCP over stdio，对 relay 用 WS 连出，消息原样双向转发；零新增依赖（自实现最小 RFC6455 客户端，与 `acceptance.mjs` / `ws-server.mjs` 同一口径）；**stdout 只走协议**（任何日志进 stdout 都会被上层判为「MCP 协议错误」）、**不冒充鉴权**（token 仅作 `initialize` 的 `accessToken` 透传）。断线策略：入队 + 退避重连，退避到阈值就把队列**逐条回以可操作错误**而不是静默排队（与 relay 侧「桥离线必须回可操作错误」同一纪律）。② **`scripts/agent-setup.mjs` 的通用探测表**：`TARGETS` 一行一个工具（探测依据 = 配置目录或 PATH 命令），七家已覆盖，新工具只加一行、流程不改。**各家格式差异是这一轮最容易写错的地方**：Hermes 用 **YAML 的 `mcp_servers:`**（不是 JSON 的 `mcpServers`）、Codex 用 TOML 的 `[mcp_servers.<name>]`、opencode 有 **V1（名字直接挂 `mcp`）与 V2（`mcp.servers`）两套结构**（从已有配置自动探测，可用 `--opencode-schema` 覆盖）。③ **三件套分工**：MCP 条目 + 规则 + skills。规则只维护一份 —— 新增 `AGENTS.md` 作为**本仓库面向 AI Agent 的唯一入口**（技术栈锁定 / 目录地图 / 常用命令 / 八条硬性工程纪律 / 提交规范 / 禁区 / 协作节奏）；Codex / Hermes / opencode 原生读它，Claude Code / Gemini / Cursor 只写**薄壳**指回去（避免 N 份规则各自漂移）。skills 默认只投一份元技能 `workhub-bridge`（只讲 MCP schema 表达不了的四件事：桥在线是前置条件、中风险「预览→转述→取票→重试」四步、实体消解不许猜 id、读工具会截断），**不默认全投 27 份** —— `tools/list` 已经把工具 schema 给了 Agent，重复投喂只抬高固定成本。④ **三条纪律 + 对应的回归锁**：(a) **不越界** —— JSON 走键合并、TOML/YAML/Markdown 走「托管块」标记，只替换我们写的那一段；Hermes 的 `mcp_servers` 段落合并要**保留用户已有的其它服务器**，遇到行内 flow 写法**宁可报错也不写坏用户文件**（本项目零新增运行时依赖，不引 YAML 库，所以只处理能安全处理的窄形状）；(b) **幂等** —— 内容没变就不落盘（重复运行零 diff，`--dry-run` 因此可信），改前留 `<file>.bak-workhub-agent-setup`；(c) **可回退** —— `--uninstall` 只摘自己写的，不误删用户条目。⑤ **token 只有一个落点**：`~/.workhub/relay.json` 的 `{url, token}`。**项目级配置（`opencode.json` / `.mcp.json`）是可以入库的，往里写 token 等于泄密**，故所有配置里都不出现 token；切环境（本地 ↔ 远程）就是改这一个文件。同时**刻意不设默认地址**：开发/测试阶段站点地址会变，代码里写死等于给所有人埋一个指向临时环境的隐性依赖。⑥ **两个必须说清的口径**：**桥必须人工启用** —— 工具实现在页面进程内（要访问 IndexedDB，relay 零特权不持数据），所以「打开站点 → 设置 → AI Agent 桥 → 启用」这一步自动化不了，`tools/list` 报 `-32001` 时**不是配置错误**，别改参数别重试；**写进配置的 node 路径要耐久** —— 不能直接用 `process.execPath`（可能是包管理器/宿主注入的**带版本号**路径，升级即失效），改为优先挑 `~/.local/bin/node` 这类不带版本号的稳定入口。⑦ **测试**：`stdioShim.test.ts` 7 条（真起 relay 子进程 + 真实 WS 帧，以「普通 MCP 客户端」身份走完握手/清单/调用；断言 stdout 全过程**零条**无法 `JSON.parse` 的行；桥离线与 relay 不可达**都必须有响应**而非挂起；URL 路径写错须**立即失败并指名路径**，不许干等到超时后误报成网络问题）+ `agentSetup.test.ts` 35 条（纯函数：托管块幂等与自愈、YAML 段落合并与保留他人服务器、skills slug 合规、参数解析；集成：临时 HOME + `WORKHUB_PROJECT_ROOT` 下真实落盘，验幂等 / `--dry-run` 不落盘 / `--uninstall` 不误删 / **token 不在可入库文件里** / 缺 `AGENTS.md` 报错）。测试 474 → **516** 全绿；`tsc -b` / `eslint src` / `check:icons` / `vite build` 全绿。详用见 `docs/一键接入-Agent说明.md`。

### 未来项（已定但不急）

- Tauri 2 原生打包三端（repository 层已为 SQLite 预留）
- 灵感闪现接真 LLM（现为规则引擎，评分逻辑已模块化）
- 多工作区数据隔离、成员邀请流程
- 笔记多级子文件夹 / 拖拽移动（现为单层平铺 + 右键/行内移动）
- 笔记版本记录（轻量快照回滚）

## 六、更新规则（重要）

1. **同步时机**：任何改变"状态"的开发动作（完成一个阶段/修复一批问题/新增一个模块/部署变更），必须在**同一个 commit** 更新本文档对应表格与「最后更新」时间
2. **责任主体**：主 agent 与所有子 agent 都遵守；派工时 prompt 中必须包含本要求
3. **与 Changelog 的分工**（2026-10-09 调整）：根目录 `CHANGELOG.md` 按**版本**记摘要、**发版本时**追加；`docs/CHANGELOG-详细流水-*.md` 是历史逐条流水（**已归档、不再追加**）；本文档**原地更新**（当前态快照 + 逐轮记录）。文中「见 README Changelog N」属历史引用，那些条目现位于归档文件
4. **冲突处理**：若发现本文档与代码实际状态不符，以代码为准，并立即修正文档

---

*本文件由 yingshu0218 于 2026-09-07 建立。*
