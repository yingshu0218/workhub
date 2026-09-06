/**
 * 云端适配器接口 —— Phase 7 由自托管 PocketBase 实装
 * Phase 0 仅保留协议骨架：push（按队列推）/ pull（按游标拉），LWW 合并在引擎侧
 */
export interface SyncAdapter {
  push(items: { table: string; recordId: string; op: 'upsert' | 'delete' }[]): Promise<
    { recordId: string; ok: boolean }[]
  >
  pull(cursor: number): Promise<{ cursor: number; changes: unknown[] }>
}

/** 占位适配器：本地直通成功（种子/开发期不产生真实网络行为） */
export const stubAdapter: SyncAdapter = {
  async push(items) {
    return items.map((it) => ({ recordId: it.recordId, ok: true }))
  },
  async pull(cursor) {
    return { cursor, changes: [] }
  },
}
