/** 历史沟通 ID 的永久命名空间；活动被清理后也不能退到另一 ID 重建同一来源。 */
export function legacyActivityId(sourceId: string, hash: (value: string) => string): string {
  return 'act-' + hash('interactions/' + sourceId).slice(0, 32)
}
export function activityDeletionIdentities(id: string, sourceId: string | undefined, hash: (value: string) => string) {
  const sources = [...new Set([id, ...(sourceId ? [sourceId] : [])])]
  return [{ table: 'activities', id }, ...sources.flatMap(source => [{ table: 'interactions', id: source }, { table: 'activities', id: legacyActivityId(source, hash) }])]
}
