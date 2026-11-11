/** 真实 PB 0.40.2 + 生产 ESM 执行器；全在新临时库运行，禁止接入外部数据。 */
import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { mkdtempSync, openSync, readFileSync, writeFileSync, mkdirSync, cpSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve, join } from 'node:path'
import { randomBytes } from 'node:crypto'
import { once } from 'node:events'
import { setTimeout as delay } from 'node:timers/promises'
const root = resolve(process.env.WORKHUB_ROOT || '.')
const bin = process.env.PB_BIN
if (!bin) throw new Error('PB_BIN 必须指向隔离 PocketBase 0.40.2 可执行文件')
assert.match(spawnSync(bin, ['--version'], {encoding:'utf8'}).stdout, /0\.40\.2/)
const temp = mkdtempSync(join(tmpdir(), 'workhub-reliability-'))
console.log('ISOLATED_ROOT', temp)
const data = join(temp, 'data'), port = Number(process.env.PB_TEST_PORT || 9632)
const base = `http://127.0.0.1:${port}`
const email = 'fixture@example.test', password = randomBytes(18).toString('hex')
const hooks = join(root, 'pb_setup/pb_hooks'), migrations = join(root, 'pb_setup/pb_migrations')
const pbLog = openSync(join(temp, 'pocketbase.log'), 'a')
let pb
async function stop() { if (pb && pb.exitCode === null) { pb.kill('SIGTERM'); await once(pb,'exit') } }
async function boot(dir=data) {
  pb = spawn(bin, ['serve','--http',`127.0.0.1:${port}`,'--dir',dir,'--hooksDir',hooks,'--migrationsDir',migrations], {stdio:['ignore',pbLog,pbLog]})
  for(let i=0;i<100;i++){ if(pb.exitCode!==null) throw new Error('PB 启动失败\n'+readFileSync(join(temp,'pocketbase.log'),'utf8')); try{if((await fetch(base+'/api/health')).ok)return}catch{} await delay(50) }
  throw new Error('PB 启动超时')
}
let token='', superToken='', generation=''
async function api(path,body,auth=token,method=body===undefined?'GET':'POST') {
  const response=await fetch(base+path,{method,headers:{...(auth?{authorization:auth}:{}),...(body!==undefined?{'content-type':'application/json'}:{})},...(body!==undefined?{body:JSON.stringify(body)}:{})})
  const value=await response.json().catch(()=>({}))
  return {status:response.status, body:value}
}
const tests=[]
async function test(name,fn){await fn(); tests.push(name); console.log('PASS',name)}
let seq=0
function command(writes,reads=[],extra={}){return {protocol:1,generation,requestId:'test_request_'+(++seq),reads,writes,scans:[],...extra}}
const put=(table,id,value)=>({table,id,kind:'put',value:{id,...value}})
const missing=(table,id)=>({table,id,rev:null})
async function commit(c){const r=await api('/api/workhub/commands',c);assert.equal(r.status,200,JSON.stringify(r.body));return r.body}
async function records(table,auth=superToken){const r=await api(`/api/collections/${table}/records?perPage=500`,undefined,auth); assert.equal(r.status,200,JSON.stringify(r.body));return r.body.items}
try {
  // 先创建超管，迁移在 PB 首次监听前固化 schema 与注册规则。
  const upsert=spawnSync(bin,['superuser','upsert',email,password,'--dir',data,'--hooksDir',hooks,'--migrationsDir',migrations],{encoding:'utf8'})
  assert.equal(upsert.status,0,upsert.stderr+upsert.stdout)
  await boot()
  superToken=(await api('/api/collections/_superusers/auth-with-password',{identity:email,password},'')).body.token
  assert.ok(superToken)
  await test('首启跨并发原子性 + 注册规则锁定',async()=>{
    const attempts=await Promise.all(Array.from({length:6},(_,i)=>api('/api/workhub/initialize',{email:`owner${i}@workhub.local`,identity:'owner'+i,password},superToken)))
    assert.equal(attempts.filter(r=>r.status===200).length,1,JSON.stringify(attempts))
    assert.equal((await records('users')).length,1)
    const owner=(await records('users'))[0]
    token=(await api('/api/collections/users/auth-with-password',{identity:owner.email,password},'')).body.token
    assert.ok(token)
    assert.notEqual((await api('/api/collections/users/records',{email:'evil@example.test',password,passwordConfirm:password},'')).status,200)
    generation=(await api('/api/workhub/state')).body.generation;assert.ok(generation)
  })
  const ledger=put('ledgers','test:ledger',{name:'fixture',currency:'CNY',openingBalance:0,closingCycle:'月结',createdAt:1})
  await commit(command([ledger],[missing('ledgers',ledger.id)]))
  const c1=put('customers','test:customer1',{name:'甲',createdAt:1}), c2=put('customers','test:customer2',{name:'乙',createdAt:1})
  await commit(command([c1,c2],[missing('customers',c1.id),missing('customers',c2.id)]))
  await test('A08 第N步数据库失败回滚业务、effects、operation',async()=>{
    const before=(await records('operations')).length
    const c=command([put('todos','test:rollback1',{title:'应回滚'}),put('customers','test:rollback2',{name:'B',unknownColumn:'数据库拒绝'})],[missing('todos','test:rollback1'),missing('customers','test:rollback2')])
    const r=await api('/api/workhub/commands',c);assert.notEqual(r.status,200)
    assert.ok(!(await records('todos')).some(r=>r.localId==='test:rollback1'))
    assert.equal((await records('operations')).length,before)
  })
  await test('事务内身份、引用、协议校验与旧集合入口封锁',async()=>{
    assert.equal((await api('/api/workhub/commands',{},'')).status,401)
    assert.notEqual((await api('/api/collections/todos/records',{localId:'bypass',title:'bad'})).status,200)
    const c=command([put('interactions','test:orphan',{customerId:'missing',content:'bad',at:1})],[missing('interactions','test:orphan')])
    assert.match((await api('/api/workhub/commands',c)).body.error,/REFERENCE/)
    const foreign=await api('/api/collections/users/records',{email:'foreign@example.test',password,passwordConfirm:password},superToken)
    const other=(await api('/api/collections/users/auth-with-password',{identity:'foreign@example.test',password},'')).body.token
    assert.ok(foreign.body.id);assert.equal((await api('/api/workhub/state',undefined,other)).status,403)
  })
  let receipt, original
  await test('A06 A07 并发、丢响应及跨进程重试持久幂等；相同事实新ID正常新增',async()=>{
    original=command([put('transactions','test:txn',{ledgerId:ledger.id,type:'income',amount:100,summary:'收入',occurredAt:1})],[missing('transactions','test:txn')])
    const replies=await Promise.all(Array.from({length:8},()=>commit(original)))
    assert.equal(new Set(replies.map(r=>r.operationId)).size,1)
    receipt=replies[0]
    await stop();await boot()
    assert.equal((await commit(original)).operationId,receipt.operationId)
    const changed=structuredClone(original);changed.writes[0].value.amount=101
    assert.match((await api('/api/workhub/commands',changed)).body.error,/REQUEST_REUSED/)
    const intentCommand=command([put('todos','test:intent',{title:'original'})],[missing('todos','test:intent')],{intent:{action:'create',title:'original'}});await commit(intentCommand);const changedPlan=structuredClone(intentCommand);changedPlan.writes[0].value.title='swapped';assert.match((await api('/api/workhub/commands',changedPlan)).body.error,/REQUEST_REUSED/)
    await commit(command([put('transactions','test:txn2',{ledgerId:ledger.id,type:'income',amount:100,summary:'收入',occurredAt:1})],[missing('transactions','test:txn2')]))
    assert.equal((await records('transactions')).length,2)
  })
  await test('A10 A11 版本冲突和字段显式清空',async()=>{
    const id='test:todo';await commit(command([put('todos',id,{title:'承诺',customerId:c1.id,desc:'备注',dueAt:123})],[missing('todos',id)]))
    const edit=command([put('todos',id,{title:'承诺',customerId:null,desc:null,dueAt:null})],[{table:'todos',id,rev:1}])
    await commit(edit)
    const row=(await records('todos')).find(r=>r.localId===id)
    assert.equal(row.customerId,'');assert.equal(row.desc,'');assert.equal(row.dueAt,0)
    const stale=structuredClone(edit);stale.requestId='new_stale_request'
    assert.match((await api('/api/workhub/commands',stale)).body.error,/VERSION_CONFLICT/)
  })
  await test('A12 A13 A14 明确分单位、固定币种、多联系人只计一笔与全量汇总',async()=>{
    const usd=put('ledgers','test:usd',{name:'USD',currency:'USD',openingBalance:0})
    await commit(command([usd],[missing('ledgers',usd.id)]))
    const writes=Array.from({length:65},(_,i)=>put('transactions','test:bulk'+i,{ledgerId:ledger.id,amount:1.01,type:'income',summary:'批量',occurredAt:1}))
    writes.push(put('transactions','test:usdtxn',{ledgerId:usd.id,amount:100,type:'income',summary:'美元',occurredAt:1}))
    await commit(command(writes,writes.map(w=>missing(w.table,w.id))))
    const link=(id,target)=>put('links',id,{fromType:'transactions',fromId:'test:txn',toType:'customers',toId:target,kind:'related',createdAt:1})
    await commit(command([link('test:link1',c1.id),link('test:link2',c2.id)],[missing('links','test:link1'),missing('links','test:link2')]))
    const rows=await records('transactions');assert.equal(rows.length,68)
    assert.equal(rows.filter(r=>r.currency==='CNY').reduce((s,r)=>s+r.amountMinor,0),26565)
    assert.equal(rows.filter(r=>r.currency==='USD').reduce((s,r)=>s+r.amountMinor,0),10000)
    const query=await api('/api/workhub/finance',{});assert.equal(query.status,200,JSON.stringify(query.body));assert.equal(query.body.items.length,50);assert.equal(query.body.totalMatched,68);assert.equal(query.body.totals.CNY.incomeMinor,26565);assert.equal(query.body.totals.USD.incomeMinor,10000);assert.equal(query.body.truncated,true)
    const invalid=command([put('transactions','test:badmoney',{ledgerId:ledger.id,amount:1.001,type:'income',summary:'bad'})],[missing('transactions','test:badmoney')])
    assert.match((await api('/api/workhub/commands',invalid)).body.error,/MONEY_PRECISION/)
  })
  await test('A18 A19 可恢复墓碑、永久删除登记阻止旧设备复活及历史脱敏',async()=>{
    const id='test:trash'
    await commit(command([put('customers',id,{name:'private fixture'})],[missing('customers',id)]))
    await commit(command([put('customers',id,{name:'private fixture',deleted:1,deletedAt:Date.now()})],[{table:'customers',id,rev:1}]))
    assert.equal((await records('customers',token)).find(r=>r.localId===id).deleted,1)
    await commit(command([put('customers',id,{name:'private fixture',deleted:0,restoredAt:Date.now()})],[{table:'customers',id,rev:2}]))
    await commit(command([put('customers',id,{name:'private fixture',deleted:1})],[{table:'customers',id,rev:3}]))
    await commit(command([{kind:'delete',table:'customers',id}],[{table:'customers',id,rev:4}]))
    assert.match((await api('/api/workhub/commands',command([put('customers',id,{name:'stale'})],[missing('customers',id)]))).body.error,/PERMANENTLY_DELETED/)
    const history=(await records('operation_effects')).filter(r=>r.recordId===id)
    assert.ok(history.every(r=>!r.before&&!r.after))
    assert.ok(!JSON.stringify(await records('operations')).includes('private fixture'))
  })
  await test('生产服务端 Agent 与 UI 命令端点同源、稳定 requestId、票据重试',async()=>{
    const {initServerExecutor}=await import(join(root,'dist-server/server-executor.mjs'))
    const owner=(await records('users')).find(u=>u.email.startsWith('owner'))
    const executor=initServerExecutor({pb:{baseUrl:base,account:owner.email,password},domains:{read:true,fin:true,crm:true,todo:true}})
    const input={summary:'真实 Agent',amount:3.14,type:'income',ledgerId:ledger.id,customerIds:[c1.id,c2.id]}
    const meta={requestId:'agent_persistent_request',generation}
    const preview=await executor.callTool('fin_recordTransaction',input,meta);assert.equal(preview.data.preview,true)
    const first=await executor.callTool('fin_recordTransaction',input,{...meta,confirmToken:'verified-by-relay'})
    assert.equal(first.ok,true,JSON.stringify(first));assert.ok(first.data.transactionId)
    const retry=await executor.callTool('fin_recordTransaction',input,{...meta,replayOnly:true})
    assert.equal(retry.ok,true);assert.equal(first.data.transactionId,retry.data.transactionId)
    const bad=await executor.callTool('fin_recordTransaction',{...input,amount:9},{...meta,replayOnly:true});assert.equal(bad.ok,false)
    const tools=executor.listTools();assert.ok(tools.some(t=>t.name==='fin_recordTransaction'))
    const created=(await records('transactions')).find(r=>r.localId===first.data.transactionId)
    assert.equal(created.amountMinor,314);assert.equal(created.currency,'CNY')
    const editInput={transactionId:first.data.transactionId,amount:4.14}
    const editMeta={requestId:'agent_version_bound_preview',generation}
    assert.equal((await executor.callTool('fin_updateTransaction',editInput,editMeta)).data.preview,true)
    const intervening=structuredClone(created);delete intervening.collectionId;delete intervening.collectionName;delete intervening.localId;delete intervening.created;delete intervening.updated;delete intervening.server_received_at;intervening.id=created.localId;intervening.amount=5.14;intervening.amountMinor=514
    await commit(command([put('transactions',created.localId,intervening)],[{table:'transactions',id:created.localId,rev:created.rev}]))
    const conflict=await executor.callTool('fin_updateTransaction',editInput,{...editMeta,confirmToken:'verified-by-relay'});assert.equal(conflict.ok,false);assert.match(conflict.error,/VERSION_CONFLICT/)
  })
  await test('A25 附件受控暂存与复合提交',async()=>{
    const form=new FormData();form.append('file',new Blob(['fixture attachment']), 'fixture.txt')
    const r=await fetch(base+'/api/workhub/stage-attachment',{method:'POST',headers:{authorization:token},body:form})
    const stage=await r.json();assert.equal(r.status,200,JSON.stringify(stage))
    await commit(command([put('attachments','test:attachment',{name:'fixture.txt',size:18,mime:'text/plain',createdAt:1,stagedFileId:stage.stageId})],[missing('attachments','test:attachment')]))
    const att=(await records('attachments'))[0];assert.ok(att.file)
    const file=await fetch(`${base}/api/files/${att.collectionId}/${att.id}/${att.file}`);assert.equal(await file.text(),'fixture attachment')
  })
  await stop()
  await test('A25 A32 冷备份校验、空环境恢复、世代轮换、旧请求拒绝',async()=>{
    const backup=spawnSync('python3',[join(root,'pb_setup/snapshot.py'),'backup','--source',data,'--target',join(temp,'backups')],{encoding:'utf8'})
    assert.equal(backup.status,0,backup.stderr)
    const backupPath=JSON.parse(backup.stdout).backup
    const restored=join(temp,'restored')
    const restore=spawnSync('python3',[join(root,'pb_setup/snapshot.py'),'restore','--source',backupPath,'--target',restored,'--isolated'],{encoding:'utf8'})
    assert.equal(restore.status,0,restore.stderr)
    await boot(restored)
    assert.equal((await records('transactions')).length,69)
    assert.equal((await records('attachments')).length,1)
    const newGeneration=(await api('/api/workhub/state')).body.generation;assert.notEqual(newGeneration,generation)
    assert.match((await api('/api/workhub/commands',original)).body.error,/RECOVERY_REVIEW_REQUIRED/)
    const missing=await api('/api/workhub/operations/lookup',{requestId:'unknown_after_backup',generation});assert.equal(missing.status,409)
    await stop()
    const missingBackup=spawnSync('python3',[join(root,'pb_setup/snapshot.py'),'backup','--source',join(temp,'missing'),'--target',join(temp,'backups'),'--retain-days','0'],{encoding:'utf8'})
    assert.notEqual(missingBackup.status,0);assert.ok(readFileSync(join(backupPath,'manifest.json')))
  })
  console.log(JSON.stringify({passed:tests.length,tests,logs:temp},null,2))
} finally { await stop() }
