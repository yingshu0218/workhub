const core=require(__hooks+'/personal-core.js'),commands=require(__hooks+'/commands.js'),auth=require(__hooks+'/personal-auth.js'),scopes=require(__hooks+'/command-core.js')
// 列表直接投影 SQLite 列，避免为一页结果跨 JSVM 复制上万份原话/正文与完整 Record。
const shapes={
  activities:{id:'',rev:0,deleted:0,title:'',summary:'',occurredAt:0,occurredUntil:0,timePrecision:'',timeZone:'',recordedAt:0,category:'',tags:'[]',sourceOperationId:'',sourceTable:'',sourceId:''},
  transactions:{id:'',rev:0,deleted:0,summary:'',amountMinor:0,currency:'',type:'',status:'',occurredAt:0,ledgerId:''},
  todos:{id:'',rev:0,deleted:0,title:'',status:'',dueAt:0,completedAt:0,voidedAt:0,priority:'',customerId:'',projectId:'',createdAt:0},
  customers:{id:'',rev:0,deleted:0,name:'',aliases:'[]',preferredName:'',contactType:'',company:'',lastContactAt:0,tags:'[]',email:'',phone:'',wechat:''},
  projects:{id:'',rev:0,deleted:0,name:'',aliases:'[]',status:''},
  links:{id:'',rev:0,deleted:0,fromType:'',fromId:'',toType:'',toId:'',kind:'',meta:'{}'},
  operations:{id:'',owner:'',clientId:'',requestId:'',generation:'',status:'',kind:'',sequence:0,committedAt:0,updatedAt:0},
}
exports.scoped=e=>{try{const h=host($app,e),d=e.requestInfo().body;if(!h.can(d.table))throw new Error('FORBIDDEN: '+d.table);const items=h.select(d.table,{...d.scope,limit:1001});if(items.length>1000)throw new Error('LIMIT_EXCEEDED: 范围超过一千条');return e.json(200,{items})}catch(err){return commands.error(e,err)}}
function host(app,e){
  commands.owner(app,e);const principal=auth.principal(app,e),cache={}
  const get=(table,id)=>{
    const k=table+'/'+id
    if(!(k in cache)){
      if(['operations','operation_effects'].includes(table)){try{cache[k]=commands.rowOf(app.findRecordById(table,id))}catch(_){cache[k]=null}}
      else cache[k]=commands.rowOf(commands.find(app,table,id)) || null
    }
    return cache[k] || undefined
  }
  const select=(table,q)=>{
    if(!['activities','customers','projects','projectMilestones','todos','transactions','notes','links','operations','operation_effects'].includes(table))throw new Error('INVALID_QUERY: '+table)
    if(q.ids && !q.ids.length)return []
    if(q.ids?.length>400 && !q.projection){
      const all=[];for(let at=0;at<q.ids.length;at+=400)all.push(...select(table,{...q,ids:q.ids.slice(at,at+400),offset:0,limit:20001}))
      const sort=q.sort || 'localId';all.sort((a,b)=>{for(const order of sort.split(',')){const desc=order[0]==='-',key=order.replace(/^-/,''),field=key==='localId'?'id':key,av=a[field],bv=b[field];if(av!==bv)return (av<bv?-1:1)*(desc?-1:1)}return 0});return all.slice(q.offset || 0,(q.offset || 0)+(q.limit || 50))
    }
    let filter='',params={}
    if(q.where && Object.keys(q.where).length || q.anyOf?.length){const s=scopes.scopeFilter(table,q);filter=s.filter;params=s.params}
    const terms=filter?[filter]:[]
    if(q.ids){if(q.ids.length>20000)throw new Error('LIMIT_EXCEEDED: 身份范围');const field=q.idField==='recordId'?'recordId':'localId';if(q.projection){params.selectedIds=JSON.stringify(q.ids);terms.push(field+' IN (SELECT value FROM json_each({:selectedIds}))')}else terms.push('('+q.ids.map((id,i)=>{params['id'+i]=id;return field+'={:id'+i+'}'}).join(' || ')+')')}
    if(q.excludeIds?.length){if(q.excludeIds.length>20000 || !q.projection)throw new Error('LIMIT_EXCEEDED: 排除范围');params.excludedIds=JSON.stringify(q.excludeIds);terms.push('localId NOT IN (SELECT value FROM json_each({:excludedIds}))')}
    if(q.timeField){if(!['occurredAt','committedAt','dueAt'].includes(q.timeField))throw new Error('INVALID_QUERY: timeField');for(const bound of ['from','to'])if(q[bound]!==undefined){terms.push(q.timeField+(bound==='from'?'>=':'<=')+'{:'+bound+'}');params[bound]=q[bound]}}
    if(q.q){const fields=table==='activities'?['title','summary']:table==='transactions'?['summary']:table==='todos'?['title']:['name'];terms.push('('+fields.map(field=>q.projection?'instr(lower('+field+'),lower({:q}))>0':field+'~{:q}').join(' || ')+')');params.q=q.q}
    const sort=q.sort || (['operations','operation_effects'].includes(table)?'id':'localId')
    if(!/^[-\w,]+$/.test(sort) || sort.split(',').some(k=>!['id','localId','occurredAt','committedAt','dueAt','sequence','ordinal','name','updatedAt'].includes(k.replace(/^-/,''))))throw new Error('INVALID_QUERY: sort')
    const limit=Math.min(20001,Math.max(1,Number(q.limit || 50))),offset=Math.max(0,Number(q.offset || 0))
    if(q.projection && shapes[table]){
      const totals=q.projection==='totals'&&table==='transactions',shape=totals?{currency:'',incomeMinor:0,expenseMinor:0,count:0}:q.projection==='identity'?{id:'',occurredAt:0}:q.projection==='edge'?{fromId:'',toId:''}:shapes[table],fields=Object.keys(shape)
      const columns=totals?'currency,SUM(CASE WHEN type=\'income\' THEN amountMinor ELSE 0 END) AS incomeMinor,SUM(CASE WHEN type=\'expense\' THEN amountMinor ELSE 0 END) AS expenseMinor,COUNT(*) AS count':fields.map(k=>{if(k==='id')return (table==='operations'?'id':'localId')+' AS id';params['default_'+k]=shape[k];const value='COALESCE("'+k+'",{:default_'+k+'})';return (k==='summary'?'substr('+value+',1,501)':value)+' AS "'+k+'"'}).join(',')
      const source=' FROM "'+table+'"'+(terms.length?' WHERE '+terms.join(' AND ').replace(/&&/g,' AND ').replace(/\|\|/g,' OR '):'')
      const sql=q.projection==='grouped'&&table==='activities'?'SELECT DISTINCT toId AS id FROM links WHERE fromType=\'activities\' AND toType=\'transactions\' AND deleted=0 AND fromId IN (SELECT localId'+source+') ORDER BY toId LIMIT '+limit:'SELECT '+columns+source+(totals?' GROUP BY currency ORDER BY currency':' ORDER BY '+sort.split(',').map(k=>'"'+k.replace(/^-/,'')+'" '+(k[0]==='-'?'DESC':'ASC')).join(','))+' LIMIT '+limit+' OFFSET '+offset
      const rows=arrayOf(new DynamicModel(q.projection==='grouped'?{id:''}:shape));app.db().newQuery(sql).bind(params).all(rows)
      return JSON.parse(JSON.stringify(rows)).map(row=>{for(const field of scopes.JSON_FIELDS_BY_TABLE[table] || [])if(field in row)row[field]=scopes.decodePbJson(row[field]);return row})
    }
    return app.findRecordsByFilter(table,terms.join(' && '),sort,limit,offset,params).map(r=>commands.rowOf(r))
  }
  return {get,select,groupedFinance:q=>select('activities',{...q,projection:'grouped',limit:20001}).map(r=>r.id),hash:s=>$security.sha256(s),now:Date.now(),owner:principal.owner,client:principal.clientId,can:(table,write)=>auth.can(principal,table,write),principal}
}
function context(app,e,d,name){
  const h=host(app,e),state=commands.stateOf(app),generation=state.getString('generation'),watermark=state.getInt('sequence')
  if(d.generation && d.generation!==generation)throw new Error('RECOVERY_REVIEW_REQUIRED: 数据世代已改变')
  for(const key of ['limit','bodyLimit','sourceLimit','bodyOffset','sourceOffset','revision','depth'])if(d[key]!==undefined && (!Number.isSafeInteger(d[key]) || d[key]<(key.endsWith('Offset') || key==='revision'?0:1) || d[key]>(key==='limit'?50:key.endsWith('Limit')?4000:key==='depth'?2:10000000)))throw new Error('INVALID_QUERY: '+key)
  if((d.bodyOffset>0 || d.sourceOffset>0) && (!d.generation || d.revision===undefined))throw new Error('QUERY_CONTEXT_REQUIRED: 正文续读需要原世代与版本')
  if(d.from!==undefined && d.to!==undefined && core.parseTime(d.from,d.timeZone)>core.rangeEnd(d.to,d.timeZone))throw new Error('INVALID_DATE_RANGE: 开始晚于结束')
  let seedCursor
  if(d.cursor){try{seedCursor=JSON.parse(d.cursor)}catch(_){throw new Error('INVALID_CURSOR: 重新查询')}}
  const asOf=seedCursor?.a || h.now
  if(!Number.isSafeInteger(asOf) || asOf<=0)throw new Error('INVALID_CURSOR: 时间截止点')
  h.now=asOf;d.timeZone=d.timeZone || 'Asia/Shanghai';d.referenceAt=d.referenceAt || asOf
  const scope={...d};delete scope.cursor;delete scope.generation
  const queryKey=$security.sha256(core.stable({name,scope,client:h.client,capabilities:h.principal.capabilities}))
  let offset=0
  if(d.cursor){let cursor;try{cursor=JSON.parse(d.cursor)}catch(_){throw new Error('INVALID_CURSOR: 重新查询')}
    if(cursor.g!==generation)throw new Error('RECOVERY_REVIEW_REQUIRED: 游标世代已过期')
    if(cursor.k!==queryKey || cursor.c!==h.client)throw new Error('QUERY_CONTEXT_REQUIRED: 游标不属于当前筛选或客户端')
    if(cursor.w!==watermark)throw new Error('QUERY_REFRESH_REQUIRED: 数据已变化，请刷新')
    offset=cursor.o
  }
  if(!Number.isSafeInteger(offset) || offset<0 || offset>20000)throw new Error('LIMIT_EXCEEDED: 缩小日期范围')
  const limit=Math.min(50,Math.max(1,Number(d.limit || 20)))
  const envelope=(items,hasMore,extra={})=>({items,count:items.length,truncated:!!hasMore,nextCursor:hasMore?JSON.stringify({g:generation,w:watermark,k:queryKey,c:h.client,o:offset+items.length,a:asOf}):null,scope,generation,watermark,queryKey,asOf,...extra})
  return {h,offset,limit,envelope}
}
function relatedRows(h,table,id){
  return core.personalLinks(h,table,id).map(l=>{const r=core.otherEndpoint(l,table,id),target=h.can(r.table)?h.get(r.table,r.id):null;return target&&!target.deleted?{...core.projectRecord(h,r.table,target),kind:l.kind,evidence:l.meta?.sourceActivityId&&h.can('activities')?{activityId:l.meta.sourceActivityId}:null}:null}).filter(Boolean)
}
function historyRows(h,table,id){
  if(!h.can('operation'))return []
  const rows=h.select('operation_effects',{where:{tableName:table,recordId:id},sort:'-sequence,id',limit:20001})
  if(rows.length>20000)throw new Error('LIMIT_EXCEEDED: 历史超过两万条')
  return rows.map(x=>({operationId:x.operationId,path:core.recordPath('operations',x.operationId),action:x.action,beforeRev:x.beforeRev,afterRev:x.afterRev,occurredAt:x.occurredAt,redacted:!!x.redacted}))
}
function expanded(h,table,row,d){
  const record=core.projectRecord(h,table,row)
  if(d.revision!==undefined && d.revision!==row.rev)throw new Error('QUERY_REFRESH_REQUIRED: 记录已变化')
  const allowed={activities:['summary'],todos:['desc'],transactions:['note'],customers:['phone','email','wechat','address','company','title'],notes:['markdown'],projects:['note']}
  const fields=d.fields || (d.list || table==='notes'?[]:allowed[table] || [])
  if(!Array.isArray(fields) || fields.length>10 || fields.some(f=>!(allowed[table] || []).includes(f)))throw new Error('INVALID_FIELDS: 详情字段不在白名单')
  record.details={}
  for(const field of fields){const value=String(row[field] || ''),offset=d.bodyOffset || 0,limit=d.bodyLimit || 2000;record.details[field]={text:value.slice(offset,offset+limit),offset,nextOffset:value.length>offset+limit?offset+limit:null,truncated:value.length>offset+limit,revision:row.rev}}
  if(table==='activities')record.summaryTruncated=String(row.summary || '').length>500
  if(table==='activities' && auth.source(h.principal) && d.includeSource){const offset=Math.max(0,Number(d.sourceOffset || 0)),value=String(row.sourceText || ''),limit=Math.min(4000,Math.max(1,Number(d.sourceLimit || 2000)));record.source={text:value.slice(offset,offset+limit),offset,truncated:value.length>offset+limit,nextOffset:value.length>offset+limit?offset+limit:null,revision:row.rev}}
  const ls=relatedRows(h,table,row.id)
  record.related=ls.slice(0,50);record.relatedTruncated=ls.length>50
  if(ls.length>50)record.relatedQuery={name:'get_record',input:{table,id:row.id,view:'relations'}}
  if(h.can('operation')){const effects=h.select('operation_effects',{where:{tableName:table,recordId:row.id},sort:'-sequence,id',limit:11});record.history={items:effects.slice(0,10).map(x=>({operationId:x.operationId,path:core.recordPath('operations',x.operationId),action:x.action,beforeRev:x.beforeRev,afterRev:x.afterRev,occurredAt:x.occurredAt,redacted:!!x.redacted})),truncated:effects.length>10,query:{name:'get_record',input:{table,id:row.id,view:'history'}}}}
  return record
}
exports.query=e=>{
  try{const body=e.requestInfo().body,d=body.input || {},name=body.name;let result
    $app.runInTransaction(app=>{
      const {h,offset,limit,envelope}=context(app,e,d,name)
      if(name==='resolve_contacts' || name==='resolve_topics'){result=envelope([],false,core.resolvePersonal(h,name==='resolve_contacts'?'customers':'projects',d));return}
      if(name==='search_activities'){const all=core.eventFeed(h,d,offset+limit+1);result=envelope(all.slice(offset,offset+limit),all.length>offset+limit);return}
      if(name==='get_activity' || name==='get_record'){
        const table=name==='get_activity'?'activities':String(d.table);if(!h.can(table))throw new Error('FORBIDDEN: '+table)
        let row=h.get(table,String(d.id))
        if(!row && table==='activities'){const rows=h.select('activities',{where:{sourceTable:'interactions',sourceId:String(d.id)},limit:1});row=rows[0]}
        if(!row || row.deleted)throw new Error('NOT_FOUND: '+table+'/'+d.id)
        if(d.view==='relations' || d.view==='history'){
          const all=d.view==='relations'?relatedRows(h,table,row.id):historyRows(h,table,row.id)
          result=envelope(all.slice(offset,offset+limit),all.length>offset+limit);return
        }
        const r=expanded(h,table,row,d)
        result=envelope([r],false);return
      }
      if(name==='query_tasks'){const rows=core.taskRows(h,d);result=envelope(rows.slice(offset,offset+limit).map(r=>core.projectRecord(h,'todos',r)),rows.length>offset+limit,{totalMatched:rows.length});return}
      if(name==='query_finance'){
        const selection=core.financeSelection(h,d),groups=h.select('transactions',{...selection,projection:'totals',limit:4}),totals={};let count=0
        for(const group of groups){if(!Number.isSafeInteger(group.incomeMinor)||!Number.isSafeInteger(group.expenseMinor))throw new Error('MONEY_RANGE: 汇总超出安全整数范围');const validated=core.financeTotals([{id:group.currency+':income',currency:group.currency,type:'income',amountMinor:group.incomeMinor},{id:group.currency+':expense',currency:group.currency,type:'expense',amountMinor:group.expenseMinor}]);totals[group.currency]={...validated[group.currency],count:group.count};count+=group.count}
        if(count>20000)throw new Error('LIMIT_EXCEEDED: 请缩小财务范围')
        const rows=h.select('transactions',{...selection,limit,offset});result=envelope(rows.map(r=>core.projectRecord(h,'transactions',r)),count>offset+limit,{totalMatched:count,totals,amountUnit:'minor',reconciliation:d.status || 'all'});return
      }
      if(name==='get_contact_context'){
        if(!h.can('customers'))throw new Error('FORBIDDEN: customers')
        const contact=h.get('customers',String(d.id));if(!contact || contact.deleted)throw new Error('NOT_FOUND: 联系人')
        const activities=h.can('activities')?core.eventFeed(h,{contactId:d.id,sourceType:'activity'},11):[]
        const tasks=h.can('todos')?core.taskRows(h,{contactId:d.id}):[]
        const finance=h.can('transactions')?core.financeRows(h,{contactId:d.id,from:d.from,to:d.to}):null
        result=envelope([core.projectRecord(h,'customers',contact)],false,{recent:{items:activities.slice(0,10),truncated:activities.length>10},commitments:{items:tasks.slice(0,10).map(r=>core.projectRecord(h,'todos',r)),truncated:tasks.length>10},finance:finance?{totals:core.financeTotals(finance),totalMatched:finance.length,scope:{contactId:d.id,from:d.from || null,to:d.to || null}}:{restricted:true}});return
      }
      if(name==='get_operation' || name==='list_operations'){
        if(!h.can('operation'))throw new Error('FORBIDDEN: operation')
        const rows=name==='get_operation'?[d.operationId?h.get('operations',String(d.operationId)):commands.rowOf(commands.op(app,h.owner,String(d.requestId)))].filter(Boolean):h.select('operations',{where:{owner:h.owner,...(h.client!=='owner'?{clientId:h.client}:{}),...(d.status?{status:String(d.status)}:{})},sort:d.status==='awaiting_confirmation'?'-updatedAt,id':'-committedAt,id',projection:'list',limit:limit+1,offset})
        if(name==='get_operation'&&!rows.length)throw new Error('NOT_FOUND: operation')
        if(name==='get_operation'&&d.view==='effects'){
          const r=rows[0];if(r.owner!==h.owner || h.client!=='owner' && r.clientId && r.clientId!==h.client)throw new Error('FORBIDDEN: operation')
          const effects=h.select('operation_effects',{where:{operationId:r.id},sort:'sequence,ordinal',limit:501}).filter(x=>h.can(x.tableName))
          result=envelope(effects.slice(offset,offset+limit).map(x=>({id:x.id,table:x.tableName,recordId:x.recordId,beforeRev:x.beforeRev,afterRev:x.afterRev,action:x.action,redacted:!!x.redacted,path:core.recordPath(x.tableName,x.recordId)})),effects.length>offset+limit);return
        }
        if(name==='list_operations'){result=envelope(rows.slice(0,limit).map(r=>({id:r.id,path:core.recordPath('operations',r.id),requestId:r.requestId,status:r.status,kind:r.kind,generation:r.generation,watermark:r.sequence,committedAt:r.committedAt,updatedAt:r.updatedAt,detailsQuery:{name:'get_operation',input:{operationId:r.id}}})),rows.length>limit);return}
        result=envelope(rows.slice(0,limit).map(r=>{
          if(r.owner!==h.owner || h.client!=='owner' && r.clientId && r.clientId!==h.client)throw new Error('FORBIDDEN: operation')
          const effects=h.select('operation_effects',{where:{operationId:r.id},sort:'sequence,ordinal',limit:501}).filter(x=>h.can(x.tableName))
          const effectRows=effects.map(x=>({id:x.id,table:x.tableName,recordId:x.recordId,beforeRev:x.beforeRev,afterRev:x.afterRev,action:x.action,redacted:!!x.redacted,path:core.recordPath(x.tableName,x.recordId)}))
          const receipt=auth.receipt(h.principal,r.result)
          if(receipt){receipt.changesTruncated=(receipt.changes || []).length>100;receipt.changes=(receipt.changes || []).slice(0,100).map(c=>({table:c.table,id:c.id,redacted:c.redacted || false,record:c.row?core.projectRecord(h,c.table,c.row):null}));receipt.result={committed:true,redacted:effects.some(x=>x.redacted)}}
          return {id:r.id,path:core.recordPath('operations',r.id),requestId:r.requestId,status:r.status,kind:r.kind,generation:r.generation,watermark:r.sequence,committedAt:r.committedAt,updatedAt:r.updatedAt,receipt,effects:effectRows.slice(0,50),effectsTruncated:effects.length>50,effectsQuery:{name:'get_operation',input:{operationId:r.id,view:'effects'}}}
        }),rows.length>limit);return
      }
      if(name==='query_graph'){
        const root={table:String(d.table || 'activities'),id:String(d.id)},depth=Math.min(2,Math.max(1,Number(d.depth || 1))),nodes=new Map(),edges=new Map(),queue=[{...root,level:0}],seen=new Set();let truncated=false
        const from=d.from===undefined?undefined:core.parseTime(d.from,d.timeZone),to=d.to===undefined?undefined:core.rangeEnd(d.to,d.timeZone)
        const inTime=(table,row)=>{if(from===undefined&&to===undefined)return true;if(['customers','projects','ledgers'].includes(table))return true;const at=Number(row.occurredAt || row.createdAt || 0);return at>0&&(from===undefined || at>=from)&&(to===undefined || at<=to)}
        while(queue.length){const item=queue.shift(),key=item.table+':'+item.id;if(seen.has(key))continue;seen.add(key);if(!h.can(item.table))continue
          const row=h.get(item.table,item.id);if(!row || row.deleted || !inTime(item.table,row))continue;if(nodes.size>=100 && !nodes.has(key)){truncated=true;break}nodes.set(key,{key,...core.projectRecord(h,item.table,row)})
          if(item.level>=depth)continue
          const ls=h.select('links',{where:{deleted:0},...{anyOf:[{fromType:item.table,fromId:item.id},{toType:item.table,toId:item.id}]},projection:'link',limit:202}).filter(l=>!l.deleted)
          if(ls.length>200)truncated=true
          for(const l of ls.slice(0,200)){const target=core.otherEndpoint(l,item.table,item.id),tr=h.get(target.table,target.id);if(!h.can(target.table)||!tr||tr.deleted||!inTime(target.table,tr))continue
            if(edges.size>=200){truncated=true;break}const tk=target.table+':'+target.id
            const types=[l.fromType,l.toType],semantic=l.kind==='relation'?'explicit_relationship':types.includes('transactions')?'financial_association':types.includes('activities')&&types.includes('customers')?'event_participation':types.includes('activities')&&types.includes('todos')?'commitment_source':l.kind==='member'?'membership':'record_association'
            edges.set(l.id,{id:l.id,from:String(l.fromType)+':'+l.fromId,to:String(l.toType)+':'+l.toId,kind:l.kind,semantic,label:l.meta?.label || '',evidence:l.meta?.sourceActivityId&&h.can('activities')?{activityId:l.meta.sourceActivityId,path:core.recordPath('activities',l.meta.sourceActivityId)}:{kind:'legacy_or_unspecified'}})
            queue.push({...target,level:item.level+1});if(!nodes.has(tk)&&nodes.size<100)nodes.set(tk,{key:tk,...core.projectRecord(h,target.table,tr)})
          }
        }
        result=envelope([...nodes.values()],false,{truncated,edges:[...edges.values()].filter(edge=>nodes.has(edge.from)&&nodes.has(edge.to)),limits:{nodes:100,edges:200,depth},continuation:truncated?{kind:'focus_node',tool:'query_graph',fields:['table','id'],depth:1,note:'使用返回节点的 table/id 聚焦，或缩小日期范围'}:null});return
      }
      throw new Error('UNKNOWN_QUERY: '+name)
    });return e.json(200,result)
  }catch(err){return commands.error(e,err)}
}
exports.preview=e=>{
  try{const d=e.requestInfo().body;let result
    $app.runInTransaction(app=>{
      const h=host(app,e),state=commands.stateOf(app)
      if(d.generation!==state.getString('generation'))throw new Error('RECOVERY_REVIEW_REQUIRED: 使用原世代核对')
      const intent={kind:d.kind,input:d.input},fp=commands.fingerprint({intent,generation:d.generation}),prior=commands.op(app,h.owner,d.requestId)
      if(prior){if(prior.getString('fingerprint')!==fp || prior.getString('clientId')!==h.client)throw new Error('REQUEST_REUSED: 请求绑定其他意图或客户端');if(prior.getString('status')==='committed'){result={committed:true,receipt:auth.receipt(h.principal,commands.json(prior.get('result')))};return}if(prior.getString('status')!=='awaiting_confirmation')throw new Error('CANCELLED: 重新确认新请求');result=previewOf(prior,h);return}
      const plan=core.planPersonal(h,d.kind,d.input,d.generation,d.requestId)
      const operation=new Record(app.findCollectionByNameOrId('operations'));operation.set('id',plan.operationId)
      operation.set('owner',h.owner);operation.set('clientId',h.client);operation.set('requestId',d.requestId);operation.set('generation',d.generation);operation.set('fingerprint',fp);operation.set('kind',d.kind);operation.set('status','awaiting_confirmation');operation.set('plan',plan);operation.set('planFingerprint',$security.sha256(core.stable({writes:plan.writes,reads:plan.reads,scans:plan.scans})));operation.set('updatedAt',Date.now());app.save(operation)
      state.set('sequence',state.getInt('sequence')+1);app.save(state);result=previewOf(operation,h)
    });return e.json(200,result)
  }catch(err){return commands.error(e,err)}
}
function previewOf(operation,h){const plan=commands.json(operation.get('plan'));return {preview:true,previewId:operation.id,requestId:operation.getString('requestId'),generation:operation.getString('generation'),planFingerprint:operation.getString('planFingerprint'),kind:operation.getString('kind'),risk:['undo','purge','delete','merge'].includes(operation.getString('kind'))?'high':'medium',changes:plan.writes.map(w=>({table:w.table,id:w.id,action:w.kind,before:plan.reads.find(r=>r.table===w.table&&r.id===w.id)?.rev,after:w.kind==='put'?core.projectRecord(h,w.table,w.value):null})),result:plan.result}}
exports.commit=e=>{
  try{const d=e.requestInfo().body;let result
    $app.runInTransaction(app=>{
      const h=host(app,e),state=commands.stateOf(app)
      if(d.generation!==state.getString('generation'))throw new Error('RECOVERY_REVIEW_REQUIRED: 世代已改变')
      const operation=commands.op(app,h.owner,d.requestId)
      if(!operation || operation.id!==d.previewId || operation.getString('clientId')!==h.client)throw new Error('PREVIEW_REQUIRED: 预览与身份不匹配')
      if(operation.getString('status')==='committed'){result=auth.receipt(h.principal,commands.json(operation.get('result')));return}
      // 由宿主 relay 核销后在受保护头传入；网页必须使用拥有者会话并显式确认相同计划。
      const proof=e.request.header.get('X-Workhub-Plan') || ''
      if(proof!==operation.getString('planFingerprint'))throw new Error('CONFIRMATION_REQUIRED: 确认未绑定计划')
      const plan=commands.json(operation.get('plan'));if(!plan)throw new Error('CANCELLED: 计划已清理')
      result=commands.apply(app,e,plan)
      result=auth.receipt(h.principal,result)
    });return e.json(200,result)
  }catch(err){return commands.error(e,err)}
}
exports.agents=e=>{
  try{const principal=auth.principal($app,e);if(principal.clientId!=='owner')throw new Error('FORBIDDEN: 凭据管理只允许拥有者会话')
    const d=e.requestInfo().body
    if(d.action==='list')return e.json(200,{items:$app.findRecordsByFilter('agent_credentials','owner={:owner}','',100,0,{owner:e.auth.id}).map(r=>({id:r.id,name:r.getString('name'),capabilities:commands.json(r.get('capabilities')),createdAt:r.getFloat('createdAt'),revokedAt:r.getFloat('revokedAt'),expiresAt:r.getFloat('expiresAt')}))})
    if(d.action==='issue'){
      if(typeof d.name!=='string'||!d.name.trim()||d.name.length>80||!Array.isArray(d.capabilities)||!d.capabilities.length||d.capabilities.some(c=>!auth.capabilities.includes(c)))throw new Error('INVALID_CREDENTIAL: 名称或能力非法')
      const token='wh_'+$security.randomString(48),r=new Record($app.findCollectionByNameOrId('agent_credentials'));r.set('owner',e.auth.id);r.set('generation',commands.stateOf($app).getString('generation'));r.set('name',d.name);r.set('capabilities',[...new Set(d.capabilities)]);r.set('tokenHash',$security.sha256(token));r.set('createdAt',Date.now());r.set('expiresAt',d.expiresAt || 0);$app.save(r)
      return e.json(200,{id:r.id,name:d.name,token,capabilities:d.capabilities,note:'凭据只显示一次；服务端仅保存散列'})
    }
    if(d.action==='revoke'){const r=$app.findRecordById('agent_credentials',d.id);if(r.getString('owner')!==e.auth.id)throw new Error('FORBIDDEN: 凭据');r.set('revokedAt',Date.now());$app.save(r);return e.json(200,{revoked:true,id:r.id})}
    throw new Error('INVALID_ACTION: issue/list/revoke')
  }catch(err){return commands.error(e,err)}
}
exports.verify=e=>{
  try{commands.owner($app,e);const d=e.requestInfo().body
    if(!d.token){const state=commands.stateOf($app);if(state.getString('sharedTokenGeneration')!==state.getString('generation') || !state.getFloat('sharedTokenUntil')||Date.now()>state.getFloat('sharedTokenUntil'))throw new Error('UNAUTHORIZED: 共享 token 过渡期已结束');return e.json(200,{clientId:'shared-transition',capabilities:['*'],transitionUntil:state.getFloat('sharedTokenUntil')})}
    const principal=auth.principal($app,{auth:e.auth,request:{header:{get:name=>name==='X-Workhub-Agent-Key'?d.token:''}}})
    return e.json(200,{clientId:principal.clientId,capabilities:principal.capabilities})
  }catch(err){return commands.error(e,err)}
}
exports.cancel=e=>{
  try{const d=e.requestInfo().body;let result
    $app.runInTransaction(app=>{const h=host(app,e),state=commands.stateOf(app);if(d.generation!==state.getString('generation'))throw new Error('RECOVERY_REVIEW_REQUIRED: 世代已改变')
      const op=commands.op(app,h.owner,d.requestId);if(!op || h.client!=='owner'&&op.getString('clientId')!==h.client)throw new Error('FORBIDDEN: 操作归属')
      if(op.getString('status')==='committed')throw new Error('ALREADY_COMMITTED: 已提交，请使用撤销预览')
      op.set('status','cancelled');op.set('plan',null);op.set('updatedAt',Date.now());app.save(op);state.set('sequence',state.getInt('sequence')+1);app.save(state);result={id:op.id,status:'cancelled',generation:d.generation,watermark:state.getInt('sequence')}
    });return e.json(200,result)
  }catch(err){return commands.error(e,err)}
}
exports.cleanupPending=()=>{$app.runInTransaction(app=>{const rows=app.findRecordsByFilter('operations','status="awaiting_confirmation" && updatedAt < {:cutoff}','',500,0,{cutoff:Date.now()-7*86400000});for(const row of rows){row.set('status','cancelled');row.set('plan',null);row.set('updatedAt',Date.now());app.save(row)}if(rows.length){const state=commands.stateOf(app);state.set('sequence',state.getInt('sequence')+1);app.save(state)}})}
