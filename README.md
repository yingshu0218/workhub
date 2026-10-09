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

按**版本**记录的变更摘要见 [`CHANGELOG.md`](CHANGELOG.md)（版本 = git tag）。当前版本 **v1.2.1**。

| 想看什么 | 去哪 |
|---|---|
| 每个版本改了什么（摘要） | [`CHANGELOG.md`](CHANGELOG.md) |
| 现在做到哪了、逐轮记录 | [`docs/PROGRESS.md`](docs/PROGRESS.md)（**唯一进度事实来源**） |
| 旧版逐条明细（#1~#128） | [`docs/CHANGELOG-详细流水-v1.0.0至v1.2.1.md`](docs/CHANGELOG-详细流水-v1.0.0至v1.2.1.md) |
| 某一步怎么实现的 | git 提交历史 |
