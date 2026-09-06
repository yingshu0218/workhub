# 寻鸽工作台 · Phase 0-1 代码审计问题汇总

> **处理状态**：P0×2 + P1×6 已全部修复并验证（2026-09-06）；P2×9 挂起，后续批次统一处理。

> 审计执行：校对子 agent（只读）· 审计对象：commit e1c0aaf / 7a878ef · 基准：开发计划 + 原型图
> 处理约定：本文档只登记问题与修复方向，**经确认后再安排修复**

## 问题统计

| 级别 | 数量 | 定义 |
|---|---|---|
| P0 | 2 | 数据丢失 / 核心逻辑错误 |
| P1 | 6 | 同步正确性 / 边界缺陷 / 架构偏离 |
| P2 | 9 | 风格 / 性能 / 体验 |

---

## P0（必须修）

### P0-1 专注计时自然结束少记 1 分钟，自动打卡联动整体失效
- **位置**：`src/stores/focus.ts` start/resume 的 interval 回调
- **问题**：倒计时在 `remaining === 1` 时结束并记 1499 秒 → floor 后为 24 分钟，而非 25
- **影响链**：`focus:completed {minutes:24}` → effects.ts 判断 `24 < 25(targetMinutes)` → **「完成深度专注 → 习惯自动打卡」核心链路在自然结束路径下永不触发**；「今日专注分钟」每次少计 1
- **修复方向**：自然结束按完整时长（或 startedAt 墙钟）记账，elapsed 统一由单一函数推导

### P0-2 编辑待办静默丢失未入表单的字段
- **位置**：`src/modules/todo/TodoPage.tsx` TodoFormDrawer.save
- **问题**：保存时全新构造对象而非 `{...todo, ...表单字段}`，`habitId/ledgerId/completedAt` 被抹掉
- **影响**：正常编辑操作即造成**永久数据丢失**；连带待办达成统计与未来对账溯源断裂
- **修复方向**：以旧记录展开为基底，仅覆盖表单字段

## P1（应该修）

| # | 位置 | 问题 | 修复方向 |
|---|---|---|---|
| P1-1 | effects.ts + cards.tsx 打卡 | 查-写非原子，同日可产生重复 HabitLog；取消只删一条，另一条成幽灵记录（`[habitId+date]` 非唯一索引不拦截） | 确定性 id（`hl-${habitId}-${date}`）幂等 put，或包事务 |
| P1-2 | repository.ts put/softDelete | 盖章、落库、入队三步无事务，落库成功入队失败 = 变更永远不再推送，违背持久性模型 | 两表操作包同一 Dexie 事务 |
| P1-3 | sync/engine.ts catch | push 失败但在线时徽章谎报「已同步」，且不刷新待传数 | 按 pending 实际状态显示 |
| P1-4 | sync/engine.ts | 已发送队列条目永不清理，30s 心跳全表扫描，单调膨胀 | push 成功后删除（或保留 24h） |
| P1-5 | hooks.ts export db | `export { db }` 击穿存储抽象，Dashboard/cards 直接用 Dexie API，违背 2.0 硬性要求 | 删 re-export，封装 `useTodayFocusMinutes()` 等领域 Hook |
| P1-6 | stores/focus.ts 计秒 | setInterval 在后台标签页被浏览器节流（最低 1 次/分钟），切窗口工作时专注时长系统性低估 | tick 按 `Date.now() - startedAt - 暂停累计` 墙钟重算 |

## P2（可改进）

| # | 问题 | 一句话 |
|---|---|---|
| P2-1 | streak.ts 是死代码，连击算法在 Dashboard/cards 内联重复两份 | 统一收敛到 calcStreak |
| P2-2 | seed.ts 客户标签「潛力客户」繁体错字 | 改「潜力客户」 |
| P2-3 | 「今日」指标跨午夜不自动刷新（liveQuery 只监听表变更） | 挂零点定时器失效 |
| P2-4 | useQuery deps 误用 `[focus.status]`，且与 Dashboard 重复实现 | deps 置空 + 上提共享 Hook |
| P2-5 | 速记「转待办」无 convertedTo 守卫，连点多条 | 入口检查 + 按钮禁用 |
| P2-6 | 写操作无 catch，配额超限成 unhandled rejection | repository 层统一 toast（Toast 组件待实装） |
| P2-7 | types.ts 的 `synced` 字段语义悬空（引擎从不读写） | 删除或真正维护 |
| P2-8 | 同步游标仅存内存，重启从 0 全量拉 | Phase 7 前落盘 meta |
| P2-9 | useCollection 全表 toArray 内存过滤，流水数据量大后有隐患 | Phase 2 按需改索引过滤 |

## 核查通过项

repository 软删除一致性、Dexie 复合索引设计、seed 事务完整性、TodoFormDrawer 渲染期重置模式（React 官方认可模式）、datetime-local 本地时区处理、streak 算法本身边界、强转集中收口在抽象层、事件总线类型安全、计时器六条路径无 interval 泄漏。

## 总体评价

架构符合度整体较高：可插拔收口、统计推导、瞬态不同步、三态徽章等关键决策均按计划落地。两处 P0 暴露「验收只测了手动路径」的盲区。同步骨架目前是诚实 stub，但 P1-3/P1-4 若不修，Phase 7 接真实网络后会直接变成线上问题（假绿徽章 + 内存膨胀）。**Phase 2 起的三条纪律：写路径默认包事务、编辑表单一律以旧记录展开为基底、组件层严禁直碰 Dexie。**
