// @vitest-environment jsdom
import {afterEach,it,expect,vi} from 'vitest'
import {render,screen,cleanup,fireEvent} from '@testing-library/react'
import {AUTH_TOKEN_KEY} from '@/shared/authToken'
import {AuthGate} from '../AuthGate'
vi.mock('@/platform/env',()=>({isServerFirstWeb:()=>true,isTauri:()=>false}))
vi.mock('@/sync/convergeFromServer',()=>({runConverge:async()=>({upserted:0,removed:0,failed:0})}))
afterEach(()=>{cleanup();localStorage.clear();vi.unstubAllGlobals()})
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
