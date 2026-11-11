// 仅 PB 宿主 I/O。纯校验来自同一个 TS 核心；所有事实与回执共用 txApp。
const core = require(__hooks + '/command-core.js')
function col(table) { return table === 'moduleConfigs' ? 'module_configs' : table }
function find(app, table, id) {
  const rows = app.findRecordsByFilter(col(table), 'localId = {:id}', '', 1, 0, { id })
  return rows[0]
}
function rowOf(r) {
  if (!r) return undefined
  const value = JSON.parse(JSON.stringify(r.publicExport()))
  for(const field of core.JSON_FIELDS_BY_TABLE[r.collection().name==='module_configs'?'moduleConfigs':r.collection().name] || [])value[field]=core.decodePbJson(value[field])
  value.id = value.localId || value.id
  for (const k of ['localId', 'collectionId', 'collectionName', 'created', 'updated', 'server_received_at']) delete value[k]
  return value
}
function stateOf(app) { return app.findFirstRecordByFilter('command_state', 'id != ""') }
function owner(app, e) {
  if (!e.auth || e.auth.collection().name !== 'users') core.fail('UNAUTHORIZED', '需要个人账号身份')
  const identity = app.findRecordById('users', e.auth.id)
  const state = stateOf(app)
  if (!state.getString('ownerId') || identity.id !== state.getString('ownerId')) core.fail('FORBIDDEN', '仅拥有者可以访问业务命令')
  return state
}
function op(app, ownerId, requestId) {
  return app.findRecordsByFilter('operations', 'owner = {:owner} && requestId = {:request}', '', 1, 0, { owner: ownerId, request: requestId })[0]
}
function fingerprint(c) { return $security.sha256(core.stable(c.intent === undefined ? c : { intent: c.intent, generation: c.generation })) }
function error(e, err) {
  const message = String(err.message || err)
  const code = message.split(':')[0]
  const status = code === 'UNAUTHORIZED' ? 401 : code === 'FORBIDDEN' ? 403 : /CONFLICT|DELETED|GENERATION|RECOVERY|REUSED|INITIALIZED/.test(code) ? 409 : 400
  return e.json(status, { code, error: message })
}
exports.state = e => { try { const s = owner($app, e);require(__hooks+'/personal-auth.js').principal($app,e); return e.json(200, { generation: s.getString('generation'), protocol: 1 }) } catch (err) { return error(e, err) } }
exports.operation = e => {
  try {
    const state = owner($app, e)
    const body = e.requestInfo().body
    if (body.generation !== state.getString('generation')) core.fail('RECOVERY_REVIEW_REQUIRED', '恢复后请核对旧请求，不能自动重放')
    const currentActor=require(__hooks+'/personal-auth.js').principal($app,e)
    const existing = op($app, e.auth.id, body.requestId)
    if(existing && existing.getString('clientId') && existing.getString('clientId')!==currentActor.clientId)core.fail('FORBIDDEN','操作属于另一客户端')
    if (!existing) return e.json(200, { committed: false })
    if (body.intent !== undefined && existing.getString('fingerprint') !== fingerprint(body)) core.fail('REQUEST_REUSED', '相同请求标识带有不同参数')
    if (existing.getString('status') !== 'committed') return e.json(200, { committed: false, pending: core.decodePbJson(existing.get('plan')) })
    return e.json(200, { committed: true, receipt: require(__hooks+'/personal-auth.js').receipt(currentActor,core.decodePbJson(existing.get('result'))) })
  } catch (err) { return error(e, err) }
}
exports.apply = (app,e,c) => {
  core.checkCommand(c)
  const fp=fingerprint(c),planFp=$security.sha256(core.stable({writes:c.writes,reads:c.reads,scans:c.scans}))
  let receipt
      const state = owner(app, e)
      if (state.getString('generation') !== c.generation) core.fail('RECOVERY_REVIEW_REQUIRED', '数据世代已改变，先核对恢复点后的操作')
      const existing = op(app, e.auth.id, c.requestId)
      const currentActor=require(__hooks+'/personal-auth.js').principal(app,e)
      if(existing && existing.getString('clientId') && existing.getString('clientId')!==currentActor.clientId)core.fail('FORBIDDEN','操作属于另一客户端')
      for(const w of c.writes)if(!require(__hooks+'/personal-auth.js').can(currentActor,w.table,true))core.fail('FORBIDDEN','缺少写能力：'+w.table)
      if (existing) {
        if(existing.getString('status')==='cancelled')core.fail('CANCELLED','预览已撤回，请使用新请求')
        if (existing.getString('fingerprint') !== fp || existing.getString('planFingerprint') !== planFp) core.fail('REQUEST_REUSED', '同一请求标识不同参数')
        if (existing.getString('status') === 'committed') { receipt = require(__hooks+'/personal-auth.js').receipt(currentActor,core.decodePbJson(existing.get('result'))); return receipt }
      }
      const authorization=require(__hooks + '/personal-auth.js');const actor=authorization.principal(app,e)
      for(const w of c.writes){
        if(!authorization.can(actor,w.table,true))core.fail('FORBIDDEN','缺少写能力：'+w.table)
        if(w.table==='interactions'){
          const sourceActivity=c.writes.some(a=>a.table==='activities' && a.kind==='delete' && (()=>{const row=rowOf(find(app,'activities',a.id));return row?.sourceTable==='interactions' && row.sourceId===w.id})())
          if(c.kind!=='purge' || w.kind!=='delete' || !sourceActivity)core.fail('FROZEN_SOURCE','请经 activities 兼容命令录入')
        }
      }
      const cache = {}
      const get = (table, id) => {
        const key = table + '/' + id
        if (!(key in cache)) cache[key] = rowOf(find(app, table, id)) || null
        return cache[key] || undefined
      }
      for (const r of c.reads) {
        const current = get(r.table, r.id)
        if ((current ? Number(current.rev || 0) : null) !== r.rev) core.fail('VERSION_CONFLICT', r.table + '/' + r.id)
      }
      for (const scan of c.scans) {
        const scope = scan.scope ? core.scopeFilter(scan.table,scan.scope) : {filter:'',params:{}}
        const rows = app.findRecordsByFilter(col(scan.table), scope.filter, 'localId', scan.scope ? 1001 : 20001, 0, scope.params)
        const actual = rows.map(r => [r.getString('localId'), r.getInt('rev')]).sort((a,b) => a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)
        if (core.stable(actual) !== core.stable(scan.versions)) core.fail('VERSION_CONFLICT', '集合已变化：' + scan.table)
      }
      const before = {}
      for (const w of c.writes) {
        const key = w.table + '/' + w.id
        const prev = get(w.table, w.id)
        before[key] = prev || null
        const purged = app.findRecordsByFilter('deletion_registry', 'tableName = {:table} && recordId = {:id}', '', 1, 0, { table: w.table, id: w.id })[0]
        if (purged) core.fail('PERMANENTLY_DELETED', key)
        if(w.table==='activities')for(const identity of core.activityDeletionIdentities(w.id,w.value?.sourceTable==='interactions'?w.value.sourceId:undefined,s=>$security.sha256(s)))if(app.findRecordsByFilter('deletion_registry','tableName={:table} && recordId={:id}','',1,0,{table:identity.table,id:identity.id}).length)core.fail('PERMANENTLY_DELETED','旧沟通来源已清理：'+identity.id)
        if (w.kind === 'delete') {
          if (!prev || (!prev.deleted && c.kind !== 'purge')) core.fail('DELETE_REQUIRES_TOMBSTONE', key)
          cache[key] = null
        } else {
          const next = JSON.parse(JSON.stringify(w.value))
          next.rev = Number(prev?.rev || 0) + 1
          next.updatedAt = Date.now()
          cache[key] = next
        }
      }
      for (const w of c.writes) {
        if (w.kind !== 'put') continue
        const next = get(w.table, w.id)
        core.validateRecord(w.table, next, before[w.table + '/' + w.id] || undefined, get)
        if (w.table === 'ledgers' && before['ledgers/' + w.id]?.currency !== next.currency) {
          const txns = app.findRecordsByFilter('transactions', 'ledgerId = {:id}', '', 1, 0, { id: w.id })
          if (txns.length) core.fail('CURRENCY_CONFLICT', '有历史流水的账本不可更改币种')
        }
      }
      for (const w of c.writes) {
        if (w.kind !== 'delete' && !w.value?.deleted) continue
        const inbound = w.table==='customers'?[['todos','customerId'],['projects','customerId']]:w.table==='projects'?[['todos','projectId'],['notes','projectId'],['projectMilestones','projectId']]:w.table==='ledgers'?[['transactions','ledgerId']]:[]
        for(const [table,field] of inbound)for(const r of app.findRecordsByFilter(table,field+'={:id} && deleted!=1','',1001,0,{id:w.id})){
          const planned=get(table,r.getString('localId'));if(planned && !planned.deleted && planned[field]===w.id)core.fail('CASCADE_REQUIRED',table+'/'+r.getString('localId'))
        }
        const links = app.findRecordsByFilter('links', 'deleted != 1 && ((fromType = {:table} && fromId = {:id}) || (toType = {:table} && toId = {:id}))', '', 20001, 0, {table:w.table,id:w.id})
        if (links.length > 20000) core.fail('LIMIT_EXCEEDED', '删除关联超限')
        for (const link of links) {
          const after = get('links',link.getString('localId'))
          if (after && !after.deleted) core.fail('CASCADE_REQUIRED', '必须使用级联删除并解除关联')
        }
      }
      const operation = existing || new Record(app.findCollectionByNameOrId('operations'))
      if (!existing && c.operationId) { if(c.operationId !== $security.sha256(e.auth.id + '/' + c.requestId).slice(0,15))core.fail('INVALID_OPERATION_ID','操作身份');operation.set('id',c.operationId) }
      const principal = require(__hooks + '/personal-auth.js').principal(app,e)
      if(existing && existing.getString('clientId') && existing.getString('clientId')!==principal.clientId)core.fail('FORBIDDEN','操作属于另一客户端')
      operation.set('clientId',principal.clientId);operation.set('kind',c.kind || 'legacy');operation.set('updatedAt',Date.now())
      operation.set('owner', e.auth.id); operation.set('requestId', c.requestId); operation.set('fingerprint', fp)
      operation.set('planFingerprint', planFp); operation.set('generation', c.generation); operation.set('status', 'committed'); operation.set('committedAt', Date.now())
      const sequence = state.getInt('sequence') + 1
      state.set('sequence', sequence); app.save(state)
      operation.set('sequence', sequence)
      app.save(operation)
      const changes = []
      for (const w of c.writes) {
        const key = w.table + '/' + w.id
        const prev = before[key]
        const current = find(app, w.table, w.id)
        const next = get(w.table, w.id)
        if (w.kind === 'delete') {
          const identities=w.table==='activities'?core.activityDeletionIdentities(w.id,prev?.sourceTable==='interactions'?prev.sourceId:undefined,s=>$security.sha256(s)):[{table:w.table,id:w.id}]
          for(const identity of identities)if(!app.findRecordsByFilter('deletion_registry','tableName={:table} && recordId={:id}','',1,0,{table:identity.table,id:identity.id}).length){
            const mark = new Record(app.findCollectionByNameOrId('deletion_registry'))
            mark.set('tableName', identity.table); mark.set('recordId', identity.id); mark.set('generation', c.generation); mark.set('purgedAt', Date.now());app.save(mark)
          }
          app.delete(current)
          // 清理不留下正文在旧值或回执中，重试只返回已执行的最小结果。
          const history = app.findRecordsByFilter('operation_effects', '(tableName = {:table} && recordId = {:id})'+(w.table==='activities'?' || sourceScope={:id}':''), '', 20001, 0, { table: w.table, id: w.id })
          if(history.length>20000)core.fail('SOURCE_HISTORY_LIMIT','需先分批核对并清理来源历史')
          for (const old of history) {
            old.set('before', null); old.set('after', null); old.set('redacted', true); app.save(old)
            const parent = app.findRecordById('operations', old.getString('operationId'))
            const prior = JSON.parse(JSON.stringify(core.decodePbJson(parent.get('result'))))
            if (prior?.changes) for (const c of prior.changes) if (c.table === old.getString('tableName') && c.id === old.getString('recordId')) { c.row = null; c.redacted = true }
            if (prior) prior.result = { ok: true, data: { committed: true, redacted: true } }
            parent.set('result', prior); parent.set('plan', null); app.save(parent)
          }
        } else {
          const target = current || new Record(app.findCollectionByNameOrId(col(w.table)))
          if (!current) target.set('id', $security.sha256(w.id).slice(0, 15))
          const fields = target.collection().fields
          for (const k of Object.keys(next)) {
            if (k !== 'id' && k !== 'blob' && k !== 'stagedFileId' && !fields.getByName(k)) core.fail('UNKNOWN_FIELD', w.table + '/' + k)
          }
          // 完整替换明确清空可选字段；PB 默认空值由字段类型决定，JSON 不再双重编码。
          for (const field of fields) {
            const k = field.name
            if (['id', 'created', 'updated', 'server_received_at', 'localId', 'file'].includes(k)) continue
            target.set(k, next[k] === undefined ? null : next[k])
          }
          if (w.table === 'attachments' && next.stagedFileId) {
            const staged = app.findRecordById('attachment_staging', next.stagedFileId)
            if (staged.getString('owner') !== e.auth.id || staged.getInt('expiresAt') < Date.now()) core.fail('INVALID_ATTACHMENT_STAGE', w.id)
            target.set('file', $filesystem.fileFromPath(app.dataDir() + '/storage/' + staged.baseFilesPath() + '/' + staged.getString('file')))
          } else if (w.table === 'attachments' && !current) core.fail('ATTACHMENT_NOT_STAGED', w.id)
          target.set('localId', w.id); target.set('tombstonePushed', next.deleted ? 1 : 0)
          app.save(target)
        }
        const effect = new Record(app.findCollectionByNameOrId('operation_effects'))
        effect.set('operationId', operation.id); effect.set('tableName', w.table); effect.set('recordId', w.id)
        effect.set('beforeRev', prev?.rev || 0); effect.set('afterRev', next?.rev || 0)
        effect.set('action', w.kind === 'delete' ? 'purge' : !prev ? 'create' : next.deleted ? 'delete' : prev.deleted ? 'restore' : 'update')
        effect.set('sequence', sequence); effect.set('ordinal', changes.length); effect.set('sourceScope', w.sourceScope || c.requestId);effect.set('occurredAt',operation.getFloat('committedAt'))
        effect.set('before', w.kind === 'delete' ? null : prev); effect.set('after', next)
        app.save(effect)
        changes.push({ table: w.table, id: w.id, row: w.kind === 'delete' ? null : rowOf(find(app, w.table, w.id)) })
      }
      // 持久通知从实际变更推导，UI 与 Agent 同样写入；不接受请求自报奖励事件。
      const notifications = []
      for (const w of c.writes) {
        const prev = before[w.table + '/' + w.id], next = get(w.table, w.id)
        if (!next || next.deleted) continue
        if (w.table === 'transactions' && !prev) notifications.push({type:'transaction:created',payload:{transactionId:w.id}})
        if (w.table === 'activities' && !prev) for(const link of c.writes)if(link.table==='links' && link.value?.fromType==='activities' && link.value.fromId===w.id && link.value.toType==='customers')notifications.push({type:'customer:contacted',payload:{customerId:link.value.toId}})
        if (w.table === 'habitLogs' && (!prev || prev.deleted)) notifications.push({type:'habit:checked',payload:{habitId:next.habitId,date:next.date}})
      }
      for (const ev of notifications) {
        const notification = new Record(app.findCollectionByNameOrId('agent_events'))
        notification.set('type', ev.type); notification.set('payload', ev.payload); notification.set('tool', 'command'); notification.set('occurredAt', Date.now())
        app.save(notification)
      }
      receipt = { operationId: operation.id, requestId: c.requestId, generation: c.generation, sequence, changes, result: c.result || null }
      operation.set('result', receipt); operation.set('plan', null); app.save(operation)
      for(const target of c.writes.filter(w=>w.kind==='delete')){
        const pending=app.findRecordsByFilter('operations','status="awaiting_confirmation" && plan~{:id}','',5001,0,{id:target.id})
        if(pending.length>5000)core.fail('LIMIT_EXCEEDED','待清理预览过多，请缩小清理范围')
        for(const draft of pending){draft.set('plan',null);draft.set('status','cancelled');draft.set('updatedAt',Date.now());app.save(draft)}
      }
      return receipt
}
exports.commit = e => {
  try {let result;$app.runInTransaction(app=>{result=exports.apply(app,e,e.requestInfo().body)});return e.json(200,result)}catch(err){return error(e,err)}
}

exports.initialize = e => {
  try {
    if (!e.hasSuperuserAuth()) core.fail('FORBIDDEN', '首启只能通过宿主初始化通道')
    const input = e.requestInfo().body
    let userId
    $app.runInTransaction(app => {
      if (app.countRecords('users') !== 0) core.fail('ALREADY_INITIALIZED', '已完成初始化')
      const record = new Record(app.findCollectionByNameOrId('users'))
      record.set('email', input.email); record.set('password', input.password); record.set('passwordConfirm', input.password); record.set('verified', true); record.set('username', input.identity)
      app.save(record)
      const state = stateOf(app); state.set('ownerId', record.id); app.save(state); userId = record.id
    })
    return e.json(200, { ok: true, userId })
  } catch (err) { return error(e, err) }
}

exports.stageAttachment = e => {
  try {
    owner($app, e)
    if ($app.countRecords('attachment_staging') >= 128) core.fail('STAGING_LIMIT', '暂存附件已达上限，请等待清理后重试')
    const files = e.findUploadedFiles('file')
    if (files.length !== 1) core.fail('INVALID_ATTACHMENT', '请选择单个文件')
    const record = new Record($app.findCollectionByNameOrId('attachment_staging'))
    record.set('owner', e.auth.id); record.set('file', files[0]); record.set('expiresAt', Date.now() + 86400000)
    $app.save(record)
    return e.json(200, { stageId: record.id })
  } catch (err) { return error(e, err) }
}
exports.finance = e => {
  try {
    const state = owner($app, e)
    const d = e.requestInfo().body
    if (d.generation && d.generation !== state.getString('generation')) core.fail('RECOVERY_REVIEW_REQUIRED', '请重新查询')
    let result
    $app.runInTransaction(app => {
      const terms = ['deleted != 1'], params = {}
      for (const key of ['ledgerId', 'type', 'status']) if (d[key]) { terms.push(key + ' = {:' + key + '}'); params[key] = d[key] }
      for (const key of ['from', 'to']) if (d[key]) {
        const time = typeof d[key] === 'number' ? d[key] : Date.parse(d[key] + (key === 'from' ? 'T00:00:00+08:00' : 'T23:59:59.999+08:00'))
        if (!Number.isFinite(time)) core.fail('INVALID_DATE', key)
        terms.push('occurredAt ' + (key === 'from' ? '>=' : '<=') + ' {:' + key + '}'); params[key] = time
      }
      let rows = app.findRecordsByFilter('transactions', terms.join(' && '), '-occurredAt,localId', 20001, 0, params).map(rowOf)
      if (rows.length > 20000) core.fail('LIMIT_EXCEEDED', '当前统计窗口超过两万条，请缩小日期范围')
      if (d.customerId) {
        const links = app.findRecordsByFilter('links', 'deleted != 1 && kind = "related" && fromType = "transactions" && toType = "customers" && toId = {:id}', '', 20001, 0, {id:d.customerId})
        if (links.length > 20000) core.fail('LIMIT_EXCEEDED', '关联范围超限')
        const ids = {}; for (const link of links) ids[link.getString('fromId')] = true
        rows = rows.filter(r => ids[r.id])
      }
      const offset = Math.max(0, Number(d.offset || 0)), limit = Math.min(50, Math.max(1, Number(d.limit || 50)))
      const queryKey = $security.sha256(core.stable({from:d.from || null,to:d.to || null,ledgerId:d.ledgerId || null,customerId:d.customerId || null,type:d.type || null,status:d.status || null}))
      if (offset > 0 && (d.queryKey !== queryKey || d.sequence === undefined || !d.generation)) core.fail('QUERY_CONTEXT_REQUIRED', '续页必须绑定原筛选、世代与水位')
      const sequence = stateOf(app).getInt('sequence')
      if (d.sequence !== undefined && Number(d.sequence) !== sequence) core.fail('QUERY_REFRESH_REQUIRED', '数据已变化，请重新查询')
      result = { items: rows.slice(offset,offset+limit).map(r=>({id:r.id,ledgerId:r.ledgerId,summary:r.summary,type:r.type,amount:r.amount,amountMinor:r.amountMinor,currency:r.currency,amountUnit:'major',amountMinorUnit:'minor',occurredAt:r.occurredAt,status:r.status})), count: Math.min(limit,Math.max(0,rows.length-offset)), totalMatched:rows.length, totals:core.financeTotals(rows), truncated:rows.length>offset+limit, nextOffset:rows.length>offset+limit?offset+limit:null, generation:state.getString('generation'), sequence, queryKey }
    })
    return e.json(200,result)
  } catch (err) { return error(e,err) }
}

exports.preview = e => {
  try {
    const c = e.requestInfo().body; core.checkCommand(c)
    let result
    $app.runInTransaction(app => {
      const state = owner(app, e)
      if (state.getString('generation') !== c.generation) core.fail('RECOVERY_REVIEW_REQUIRED', '先核对恢复点')
      const previewActor=require(__hooks+'/personal-auth.js').principal(app,e)
      for(const w of c.writes)if(!require(__hooks+'/personal-auth.js').can(previewActor,w.table,true) || !require(__hooks+'/personal-auth.js').can(previewActor,w.table))core.fail('FORBIDDEN',w.table)
      const previous = op(app, e.auth.id, c.requestId)
      if(previous && previous.getString('clientId') && previous.getString('clientId')!==previewActor.clientId)core.fail('FORBIDDEN','客户端归属')
      const fp = fingerprint(c), planFp = $security.sha256(core.stable({writes:c.writes,reads:c.reads,scans:c.scans}))
      if (previous) {
        if(previous.getString('status')==='cancelled')core.fail('CANCELLED','预览已撤回')
        if (previous.getString('fingerprint') !== fp || previous.getString('planFingerprint') !== planFp) core.fail('REQUEST_REUSED', '请求已绑定另一份预览计划')
        result = core.decodePbJson(previous.get('plan')); return
      }
      for (const r of c.reads) {
        const current = rowOf(find(app, r.table, r.id))
        if ((current ? Number(current.rev || 0) : null) !== r.rev) core.fail('VERSION_CONFLICT', r.table + '/' + r.id)
      }
      const record = new Record(app.findCollectionByNameOrId('operations'))
      record.set('owner',e.auth.id);record.set('requestId',c.requestId);record.set('fingerprint',fp);record.set('planFingerprint',planFp);record.set('generation',c.generation)
      record.set('status','awaiting_confirmation');record.set('clientId',previewActor.clientId);record.set('updatedAt',Date.now());record.set('plan',c);app.save(record);state.set('sequence',state.getInt('sequence')+1);app.save(state);result=c
    })
    return e.json(200,result)
  } catch(err) { return error(e,err) }
}

exports.cleanupStaging = () => {
  const rows = $app.findRecordsByFilter('attachment_staging','expiresAt < {:now}','',500,0,{now:Date.now()})
  for (const row of rows) $app.delete(row)
}

exports.owner=owner;exports.find=find;exports.rowOf=rowOf;exports.stateOf=stateOf;exports.error=error;exports.op=op;exports.fingerprint=fingerprint

exports.json=core.decodePbJson
