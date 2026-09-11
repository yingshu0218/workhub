/**
 * 待办标签（Issue #148）：`#` + 回车创建的自由文本小标签。
 *
 * 语义与 `notes.tags` / `customers.tags` 同款（`string[]`，去重、去首 `#`），
 * 但**做成了能落在 `todos` 表上的独立字段** `Todo.tags`：
 * 之前待办根本没有标签字段，本 Issue 的「输入 # 加回车创建标签」需要一个稳定落点。
 *
 * 与弱引用（`customerId` / `projectId` / `listId`）的边界：
 * 标签只是文本，不是实体引用 —— 删除实体不级联改标签，标签也不参与同步的实体校验。
 * 远端 `todos.tags` 是 json 字段（`pb_setup/collections.json`），写入即随记录同步。
 *
 * 归一化纪律（单一来源）：
 * - 去掉前导 `#` 与首尾空白；
 * - 丢弃空串；
 * - 去重，但**保留输入顺序**（首个出现的顺序即展示顺序）；
 * - 上限 `TODO_TAG_MAX_COUNT`，超出部分由表单提示、不静默丢弃。
 */

/** 单枚标签最大长度（照笔记/客户标签体量：够长到能写「Q3 续约」这类短语） */
export const TODO_TAG_MAX_LENGTH = 24

/** 单条待办标签数上限（防误粘贴长列表撑爆 Chip 行） */
export const TODO_TAG_MAX_COUNT = 12

/** 原始输入 → 归一化标签（去 `#`、trim、去空、去重、保序） */
export function normalizeTodoTag(raw: string): string {
  return (raw ?? '').trim().replace(/^#+/, '').trim()
}

/** 批量归一化（去空 + 去重保序 + 截断单枚长度） */
export function normalizeTodoTags(raw: readonly string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const item of raw ?? []) {
    const tag = normalizeTodoTag(item).slice(0, TODO_TAG_MAX_LENGTH)
    if (!tag || seen.has(tag)) continue
    seen.add(tag)
    out.push(tag)
  }
  return out
}

/**
 * 追加若干标签。
 *
 * 返回 `{ tags, overflow }` —— `overflow` 为因超上限而未加入的条数，
 * 调用方据此提示用户（「已达上限 12 个」），而不是静默吞掉。
 */
export function appendTodoTags(
  current: readonly string[],
  incoming: readonly string[],
  maxCount: number = TODO_TAG_MAX_COUNT,
): { tags: string[]; overflow: number } {
  const out = normalizeTodoTags(current)
  let overflow = 0
  for (const item of normalizeTodoTags(incoming)) {
    if (out.includes(item)) continue
    if (out.length >= maxCount) {
      overflow += 1
      continue
    }
    out.push(item)
  }
  return { tags: out, overflow }
}

/** 移除一枚标签（按归一化后的值比对） */
export function removeTodoTag(current: readonly string[], tag: string): string[] {
  const target = normalizeTodoTag(tag)
  return normalizeTodoTags(current).filter((t) => t !== target)
}

/**
 * 从正文（textarea）尾部的 `#xxx` 里提取标签并返回剥掉该段的正文。
 *
 * 用于「保存时结算」：用户可能没按回车，直接点「创建待办」，
 * 此时正文末行形如 `… #客户跟进 #Q3` 的尾巴应被收成标签，而不是留在备注里。
 * 只在**末尾连续**的 `#词` 段上生效，正文中间的 `#`（如「项目 #3 阶段」）不动。
 */
export function settleTagsFromText(text: string): { text: string; tags: string[] } {
  const body = text ?? ''
  const matched = /(?:^|\s)(#[^\s#]+)(\s+#[^\s#]+)*\s*$/.exec(body)
  if (!matched) return { text: body, tags: [] }
  const segment = matched[0]
  const tags = normalizeTodoTags(segment.split(/\s+/))
  if (tags.length === 0) return { text: body, tags: [] }
  const cut = body.slice(0, body.length - segment.length).replace(/\s+$/, '')
  return { text: cut, tags }
}
