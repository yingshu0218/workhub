# 寻鸽工作台 (Nexus Workspace)

面向个人/小团队的一体化数字工作台：CRM、财务、待办、笔记、习惯五大模块全链路闭环 + 游戏化成长体系（EXP 等级 / 奖杯收集）。

## 当前进展

- ✅ 设计资料整理完成（21 页高保真原型 + 设计系统规范）
- ✅ 开发计划定稿
- 🚧 开发中（React + Vite + TS · Local-First · 自托管 PocketBase 同步）

## 目录

```
├── design/                # 设计资料
│   ├── DESIGN.md          # 设计系统规范
│   ├── README.md          # 页面索引
│   └── prototypes/        # 21 页原型（每页 code.html + screen.png）
└── docs/
    └── 寻鸽工作台-开发计划.md
```

## 技术方案概要

- **前端**：React 18 + Vite + TypeScript + Tailwind CSS，Web 优先
- **数据**：Local-First，IndexedDB（Dexie）为唯一读写源，离线可写
- **同步**：LWW（最后写入胜出）变更队列，在线自动与自托管服务器同步
- **后端**：自托管 PocketBase（单二进制 + SQLite），部署于自有云服务器，无第三方云依赖
