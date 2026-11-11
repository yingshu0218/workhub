import { createPocketBaseAdapter, type PocketBaseAdapterOptions } from '@/storage/pocketbase'
import { setStorageAdapter } from '@/storage'
import { restoreTrashRecord, listTrash, purgeTrashRecord } from '@/repositories/trash'
import { interactionProjectionRepo } from '@/repositories/activities'

/** 只在合成集成测试中使用真实仓储，避免用探针重写恢复或旧入口逻辑。 */
export function repositoryHarness(options: PocketBaseAdapterOptions) {
  setStorageAdapter(createPocketBaseAdapter(options))
  return { restoreTrashRecord, listTrash, purgeTrashRecord, interactionRepo: interactionProjectionRepo }
}
