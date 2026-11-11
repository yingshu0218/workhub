/** 冷库迁移入口；先在隔离快照预演，成功后才允许原库迁移。不读账号凭据。 */
import {spawnSync} from 'node:child_process'
import {mkdtempSync,cpSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {resolve,join} from 'node:path'
const args=process.argv.slice(2),value=key=>args[args.indexOf(key)+1]
if(!args.includes('--stopped')||!args.includes('--data-dir')||!args.includes('--pb'))throw new Error('用法：node scripts/migrate-reliability.mjs --pb <二进制> --data-dir <已停服pb_data> --stopped [--apply]。默认仅预演。')
const data=resolve(value('--data-dir')),bin=resolve(value('--pb')),root=resolve('.'),temp=mkdtempSync(join(tmpdir(),'workhub-migrate-'))
const backup=spawnSync('python3',[join(root,'pb_setup/snapshot.py'),'backup','--source',data,'--target',join(temp,'backup')],{encoding:'utf8'})
if(backup.status!==0)throw new Error(backup.stderr)
const copy=JSON.parse(backup.stdout).backup
const preflight=spawnSync('python3',['-c',`import sqlite3,json,sys,decimal
c=sqlite3.connect(sys.argv[1]); bad=[]
for table,field in [('transactions','amount'),('ledgers','openingBalance')]:
 for rid,value in c.execute('SELECT localId,'+field+' FROM '+table):
  amount=decimal.Decimal(str(value or 0))*100
  if amount != amount.to_integral_value(): bad.append({'table':table,'id':rid,'value':value,'code':'MONEY_PRECISION'})
print(json.dumps({'anomalies':bad,'count':len(bad)}));sys.exit(1 if bad else 0)`,join(copy,'data.db')],{encoding:'utf8'})
process.stdout.write(preflight.stdout)
if(preflight.status!==0)throw new Error('迁移已中止，异常未舍入；完整备份：'+copy)
const command=dir=>spawnSync(bin,['migrate','up','--dir',dir,'--hooksDir',join(root,'pb_setup/pb_hooks'),'--migrationsDir',join(root,'pb_setup/pb_migrations')],{encoding:'utf8'})
const rehearsal=command(copy)
if(rehearsal.status!==0)throw new Error(rehearsal.stderr+rehearsal.stdout)
if(args.includes('--apply')){
 // 单独保留原始快照，避免把已预演迁移过的库误当回退点。
 cpSync(data,join(temp,'original'),{recursive:true})
 const result=command(data);if(result.status!==0)throw new Error(result.stderr+result.stdout)
}
process.stdout.write(JSON.stringify({ok:true,applied:args.includes('--apply'),checkpoint:'1794355201_sync_metadata',artifacts:temp})+'\n')
