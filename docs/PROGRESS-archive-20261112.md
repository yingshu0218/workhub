# 寻鸽工作台 · 2026-11-02 轮次归档

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
