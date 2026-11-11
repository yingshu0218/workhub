// @vitest-environment jsdom
import {afterEach,beforeEach,it,expect,vi} from 'vitest'
import {render,screen,fireEvent,cleanup} from '@testing-library/react'
import 'fake-indexeddb/auto'
import {db} from '@/db/db'
import {setStorageAdapter,resetStorageAdapter} from '@/storage'
import {createServerFirstAdapter} from '@/storage/serverFirst'
import type {Command} from '@/commands/core'
import TransactionFormDrawer from '../TransactionFormDrawer'
beforeEach(async()=>{localStorage.clear();await Promise.all(db.tables.map(t=>t.clear()));await db.ledgers.put({id:'l1',name:'主账本',currency:'CNY',openingBalance:0,createdAt:1,rev:1,updatedAt:1,deleted:0} as never)})
afterEach(()=>{cleanup();resetStorageAdapter()})
it('真实表单双击只提交一次；响应丢失后保留 ID 和计划，延时重试不重复记账',async()=>{
  const sent:Command[]=[]
  const adapter=createServerFirstAdapter({transport:{generation:async()=> 'test-generation',lookup:async()=>({committed:false}),commit:async command=>{
    sent.push(structuredClone(command));if(sent.length===1){await new Promise(r=>setTimeout(r,20));throw new Error('response lost')}
    expect(command).toEqual(sent[0]);return {requestId:command.requestId,generation:command.generation,operationId:'op',changes:command.writes.map(w=>({table:w.table,id:w.id,row:w.value!}))}
  }}})
  setStorageAdapter(adapter)
  const close=vi.fn();render(<TransactionFormDrawer open defaultLedgerId="l1" onClose={close}/>)
  fireEvent.change(screen.getByPlaceholderText(/如：深蓝科技二期交付结算凭据/),{target:{value:'真实重试'}})
  fireEvent.change(screen.getByPlaceholderText('0.00'),{target:{value:'123.45'}})
  const button=screen.getByText('立即保存此笔流水');fireEvent.click(button);fireEvent.click(button)
  await screen.findByText(/response lost/);expect(sent).toHaveLength(1);expect(close).not.toHaveBeenCalled()
  await new Promise(r=>setTimeout(r,30));fireEvent.click(button)
  await vi.waitFor(()=>expect(close).toHaveBeenCalledTimes(1));expect(sent).toHaveLength(2);expect(await db.transactions.count()).toBe(1)
})
