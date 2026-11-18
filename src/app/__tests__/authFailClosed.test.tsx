// @vitest-environment jsdom
import {afterEach,it,expect,vi} from 'vitest'
import {render,screen,cleanup,fireEvent} from '@testing-library/react'
import {AUTH_TOKEN_KEY,AUTH_USERID_KEY} from '@/shared/authToken'
import {AuthGate} from '../AuthGate'
vi.mock('@/platform/env',()=>({isServerFirstWeb:()=>true,isTauri:()=>false}))
vi.mock('@/sync/convergeFromServer',()=>({runConverge:async()=>({upserted:0,removed:0,failed:0})}))
afterEach(()=>{cleanup();localStorage.clear();vi.unstubAllGlobals()})

const initialPassword='initial-password'
const changedPassword='new-password-123'

async function enterPasswordChange(fetchFn: ReturnType<typeof vi.fn>) {
 vi.stubGlobal('fetch',fetchFn)
 render(<AuthGate><p>PRIVATE CACHE</p></AuthGate>)
 await screen.findByText('用户名或邮箱')
 fireEvent.change(screen.getByLabelText('用户名或邮箱'),{target:{value:'admin'}})
 fireEvent.change(screen.getByLabelText('密码'),{target:{value:initialPassword}})
 fireEvent.click(screen.getByRole('button',{name:'登录'}))
 await screen.findByText('设置你的密码')
 fireEvent.change(screen.getByLabelText('新密码（至少 8 位）'),{target:{value:changedPassword}})
 fireEvent.change(screen.getByLabelText('确认新密码'),{target:{value:changedPassword}})
}

function firstChangeFetch(options:{patchStatus?:number;reauthStatus?:number;reauthFailures?:number;markerStatus?:number}={}) {
 let passwordChanged=false
 let initialized=false
 let markerFailures=options.markerStatus===undefined?0:1
 let reauthFailures=options.reauthFailures||0
 const fetchFn=vi.fn(async(url:string,init:RequestInit={})=>{
  const path=String(url)
  const auth=new Headers(init.headers).get('Authorization')
  if(path==='/setup/status')return Response.json({needsSetup:false})
  if(path==='/relay/auth-status')return Response.json({enabled:true,initialized})
  if(path.endsWith('/auth-with-password')){
   const body=JSON.parse(String(init.body)) as {password:string}
   if(!passwordChanged&&body.password===initialPassword)return Response.json({token:'old-token',record:{id:'owner-1'}})
   if(passwordChanged&&body.password===changedPassword){
    if(reauthFailures){reauthFailures--;return Response.json({message:'reauth temporarily unavailable'},{status:503})}
    if(options.reauthStatus&&options.reauthStatus!==200)return Response.json({message:'reauth denied'},{status:options.reauthStatus})
    return Response.json({token:'fresh-token',record:{id:'owner-1'}})
   }
   return Response.json({message:'bad credentials'},{status:401})
  }
  if(path==='/api/collections/users/records/owner-1'&&init.method==='PATCH'){
   if(options.patchStatus&&options.patchStatus!==200)return Response.json({message:'patch rejected'},{status:options.patchStatus})
   if(auth!=='old-token'||passwordChanged)return Response.json({message:'old token expired'},{status:401})
   passwordChanged=true
   return Response.json({id:'owner-1'})
  }
  if(path==='/relay/admin-initialized'){
   if(auth!=='fresh-token')return Response.json({message:'fresh token required'},{status:401})
   if(markerFailures){markerFailures--;return Response.json({message:'marker unavailable'},{status:options.markerStatus})}
   initialized=true
   return new Response(null,{status:204})
  }
  if(path==='/api/workhub/client-state'){
   if(auth!=='fresh-token'||!initialized)return Response.json({message:'not initialized'},{status:401})
   return Response.json({owner:'owner-1',generation:'generation-1',schema:6,syncProtocol:1})
  }
  throw new Error(`unexpected request: ${path}`)
 })
 return fetchFn
}

it('生产初始化/认证状态故障保留关闭，可重试且不显示私人缓存',async()=>{
 let available=false
 vi.stubGlobal('fetch',vi.fn(async(url:string)=>{
   if(!available)return Response.json({error:'unavailable'},{status:503})
   if(url==='/setup/status')return Response.json({needsSetup:false})
   return Response.json({enabled:true,initialized:true})
 }))
 render(<AuthGate><p>PRIVATE CACHE</p></AuthGate>)
 expect(await screen.findByRole('alert')).toBeTruthy();expect(screen.queryByText('PRIVATE CACHE')).toBeNull()
 available=true;fireEvent.click(screen.getByText('重试'));expect(await screen.findByText('用户名或邮箱')).toBeTruthy();expect(screen.queryByText('PRIVATE CACHE')).toBeNull()
})
it('已缓存 token 的 auth-refresh 503 仍不放行',async()=>{
 localStorage.setItem(AUTH_TOKEN_KEY,'cached')
 vi.stubGlobal('fetch',vi.fn(async(url:string)=>{
   if(url==='/setup/status')return Response.json({needsSetup:false})
   if(url==='/relay/auth-status')return Response.json({enabled:true,initialized:true})
   return Response.json({error:'offline'},{status:503})
 }))
 render(<AuthGate><p>PRIVATE CACHE</p></AuthGate>)
 // 用真正共享键测试，避免以不存在的 token 键假装覆盖 refresh。
 expect(await screen.findByRole('alert')).toBeTruthy();expect(screen.queryByText('PRIVATE CACHE')).toBeNull()
})

it('首改后旧token立刻失效：重新用新密码认证，再用fresh token完成标记与client-state验证',async()=>{
 const fetchFn=firstChangeFetch()
 await enterPasswordChange(fetchFn)
 fireEvent.click(screen.getByRole('button',{name:'设置并进入'}))
 expect(await screen.findByText('PRIVATE CACHE')).toBeTruthy()

 const calls=fetchFn.mock.calls
 const reauthIndex=calls.findIndex(([url,init])=>String(url).endsWith('/auth-with-password')&&JSON.parse(String(init?.body)).password===changedPassword)
 const markerIndex=calls.findIndex(([url])=>String(url)==='/relay/admin-initialized')
 const clientStateIndex=calls.findIndex(([url])=>String(url)==='/api/workhub/client-state')
 expect(reauthIndex).toBeGreaterThan(-1)
 expect(markerIndex).toBeGreaterThan(reauthIndex)
 expect(clientStateIndex).toBeGreaterThan(markerIndex)
 expect(new Headers(calls[markerIndex]?.[1]?.headers).get('Authorization')).toBe('fresh-token')
 expect(new Headers(calls[clientStateIndex]?.[1]?.headers).get('Authorization')).toBe('fresh-token')
 expect(localStorage.getItem(AUTH_TOKEN_KEY)).toBe('fresh-token')
 expect(Object.values(localStorage).some(value=>value===changedPassword)).toBe(false)
})

it('密码PATCH失败时不重认证、不写初始化标记，也不开放私人缓存',async()=>{
 const fetchFn=firstChangeFetch({patchStatus:400})
 await enterPasswordChange(fetchFn)
 fireEvent.click(screen.getByRole('button',{name:'设置并进入'}))
 expect(await screen.findByText('patch rejected')).toBeTruthy()
 expect(screen.queryByText('PRIVATE CACHE')).toBeNull()
 expect(fetchFn.mock.calls.filter(([url])=>String(url).endsWith('/auth-with-password'))).toHaveLength(1)
 expect(fetchFn.mock.calls.some(([url])=>String(url)==='/relay/admin-initialized')).toBe(false)
 expect(fetchFn.mock.calls.some(([url])=>String(url)==='/api/workhub/client-state')).toBe(false)
})

it('密码已改但新密码重认证失败：明确提示手动登录，不写标记或再次PATCH',async()=>{
 const fetchFn=firstChangeFetch({reauthStatus:401})
 await enterPasswordChange(fetchFn)
 fireEvent.click(screen.getByRole('button',{name:'设置并进入'}))
 expect(await screen.findByText(/密码已更改.*手动登录/)).toBeTruthy()
 expect(screen.queryByText('PRIVATE CACHE')).toBeNull()
 expect(fetchFn.mock.calls.filter(([url,init])=>String(url).endsWith('/auth-with-password')&&JSON.parse(String(init?.body)).password===changedPassword)).toHaveLength(1)
 expect(fetchFn.mock.calls.filter(([url,init])=>String(url)==='/api/collections/users/records/owner-1'&&init?.method==='PATCH')).toHaveLength(1)
 expect(fetchFn.mock.calls.some(([url])=>String(url)==='/relay/admin-initialized')).toBe(false)
 expect(fetchFn.mock.calls.some(([url])=>String(url)==='/api/workhub/client-state')).toBe(false)
})

it('自动重认证暂时失败后手动登录新密码继续剩余步骤，不重复PATCH或开放未验证缓存',async()=>{
 const fetchFn=firstChangeFetch({reauthFailures:1})
 await enterPasswordChange(fetchFn)
 fireEvent.click(screen.getByRole('button',{name:'设置并进入'}))
 expect(await screen.findByText(/密码已更改.*手动登录/)).toBeTruthy()
 expect(screen.queryByText('PRIVATE CACHE')).toBeNull()

 fireEvent.change(screen.getByLabelText('密码'),{target:{value:initialPassword}})
 fireEvent.click(screen.getByRole('button',{name:'登录'}))
 expect(await screen.findByText('bad credentials')).toBeTruthy()
 expect(screen.queryByText('PRIVATE CACHE')).toBeNull()

 fireEvent.change(screen.getByLabelText('密码'),{target:{value:changedPassword}})
 fireEvent.click(screen.getByRole('button',{name:'登录'}))
 expect(await screen.findByText('PRIVATE CACHE')).toBeTruthy()
 expect(fetchFn.mock.calls.filter(([url,init])=>String(url)==='/api/collections/users/records/owner-1'&&init?.method==='PATCH')).toHaveLength(1)
 expect(fetchFn.mock.calls.filter(([url,init])=>String(url).endsWith('/auth-with-password')&&JSON.parse(String(init?.body)).password===changedPassword)).toHaveLength(2)
 expect(Object.values(localStorage).some(value=>value===changedPassword)).toBe(false)
})

it('初始化标记失败时明确密码已改，可重试完成流程而不再次PATCH',async()=>{
 const fetchFn=firstChangeFetch({markerStatus:503})
 await enterPasswordChange(fetchFn)
 fireEvent.click(screen.getByRole('button',{name:'设置并进入'}))
 expect(await screen.findByText(/密码已更改.*重试完成设置/)).toBeTruthy()
 expect(screen.queryByText('PRIVATE CACHE')).toBeNull()
 expect(fetchFn.mock.calls.filter(([url,init])=>String(url)==='/api/collections/users/records/owner-1'&&init?.method==='PATCH')).toHaveLength(1)
 fireEvent.click(screen.getByRole('button',{name:'重试完成设置'}))
 expect(await screen.findByText('PRIVATE CACHE')).toBeTruthy()
 expect(fetchFn.mock.calls.filter(([url,init])=>String(url)==='/api/collections/users/records/owner-1'&&init?.method==='PATCH')).toHaveLength(1)
})

it.each([
 {status:401,body:{error:'unauthorized'},message:'登录状态已失效或无权访问工作台'},
 {status:403,body:{error:'forbidden'},message:'登录状态已失效或无权访问工作台'},
 {status:503,body:{error:'offline'},message:'工作台服务暂时不可用'},
 {status:200,body:{owner:'owner-1',generation:'generation-1',schema:6,syncProtocol:2},message:'UPGRADE_REQUIRED'},
])('client-state HTTP $status 与协议不支持分别提示，均不开放私人缓存',async({status,body,message})=>{
 localStorage.setItem(AUTH_TOKEN_KEY,'cached-token')
 localStorage.setItem(AUTH_USERID_KEY,'owner-1')
 vi.stubGlobal('fetch',vi.fn(async(url:string)=>{
  if(url==='/setup/status')return Response.json({needsSetup:false})
  if(url==='/relay/auth-status')return Response.json({enabled:true,initialized:true})
  if(url.endsWith('/auth-refresh'))return Response.json({token:'fresh-token'})
  if(url==='/api/workhub/client-state')return Response.json(body,{status})
  throw new Error(`unexpected request: ${url}`)
 }))
 render(<AuthGate><p>PRIVATE CACHE</p></AuthGate>)
 expect(await screen.findByText(new RegExp(message))).toBeTruthy()
 expect(screen.queryByText('PRIVATE CACHE')).toBeNull()
})
