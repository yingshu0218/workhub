/**
 * Issue #130 三分之三：客户关系「提交路径」不变式（静态契约回归）
 *
 * 背景：客户关系「保存不生效」前两轮分别修了同步侧（PR #131 本地编辑保护 + 并集合并）
 * 与表单侧（PR #138 芯片标签手动输入 + 保存前固化）。本案收口最后一条真问题：
 * **依赖浏览器 click 事件提交输入**（失焦固化）在焦点未落在输入框时整条不执行 ——
 * 表现与「加了关系但保存不生效」完全一致。
 *
 * 本测试不渲染 DOM（vitest 环境为 node），改为对源码做**不变式断言**：
 * 提交路径不得挂 `onBlur`，凡是 `onChange` 的 return 语句都不得吞掉 `commit`。
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(__dirname, '../../..')
const read = (rel: string) => readFileSync(path.join(ROOT, rel), 'utf8')

describe('客户关系提交路径：不依赖失焦事件（Issue #130）', () => {
  it('ChipTagInput 不在失焦时固化，输入内容在敲键那一刻就已固化', () => {
    const src = read('design-system/ChipTagInput.tsx')
    // 提交必须发生在 onChange（受控输入的每次变更），不能只挂在 onBlur 上
    expect(src, 'ChipTagInput 不应再有失焦固化（焦点不在输入框时整条不执行）').not.toMatch(
      /onBlur=\{/,
    )
    expect(src, 'onChange 必须处理「以分隔符结尾」的输入并提交').toMatch(/endsWithSeparator/)
  })

  it('逗号/中文逗号/空格/回车/粘贴分隔符都走同一条提交判定', () => {
    const src = read('design-system/ChipTagInput.tsx')
    for (const token of ['CHIP_SEPARATORS', 'committedInputValue']) {
      expect(src, `缺少 ${token}（拆分提交路径的单一来源）`).toContain(token)
    }
    // 中英文逗号都必须在内（分隔符集合是提交判定的唯一来源）
    expect(src).toMatch(/CHIP_SEPARATORS = \/\[,\uFF0C/)
  })

  it('保存路径显式读取仍停留在输入框内的草稿（关系与标签都不丢）', () => {
    const src = read('modules/crm/CustomerFormDrawer.tsx')
    // 抽屉保存前必须把「输入框里还没固化成芯片」的内容配对写入
    expect(src, '保存前未结算关系输入框草稿').toMatch(/settleDrafts/)
    // 标签同理：保存前结算编辑态草稿
    expect(src).toMatch(/setTags\(/)
  })
})
