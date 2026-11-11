/** WebView使用显式Bearer认证；跨源放行不替代任何业务鉴权。 */
export function applyClientCors(req,res) {
  const origin=String(req.headers.origin || '')
  if(!origin)return false
  const native=new Set(['http://tauri.localhost','https://tauri.localhost','tauri://localhost'])
  const configured=(process.env.WORKHUB_CLIENT_ORIGINS || '').split(',').map(x=>x.trim()).filter(Boolean)
  let same=false
  try{same=new URL(origin).host===req.headers.host}catch{}
  if(!same&&!native.has(origin)&&!configured.includes(origin)){res.writeHead(403,{'Content-Type':'application/json'});res.end(JSON.stringify({error:'跨源来源未授权'}));return true}
  res.setHeader('Access-Control-Allow-Origin',origin);res.setHeader('Vary','Origin')
  if(req.method!=='OPTIONS')return false
  const headers=String(req.headers['access-control-request-headers'] || '').toLowerCase().split(',').map(x=>x.trim()).filter(Boolean)
  if(headers.some(h=>!['authorization','content-type','x-workhub-plan'].includes(h))){res.writeHead(403).end();return true}
  res.setHeader('Access-Control-Allow-Methods','GET, HEAD, POST, PATCH, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers','Authorization, Content-Type, X-Workhub-Plan')
  res.setHeader('Access-Control-Max-Age','600');res.writeHead(204).end();return true
}
