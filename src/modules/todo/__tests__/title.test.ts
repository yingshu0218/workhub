/**
 * 待办「正文 ↔ 标题」口径收口回归（Issue #148 后续）
 *
 * 背景：Issue #148 把表单改成「正文首行即标题」，但 `todos.title/desc` 有 4 条写入口。
 * 本测试锁死收口后的两条纪律：
 *   ① 所有写入口共用同一份换算（`splitTodoText` / `toTodoText` / `deriveTodoTitle`）；
 *   ② Agent 建的待办（title≠desc 首行的历史形态）经 UI 往返后 **desc 不再被改写**。
 */
import { describe, it, expect } from 'vitest'
import {
  deriveTodoTitle,
  toTodoText,
  splitTodoText,
  needsTodoTextNormalize,
} from '../title'
import { quickCaptureTodoTitle } from '@/modules/notes/quickCapture'

describe('① 标题推导：口径与速记转待办同源', () => {
  it('首行 trim 后作标题', () => {
    expect(deriveTodoTitle('跟进深蓝续约\n本周五前给出报价')).toBe('跟进深蓝续约')
    expect(deriveTodoTitle('   写周报  \n细节')).toBe('写周报')
  })

  it('超长首行截断 60 字；空正文回退「未命名待办」', () => {
    expect(deriveTodoTitle('甲'.repeat(100))).toHaveLength(60)
    expect(deriveTodoTitle('   ')).toBe('未命名待办')
  })

  it('与 quickCaptureTodoTitle 逐例一致（单一实现，不是复制品）', () => {
    for (const body of ['甲方跟进\n细节', '', '   ', 'x'.repeat(120), '单行']) {
      expect(deriveTodoTitle(body)).toBe(quickCaptureTodoTitle(body))
    }
  })
})

describe('② splitTodoText：正文 → 落库态（唯一拆分口径）', () => {
  it('标题 = 首行（60 字），desc = 裁剪后的正文全文', () => {
    expect(splitTodoText('  跟进深蓝续约\n本周五前给出报价  ')).toEqual({
      title: '跟进深蓝续约',
      desc: '跟进深蓝续约\n本周五前给出报价',
    })
  })

  it('单行正文：title 与 desc 相同（不再只写来源说明）', () => {
    expect(splitTodoText('买咖啡')).toEqual({ title: '买咖啡', desc: '买咖啡' })
  })

  it('空正文：title 回退占位、desc 空串（非空校验由调用方负责）', () => {
    expect(splitTodoText('   ')).toEqual({ title: '未命名待办', desc: '' })
  })
})

describe('③ toTodoText 与 splitTodoText 往返幂等', () => {
  it('已归一化数据往返不变', () => {
    const stored = splitTodoText('跟进深蓝续约\n本周五前给出报价')
    expect(toTodoText(stored)).toBe('跟进深蓝续约\n本周五前给出报价')
    expect(splitTodoText(toTodoText(stored))).toEqual(stored)
  })

  it('Agent 建的 title≠首行数据：补上标题行后即稳定（第二次不再变）', () => {
    const legacy = { title: '季度复盘会', desc: '准备 Q3 数据' }
    const once = toTodoText(legacy)
    expect(once).toBe('季度复盘会\n准备 Q3 数据')
    const stored = splitTodoText(once)
    expect(stored).toEqual({ title: '季度复盘会', desc: '季度复盘会\n准备 Q3 数据' })
    // 第二次打开：首行已等于 title，不再补行（幂等）
    expect(toTodoText(stored)).toBe(once)
    expect(splitTodoText(toTodoText(stored))).toEqual(stored)
  })
})

describe('④ needsTodoTextNormalize：能识别「打开保存会改 desc」的历史数据', () => {
  it('title 未出现在 desc 首行 → 需要归一化（这就是被静默改写的范围）', () => {
    expect(needsTodoTextNormalize({ title: '季度复盘会', desc: '准备 Q3 数据' })).toBe(true)
  })

  it('title = desc 首行（新口径数据）→ 不需要归一化', () => {
    expect(
      needsTodoTextNormalize({ title: '季度复盘会', desc: '季度复盘会\n准备 Q3 数据' }),
    ).toBe(false)
  })

  it('desc 为空 / 缺 title 的边界：空 desc 不改写，缺 title 会补出首行', () => {
    expect(needsTodoTextNormalize({ title: '只有标题', desc: '' })).toBe(false)
    expect(needsTodoTextNormalize({ title: '', desc: '正文' })).toBe(true)
  })
})
