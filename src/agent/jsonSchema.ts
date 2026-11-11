import { z } from 'zod'

/**
 * 最小 zod → JSON Schema 转换 —— 方案 §五 / §10.1（工具描述与实现单源生成）
 *
 * 目的：MCP `tools/list` 的 `inputSchema` 必须与 agentOps 的 zod 校验**同源一份定义**，
 * 杜绝「skill 文档 / MCP schema / 实现」三份漂移（§五：两者由同一 zod schema 生成）。
 *
 * 范围：只覆盖本仓 agentOps schema 实际用到的构造（object/string/number/boolean/enum/array/
 * optional/default/literal/union of literals/transform）。未识别构造保守降级为 `{}`（不阻断，不臆造约束）。
 *
 * ## zod 4 适配（2026-10-26，随依赖从 3.x 升到 4.6.7）
 *
 * 原先按 v3 的 `_def.typeName`（`'ZodObject'` 这类驼峰串）分派；v4 把标识改成了
 * **小写构造名** `_def.type`（`'object'` / `'optional'` / `'pipe'` …）。旧的兜底
 * `def.typeName ?? def.type` 看着「兼容」，实际返回小写名后**所有分支都不再命中**，
 * 于是每个工具都退化成 `{}` —— 全绿变三红（bridge / skill.parity / functional.sweep）。
 *
 * ⚠️ 教训：**`?? 兜底`不等于兼容**。取值域变了，兜底只是把「找不到」换成了「拿到另一种形状」，
 * 而下游按旧形状比较，必然静默全错。真兼容要按新形状重写分派，并让测试覆盖到每个分支。
 *
 * 结构差异（v4）：object→`shape`（普通对象，不再是函数）· array→`element` · enum→`entries`（字典）·
 * literal→`values`（数组，v4 支持多值）· transform→`pipe` + `in`/`out` · optional/nullable/default/
 * catch→`innerType` · `.refine()` **不再产生包装类型**（checks 挂在原类型上，类型名不变）。
 */

type JsonSchema = Record<string, unknown>

/** 取 zod 内部 def（v4：构造名在 `_def.type`，小写） */
function defOf(schema: z.ZodTypeAny): Record<string, unknown> {
  return (schema as unknown as { _def?: Record<string, unknown> })._def ?? {}
}

function typeOf(schema: z.ZodTypeAny): string {
  return String(defOf(schema).type ?? 'unknown')
}

/** 取 zod 描述信息（`description`） */
function descriptionOf(schema: z.ZodTypeAny): string | undefined {
  const d = schema.description
  return d || undefined
}

/**
 * 字段是否「可不传」—— 必须**剥掉包装**后再判。
 *
 * 起因（P2-1）：`listTodos.priority` 的 zod 定义是 `.optional().transform(...)`，
 * 最外层当时是 `ZodEffects`；而必填判定原先只看最外层类型名
 * （`ct !== 'ZodOptional' && ct !== 'ZodDefault'`），于是它被误标成 required。
 * 后果不是「多传一个无害参数」：`priority` 是**过滤器**，Agent 依 schema 强行传值会
 * 静默过滤掉本应返回的待办。全量 125 个字段里仅此 1 处，但语义后果严重。
 *
 * 注意 `nullable` 也要剥（`z.string().nullable().optional()` 剥出 optional 才算可选），
 * 但**剥完仍不是 optional/default 就是必填** —— `z.string().nullable()` 本身必填，不能误伤。
 */
function isOptionalField(schema: z.ZodTypeAny): boolean {
  const def = defOf(schema)
  const t = String(def.type ?? 'unknown')
  if (t === 'optional' || t === 'default') return true
  if (t === 'nullable' || t === 'readonly' || t === 'catch') {
    const inner = def.innerType as z.ZodTypeAny | undefined
    return inner ? isOptionalField(inner) : false
  }
  // transform（`pipe`）：输入侧是否可选由 `in` 决定
  if (t === 'pipe') {
    const inner = def.in as z.ZodTypeAny | undefined
    return inner ? isOptionalField(inner) : false
  }
  return false
}

/** 单一枚举值 → JSON Schema type */
function literalType(value: unknown): JsonSchema {
  if (typeof value === 'string') return { type: 'string' }
  if (typeof value === 'number') return { type: 'number' }
  if (typeof value === 'boolean') return { type: 'boolean' }
  return {}
}

export function zodToJsonSchema(schema: z.ZodTypeAny): JsonSchema {
  const def = defOf(schema)
  const t = String(def.type ?? 'unknown')

  // 包装类：透传内层（v4 的 optional / nullable / readonly / catch 都只挂 innerType）
  if (t === 'optional' || t === 'nullable' || t === 'readonly' || t === 'catch') {
    return zodToJsonSchema(def.innerType as z.ZodTypeAny)
  }
  if (t === 'default') {
    const inner = zodToJsonSchema(def.innerType as z.ZodTypeAny)
    // v4 的 `defaultValue` 是**值**本身（v3 是惰性函数）；仍兼容函数形态以防自定义
    let dv = def.defaultValue
    if (typeof dv === 'function') {
      try {
        dv = (dv as () => unknown)()
      } catch {
        dv = undefined
      }
    }
    return dv !== undefined ? { ...inner, default: dv } : inner
  }
  /** transform：MCP 契约描述的是**入参**，故取输入侧 `in`（`.refine()` 不产生包装，走下面原类型） */
  if (t === 'pipe') return zodToJsonSchema(def.in as z.ZodTypeAny)

  if (t === 'object') {
    const shape = (def.shape ?? {}) as Record<string, z.ZodTypeAny>
    const properties: JsonSchema = {}
    const required: string[] = []
    for (const [key, val] of Object.entries(shape)) {
      properties[key] = zodToJsonSchema(val)
      // 非 optional / 非 default 即必填（对齐 zod 语义）—— 须先剥包装，见 isOptionalField
      if (!isOptionalField(val)) required.push(key)
    }
    const out: JsonSchema = { type: 'object', properties }
    if (required.length) out.required = required
    const d = descriptionOf(schema)
    if (d) out.description = d
    return out
  }

  if (t === 'array') {
    return { type: 'array', items: zodToJsonSchema(def.element as z.ZodTypeAny) }
  }

  if (t === 'enum') {
    const entries = (def.entries ?? {}) as Record<string, string>
    const out: JsonSchema = { type: 'string', enum: Object.values(entries) }
    const d = descriptionOf(schema)
    if (d) out.description = d
    return out
  }

  if (t === 'literal') {
    const values = (def.values ?? []) as unknown[]
    return { ...literalType(values[0]), enum: values }
  }

  if (t === 'union') {
    const options = (def.options ?? []) as z.ZodTypeAny[]
    const allLiterals = options.length > 0 && options.every((o) => typeOf(o) === 'literal')
    if (allLiterals) {
      const values = options.flatMap((o) => (defOf(o).values ?? []) as unknown[])
      const allString = values.every((v) => typeof v === 'string')
      return { type: allString ? 'string' : 'number', enum: values }
    }
    return { anyOf: options.map((o) => zodToJsonSchema(o)) }
  }

  if (t === 'string') {
    const out: JsonSchema = { type: 'string' }
    const d = descriptionOf(schema)
    if (d) out.description = d
    return out
  }
  if (t === 'number' || t === 'bigint') {
    const out: JsonSchema = { type: 'number' }
    const d = descriptionOf(schema)
    if (d) out.description = d
    return out
  }
  if (t === 'boolean') return { type: 'boolean' }
  if (t === 'date') return { type: 'string', format: 'date' }

  // 未识别：保守降级为空 schema（不阻断 MCP 校验，但不臆造约束）
  return {}
}

/** 旧工具保留业务参数，可靠提交的公开上下文由所有发现/文档出口共用。 */
export function toolJsonSchema(name: string, schema: z.ZodTypeAny): JsonSchema {
  const value = zodToJsonSchema(schema)
  if (!/^(fin|crm|todo|project|note|habit|link)_/.test(name)) return value
  return { ...value, properties: { ...(value.properties as object), requestId: { type: 'string', description: '稳定请求标识，首次提交前确定，重试复用。' }, generation: { type: 'string', description: '原数据世代，由查询返回。' }, confirmToken: { type: 'string', description: '按具体预览提示取得的一次性确认票据。' } } }
}
