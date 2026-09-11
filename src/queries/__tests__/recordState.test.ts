/**
 * 单条记录查询的「未回填」与「查无此记录」区分口径（Issue #162）
 *
 * 背景：待办详情抽屉用 `useRecord` 时，`useLiveQuery` 首帧恒返回 `undefined`，
 * 与「记录不存在」无法区分 → 打开瞬间闪一帧「待办不存在或已删除」空态。
 * `resolveRecordDisplay` 显式给出三态，让调用方能区分「加载中」与「确实没有」。
 */
import { describe, it, expect } from 'vitest'
import { resolveRecordDisplay } from '../hooks'

describe('resolveRecordDisplay：详情视图的加载态判据', () => {
  it('目标 id 为空 → 视图未打开，不算「查无」', () => {
    expect(resolveRecordDisplay(undefined, true)).toBe('empty')
  })

  it('目标 id 存在但查询未回填 → 加载中，不得渲染「不存在」空态', () => {
    expect(resolveRecordDisplay('td1', false)).toBe('loading')
  })

  it('未回填时即便记录真的不存在，也先判加载中（先不误导）', () => {
    expect(resolveRecordDisplay('td-missing', false)).toBe('loading')
  })

  it('查询已回填 → 可渲染（有记录则渲染内容，无记录则由 record=undefined 走空态）', () => {
    expect(resolveRecordDisplay('td1', true)).toBe('ready')
  })
})
