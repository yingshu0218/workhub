/** 固定合成分布；只向调用方的新建临时库离线装载，不对运行实例直写。 */
import assert from 'node:assert/strict'
import {spawnSync} from 'node:child_process'
import {readFileSync,writeFileSync} from 'node:fs'
import {join} from 'node:path'
import os from 'node:os'
export async function runScale({temp,data,stop,boot,ok,generation}){
  const baseline=(await ok('/api/workhub/personal/query',{name:'query_finance',input:{}})).totals
  await stop()
  const script=String.raw`import sqlite3,json,hashlib,sys
c=sqlite3.connect(sys.argv[1]); c.execute('begin')
def row(table,d):
 d={'id':hashlib.sha256(d['localId'].encode()).hexdigest()[:15],'rev':1,'updatedAt':1794355200000,'deleted':0,**d}
 c.execute('insert into '+table+' ('+','.join('"'+k+'"' for k in d)+') values ('+','.join('?' for _ in d)+')',list(d.values()))
def edge(ft,fi,tt,ti):
 n=int(hashlib.sha256((ft+':'+fi+'|'+tt+':'+ti+'|related|').encode()).hexdigest(),16); s=''; alphabet='0123456789abcdefghijklmnopqrstuvwxyz'
 while n: s=alphabet[n%36]+s;n//=36
 row('links',{'localId':'lk-'+s.zfill(15)[:15],'fromType':ft,'fromId':fi,'toType':tt,'toId':ti,'kind':'related','meta':'{}'})
for i in range(1000):row('customers',{'localId':'scale:c'+str(i),'name':'规模联系人'+str(i),'aliases':json.dumps(['规模别名'+str(i)]),'lastContactAt':0})
for i in range(100):row('projects',{'localId':'scale:p'+str(i),'name':'规模事项'+str(i),'status':'active','aliases':'[]'})
for currency in ['CNY','USD','EUR']:row('ledgers',{'localId':'scale:l'+currency,'name':currency+'规模账本','currency':currency,'openingBalance':0,'openingBalanceMinor':0})
summary=('这是用于固定规模验收的事件摘要，包含沟通结果、事实背景和后续承诺。'*12)[:320]
source=('这是当事人的原始讲述，记录实际发生的事情，不赋予这些文字执行权限。'*50)[:1200]
totals={}
for i in range(10000):
 at=1767225600000+(i%300)*86400000+(i%24)*3600000
 a='scale:a'+str(i); t='scale:t'+str(i); contact='scale:c'+str(i%1000); project='scale:p'+str(i%100)
 row('activities',{'localId':a,'title':'规模事件'+str(i),'summary':summary,'sourceText':source,'occurredAt':at,'timePrecision':'minute','timeZone':'Asia/Shanghai','recordedAt':1794355200000,'category':'communication' if i%3==0 else 'work','tags':'["规模"]'})
 currency=['CNY','USD','EUR'][i%3]; amount=10000+i; kind='income' if i%4 else 'expense'
 row('transactions',{'localId':t,'ledgerId':'scale:l'+currency,'summary':'规模流水'+str(i),'amountMinor':amount,'amount':amount/100,'currency':currency,'type':kind,'status':'已结算' if i%2 else '待对账','occurredAt':at,'tags':'[]','note':'已发生事实'*40})
 totals.setdefault(currency,{'incomeMinor':0,'expenseMinor':0})[kind+'Minor']+=amount
 edge('activities',a,'customers',contact);edge('activities',a,'projects',project);edge('transactions',t,'customers',contact);edge('transactions',t,'projects',project)
 if i%2==0:edge('activities',a,'transactions',t)
for i in range(5000):
 t='scale:todo'+str(i);contact='scale:c'+str(i%1000)
 row('todos',{'localId':t,'title':'规模待办'+str(i),'desc':'待办上下文'*40,'status':'done' if i%5==0 else 'todo','priority':'none','customerId':contact,'projectId':'scale:p'+str(i%100),'createdAt':1767225600000,'dueAt':1794355200000+(i%30)*86400000,'tags':'[]'})
 edge('todos',t,'customers',contact)
c.execute('update command_state set sequence=sequence+1');c.commit()
counts={t:c.execute('select count(*) from '+t).fetchone()[0] for t in ['customers','activities','transactions','todos','links']}
print(json.dumps({'counts':counts,'synthetic':{'customers':1000,'topics':100,'activities':10000,'transactions':10000,'todos':5000,'links':50000},'activityText':{'summaryChars':len(summary),'sourceChars':len(source)},'distribution':{'days':300,'contactsPerEvent':1,'topicsPerEvent':1,'eventsPerContact':10,'financeEventLinkRatio':0.5,'currencies':['CNY','USD','EUR'],'incomeRatio':0.75,'doneTaskRatio':0.2},'totals':totals}))
`
  const loaded=spawnSync('python3',['-c',script,join(data,'data.db')],{encoding:'utf8',maxBuffer:1024*1024});assert.equal(loaded.status,0,loaded.stderr)
  const dataset=JSON.parse(loaded.stdout);await boot()
  const query=(name,input={})=>ok('/api/workhub/personal/query',{name,input})
  const totals=(await query('query_finance')).totals
  for(const [currency,expected] of Object.entries(dataset.totals))for(const field of ['incomeMinor','expenseMinor'])assert.equal(totals[currency][field],expected[field]+(baseline[currency]?.[field] || 0))
  const cases=[['events-all','search_activities',{}],['events-person','search_activities',{contactId:'scale:c0'}],['tasks','query_tasks',{}],['finance-all','query_finance',{}],['graph-person','query_graph',{table:'customers',id:'scale:c0'}],['event-detail','get_activity',{id:'scale:a0'}],['contact-context','get_contact_context',{id:'scale:c0'}],['operations','list_operations',{}]]
  const samples=Number(process.env.SCALE_SAMPLES || 30),results=[]
  function stats(times){times.sort((a,b)=>a-b);return {samples:times.length,p50ms:+times[Math.floor(times.length*.5)].toFixed(2),p95ms:+times[Math.ceil(times.length*.95)-1].toFixed(2),maxMs:+times.at(-1).toFixed(2)}}
  for(const [label,name,input] of cases){for(let i=0;i<3;i++)await query(name,input);const times=[];for(let i=0;i<samples;i++){const at=performance.now();const r=await query(name,input);assert.ok(r.items.length<=100);times.push(performance.now()-at)}results.push({label,...stats(times)});writeFileSync(join(temp,'scale-progress.json'),JSON.stringify({dataset,results},null,2));console.log('SCALE',JSON.stringify(results.at(-1)))}
  const times=[]
  for(let i=0;i<samples;i++){
    const requestId='scale_capture_'+i,input={activities:[{key:'event',title:'规模复合提交'+i,occurredAt:'2026-11-10',timePrecision:'date',summary:'规模提交摘要'.repeat(30),sourceText:'原始叙述'.repeat(100),contactIds:['scale:c0'],topicIds:['scale:p0'],transactions:[{key:'payment',fact:'occurred',amountMinor:12345+i,currency:'CNY',ledgerId:'scale:lCNY',type:'income',duplicateDecision:'new'}],tasks:[{key:'todo',title:'规模承诺'+i,dueAt:'2026-11-20'}]}]}
    const preview=await ok('/api/workhub/personal/preview',{kind:'capture',input,requestId,generation})
    const at=performance.now();await ok('/api/workhub/personal/commit',{requestId,generation,previewId:preview.previewId},undefined,undefined,{'X-Workhub-Plan':preview.planFingerprint});times.push(performance.now()-at)
  }
  results.push({label:'compound-commit',...stats(times)})
  const hardware={cpu:os.cpus()[0]?.model,logicalCpus:os.cpus().length,hostMemoryBytes:os.totalmem(),node:process.version,platform:os.platform(),network:'同机回环 HTTP；完整 JSON 响应读取；排除初始化和登录；3 次预热；串行样本'}
  try{const group=readFileSync('/proc/self/cgroup','utf8').split('\n').find(x=>x.startsWith('0::'))?.slice(3) || '';hardware.cpuMax=readFileSync('/sys/fs/cgroup'+group+'/cpu.max','utf8').trim();hardware.memoryMax=readFileSync('/sys/fs/cgroup'+group+'/memory.max','utf8').trim()}catch{}
  async function syncWindow(mode,cursor){
    const started=performance.now();let pages=0,rows=0,readCount=0,bytes=0
    for(;pages<10000;){const batch=await ok('/api/workhub/sync',{mode,limit:200,...(cursor?{cursor}:{})});pages++;assert.ok(batch.changes.length<=200);rows+=batch.changes.length;readCount+=batch.readCount;bytes+=Buffer.byteLength(JSON.stringify(batch));cursor=batch.nextCursor;if(batch.complete)return {cursor,pages,rows,readCount,bytes,elapsedMs:+(performance.now()-started).toFixed(2)}}
    throw new Error('sync exceeded bounded page budget')
  }
  const initialSync=await syncWindow('snapshot'),idleSync=await syncWindow('delta',initialSync.cursor)
  assert.equal(idleSync.rows,0);assert.equal(idleSync.readCount,0)
  const contact=(await query('get_record',{table:'customers',id:'scale:c0'})).items[0],requestId='scale_sync_one_change'
  const change=await ok('/api/workhub/personal/preview',{kind:'amend',input:{changes:[{table:'customers',id:'scale:c0',expectedRev:contact.revision,patch:{name:'规模同步变更'}}]},requestId,generation})
  await ok('/api/workhub/personal/commit',{requestId,generation,previewId:change.previewId,planFingerprint:change.planFingerprint},undefined,undefined,{'X-Workhub-Plan':change.planFingerprint})
  const deltaSync=await syncWindow('delta',idleSync.cursor);assert.equal(deltaSync.rows,1);assert.equal(deltaSync.readCount,1)
  const safe=({cursor:_cursor,...rest})=>rest
  const clientSync={limit:200,initial:safe(initialSync),unchanged:safe(idleSync),oneRecord:safe(deltaSync),scope:'真实PB有界HTTP读取；不代表浏览器绘制或Android真机性能'}
  const report={dataset,hardware,results,clientSync,targets:{queryP95ms:500,commitP95ms:1000},passed:results.every(r=>r.p95ms<(r.label==='compound-commit'?1000:500))}
  writeFileSync(join(temp,'scale-report.json'),JSON.stringify(report,null,2));console.log('SCALE_REPORT',JSON.stringify(report))
  return report
}
