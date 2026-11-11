import { db } from '@/db/db'
import { projectInteractions } from '@/domain/activityProjection'

/** 迁移兼容视图的单一读取入口；liveQuery 会追踪活动和关联变更。 */
export async function readInteractionProjection(filter: Parameters<typeof projectInteractions>[3] = {}) {
  const [activities, links, legacy] = await Promise.all([db.activities.toArray(), db.links.toArray(), db.interactions.toArray()])
  return projectInteractions(activities, links, legacy, filter)
}
