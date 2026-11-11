import type { ClientSession } from './clientSession'
export interface ReviewGroup {
  server: string
  owner: string
  generation: string
  schema: number
  keys: string[]
}
/** 只发现同一拥有者/站点的旧世代，不让旧库导出混进其他账号。 */
export function oldDraftGroups(context: ClientSession): ReviewGroup[] {
  const groups = new Map<string, ReviewGroup>()
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i)!
    if (!/^workhub\.(draft|pending|action)\./.test(key)) continue
    const separator = key.lastIndexOf(':%5B')
    if (separator < 0) continue
    const scope = key.slice(separator + 1)
    if (scope === context.key) continue
    try {
      const [server, owner, generation, schema] = JSON.parse(decodeURIComponent(scope))
      if (server !== context.server || owner !== context.owner) continue
      if (!groups.has(scope)) groups.set(scope, { server, owner, generation, schema, keys: [] })
      groups.get(scope)!.keys.push(key)
    } catch {
      /* 损坏键保留，不猜归属。 */
    }
  }
  return [...groups.values()]
}
export function reviewDraftCopy(group: ReviewGroup) {
  return {
    kind: 'unsubmitted-review',
    context: {
      server: group.server,
      owner: group.owner,
      generation: group.generation,
      schema: group.schema,
    },
    entries: group.keys.map((key) => ({ key, value: localStorage.getItem(key) })),
    submitted: false,
  }
}
