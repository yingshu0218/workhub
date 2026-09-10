import { z } from 'zod'

/**
 * 最小 zod → JSON Schema 转换 —— 方案 §五 / §10.1（工具描述与实现单源生成）
 *
 * 目的：MCP `tools/list` 的 `inputSchema` 必须与 agentOps 的 zod 校验**同源一份定义**，
 * 杜绝「skill 文档 / MCP schema / 实现」三份漂移（§五：两者由同一 zod schema 生成）。
 *
 * 范围：只覆盖本仓 agentOps schema 实际用到的构造（object/string/number/boolean/enum/array/
 * optional/default/literal/union of literals）。未识别构造保守降级为 `{}`（不阻断，不臆造约束）。
 */

type JsonSchema = Record<string, unknown>

/** zod 类型名（v3：`def.typeName`；v4：`def.type`） */
function typeName(schema: z.ZodTypeAny): string {
  const def = (schema as unknown as { _def?: Record<string, unknown> })._def ?? {}
  const t = (def.typeName ?? def.type) as string | undefined
  return t ?? 'ZodUnknown'
}

/** 取 zod 描述信息（`description` / warnings） */
function descriptionOf(schema: z.ZodTypeAny): string | undefined {
  const d = schema.description
  return d || undefined
}

/** 单一枚举值 → JSON Schema type */
function literalType(value: unknown): JsonSchema {
  if (typeof value === 'string') return { type: 'string' }
  if (typeof value === 'number') return { type: 'number' }
  if (typeof value === 'boolean') return { type: 'boolean' }
  return {}
}

export function zodToJsonSchema(schema: z.ZodTypeAny): JsonSchema {
  const t = typeName(schema)

  // 包装类：透传内层
  if (t === 'ZodOptional' || t === 'ZodNullable' || t === 'ZodReadonly' || t === 'ZodBranded' || t === 'ZodCatch') {
    const inner = (schema as unknown as { _def: { innerType: z.ZodTypeAny } })._def.innerType
    return zodToJsonSchema(inner)
  }
  if (t === 'ZodDefault') {
    const def = (schema as unknown as { _def: { innerType: z.ZodTypeAny; defaultValue: () => unknown } })._def
    const inner = zodToJsonSchema(def.innerType)
    try {
      const dv = def.defaultValue()
      if (dv !== undefined) return { ...inner, default: dv }
    } catch {
      /* 默认值不可序列化时忽略 */
    }
    return inner
  }
  if (t === 'ZodEffects') {
    // refine/transform：透传底层 schema，并把消息作为 description 兜底
    const def = (schema as unknown as { _def: { schema: z.ZodTypeAny } })._def
    const inner = zodToJsonSchema(def.schema)
    const d = descriptionOf(schema)
    return d ? { ...inner, description: d } : inner
  }

  if (t === 'ZodObject') {
    const shape = (schema as z.ZodObject<z.ZodRawShape>).shape
    const properties: JsonSchema = {}
    const required: string[] = []
    for (const [key, val] of Object.entries(shape)) {
      const child = zodToJsonSchema(val as z.ZodTypeAny)
      properties[key] = child
      // 非 optional / 非 default 即必填（对齐 zod 语义）
      const ct = typeName(val as z.ZodTypeAny)
      if (ct !== 'ZodOptional' && ct !== 'ZodDefault') required.push(key)
    }
    const out: JsonSchema = { type: 'object', properties }
    if (required.length) out.required = required
    const d = descriptionOf(schema)
    if (d) out.description = d
    return out
  }

  if (t === 'ZodArray') {
    const def = (schema as unknown as { _def: { type: z.ZodTypeAny } })._def
    return { type: 'array', items: zodToJsonSchema(def.type) }
  }

  if (t === 'ZodEnum') {
    const def = (schema as unknown as { _def: { values: string[] } })._def
    const out: JsonSchema = { type: 'string', enum: [...def.values] }
    const d = descriptionOf(schema)
    if (d) out.description = d
    return out
  }

  if (t === 'ZodNativeEnum') {
    const def = (schema as unknown as { _def: { values: Record<string, string | number> } })._def
    const values = Object.values(def.values).filter((v) => typeof v === 'string' || typeof v === 'number')
    const allString = values.every((v) => typeof v === 'string')
    return { type: allString ? 'string' : 'number', enum: values }
  }

  if (t === 'ZodLiteral') {
    const def = (schema as unknown as { _def: { value: unknown } })._def
    return { ...literalType(def.value), enum: [def.value] }
  }

  if (t === 'ZodUnion') {
    const def = (schema as unknown as { _def: { options: z.ZodTypeAny[] } })._def
    const options = def.options.map((o) => zodToJsonSchema(o))
    const allLiterals = def.options.every((o) => typeName(o) === 'ZodLiteral')
    if (allLiterals) {
      const values = def.options.map((o) => (o as unknown as { _def: { value: unknown } })._def.value)
      const allString = values.every((v) => typeof v === 'string')
      return { type: allString ? 'string' : 'number', enum: values }
    }
    return { anyOf: options }
  }

  if (t === 'ZodString') {
    const out: JsonSchema = { type: 'string' }
    const d = descriptionOf(schema)
    if (d) out.description = d
    return out
  }
  if (t === 'ZodNumber' || t === 'ZodBigInt') {
    const out: JsonSchema = { type: 'number' }
    const d = descriptionOf(schema)
    if (d) out.description = d
    return out
  }
  if (t === 'ZodBoolean') return { type: 'boolean' }
  if (t === 'ZodDate') return { type: 'string', format: 'date' }

  // 未识别：保守降级为空 schema（不阻断 MCP 校验，但不臆造约束）
  return {}
}
