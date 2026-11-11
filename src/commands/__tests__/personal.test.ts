import { describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { buildLinkId } from '@/repositories/linkId'
import { sha256ToBase36_15 } from '@/sync/remoteNormalize'
import { planPersonal, parseTime, eventFeed, type PersonalHost, type Select } from '../personal'
import { inScope } from '../scope'
import type { Row } from '../core'

function fixture(rows: Record<string, Row[]> = {}): PersonalHost {
  return {
    now: Date.parse('2026-11-11T18:00:00+08:00'), owner: 'owner', client: 'client', can: () => true,
    hash: s => createHash('sha256').update(s).digest('hex'),
    get: (table, id) => rows[table]?.find(r => r.id === id),
    select: (table, q: Select) => (rows[table] || []).filter(r => !q.excludeIds?.includes(r.id) && (!q.q || String(r.title || r.summary || r.name || '').includes(q.q)) && inScope({deleted:0,...r}, q) && (!q.ids || q.ids.includes(String(q.idField === 'recordId' ? r.recordId : r.id))) && (q.from === undefined || Number(r[q.timeField || 'occurredAt']) >= q.from) && (q.to === undefined || Number(r[q.timeField || 'occurredAt']) <= q.to)).sort((a, b) => Number(b[q.timeField || 'occurredAt'] || 0) - Number(a[q.timeField || 'occurredAt'] || 0)).slice(q.offset || 0, (q.offset || 0) + (q.limit || 50)),
  }
}
describe('个人记忆共享核心', () => {
  it('跨宿主哈希保持既有 link 身份，含中文和补充平面字符', () => {
    for (const value of ['A:a-z_0', '中文', '🙂𠮷', 'e\u0301', '\ud800', 'x'.repeat(240)]) expect(sha256ToBase36_15(value)).toBe(BigInt('0x' + createHash('sha256').update(value).digest('hex')).toString(36).padStart(15, '0').slice(0, 15))
  })
  it('拒绝归整日期和错误偏移，保留真实日期', () => {
    for (const value of ['2026-02-30', '2026-02-29', '2026-04-31', '2026-11-11T25:00:00+08:00', '2026-11-11T12:00:00+14:30']) expect(() => parseTime(value)).toThrow(/INVALID_DATE/)
    expect(parseTime('2024-02-29')).toBe(Date.parse('2024-02-29T00:00:00+08:00'))
  })
  it('无联系人活动和多联系人收款承诺使用同一组权威对象', () => {
    const h = fixture({ ledgers: [{ id: 'ledger', currency: 'CNY' }] })
    const c = planPersonal(h, 'capture', { contacts: [{ key: 'a', name: '王' }, { key: 'b', name: '王' }], activities: [{ key: 'work', title: '独立工作', occurredAt: '2026-11-10', timePrecision: 'date' }, { key: 'talk', title: '改版沟通', occurredAt: '2026-11-11', timePrecision: 'date', contactIds: ['a', 'b'], transactions: [{ key: 'payment', fact: 'occurred', amountMinor: 200000, currency: 'CNY', ledgerId: 'ledger', type: 'income' }], tasks: [{ key: 'promise', title: '交方案', dueAt: '2026-11-13' }] }] }, 'generation', 'request_capture')
    expect(c.writes.filter(w => w.table === 'activities')).toHaveLength(2)
    expect(c.writes.filter(w => w.table === 'customers')).toHaveLength(2)
    expect(c.writes.filter(w => w.table === 'transactions')).toHaveLength(1)
    expect(c.writes.filter(w => w.table === 'todos')).toHaveLength(1)
    for (const w of c.writes.filter(w => w.table === 'links')) expect(w.id).toBe(buildLinkId({ type: w.value!.fromType as 'activities', id: String(w.value!.fromId) }, { type: w.value!.toType as 'customers', id: String(w.value!.toId) }, 'related', w.value!.meta as never))
    expect(c.writes.filter(w => w.table === 'activities')[0].value?.recordedAt).toBe(h.now)
  })
  it('报价不能成为收入；明确新增与疑似重复分别处理', () => {
    const h = fixture({ ledgers: [{ id: 'ledger', currency: 'CNY' }], transactions: [{ id: 'existing', ledgerId: 'ledger', type: 'income', amountMinor: 100, currency: 'CNY', occurredAt: parseTime('2026-11-11') }] })
    const input = (fact: string, duplicateDecision?: string) => ({ activities: [{ key: 'a', title: '报价', occurredAt: '2026-11-11', timePrecision: 'date', transactions: [{ key: 't', fact, amountMinor: 100, currency: 'CNY', ledgerId: 'ledger', type: 'income', duplicateDecision }] }] })
    expect(() => planPersonal(h, 'capture', input('invoice'), 'gen', 'request_quote')).toThrow(/NOT_OCCURRED/)
    expect(() => planPersonal(h, 'capture', input('occurred'), 'gen', 'request_dupe')).toThrow(/DUPLICATE_REVIEW_REQUIRED/)
    expect(planPersonal(h, 'capture', input('occurred', 'new'), 'gen', 'request_new').writes.some(w => w.table === 'transactions')).toBe(true)
  })
  it('联系人和事项过滤发生在分页前，旧匹配记录不会被较新无关流水遮掉', () => {
    const h = fixture({ customers: [{ id: 'c' }], projects: [{ id: 'p' }], transactions: [...Array.from({ length: 30 }, (_, i) => ({ id: 'unrelated' + i, deleted: 0, occurredAt: 100 + i, currency: 'CNY', amountMinor: 1 })), { id: 'target', deleted: 0, occurredAt: 1, currency: 'CNY', amountMinor: 100 }], links: [{ id: 'l1', fromType: 'transactions', fromId: 'target', toType: 'customers', toId: 'c' }, { id: 'l2', fromType: 'transactions', fromId: 'target', toType: 'projects', toId: 'p' }] })
    expect(eventFeed(h, { contactId: 'c', topicId: 'p' }, 2).map(r => r.sourceId)).toEqual(['target'])
    expect(() => eventFeed(h, { contactId: 'c', topicId: 'wrong' }, 2)).toThrow(/NOT_FOUND/)
  })
  it('查询范围内未呈现关联活动时仍保留真实收款投影', () => {
    const h = fixture({ customers: [{ id: 'c' }, { id: 'd' }], activities: [{ id: 'a', deleted: 0, occurredAt: 1, title: '旧事件' }], transactions: [{ id: 't', deleted: 0, occurredAt: 100, amountMinor: 100, currency: 'CNY' }], links: [{ id: 'l1', deleted: 0, fromType: 'activities', fromId: 'a', toType: 'customers', toId: 'd' }, { id: 'l2', deleted: 0, fromType: 'transactions', fromId: 't', toType: 'customers', toId: 'c' }, { id: 'l3', deleted: 0, fromType: 'activities', fromId: 'a', toType: 'transactions', toId: 't' }] })
    expect(eventFeed(h, { contactId: 'c' }, 10).map(r => r.sourceId)).toEqual(['t'])
    expect(eventFeed(h, { from: 50, to: 150 }, 10).map(r => r.sourceId)).toEqual(['t'])
  })
  it('独立流水关键词在分页之前过滤，旧的唯一匹配不会被新记录遮掉',()=>{
    const h=fixture({transactions:[...Array.from({length:30},(_,i)=>({id:'new'+i,deleted:0,summary:'其它流水',occurredAt:100+i,currency:'CNY',amountMinor:100})),{id:'old-match',deleted:0,summary:'唯一关键词',occurredAt:1,currency:'CNY',amountMinor:100}]})
    expect(eventFeed(h,{q:'唯一关键词'},1).map(r=>r.sourceId)).toEqual(['old-match'])
  })
  it('ISO纠错保留原意图指纹，不能在归一化时修改输入',()=>{
    const input={changes:[{table:'todos',id:'todo',expectedRev:1,patch:{dueAt:'2026-11-20'}}]}
    const h=fixture({todos:[{id:'todo',rev:1,status:'todo'}]})
    const command=planPersonal(h,'amend',input,'generation','request_iso_date')
    expect(input.changes[0].patch.dueAt).toBe('2026-11-20')
    expect(command.writes[0].value?.dueAt).toBe(parseTime('2026-11-20'))
    expect(command.intent).toEqual({kind:'amend',input})
  })
  it('事件清理拒绝连带删除仍被其他事实引用的附件',()=>{
    const h=fixture({activities:[{id:'event',rev:1}],attachments:[{id:'file',rev:1}],links:[{id:'one',fromType:'activities',fromId:'event',toType:'attachments',toId:'file'},{id:'two',fromType:'transactions',fromId:'payment',toType:'attachments',toId:'file'}]})
    expect(()=>planPersonal(h,'purge',{targets:[{table:'activities',id:'event',expectedRev:1}]},'generation','request_privacy')).toThrow(/PRIVACY_SCOPE_REQUIRED/)
  })
})
