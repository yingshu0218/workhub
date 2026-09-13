/**
 * 标签归一化的**单一实现**（客户标签 / 分组规则标签 / 分组匹配 三方共用）。
 *
 * 归一化口径：trim → 去首 `#` → **折叠为小写** → 去空 → 去重。
 *
 * 为什么要折叠大小写（功能测试 #32）：
 * 同一枚标签的不同写法（`VIP` / `vip` / `#VIP` / 带空格）此前会被当成不同标签 ——
 * 配组时匹配不上，标签栏里还会并存两个看起来一样的芯片。折叠后「视为同一标签」。
 * 中文标签不受影响（`toLowerCase()` 对汉字是恒等操作）。
 *
 * ⚠️ 只用于「标签」语义。`ChipTagInput` 的 `parseTagInput` 是**控件级**通用实现
 * （客户关系语义「客户名 · 语义」也走它），那里**不能**折叠大小写，否则会改写客户名。
 * 三者关系：本文件 = 标签语义的唯一真相；控件层只管拆分与去 `#`；业务层保存前用本文件收口。
 */

/** 标签比较键：判断两枚标签是否同一枚时一律走它 */
export function tagKey(t: string): string {
  return t.trim().replace(/^#/, '').toLowerCase()
}

/** 输入串 → 规范标签数组（配组表单的 include / exclude 输入用） */
export function normalizeTags(raw: string): string[] {
  return [
    ...new Set(
      raw
        .split(/[,，]/)
        .map((t) => tagKey(t))
        .filter(Boolean),
    ),
  ]
}

/**
 * 已有标签数组 → 规范且去重的数组（客户表单保存前结算用）。
 * 与 `normalizeTags` 的区别只是入口形态（数组 vs 输入串），口径完全一致。
 */
export function canonicalTags(list: readonly string[]): string[] {
  return [...new Set(list.map((t) => tagKey(t)).filter(Boolean))]
}
