# AGENTS.md — 寻鸽工作台（Nexus Workspace）

> 本文件是本仓库**面向 AI Agent 的唯一入口**。Codex / Hermes / opencode / WorkBuddy 都会自动读取它；
> 其它工具（Claude Code / Gemini CLI / Cursor）由 `npm run agent:setup` 生成指向本文件的薄壳，**规则不复制第二份**。
>
> 写法约定：只留「不知道就会做错」的内容。它不是百科，写长了会稀释重点、抬高每次请求的固定成本。

## 1. 项目是什么

面向个人/小团队的**一体化数字工作台**：CRM · 财务 · 待办 · 笔记 · 习惯五大模块闭环，外加游戏化成长体系（EXP / 等级 / 奖杯）。
2 人团队 × ≥4 台设备，Local-First，自托管同步。

⚠️ **开发阶段**：接口与结构随时调整，不可用于生产。

## 2. 动手前必读（顺序不能反）

| 顺序 | 文件 | 为什么 |
|---|---|---|
| 1 | `docs/PROGRESS.md` | **唯一进度事实来源**。判断「做到哪了、接下来做什么」只认它 |
| 2 | `README.md` 的「协作约定」+ `CHANGELOG.md` | 提交纪律与版本变更摘要 |
| 3 | 涉事模块的 `docs/审查报告-*.md` | 已知缺陷与已裁决口径，避免重复踩坑 |

审代码先看 PROGRESS，动手前先读 PROGRESS。

## 3. 技术栈（已锁定，勿擅自替换）

React 18 · Vite · TypeScript strict · Tailwind 4 · Zustand · Dexie(IndexedDB) · react-router v6
预留：d3-force · CodeMirror 6 · marked · SQLite WASM（迁移口已留）

后端：**自托管 PocketBase**（自有云服务器）。
**明确禁止引入第三方云服务**（LeanCloud / Supabase / 腾讯云开发等）—— 数据主权是本项目的硬前提，
有替代方案时先列对比再等拍板，不要直接装依赖。

## 4. 目录地图

```
src/repositories/   写入口唯一层：所有落库走这里（存储无关，Dexie / TauriSqlite 可替换）
src/domain/         动作编排唯一层：跨表编排（记账口径、默认账本策略…）
src/agent/          agentOps：MCP 工具 schema / 执行器 / 浏览器侧桥
src/sync/           LWW 同步引擎（2s 去抖队列 + 30s 心跳 + online 触发）
relay/              MCP relay：内嵌于站点，同源挂载 /relay
scripts/            构建 / 部署 / skill 生成 / Agent 配置
design/prototypes/  21 页原型（01-dashboard ~ 21-profile）—— UI 对齐基准
docs/               开发计划 / 进度 / 审查报告 / 部署指南
```

## 5. 常用命令

```bash
npm run dev            # 开发（relay 自动内嵌在 /relay，无需第二个进程）
npm run build          # check:icons + tsc -b + vite build
npm test               # vitest
npm run lint           # eslint src
npm run gen:skills     # 从 skillSource.ts 重新生成 docs/skills/*（自动生成物，勿手改）
npm run agent:setup    # 一键把本项目接入本机已有的 Agent 工具（见 §8）
npm run serve          # 生产形态：同进程托管 dist + relay（同源 wss）
```

## 6. 硬性工程纪律（都是踩过坑换来的，不要绕过）

1. **事件永在事务之后**。`emit` 只在 repositories 复合函数的事务 commit 之后发出，**绝不进事务体**。
   测试以「emit 时记录已可读」固定这条不变式。
2. **单一事实源 + 防漂移**。同一语义只允许一份实现：
   - 事件收口 → `src/repositories/`
   - 动作编排 → `src/domain/`
   - Agent 工具 schema → `src/agent/skillSource.ts`（`docs/skills/` 由它生成，任何「加了工具没写 skill」都会被 `skill.parity.test.ts` 拦下）
   - UI 与 AI 走同一条落库路径，不许各写一遍
3. **幽灵记录一律可操作错误**。对不存在/已删记录返回「成功」是最危险的假阳性。关联校验必须前置，
   禁止产生悬挂引用。
4. **删改类动作走既有级联函数**，不新写删除逻辑；完成后返回 `sideEffects` 供转述。
5. **读工具必须限幅**：投影白名单 + 条数上限，超限截断并返回 `truncated: true`，绝不静默全量返回。
   （笔记正文不进投影 —— 会撑爆上下文。）
6. **DB schema 变更 = 服务端必须同步升级**。`src/db/db.ts` 出现新 `version(N)` 或新表时，
   必须同步更新 `pb_setup/collections.json` 并走部署指南的 Schema 升级流程，否则 PocketBase 静默丢字段。
7. **不硬编码环境地址**。站点/同步地址一律运行时填写或走环境变量；
   测试服务器是**临时环境**，正式上线会换机器、域名、HTTPS 与账号体系。
8. **中文注释写「为什么」不写「是什么」**。关键取舍要留理由（本仓库大量注释记录的是「曾经踩过的坑」）。

## 7. 提交规范

- **同一个 commit 内**必须更新 `docs/PROGRESS.md`（状态表格 + 「最后更新」）。
- **Changelog 已改为版本级**（2026-10-09）：**不再逐条记流水**，只在**发版本（打 tag）时**往根目录
  `CHANGELOG.md` 追加该版本小节（版本号 / 日期 / 要点）；日常逐条记录交给 PROGRESS 与 git 提交历史。
  旧 README 底部的逐条表格（#1~#128）已归档到 `docs/CHANGELOG-详细流水-v1.0.0至v1.2.1.md`（**只归档、不再追加**）。
- 提交署名统一用 CNB 账号身份。
- 推送前先过 pre-push 检查（`.pushcheck.conf` 定义规则）。
- **一次提交只做一件事**。批量修复要分组，不要混成一坨。

## 8. 接入 Agent（本项目自带的桥）

本项目把 27 个业务工具（客户 / 流水 / 待办 / 笔记 / 习惯 / 账本…）通过 MCP 暴露给外部 Agent，
数据始终留在浏览器 IndexedDB，relay 只转发、零特权。

```bash
npm run agent:setup                    # 探测本机 Agent 工具并写好 MCP + 规则 + skills
npm run agent:setup -- --check         # 连通性自检
npm run agent:setup -- --dry-run       # 只预览改动，不落盘
```

接入后 **Agent 配置里不要出现 token**：token 集中在 `~/.workhub/relay.json`（由上面的命令写入），
由 `relay/mcp-stdio-shim.mjs` 读取并透传。

**前置条件（配不出来的那部分，必须人工）**：relay 要有工具清单，前提是**站点页面在线并已在
「设置 → AI Agent 桥」启用桥**。否则 `tools/list` 返回 `-32001 工具清单不可用` —— 这不是配置错误。

安全边界（改动前先想清楚，五条都不许放宽）：token 鉴权 · 按域能力白名单 · 中风险一次性确认票据
（**票据绑定参数指纹**，防「预览 A 执行 B」）· relay 零特权不 import 业务代码 · 数据不出浏览器。

## 9. 禁区

- ❌ 不要 `git push --force` / 改写已推送历史
- ❌ 不要删除或改动 `admin@nexus.local` 的密码（部署专用账号是 `deploy@nexus.local`）
- ❌ 不要把 token / 密码 / 服务器地址写进任何入库文件
- ❌ 不要手改 `docs/skills/`（自动生成）、`dist/`、`*.tsbuildinfo`
- ❌ 不要为「顺手」引入新的运行时依赖 —— 先列对比、说明代价、等拍板

## 10. 协作节奏（本仓库的既定工作方式）

- **先评估再安装**：装依赖 / 改架构 / 动 schema 前先给方案与代价。
- **破坏性操作先确认**：删数据、改已推送历史、动服务器，一律先问。
- **多决策点合并待拍板**：一次把要拍板的项列全，不要挤牙膏式追问。
- **并行工作流**：每阶段 1 dev + 1 audit（审上一阶段）+ 1 fix（只修 P0/P1），开发与修复走独立轨道。
- **批量积累问题**，不要在开发中途随手改无关的东西。
- 事实层面**必须反向核验权威源**（政策编号 / 日期 / 引用）。遇上位源文件的错误要显式标注，不要静默照抄。
