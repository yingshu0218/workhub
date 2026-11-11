import type { SyncMeta } from '@/db/types'

/**
 * 存储适配层 —— agentOps 服务端化的前置抽象（方案 docs/agentOps服务端化方案.md §5.1）
 *
 * 为什么需要它：executor / domain / repositories 复合函数此前十几处直用 Dexie（`db.*`），
 * 「存储无关」只是 Repository<T> 接口形状上的——执行链实际绑死 IndexedDB。
 * 本层把「事务 + 盖章 + 入队」抽象为原语，浏览器端 = DexieAdapter（零行为变化），
 * 服务端 = PocketBaseAdapter（P2/P3 落地，直写 PB 中心）。
 *
 * 边界（与既有纪律对齐）：
 * - 本层**不盖章、不入队、不发事件**——这些语义留在调用方（repositories 复合函数），
 *   与「事件永在事务之后」「盖章统一在 repository.put」的既有口径一致；
 * - `get/list` 返回**含软删**的原始行：与 Dexie 原语义一致，过滤 deleted 是调用方的职责
 *   （useCollection / repository.get / reads.alive 各自沿用既有过滤），不在层内偷改语义；
 * - UI 组件仍走 useCollection/useQuery，不经本层（本层服务于执行链，不是新的全局 DAL）。
 */

/** 表名：宽口径字符串（服务端集合名与客户端表名存在驼峰/下划线差异，见 pb_hooks 注释） */
export type TableName = string

/** 同步队列操作（与 syncQueue 表记录形状同源） */
export type SyncOp = 'upsert' | 'delete'

/**
 * 事务内原语。浏览器端 = Dexie 原生事务体内操作；服务端 = 暂存计划并在 PocketBase runInTransaction 内校验、提交。
 */
export interface StorageTx {
  query?<T extends { id: string }>(table: TableName, scope: import('@/commands/scope').Scope): Promise<(T & SyncMeta)[]>
  /** 读单条（含软删行，调用方按 `deleted` 判活） */
  get<T extends { id: string }>(table: TableName, id: string): Promise<(T & SyncMeta) | undefined>
  /** 原样落库：不盖章不入队，语义与 Dexie put 一致（整体覆盖） */
  put<T extends { id: string }>(table: TableName, record: T): Promise<void>
  /** 部分字段更新（Dexie update 语义：patch 里显式 undefined 会删键） */
  update(table: TableName, id: string, patch: Record<string, unknown>): Promise<void>
  /**
   * 物理删除一行（**不是软删**：不盖 deleted、不入队、不发事件）。
   *
   * 只服务于「墓碑已经收敛（delete 已送达服务端）之后」的清理场景 —— 回收站永久删除
   * 与 30 天墓碑清理。**跨设备收敛由调用方负责**：对端若还持有活副本，把这条删掉
   * 而服务端没有对应墓碑，它下次推送会以「查不到 → POST 新建」把记录复活并覆盖本端。
   * 因此调用方必须先确认服务端已有该墓碑（`sync/pocketbaseAdapter.pushTombstonesNow`）。
   */
  delete(table: TableName, id: string): Promise<void>
  /** 同步队列入队（浏览器端写 syncQueue 表；服务端直写中心，实现为 no-op） */
  enqueue(table: TableName, recordId: string, op: SyncOp, createdAt: number): Promise<void>
  /** 事务内全表读取（含软删）。替代 Dexie `where().equals()` 索引查询：全量过滤结果等价 */
  list<T extends { id: string }>(table: TableName): Promise<(T & SyncMeta)[]>
}

export interface StorageAdapter {
  query?<T extends { id: string }>(table: TableName, scope: import('@/commands/scope').Scope): Promise<(T & SyncMeta)[]>
  /** 已关闭逐表写入，只通过 PB 命令事务提交。 */
  commandMode?: true
  /**
   * 原子事务。调用方传的 tables **必须含 `syncQueue`**（浏览器端 Dexie 事务要显式列出全部触碰表；
   * 服务端忽略该参数）。事务体内任一步抛错 → 整体回滚（浏览器端 Dexie 原生保证）。
   */
  transaction<T>(tables: TableName[], fn: (tx: StorageTx) => Promise<T>): Promise<T>
  /** 事务外读单条（含软删行） */
  get<T extends { id: string }>(table: TableName, id: string): Promise<(T & SyncMeta) | undefined>
  /** 事务外读全表（含软删行） */
  list<T extends { id: string }>(table: TableName): Promise<(T & SyncMeta)[]>
  /** 写入后请求一次同步（浏览器端 = syncEngine.requestSync；服务端 = no-op，已就地在中心） */
  requestSync(): void
  /**
   * 领域事件出口（P4 agent_events，方案 §5.4-A）。
   * 浏览器端**不实现**（事件已在本地 eventBus 分发给奖杯/EXP 评估，无需记录）；
   * 服务端**必须实现**（服务端 eventBus 无消费者，事件经此落 PB `agent_events` 集合，
   * 各客户端 pull 后 replay 到本地 eventBus —— 「事件源多一个、评估逻辑不动」）。
   */
  recordEvent?(event: string, payload: unknown, tool: string, occurredAt?: number): Promise<void>
}
