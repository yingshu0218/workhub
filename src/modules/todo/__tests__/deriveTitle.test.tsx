// @vitest-environment jsdom
/**
 * 「正文首行即标题」口径回归（Issue #148）
 *
 * 背景：新建待办表单取消独立标题输入，改为单一文本域 —— 正文首行作标题、其余作备注。
 * 本测试锁死两条纪律，防止后续有人再把标题拆回独立字段：
 *   ① 标题推导与速记转待办 quickCaptureTodoTitle 同一口径（首行 trim / 截断 60 / 空文本回退）；
 *   ② 编辑回填能把 title + desc 拼回单一正文，且不与历史数据（标题未出现在 desc 首行）打架。
 */
import { describe, it, expect } from 'vitest'
import { render, fireEvent } from '@testing-library/react'
import { deriveTodoTitle, joinTodoText, TodoFormDrawer } from '../TodoPage'
import { quickCaptureTodoTitle } from '@/modules/notes/quickCapture'
import type { Todo } from '@/db/types'

describe('① 正文首行 → 待办标题', () => {
  it('首行作标题，第二行起不入标题', () => {
    expect(deriveTodoTitle('跟进深蓝续约\n本周五前给出报价')).toBe('跟进深蓝续约')
  })

  it('首行前后空白被 trim', () => {
    expect(deriveTodoTitle('   写周报  \n细节')).toBe('写周报')
  })

  it('超长首行截断 60 字，与速记口径一致', () => {
    const long = '甲'.repeat(100)
    expect(deriveTodoTitle(long)).toHaveLength(60)
    expect(deriveTodoTitle(long)).toBe(quickCaptureTodoTitle(long))
  })

  it('空正文回退「未命名待办」（保存前已被空值校验挡住，此处只锁口径）', () => {
    expect(deriveTodoTitle('')).toBe('未命名待办')
  })

  it('与速记转待办同名同规则：同一段文本两条入口得出同一标题', () => {
    const body = '给客户回电话\n顺便确认合同'
    expect(deriveTodoTitle(body)).toBe(quickCaptureTodoTitle(body))
  })
})

describe('② 编辑回填：title + desc → 单一正文', () => {
  it('标题已在 desc 首行时，不重复写入标题行', () => {
    expect(joinTodoText({ title: '跟进深蓝续约', desc: '跟进深蓝续约\n本周五前给出报价' })).toBe(
      '跟进深蓝续约\n本周五前给出报价',
    )
  })

  it('历史数据标题未出现在 desc 首行时，补上标题行避免丢失', () => {
    expect(joinTodoText({ title: '跟进深蓝续约', desc: '本周五前给出报价' })).toBe(
      '跟进深蓝续约\n本周五前给出报价',
    )
  })

  it('无备注时只回填标题', () => {
    expect(joinTodoText({ title: '跟进深蓝续约', desc: '' })).toBe('跟进深蓝续约')
  })

  it('desc 首行被截断成标题（超 60 字）时不重复补标题行', () => {
    const desc = `${'甲'.repeat(100)}\n备注`
    expect(joinTodoText({ title: '甲'.repeat(60), desc })).toBe(desc)
  })

  it('新建场景（todo 为 null）回填空正文', () => {
    expect(joinTodoText(null)).toBe('')
  })
})

describe('③ 表单布局：左侧正文独占 / 右侧「事项设置」收纳全部非正文字段', () => {
  it('新建态渲染出「待办内容」文本域，且不再有「标题」字段', () => {
    const { container } = render(<TodoFormDrawer open={true} todo={null} onClose={() => {}} />)
    expect(container.textContent).toContain('待办内容 *')
    expect(container.textContent).not.toContain('标题 *')
  })

  it('存在右栏「事项设置」，且六项设置全在其中', () => {
    const { container } = render(<TodoFormDrawer open={true} todo={null} onClose={() => {}} />)
    const aside = container.querySelector('[aria-label="事项设置"]')
    expect(aside).toBeTruthy()
    const text = aside!.textContent ?? ''
    for (const label of ['优先级', '状态', '截止时间', '所属清单', '所属项目', '关联客户']) {
      expect(text).toContain(label)
    }
  })

  it('正文文本域不在右栏内（左栏独占，面积留给输入）', () => {
    const { container } = render(<TodoFormDrawer open={true} todo={null} onClose={() => {}} />)
    const aside = container.querySelector('[aria-label="事项设置"]')
    expect(aside!.querySelector('textarea')).toBeNull()
    expect(container.querySelector('textarea')).toBeTruthy()
  })

  it('左右分区容器存在：桌面两栏、窄屏堆叠（flex-col sm:flex-row）', () => {
    const { container } = render(<TodoFormDrawer open={true} todo={null} onClose={() => {}} />)
    const split = container.querySelector('.sm\\:flex-row')
    expect(split).toBeTruthy()
    expect(split!.className).toContain('flex-col')
    // 旧的「底部窄字段双栏栅格」已随布局调整移除
    expect(container.querySelector('.grid-cols-2')).toBeNull()
  })
})

describe('④ 优先级四档（Issue #148 后续）：高/中/低/无 + 象限示意', () => {
  it('优先级是可输入下拉，展开候选为四档且各带象限示意', () => {
    const { container } = render(<TodoFormDrawer open={true} todo={null} onClose={() => {}} />)
    const priorityField = Array.from(container.querySelectorAll('label')).find((l) =>
      (l.textContent ?? '').startsWith('优先级'),
    )!
    // 形态是下拉（已选回显条 / 未选时为可输入文本框），不再是四连按钮组
    expect(priorityField.querySelectorAll('button').length).toBeGreaterThan(0)
    fireEvent.click(priorityField.querySelector('button')!)
    const text = document.body.textContent ?? ''
    for (const label of ['高', '中', '低', '无']) expect(text).toContain(label)
    for (const q of ['重要紧急', '重要不紧急', '不重要紧急', '不重要不紧急']) {
      expect(text).toContain(q)
    }
  })

  it('状态同样是可输入下拉（待处理/已完成/已作废）', () => {
    const { container } = render(<TodoFormDrawer open={true} todo={null} onClose={() => {}} />)
    const statusField = Array.from(container.querySelectorAll('label')).find((l) =>
      (l.textContent ?? '').startsWith('状态'),
    )!
    expect(statusField.querySelectorAll('button').length).toBeGreaterThan(0)
    fireEvent.click(statusField.querySelector('button')!)
    const text = document.body.textContent ?? ''
    for (const label of ['待处理', '已完成', '已作废']) expect(text).toContain(label)
  })

  it('不再出现 P1/P2/P3 字样（旧档位不进 UI）', () => {
    const { container } = render(<TodoFormDrawer open={true} todo={null} onClose={() => {}} />)
    const text = container.textContent ?? ''
    expect(text).not.toContain('P1')
    expect(text).not.toContain('P2')
    expect(text).not.toContain('P3')
  })

  it('存量 P1 数据回填为「高」档，编辑保存即完成归一化', () => {
    const legacy = {
      id: 'td-legacy',
      title: '老数据',
      desc: '',
      priority: 'P1',
      status: 'todo' as const,
      createdAt: Date.now(),
      updatedAt: 0,
      deleted: 0 as const,
      rev: 0,
    } as unknown as Todo
    const { container } = render(<TodoFormDrawer open={true} todo={legacy} onClose={() => {}} />)
    // 可输入下拉的已选回显条显示「高」，且下方提示是「高」档的行动指引
    const priorityField = Array.from(container.querySelectorAll('label')).find((l) =>
      (l.textContent ?? '').startsWith('优先级'),
    )
    expect(priorityField?.textContent).toContain('高')
    expect(container.textContent).toContain('立刻做：救火与关键节点，别排期')
  })
})
