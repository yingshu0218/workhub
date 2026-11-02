# 寻鸽工作台 · 开发进度文档

> **本仓库的唯一进度事实来源。** 所有人（含 AI 开发代理）推进或变更任何开发工作，必须在**同一个 commit** 里同步更新本文件对应状态。README 底部的 Changelog 记录"发生了什么"，本文档记录"现在处于什么状态"——前者追加式流水，后者始终反映最新全貌。
>
> ⚠️ **环境口径（读下面历史轮次前必看）**：**测试环境已于 2026-10-31 下线** —— devtest 上的 `/opt/pocketbase`、systemd 单元、nginx 9001 站点与备份**全部删除**，`npm run deploy` 那条源码部署通道**不再存在**；**当前唯一环境 = 正式站 `https://team.fpigeon.fun`**（CNB 出镜像 → 服务器 `docker compose pull && up -d`）。域名 **`dev.fpigeon.fun` 已作废**（2026-10-09 全仓清理）——**本文正文中凡出现该域名，一律是历史轮次记述，不代表当前环境**。权威口径见 `docs/开发测试环境说明.md`。

**最后更新**：2026-11-03（**Web 端改为「服务端唯一真源」：浏览器不再持有第二份真源**）
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
> **本轮验证**：`npx tsc -b` 与 `eslint` 干净；新增 15 条用例全过；`writeThroughStorage` + `authGate.test.tsx` 通过；`npm run check:all` **全绿 —— 1138 passed / 0 failed / 7 skipped（140 个文件）**，较上轮 +15 条。
> **真机验收（2026-11-03 03:0x，正式站 `646a171`）**：无头 Chrome 持临时账号打开首页 —— 控制台出现 `[server-first] Web 端启用…` 与 `已与服务端对齐：写入 0 条、清理 0 条`；首屏全空（累计收款 ¥0 / 0 位客户 / 今日待办 0 / 暂存区 0），`18.5` 与「仅本机」字样均不出现；非登录页（token 生效）。⚠️ 首轮发现徽章停在「检测连接…」，即上文 ⑥′。
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

**上一轮**：2026-11-01（**Android 包改由 GitHub Actions 构建；CNB → GitHub 镜像同步停用**）
**背景（均为实测，非推断）**：① CNB 侧虽已写好 `.android-builder-image` + `.android-apk` 两个 job，但那套要自建约 3GB 的 android-builder 镜像，且 `compileSdk` 被腾讯镜像站绑死在 36；② **本机直接出包也不成** —— 实测 JDK / Android SDK / NDK / rust android target **全都没有**（`java` 都找不到、`ANDROID_HOME` 为空），10-27 那个 APK 不是在当前这台 Mac 上编的；③ GitHub 的 `ubuntu-latest` 预装 Android SDK、Google 源直连，整套镜像维护成本直接消失。
**① 新增 `.github/workflows/android.yml`**：`workflow_dispatch` 手动触发（`abi` = arm64/universal、`build_type` = release/debug）+ `push: tags v*`。流程＝腾磁盘（免费 runner 可用约 14GB，删 dotnet/boost/ghc/CodeQL，**不删** `/usr/local/lib/android` —— 那是预装 SDK，删了要重下）→ node 22 / temurin 17 → `android-actions/setup-android` 装 `platforms;android-36` + `build-tools;36.0.0` + `ndk;27.0.12077973` → 4 个 rust android target → `npm ci` → 从 secrets 写 `keystore.properties` → `npx tauri android build --target aarch64 --apk` → 上传 artifact（30 天）+ tag 触发时 `gh release upload`。⚠️ 构建命令**刻意不走** `npm run app:android` —— 那个脚本已把 `--target aarch64` 写死，再传一次会撞参数（`.cnb.yml` 的 `.android-apk` 正是这么写的）。
**② 签名密钥搬家**：从 devtest `/root/.workhub/android/`（`nexus-release.jks` + `keystore.properties`）经 ssh 管道直接写进 GitHub Secrets（`ANDROID_KEYSTORE_B64` / `ANDROID_KEY_ALIAS` / `ANDROID_KEY_PASSWORD`），**本地不落盘、不进日志**。`storeFile` 仍写 `/tmp/nexus-release.jks`，与 `.cnb.yml` 同口径，`build.gradle.kts` 不用改。
**③ 停掉 CNB → GitHub 镜像**：`.cnb.yml` 的 `main.push` 与每日 `crontab` 两处 `*mirror-to-github` 引用已摘除（**锚点定义保留**，恢复时加回引用即可）。原因不止「不再需要自动同步」—— GitHub 会拒绝无 workflow 权限的 token 推送 `.github/workflows/`，仓库里一旦有这个目录，镜像是**整个同步**挂掉，而不只是 Android 那一环。
**④ 首跑实测（2026-11-01 18:40，run `41297716889`）**：**10 分 52 秒全绿**，产物 `app-universal-release.apk` **12MB**（文件名不带 `-unsigned` ⇒ 签名成功），artifact `nexus-android-release-arm64` 4.7MB（zip）。⚠️ **首次运行 28 秒就挂，根因在 action 本身而非配置**：`android-actions/setup-android@v3` 内部固定执行 `sdkmanager tools`，而 runner 的 cmdline-tools 已是 16.x、**`tools` 包已从 SDK 移除** → `Failed to find package 'tools'` → 退出码 1。修法：**弃用该 action**，直接用镜像预装的 `/usr/local/lib/android/sdk`，显式把 `cmdline-tools/*/bin` 加进 PATH，预接受 licenses 后自行 `sdkmanager` 补装 platform-36 / build-tools-36 / NDK 27。⚠️ 另一处认知修正：`npx tauri android build --target aarch64 --apk` 产出的是 **universal** 包（`--target` 只决定 Rust 编哪个 ABI，Gradle 仍按 universal 打），不是单 ABI 小包。

⚠️ **代价（记下来）**：GitHub 仓库从此是**手动双推**的第二副本（`origin` = CNB、`github` = GitHub 各推一次），**不会自动跟上 CNB**。停用前实测三方一致：本地 HEAD / CNB `origin/main` / GitHub `main` 同为 `9c55fea`，tag v1.3.0~v1.1.0 两边齐全。
⚠️ **仍未真机验收**：手机端「安装 / 首启 / 登录 / 同步」四项照旧没被点过（无真机）。GitHub 出包解决的是「怎么构建」，不是「验过」。

**上一轮**：2026-10-28（**修掉「桥永远连不上」的根因：token 收敛成单一来源**。现象：设置页「AI Agent 桥」永久 `连接中…`、relay 日志每 3 秒一条 `浏览器 WS 连接 token 无效，已拒绝`、Agent 侧只拿到 `-32001 工具清单不可用：寻鸽工作台未连接 relay` —— 两端都以为是对方配错。⚠️ **根因不在配置**：页面「启用」时用 `genToken()` **本地随机造 token**，relay 只认自己启动时那份（`WORKHUB_RELAY_TOKEN`），两端从不握手；且 token 输入框 `readOnly`，连手抄对齐都做不到。实测证据：nginx 记录页面发的是 `token=8vOe…`，容器环境里是 `sNn…`，12+ 次握手全被拒。）
**① 页面不得自造 token**：删除 `genToken()` 与「重置」按钮（改为「解绑」）；`toggleBridge` 只切开关，不再顺带发 token —— 那行 `ai.bridgeToken || genToken()` 就是故障源头。
**② 设置页新增配对码兑换**：`POST <relay>/pair`（**普通 HTTP** —— 此刻页面还没有 token，连不上 WS）→ 拿回 relay 下发的 token → 写 `settings.ai.bridgeToken` 并重连；另有「生成配对码」按钮（带 Bearer 打 `/pair/new`），签 5 分钟码给 Agent 或第二台设备 —— 即「后台签发、客户端填 token」的模型。
**③ token 改为运行期持久化**：`scripts/serve.mjs` 按 `WORKHUB_RELAY_TOKEN` → `<dataDir>/relay-token`（0600）→ 首次生成写盘 的顺序取值，**刻意不在构建期随机**（同 commit 两次构建会得到两个 token，重建/回滚就让所有已配对身份失效）。`.data/` 已进 `.gitignore`。
**④ 启动日志不再打印长期 token**：改打印**引导码**（`mintPairCode(0)`，一次性、不限期、兑换即作废）。不给 5 分钟 TTL 的理由：部署完过一阵再翻日志是常态，码过期后页面还没有 token、签不出新码 —— **直接死锁**，这正是这次卡住的形态。
**⑤ 顺手修掉配对 url 吐内网地址**：根因是容器入口 `deploy/docker/entrypoint.mjs` 的 `forwardHeaders` 把 `Host` 改写成上游 `127.0.0.1:9001` 却不补 `X-Forwarded-Host`，于是 `/relay/pair*` 返回 `https://127.0.0.1:9001/relay/mcp` —— 照着这个字段配的客户端必连不上，而现场看起来完全像「客户端配错」。修法：entrypoint **先记原始 Host 进 `X-Forwarded-Host` 再改写 `Host`**；nginx 显式 `proxy_set_header X-Forwarded-Host $host`。⚠️ **线上实测结论**：旧镜像的 entrypoint 用的是 `{...req.headers}` 展开，forwarded 头本来就会透传 —— 所以**只改 nginx 就能立刻修好，不必等新镜像**。真机证据（对正式站 `POST /relay/pair/new`）：不带 forwarded 头 → `https://127.0.0.1:9001/relay/mcp`；带 `X-Forwarded-Host: team.fpigeon.fun` → `https://team.fpigeon.fun/relay/mcp`。
> **本轮验证**：新增 `src/modules/settings/__tests__/aiBridgePair.test.tsx` **6 条**（配对成功写入**服务端下发的** token / `wss→https` 映射 / 失败不写 token 且显示服务端原话 / 空码不发请求 / 签发带 Bearer 且显示码 / 未配对时签发明确提示）+ `relayHttp.test.ts` **+2 条**（引导码不限期且只能兑一次 / 配对 url 用反代透传的真实域名）。⚠️ 两个红灯都说明「判据不在我以为的地方」：① 本仓 vitest 未开 `globals`，`@testing-library` 的自动 cleanup 不生效 → 上一条用例 DOM 残留，表现为「找到多个 button」，已按仓内惯例手动 `cleanup()`；② `mintPairCode` 的签名**另有一份 `.d.ts` 副本**（`src/agent/relay-modules.d.ts`），只改 JS 会报 `TS2554 Expected 0 arguments` —— 改 JS 必须同步改声明。`npm run check:all` 全绿 —— **1091 passed / 0 failed / 7 skipped**（132 文件 1098 用例，较上轮 +8 条）。
**已部署（2026-10-28 02:16）**：推 `088809f` → CNB 构建 → 主机 `docker compose pull && up -d`。**判据全过**：镜像 revision label = `088809fb0faeae1d7389cfcb1a96d5cbf21a40f5`（与本提交逐字相同）、容器 `healthy`、`/`·`/api/health`·`/sw.js` 全 200、`pair/new` 返回 `https://team.fpigeon.fun/relay/mcp`（不再是 127.0.0.1）。启动日志确认 `token 来源：环境变量 WORKHUB_RELAY_TOKEN` —— **token 没变，已配对的 Agent 不受影响**；同轮把主机 compose 与 nginx 都对齐成仓库副本（`diff -q` 逐字一致），回滚 tag `workhub:rollback-20261028-021657`、PB 备份 `data/pb_data.bak-20261028-021657`。⚠️ **剩最后一步必须人工**：页面刷新后在「AI Agent 桥 → 配对码」填日志里的引导码配对一次，`tools/list` 才会出工具。

**⑥ 清空本地库改成真·空库（代码已改，未推未部署）**：`resetAndSeedLocalData` → `resetLocalData`，删掉末尾的 `seedIfEmpty()`；`main.tsx` 的演示种子改为**仅开发模式**（`import.meta.env.DEV`）写入，生产构建不 seed。为什么非改不可：`seedIfEmpty()` 的唯一判据是「customers 为空」，生产里跑它 = **每次清库都被灌回来**，「清空后初始化」永远达不成。
⚠️ 顺带一条硬事实（只读统计正式站 `data.db` 全表）：**PB 业务表全为 0 条**（`customers`/`todos`/`transactions`… 皆 0），演示数据一直只存在**浏览器 IndexedDB** 且写入时标记 `synced: 1`，从未上行 —— 所以「清服务端」本身是空操作，真要清的是浏览器本地。
> **补充验证**：新增 `src/repositories/__tests__/localReset.test.ts` **2 条**（清完业务表全空 / settings 豁免），并做变异校验：把 `seedIfEmpty()` 加回清空流程 → `workspaces 应为空: expected 1 to be +0` 红（已还原）。`npm run check:all` 全绿 —— **1093 passed / 0 failed / 7 skipped**（133 文件，+2 条）。

**⑦ 页面登录（第 1 步：守卫 + 管理员账号，代码已改，未推）**：此前页面**完全匿名**，同步身份藏在一个没人知道的 `demo@nexus.local` 上 —— 既无访问控制，也让「换设备」变成摸配置。本轮先把门装上：
- `deploy/docker/entrypoint.mjs`：新增 `ensureAppUser()`，PB 就绪后用**已有的超管凭据**幂等创建 `WORKHUB_ADMIN_USER`（`users.createRule` 是 Locked，页面侧建不出来）。失败只告警不阻断启动。
- `scripts/serve.mjs`：新增 `GET /relay/auth-status` → `{enabled:boolean}`，判据只看管理员 env 是否配齐；**只回布尔、不回账号名**。
- `src/app/AuthGate.tsx`：守卫组件。**fail-open** —— 服务端说未启用就放行（配错 env 不能把唯一管理员锁在门外）；启用则必须过 `auth-refresh`，本地残留 token 不采信，续期后的 token 写回。另有**强制首改**：`auth-status` 的 `initialized:false`（`/data/.admin-initialized` 不存在）时，登录后只能停在「设置你的密码」，改完调 `POST /relay/admin-initialized` 落标记（该端点要验 users 登录态，否则谁都能把标记写掉）。
- compose 默认值直接写死：`WORKHUB_ADMIN_USER:-admin` / `WORKHUB_ADMIN_PASSWORD:-password`（按用户要求「改的人自己改文件」）。⚠️ 初始密码公开可知，所以首改必须短窗口完成。
⚠️ 与旧镜像的兼容性：旧 serve.mjs 没有该端点 → 前端 `res.json()` 抛错 → 按未启用处理 → 放行，不会因为前后端版本错位把人挡在外面。
> **补充验证**：新增 `src/app/__tests__/authGate.test.tsx` **5 条**（未启用放行 / 启用无 token 显示登录页且不渲染业务内容 / 有效 token 放行并写回续期 token / 失效 token 回登录页 / `initialized:false` 时已登录也必须先改密）。`npm run check:all` 全绿 —— **1098 passed / 0 failed / 7 skipped**（134 文件，+5 条）。
⚠️ **本轮只装门，尚未打通同步身份**：登录后同步仍走设置里原有的 `demo@nexus.local`（第 2 步要做的正是「登录态即同步身份」，并顺带把页面↔relay 的自动对接补上），别把「能登录」误当成「账号已统一」。

**⑧ 冲突删除归组 + 可配置保留期（逻辑层完成，UI 未做，未部署）**：同步只合并不删除，导致「本地以为已同步、远端却没有」的行永不消失（演示种子就是这一类）。
- `pocketbaseAdapter` 新增 `listRemoteIds(table)`：`fields=id`、`perPage=200`、沿用 `totalPages` 终止（**刻意不用 `skipTotal`**，否则无 `totalPages`、终止条件得另写）、401 走 `pbAuthedFetch` 自动重登。
- 新增 `src/sync/reconcile.ts`：判据**只认** `synced===1 && 远端无此 id`；孤儿写 `deleted=1/deletedAt` **软删进回收站**（可恢复），**不写 `trashSnapshot`**（`canRestore` 不依赖它，见 `trash.ts:212`）、**不入同步队列**（远端本就没有）。单表拉取失败不写完成标记，留待下轮重试。
- 新增 `src/modules/trash/retention.ts`：按 `settings.security.trashRetentionDays`（7/15/30，默认 30）到期 `purgeTrashRecord`，逐条 try/catch（`purgeTargets` 推送失败会抛）、`db.meta` 24h 节流、**不依赖 `isSyncConfigured`**（本地模式也要清）。
- 数据层：`SettingsSecurity.trashRetentionDays`；Dexie v17 新增**纯本地**表 `trashBatches`（存批次 label/members）——**不进 `collections.json`**，它不同步。
> **本轮验证**：`src/sync/__tests__/reconcile.test.ts` 4 条、`src/modules/trash/__tests__/retention.test.ts` 3 条全绿。⚠️ 踩到一个测试坑：`vi.mock` 提升到 import 之前，mock 工厂里引用普通 `const` 会 TDZ 超时（表现为 60s 无输出），必须用 `vi.hoisted`。
✅ **现已收口（2026-10-30 18:40 部署 `cbeeb63`）**：分组 UI（`TrashPage` 顶部批次条 + 点选只看该批）、设置页 7/15/30 下拉、`回收站设计方案` 口径已改（「保留期固定 30 天」「本地模式不自动清理」两条作废）；`check:all` 已在 CI 通过（3m43s）。
⚠️ 构建曾连红三次，真因是 `main.tsx` 引了**从未 git add** 的 `db/seedCleanup`（TS2307）；该模块判据「`synced===1` 即物理删」会误伤从服务端同步下来的真实数据，故**删除而非补提交**。

**⑨ 审计与首批修复（2026-10-31）**：两份只读审计结论 —— 页面旁白违规 **30 条**（18 文件 / 10 页面）+ 存疑 11 条；弃用代码 **19 项** + 重复实现 **7 组** + 未用依赖 **4 个**。本轮先修 3 个**真实缺陷**（会直接显示在界面上，非风格问题）：
- `moduleConfig/parts.tsx`：注释未包 `{/* */}`，`/* 开关滑块… */` 被当文本渲染进开关按钮（两份 `Toggle` 分叉的产物）
- `AiBridgeSection` / `GroupEditorDrawer`：残留 Markdown `**` 直出成星号
> 剩余按序推进：死代码删除 → 图标瘦身（98 个未引用 svg，当前 243 个全量 `eager` 进主包）→ 旁白分批删（一页一提交）→ 重复组件合并（会改视觉，最后做）。

**⑩ 死代码清除（2026-10-31，净 -191 行）**：删 `modules/placeholder/` 整目录；删 16 个零引用导出（`customerGroupRepo` / `TRASH_ROOT_TABLES` / `toolOf` / `MOBILE_MAX_WIDTH` / `DEFAULT_BRIDGE_URL` / `resolveMany` / `eventsOf` / `SYNC_META_DEFAULT` / `useCustomerInteractions` / `useProject` / `todayKey` / `todoUpdateFailedMessage` / `formatUnlockedAt` / `markdownToPlain` / `hasCrossTabLock`）+ 5 个零引用类型；移除 3 个未用依赖（`@tauri-apps/api` / `source-map-js` / `@types/dompurify`）。
⚠️ 两处**审计误判已纠正（不要按旧结论再删）**：① `resolveDefaultLedgerId` **不是**仅测试引用 —— `domain/index.ts:95` 的 `recordTransaction()` 在用它做缺省账本策略；② `eslint-plugin-react-refresh` 被 `eslint.config.js:3` import，依赖不能删。
⚠️ 复核方法教训：`grep -rn "\b符号\b"` 在 macOS BSD grep 下**不支持 `\b`**，会把「有引用」误判成「零引用」（本次首轮复核全部假阴性）—— 判死必须用 ripgrep，并以「命中数 == 1（仅定义行）」为准。
> 验证：`tsc -b --force` 0 错、`eslint src --max-warnings=0` 0 报错、`vitest` **1105 passed / 7 skipped**（136 文件）。

**⑪ 图标瘦身 + 反向检查（2026-10-31）**：删 8 个基名零引用的 svg（`drag_indicator` / `my_location` / `more_vert` / `add_circle` / `location_on` / `more_horiz` / `summarize` / `directions_walk`），`assets/icons` 243 → 235；`check-icons.mjs` 新增**反向检查**（多余图标），输出 **warning 不 exit 1** —— 它属于构建门禁，硬失败会把构建卡死。
⚠️ **`-fill` 变体一个都没删**：`Icon.tsx:37` 是 `(fill && ICONS[name + '-fill']) || ICONS[name]` 的后缀推导，按字面量判"未引用"会误删 `check_circle-fill` 这类深色/选中态图标（全仓 `check_circle-fill` 命中 0，但 `AppLayout` 传的是 `name="check_circle" fill`）。
⚠️ 四条**动态引用**通道不能只靠 grep `name=`：`HABIT_ICONS`（习惯图标数组）、`KIND_ICONS`（客户详情）、`registry.ts` 模块 icon 字段、`db/seed.ts` 的 `trophies[].icon` + `poster.ts` 的模板字符串 glob；`agent/schema.ts:440` 还允许 AI 下发任意图标名 —— 这也是反向检查只敢 warning 的原因。
> 实测：`npm run build` 通过（`✅ 图标校验通过：138 个引用全部存在（可用 235 个）`），主包 js **1,869,102 → 1,861,692 B（−7,410 B）**，`index-*.js` gzip 117.60 → 116.13 kB。

**⑫ 页面级旁白清理（2026-10-31，23 处）**：按 2026-10-14 裁决删掉页面副标题 / 宣导横幅 / 色阶图例 / 公式图例 / 标语副标题 / 重复 label 的 `StatCard sub`。删得最多的：`SecurityTab` 的「数据主权保障已激活」整块绿横幅、`InspirationPage` 副标题、`cards.tsx` 的「自律即自由…」、`HabitsPage` 色阶图例、`ProfilePage` 的 EXP 公式。
**刻意保留**（判断依据写在这里，避免以后被当漏网之鱼再删一遍）：`EmptyState` 的 description（含 `ProjectsPage:97` 那段"项目用来承载长期事项"）、危险区风险告知（覆盖同 id / 彻底重置）、`AiBridgeSection` 的中风险确认说明与「必须重启 Agent」接入步骤、`FinancePage` 的筛选状态文案、`AppearanceTabs` 里作为字体样张的那段正文。
⚠️ 删文案后做了 3 处**布局补偿**（否则视觉会塌）：`cards.tsx` 速记卡标题 `mb-1 → mb-3`；`CustomerDetailPage` 时间线 `justify-between → justify-end`；`StatCard.sub` / `parts.Section.desc` 改可选 + 条件渲染，避免留空壳。
> 验证：`npm run build` exit 0、`eslint` 干净、全量 `vitest` **1105 passed / 7 skipped**；`src/modules/trash/**`、`src/sync/**` 零改动。

**⑬ 重复组件合并 + 两处遗留（2026-10-31）**：审计第三批。
- **Toggle / Section**：`moduleConfig/parts.tsx` 改为从 `settings/settingsUi.tsx` 转出（单实现）；`CrmIntimacyConfig` 调用点零改动。
- **统计卡**：`SummaryCard` 提升为 `design-system/ui.tsx` 的 `StatCard`，CRM 与财务共用；`CustomerDetailPage` 那个 `<button>` 可下钻的同名卡改名 `DrillDownStatCard`（语义不同，**刻意不合并**）。
- **胶囊筛选**：新建 `design-system/FilterChip.tsx`，替换 5 处（CRM 档位、3 处时间线筛选、账本）。
- ⚠️ **两处越界已回退**：「账本 chip」原本是**实心填充**、明细 Tab 原本是**纯文字页签**，合并时被改成描边胶囊 —— 那是改设计不是去重。前者加 `variant="filled"` 还原，后者撤销为内联纯文字（**页签 ≠ chip**）。
- 遗留补齐：`CrmIntimacyConfig` 恢复「算法最多推到 T2，永不给出 T1/I6/I7」这条**硬规则**（以控件帮助形式，不是说明卡）；`NotificationsTab` 7 个开关加 `disabled`（代码里零消费方），仅 `todoDueWarning` 保持可操作。
- 刻意不做：`Segmented` 两份（2026-10-21 已裁定视觉不同）、`EntitySummary`/`MentionEntitySummary`（需单独一轮 + 交互测试）。
> 仍有可见差异（已裁定接受）：CRM 档位 chip 未选中态由浅填充改透明、描边 /60；时间线 chip 选中字重 `semibold→medium`；CRM 统计卡 `<768px` 值字号 22→18px（换响应式口径，防长金额撑破列）。

**上一轮**：2026-10-27（**远程接入打通：relay 新增标准 MCP over HTTP + 一次性配对码，Agent 不再需要本机 shim/本仓库**。⚠️ 本轮前半段曾把「接入」做成「本机仓库工程」（`cd <仓库> && npm run agent:setup`、写本机 `mcp.json`），被用户当场打回：**AI Agent 要连的是 VPS 上的版本**。真因是 relay 此前只有裸 WebSocket，而 MCP 客户端只支持 stdio / Streamable HTTP —— 所以任何人都只能在本机挂 shim，看起来就像「连本地」。本轮把那层补齐）。
**① `POST <path>/mcp`：标准 MCP over HTTP（stateless）**：`Authorization: Bearer <token>`（兼容 `?token=`），复用同一个 `router.handle` —— 鉴权、能力白名单、中风险确认票据三道闸门**一处没放宽**，只换了传输层。GET 回 405（不建 SSE 流）、通知回 202、非 relay 路径返回 false 交回宿主。⚠️ 为什么必须接在宿主最前面：`serve.mjs` 原先直接走静态资源，`/relay/mcp` 会被 SPA 回退成 **200 + HTML**，Agent 侧只看到「握手失败」而非「端点不存在」，是那种查一整天的错。
**①b 协议版本协商 + 能力如实声明**：支持 `2024-11-05` / `2025-03-26`，**回客户端请求的那个版本**。⚠️ 原先一律回 `2024-11-05` 是个真坑：Streamable HTTP 是 `2025-03-26` 才引入的传输，严格按版本走的客户端会据此退回老的 HTTP+SSE 双端点协议（GET 拿 endpoint 再 POST），表现是「url 配对了却连不通」。同时把 `capabilities.tools.listChanged` 由 `true` 改 **`false`** —— 没有任何传输实现推送工具变更，虚报会让客户端等一个永不来的通知、不刷新清单。
**② 一次性配对码（`/relay/pair/new` + `/relay/pair`）**：`--print-prompt` 现场签发 6 位短码（32 字符表、去掉 0/O/1/I/B 等易混字符，**5 分钟、只能兑换一次**），文本里只有「服务器地址 + 短码 + 三步」——**长期 token 不出现、本机路径不出现**。三条约束按「不许放宽」写死：签发必须持 Bearer token（只有已配对的页面/CLI 发得出码）、兑换即作废、每 IP 每分钟 10 次且失败统一话术（不给枚举者区分信息）。真值：6 位 ≈ 1e9 组合、每秒 10 次需约 3 年。
**③ ⚠️⚠️ 修掉「npm 吞掉裸参数」的静默失败（本轮实测踩到）**：`npm run agent:setup --url wss://x/relay`（少了 `--`）时 npm 把 `--url` 记成自己的配置（`url=true`）、把真地址当**位置参数**，脚本一个参数都收不到 → **静默复用旧凭据**。⚠️ 更危险的是 `--dry-run` 同样被吞：**「预览」会真的写盘** —— 本轮验证时它把凭据地址改成了 `example.invalid`（已按原值还原，token 未受影响）。修法：值参数从「位置参数 / `npm_config_*`」取回且**只认 `wss?://` 形状**、布尔开关也认 `npm_config_*`、命中时显式告警。
**④ CodeBuddy 进目标表（第 8 家）**：`~/.codebuddy/mcp.json`（用户级，条目带 `type: "stdio"`）+ 项目级 `.codebuddy/skills/`（已 gitignore）。它是本机接入那条路的补充，**不是远程方案**。
**⑤ 文档口径**：`docs/一键接入-Agent说明.md` 重写「一条指令 + 配对模型」（远程 HTTP 为主、stdio shim 降为「本机另一种接法」），补端点表与「配对码为何不算放宽鉴权」；工具数 **34 → 37**（4 处，与 AGENTS §8 对齐）。
**部署前提（未做，需人工）**：VPS 仍跑 `a5f6bdf`，**没有**本轮端点 —— 未推送、未出镜像、未 `docker compose pull`。在部署完成前，`--print-prompt` 签码会 404，这条指令对 VPS 还不生效。
> **本轮验证**：新增 `relayHttp.test.ts` **11 条**（无 Bearer 401 / initialize 握手 / tools/list 与 confirm_preview 合并 / tools/call 回 JSON-RPC / 通知 202 / GET 405 / 非 relay 路径交回宿主 / 签码需 token / 兑换一次性 / 乱码统一 401 / TTL 契约）+ `agentSetup.test.ts` 40 条（其中 `--print-prompt` 那条改为断言「含 `/relay/mcp`、不含 token、**不含仓库路径**」）。真机冒烟：`PORT=19011 node scripts/serve.mjs` → 签码 `F4T5MG` → 兑换拿到 token → `POST /relay/mcp` initialize 返回 200 JSON；另以 Streamable HTTP 客户端形态（`Accept: application/json, text/event-stream` + `protocolVersion: 2025-03-26`）复跑，协商回 `2025-03-26`、`listChanged: false`。`npm run check:all` 全绿 —— **1083 passed / 0 failed / 7 skipped**（131 文件 1090 用例，较上轮 +14 条 / +1 文件）。
**上上轮**：2026-10-27（**Android 客户端（B 范围）交付：构建链打通 + 平台适配 + 已签名 APK**——正式站走 HTTPS，未放行明文）。
**① 工具链与工程落盘**：JDK 17（Dragonwell）· Android SDK `platform 37.0`/`build-tools 37.0.0`/`ndk 27.0.12077973` · Rust 1.96 + 四个 Android target。`tauri android init` 生成 **`src-tauri/gen/android/`（入库）**；`.gitignore` 已挡 `build/`、`generated/`、`jniLibs/*.so`、`keystore.properties`。
**② 一个必改的隐性前置**：Gradle 的 `:app:rustBuild*` 任务执行的是 **`npm run -- tauri android android-studio-script`**，而本仓当初是**手工加壳**、`package.json` 没有 `tauri` 脚本 → 报 `Missing script: "tauri"`。已补 `"tauri": "tauri"`（Tauri 脚手架惯例）。⚠️ 该报错在 Gradle 里只显示「`npm` 退出码 1」，不翻上面的输出看不到真正原因。
**③ 平台适配（B 范围）**：`MainActivity` 给 `android.R.id.content` 加 **系统栏 + 刘海内边距**（`targetSdk 37` 强制 edge-to-edge，WebView 会铺到状态栏/手势条下面；`env(safe-area-inset-*)` 在 Android WebView 不可靠，故在原生侧兜底）；Manifest 补 **`adjustResize`**（否则键盘顶不起表单）；**返回键与文件选择无需自写** —— Tauri/Wry 已内建（`canGoBack()→goBack()`，栈底才退出；`RustWebChromeClient` 已实现 `onShowFileChooser`）。
**④ 签名口径**：keystore 与密码**只存仓库外** `~/.workhub/android/`（`chmod 600`），`gen/android/keystore.properties` 被 gitignore；**有该文件才签、没有则产出未签名 APK** —— 别人的机器与 CI 不会因为缺密钥而挂。`build.gradle.kts` 的 `signingConfig` 只在文件存在时创建。
**⑤ 产物与判据（实测，非推断）**：`app-arm64-release.apk` **11 MB** / `fun.fpigeon.nexus`（无 `.debug` 后缀）/ versionName `0.1.0` / versionCode `1000` / minSdk 24 / **targetSdk 36** / `arm64-v8a` / **APK Signature Scheme v2 验证通过**（我方 release 证书）/ `zipalign -c 4` 通过 / 包内 `.so` 内嵌的前端资源名 `assets/index-CaN84uyD.js` 与 `dist/assets/` **逐字一致**。
⚠️ **构建耗时结论（实测）**：`assembleUniversalRelease` 要逐个编 4 个 ABI（arm/arm64/x86/x86_64），2 核机上 **>20 分钟**；只编 `assembleArm64Release` 为 **6 分 17 秒**（其中 R8 约 5 分钟）。CI 用 4 核走 Tauri CLI 无此问题；本地出包建议单 ABI。
**⑥ 本轮验证**：⚠️ **`check:all` 未一次跑绿，如实记录**：本机 **2 核**，`--maxWorkers=4` 下两次分别有**不同**用例 15s 级超时（`entityLinkField` Esc 关闭、`todoRowDetail` 深链），二者**单独跑均通过**（0.6s / 3.1s）→ 属负载假红，非代码回归；改 `--maxWorkers=2` 全量 **1064 passed / 0 failed / 7 skipped**（130 文件 1071 用例），`tsc -b` 与 `eslint` 均 0 错。⚠️ **未做真机验收**：本机无 Android 设备、无 `/dev/kvm`（模拟器跑不起来），**安装/首启/登录/同步四项均未经真机点击**，只验到「能构建、签名有效、资源新鲜」。
**⑦ 明确未做**：存储仍是 Dexie（文档里的「阶段 2」SQLite 迁移未动）；release 未上架分发渠道、未做 AAB；APK 仅 arm64（未出 armv7/x86_64，老设备与模拟器装不上）。
**⑧ CNB 上出包（仅 tag 触发，2026-10-27 追加）**：新增 `.cnb/android/Dockerfile`（JDK 17 + Android SDK/NDK + Rust + Node，走腾讯云镜像）+ `.cnb.yml` 两个锚点：`.android-builder-image`（仅 `.cnb/android/Dockerfile` 变更时重建）与 `.android-apk`（只挂 `v*` 的 `tag_push`，流程＝写签名 → 构建 → `git:release` → `cnbcool/attachments` 挂 APK）。⚠️ **为让 CI 全链路走国内镜像，`compileSdk`/`targetSdk` 由 37 钉到 36**：腾讯镜像站只同步到 `platforms;android-36`，37 只能访问 `dl.google.com`（国内不可达）；36 与 37 对本应用无行为差异。`gradle-wrapper.properties` 的 `distributionUrl` 同步改腾讯镜像（官方地址会 302 到 GitHub）。**SDK36 的本地重打已完成（同日补）**：`app/build/outputs/apk/arm64/release/app-arm64-release.apk`，targetSdk 36、已签名、资源哈希与 `dist` 一致。⚠️ 本地**不要**跑 `assembleRelease`（universal 要编 4 个 ABI，2 核机 20 分钟以上）；单 ABI 用 `./gradlew app:assembleArm64Release -x rustBuildArm64Release`（6 分钟；`-x` 只在 Rust 产物已存在时可用）。密钥需人工在 `blueteam0715/keystore` 新建 `android-signing.yml`（base64 jks + alias + password），首次启用顺序与额度见 `docs/多端App改造方案-Tauri.md` §12.8。

**上一轮**：2026-10-26（**把审计里「如实挂起」的四项一并处理**——zod 升 v4、四个零测试模块补锁、TodoPage 拆出表单抽屉、worktree 清理）。
**① zod 升 v4（生产依赖高危清零）**：`zod ^3.24.1 → ^4.6.7`，`npm audit --omit=dev` 由 **1 high → 0**。
⚠️⚠️ **升级暴露一个「看着兼容、实则全错」的坑**：`jsonSchema.ts` 原按 v3 的 `_def.typeName`（`'ZodObject'` 驼峰）分派，v4 改成小写 `_def.type`（`'object'`）。旧代码那句 `def.typeName ?? def.type` 兜底**看起来**是版本兼容，实际把「找不到」换成了「拿到另一种形状」→ 所有分支都不再命中，**37 个工具的 `inputSchema` 全部退化成 `{}`**，三个锁（bridge / skill.parity / functional.sweep）同时红。修法：按 v4 结构重写分派（object→`shape`、array→`element`、enum→`entries`、literal→`values`、transform→`pipe.in`、optional/nullable/default/catch→`innerType`；`.refine()` 在 v4 不再产生包装类型，类型名不变）。**教训：`?? 兜底` ≠ 兼容 —— 取值域变了就是语义变了。**
**② 四个零测试模块补齐（5 文件 36 条，全部变异校验）**：新增 `shared/__tests__/streak.test.ts`（7）· `habits/__tests__/habitCheckin.test.ts`（6）· `trophies/__tests__/trophyEngine.test.ts`（9）· `projects/__tests__/projectWrites.test.ts`（7）· `moduleConfig/__tests__/registry.test.ts`（7）。锁的都是「错了不会报错、只会显示错」的一类：连击天数（**当前连击 vs 历史最长语义不同**，混淆后读数恒偏一天）、打卡幂等与「取消后复活同一条」、奖杯解锁幂等与事件时机、`createdAt` 编辑不被覆盖、注册表 id 唯一与深链可达。**变异校验三处命中**：`calcLongestStreak` 改成 `dates.size` → 恰 2 红；删 `if (prev) return { created: false }` → 幂等锁红；删 `if (trophy.unlockedAt) continue` → 奖杯幂等红（均已还原）。
**③ TodoPage 拆出 TodoFormDrawer**：`TodoPage.tsx` **1529 → 1172 行**，`TodoFormDrawer.tsx` 369 行（**零逻辑改写**，`./TodoPage` 保留同名再导出，外部 import 路径不变）。两把形状锁随之更新路径（`formResetConvention` 的例外表、`blacklistScenes` 的消费面清单）—— **是路径随迁、不是放宽判据**（改错会立刻红，本轮正是它先报的）。
**④ worktree 清理**：移除 2 个干净工作树（释放 ~587MB）+ 删除 2 个已合并分支（ahead 0）；**保留** `main-637aaa64`（**有未提交改动，不销毁**）与 `workbuddy/main-cd5ddeb1` 分支（ahead 3、语义已并入但 patch-id 不同，留作取证）。
**仍然挂起（如实记录）**：`@vitest/mocker` + `undici` 共 3 个 **dev 链路**漏洞 —— `npm audit fix` 无法自动解决（需等 vitest 发补丁版），**生产依赖侧为 0**；其余 **7 个 >800 行文件不拆** —— 依 `C-7` 既有裁决（拆出 = 把闭包变量显式化成 props，净减有限却引入「props 漏传 → 静默失效」的新风险面），只处理了结构上确实不合理的一处（页面内联表单抽屉）。
> **本轮验证**：`npm run check:all` 全绿 —— **1064 passed / 0 failed / 7 skipped**（130 文件 1071 用例，较上轮 +36 条 / +5 文件）/ `tsc -b` 0 错 / `eslint` 0 告警 / `build` ✅ 1.89s（主包 452.85 kB · gzip 115.33 kB）/ `npm audit --omit=dev` **0 漏洞**。
**⑤ 正式站切面文档**（同轮，用户要求）：新增 `docs/正式站状态与上线清单-20261026.md` —— 状态台账（镜像 `cd74317` 落后 main **26 提交**、schema 21 集合已一致、两站端点全 200）+ ⚠️ **「新 schema + 旧代码」风险**（正式站现在正是这个组合：**先部署新代码再录数据**，否则旧代码写的归属列新代码读不出，表现为「清单/分组突然全空」）+ 上线 6 步判据（含 CI 门禁**首次执行**的「红在环境 vs 红在代码」两种处置）+ 首次验收 8 条（人工，含 AI 桥启用 / PWA 装机 / 双端同步 / Tauri 三端）+ 回滚（**schema 不回滚，回滚前必须先备份 `data.db`**）+ 凭据位置表（**只记键名不记值**）。⚠️ 刻意**不复制** `Docker镜像构建与部署.md` 的部署命令 —— 同一语义只留一份，本文只补「状态与判据」。
**⑥ 推送与质量门禁首跑（10-27）**：3 提交（`c636619` / `f3728f4` / `0da8179`）已推 `origin/main`；**`.quality-gate` 首次真实执行即通过** —— 判据不靠猜：镜像 `latest` 的 `org.opencontainers.image.revision` = **`0da817909f8c…`**（与 HEAD 逐字相同）、`0da81790` tag 已在制品库、GitHub 只读镜像同步到同一提交。⚠️ **正式站容器仍跑 `cd74317`，只差主机 `docker compose pull`**（制品库已就绪，无代码风险）。⚠️ 顺带实测纠正一条口径：**镜像 tag 是 8 位短 sha**（`git rev-parse --short=8`），按 `git log` 默认的 7 位去 pull 会 404（`manifests/cd74317` 404 vs `cd74317a` 200）—— 回滚一节已按实测改写，并补「部署前先在主机给当前镜像打本地 `rollback-<date>` tag」这条最容易漏的退路。
**⑦ 正式站部署（10-27 执行完毕）**：① ⚠️⚠️ **上机只读核对先推翻了一条判断** —— 容器实际跑的是 `ab0d253`（10-26），**不是** PROGRESS/文档记录的 `cd74317`；落后 main 只有 **5 个提交**（4 文档 + 1 代码），所以「新 schema + 旧代码」的风险当时**并不存在**。根因：10-26 有过一次正式站部署但没人回写，而 `.deploy-state` 只记测试站 → **判断线上版本只能认主机 `docker image inspect` 的 revision label**（判据已写进上线清单 §二）。② `docker compose pull` 报 **401**（主机制品库凭据过期，非镜像问题）→ 用 `cnb git-credential` 的 94 字符 token 经 stdin 重登（用户名固定 `cnb`）→ pull 得到 `a5f6bdf`。③ **先打回滚 tag 再 pull**（`workhub:rollback-20261027-002557`），再 `stop` → `cp -a pb_data`（7.3 MB，`pb_data.bak-20261027-002612`）→ `up -d`，停机约 10 秒。④ **验收全过**：容器 healthy、日志「21 个集合均已存在，跳过导入（幂等）」、公网 `/`·`/api/health`·`/sw.js`·`/relay/` 全 200、`check:schema --prod` 完全一致、revision label = `a5f6bdf`。⑤ ⚠️ **新发现待修**：容器启动日志**明文打印 relay token**（`[serve] 接入 token：…`）—— 读日志需主机权限，不构成公网泄露，但截图/外发要打码；脱敏改动需重新构建镜像，**未在本轮动**。

**上一轮**：2026-10-26（**全仓审计 + 按审计结论整改**——实证全绿；问题集中在「文档事实源」与「质量门禁」两处，本轮把这两处收口，未动业务行为）。
**审计基线（本机实跑，不引用自述值）**：`tsc -b` 0 错 · `eslint src` 0 告警 · 全量 vitest **1028 passed / 0 failed / 7 skipped**（125 文件 1035 用例）· `build` 1.68s（主包 453.13 kB / gzip 115.39 kB）· `check:icons` 138 · `gen:skills` 37 工具复跑零 diff · `check:schema` **测试站与正式站均「完全一致」（21 集合）** · 测试站线上入口 `index-DR0uUlqs.js` 与本机构建**同哈希** · 工作区干净、与 origin 同步。报告见 `docs/审计报告-全仓-20261026.md`。
**整改 ① 事实源校正（P1）**：状态表三处失真已改 —— `全站回收站`「⚠️ 服务端 Schema 未升级」→ **已升级**（2026-10-24 双站导入，本轮复查一致）；集合数 **20 → 21**（补 `links`）；架构速览「17 collections / Dexie v8」→ **21 集合 / Dexie v16**。⚠️ 为什么算 P1：AGENTS 规定「判断做到哪了只认 PROGRESS」，而原文会让下一个接手者得出「上线前必须导 schema」的错误前置条件。
**整改 ② PROGRESS 二次归档**：正文 **31 段 → 15 段**（迁 17 段到 `PROGRESS-archive-2026H2.md`，累计 68 轮），执行 AGENTS §7 的成文规则（原规则已写成但未执行，属「规则存在≠机制存在」）。
**整改 ③ 工具数口径**：34 → **37 业务工具**（`tools/list` 另含 `confirm_preview` 共 38）；`AGENTS.md §8` 与状态表同步。
**整改 ④ 文档漂移**：`AGENTS.md` 技术栈 `react-router v6` → **v7（2026-10-21 已升级）**；`CHANGELOG` 未发布计数 42 → **80 提交**（实测 `git rev-list --count v1.2.1..HEAD`）；交接文档 T3 标记完成并降级为历史快照；`docs/README.md` 补 6 份漏收索引（关联层/集合层/回收站设计方案 + 交接 + 前端残留两份），并新增「设计方案与交接」独立小节。
**整改 ⑤ 凭据权限**：`.deploy.env` / `.deploy-state` / `~/.workhub/relay.json` 由 **644 → 600**（均已确认被 gitignore、零跟踪；此前同机任何用户可读明文超管密码与 relay token）。
**整改 ⑥ CI 质量门禁（P1）**：`.cnb.yml` 新增 `.quality-gate` 锚点，作为 **main 镜像构建与 `v*` 发版构建的前置 stage** —— 此前流水线只有「GitHub 镜像同步 + docker build」，lint / tsc / vitest 一个都不跑，任何带红提交都能出镜像。门禁跑的是新增的 **`npm run check:all`**（`check:icons` + `tsc -b` + `eslint` + `vitest --maxWorkers=4`），与本机**同一条命令**；⚠️ 必须带 `--maxWorkers=4`，本仓默认并发会随负载假红。
**整改 ⑦ 防漂移锁补面**：`writeThroughStorage.test.ts` 的扫描面补 `src/storage`、`src/db` 并逐条署名（`dexie.ts` = 适配器实现层、`seed.ts` = DB 层播种）—— 此前这两处靠「**不在扫描面**」而非「署名放行」通过，与文件头「必须逐条署名」自述不符。**变异校验实证**：摘掉 `dexie.ts` 署名 → 精确报 `src/storage/dexie.ts:68`，恢复即回绿。另：`executor.ts#agent_listHabits` 的内联 `z.object({}).strict()` 改引 `listHabitsSchema`（同一契约两份实例，改一处漏一处会静默分叉）。
**本轮如实标注未做**：⚠️ **`zod < 4.6.6` 高危（生产依赖）只做了影响面评估、未升级** —— 见下；`TodoPage.tsx` 等 8 个 >800 行文件未拆；`habits/trophies/projects/moduleConfig` 四模块仍无专属测试；`.pushcheck.conf` 确认不存在，已改为以 `check:all` 为唯一门禁入口（不再引用不存在的配置）。
> **zod v4 评估结论（待拍板）**：本仓 zod 用法 8 文件 / 39 `z.object` / 26 `z.enum` / 12 `.refine` / 6 `.strict` / 4 `.transform` / 16 `.default` / 7 `z.union` / 15 `safeParse` / 58 `.parse`；**未命中 v4 主要破坏面**（零 `.email()`、零 `z.record(`、零自定义 `errorMap`/`required_error`、零 `ZodError` 直接引用）。升级到 `zod@^4.6.7` 的回归面集中在 `.refine` 的 message 参数与 `.default()` 的 input/output 推导，可用全量测试一次性验。**为什么不当场升**：breaking + 生产依赖，按 §10「先评估再安装」等拍板。
> **本轮验证**：`npm run check:all` 全绿（含 `tsc -b` / `eslint` / 1028 用例）；`.cnb.yml` 改动只增 stage、未动既有镜像与镜像同步逻辑；`gen:skills` 零 diff；业务代码仅一处 `executor.ts` 引用替换（行为等价，由既有 agent 用例覆盖）。

**上一轮**：2026-10-26（**T3 事件总线泛化完成——交接清单全部清零**。同日此前：Phase 3 集合层 C1-C4）。
**T3 主体**：① ✅ **登记点收敛（缺口②）**：新增 `shared/eventContract.ts` 单一声明表（`EVENT_DECLARATIONS`：zod payload schema + 写工具绑定 + 下沉标记，shared 层零运行时依赖只引 zod 与纯类型）——此前 4 处手工副本（AppEvent / AgentEventDeclaration payload 复刻 / TOOL_EVENTS+SUNK_EVENTS / emitDeclared 校验）全部改为**派生**：`AppEvent` 与 `APP_EVENT_NAMES`（replay 白名单）由声明表类型层派生、`AgentEventDeclaration` 成为其 agent 契约投影（domain 事件子集，新 `DomainEventName` 类型）、`TOOL_EVENTS`/`SUNK_EVENTS` 运行时派生。加一种事件今后只改 eventContract 一处。② ✅ **emitDeclared 增强**：payload 过声明表 zod 校验（此前只查「给了没给」，载荷形状错会静默发给消费者）；现状三领域事件全 sunk、该函数仍为未来未下沉事件保留出口。③ ✅ **信封 as-built（缺口③的落地裁决）**：actor = `agent_events.tool` 列（语义即发出方，已有）；occurredAt 语义修正为 **emit 时刻**（转发器第三参携带 → recordEvent 落库，替代原先「PB 落库时刻」——事件发生与落库之间隔着队列）；kind = 事件名自含；**txId 刻意不引入**（StorageAdapter 无事务 id 概念，而「一次操作至多发一个领域事件」的单值化先例下无跨行关联需求——将来若出现一次操作多事件，连同 StorageAdapter 一起设计）；**模式订阅（customer:* 通配）不做**（消费方全为精确订阅，无需求不加 API）。④ ✅ **replay 白名单改派生**（T3 前置项的手写数组改由 contract 派生，「加事件忘登记 replay」从此不可能）。
> **T3 验证**：新锁 `eventContract.test.ts` 7 条（TOOL_EVENTS 字面量快照钉内容 + 派生路径一致 + SUNK/白名单覆盖 + emitDeclared 拒绝面 + 信封 occurredAt + 本地/领域事件同过转发器）；**变异校验打回一次假锁**——初版①「TOOL_EVENTS 与 toolEventsMap() 比较自身」在删 tool 绑定变异下仍绿（派生源即比较源），改为**字面量快照钉死内容**后恰红；alignment/eventSink 锁全绿（emit 载荷与「事务后 emit」时机未变，handoff 预言的拦阻未发生——因为收敛只动登记不动 emit）；全量 **1028 passed / 0 failed / 7 skipped**（125 文件 1035 用例）/ tsc·lint·build 全绿。
> **交接清单状态**：T1 ✅ / T2 ✅（已实施）/ T3 ✅ / T4 ✅ —— `docs/关联层剩余任务-交接-20261026.md` 所列任务**全部完成**。

**上一轮**：2026-10-26（**Phase 3 集合层实施 · C4 收口**——同日 C1/C2/C3，用户拍板 A2+B+C+D：保留三张特化表、成员关系迁 link kind='member'。**三期主体完成**）。
**C4**：① ✅ **schema 纪律核查**：`collections.json` **零变更**（三容器表本来就同步、links 集合一期已双站导入；listId/folderId/groupId 服务端列按既定裁决永久保留供老客户端降级与 pull 派生）；`pb_hooks` SYNC_COLLECTIONS / `JSON_FIELDS_BY_TABLE` 均无需动；`check:schema` 两站复验见下。② ✅ **seed 零改动**：种子不写 listId/folderId/groupId（收集箱/根层/无分组口径），无新 link 需要补。③ ✅ **工具面零变更**：gen:skills 37 工具幂等零 diff（归属走既有 save 路径随参数传入，设计文档裁决：不新增工具、不开放 member kind 直写）。④ ✅ **文档**：设计方案标记「已拍板实施」、交接文档 T2 状态同步；T3 事件总线泛化仍为唯一遗留项。
> **C4 验证**：`npm run build` ✅ 1.60s / `check:icons` 138 ✅ / gen:skills 幂等零 diff / 全量 vitest 见 C3（1021 passed）。
> **Phase 3 as-built 摘要（三期对照设计文档）**：member 写路径 = `syncMemberLinks`（三态 diff，幽灵容器抛错回滚）+ 三个族收口函数（`saveTodoWithList`/`saveNoteWithMentions(…, folderId?)`+`setNoteFolder`/`setCustomerGroup`）；读路径 = 三个 `use*IdOf` 索引 hook + `memberIndexOf`（双挂取最新）；迁移 = v16 单次升级（MIGRATED 族扩三族、迁移体与 v15 单一实现、mergeRemote 派生零改动、服务端旧列保留）；级联 = 三容器删除 v2（member 墓碑化+快照留档，成员行不动；恢复按两端存活复活）；顺带修掉「笔记删除无级联」真缺口（deleteNoteCascade）。**双端成员合流由 per-link LWW + 确定性 id 白得**（二期已实测同机制）。
**真机抽验（测试站 v16 上线后）**：✅ 真实浏览器 IndexedDB 自动完成 v15→v16 升级（IDB version 161、不炸、数据不丢）；清单面全链路（新建清单 → 表单 MatchCombobox 选清单保存 → **member link 落库且待办行无 listId 字段** → 左栏计数从索引读出 → 清单视图过滤正确）；分组面（详情页 ManualGroupPicker 原生 select 选 manual 组 → **member link 落库**）；notes 面（新建文件夹 ✓、新建笔记行字段退役 ✓——「移动到文件夹」弹窗交互受 IAB 合成点击限制未走通，该路径由 noteFolderWrites 单测锁覆盖）。三容器删除级联的 UI 走查同样受 hover-CSS 限制，由 listMembership/noteFolderWrites/groupMembership 的级联+恢复锁覆盖（均变异校验）。
**C3**：① ✅ **登记**：LEGACY_LINK_FIELDS.customers 并 groupId（customers 同表双族：relations=v15 / groupId=v16）、legacyLinkSpecs customers 分支补 member 派生（目标组是 rule 组时 member link 对读侧不可见——manual 口径才消费 member，脏数据无害，裁决 C）。② ✅ **类型与判定**：`Customer.groupId` 类型删除；`customerInGroup` 改双轨签名 `(customer, group, manualGroupId?)`——manual 看 member 索引注入、rule 仍走标签匹配（纯函数不再依赖行字段）。③ ✅ **读写路径**：`setCustomerGroup` 快捷路径（幽灵客户静默/幽灵分组抛错回滚）；crm/hooks 新增 `useCustomerGroupIdOf` 索引 + `useCustomerGroupCounts` 三参双轨（manual 按索引计数、rule 按标签）；`deleteCustomerGroup` v2（member link 统一墓碑化+快照留档；rule 组清扫 no-op——本无存储成员）。④ ✅ **消费面**：CrmPage 拖入/拖出/过滤/计数 4 处；CustomerDetailPage `ManualGroupPicker`（currentGroupId 由索引注入，prop 换位）；agent 与 trash 无 groupId 涉及（核查过）。
> **C3 验证**：新锁 `groupMembership.test.ts` 5 条（落库确定性 id/换组移出/幽灵回滚/级联+恢复计数/rule 组 no-op）+ `migrateV16.test.ts` customers 族 +2 条（双族共存/幂等）；`dragToGroup.test.ts` 断言随签名演进重写（manualGroupId 注入口径）；全量 **1021 passed / 0 failed / 7 skipped**（`--maxWorkers=4`，124 文件 1028 用例）。

**上一轮**：2026-10-26（**Phase 3 集合层实施 · C2 notes 族 + 顺带修掉「笔记删除无级联」真缺口**——同日 C1，用户拍板 A2+B+C+D）。
**C2**：① ✅ **登记**：notes 同表双族（mentions=v15 related 语义 / folderId=v16 member 语义）——LEGACY_LINK_FIELDS.notes 并键、legacyLinkSpecs notes 分支补 member 派生（同轮迁移互不扰，迁移锁单独断言）。② ✅ **写路径收口**：`saveNoteWithMentions(note, folderId?)` / `updateNoteWithMentions(id, patch, folderId?)` 扩第三参（三态同 C1）+ `setNoteFolder` 快捷路径；`moveNoteToFolder` 改薄封装（UI 调用点签名不变）。③ ✅ **消费面切换**：`deleteNoteFolderCascade` v2（member link 统一墓碑化+快照留档，笔记行不动）；NotesPage 计数/过滤/根层判定/行 chip/预览弹窗 7 处走 `useNoteFolderIdOf` 索引；新建笔记在当前文件夹（第三参）；quickCapture 落默认文件夹走同参；agent `note_createNote`（第三参）/`note_updateNote`（touched 分支走 updateNoteWithMentions 第三参，行内字段照常生效）；`listNotes` 读投影的过滤与 folderName 走索引（projectNote 去 folderId 字段、保 folderName）。④ ✅ **trash**：notes 恢复侧 dropDeadOne('folderId') 死分支移除。⑤ ⚠️⚠️ **顺带修掉真缺口：笔记删除无级联**——三处调用点（NoteEditorPage/NotesPage/agent note_deleteNote）全是裸 `noteRepo.softDelete`，v15 起 mention link、v16 起 member link 都是独立记录，裸删留下「指向已删笔记的活 link」（幽灵纪律③；mention 一族 Phase 2 就欠着，只是 EntityMissing 兜底掩盖）。新增 `deleteNoteCascade`（软删 + 端点清扫 + cascadeLinkIds 快照留档），三处全部切换；恢复笔记时 mention/member 随两端存活复活。
> **C2 验证**：`migrateV16.test.ts` +2 条（双族共存/幂等）；`noteFolderWrites.test.ts` 四条断言随语义演进重写（member 语义断言 + TOCTOU 锁判据更新 + 新增「笔记删除级联清扫+快照」锁——初版断言写错前提（软删笔记不可能有活 member link，其自身级联已清扫），按真实分层修正）；agent e2e/step8 三处 folderId 断言改 member 语义；notes/todo/db/agent/repositories 影响面 **558 passed**。

**上一轮**：2026-10-26（**Phase 3 集合层实施 · C1 地基+todos 族**——用户拍板「按你的建议来」= 设计稿推荐 A2+B+C+D：保留三张特化表、成员关系迁 link kind='member'）。
**C1**：① ✅ **登记**：`LINK_KINDS`+`'member'`（from=成员 todo/note/customer → to=容器 todoLists/noteFolders/customerGroups；单选语义=写路径选择集 diff，非 DB 唯一约束——裁决 B）；`LinkEndpointTable` 补 `'customerGroups'`（一期刻意排除的预留位落位）。② ✅ **写路径收口**：`syncMemberLinks`（单选 diff 原语：wanted=string 移入/undefined 移出/同容器幂等；幽灵容器抛可操作错误回滚）+ `memberIndexOf`（读索引纯函数，双挂取 updatedAt 最新——单选是写纪律不是存储约束，读取必须自洽）；`saveTodoWithList(todo, listId?)` 三态约定对齐 `saveTransactionWithAttachments(…, related?)`（undefined=不动/null=收集箱/string=移入）+ `setTodoList` 拖拽快捷路径。③ ✅ **v16**：todos.listId 翻 member link（迁移体与 v15 同一实现 `migrateLegacyLinks`，MIGRATED 族+LEGACY 键表扩 todos；索引去 todos.listId）；**mergeRemote 派生零改动**（deriveLegacyLinks 走同一 legacyLinkSpecs，族登记即生效）。④ ✅ **消费面切换**：deleteTodoListCascade v2（名下 member link 统一墓碑化+快照 cascadeLinkIds 留档，待办行不动——旧「解绑 listId 字段+mode:set 快照」整体退役）；TodoPage 全部 6 处判定/计数/chip/拖拽改走 `useTodoListIdOf` 索引、表单保存走 saveTodoWithList、onSaved 契约扩 listId 参数（视图落位判定）；详情抽屉归属展示走索引；agent `todo_createTodo`/`todo_updateTodo` 的 listId 分行走同两个收口函数（update 的归属失败转可读错误返回、行内其余字段已生效）。⑤ ✅ **trash**：todos 恢复侧 dropDeadOne('listId') 死分支移除（归属恢复由 reviveCascadeLinks 按两端存活处理）。
> **C1 验证**：新锁 `listMembership.test.ts` 7 条（落库确定性 id/单选 diff/收集箱三态/幽灵回滚/级联+快照/恢复计数/双挂兜底）+ `migrateV16.test.ts` 3 条（五口径）；变异 M1（拆旧 link 墓碑化）→ ②③ 恰红；TOCTOU 形状锁判据随语义演进更新（cascadeSoftDeleteLinks 须在事务体内+函数体禁 listId）；todo/notes/db/agent 影响面 **509 passed**。恢复计数锁的初版断言错了前提（td3 先删时其 member link 已被 todo 级联墓碑化，清单删除时不会重复入快照）——按真实分层语义修正为 revive 2 / skip 0。

**上一轮**：2026-10-26（**T1 部署+真机验收（发现并修复两个真缺陷）+ T4 账本级联收口 + T2 集合层设计稿**，执行 `docs/关联层剩余任务-交接-20261026.md`）。**T1**：① 8 提交推送（85b890e 前）→ 测试站 light 部署（PB 重启 = links 盖戳/墓碑 cron 生效，补上一期遗留 ⑩a）→ 两站 `check:schema` 均「完全一致」。② **真机验收全过**：画布关系线 / 流水多关联保存+编辑回填（名称/金额/双 chip）/ 笔记 mention 角标与面板 / 回收站删客户→恢复提示「恢复 3 条跨模块关联」（客户+日志+3 条 link 全复活）/ 客户关系 UI 写入（编辑档案 → relation link 落库）。③ **双端合流（核心卖点实测）**：设备 A（IAB）与设备 B（独立 chromium 上下文，playwright-core 装在仓库外 /tmp 不动依赖）同账号各建一条客户关系，同步后**两端都看到全部 6 条**——per-link LWW 合流成立；服务端 links 集合收到第一批真实记录（localId 全保留）。④ **AI 桥全链路**：按文档口径把页面生成 token 写回 `/etc/nexus-relay.env` 并重启 relay（备份 `.bak-20261026`；此前 env token 与页面 token 从未配对、桥自 10-15 起根本连不上）→ `tools/list` **38 工具**（37 业务 + confirm_preview；link_link/link_unlink/listLinks 均在）→ `link_link` 走完「预览 → confirm_preview 取票 → 携票执行」三步真建 link → **越权拒绝验证**：拿 A 参数的票执行 B 参数被参数指纹校验拒绝（防「预览 A 执行 B」设计实测有效）。
**真机验收发现并修复两个真缺陷（各有回归锁 + 变异校验双向恰红）**：⑤ ⚠️⚠️ **P1：凭证详情点「编辑」表单闪现即消失**——`TransactionFormDrawer` 渲染在详情 Drawer 的 children 里，而编辑态把 Drawer open 翻 false → usePresence 播完 200ms 出场动画整棵卸载子树，表单跟着消失（该结构 a7c4296/2026-09-06 引入即坏：当时 Drawer 是立即卸载、表单一帧都留不下；动效系统接入后退化为闪现）。既有测试全部直接渲染表单组件（open=true），恰好绕开这条链路。**修法**：表单与确认弹窗改为 Drawer **兄弟节点**、详情编辑期间保持打开（对齐 TodoDetailDrawer 模式与表单「elevated 叠层」注释的原意）。锁 `txnDetailEdit.test.tsx`：越过出场时长表单仍存活；变异（退回子树结构）恰红。⚠️ 该锁初版用同步 `getByRole`，全量并发下暴露真实竞态（按钮区在 txn liveQuery 解析后才渲染）→ 改 `findByRole` 轮询，与既有 flaky 修法同口径。⑥ **P2：回收站「N 条关联」计数漏 cascadeLinkIds**——`listTrash` 只数旧字段快照（snapshot.links），links 时代删除的客户显示「1 条关联」而实际恢复带回 4（字段回填 1 + link 复活 3）。修法：计数 = 两类凭证之和（不重叠：前者回填字段、后者复活 link 记录）；锁在 `trash.test.ts`（字段快照 1 + cascadeLinkIds 1 = 2）；变异恰红。
**T4-1 账本级联收口**：⑦ ✅ `deleteLedgerCascade`（repositories/index.ts）：**「有流水的账本禁止删除」守卫从 UI 层收口到数据层**（此前 FinancePage 预检是唯一防线，绕过 UI 的调用方会静默删掉带流水的账本；流水.ledgerId 强归属、解绑即失去账目口径）+ 名下 mention link 随删同事务墓碑化、快照 cascadeLinkIds 留档、恢复复活（清掉 2026-10-24 ⑩ 记录的「账本 mention 无级联」欠账）。FinancePage 改走 cascade（UI 预检保留用于确认前显示计数）。锁 `deleteLedgerCascade.test.ts` 3 条（守卫可操作错误+事务回滚 / mention 墓碑化+恢复复活 / 幂等静默）；**变异两方向均恰红**（拆守卫→①红；拆 cascade 钩子→②红）。
**T3 前置项**：⑨ ✅ **replay 白名单校验**（交接文档 T3 明确的「泛化事件名前必须先做」）：`eventBus.ts` 导出 `APP_EVENT_NAMES` 运行期白名单（`satisfies` + `_assertExhaustive` 条件值断言双向编译期锁死——**不能用 `null as never` 占位**，`never` 可赋给任何类型、断言会静默失效，实测踩到并已写进注释）；`drainAgentEvents` 对服务端回包的任意字符串先过白名单，未知名警告跳过、游标照常推进（不卡通道）。锁：未知名不穿透分发 + 已知名正常 + 游标推进（变异恰红）；漂移自证：删数组任一项 → tsc 恰在断言行报错。**T3 主体（信封设计 + 登记点收敛）仍留专门轮次**（交接文档自评 1-2 轮；信封改载荷形状会触发 alignment 锁，属预期设计约束）。
**T2 集合层设计稿**：⑧ ✅ 产出 `docs/集合层设计方案-20261026.md`（**待拍板，未动任何 schema**）：裁决点 A（通用 collections 表 vs 保留特化表只迁成员——**推荐后者**，双端成员合流/级联恢复全部白得而 UI 左栏不动）/ B（成员 = link kind 'member'，单选靠 syncMemberLinks 选择集 diff，不做 DB 唯一约束）/ C（rule 组保持视图不迁、收集箱/未归类保持缺省口径）/ D（v16 + MIGRATED 族 + pull 派生，服务端零变更）。分期 R1 地基 / R2 迁移 / R3 收口，预估 2.5-3.5 轮。**T3 事件总线泛化为唯一遗留项**（交接文档已同步状态）。
> **验证**：tsc ✅ 0 错 / eslint ✅ 0 告警 / **全量 vitest 1002 passed / 0 failed / 7 skipped**（`--maxWorkers=4`，121 文件 1009 用例；较交接基线 +6 新锁）/ build ✅ 1.73s / 两站 `check:schema` 完全一致 / 测试站修复版已上线（公网入口与本地 dist 同哈希）。服务端 schema **零变更**。

**上一轮**：2026-10-25（**原子化二期：四族旧关联字段全量迁 links + 关联层工具面**，接同日一期 R1–R3）。**目标**：把 `docs/关联层设计方案-20261025.md` 规划的 Phase 2（attachments 归属 → notes.mentions → transactions 三组数组 → customer.relations）与 Phase 4（link 工具）一次做完 —— 用户指令「把你规划的所有内容一次做完」。Phase 3（集合层统一）按拍板「另裁」**不在本轮**。
① ✅ **as-built 关键决策：不走双写过渡，v15 单次升级**。正式站业务数据为 0、测试站仅演示数据 —— 双写期没有存在理由。`MIGRATED_LINK_TABLES`（linkId.ts）圈定迁移族逐族扩大，v15 upgrade 与测试共用 `legacyLinkMigration` 单一实现：旧字段翻成 link（确定性 id）、**端点已删/缺失跳过**（语义上已解绑）、旧键就地清掉（双写不双读）。服务端旧列**永久保留**（PATCH 不带键就不清列；老客户端还在写），pull 侧由 mergeRemote 的 MIGRATED 流程「先留快照 → 记录落库后派生 link（id 归一 localId）→ 剥旧键」兜住 —— 派生行盖 `updatedAt:0/rev:0` 最低优先级戳、**不入队**（远端真实 link 一到即按 LWW 胜出；多端各自派生靠确定性 id 合流，不推服务端避免双端同 localId 竞态）。
② ✅ **四族迁移（4 个独立提交）**：(a) attachments 归属 → kind='attachment'（saveTransactionWithAttachments 同事务 putLinkTx；读侧 linksOf 索引；回收站父子判定改 links）；(b) mentions → kind='mention'（saveNoteWithMentions/updateNoteWithMentions + syncMentionLinks 按正文 diff；读侧 mentionLinks.ts hooks；客户/项目/待办三个 cascade 的「剪 mentions + mode:mention 快照」退役）；(c) transactions 三组数组 → kind='related'（syncRelatedLinks 选择集 diff，saveTransactionWithAttachments 第三参：undefined=不动既有 link；finance/links.ts 重写为 groupTxnLinks 索引层 + useTxnLinkIndex，CRM 图谱/健康分/待回收款/时间轴/项目统计/待办详情/财务页全部切换；三个 cascade 的数组解绑循环退役，sideEffects.unlinked 改按 link 计数）；(d) relations → kind='relation' canonical（syncRelationLinks + saveCustomer/createCustomerWithInit relations 选项；addCustomerRelation 改 linkAtoms 薄封装签名不变；图谱投影双侧展开、投影形状不变 → buildGraph 纯函数层零改动）。
③ ✅ **mergeRemote 两块历史补丁退役**：relations 并集合并（unionRelations）与 transactions 数组保护（normalizeTxnLinks）删除 —— 关联是独立 link 记录（各自 LWW + 确定性 id 合流），行级整体覆盖动不到 link 表；相关测试（并集保护/画布悬挂/回环编码）全部改写为 per-link 语义锁。JSON 字段表登记**保留**（服务端旧列还要反序列化才能派生，删登记 = 新设备拉到旧关联凭空丢失）。
④ ✅ **P4 工具面（37 工具）**：`link_link`/`link_unlink`（medium 走票据；**刻意只开放 related/relation** —— mention 由笔记保存 diff 托管、attachment 由凭证流程托管，开放只会打架）、`listLinks`（read 域双向合并 + 上限 50）。AiDomain 扩 `link`；gen:skills 重生成，parity/白名单/alignment 锁自动纳管；功能遍历补 3 正向 + 3 边界用例。
⑤ ⚠️ **遗留边界（如实记录）**：客户间关系恢复顺序 —— 先删的一方要**最后**恢复（它的快照复活 link 时对端须已回来，反过来该 link 保持墓碑可手动重建，不为猜意图而复活）；pull 派生只补缺失 link，**不复活墓碑**（用户手动解绑不被远端旧键复活）。账本 mention 仍无级联（账本删除本就没有 cascade 函数，P2 前即如此，未扩大）。
⑥ ✅ **剩余任务交接**：推送/部署/真机验收（T1）、Phase 3 集合层裁决与设计（T2）、事件总线泛化（T3）、小欠账（T4：账本级联等）已规划进 **`docs/关联层剩余任务-交接-20261026.md`**（自包含：架构现状速览 + 任务步骤/坑 + 纪律 + 「不要做」清单），供后续会话/其它模型接手。
> **验证**：tsc ✅ 0 错 / eslint ✅ 0 告警 / **全量 vitest 996 passed / 0 failed**（`--maxWorkers=4`，119 文件 1003 用例，7 skipped 为既有 online 项）/ build ✅ 1.51s / `gen:skills` 37 工具幂等。服务端 schema **零变更**（links 集合一期已双站导入；旧列保留是设计而非欠账）。

**上一轮**：2026-10-25（**原子化一期 R1+R2：links 关联层地基 + 级联/恢复联动**；R3 双站部署同日完成）。
① ✅ **登记 8 处全落位**：Dexie **v14**（`links: 'id, kind, updatedAt, [fromType+fromId], [toType+toId]'` —— 端点复合索引是本表读写主路径；替换 mentions/transactions 数组的全表内存扫描正是建表动机，即 v11 注释预埋的「独立关联表」方向）/ `types.ts`（`Link` + `LINK_KINDS` 词表 related/mention/relation/attachment + `LinkEndpointTable` 13 表）/ `SYNC_TABLES` + `JSON_FIELDS_BY_TABLE`（meta 是对象型 json，防 Issue #169 双重编码白屏）/ `collections.json` links 集合（含 restoredAt/deletedAt，**刻意不含 trashSnapshot** —— links 无独立恢复语义，恢复跟随两端实体）/ `pb_hooks SYNC_COLLECTIONS`（盖戳 + 30 天墓碑 cron 覆盖，无下划线命名差异）。
② ✅ **`repositories/links.ts`**：`buildLinkId` 确定性 id（`lk-`+sha256(seed)；双端离线各建同一关联 → 同 id → LWW 直接合流不产生重复；先例：habitLogId 确定性打卡 id、同步层 localId→pbId 映射同一 hash 助手）/ `linkAtoms`（**端点存在且未删前置校验** —— 幽灵纪律③，违例抛可操作错误且事务整体回滚；幂等重建保 createdAt、复活盖 restoredAt）/ `unlinkAtoms`（墓碑幂等静默**不重复盖章** —— deletedAt 是回收站保留期口径字段，被重复 bump 会失真）/ `linksOf`/`linksTo`（复合索引查询；AGENTS.md §4 读路径豁免直连 db）。**Phase 1 不发事件**（拍板 6：事件总线泛化是独立议题，不混入）。
③ ✅ **relation 的 canonical 排序**：按两端 id 字典序定 from/to，任一端发起落同一条 —— 今日 customer.relations 双侧镜像要写两条、增双写删双侧清扫，links 化后一条记录；label 参与 id 判重（Issue #39 条目级口径，同对客户不同语义 = 两条），**重命名关系语义 = 删旧建新**（disc 变了就是另一条关系）。
④ ✅ **既有防漂移锁零改动自动纳管即证**：`collectionName.parity`（4 条）+ `mergeNotesJsonRevive`（7 条）对 links 直接生效 —— SYNC_TABLES ↔ collections.json 集合、json 字段表 ↔ type=json 字段双向一致，无需为新表写登记类测试。
⑤ ✅ **R2 · 删除即解绑（关联层版）**：`cascadeSoftDeleteLinks` 接入全部 5 个 cascade（customer / project / todo / habit / transaction），**清扫端点含子记录**（interactions / habitLogs / milestones / attachments）—— 与实体软删同一事务；被墓碑化的 link id 写进根墓碑新字段 `trashSnapshot.cascadeLinkIds`（TrashSnapshot 可选内嵌字段，json 字段无形状约束，**服务端零 schema 变更**）。幂等：已是墓碑的 link 不重复盖章，快照只在**先删的一方**留档（由此的恢复顺序边界：先删的一方最后恢复，已在测试注释记录）。
⑥ ✅ **R2 · 恢复即回填（关联层版）**：`restoreTrashRecord` 在根与子记录复活**之后**按快照 id 逐条复活（`reviveCascadeLinks`）—— **两端实体都存活**才复活，对端已删则跳过并计数（不为恢复关联复活无关记录）；返回值新增 `revivedCascadeLinks` / `skippedCascadeLinks`，TrashPage 恢复提示同步展示。**为什么按快照 id 而非端点扫描**：用户在实体删除前手动解绑的 link 同样是墓碑，时间戳区分不了「级联牺牲品 vs 用户本意」，只有快照 id 是精确凭证。
⑦ ⚠️ **as-built 裁决两处（设计文档已同步修正）**：(a) purge **刻意不连带物理删 link 墓碑** —— links 不进回收站 UI（不可见、不可独立恢复），墓碑交 `cleanupTombstones` 30 天保留期机制统一清理（保留期正是其它设备拉到墓碑的窗口），反之要扩大 purge「先推后删」顺序硬约束的风险面、收益为零；(b) 恢复函数定名 `reviveCascadeLinks`（快照 id 驱动），替代原设计的 `reviveLinksFor`（端点扫描）。
⑧ ✅ **R3 · 双站 Schema 已导入（同日执行，用户授权）**：`check:schema` 两站各报「远端缺失 1 个集合：links」（无字段差异、无多余集合 —— 反向确认 10-24 的 trash 字段均已在线）→ `PUT /api/collections/import`（`deleteMissing:false`，超管 token，凭据取 `.deploy.env` 分段、不入命令行）测试站 **204** / 正式站 **204** → 复检两站均「**完全一致**」（21 集合）。
⑨ ✅ **线上验证**：links 集合五条规则 `@request.auth.id != ''`、18 字段（含同步元数据）就位；**匿名写入两站均被拒**（400）。⚠️ 顺带实证一条基线：本 PB 版本对规则不过的**匿名 list** 返回 200 空集而非 403 —— 与既有全部集合行为一致（customers/transactions 同款实测），不是 links 引入的偏差；数据不外泄（items 恒空），写路径才是要害且已验拒。
⑩ ⚠️ **随下次常规部署收尾的两件事**（当下零风险：links 表零记录、无消费方）：(a) `pb_hooks` 对 links 的盖戳/墓碑 cron 覆盖需 **PB 重启**才加载（测试站随下次 `deploy.mjs`、正式站随下次镜像发布；在那之前 links 墓碑不进服务端 cron 清理，但也没有任何 link 墓碑存在）；(b) 前端新代码未部署两站（零消费方改动、无行为差异，随下次常规发布即可）。**全量推送跳过**：零 link 记录，无值可补。
> **验证**：tsc ✅ 0 错 / eslint ✅ 0 告警 / **全量 vitest 995 passed / 0 failed**（`--maxWorkers=4`；118 文件，1002 用例 = 998 + 4 新锁，7 skipped 为既有 online 项）/ build ✅ 1.34s。新增测试两份：`links.test.ts` 8 条（id 确定性与判重维度 / relation label 判重 + canonical 落库 / 建联幂等 / 幽灵端点抛错且事务回滚 / 解联幂等不盖章 / 读路径方向与 kind 过滤墓碑不出现）+ `linksCascade.test.ts` 4 条（删客户同事务墓碑化+快照留档+恢复复活 / habit 子记录端点清扫 / 对端已删跳过计数+快照只在先删方 / purge 不动 link 墓碑）。**变异校验两方向均恰红**：M1 拆掉客户级联清扫钩子 → 恰 2 红（断言级 `expected +0 to be 1`，正是依赖该钩子的两条）；M2 复活忽略端点存活性 → 恰 1 红（`expected 1 to be +0`）。

**上一轮**：2026-10-24（**回收站支持永久删除**）。**目标**：误删可以恢复，确认不要的也能真正清掉 —— 此前回收站只有「恢复」一个出口，墓碑只能等 30 天自动清理。
① ✅ **数据层**：`repositories/trash.ts` 新增 `purgeTrashRecord` / `purgeAllTrash`，物理删除墓碑（含 `trashSnapshot.children` 里的子墓碑），单事务完成；`StorageAdapter` 配套新增 `delete` 原语（Dexie / PocketBase 两端），注释写明它**不盖章、不入队**，只服务「墓碑已收敛之后」的清理。
② ⚠️⚠️ **顺序是硬约束：先确认删除已送达服务端，再删本地**。本地行一消失，`pushImpl` 就读不到它（既有 `if (!rec)` 分支直接出队），这条删除**永远送不到服务端**；服务端若仍是 `deleted=0` 的活记录，其他设备会继续拉到活数据并凭更新的 `updatedAt` 写回来 —— 表现为「我删了，一周后它在另一台设备上复活，而这台设备看不到」。故前置新增的 `pushTombstonesNow`，推送失败即抛**可操作错误**（联网重试 / 先改回仅本机），此时本地一条都没删。
③ ⚠️ **服务端墓碑不跟着立即物理删**：它由 `pb_hooks` 每日 cron 按 30 天保留期回收 —— 这 30 天正是其他设备（可能长期离线）拉到该墓碑的唯一窗口。永久删除改变的是「**本机**立即不可见、不可恢复」，不是「服务端立即消失」。此裁决与 `pushImpl` 里「推完就删 = 删除不跨设备传播」的既有结论同源，不要为了「删得干净」去改它。
④ ✅ **只接受墓碑**：对活记录调用直接抛错（把「回收站点错一行」变成删活数据是最危险的假阳性），事务内再复核一次 —— 收集之后被恢复的记录会被放过。子墓碑连带删除，但**已被单独恢复的子记录（活数据）绝不带走**。
⑤ ✅ **页面**：每行加「永久删除」（**不看 `canRestore`** —— 父项已被永久删掉的子记录永远无法恢复，必须留一条能清出去的出口），页头加「清空回收站」；两个独立的 danger 确认弹窗（恢复与永久删除的不可逆性完全不同，不共用）。同时把「父项已被永久删除」的提示从「请先恢复所属客户」改成「已被永久删除，此记录无法恢复」—— 原来那句会让用户一直点一个没有出路的按钮。
⑥ ⚠️ **测试污染修复**：`TrashPage.test.tsx` 补 `afterEach(cleanup)` —— 本仓 vitest 未开 `globals`，testing-library 的自动清理不生效，上一条用例挂载的页面会留在 document 里并跟着新数据重渲染，报「Found multiple elements」，看着像组件 bug。
⑦ ✅ **顺带修掉四条既有 flaky（不是本轮引入的）**：全量首跑 3 条失败全部落在未触碰的文件 —— `todoRowDetail`（深链 `?focus=` 未清参）、`commandPaletteDeepLink`（同）、`settingsSmoke`（8 tab 交互超 5s）。根因是**固定 sleep / 同步断言**：`await new Promise(r => setTimeout(r, 50))` 等固定时长，而清参发生在「数据回填后 effect 重跑」里 —— 单跑必绿、并发必红。改用 `waitFor` 轮询真实条件（断言内容不变，只是不再猜时长）；`settingsSmoke` 给 8 次交互留 20s 预算并补 `afterEach(cleanup)`。
另修 `todoRowExit` 两条同类竞态：退场窗口只有 `ROW_EXIT_DURATION_MS=200ms`，而断言先 `waitFor` 抓一次 `rowOf(...)`、出窗口后再抓第二次 → 第二次拿到 `null`，报 `Cannot read properties of null`（看着像组件崩了，实际是抢窗口）。改为**在同一 `waitFor` 内抓引用**，后续断言复用引用。
⑧ ⚠️ **测试预算全局化**（`vitest.config.ts` + 新增 `src/test/setup.ts`）：本仓 jsdom 用例要等 **IndexedDB 事务 → liveQuery → React 重渲染**三跳，而 testing-library 默认只给 1000ms（`findBy*`）/ vitest 默认 5000ms（单条）。实测同一份代码：worker 启动 1.22s 时全量 3 条失败，5.69s 时 11 条失败 —— **失败数随机器负载漂移**，报错却是 `Unable to find an element` 这种最像「功能坏了」的形状。故 `asyncUtilTimeout` 1000 → 3000ms、`testTimeout`/`hookTimeout` 5000 → 15000ms。**只买等待预算，不改任何断言**；真挂住的用例仍在 15s 内红。⚠️ 刻意不设 30s：过头会让整套测试退化成「等十分钟然后失败」。
⑨ ✅ **`deletedAt` 独立字段（2026-10-24 补）**：墓碑的 `updatedAt` 会被同步合并**反复抬高**（`mergeRemote` 取 `max`），而回收站此前拿它当删除时间 —— 「删除于 / 剩余 N 天」随每次对端合并漂移，`cleanupTombstones` 的 30 天 cutoff 还会被续命（一条旧墓碑可能永远清不掉）。现在：删除时写一次、恢复时清空、合并取较晚者，`cleanupTombstones` 改用它判断；**老墓碑没有该字段 → 读取侧回退 `updatedAt`**（不做数据迁移，`NaN < cutoff` 为 false 也不会被误清）。14 个服务端集合同步加字段。
⑩ ✅ **`notes.mentions` 删除即剪、恢复即回填**：此前只有恢复路径（`trash.pruneDeadRefs`）剪 mentions，**删除侧完全没动** —— 活笔记长期挂一个指向墓碑的 mention。渲染层有 `EntityMissing` 兜底不会崩，但「删除即解绑」是写入端纪律，不能指望每处读取都记得过滤。`TrashSnapshotLink` 新增 `mode: 'mention'`，客户 / 项目 / 待办三处 cascade 剪枝 + 留档，恢复按快照补回（`revision` 用重读后的当前值，避免覆盖同一事务里刚做的解绑）。⚠️ **账本的 mention 仍未覆盖**：账本删除走 `FinancePage` 内联的 `ledgerRepo.softDelete`，本身没有 cascade 函数 —— 属另一个议题，不在这里假装解决。
⑪ ✅ **Schema 已部署（测试站 + 正式站）**：`check:schema` 报 14 个集合字段差异（**纯新增** `restoredAt` / `trashSnapshot` / `deletedAt`，无修改无删除），`PUT /api/collections/import?deleteMissing=false` 两端导入后复检**均「完全一致」**。⚠️ 这条此前被「未部署」挡了两轮 —— 恢复功能在真实环境本来会因 PATCH 未知字段 400；永久删除不受影响（墓碑载荷里这两个字段都是 `undefined`，JSON 会丢弃）。
⑫ ✅ 永久删除确认弹窗补「其他设备 30 天窗口」说明：长期离线（>30 天）的设备可能仍留旧副本，同步后才会消失。

> **验证**：tsc ✅ 0 错 / eslint ✅ 0 告警 / 分组跑全绿：回收站相关 **21 条**（`trash` 9 · `trash.purge` 8 · `TrashPage` 4）· `repositories` + `modules/trash` **6 文件** · `sync` **10 passed / 1 skipped** · `modules/crm` + `modules/notes` **18 文件** · `modules/todo` **163 条** · `src/agent` **27 文件 / 3 skipped**（online 用例跳过）· 首跑失败的 3 个文件修复后 **14 条** · 第二轮全量暴露的 6 个文件修复后 **67 条**。**两端 `check:schema` 均「完全一致」**（导入前 14 个集合差异，纯新增字段）。
> ✅ **全量 vitest：983 passed · 0 failed**（116 文件 / 990 用例 · 7 skipped）—— 用 `npx vitest run --maxWorkers=4`。
> ⚠️⚠️ **一条必须记住的判据：默认高并发下这套 jsdom 用例会「假红」**。同一份代码在默认并发（116 worker）下两次全量分别 **3 failed / 11 failed，失败集合还不一样**，报错形状全是 `Test timed out in 5000ms` / `Unable to find an element`（看着最像「功能坏了」）；降到 **4 个 worker 后一次全绿**。根因是每个用例要等 IndexedDB 事务 → liveQuery → React 三跳，worker 启动从 1.22s 涨到 5.69s 时等待预算就不够了。
> **→ 处置口径：失败数随并发/负载漂移 = 环境问题，不是回归；复验一律 `--maxWorkers=4` 或单文件跑，不要用「重跑一次变绿」当结论，也不要因为它变红就去改业务代码。**

**上一轮**：2026-10-23（**全站回收站：删除快照 + 显式恢复协议**）。**目标**：误删的客户/流水/待办/笔记/项目/习惯可在 `/trash` 恢复，并重建删除时被清空的跨模块关联。
① ✅ **同步层新增唯一受控例外**：`SyncMeta.restoredAt` + `trashSnapshot`；没有 `restoredAt` 的记录仍走原「墓碑不可逆」，有且晚于墓碑才允许复活。推送侧 `pbUpsert`、拉取侧 `mergeRemote` 都按同一矩阵判定；`repository.put` 对墓碑自动盖恢复标记，`softDelete`/cascade 删除清空标记。
② ✅ **删除快照**：客户/项目/待办/文件夹/清单在清除链接前，把当时仍存活的子项与被解绑链接写进根墓碑；流水/习惯记录附件/打卡。恢复时先恢复根、再按快照恢复子项、回填数组/单值/客户关系，目标已删的链接跳过并计数；恢复后清空快照。
③ ✅ **回收站页面**：`/trash` 懒加载页 + 侧栏/移动端入口；按类型/关键词筛选，父子分组，子项父项未恢复时禁用；恢复确认显示将恢复的子记录与关联数。
④ ✅ **文案**：笔记/待办/清单/习惯/流水/客户/项目/文件夹删除确认统一指向回收站（30 天）；不再出现「暂无回收站入口」「此操作不可撤销」等错误表述（保留「清空本地缓存」）。
⑤ ⚠️ **未部署 Schema**：`pb_setup/collections.json` 已给 14 个集合加 `restoredAt`、7 个父级集合加 `trashSnapshot`，但测试站/正式站尚未导入。**恢复写入必须先升级服务端 Schema**（否则 PATCH 因未知字段失败）；`npm run check:schema` 当前会正确报出 14 个集合差异。普通同步已加回退：查不到 `restoredAt` 字段时退回旧字段查询，不会因未升级而整体断掉。
⑥ 验证：`tsc -b` ✅ / `npm run lint` ✅ / `npm run build` ✅；新增同步协议 7 条（文件总计 22 条）+ 回收站数据层 4 条 + 页面 2 条全绿；`mergeJsonFieldRevive` 12 条全绿。⚠️ 全量 vitest 未在单命令内跑完（后台进程被环境回收），合并前需补跑。
**上一轮**：2026-10-21（**Agent 动作面补全：27 → 34 个工具 + 两个运维脚本**）。**触发**：核查正式站时发现镜像停在 10-10（落后 47 提交、缺 `agent_events` 整表），顺着查「AI 接入是否完整」时暴露工具面的洞 —— **AI 建得出、改不了、删不掉**：习惯域只能打卡与删除（用户说「加个跑步习惯」AI 只能拒绝）、流水只能记不能改删、客户/笔记/项目只能建不能删，而 UI 这些入口**全都有**。
① ✅ **先下沉再补工具**：`deleteTransactionCascade`（原 `modules/finance/hooks.ts`）与 `deleteProjectCascade`（原 `modules/projects/hooks.ts`）**上移到 `repositories/index.ts`**，与 `deleteCustomerCascade`/`deleteHabitCascade` 同处 —— 级联是**落库口径**，不该散在带 React 钩子的模块文件里；modules 侧改 re-export，UI/测试导入路径零变化。**不新写删除逻辑**（否则同一语义两份实现，AI 删过的流水会留附件幽灵记录）。
② ✅ **新增 7 个工具**（`habit_createHabit` / `habit_updateHabit` / `fin_updateTransaction` / `fin_deleteTransaction` / `note_deleteNote` / `crm_deleteCustomer` / `project_deleteProject`），三处登记齐备（schema + TOOL_RISK + TOOL_DOMAIN + `AGENT_TOOLS`）。风险分级：创建习惯 low、改流水 medium（金额/日期是脏统计源头）、四个删除 high。
③ ⚠️ **刻意不做 `note_deleteFolder`**：UI **没有删除文件夹入口**（只有新建）。为 AI 发明一个界面都没有的破坏性动作，是**扩大面**而非补齐面 —— 与「只加 UI 已有入口、语义明确的动作」纪律冲突。
④ ⚠️⚠️ **`fin_updateTransaction` 的最关键约束：不得重发 `transaction:created`**。落库走 `saveTransactionWithAttachments`，该函数的 create 门控按「事务前 id 是否存在」判定 → 编辑恒不发事件。**若重发，改一次金额就多算一次奖杯/EXP**，且没有任何界面会表现出来。已用事件捕获锁死（`crudCompletion.test.ts`）。
⑤ ⚠️ **`sideEffects` 必须「先统计后删除」**：删完再统计会恒为 0 → Agent 会告诉用户「没有凭证会被删」。三处删除工具都按此顺序，并在测试里断言非 0（附件 2 个 → `cascadedAttachments=2`）。
⑥ ⚠️ **`updateTransactionSchema` 刻意不展开 `txnLinkField()`**：计算属性键会让 `z.object()` 的输出退化成索引签名，`.refine()` 之后键信息丢失 → executor 侧 `d.customerIds` 报「属性不存在」。改成显式写 6 个键（多几行，但类型是实的）。
⑦ ✅ **遍历测试去掉硬编码**：原 `tools.length !== 27` 与 `covered.size >= 27` 每加工具都要改数字，且**「数字凑够但漏跑某个工具」抓不到**。改为以**运行期 `tools/list` × 静态快照**为基准逐项比对（`toolNames` 进 `SweepResult`）；顺带把习惯域从「本地预置 / 线上挑第一个，缺了就标跳过」改成 **`habit_createHabit` 自造**，两个环境口径终于一致。
⑧ ✅ **新增 `npm run check:schema`**：对比本地 `collections.json` 与远端 PocketBase 的集合/字段差异，只读、不改数据、有差异退出码 1。**它补的正是这次踩到的盲区** —— PocketBase 的集合定义活在数据卷 `data.db` 里，「代码最新」≠「线上 schema 最新」，而缺表时前端照常打开、写入静默 404。测试站实测「完全一致」；正式站因超管账号不同，脚本会给出可操作的 400 提示（`.deploy.env` 的超管只存在于测试站）。
⑨ ✅ **`agent:setup --env <name>`**：凭据分文件存（`~/.workhub/relay.<name>.json`，缺省仍是 `relay.json`），**且不改 MCP 配置** —— 去测试站验收桥不必覆盖正式站那套（两站 relay token 不同，覆盖后忘改回来是「两头都连不上且看不出原因」）。配 `--check` 即用该环境凭据自检。
⑩ ⚠️ **顺带修掉一个真实缺陷（不是本轮引入的）**：补测试时 `check:icons` 拦下 `brain` ——
顺查发现 `HABIT_ICONS` 里的 **`briefcase` 与 `brain` 两个图标在 `src/assets/icons/` 里根本没有对应 SVG**。
后果：用户在习惯表单选这两个图标，落库后**渲染成空白**，而构建/lint/测试全绿（`check-icons` 只扫
`Icon name=`/`icon=` 属性，扫不到「图标名常量数组」这一整类）。修法：补两个别名 SVG（`briefcase ← work`、
`brain ← psychology`，XML 注释写明 material-symbols 无原名）**保住既有数据的 icon 值可渲染**，
并给 `check-icons.mjs` 加**常量数组整块扫描**（`export const *ICONS = [...]`，跨行也覆盖），防同类再犯。
⑪ ✅ **清掉两个部署阻塞并完成正式站升级**（用户「开始处理阻塞」）：
**(a) 制品库 401** —— 官方文档写明登录用户名是 **`cnb`**（不是账号名 `cnb.cMPXRmKswEA`，那是之前的错误用法），令牌取 `cnb git-credential get` 输出的 `password`（94 字符）→ `docker login` **Login Succeeded**，本机与正式主机同时恢复。
**(b) 正式站超管** —— `.deploy.env` 的 `deploy@nexus.local` 密码（20 字符）与正式站 `/opt/workhub/.env` 的 `PB_SUPERUSER_PASSWORD`（24 字符）**不是同一套**；用 `.env` 的那个登录返回 200。⚠️ 入口脚本 `bootstrapSuperuser()` **每次容器启动都执行 `superuser upsert`**（不是仅首启），故正式站密码以 `.env` 为准、不会漂移。
**(c) 导入前先量影响面**（只读拷 `data.db` 比对）：**五个规则字段零差异**（导入不会重置任何线上手工改动）、仅缺 `agent_events` 整表 + `customers.groupId` + `customerGroups.kind` → 全部是**新增**，无删除无修改。
**(d) 结果**：`PUT /api/collections/import`（`deleteMissing:false`）→ 业务集合 **19 → 20**；`compose pull && up -d` → 容器 healthy、revision **`cd74317`**、日志「20 个集合均已存在，跳过导入（幂等）」；`check:schema --url https://team.fpigeon.fun` 输出「**完全一致**」；线上主包含 `habit_createHabit`/`fin_updateTransaction`/`crm_deleteCustomer`/`project_deleteProject` 各 2 处。
⚠️⚠️ **一条判据修正**：线上 asset 哈希与本地 `dist` **不同**（线上 `index-B0dEBjpV.js` vs 本地 `index-qUvlllek.js`），因为 CI 是全新 `npm ci`（依赖树/构建环境与本地不同）—— **「哈希一致」只适用于源码部署通道（devtest），镜像通道必须用代码特征与镜像 revision label 双重判定**，否则会把正常差异误判成「部署失败」。
⚠️ **正式站业务数据全为 0 条**（自 10-10 上线起就是空库，仅 `users` 有 1 个 `demo@nexus.local`）→ 本次升级零数据风险；同时也说明此前从未真正投入使用。
> ⚠️ **仍然明确不做**：正式站部署脚本（用户裁决「部署继续手动，正式站不要用脚本，以后再说」）。本轮只保留了只读检测能力（`check:schema`）与手动步骤，**没有**新增任何发布链路自动化。
> **验证**：tsc ✅ 0 错 / eslint ✅ 0 告警 / **全量 vitest 955 passed / 0 failed**（109 文件 962 用例，+21 新锁，含 3 个 online 跳过的既有项）/ build ✅ 1.95s（主包 435.20 kB · gzip 110.68 kB）/ `check:icons` ✅ 137 引用全存在（可用 243）/ `gen:skills` 幂等（34 个工具，零 diff）/ 功能遍历 **34 工具 + 30 条边界全绿** / `check:schema` 测试站「完全一致」/ **变异校验 3 方向全部有效**：① 编辑流水重发事件 → 恰 1 红（`expected 0, received 1`）② `sideEffects` 改成先删后统计 → 恰 1 红（附件数变 0）③ 从 `AGENT_TOOLS` 摘掉 `crm_deleteCustomer` → **四处同时红**（契约锁 + 正向遍历 + 快照差异 + 覆盖度）。

**上一轮**：2026-10-21（**C-10 ①「表单抽屉骨架」收口完成**）。本仓有 **7 处**手写**同一套**「渲染期重置」骨架（`const openKey` + `[lastKey, setLastKey]` + `if (openKey !== lastKey)`）：5 个 `*FormDrawer` + `GroupEditorDrawer` + `TodoPage` 内表单。① **新增 `shared/useFormReset.ts`**（检测 key 变化 → 执行调用方重置 + 管 `seedKey`），**已迁移 6 处**；`TodoPage` 留在例外表**逐条署名**（「不假装已收口」）。② ⚠️ **两个关键设计决定**：(a) **沿用「渲染期重置」不改 `useEffect`** —— 后者晚一帧会让弹层闪一帧空表单，属**可感知的行为变化**；(b) **`open` 显式传参、不从 key 前缀解析** —— 我第一版写过 `key.startsWith('true-')` 去猜，那是「改 key 拼法就静默失效」的隐式耦合（本仓已有多起此类教训），自查后改掉。③ **保留三处原样差异**（不代劳、逐处可见）：key 拼法各异（`Transaction` 含 `defaultLedgerId`）· `?? 'new'` vs `?? ''`（**无行为差异**，避免无意义改动）· `if (open)` 包不包（`Habit` 刻意不包，字段均有默认值兜底）。④ ⚠️⚠️ **新增防漂移锁 `shared/__tests__/formResetConvention.test.ts`，其判据被变异校验逼着改了一版**：初版查「有 `openKey` 但没 `useFormReset` 字样」→ **变异直接打回**（变异时保留字样就把判据满足了，抓不住回退，已复现）；现行判据查**手写的两个必要件同时出现**（`lastKey` state + `openKey !== lastKey` 比较）—— **与「有没有 hook 字样」无关，那只是手段不是特征**；反向校验里专门放了「混入字样但骨架仍手写」的变体。⑤ ⚠️ **收口前先确认安全网强弱**：6 个抽屉里 `Habit`/`Ledger`/`GroupEditorDrawer` **零测试覆盖** → 故先给 hook 建 **5 条行为锁**并**变异校验两种错误实现**（`seedKey` 无条件递增 → 报红；每次渲染都重置 → 直接触发 React 无限渲染保护）。
> **验证**：tsc ✅ 0 错 / eslint ✅ 0 告警 / **全量 vitest 934 passed / 0 failed**（112 文件 941 用例，+8 新锁）/ build ✅ 1.63s · 两条新锁均经变异校验。

**上一轮**：2026-10-21（**C-7 收口：`NoteEditorPage` 拆分 + 据实测判定「到此为止」**）。**`NoteEditorPage.tsx` 1352 → 1205 行**，抽出 `NoteEditorPieces.tsx`（182 行）：6 个纯展示件（`PreviewSwitch`/`MentionHighlight`/`MentionEntitySummary`/`CardRow`/`EntityMissing`/`SaveBadge`）+ 两个共用类型（`SaveState`/`MentionType`，**定义在新文件、主文件反向导入** = 单一事实源）。① ⚠️ **与前几轮不同，本轮做完「能摘的」后主动停手并写下依据**：主文件剩下的 1205 行中 `NoteEditor` 本体占 **954 行**（509 逻辑 + 445 JSX），看着还能拆，但实测传参成本 —— 顶部工具条（57 行/传 10）· 标签行（44/**含 setTags 写入**）· 悬浮卡（76/**传 11**）· 提及浮层（88/**含 3 个 ref**）。**这些块都活在 `NoteEditor` 闭包内，摘出去 = 把闭包变量显式化成 API**：净减有限，却引入「**props 漏传 → 静默失效**」的新风险面（TS 只挡必填项，可选回调/ref 漏了不报错）—— 本仓已有多起静默失效教训，不该为拆行数换这个风险。② **真正该做的下一刀不是「继续拆组件」，而是先降 `NoteEditor` 的状态耦合**（30 个 hooks：editing/title/mdText/tags/saveState/mention/hoverCard/previewOn + ref 镜像 + CodeMirror 实例）—— 那是**需补交互测试**的独立一轮。③ ⚠️ **另记一处「刻意不合并」**：`MentionEntitySummary`（Issue #50，**点击触发**）与 `design-system/EntityHoverCard`（Issue #140，**hover 触发**+portal+跳转详情）都渲染「实体摘要卡」，但**交互模型不同** → 合并必改一方交互，属回归风险；本轮**只搬零件、不动实现**。
> **验证**：tsc ✅ 0 错 / eslint ✅ 0 告警 / notes 模块 38 测试全绿 / **全量 vitest 926 passed / 0 failed** · **安全网先验证再拆**：变异（`PreviewSwitch` 恒返回 null）→ 精确报红 6 条 · build ✅ 1.62s。
> **C-7 组件级拆分收口**：`TodoPage` 1767→1519（第一步）· `SettingsPage` 1648→563（完成）· `CrmPage` 1282→446（完成）· `NoteEditorPage` 1352→1205（**能安全摘的已摘完**）。

**上一轮**：2026-10-21（**C-7 第二个大文件 `CrmPage` 拆分完成**）。**`CrmPage.tsx` 1282 → 446 行（−65%）**，拆出 3 文件：`CustomerGroupNav.tsx`（306，页内最大一块）· `GroupEditorDrawer.tsx`（242，含 `TagRuleField`）· `CrmListParts.tsx`（327，`IntimacyFilterMenu`/`StatCard`/`CustomerRow`/`CustomerCard` 四个纯展示组件）。① ✅ **本轮安全网是「现成的」，但我先验证它真有效**：该页已有 `crmListPageRedesign.test.tsx` 的 **5 条集成测试**（渲染真实 CrmPage，覆盖分组导航/统计卡/亲密度浮层/叠加关系/清除筛选）—— 但「有测试」≠「能抓住这块消失」，故**拆前先变异**（左栏分组不渲染 → 精确报红 3 条）、**拆后再变异**（组件已跨文件，判据可能失效；清空统计卡 → 精确报红「Unable to find an element with the text: 客户总数」）。两次都有效才认定可作安全网。② ⚠️ **变异手法的一个坑**：第一次用 `{false && <StatCard …}` 包组件 → **引入语法错误**，测试报 `Transform failed` 而非断言失败 —— **这不能证明安全网有效**（只证明代码写坏了）；改用「清空块内容、保留外层结构」才拿到断言级报红。**变异必须落在语法合法位置，否则校验的是解析器而非判据。** ③ **拆分依据（逐组件实测）**：4 个内部组件全部 props 驱动、不依赖页面 state，且**全仓无第二处 import**；两处同名需甄别 —— `stagger.ts` 只在**注释**里提过 `CustomerRow`，`CustomerDetailPage` 有**自己的一份** `StatCard`（同名不同源，属 C-10 另一处重复，**本轮不动** —— 两份视觉细节不同，合并有回归风险）。
> **验证**：tsc ✅ 0 错 / eslint ✅ 0 告警 / **全量 vitest 926 passed / 0 failed**（用例数不变 —— 复用既有集成测试作安全网，未新增）· CRM 模块 97 测试全绿 · build ✅ 1.66s · 两次变异校验（拆前 / 拆后）。

**上一轮**：2026-10-21（**C-2 补漏：防漂移锁的目录盲区 + 接口边界判定**）。**触发**：上轮拆分时发现 `repositories/localAdmin.ts` 仍在直写 `db.transaction`，而第一版锁**只扫 `src/modules|app|shared`** → `src/repositories` 与 `src/sync` **整片未被覆盖**。① ⚠️⚠️ **全仓扫描 6 处后逐处判定，结论是 2 处收口 / 4 处确认为能力边界**：`storage/dexie.ts`（它**就是** `StorageAdapter` 实现层）与 `db/seed.ts`（DB 层播种）**非漂移**；`localAdmin.ts` 三处（`focusSessionRepo.bulkPut` / `restoreFromJson` 依赖 `StorageTx` **没有的 `bulkPut` 原语**；`settingsRepo.save` 因 **`settings` 表主键是 `key`** 而 `StorageTx` 约束 `T extends { id: string }` **类型不兼容** —— 强收只能 `as unknown as` 骗类型，把名义收益变成类型谎言）；`pocketbaseAdapter.enqueueAllForPush` **已收口**（`tx.list` + `tx.enqueue` 等价改写）。② **该函数是「首次接入/更换服务器」关键路径**（漏推一条 = 那批数据永远同步不上），而实测**零行为测试覆盖** → 补 `sync/__tests__/enqueueAllForPush.test.ts`（4 条不变量：墓碑也要入队且 op=delete / 不触碰业务表 / 空库返 0 / 重复调用重复入队）；**变异校验**（墓碑不入队）精确报红 `expected 2 to be 3`。③ **锁扩展**：新增 `GUARDED_DIRS_2 = ['src/repositories','src/sync']` + **署名例外表** `ALLOWED_IMPL`（逐条写明「为何不能经 StorageAdapter」）；判据做成「**报告所有未署名直写点**」而非数量断言（后者「删一处加一处」会保持绿灯）；**变异校验**（改回直写）精确点名 `src/sync/pocketbaseAdapter.ts:668`。④ ⚠️ **方法论教训**：第一版锁**按目录圈范围** → 只要同名职责出现在**另一个目录**就整片逃逸。**圈范围时必须反问「还有哪些目录承担同名职责」。**
> **验证**：tsc ✅ 0 错 / eslint ✅ 0 告警 / **全量 vitest 926 passed / 0 failed**（110 文件 933 用例）/ build ✅ 2.40s / 两条新锁均经变异校验 / `boundary.test.ts` 既有的「localAdmin 豁免」与本次判定相互印证。

**上一轮**：2026-10-21（**C-7 主体完成：SettingsPage 拆分 + 顺带修掉一个真缺陷**）。① **C-7 `SettingsPage` 1648 → 525 行**（−68%），拆出 6 个文件：`settingsUi.tsx`（共享基础件）· `AppearanceTabs.tsx`（色彩与密度 + 字体与排版）· `NotificationsTab.tsx` · `ShortcutsTab.tsx` · `SecurityTab.tsx`（最大一块：6 handler + 5 state 一并搬走）· 加既有 `AiBridgeSection.tsx`，**8 个 tab 全部独立成组件**。② ⚠️⚠️ **先建安全网再动手**：实测该页**全仓零测试覆盖** —— 此条件下拆分若某 tab 白屏，tsc/lint/全量测试**都不会有信号**。故先建 `settings/__tests__/settingsSmoke.test.tsx`（逐 tab 切换 + 断言内容区渲染）。③ ⚠️⚠️ **这条安全网的判据被变异校验打回三次**（全程留档）：(a) `body.textContent.includes(标签名)` → **假绿**（标签名被**导航按钮自身**满足，删掉整个内容块也全绿）；(b) `document.querySelector('.anim-enter')` 取第一个 → **仍假绿**（各 tab 是兄弟节点，其它 tab 的节点还在 DOM 里，取到的未必是本 tab）；(c) ✅ 最终断言**该 tab 独有标记文本**（取自各 tab 的 `Section title`）→ 变异（`{false && tab === 'notifications' && …}`）被**精确抓出**。**→ 任何防回退判据都必须先用变异自证；不加变异校验的锁等于没有锁。** ④ ⚠️ **真机验证顺带发现并修掉一个真缺陷**：headless 实测 `/settings` **永久停在「设置载入中…」**（对照正式站旧版**同样如此** → **非本次拆分引入**）。根因：`settingsRepo.get()` **只有 `.then`、没有 `.catch`** —— 读失败（IndexedDB 被阻断/隐私模式/配额耗尽/库损坏）时 Promise 永不 resolve → 整页永久卡载入态且**零提示**（本仓最忌讳的静默失败；`/todo` `/crm` `/finance` 走 `useCollection` 有同步默认值故无此问题）。**已修**：失败回落 `DEFAULT_SETTINGS` + 页面显式错误横幅，并新建锁 `settings/__tests__/settingsLoadError.test.ts`（含变异校验）。⑤ **C-10 部分收口（发现真实漂移）**：`Toggle` 原有两份实现 —— `SettingsPage` 用 `left-0.5/left-[22px]`、`moduleConfig/parts.tsx` 用 `translate-x`（后者已按 DESIGN.md 规则 1 改造：`left` 每帧触发 layout，`translate` 只走合成层）→ **统一到 translate 版本**（视觉等价：44px 容器 − 20px 滑块 = 24px 行程）。⚠️ **`Segmented` 未合并**：`finance/FinancePage.tsx` 另有同名组件，但两者**视觉与签名都不同** → 合并会改变视觉，属回归风险，**只记录差异不合并**（避免「为去重而改外观」）。
> **验证**：tsc ✅ 0 错 / eslint ✅ 0 告警 / **全量 vitest 920 passed / 0 failed**（109 文件 927 用例）/ build ✅ 1.62s · 冒烟锁 8 tab 全绿 · 两条新锁均经**变异校验**（tab 消失 / catch 被删 都能精确报红）· **真机 headless 复验**设置页与各路由。
> ⚠️ **本轮我自己的低级失误（三条，已记录）**：凭印象写 tab 标签（真实是「色彩与密度」不是「信息密度」）· `waitFor(...)` 少一层括号 · 判据取 `settingsRepo` **首次出现**（那是 import 行，非调用点）→ 断言必然失败。**都是「没先看真实值就下断言」。**

> 📦 **更早的轮次明细（2026-09-10 ~ 2026-10-21，共 68 轮）已归档** → [`docs/PROGRESS-archive-2026H2.md`](PROGRESS-archive-2026H2.md)。
> 本文件正文只保留最近约 15 轮（规则见 `AGENTS.md §7`）；**"现在做到哪了"看本文上面的状态表，历史细节看归档**。
---

## 一、当前状态总览

| 项 | 状态 |
|---|---|
| 版本 | **v1 开发完成，已部署线上** |
| 全站回收站 | ✅ 代码与 `/trash` 页面已落盘；**服务端 Schema 已升级**（14 个集合 `restoredAt` + 7 个父级 `trashSnapshot`，2026-10-24 双站导入完成；2026-10-26 复查两站 `check:schema` 均「完全一致」） |
| 测试环境 | `http://<TEST_HOST>:9001`（devtest 直连，**明文 HTTP、无域名**；PocketBase 与本站在同机，PB 实为 `127.0.0.1:9002`，9001 是宿主 nginx） |
| 里程碑 | M1-M6 全部验收 ✅ |
| 服务端 Schema | 以 `pb_setup/collections.json` 为准：**21 个集合条目**（业务实体 19 + 同步基础设施 2：`sync_state`/`agent_events`；`links` 于 2026-10-25 双站导入）。⚠️ 正文历史轮次里的「17 collections / 20 collections / 13 张业务表」等数字是**当时快照**，不代表现状 |
| 审计问题 | 2026-10 历史批次 P0×2 / P1×19 / P2×60 **全部清零**。**2026-10-26 全仓复审**：P0 = 0 / P1 = 3 / P2 = 12（报告 `docs/审计报告-全仓-20261026.md`），其中 P1 三项已整改（事实源校正 / CI 门禁 / 文档口径），**`zod < 4.6.6` 高危仍待拍板**；P2 已修 10 项、3 项如实挂起 |
| 同步机制完善 | P0-1 墓碑清理竞态修复 + P0-2 推送侧 LWW ✅；P1-3 服务端墓碑 cron ✅；**P1-4 HTTPS/PWA 未闭环**（2026-10-09 更正，见下方 P1-4 行与「二、遗留问题」）；正式环境 `team.fpigeon.fun` 已上线（LE 证书 + `http→https` 301），但 **PWA 装机/离线能力需在该正式域名上复验**；Issue #140 多关联 json 字段已入 `collections.json`（**自托管端需重新导入并重启**，见部署指南） |
| 正式环境（**已上线**） | **https://team.fpigeon.fun** 已部署运行（2026-10-09）。CNB 制品库 `docker.cnb.cool/blueteam0715/workhub:latest` → 主机 `1204pigeon`(<PROD_HOST>) 的 `/opt/workhub/`，**单容器全包**（前端 + relay + PocketBase，同源路由；**不含 Tauri 手机端/桌面端**），只绑回环 `127.0.0.1:8790` + 宿主 nginx 反代（acme.sh 单独签发的 TLS）。数据持久化在 `/opt/workhub/data`；资源上限 768m / 1.0 核 / 256 PIDs。**已关闭 `users` 集合的公开注册**（PB 默认 `createRule` 为空 = 任何人可自助注册，而业务集合规则是「登录即可读写全部」→ 组合起来等于公网裸奔；现设为 Locked，账号改由超管手工建。⚠️ **该设置只存在数据卷的 `data.db` 里、不在代码里**，换机/重建空库后需重做一次）。流程、端口占用、排错与这条加固步骤见 `docs/Docker镜像构建与部署.md`。⚠️ **2026-10-21 已升级**：镜像 label `org.opencontainers.image.revision` = **`cd74317`**（此前停在 `20dac51`/10-10，落后 47 提交）。同批完成 schema 导入 → 业务集合 **19 → 20**（补 `agent_events` + `customers.groupId` + `customerGroups.kind`），`check:schema` 对线上输出「**完全一致**」。判据不靠猜：线上主包含 4 个新工具名（各 2 处）、容器日志确认「20 个集合均已存在，跳过导入（幂等）」。⚠️ **正式站业务数据全为 0 条**（自上线以来就是空库），故本次升级零数据风险。**现状台账 / 上线判据 / 首次验收清单 / 回滚口径见 [`docs/正式站状态与上线清单-20261026.md`](正式站状态与上线清单-20261026.md)**（2026-10-26 实测：镜像 `cd74317` 落后 main **26 提交**，schema 已 21 集合一致 —— 「新 schema + 旧代码」，**先部署再录数据**）。**2026-10-27 进展**：制品库 `latest` 已到 `a5f6bdf` 且**质量门禁每次 push 均通过**；**正式站已部署到 `a5f6bdf`**（容器 healthy / 21 集合幂等跳过导入 / 公网四端点 200 / `check:schema --prod` 完全一致），部署前已备份 `pb_data.bak-20261027-002612` 并打回滚 tag `workhub:rollback-20261027-002557`。⚠️ **本行此前写的「镜像 `cd74317`」是过时记录**：上机实测部署前实为 `ab0d253`（10-26，落后 main 仅 5 提交），误判来源与纠正判据见 `docs/正式站状态与上线清单-20261026.md §二` —— **判断线上版本只认主机 `docker image inspect` 的 revision label，不认文档记录**。**正式站部署无留痕机制**（`.deploy-state` 只记测试站）已列为待补 |
| 多端 App（Tauri v2） | 阶段 1 代码已落盘（`src-tauri/` 桌面壳 + `src/platform/env.ts` 运行环境探测 + 构建期 CSP 插件 + `app:*` 脚本）。**macOS 客户端已交付（2026-10-12）**：`Nexus Workspace.app`（9.42 MiB / arm64 / ad-hoc 签名）+ `Nexus Workspace_0.1.0_aarch64.dmg`（3.76 MiB，`hdiutil verify` 通过、内含 app 与 `Applications` 软链）双产物打通，产物新鲜度以「包内嵌资源名与 `dist` 逐字一致」为证；分发出货走 ad-hoc（自用），**签名/公证不做**。渲染 / 托盘生命周期 / 真实同步三项**待人工点击验收**（清单见 `docs/多端App改造方案-Tauri.md` §11）。**Web 镜像刻意排除它**（`.dockerignore` 挡 `src-tauri/`、插件按 `TAURI_ENV_PLATFORM` 自判空转），故不影响正式环境。方案见 `docs/多端App改造方案-Tauri.md`。⚠️ `src-tauri/target/`（Rust 编译产物，约 1.1G）由 `src-tauri/.gitignore` 的 `/target/` 规则忽略，**不会入库**。**Android 客户端已出包（2026-10-27，B 范围）**：`src-tauri/gen/android/` 入库，release APK **11 MB**（`fun.fpigeon.nexus` / arm64-v8a / targetSdk 37 / v2 签名 / zipalign 通过），签名密钥**只在仓库外** `~/.workhub/android/`；已做 edge-to-edge 安全区与 `adjustResize`，返回键/文件选择由 Tauri 内建。⚠️ **未真机验收**（无设备、无 KVM）；存储仍为 Dexie（阶段 2 未做）。**构建通道（2026-11-01 变更）**：改由 **GitHub Actions** 出包（`.github/workflows/android.yml`，签名密钥在仓库 Secrets），**已跑通**（10 分 52 秒 / 12MB 已签名 universal APK），CNB 的 `.android-builder-image` / `.android-apk` 两个 job **保留未启用**；**CNB → GitHub 镜像同步已停用**，GitHub 副本改为本地双推。详见 `docs/多端App改造方案-Tauri.md` §12 |
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
| M6 多端同步 | 离线写入 + 在线自动同步 | ✅ 推送 27 条落库、服务端记录拉取到新设备，实测通过 |

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
