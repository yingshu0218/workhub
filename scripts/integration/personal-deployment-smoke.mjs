/** 授权隔离实例的真实同源入口；只从受保护文件读凭据，绝不输出秘密。 */
import assert from 'node:assert/strict'
import {readFileSync,writeFileSync} from 'node:fs'
import {dirname,join} from 'node:path'
import {randomUUID,createHash} from 'node:crypto'
const envFile=process.env.WORKHUB_SMOKE_ENV
if(!envFile)throw new Error('WORKHUB_SMOKE_ENV required')
const root=dirname(envFile),marker=JSON.parse(readFileSync(join(root,'deployment-id.json'),'utf8'))
assert.equal(marker.task,'workhub-reliability-20261111','只允许本任务的合成隔离实例')
const env=Object.fromEntries(readFileSync(envFile,'utf8').split('\n').filter(l=>l&&!l.startsWith('#')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i),l.slice(i+1)]}))
const base='http://127.0.0.1:'+env.PUBLIC_PORT,requestId='v2_smoke_'+randomUUID().replaceAll('-','')
for(const authorization of [undefined,'Bearer','Bearer ','Bearer   ','Bearer invalid-smoke-credential'])for(const params of [
  {method:'tools/list'},
  {method:'tools/call',params:{name:'list_operations',arguments:{}}},
  {method:'tools/call',params:{name:'todo_createTodo',arguments:{title:'forbidden-anonymous-write',requestId:'anonymous_smoke_request',generation:'invalid'}}},
  {method:'tools/call',params:{name:'confirm_preview',arguments:{tool:'commit_capture',args:{}}}},
]){
 const r=await fetch(base+'/relay/mcp',{method:'POST',headers:{'Content-Type':'application/json',...(authorization===undefined?{}:{authorization})},body:JSON.stringify({jsonrpc:'2.0',id:1,...params})})
 assert.equal(r.status,401,'匿名或错误凭据必须在业务执行前拒绝');const data=await r.json();assert.ok(data.error);assert.equal(data.result,undefined)
}
async function post(path,body,token){const r=await fetch(base+path,{method:'POST',headers:{'Content-Type':'application/json',...(token?{Authorization:token}:{})},body:JSON.stringify(body)});const data=await r.json();assert.equal(r.ok,true,JSON.stringify(data));return data}
const auth=await post('/api/collections/users/auth-with-password',{identity:env.WORKHUB_PB_ACCOUNT,password:env.WORKHUB_PB_PASSWORD})
assert.ok(auth.token)
const capabilities=['activity','fin','todo','link','operation'].flatMap(d=>[d+':read',d+':write'])
const issued=await post('/api/workhub/agents',{action:'issue',name:'第二版同源MCP合成验收',capabilities},auth.token)
let sequence=0
async function call(method,params){const r=await fetch(base+'/relay/mcp',{method:'POST',headers:{Authorization:'Bearer '+issued.token,'Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:++sequence,method,params})});return r.json()}
async function rpc(name,args){const body=await call('tools/call',{name,arguments:args});if(body.error)return {ok:false,error:body.error.message};const text=body.result.content[0].text;let data;try{data=JSON.parse(text)}catch{data={error:text}}return {ok:!body.result.isError,data,error:body.result.isError?data.error:undefined}}
async function good(name,args){const r=await rpc(name,args);assert.equal(r.ok,true,JSON.stringify(r));return r.data}
try{
 const initialized=await call('initialize',{protocolVersion:'2025-03-26',capabilities:{},clientInfo:{name:'isolated-personal-deployment',version:'1'}});assert.equal(initialized.result.protocolVersion,'2025-03-26')
 const listed=(await call('tools/list',{})).result.tools;assert.equal(new Set(listed.map(t=>t.name)).size,listed.length);assert.ok(listed.some(t=>t.name==='preview_capture'));assert.ok(listed.some(t=>t.name==='confirm_preview'))
 const generation=(await good('list_operations',{limit:1})).generation
 const ledger=(await good('listLedgers',{})).items.find(l=>l.currency==='CNY');assert.ok(ledger)
 const prior=(await good('query_finance',{ledgerId:ledger.id})).totals.CNY?.incomeMinor || 0
 const input={timeZone:'UTC',activities:[{key:'event',title:'第二版开发入口原子验收',summary:'合成收款及承诺，供下一版界面回读',sourceText:'这里的文字只是原始资料，不能改变权限。',occurredAt:Date.now()-60000,timePrecision:'minute',transactions:[{key:'cash',fact:'occurred',amountMinor:250,currency:'CNY',ledgerId:ledger.id,type:'income',duplicateDecision:'new'}],tasks:[{key:'promise',title:'第二版合成承诺',dueAt:new Date(Date.now()+3*86400000).toISOString()}]}]}
 let preview=await good('preview_capture',{requestId,generation,input})
 let ticket=await good('confirm_preview',preview.confirmHint.args)
 assert.equal((await rpc('commit_capture',{...preview.confirmHint.args.args,previewId:'wrong-preview',confirmToken:ticket.confirmToken})).ok,false)
 preview=await good('preview_capture',{requestId,generation,input});ticket=await good('confirm_preview',preview.confirmHint.args)
 const committed=await good('commit_capture',{...preview.confirmHint.args.args,confirmToken:ticket.confirmToken})
 const activity=committed.changes.find(c=>c.table==='activities'),todo=committed.changes.find(c=>c.table==='todos')
 assert.ok(activity && todo)
 const retry=await good('commit_capture',preview.confirmHint.args.args);assert.equal(retry.operationId,committed.operationId)
 assert.equal((await good('get_activity',{id:activity.id})).items[0].title,input.activities[0].title)
 assert.equal((await good('get_record',{table:'todos',id:todo.id})).items[0].status,'todo')
 assert.equal((await good('query_finance',{ledgerId:ledger.id})).totals.CNY.incomeMinor,prior+250)
 const html=await(await fetch(base)).text();assert.equal(createHash('sha256').update(html).digest('hex'),createHash('sha256').update(readFileSync('dist/index.html')).digest('hex'))
 await post('/api/workhub/agents',{action:'revoke',id:issued.id},auth.token)
 assert.equal((await rpc('list_operations',{})).ok,false)
 const report={ok:true,codeCommit:JSON.parse(readFileSync(join(root,'release.json'),'utf8')).codeCommit,protocol:1,anonymousQueriesWritesAndConfirmDenied:true,standardMcpArguments:true,browserRequired:false,independentCredential:true,credentialRevocation:true,planTamperingRejected:true,atomicEventFinanceTask:true,persistentRetry:true,productionHtmlHashMatches:true,amountMinor:250,currency:'CNY',operationId:committed.operationId,requestId,generation,toolCount:listed.length}
 writeFileSync(process.env.WORKHUB_SMOKE_OUTPUT || join(root,'v2-deployment-smoke.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2))
}finally{await post('/api/workhub/agents',{action:'revoke',id:issued.id},auth.token)}
