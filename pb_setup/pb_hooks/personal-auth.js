const json=require(__hooks+'/command-core.js').decodePbJson
// 客户端身份来自请求头内经 relay 验证的秘密；PB 每次再验散列，撤销立即影响已有会话。
const domains={activities:'activity',customers:'crm',projects:'project',todos:'todo',transactions:'fin',ledgers:'fin',notes:'note',attachments:'attachment',links:'link',interactions:'activity',habits:'habit',habitLogs:'habit',todoLists:'todo',noteFolders:'note',projectMilestones:'project'}
const capabilities=['activity','crm','project','todo','fin','note','attachment','link','habit','operation','source'].flatMap(d=>[d+':read',d+':write'])
exports.capabilities=capabilities
exports.principal=(app,e)=>{
  const state=app.findFirstRecordByFilter('command_state','id!=""')
  if(!e.auth || e.auth.id!==state.getString('ownerId') || e.auth.collection().name!=='users')throw new Error('FORBIDDEN: 需要拥有者身份')
  const policy=e.request?.header?.get('X-Workhub-Write-Domains'),writeDomains=policy?JSON.parse(policy):null
  const token=e.request?.header?.get('X-Workhub-Agent-Key') || ''
  if(!token)return {clientId:'owner',owner:e.auth.id,capabilities:['*'],writeDomains}
  const rows=app.findRecordsByFilter('agent_credentials','owner={:owner} && tokenHash={:hash}','',1,0,{owner:e.auth.id,hash:$security.sha256(token)})
  const row=rows[0]
  if(!row || row.getString('generation')!==state.getString('generation') || row.getFloat('revokedAt') || (row.getFloat('expiresAt') && row.getFloat('expiresAt')<Date.now()))throw new Error('UNAUTHORIZED: Agent 凭据不存在、已撤销或过期')
  return {clientId:row.id,owner:e.auth.id,capabilities:json(row.get('capabilities')) || [],writeDomains}
}
exports.can=(p,table,write=false)=>{
  const domain=domains[table] || table
  if(write && p.writeDomains && p.writeDomains[domain==='activity'?'read':domain]!==true)return false
  return p.capabilities.includes('*') || p.capabilities.includes(domain+':'+(write?'write':'read'))
}
exports.source=p=>p.capabilities.includes('*') || p.capabilities.includes('source:read')
exports.receipt=(p,receipt)=>{
  if(!receipt)return receipt
  const out=JSON.parse(JSON.stringify(json(receipt)))
  if(out.changes)out.changes=out.changes.filter(c=>exports.can(p,c.table)).map(c=>{if(c.row && !exports.source(p))delete c.row.sourceText;return c})
  // legacy result 可能嵌入领域正文；有限凭据从明确的授权 changes 得到结果。
  if(!p.capabilities.includes('*'))out.result={ok:true,data:{committed:true,records:(out.changes || []).map(c=>({table:c.table,id:c.id}))}}
  return out
}
