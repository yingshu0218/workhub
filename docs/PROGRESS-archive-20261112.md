# 寻鸽工作台 · 2026-11-03 至 11-02 轮次归档

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
