// 仅本轮隔离实例的生产入口/MCP 冒烟；凭据取本机受保护环境文件，不输出其值。
import assert from 'node:assert/strict'
import {readFileSync,writeFileSync} from 'node:fs'
import {randomUUID,createHash} from 'node:crypto'
const envFile=process.env.WORKHUB_SMOKE_ENV
if(!envFile)throw new Error('WORKHUB_SMOKE_ENV required')
const env=Object.fromEntries(readFileSync(envFile,'utf8').split('\n').filter(l=>l&&!l.startsWith('#')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i),l.slice(i+1)]}))
const base=`http://127.0.0.1:${env.PUBLIC_PORT}`,id='smoke_'+randomUUID().replaceAll('-','')
let r=await fetch(base+'/api/health');assert.equal(r.status,200)
const html=await fetch(base);assert.equal(html.status,200);const text=await html.text();assert.equal(createHash('sha256').update(text).digest('hex'),createHash('sha256').update(readFileSync('dist/index.html')).digest('hex'))
let status=await (await fetch(base+'/setup/status')).json()
if(status.needsSetup){r=await fetch(base+'/setup/user',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({identity:'reliability',password:env.WORKHUB_PB_PASSWORD})});assert.equal(r.status,200,await r.text())}
r=await fetch(base+'/api/collections/users/auth-with-password',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({identity:env.WORKHUB_PB_ACCOUNT,password:env.WORKHUB_PB_PASSWORD})});const auth=await r.json();assert.ok(auth.token)
const generation=(await(await fetch(base+'/api/workhub/state',{headers:{authorization:auth.token}})).json()).generation;assert.ok(generation)
async function rpc(name,args,meta={},confirmToken){const r=await fetch(base+'/relay/mcp',{method:'POST',headers:{authorization:'Bearer '+env.WORKHUB_RELAY_TOKEN,'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name,arguments:args,_meta:meta,confirmToken}})});const out=await r.json();assert.equal(r.status,200,JSON.stringify(out));assert.ok(!out.error,JSON.stringify(out));const text=out.result.content[0].text;let data;try{data=JSON.parse(text)}catch{data={error:text}}return{isError:!!out.result.isError,data}}
const ledger=await rpc('fin_createLedger',{name:'隔离可靠性验收',currency:'CNY',openingBalance:0,closingCycle:'不封账',isDefault:false},{requestId:id+'_ledger',generation});assert.equal(ledger.isError,false,JSON.stringify(ledger))
const args={summary:'开发测试合成收入',type:'income',amount:12.34,ledgerId:ledger.data.ledgerId}
const meta={requestId:id+'_transaction',generation}
const preview=await rpc('fin_recordTransaction',args,meta);assert.equal(preview.data.preview,true,JSON.stringify(preview));assert.ok(preview.data.targets);assert.ok(preview.data.changes)
const confirmed=await rpc('confirm_preview',preview.data.confirmHint.args);assert.equal(confirmed.isError,false,JSON.stringify(confirmed))
const wrongContext=await rpc('fin_recordTransaction',args,{...meta,requestId:meta.requestId+'_changed'},confirmed.data.confirmToken);assert.equal(wrongContext.isError,true)
const renewed=await rpc('fin_recordTransaction',args,meta);assert.equal(renewed.data.preview,true)
const ticket=await rpc('confirm_preview',renewed.data.confirmHint.args);assert.equal(ticket.isError,false,JSON.stringify(ticket))
const committed=await rpc('fin_recordTransaction',args,meta,ticket.data.confirmToken);assert.equal(committed.isError,false,JSON.stringify(committed));assert.ok(committed.data.operationId)
const replay=await rpc('fin_recordTransaction',args,meta,ticket.data.confirmToken);assert.equal(replay.isError,false,JSON.stringify(replay));assert.equal(replay.data.transactionId,committed.data.transactionId)
const query=await rpc('listTransactions',{ledgerId:ledger.data.ledgerId});assert.equal(query.isError,false,JSON.stringify(query));assert.equal(query.data.totalMatched,1);assert.equal(query.data.totals.CNY.incomeMinor,1234)
r=await fetch(base+'/api/collections/transactions/records',{method:'POST',headers:{authorization:auth.token,'content-type':'application/json'},body:JSON.stringify({summary:'bypass'})});assert.notEqual(r.status,200)
const result={ok:true,protocol:1,productionHtmlHashMatches:true,closedPageMcp:true,concretePreview:true,confirmationContextBound:true,persistentReplay:true,oldProtocolBlocked:true,totalMatched:1,incomeMinor:1234,operationId:committed.data.operationId,requestId:meta.requestId,generation}
writeFileSync('../deployment-smoke.json',JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result,null,2))
