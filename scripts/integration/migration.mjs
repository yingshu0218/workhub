import assert from 'node:assert/strict'
import {spawn,spawnSync} from 'node:child_process'
import {mkdtempSync,mkdirSync,openSync,readFileSync,cpSync,existsSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {resolve,join} from 'node:path'
import {once} from 'node:events'
import {setTimeout as delay} from 'node:timers/promises'
import {randomBytes} from 'node:crypto'
const root=resolve(process.env.WORKHUB_ROOT||'.'),bin=process.env.PB_BIN
if(!bin)throw new Error('PB_BIN required')
const temp=mkdtempSync(join(tmpdir(),'workhub-migration-'));console.log('ISOLATED_ROOT',temp)
const legacy=join(temp,'legacy'),empty=join(temp,'no-migrations');mkdirSync(empty)
const hooks=join(root,'pb_setup/pb_hooks'),migrations=join(root,'pb_setup/pb_migrations'),base='http://127.0.0.1:9632'
const password=randomBytes(18).toString('hex'),email='migration@example.test'
const common=['--dir',legacy,'--hooksDir',hooks,'--migrationsDir',empty]
assert.equal(spawnSync(bin,['superuser','upsert',email,password,...common]).status,0)
const log=openSync(join(temp,'pb.log'),'a');let pb,token
async function boot(dir,mig){pb=spawn(bin,['serve','--http','127.0.0.1:9632','--dir',dir,'--hooksDir',hooks,'--migrationsDir',mig],{stdio:['ignore',log,log]});for(let i=0;i<100;i++){if(pb.exitCode!==null)throw new Error(readFileSync(join(temp,'pb.log'),'utf8'));try{if((await fetch(base+'/api/health')).ok)return}catch{}await delay(50)}throw new Error('timeout')}
async function stop(){if(pb&&pb.exitCode===null){pb.kill('SIGTERM');await once(pb,'exit')}}
async function api(path,body,method=body?'POST':'GET'){const r=await fetch(base+path,{method,headers:{authorization:token||'','content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});const text=await r.text();const data=text?JSON.parse(text):{};assert.equal(r.ok,true,JSON.stringify(data));return data}
try{
 await boot(legacy,empty)
 token=(await api('/api/collections/_superusers/auth-with-password',{identity:email,password})).token
 await api('/api/collections/import',{collections:JSON.parse(readFileSync(join(root,'scripts/integration/fixtures/schema-04218ca.json'),'utf8')),deleteMissing:false},'PUT')
 await api('/api/collections/users/records',{email:'owner@workhub.local',password,passwordConfirm:password})
 await api('/api/collections/ledgers/records',{id:'l'.repeat(15),localId:'legacy:ledger',name:'legacy',currency:'USD',openingBalance:1.10,updatedAt:1,rev:1})
 await api('/api/collections/transactions/records',{id:'t'.repeat(15),localId:'legacy:txn',ledgerId:'legacy:ledger',summary:'legacy fixture',amount:1.25,type:'income',updatedAt:1,rev:1})
 await stop()
 const backup=spawnSync('python3',[join(root,'pb_setup/snapshot.py'),'backup','--source',legacy,'--target',join(temp,'backups')],{encoding:'utf8'});assert.equal(backup.status,0,backup.stderr)
 const backupPath=JSON.parse(backup.stdout).backup,restored=join(temp,'restored')
 const restore=spawnSync('python3',[join(root,'pb_setup/snapshot.py'),'restore','--source',backupPath,'--target',restored,'--isolated'],{encoding:'utf8'});assert.equal(restore.status,0,restore.stderr)
 assert.ok(existsSync(join(restored,'RESTORE_REVIEW_REQUIRED')));assert.ok(existsSync(join(restored,'PRE_COMMAND_SCHEMA')))
 const migrate=(dir)=>spawnSync(bin,['migrate','up','--dir',dir,'--hooksDir',hooks,'--migrationsDir',migrations],{encoding:'utf8'})
 const first=migrate(restored);assert.equal(first.status,0,first.stdout+first.stderr)
 const second=migrate(restored);assert.equal(second.status,0,second.stdout+second.stderr)
 await boot(restored,migrations)
 token=(await api('/api/collections/_superusers/auth-with-password',{identity:email,password})).token
 const rows=(await api('/api/collections/transactions/records')).items;assert.equal(rows.length,1);assert.equal(rows[0].amountMinor,125);assert.equal(rows[0].amount,1.25);assert.equal(rows[0].currency,'USD')
 assert.equal((await api('/api/collections/ledgers/records')).items[0].openingBalanceMinor,110)
 assert.equal((await api('/api/collections/users')).createRule,null)
 await stop()
 console.log('PASS 升级前真实 PB 备份可隔离恢复，增量迁移、重复运行不漂移')
 const anomaly=join(temp,'anomaly');cpSync(legacy,anomaly,{recursive:true})
 const patch=spawnSync('python3',['-c','import sqlite3,sys; c=sqlite3.connect(sys.argv[1]); c.execute("update transactions set amount=1.001"); c.commit()',join(anomaly,'data.db')]);assert.equal(patch.status,0)
 const bad=migrate(anomaly);assert.notEqual(bad.status,0);assert.match(bad.stdout+bad.stderr,/MONEY_PRECISION/)
 const inspect=spawnSync('python3',['-c',`import sqlite3,sys; c=sqlite3.connect(sys.argv[1]); assert c.execute("select amount from transactions").fetchone()[0]==1.001; assert not c.execute("select count(*) from sqlite_master where name='operations'").fetchone()[0]`,join(anomaly,'data.db')]);assert.equal(inspect.status,0)
 console.log('PASS 超精度迁移明确中止并整体回滚，旧值不舍入、操作集合不半建')
 console.log(JSON.stringify({passed:2,logs:temp}))
}finally{await stop()}
