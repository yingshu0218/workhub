// 客户端镜像只读协议：读取当前权威行，不将历史 effect 的旧快照当作现状。
const commands = require(__hooks + '/commands.js')
const core = require(__hooks + '/command-core.js')
const SCHEMA = 6
function schemaState(app,e) {
  const state = commands.owner(app,e)
  const principal = require(__hooks+'/personal-auth.js').principal(app,e)
  if (principal.clientId !== 'owner') throw new Error('FORBIDDEN: 镜像同步只允许拥有者会话')
  return {state,owner:e.auth.id,generation:state.getString('generation'),schema:SCHEMA,protocol:1}
}
exports.state = e => { try { const s=schemaState($app,e);return e.json(200,{protocol:s.protocol,generation:s.generation,owner:s.owner,schema:s.schema,syncProtocol:1}) } catch(err){return commands.error(e,err)} }
exports.sync = e => {
  try { let result
    $app.runInTransaction(app=>{
      const s=schemaState(app,e), d=e.requestInfo().body || {}, limit=Number(d.limit || 200)
      if(!Number.isInteger(limit)||limit<1||limit>200)throw new Error('LIMIT_EXCEEDED: 每批最多200行')
      let c=d.cursor
      if(c){try{c=JSON.parse(c)}catch(_){throw new Error('INVALID_CURSOR: 请重新建立快照')}
        if(c.g!==s.generation)throw new Error('RECOVERY_REVIEW_REQUIRED: 数据世代已改变')
        if(c.o!==s.owner || c.s!==SCHEMA || c.p!==1)throw new Error('SYNC_CONTEXT_REQUIRED: 游标身份或版本不匹配')
      }
      const watermark=s.state.getInt('sequence'), mode=d.mode || (c?.m==='delta'?'delta':'snapshot')
      const encode=value=>JSON.stringify({...value,g:s.generation,o:s.owner,s:SCHEMA,p:1})
      const changes=[],tables=core.BUSINESS_TABLES
      const change=(table,id,record)=>{const r=record===undefined?commands.find(app,table,id):record;return {table,id,row:r?commands.rowOf(r):null,...(table==='attachments'&&r?{file:{id:r.id,name:r.getString('file')}}:{})}}
      if(mode==='snapshot'){
        if(c && c.m!=='snapshot')throw new Error('SYNC_CONTEXT_REQUIRED: 快照游标类型错误')
        const high=c?c.w:watermark
        if(high!==watermark)throw new Error('SNAPSHOT_RESTART_REQUIRED: 首轮快照期间有变更，请重建')
        let index=c?c.t:0,last=c?c.id:''
        if(!Number.isInteger(index)||index<0||index>tables.length||typeof last!=='string')throw new Error('INVALID_CURSOR: 快照位置错误')
        while(index<tables.length && changes.length<limit){
          const table=tables[index],collection=table==='moduleConfigs'?'module_configs':table
          const rows=app.findRecordsByFilter(collection,'localId > {:last}','localId',limit-changes.length+1,0,{last})
          const take=rows.slice(0,limit-changes.length)
          for(const r of take)changes.push(change(table,r.getString('localId'),r))
          if(rows.length>take.length){last=take[take.length-1].getString('localId');break}
          index++;last=''
        }
        const complete=index===tables.length
        result={protocol:1,generation:s.generation,owner:s.owner,schema:SCHEMA,watermark:high,mode,changes,complete,nextCursor:complete?encode({m:'delta',q:high,n:2147483647}):encode({m:'snapshot',w:high,t:index,id:last}),readCount:changes.length}
      }else if(mode==='delta'){
        if(!c || c.m!=='delta' || !Number.isSafeInteger(c.q)||c.q<0||c.q>watermark||!Number.isInteger(c.n)||c.n<0)throw new Error('INVALID_CURSOR: 增量需要有效完成游标')
        const high=c.w===undefined?watermark:c.w
        if(c.w!==undefined && high!==watermark)throw new Error('SYNC_RESTART_REQUIRED: 增量窗口期间有变更，请从原完成游标重试')
        if(high>watermark || high<c.q)throw new Error('INVALID_CURSOR: 增量水位错误')
        const effects=app.findRecordsByFilter('operation_effects','sequence <= {:high} && (sequence > {:q} || (sequence = {:q} && ordinal > {:n}))','sequence,ordinal,id',limit+1,0,{high,q:c.q,n:c.n})
        const page=effects.slice(0,limit)
        for(const f of page){const table=f.getString('tableName');if(tables.includes(table))changes.push(change(table,f.getString('recordId')))}
        const complete=effects.length<=limit,last=page[page.length-1]
        const next=complete?{m:'delta',q:high,n:2147483647}:{m:'delta',q:last.getInt('sequence'),n:last.getInt('ordinal'),w:high}
        result={protocol:1,generation:s.generation,owner:s.owner,schema:SCHEMA,watermark:high,mode,changes,complete,nextCursor:encode(next),readCount:page.length}
      }else throw new Error('INVALID_SYNC_MODE: snapshot或delta')
    });return e.json(200,result)
  }catch(err){return commands.error(e,err)}
}
