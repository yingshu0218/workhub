import {it, expect} from 'vitest'
import {spawn} from 'node:child_process'
import {mkdtempSync,writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createServer} from 'node:http'
import {connect} from 'node:net'
import {once} from 'node:events'
import {setTimeout as delay} from 'node:timers/promises'
import {createRelay} from '../../relay/server.mjs'
const token='isolated-reliability-test-token'
async function mounted(){const relay=createRelay({token,log:()=>{}});const server=createServer((q,r)=>{if(!relay.handleHttp(q,r))r.end('healthy')});server.on('upgrade',relay.handleUpgrade);server.listen(0,'127.0.0.1');await once(server,'listening');return {relay,server,url:`http://127.0.0.1:${server.address().port}`,close:async()=>{relay.close();server.close();await once(server,'close')}}}
async function ws(url){const c=new WebSocket(url);await once(c,'open');return c}
it('双页面稳定选主、候补接续、在途归属且不重复执行',async()=>{
  const m=await mounted();const sockets=[]
  try {
    const first=await ws(m.url.replace('http:','ws:')+`/relay?role=browser&token=${token}`);sockets.push(first)
    const second=await ws(m.url.replace('http:','ws:')+`/relay?role=browser&token=${token}`);sockets.push(second)
    let a=0,b=0
    first.onmessage=e=>{const r=JSON.parse(e.data);a++;first.send(JSON.stringify({type:'agentops:result',requestId:r.requestId,ok:true,data:{marker:'first'}}))}
    second.onmessage=e=>{const r=JSON.parse(e.data);b++;second.send(JSON.stringify({type:'agentops:result',requestId:r.requestId,ok:true,data:{marker:'second'}}))}
    const call=()=>fetch(m.url+'/relay/mcp',{method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'todo_createTodo',arguments:{title:'test'}}})}).then(r=>r.json())
    expect(JSON.stringify(await call())).toContain('first');expect(a).toBe(1);expect(b).toBe(0)
    first.close();await once(first,'close');await delay(10)
    expect(JSON.stringify(await call())).toContain('second');expect(b).toBe(1)
    expect(second.readyState).toBe(WebSocket.OPEN)
  }finally{for(const s of sockets)s.close();await m.close()}
})
it('未掩码与超大帧只关闭异常连接，宿主仍健康',async()=>{
  const m=await mounted()
  try {
    for(const frame of [Buffer.from([0x81,0]),Buffer.from([0x81,0xff,0,0,0,0,0x40,0,0,0])]){
      const socket=connect(Number(new URL(m.url).port),'127.0.0.1');await once(socket,'connect')
      socket.write('GET /relay HTTP/1.1\r\nHost: localhost\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\n\r\n')
      await once(socket,'data');socket.write(frame);await once(socket,'close')
      expect((await fetch(m.url+'/healthy')).status).toBe(200)
    }
  }finally{await m.close()}
})
it('A24 同长度入口换内容得到新 ETag；A27 生产认证失败关闭访问',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'workhub-http-'));writeFileSync(join(dir,'index.html'),'<html>one</html>')
  const probe=createServer();probe.listen(0,'127.0.0.1');await once(probe,'listening');const port=probe.address().port;probe.close();await once(probe,'close')
  const child=spawn(process.execPath,['scripts/serve.mjs'],{env:{...process.env,NODE_ENV:'production',HOST:'127.0.0.1',PORT:String(port),WORKHUB_DIST_DIR:dir,WORKHUB_DATA_DIR:dir,WORKHUB_RELAY_TOKEN:token,PB_SUPERUSER:'',PB_SUPERUSER_PASSWORD:''},stdio:['ignore','pipe','pipe']})
  try{
    let ready=false;child.stderr.on('data',b=>{if(String(b).includes('站点已监听'))ready=true})
    for(let i=0;i<100&&!ready;i++)await delay(20)
    expect(ready).toBe(true)
    const url=`http://127.0.0.1:${port}`
    const a=await fetch(url);const etag=a.headers.get('etag');expect(await a.text()).toContain('one')
    writeFileSync(join(dir,'index.html'),'<html>two</html>')
    const b=await fetch(url,{headers:{'if-none-match':etag}});expect(b.status).toBe(200);expect(b.headers.get('etag')).not.toBe(etag);expect(await b.text()).toContain('two')
    const auth=await fetch(url+'/relay/auth-status');expect(auth.status).toBe(503);expect((await auth.json()).enabled).toBe(true)
  }finally{child.kill('SIGTERM');await once(child,'exit')}
})
