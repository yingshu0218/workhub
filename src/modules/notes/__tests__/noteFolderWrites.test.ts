/**
 * Issue #169 审计 P1-B 回归：笔记文件夹写入口漏 `syncEngine.requestSync()`
 *
 * 缺陷形状：`modules/notes/hooks.ts` 共 4 个文件夹写函数，**只有 `moveNoteToFolder` 调了
 * `requestSync`**；`createNoteFolder` / `renameNoteFolder` / `deleteNoteFolderCascade`
 * 只 `syncQueue.add` 后就不管了。
 *
 * 后果：这些变更**不会丢**（队列落库成功、30s 心跳会兜底推送），但在「建完文件夹立刻关标签页」
 * 这类操作下，其他设备要等到下一次心跳才可见 —— 用户感知是「同步延迟 / 不同步」。
 * 对照 `todo/hooks.ts` 5/5 都调了，属本模块的**回归性遗漏**；且这 3 个函数此前**零测试覆盖**。
 *
 * 本文件锁两层：
 *   ① 行为层：四个写函数各自都会调用 requestSync（用 spy 断言调用次数，不依赖计时）
 *   ② 防漂移层：**源码扫描** —— 凡函数体内出现 `db.syncQueue.add` 的模块级导出函数，
 *      其函数体内必须出现 `requestSync()`（或调用 `repositories` 层的仓储，由仓储内部触发）。
 *      这把「入队即触发同步」从约定变成 CI 可拦的锁。
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import 'fake-indexeddb/auto'
import { db } from '@/db/db'
import { syncEngine } from '@/sync/engine'
import {
  createNoteFolder,
  renameNoteFolder,
  deleteNoteFolderCascade,
  moveNoteToFolder,
} from '../hooks'

beforeEach(async () => {
  await Promise.all(db.tables.map((t) => t.clear()))
  vi.restoreAllMocks()
})

describe('笔记文件夹四个写入口都触发同步（P1-B）', () => {
  const noteBase = {
    title: 'n',
    markdown: '',
    tags: [] as string[],
    backlinks: [] as string[],
    mentions: [] as unknown[],
    createdAt: 1,
    updatedAt: 1,
    deleted: 0 as const,
    rev: 1,
  }

  it('createNoteFolder：入队 + 唤醒引擎', async () => {
    const spy = vi.spyOn(syncEngine, 'requestSync').mockImplementation(() => {})
    const folder = await createNoteFolder('工作')
    expect(spy).toHaveBeenCalledTimes(1)
    expect(await db.noteFolders.get(folder.id)).toBeTruthy()
    expect((await db.syncQueue.toArray()).some((q) => q.recordId === folder.id)).toBe(true)
  })

  it('重名时复用既有文件夹且不重复入队（既有语义不回退）', async () => {
    const spy = vi.spyOn(syncEngine, 'requestSync').mockImplementation(() => {})
    const first = await createNoteFolder('工作')
    expect(spy).toHaveBeenCalledTimes(1)
    const again = await createNoteFolder('工作')
    expect(again.id).toBe(first.id)
    // 复用走早退分支，不应再唤醒（没有新写入）
    expect(spy).toHaveBeenCalledTimes(1)
  })

  it('renameNoteFolder：入队 + 唤醒引擎', async () => {
    const folder = await createNoteFolder('工作')
    const spy = vi.spyOn(syncEngine, 'requestSync').mockImplementation(() => {})
    await renameNoteFolder(folder.id, '工作台')
    expect(spy).toHaveBeenCalledTimes(1)
    expect((await db.noteFolders.get(folder.id))!.name).toBe('工作台')
  })

  it('deleteNoteFolderCascade：入队 + 唤醒引擎', async () => {
    const folder = await createNoteFolder('工作')
    await db.notes.put({ id: 'n1', folderId: folder.id, ...noteBase } as never)
    const spy = vi.spyOn(syncEngine, 'requestSync').mockImplementation(() => {})
    await deleteNoteFolderCascade(folder.id)
    expect(spy).toHaveBeenCalledTimes(1)
    expect((await db.noteFolders.get(folder.id))!.deleted).toBe(1)
    // 级联解绑：名下笔记 folderId 清空，不留悬挂外键
    expect((await db.notes.get('n1'))!.folderId).toBeUndefined()
  })

  it('moveNoteToFolder：入队 + 唤醒引擎（原有行为不变）', async () => {
    const folder = await createNoteFolder('工作')
    await db.notes.put({ id: 'n1', ...noteBase } as never)
    const spy = vi.spyOn(syncEngine, 'requestSync').mockImplementation(() => {})
    await moveNoteToFolder('n1', folder.id)
    expect(spy).toHaveBeenCalledTimes(1)
    expect((await db.notes.get('n1'))!.folderId).toBe(folder.id)
  })
})

describe('级联删除的子表读取在事务内（P2-A）', () => {
  const noteBase = {
    title: 'n',
    markdown: '',
    tags: [] as string[],
    backlinks: [] as string[],
    mentions: [] as unknown[],
    createdAt: 1,
    updatedAt: 1,
    deleted: 0 as const,
    rev: 1,
  }

  /** 源码扫描：`where('folderId')` 的读取必须出现在 `db.transaction` 之后（同一函数体内） */
  function functionBody(src: string, name: string): string {
    const idx = src.indexOf(`export async function ${name}`)
    expect(idx).toBeGreaterThan(-1)
    const rest = src.slice(idx)
    // 取到函数结尾（顶层 `\n}` 处）
    const end = rest.indexOf('\n}')
    return rest.slice(0, end)
  }

  it('deleteNoteFolderCascade 不在事务外读子表（TOCTOU 窗口）', () => {
    const src = readFileSync(path.resolve(process.cwd(), 'src/modules/notes/hooks.ts'), 'utf8')
    const body = functionBody(src, 'deleteNoteFolderCascade')
    const txIdx = body.indexOf('db.transaction')
    const readIdx = body.indexOf("db.notes.where('folderId')")
    expect(txIdx).toBeGreaterThan(-1)
    expect(readIdx).toBeGreaterThan(txIdx)
  })

  it('deleteTodoListCascade 不在事务外读子表', () => {
    const src = readFileSync(path.resolve(process.cwd(), 'src/modules/todo/hooks.ts'), 'utf8')
    const body = functionBody(src, 'deleteTodoListCascade')
    const txIdx = body.indexOf('db.transaction')
    const readIdx = body.indexOf("db.todos.where('listId')")
    expect(txIdx).toBeGreaterThan(-1)
    expect(readIdx).toBeGreaterThan(txIdx)
  })

  it('已软删的子记录同样被解绑（否则恢复后会挂在已删节点上）', async () => {
    const folder = await createNoteFolder('工作')
    await db.notes.put({ id: 'gone', folderId: folder.id, ...noteBase, deleted: 1 } as never)
    await deleteNoteFolderCascade(folder.id)
    expect((await db.notes.get('gone'))!.folderId).toBeUndefined()
  })
})

describe('防漂移锁：入队即触发同步', () => {
  /**
   * 扫描 `src/modules` 下所有 hooks/写入口文件：函数体内有 `syncQueue.add` 的，
   * 必须在同一函数体内出现 `requestSync()`；或整体委托给 `repositories` 仓储
   * （仓储内部已触发，属单一事实源，不重复要求）。
   */
  function walk(dir: string): string[] {
    return readdirSync(dir).flatMap((e) => {
      const p = path.join(dir, e)
      if (statSync(p).isDirectory()) return e === '__tests__' ? [] : walk(p)
      return /\.tsx?$/.test(p) ? [p] : []
    })
  }

  /** 拆出每个顶层 `export async function NAME(...) { ... }` 的函数体 */
  function exportedFunctionBodies(src: string): { name: string; body: string }[] {
    const out: { name: string; body: string }[] = []
    const re = /export (?:async )?function (\w+)/g
    let m: RegExpExecArray | null
    while ((m = re.exec(src))) {
      const start = m.index
      const end = src.indexOf('\n}', start)
      out.push({ name: m[1], body: src.slice(start, end < 0 ? src.length : end) })
    }
    return out
  }

  it('凡 syncQueue.add 的函数体都请求了同步（或走仓储）', () => {
    const files = walk(path.resolve(process.cwd(), 'src/modules'))
    const offenders: string[] = []
    for (const file of files) {
      const src = readFileSync(file, 'utf8')
      if (!src.includes('syncQueue.add')) continue
      for (const { name, body } of exportedFunctionBodies(src)) {
        if (!body.includes('syncQueue.add')) continue
        if (body.includes('requestSync()')) continue
        if (body.includes('Repo.')) continue // 委托仓储（仓储内部触发）
        offenders.push(`${path.relative(process.cwd(), file)} → ${name}`)
      }
    }
    expect(offenders).toEqual([])
  })
})
