# 寻鸽工作台 (Nexus Workspace)

> ⚠️ **本仓库当前处于开发阶段**：所有内容（设计资料、文档、代码）均在活跃迭代中，接口与结构可能随时调整，请勿用于生产环境。

## 仓库用途

本仓库是「寻鸽工作台」项目的**唯一主仓库**，集中管理：

- **设计资料**（`design/`）：21 页高保真原型 + 设计系统规范，作为开发实现的对齐基准
- **项目文档**（`docs/`）：开发计划、架构决策记录
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
├── docs/
│   └── 寻鸽工作台-开发计划.md  # 技术架构 / 数据模型 / Phase 0-7 排期 / 决策记录
└── README.md                  # 本文件
```

## 协作约定

- **Changelog**：每次变更提交，必须在下方 Changelog 表格追加一行（序号 / 日期 / 变更摘要 / 提交人），序号按时间顺序递增，与代码提交同一次 commit 完成
- **提交署名**：统一使用 CNB 账号身份提交
- **设计对齐**：UI 实现以 `design/DESIGN.md` 与 `design/prototypes/` 截图为准

## Changelog

| 序号 | 日期 | 变更 | 提交人 |
|---|---|---|---|
| 1 | 2026-09-06 | 设计资料入库：21 页 Stitch 原型合并为单目录并语义化重命名（01-dashboard ~ 21-profile），补设计规范与页面索引 | yingshu0218 |
| 2 | 2026-09-06 | 开发计划补充多设备场景（2 人 × ≥4 端）适配约定：持久化存储申请 / 统计从源记录推导 / 同步绑定 workspace | yingshu0218 |
| 3 | 2026-09-06 | 定案终端路线三阶段：Web 优先 → PWA 过渡 → Tauri 2 原生三端；repository 层存储可插拔 | yingshu0218 |
| 4 | 2026-09-06 | 确立数据持久性模型：服务端为数据真源，本地 IndexedDB 为可丢弃离线工作副本 | yingshu0218 |
| 5 | 2026-09-06 | 定案存储演进路线：现用 Dexie/IndexedDB，条件触发时切 SQLite WASM；查询 Hook 抽象纳入 Phase 0 | yingshu0218 |
| 6 | 2026-09-06 | 重写根 README：仓库用途说明、开发阶段标识、Changelog 协作约定 | yingshu0218 |
| 7 | 2026-09-06 | Changelog 表格增加序号列 | yingshu0218 |
