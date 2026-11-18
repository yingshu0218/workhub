const json=require(__hooks+'/command-core.js').decodePbJson
// 客户端身份来自请求头内的 Agent key；PB 每次按散列复核，撤销与世代变化立即生效。
const domains={activities:'activity',customers:'crm',projects:'project',todos:'todo',transactions:'fin',ledgers:'fin',notes:'note',attachments:'attachment',links:'link',interactions:'activity',habits:'habit',habitLogs:'habit',todoLists:'todo',noteFolders:'note',projectMilestones:'project',operations:'operation',operation_effects:'operation'}
const capabilities=['activity','crm','project','todo','fin','note','attachment','link','habit','operation','source'].flatMap(d=>[d+':read',d+':write'])
exports.capabilities=capabilities
function commandState(app){return app.findFirstRecordByFilter('command_state','id!=""')}
function agentDomainsOf(e){
  // 不能信任请求自报部署策略：MCP 执行器的 header 只能继续收窄 PB 的宿主配置。
  // entrypoint 将同一 WORKHUB_AI_DOMAINS 环境传给 PocketBase 与 Node；未配置时全关。
  let configured=''
  try{configured=$os.getenv('WORKHUB_AI_DOMAINS')||''}catch(_){configured=''}
  const trusted={}
  for(const domain of configured.split(',')){const key=domain.trim();if(/^[a-z][a-z0-9_-]{0,31}$/.test(key))trusted[key]=true}
  const header=e?.request?.header
  const values=header?.values?header.values('X-Workhub-Write-Domains'):[]
  if(!Array.isArray(values)||!values.length)return trusted
  try{
    const requested=JSON.parse(header.get('X-Workhub-Write-Domains')||'')
    if(!requested||typeof requested!=='object'||Array.isArray(requested))return {}
    for(const key of Object.keys(trusted))if(requested[key]!==true)delete trusted[key]
    return trusted
  }catch(_){return {}}
}
function hasWriteDomainsHeader(e){
  const values=e?.request?.header?.values?e.request.header.values('X-Workhub-Write-Domains'):[]
  return Array.isArray(values)&&values.length>0
}
function agentHeader(e){
  const header=e.request?.header
  const values=header?.values?header.values('X-Workhub-Agent-Key'):[]
  return {present:Array.isArray(values)&&values.length>0,token:header?.get?header.get('X-Workhub-Agent-Key'):''}
}
function ownerRecord(app,id){
  if(typeof id!=='string'||!id)throw new Error('UNAUTHORIZED: 当前工作区没有有效拥有者')
  let record
  try{record=app.findRecordById('users',id)}catch(_){throw new Error('UNAUTHORIZED: 当前拥有者账号不存在')}
  if(!record||record.id!==id||record.collection().name!=='users')throw new Error('UNAUTHORIZED: 当前拥有者账号无效')
  return record
}
function agentPrincipal(app,state,token,e){
  if(typeof token!=='string'||!token.trim())throw new Error('UNAUTHORIZED: 需要明确的非空 Agent 凭据')
  const owner=state.getString('ownerId'),generation=state.getString('generation')
  if(!owner||!generation)throw new Error('UNAUTHORIZED: 个人工作区尚未初始化')
  ownerRecord(app,owner)
  const rows=app.findRecordsByFilter('agent_credentials','owner={:owner} && tokenHash={:hash}','',1,0,{owner,hash:$security.sha256(token)})
  const row=rows[0]
  if(!row||row.getString('generation')!==generation||row.getFloat('revokedAt')||(row.getFloat('expiresAt')&&row.getFloat('expiresAt')<Date.now()))throw new Error('UNAUTHORIZED: Agent 凭据不存在、已撤销或过期')
  return {clientId:row.id,owner,capabilities:json(row.get('capabilities'))||[],agentDomains:agentDomainsOf(e)}
}
exports.agentPrincipal=(app,token,e={})=>agentPrincipal(app,commandState(app),token,e)
exports.principal=(app,e)=>{
  const state=commandState(app),header=agentHeader(e)
  // key 一旦出现就只能走 Agent 身份；无效 key 绝不能退回同请求里的 owner JWT。
  if(header.present)return agentPrincipal(app,state,header.token,e)
  if(!e.auth||e.auth.collection().name!=='users')throw new Error('UNAUTHORIZED: 需要拥有者身份或有效 Agent 凭据')
  const owner=state.getString('ownerId')
  if(!owner)throw new Error('UNAUTHORIZED: 当前工作区没有有效拥有者')
  if(e.auth.id!==owner)throw new Error('FORBIDDEN: 当前登录账号不是工作区拥有者')
  ownerRecord(app,e.auth.id)
  // 普通网页请求不带策略头，仍沿 owner 原路径；共享过渡的服务端请求带头时保留收窄。
  return {clientId:'owner',owner:e.auth.id,capabilities:['*'],agentDomains:hasWriteDomainsHeader(e)?agentDomainsOf(e):null}
}
// 业务路由保留 owner JWT 认证；只有显式携带 Agent key 时才跳过 users middleware，
// handler 仍必须在事务内调用 principal() 验证 credential、能力和世代。
exports.ownerOrAgent=e=>{
  if(agentHeader(e).present)return e.next()
  // 0.40.2 的 requireAuth 返回 Hook.Handler 对象，JS 侧应执行其 func，而非把对象当函数调用。
  return $apis.requireAuth('users').func(e)
}
exports.agentVerifyOrOwner=e=>{
  const body=e.requestInfo().body||{}
  if(body.kind==='shared-transition'&&body.token===undefined)return $apis.requireAuth('users').func(e)
  return e.next()
}
exports.can=(p,table,write=false)=>{
  const domain=domains[table]||table
  // 活动写入仍由 activity:write 能力约束，但部署门延续个人工具既有的 read 域口径；旧部署没有 activity 配置。
  const policyDomain=domain==='operation'||domain==='activity'?'read':domain
  // 部署白名单只收窄写能力；读工具沿用 SERVER_READ_TOOLS 的 read 域闸门和 credential 能力。
  if(write&&p.agentDomains&&p.agentDomains[policyDomain]!==true)return false
  return p.capabilities.includes('*')||p.capabilities.includes(domain+':'+(write?'write':'read'))
}
exports.source=p=>p.capabilities.includes('*')||p.capabilities.includes('source:read')
exports.receipt=(p,receipt)=>{
  if(!receipt)return receipt
  const out=JSON.parse(JSON.stringify(json(receipt)))
  if(out.changes)out.changes=out.changes.filter(c=>exports.can(p,c.table)).map(c=>{if(c.row&&!exports.source(p))delete c.row.sourceText;return c})
  // legacy result 可能嵌入领域正文；有限凭据从明确的授权 changes 得到结果。
  if(!p.capabilities.includes('*'))out.result={ok:true,data:{committed:true,records:(out.changes||[]).map(c=>({table:c.table,id:c.id}))}}
  return out
}
