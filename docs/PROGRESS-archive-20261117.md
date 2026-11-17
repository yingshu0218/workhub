# 进度归档 · 2026-11-17

> 从 PROGRESS 迁出最早一轮，保留最近约 15 轮与完整状态总览。以下为历史记录。

**上一轮**：2026-11-02（**认证口径复核与收尾**：用户名退成展示字段）
**范围**：接下面的「首启自助注册」，只补测试锁、统一文档口径、清理旧脚本，不新增功能。
**① 首启请求必须传原始用户名**：`/setup/user` 收用户输入，后端校验「不能含 @」并自行拼 `<用户名>@workhub.local`；只有登录端做映射（`AuthGate.toIdentity`）。`authGate.test.tsx` 补了请求体断言 —— 此前误传映射值也能全绿（已做变异校验：还原旧写法该用例变红）。
**② username 退成可选展示字段**：`passwordAuth.identityFields` 固定只有 `email`（0.40 文本字段无 UNIQUE，加 username 必被拒）；首启只 best-effort 补字段，**补不上就不往建号请求里带**（否则 PB 以未知字段 400，首启锁死）。旧的 `patch:users-auth` 脚本与 npm 命令已删除，已有部署无需任何 patch。
**③ 占位邮箱统一小写**（真机发现的边界）：PB 0.40 **不归一化邮箱大小写**（实测 `Alice@...` 与 `alice@...` 是两个值）。现在 `parseSetupInput` / `AuthGate.toIdentity` / `entrypoint` 三处都用 `<用户名 小写>@workhub.local`，username 仍按输入展示 —— 注册 `Alice` 后输 `Alice` 或 `alice` 都能登录。
**④ 兜底管理员只按 email 建号**：`entrypoint.mjs` 的 filter 不再引用可能不存在的 `username` 字段（新库查询会 unknown field 400）；建号也不写 username。
**⑤ 顺带**：`AuthGate` 三处表单统一用设计系统 `Button`（补 `type` 透传）；`todoRowDetail` 深链清参断言改为等待导航落地（修全量并发下的假红）。
> **本轮验证**：`setupRoutes.test.mjs` **14 条** + `authGate.test.tsx` **8 条** + `buttonSubmit.test.tsx` **1 条**；`npm run check:all` 全绿 —— **1123 passed / 0 failed / 7 skipped**（138 文件）。**真实 PB 0.40.2 空库冒烟全过**（临时目录、未进仓库）：全新库按 email filter 查询 200 / 兜底管理员建号 200 / `hasUsers=false` / setup 建号 200 / 映射邮箱自动登录 200 / 第二次 409 / 大写用户名归一化后大小写均可登录。
⚠️ **状态**：代码已提交，推送与线上部署以 git / 发布记录为准。
