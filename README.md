# 寻鸽工作台 (Nexus Workspace)

> ⚠️ **本仓库当前处于开发阶段**：所有内容（设计资料、文档、代码）均在活跃迭代中，接口与结构可能随时调整，请勿用于生产环境。

## 仓库用途

本仓库是「寻鸽工作台」项目的**唯一主仓库**，集中管理：

- **设计资料**（`design/`）：21 页高保真原型 + 设计系统规范，作为开发实现的对齐基准
- **项目文档**（`docs/`）：开发计划、架构决策记录、**进度看板（`docs/PROGRESS.md`，实时状态以此为准）**
- **应用代码**：React Web/共用客户端、PocketBase 命令事务与服务端 Agent 执行器

「寻鸽工作台」是一款完全个人使用的助手，以外部 Agent 自然语言录入为主要入口。现有 CRM、财务、待办、笔记与习惯提供业务基础；已接入今天、个人时间线、联系人上下文和有界事实图谱，业务记录与外部 Agent 指向同一事实。完整交付、34项矩阵与边界见[第三次验收](docs/个人助手第三版验收-20261112.md)，实时进度仍只认 PROGRESS。

## 当前状态与终端路线

| 阶段 | 形态 | 状态 |
|---|---|---|
| 一（本期） | Web 浏览器优先（React + Vite + TS） | 🚧 开发中 |
| 二（过渡） | PWA（manifest + 基础 Service Worker） | 🟡 基础件已就绪（`public/sw.js` + `manifest.webmanifest` 已落盘），待正式环境 HTTPS 激活 |
| 三（终态） | Tauri 2 原生 App：Android / Windows / macOS | 🟡 Android 运行时地址与隔离候选已有调试 APK 和自动/静态验收；真机与真实远端联调、release 交付未完成。历史包另计 |

- **数据架构**：自托管 PocketBase 0.40.2 命令事务为真源；生产 Web 成功提交后更新 Dexie 镜像。稳定请求、具体预览、版本冲突和数据世代约束见 [可靠提交协议](docs/可靠提交协议-20261111.md)。生产 Web 与原生端共用有界跨表增量缓存；Android 调试 APK 已构建并通过自动/静态验证，真机与实际远端服务仍待联调，见 [Android 客户端验收](docs/Android客户端验收-20261112.md)。旧包/旧队列先导出核对，完整离线复合写入另行实施。
- **缓存与草稿**：服务器持久保存正式事实，镜像按身份/世代隔离并可重建；未提交草稿与旧队列须保留核对，不能随业务缓存一起静默丢弃。首轮固定水位快照后按有界增量补拉，断网不显示已入账

独立 Agent 从「设置 → Agent 接入」按客户端签发最小能力凭据，可单独撤销。远程直连站点 `/relay/mcp`，无需页面在线；迁移与客户端契约见[客户端协议](docs/个人助手客户端协议-20261112.md)。

验证入口：`npm run check:all`、`npm run build`、`npm run build:server`；真实PB合成验证使用 `PB_BIN=<0.40.2> npm run test:clients`、`npm run test:personal` 与 `npm run test:integration`。不自动连接正式库。

## 目录结构

```
├── src/                       # 页面、领域、仓储、隔离客户端与同步
├── pb_setup/                  # 自托管PB schema/冻结迁移/hooks/备份恢复
├── relay/                     # 同源MCP认证与协议桥
├── scripts/                   # 构建、部署和合成验证入口
├── src-tauri/                 # 原生壳与生命周期接线
├── design/                    # 设计资料
│   ├── DESIGN.md              # 设计系统规范（Team Blue #004AC6 / Inter / 4px 基线）
│   ├── README.md              # 21 页原型索引
│   └── prototypes/            # 01-dashboard ~ 21-profile（每页 code.html + screen.png）
├── CHANGELOG.md               # 更新日志（按版本摘要）
├── docs/
│   ├── 寻鸽工作台-开发计划.md  # 技术架构 / 数据模型 / Phase 0-7 排期 / 决策记录
│   └── PROGRESS.md            # 进度看板（唯一进度事实来源）
└── README.md                  # 本文件
```

## 协作约定

- **进度文档（最高优先）**：[`docs/PROGRESS.md`](docs/PROGRESS.md) 是本仓库**唯一的进度事实来源**。任何开发变更（完成阶段/修复/部署/新增模块）必须在**同一个 commit** 里更新它的状态表格与「最后更新」时间。**保持它及时更新不是可选项**——它是所有人（包括 AI 开发代理）判断"现在做到哪了、接下来做什么"的唯一依据，文档滞后 = 进度失真 = 重复开发或漏做。审代码时先看它，动手前先读它
- **更新日志**：**不再逐条记流水**。发版本（打 tag）时在 [`CHANGELOG.md`](CHANGELOG.md) 追加该版本小节（版本号 / 日期 / 变更摘要）；日常逐条记录交给 [`docs/PROGRESS.md`](docs/PROGRESS.md) 与 git 提交历史
- **提交署名**：统一使用 CNB 账号身份提交
- **设计对齐**：UI 实现以 `design/DESIGN.md` 与 `design/prototypes/` 截图为准

## 更新日志

按**版本**记录的变更摘要见 [`CHANGELOG.md`](CHANGELOG.md)（版本 = git tag）。最新已发布里程碑 **v1.3.0**（可靠性改造尚未打 tag）。

| 想看什么 | 去哪 |
|---|---|
| 每个版本改了什么（摘要） | [`CHANGELOG.md`](CHANGELOG.md) |
| 现在做到哪了、逐轮记录 | [`docs/PROGRESS.md`](docs/PROGRESS.md)（**唯一进度事实来源**） |
| 旧版逐条明细（#1~#128） | [`docs/CHANGELOG-详细流水-v1.0.0至v1.2.1.md`](docs/CHANGELOG-详细流水-v1.0.0至v1.2.1.md) |
| 某一步怎么实现的 | git 提交历史 |
