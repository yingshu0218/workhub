/**
 * 待办标题 / 正文的口径唯一来源（Issue #148 后续 · 写入口径收口）
 *
 * 背景：Issue #148 把「新建待办」表单的独立标题输入去掉，改成**正文首行即标题**。
 * 但 `todos.title` / `todos.desc` 是全仓 4 条写入口共写的字段：
 *
 * | 入口 | 位置 |
 * |---|---|
 * | 待办表单 | `modules/todo/TodoPage.tsx` |
 * | 速记转待办 | `modules/notes/quickCapture.ts` |
 * | Agent 建待办 | `agent/executor.ts` `todo_createTodo` |
 * | Agent 改待办 | `agent/executor.ts` `todo_updateTodo` |
 *
 * 收口前只有前两条对齐了「首行 = 标题」，Agent 两条仍各自独立写 title/desc：
 * Agent 建的 `{title:'季度复盘会', desc:'准备 Q3 数据'}` 一旦在 UI 里被打开并保存，
 * `desc` 就会被编辑回填（`joinTodoText`）改写成 `季度复盘会\n准备 Q3 数据` —— 静默归一化，
 * 连带 ⌘K 搜索副标题（`shared/search.ts`）与工作台今日日程行（`dashboard/cards.tsx`）多出一行标题。
 *
 * 本模块把「正文 ↔ 标题」的全部换算收口为：
 * - `deriveTodoTitle(body)` —— 正文 → 标题（首行 trim / 截断 60 / 空文本回退「未命名待办」）；
 * - `toTodoText({title, desc})` —— 落库态 → 单一正文（历史数据补标题行，幂等）；
 * - `splitTodoText(content)` —— 单一正文 → 落库态 `{ title, desc }`（**唯一落库口径**）；
 * - `needsTodoTextNormalize(todo)` —— 历史数据是否与新口径不一致（用于迁移动作计数）。
 *
 * 口径来源：正文取标题的规则与速记转待办 `quickCaptureTodoTitle` 完全一致
 * （单行 trim 后截断 60 字、空文本回退）。**P2 方向反转**：实现本体收口到本模块
 * （agentOps 服务端化——`agent/serverReads.ts` 经本模块取标题口径，服务端 bundle
 * 不能拖 quickCapture → repositories → Dexie 的依赖链），quickCapture.ts 转为 re-export，
 * 旧 import 路径不破坏。
 */
import type { Todo } from '@/db/types'

/** 正文首行 → 待办标题（唯一实现；空正文回退「未命名待办」；截断 60 字） */
export function quickCaptureTodoTitle(content: string): string {
  const firstLine = content.split('\n')[0]?.trim() ?? ''
  return (firstLine || '未命名待办').slice(0, 60)
}

/** 正文首行 → 待办标题（与速记转待办同一口径；空正文回退「未命名待办」） */
export function deriveTodoTitle(body: string): string {
  return quickCaptureTodoTitle(body)
}

/**
 * 落库态 `{title, desc}` → 单一正文（编辑回填用）。
 *
 * 历史数据里 `title` 可能未出现在 `desc` 首行（Issue #148 之前标题是独立输入），
 * 此时补上标题行以免丢标题；若 `desc` 首行已等于 `title`（新口径数据、速记转入的数据），
 * 原样返回，不重复写入 —— 因此对已归一化的数据是**幂等**的。
 */
export function toTodoText(todo: Pick<Todo, 'title' | 'desc'> | null | undefined): string {
  if (!todo) return ''
  const desc = (todo.desc ?? '').trim()
  const title = (todo.title ?? '').trim()
  if (!desc) return title
  if (!title || deriveTodoTitle(desc) === title) return desc
  return `${title}\n${desc}`
}

/**
 * 单一正文 → 落库态 `{title, desc}`（**所有写入口共用的唯一拆分实现**）。
 *
 * - 正文先 trim；`title` 恒为 `deriveTodoTitle(正文)`；
 * - `desc` 保存裁剪后的正文全文（长文不丢信息），不再额外复制一份标题行；
 * - 空正文：`title` 回退「未命名待办」、`desc` 为空串（调用方仍应自行做非空校验）。
 */
export function splitTodoText(content: string): { title: string; desc: string } {
  const body = (content ?? '').trim()
  return { title: deriveTodoTitle(body), desc: body }
}

/**
 * 列表行「内容」预览（用户 2026-10-19 口径：待办行第一行标题、第二行内容）。
 *
 * 口径 = **备注里去掉标题那一行后剩下的部分**，压成单行。
 *
 * 为什么不直接渲染 `desc`：现行写入口径下 `desc` 保存的是**正文全文**，首行即等于
 * `title`（见 `splitTodoText`）。直接把 `desc` 铺在标题下面，会把标题原样重复一遍，
 * 第二行看起来只是「标题的二连击」而不是内容。历史数据（Agent 建的 title≠desc 首行）
 * 经 `toTodoText` 补出标题行后再切，同样只留真正的备注。
 *
 * 为什么压成单行：列表行是**固定一行的预览**，多行备注（含速记转入的 `\n\n— 由…转入`）
 * 直接铺开会把行高撑成不定值；换行折成空格、空行丢弃，与 `truncate` 配合才稳定。
 *
 * 注意这是**展示口径，不落库**：`desc` 字段本身一个字节都不改。
 */
export function todoBodyPreview(todo: Pick<Todo, 'title' | 'desc'> | null | undefined): string {
  const desc = (todo?.desc ?? '').trim()
  if (!desc) return ''
  // toTodoText：历史数据补上标题行 ⇒ 首行恒为标题（幂等，不重复补）
  const lines = toTodoText(todo).split('\n')
  // 新口径下 desc 首行就是标题 → 去掉；但若整条正文只有一行（desc === title），
  // 切完为空 ⇒ 列表第二行不渲染，不会出现一行空壳
  const rest = lines.slice(1)
  return rest
    .map((l) => l.trim())
    .filter(Boolean)
    .join(' ')
}

/**
 * 历史数据判定：`{title, desc}` 是否与新口径「首行 = 标题」不一致。
 *
 * 不一致 = 「编辑回填后再保存会改变 `desc`」。用于迁移动作的计数与预览，
 * 也用于说明「打开-保存会归一化」的副作用范围（而不是静默改写）。
 */
export function needsTodoTextNormalize(
  todo: Pick<Todo, 'title' | 'desc'>,
): boolean {
  const desc = (todo.desc ?? '').trim()
  const title = (todo.title ?? '').trim()
  if (!desc) return false // desc 为空：正文即标题，回填不会产生新行
  if (!title) return true // 缺标题：回填后会补出首行
  return deriveTodoTitle(desc) !== title
}
