import {it,expect} from 'vitest'
import {createServer} from 'node:http'
import {once} from 'node:events'
import {applyClientCors} from '../client-cors.mjs'
it('真实HTTP预检接受原生Origin与所需认证头，拒绝任意站点及扩权头',async()=>{
 const server=createServer((req,res)=>{if(!applyClientCors(req,res))res.writeHead(401).end()});server.listen(0,'127.0.0.1');await once(server,'listening')
 const url='http://127.0.0.1:'+server.address().port+'/api/workhub/personal/commit'
 try{
  const good=await fetch(url,{method:'OPTIONS',headers:{Origin:'https://tauri.localhost','Access-Control-Request-Method':'POST','Access-Control-Request-Headers':'authorization,content-type,x-workhub-plan'}})
  expect(good.status).toBe(204);expect(good.headers.get('Access-Control-Allow-Origin')).toBe('https://tauri.localhost');expect(good.headers.get('Access-Control-Allow-Headers')).toContain('X-Workhub-Plan')
  expect((await fetch(url,{method:'OPTIONS',headers:{Origin:'https://untrusted.example.test'}})).status).toBe(403)
  expect((await fetch(url,{method:'OPTIONS',headers:{Origin:'https://tauri.localhost','Access-Control-Request-Headers':'x-workhub-agent-key'}})).status).toBe(403)
  expect((await fetch(url,{headers:{Origin:'https://tauri.localhost'}})).status).toBe(401)
 }finally{server.closeAllConnections();await new Promise(r=>server.close(r))}
})
