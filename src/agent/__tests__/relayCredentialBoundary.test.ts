import {afterAll,beforeAll,describe,expect,it} from 'vitest'
import {createServer,type Server} from 'node:http'
import type {AddressInfo} from 'node:net'
import {createRelay} from '@relay/server.mjs'
import {NodeWebSocket} from './e2e.harness'

const shared='synthetic-shared-secret',agent='synthetic-independent-secret'
let server:Server,relay:ReturnType<typeof createRelay>,base:string,executed=0
const verified:unknown[]=[]
beforeAll(async()=>{
  relay=createRelay({token:shared,log:()=>{},serverExecutor:{
    authenticate:async credential=>{
      verified.push(credential)
      // 模拟事故宿主：旧版把空串当成共享过渡。外部边界必须在调用它之前拒绝空输入。
      if((credential as unknown)==='' || credential.kind==='shared-transition')return {clientId:'shared',capabilities:['*']}
      if(credential.kind==='agent' && credential.token===agent)return {clientId:'agent',capabilities:['read']}
      throw new Error('invalid credential')
    },
    listTools:()=>[{name:'demo_read'},{name:'demo_write'}],handles:name=>name.startsWith('demo_'),
    callTool:async()=>{executed++;return {ok:true,data:{done:true}}},
  }})
  server=createServer((req,res)=>{if(!relay.handleHttp(req,res))res.writeHead(404).end()})
  server.on('upgrade',(req,socket,head)=>relay.handleUpgrade(req,socket,head))
  await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));base='http://127.0.0.1:'+(server.address() as AddressInfo).port
})
afterAll(async()=>{relay.close();await new Promise<void>(r=>server.close(()=>r()))})
async function post(body:unknown,authorization?:string,suffix=''){
  return fetch(base+'/relay/mcp'+suffix,{method:'POST',headers:{'Content-Type':'application/json',...(authorization===undefined?{}:{authorization})},body:JSON.stringify(body)})
}
describe('外部凭据与共享过渡身份不可混淆',()=>{
  it.each([undefined,'Bearer','Bearer ','Bearer    ','Basic ignored','Bearer wrong'])('HTTP %s 拒绝查询、写入与取票，绝不返回工具或业务结果',async header=>{
    const before=executed
    for(const body of [
      {id:1,method:'tools/list'},
      {id:2,method:'tools/call',params:{name:'demo_read',arguments:{}}},
      {id:3,method:'tools/call',params:{name:'demo_write',arguments:{}}},
      {id:4,method:'tools/call',params:{name:'confirm_preview',arguments:{tool:'demo_write',args:{}}}},
    ]){const r=await post({jsonrpc:'2.0',...body},header);expect(r.status).toBe(401);const data=await r.json() as {error:unknown;result?:unknown};expect(data.error).toBeTruthy();expect(data.result).toBeUndefined()}
    expect(executed).toBe(before);expect(verified).not.toContain('')
  })
  it('只有匹配的共享秘密使用显式过渡身份；独立秘密保留自己的身份',async()=>{
    for(const token of [shared,agent]){const r=await post({jsonrpc:'2.0',id:1,method:'tools/list'},'Bearer '+token);expect(r.status).toBe(200);expect((await r.json() as {result:{tools:unknown[]}}).result.tools.length).toBeGreaterThan(0)}
    expect(verified).toContainEqual({kind:'shared-transition'});expect(verified).toContainEqual({kind:'agent',token:agent})
  })
  it('空/错误头不能用查询串或 initialize 正文伪装成共享身份',async()=>{
    const body={jsonrpc:'2.0',id:1,method:'initialize',params:{accessToken:shared,kind:'shared-transition'}}
    expect((await post(body,'Bearer','?token='+shared)).status).toBe(401)
    expect((await post(body,'Bearer wrong','?token='+shared)).status).toBe(401)
    expect((await post(body,undefined,'?token='+agent)).status).toBe(200)
  })
  it('真实 WS 空 initialize 不建立权限；失败重初始化清掉原会话，查询/写入/取票均拒绝',async()=>{
    const ws=new NodeWebSocket(base.replace('http:','ws:')+'/relay');await ws.waitOpen()
    let id=0
    const send=(method:string,params:unknown={})=>new Promise<{error?:unknown;result?:unknown}>(resolve=>{const current=++id;ws.onmessage=e=>{const data=JSON.parse(e.data);if(data.id===current)resolve(data)};ws.send(JSON.stringify({jsonrpc:'2.0',id:current,method,params}))})
    try{
      for(const token of [undefined,null,'','   ',{},[]]){expect((await send('initialize',{accessToken:token})).error).toBeTruthy();expect((await send('tools/list')).error).toBeTruthy()}
      expect((await send('initialize',{accessToken:agent})).result).toBeTruthy()
      expect((await send('initialize',{accessToken:''})).error).toBeTruthy()
      for(const name of ['demo_read','demo_write','confirm_preview'])expect((await send('tools/call',{name,arguments:{}})).error).toBeTruthy()
      expect((await send('initialize',{accessToken:shared})).result).toBeTruthy()
      expect((await send('tools/list')).result).toBeTruthy()
    }finally{ws.close()}
  })
})
