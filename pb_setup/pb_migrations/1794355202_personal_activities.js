// canonical ID 与 JSON 宿主转换随迁移冻结。
const migrationIds=(()=>{const module={exports:{}};
"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// <stdin>
var stdin_exports = {};
__export(stdin_exports, {
  buildLinkId: () => buildLinkId,
  canonicalEndpoints: () => canonicalEndpoints,
  decodePbJson: () => decodePbJson,
  legacyActivityId: () => legacyActivityId
});
module.exports = __toCommonJS(stdin_exports);

// src/sync/remoteNormalize.ts
function sha256ToBase36_15(input) {
  const bytes = [];
  for (const character of input) {
    let c = character.codePointAt(0);
    if (c >= 55296 && c <= 57343) c = 65533;
    if (c < 128) bytes.push(c);
    else if (c < 2048) bytes.push(192 | c >> 6, 128 | c & 63);
    else if (c < 65536) bytes.push(224 | c >> 12, 128 | c >> 6 & 63, 128 | c & 63);
    else bytes.push(240 | c >> 18, 128 | c >> 12 & 63, 128 | c >> 6 & 63, 128 | c & 63);
  }
  const utf8 = new Uint8Array(bytes);
  const H = [
    1779033703,
    3144134277,
    1013904242,
    2773480762,
    1359893119,
    2600822924,
    528734635,
    1541459225
  ];
  const K = [
    1116352408,
    1899447441,
    3049323471,
    3921009573,
    961987163,
    1508970993,
    2453635748,
    2870763221,
    3624381080,
    310598401,
    607225278,
    1426881987,
    1925078388,
    2162078206,
    2614888103,
    3248222580,
    3835390401,
    4022224774,
    264347078,
    604807628,
    770255983,
    1249150122,
    1555081692,
    1996064986,
    2554220882,
    2821834349,
    2952996808,
    3210313671,
    3336571891,
    3584528711,
    113926993,
    338241895,
    666307205,
    773529912,
    1294757372,
    1396182291,
    1695183700,
    1986661051,
    2177026350,
    2456956037,
    2730485921,
    2820302411,
    3259730800,
    3345764771,
    3516065817,
    3600352804,
    4094571909,
    275423344,
    430227734,
    506948616,
    659060556,
    883997877,
    958139571,
    1322822218,
    1537002063,
    1747873779,
    1955562222,
    2024104815,
    2227730452,
    2361852424,
    2428436474,
    2756734187,
    3204031479,
    3329325298
  ];
  const rotr = (x, n) => x >>> n | x << 32 - n;
  const l = utf8.length;
  const bitLen = l * 8;
  const padded = new Uint8Array(((l + 8 >> 6) + 1) * 64);
  padded.set(utf8);
  padded[l] = 128;
  const dv = new DataView(padded.buffer);
  dv.setUint32(padded.length - 4, bitLen);
  const w = new Array(64);
  for (let off = 0; off < padded.length; off += 64) {
    for (let i = 0; i < 16; i++) w[i] = dv.getUint32(off + i * 4);
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ w[i - 15] >>> 3;
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ w[i - 2] >>> 10;
      w[i] = w[i - 16] + s0 + w[i - 7] + s1 | 0;
    }
    let [a, b, c, d, e, f, g, h] = H;
    for (let i = 0; i < 64; i++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = e & f ^ ~e & g;
      const t1 = h + S1 + ch + K[i] + w[i] | 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = a & b ^ a & c ^ b & c;
      const t2 = S0 + maj | 0;
      h = g;
      g = f;
      f = e;
      e = d + t1 | 0;
      d = c;
      c = b;
      b = a;
      a = t1 + t2 | 0;
    }
    for (let i = 0; i < 8; i++) H[i] = H[i] + [a, b, c, d, e, f, g, h][i] | 0;
  }
  const hex = H.map((x) => (x >>> 0).toString(16).padStart(8, "0")).join("");
  const alphabet = "0123456789abcdefghijklmnopqrstuvwxyz";
  let s = "";
  let digits = hex.split("").map((c) => parseInt(c, 16));
  while (digits.length) {
    let remainder = 0;
    const quotient = [];
    for (const digit of digits) {
      const value = remainder * 16 + digit;
      const next = Math.floor(value / 36);
      if (quotient.length || next) quotient.push(next);
      remainder = value % 36;
    }
    s = alphabet[remainder] + s;
    digits = quotient;
  }
  return s.padStart(15, "0").slice(0, 15);
}

// src/repositories/linkId.ts
function canonicalEndpoints(from, to, kind) {
  if (kind !== "relation") return [from, to];
  return from.id <= to.id ? [from, to] : [to, from];
}
function discriminator(kind, meta) {
  var _a, _b;
  if (kind !== "relation") return "";
  return `${(_a = meta == null ? void 0 : meta.label) != null ? _a : ""}#${(_b = meta == null ? void 0 : meta.category) != null ? _b : ""}`;
}
function buildLinkId(from, to, kind, meta) {
  const [f, t] = canonicalEndpoints(from, to, kind);
  return `lk-${sha256ToBase36_15(`${f.type}:${f.id}|${t.type}:${t.id}|${kind}|${discriminator(kind, meta)}`)}`;
}

// src/commands/json.ts
function decodePbJson(value) {
  if (value == null) return null;
  if (Array.isArray(value) && !value.length) return null;
  if (typeof value === "string") {
    try {
      return JSON.parse(value);
    } catch (e) {
      return value;
    }
  }
  if (Array.isArray(value) && value.length && value.every((n) => typeof n === "number" && Number.isInteger(n) && n >= 0 && n <= 255)) {
    try {
      return JSON.parse(decodeURIComponent(value.map((n) => "%" + Number(n).toString(16).padStart(2, "0")).join("")));
    } catch (e) {
      return value;
    }
  }
  return value;
}

// src/commands/activityIdentity.ts
function legacyActivityId(sourceId, hash) {
  return "act-" + hash("interactions/" + sourceId).slice(0, 32);
}

return module.exports})()
// 新编号只增量演进；保留第一版业务、回执、附件与删除登记。
migrate(app => {
  const additions = [{"name": "activities", "type": "base", "system": false, "listRule": "@request.auth.id != '' && @collection.command_state.ownerId ?= @request.auth.id", "viewRule": "@request.auth.id != '' && @collection.command_state.ownerId ?= @request.auth.id", "createRule": null, "updateRule": null, "deleteRule": null, "fields": [{"name": "id", "type": "text", "primaryKey": true, "required": true, "autogeneratePattern": ""}, {"name": "localId", "type": "text", "required": true}, {"name": "updatedAt", "type": "number", "required": true}, {"name": "deleted", "type": "number"}, {"name": "rev", "type": "number"}, {"name": "restoredAt", "type": "number", "required": false}, {"name": "deletedAt", "type": "number", "required": false}, {"name": "created", "type": "autodate", "onCreate": true, "onUpdate": false}, {"name": "updated", "type": "autodate", "onCreate": true, "onUpdate": true}, {"name": "server_received_at", "type": "autodate", "onCreate": true, "onUpdate": true}, {"name": "tombstonePushed", "type": "number", "required": false, "presentable": false}, {"name": "trashSnapshot", "type": "json"}, {"name": "title", "type": "text", "required": false, "max": 0, "min": 0, "pattern": ""}, {"name": "summary", "type": "text", "required": false, "max": 0, "min": 0, "pattern": ""}, {"name": "timePrecision", "type": "text", "required": false, "max": 0, "min": 0, "pattern": ""}, {"name": "timeZone", "type": "text", "required": false, "max": 0, "min": 0, "pattern": ""}, {"name": "category", "type": "text", "required": false, "max": 0, "min": 0, "pattern": ""}, {"name": "sourceOperationId", "type": "text", "required": false, "max": 0, "min": 0, "pattern": ""}, {"name": "sourceTable", "type": "text", "required": false, "max": 0, "min": 0, "pattern": ""}, {"name": "sourceId", "type": "text", "required": false, "max": 0, "min": 0, "pattern": ""}, {"name": "sourceText", "type": "text", "required": false, "max": 0, "min": 0, "pattern": ""}, {"name": "occurredAt", "type": "number", "required": false}, {"name": "occurredUntil", "type": "number", "required": false}, {"name": "recordedAt", "type": "number", "required": false}, {"name": "tags", "type": "json", "required": false}], "indexes": ["CREATE UNIQUE INDEX idx_activities_localId ON activities(localId)", "CREATE UNIQUE INDEX idx_activity_source ON activities(sourceTable,sourceId) WHERE sourceId != ''", "CREATE INDEX idx_activity_time ON activities(deleted,occurredAt,localId)", "CREATE INDEX idx_activity_operation ON activities(sourceOperationId)", "CREATE INDEX idx_activity_updated ON activities(updatedAt)"]}, {"name": "agent_credentials", "type": "base", "listRule": null, "viewRule": null, "createRule": null, "updateRule": null, "deleteRule": null, "fields": [{"name": "owner", "type": "text", "required": false, "max": 0, "min": 0, "pattern": ""}, {"name": "name", "type": "text", "required": false, "max": 0, "min": 0, "pattern": ""}, {"name": "tokenHash", "type": "text", "required": false, "max": 0, "min": 0, "pattern": ""}, {"name": "capabilities", "type": "json", "required": false}, {"name": "createdAt", "type": "number", "required": false}, {"name": "revokedAt", "type": "number", "required": false}, {"name": "expiresAt", "type": "number", "required": false}], "indexes": ["CREATE UNIQUE INDEX idx_agent_token ON agent_credentials(tokenHash)", "CREATE INDEX idx_agent_owner ON agent_credentials(owner)"]}]
  for (const data of additions) {
    let existing
    try { existing = app.findCollectionByNameOrId(data.name) } catch (_) {}
    if (!existing) app.save(new Collection(data))
  }
  const fields = {"customers": [{"name": "aliases", "type": "json", "required": false}, {"name": "preferredName", "type": "text", "required": false, "max": 0, "min": 0, "pattern": ""}, {"name": "contactType", "type": "text", "required": false, "max": 0, "min": 0, "pattern": ""}, {"name": "mergedIntoId", "type": "text", "required": false, "max": 0, "min": 0, "pattern": ""}], "projects": [{"name": "aliases", "type": "json", "required": false}], "operations": [{"name": "clientId", "type": "text", "required": false, "max": 0, "min": 0, "pattern": ""}, {"name": "kind", "type": "text", "required": false, "max": 0, "min": 0, "pattern": ""}, {"name": "updatedAt", "type": "number", "required": false}]}
  for (const name of Object.keys(fields)) {
    const col = app.findCollectionByNameOrId(name)
    for (const f of fields[name]) if (!col.fields.getByName(f.name)) col.fields.add(f.type === 'json' ? new JSONField(f) : f.type === 'number' ? new NumberField(f) : new TextField(f))
    app.save(col)
  }
  const indexes = {"operations": ["CREATE UNIQUE INDEX idx_operation_request ON operations (owner, requestId)", "CREATE INDEX idx_operations_recent ON operations(owner,committedAt,id)", "CREATE INDEX idx_operations_status ON operations(owner,status,id)"], "todos": ["CREATE INDEX idx_todos_updatedAt ON todos (updatedAt)", "CREATE UNIQUE INDEX idx_todos_localId ON todos (localId)", "CREATE INDEX idx_todos_tombstonePushed ON todos (tombstonePushed)", "CREATE INDEX idx_todos_customerId_scope ON todos(customerId)", "CREATE INDEX idx_todos_projectId_scope ON todos(projectId)"], "notes": ["CREATE INDEX idx_notes_updatedAt ON notes (updatedAt)", "CREATE UNIQUE INDEX idx_notes_localId ON notes (localId)", "CREATE INDEX idx_notes_tombstonePushed ON notes (tombstonePushed)", "CREATE INDEX idx_notes_projectId_scope ON notes(projectId)"], "projects": ["CREATE INDEX idx_projects_updatedAt ON projects (updatedAt)", "CREATE UNIQUE INDEX idx_projects_localId ON projects (localId)", "CREATE INDEX idx_projects_tombstonePushed ON projects (tombstonePushed)", "CREATE INDEX idx_projects_customerId_scope ON projects(customerId)"], "transactions": ["CREATE INDEX idx_transactions_updatedAt ON transactions (updatedAt)", "CREATE UNIQUE INDEX idx_transactions_localId ON transactions (localId)", "CREATE INDEX idx_transactions_tombstonePushed ON transactions (tombstonePushed)", "CREATE INDEX idx_transactions_ledgerId_scope ON transactions(ledgerId)"]}
  for (const name of Object.keys(indexes)) { const col=app.findCollectionByNameOrId(name);col.indexes=indexes[name];app.save(col) }
  const effects=app.findCollectionByNameOrId('operation_effects')
  if(!effects.fields.getByName('occurredAt'))effects.fields.add(new NumberField({name:'occurredAt'}))
  effects.indexes=[...effects.indexes,'CREATE INDEX IF NOT EXISTS idx_effect_time ON operation_effects(tableName,occurredAt,id)'];app.save(effects)
  for(const effect of app.findAllRecords('operation_effects')){const op=app.findRecordById('operations',effect.getString('operationId'));effect.set('occurredAt',op.getFloat('committedAt'));app.save(effect)}
  const credentialCol=app.findCollectionByNameOrId('agent_credentials');if(!credentialCol.fields.getByName('generation'))credentialCol.fields.add(new TextField({name:'generation'}));app.save(credentialCol)
  let state=app.findFirstRecordByFilter('command_state','id!=""')
  const stateCol=app.findCollectionByNameOrId('command_state')
  if(!stateCol.fields.getByName('sharedTokenUntil'))stateCol.fields.add(new NumberField({name:'sharedTokenUntil'}))
  if(!stateCol.fields.getByName('sharedTokenGeneration'))stateCol.fields.add(new TextField({name:'sharedTokenGeneration'}))
  app.save(stateCol);state=app.findFirstRecordByFilter('command_state','id!=""');let restoring=false;try{$os.stat(app.dataDir()+'/RESTORE_REVIEW_REQUIRED');restoring=true}catch(_){}
  state.set('sharedTokenUntil',restoring?0:Date.now()+7*86400000);state.set('sharedTokenGeneration',restoring?'':state.getString('generation'))
  const sourceMap={},linkMap={},now=Date.now(),participation={}
  for(const mark of app.findRecordsByFilter('deletion_registry','tableName="interactions"','',0)){const source=mark.getString('recordId');for(const id of [source,migrationIds.legacyActivityId(source,s=>$security.sha256(s))])if(!app.findRecordsByFilter('deletion_registry','tableName="activities" && recordId={:id}','',1,0,{id}).length){const alias=new Record(app.findCollectionByNameOrId('deletion_registry'));alias.set('tableName','activities');alias.set('recordId',id);alias.set('generation',state.getString('generation'));alias.set('purgedAt',mark.getFloat('purgedAt'));app.save(alias)}}
  const find=(table,id)=>app.findRecordsByFilter(table,'localId={:id}','',1,0,{id})[0]
  const aid=id=>migrationIds.legacyActivityId(id,s=>$security.sha256(s))
  const linkId=(fromType,fromId,toType,toId,kind,meta)=>migrationIds.buildLinkId({type:fromType,id:fromId},{type:toType,id:toId},kind,meta)
  const installLink=(id,data)=>{
    let r=find('links',id)
    if(!r){r=new Record(app.findCollectionByNameOrId('links'));r.set('id',$security.sha256(id).slice(0,15));r.set('localId',id)}
    for(const k of Object.keys(data))r.set(k,data[k]);app.save(r);return r
  }
  let offset=0
  while(true){
    const rows=app.findRecordsByFilter('interactions','','localId',500,offset)
    for(const old of rows){
      const sid=old.getString('localId');if(!sid)throw new Error('MIGRATION_SOURCE_ID_REQUIRED')
      const id=aid(sid);sourceMap[sid]=id
      if(find('activities',id))continue
      const r=new Record(app.findCollectionByNameOrId('activities'));r.set('id',$security.sha256(id).slice(0,15))
      const data={localId:id,title:'历史沟通',summary:old.getString('content'),occurredAt:old.getFloat('at'),timePrecision:'minute',timeZone:'Asia/Shanghai',recordedAt:0,category:'communication',tags:[],sourceTable:'interactions',sourceId:sid,updatedAt:now,rev:old.getInt('rev')+1,deleted:old.getInt('deleted'),deletedAt:old.getFloat('deletedAt'),restoredAt:old.getFloat('restoredAt'),trashSnapshot:migrationIds.decodePbJson(old.get('trashSnapshot'))}
      for(const k of Object.keys(data))r.set(k,data[k]);app.save(r)
      participation[id]=[]
      for(const [table,target] of [['customers',old.getString('customerId')],['projects',old.getString('projectId')]]){
        const endpoint=target&&find(table,target);if(!endpoint)continue
        const lid=linkId('activities',id,table,target,'related')
        const deleted=!!(data.deleted || endpoint.getInt('deleted'))
        installLink(lid,{fromType:'activities',fromId:id,toType:table,toId:target,kind:'related',meta:{sourceKind:'legacy'},createdAt:0,updatedAt:now,rev:1,deleted:deleted?1:0,deletedAt:deleted?(data.deletedAt || now):0})
        participation[id].push(lid)
      }
    }
    if(rows.length<500)break;offset+=rows.length
  }
  // 先收集旧边再改，碰撞按原始时间/墓碑胜出，保留同语义唯一身份。
  const changed=app.findRecordsByFilter('links','fromType="interactions" || toType="interactions"','localId',0)
  for(const old of changed){
    const oldId=old.getString('localId'),data=JSON.parse(JSON.stringify(old.publicExport()))
    for(const side of ['from','to'])if(data[side+'Type']==='interactions'){
      const mapped=sourceMap[data[side+'Id']];if(!mapped)throw new Error('MIGRATION_DANGLING_SOURCE: '+oldId)
      data[side+'Type']='activities';data[side+'Id']=mapped
    }
    data.meta=migrationIds.decodePbJson(data.meta)
    const id=linkId(data.fromType,data.fromId,data.toType,data.toId,data.kind,data.meta)
    linkMap[oldId]=id
    const existing=find('links',id)
    const winner=existing&&(existing.getFloat('updatedAt')>Number(data.updatedAt || 0) || existing.getFloat('updatedAt')===Number(data.updatedAt || 0)&&existing.getInt('deleted'))?JSON.parse(JSON.stringify(existing.publicExport())):data
    // canonical relation 同步方向；词表中的其它种类保持原方向。
    const endpoints=migrationIds.canonicalEndpoints({type:data.fromType,id:data.fromId},{type:data.toType,id:data.toId},data.kind)
    installLink(id,{fromType:endpoints[0].type,fromId:endpoints[0].id,toType:endpoints[1].type,toId:endpoints[1].id,kind:data.kind,meta:migrationIds.decodePbJson(winner.meta),createdAt:winner.createdAt || 0,updatedAt:now,rev:Math.max(old.getInt('rev'),existing?.getInt('rev') || 0)+1,deleted:winner.deleted || 0,deletedAt:winner.deletedAt || 0,restoredAt:winner.restoredAt || 0,trashSnapshot:winner.trashSnapshot})
    if(oldId!==id){
      // 为旧ID保留防复活登记；正文历史引用在下方同步映射。
      if(!app.findRecordsByFilter('deletion_registry','tableName="links" && recordId={:id}','',1,0,{id:oldId}).length){const mark=new Record(app.findCollectionByNameOrId('deletion_registry'));mark.set('tableName','links');mark.set('recordId',oldId);mark.set('generation',state.getString('generation'));mark.set('purgedAt',now);app.save(mark)}
      app.delete(old)
    }
  }
  const mapRef=ref=>{if(ref.table==='interactions'&&sourceMap[ref.id])return {...ref,table:'activities',id:sourceMap[ref.id]};if(ref.table==='links'&&linkMap[ref.id])return {...ref,id:linkMap[ref.id]};return ref}
  const tables=['workspaces','customers','activities','ledgers','transactions','todos','todoLists','notes','noteFolders','quickNotes','projects','projectMilestones','habits','habitLogs','trophies','attachments','module_configs','customerGroups','links']
  for(const table of tables)for(const row of app.findAllRecords(table)){
    const snapshot=migrationIds.decodePbJson(row.get('trashSnapshot'));if(!snapshot)continue
    const next=JSON.parse(JSON.stringify(snapshot)),cascade=new Set((next.cascadeLinkIds || []).map(id=>linkMap[id] || id))
    const originalChildren=next.children || []
    next.children=originalChildren.map(mapRef)
    for(const child of originalChildren)if(child.table==='interactions')for(const lid of participation[sourceMap[child.id]] || [])cascade.add(lid)
    if(table==='activities')for(const lid of participation[row.getString('localId')] || [])cascade.add(lid)
    next.links=(next.links || []).flatMap(ref=>{
      if(ref.table==='interactions'&&['customerId','projectId'].includes(ref.field)&&sourceMap[ref.id]){
        const targetTable=ref.field==='customerId'?'customers':'projects',activityId=sourceMap[ref.id],lid=linkId('activities',activityId,targetTable,ref.value,'related')
        if(find(targetTable,ref.value))installLink(lid,{fromType:'activities',fromId:activityId,toType:targetTable,toId:ref.value,kind:'related',meta:{sourceKind:'legacy'},createdAt:0,updatedAt:now,rev:1,deleted:1,deletedAt:now})
        cascade.add(lid);return []
      }
      return [mapRef(ref)]
    })
    next.cascadeLinkIds=[...cascade];row.set('trashSnapshot',next);row.set('rev',row.getInt('rev')+1);row.set('updatedAt',now);app.save(row)
  }
  // 已提交历史也指向活动；不捏造迁移前操作，仍保留已知的实际前后值。
  const projectInteraction=value=>{if(!value)return value;return {id:sourceMap[value.id] || aid(value.id),title:'历史沟通',summary:value.content,occurredAt:value.at,timePrecision:'minute',timeZone:'Asia/Shanghai',recordedAt:0,category:'communication',tags:[],sourceTable:'interactions',sourceId:value.id,rev:value.rev,updatedAt:value.updatedAt,deleted:value.deleted || 0}}
  for(const effect of app.findAllRecords('operation_effects')){
    if(effect.getString('tableName')==='interactions'&&sourceMap[effect.getString('recordId')]){
      effect.set('tableName','activities');effect.set('recordId',sourceMap[effect.getString('recordId')]);effect.set('before',projectInteraction(migrationIds.decodePbJson(effect.get('before'))));effect.set('after',projectInteraction(migrationIds.decodePbJson(effect.get('after'))));app.save(effect)
    }else if(effect.getString('tableName')==='links'&&linkMap[effect.getString('recordId')]){effect.set('recordId',linkMap[effect.getString('recordId')]);for(const field of ['before','after']){const v=migrationIds.decodePbJson(effect.get(field));if(v){v.id=linkMap[v.id] || v.id;for(const side of ['from','to'])if(v[side+'Type']==='interactions'){v[side+'Type']='activities';v[side+'Id']=sourceMap[v[side+'Id']]}effect.set(field,v)}}app.save(effect)}
  }
  for(const operation of app.findAllRecords('operations')){
    if(operation.getString('status')==='awaiting_confirmation'){operation.set('status','cancelled');operation.set('plan',null);app.save(operation);continue}
    const result=migrationIds.decodePbJson(operation.get('result'));if(!result?.changes)continue
    result.changes=result.changes.map(change=>{if(change.table==='interactions'&&sourceMap[change.id])return {...change,table:'activities',id:sourceMap[change.id],row:projectInteraction(change.row)};if(change.table==='links'&&linkMap[change.id])return {...change,id:linkMap[change.id],row:null,migrated:true};return change})
    operation.set('result',result);app.save(operation)
  }
  state.set('sequence',state.getInt('sequence')+1);app.save(state)

}, () => { throw new Error('活动写入切换后禁止删除新结构回退') })
