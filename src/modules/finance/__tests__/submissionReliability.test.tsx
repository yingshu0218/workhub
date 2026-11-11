// @vitest-environment jsdom
import {afterEach,beforeEach,it,expect,vi} from 'vitest'
import {render,screen,fireEvent,cleanup} from '@testing-library/react'
import 'fake-indexeddb/auto'
import {db} from '@/db/db'
import {setStorageAdapter,resetStorageAdapter} from '@/storage'
import {createServerFirstAdapter} from '@/storage/serverFirst'
import type {Command} from '@/commands/core'
import {useState} from 'react'
import {TodoFormDrawer} from '@/modules/todo/TodoFormDrawer'
import TransactionFormDrawer from '../TransactionFormDrawer'
beforeEach(async()=>{localStorage.clear();await Promise.all(db.tables.map(t=>t.clear()));await db.ledgers.put({id:'l1',name:'主账本',currency:'CNY',openingBalance:0,createdAt:1,rev:1,updatedAt:1,deleted:0} as never)})
afterEach(()=>{cleanup();resetStorageAdapter();vi.unstubAllGlobals()})
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
  await new Promise(r=>setTimeout(r,30));fireEvent.click(screen.getByText('重试原提交'))
  await vi.waitFor(()=>expect(close).toHaveBeenCalledTimes(1));expect(sent).toHaveLength(2);expect(await db.transactions.count()).toBe(1)
})

it('响应未知时关闭被保护；查回回执后可关闭再新建，不丢原输入或重复提交',async()=>{
 let original:Command|undefined
 setStorageAdapter(createServerFirstAdapter({transport:{generation:async()=> 'test-generation',lookup:async()=>({committed:true,receipt:{operationId:'known',requestId:original!.requestId,generation:original!.generation,changes:original!.writes.map(w=>({table:w.table,id:w.id,row:w.value!}))}}),commit:async command=>{original=structuredClone(command);throw new Error('response lost')}}}))
 vi.stubGlobal('fetch',vi.fn(async()=>Response.json({committed:true,receipt:{operationId:'known',requestId:original!.requestId,generation:original!.generation,changes:original!.writes.map(w=>({table:w.table,id:w.id,row:w.value!}))}})))
 function Harness(){const[open,setOpen]=useState(true);return <><button onClick={()=>setOpen(true)}>重新打开</button><TransactionFormDrawer open={open} defaultLedgerId="l1" onClose={()=>setOpen(false)}/></>}
 render(<Harness/>);fireEvent.change(screen.getByPlaceholderText(/如：深蓝科技二期交付结算凭据/),{target:{value:'不能丢失的草稿'}});fireEvent.change(screen.getByPlaceholderText('0.00'),{target:{value:'12.34'}});fireEvent.click(screen.getByText('立即保存此笔流水'))
 await screen.findByText(/response lost/)
 cleanup();render(<Harness/>)
 fireEvent.keyDown(window,{key:'Escape'})
 expect(screen.getByPlaceholderText(/如：深蓝科技二期交付结算凭据/)).toHaveProperty('value','不能丢失的草稿')
 fireEvent.click(screen.getByText('核对保存结果'));await vi.waitFor(()=>expect(screen.queryByText('核对保存结果')).toBeNull())
 expect(await db.transactions.count()).toBe(1)
 fireEvent.click(screen.getByText('重新打开'));expect(screen.getByPlaceholderText(/如：深蓝科技二期交付结算凭据/)).toHaveProperty('value','')
 expect(await db.transactions.count()).toBe(1);vi.unstubAllGlobals()
})

it('待办未知提交在重新挂载后恢复正文，核对后只保留一条待办',async()=>{
 let original:Command|undefined
 setStorageAdapter(createServerFirstAdapter({transport:{generation:async()=> 'test-generation',lookup:async()=>({committed:true,receipt:{operationId:'todo-known',requestId:original!.requestId,generation:original!.generation,changes:original!.writes.map(w=>({table:w.table,id:w.id,row:w.value!}))}}),commit:async command=>{original=structuredClone(command);throw new Error('response lost')}}}))
 const close=vi.fn();const form=()=> <TodoFormDrawer open todo={null} onClose={close}/>
 render(form());fireEvent.change(screen.getByPlaceholderText(/第一行作为标题/),{target:{value:'不能丢失的承诺'}});fireEvent.click(screen.getByText('创建待办'))
 await screen.findByText(/response lost/);cleanup();render(form())
 expect(screen.getByPlaceholderText(/第一行作为标题/)).toHaveProperty('value','不能丢失的承诺')
 fireEvent.click(screen.getByText('核对保存结果'));await vi.waitFor(()=>expect(close).toHaveBeenCalledTimes(1));expect(await db.todos.count()).toBe(1)
})
