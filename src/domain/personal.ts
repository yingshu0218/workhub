import { clientRequest } from '@/platform/request'
import { applyClientReceipt, notifyMirrorChanged } from '@/storage/clientMirror'
import { clientSession, scopedClientKey,requireClientSession } from '@/storage/clientSession'
import { db } from '@/db/db'

/** 统一endpoint、认证与镜像应用；UI和Agent仍使用同一PB业务命令。 */
export function personalRequest(path:string,body:unknown,headers:Record<string,string>={}) { return clientRequest('/api/workhub/'+path,body,headers) }
export async function queryPersonal(name:string,input:unknown={}) {
  const session=clientSession(), key=scopedClientKey('query:'+JSON.stringify([name,input]))
  if(session && typeof navigator!=='undefined' && !navigator.onLine){
    const cached=await db.meta.get(key)
    if(cached){requireClientSession(session);return {...cached.value as Record<string,unknown>,cached:true}}
    throw new Error('OFFLINE_CACHE_MISS: 离线缓存没有这项查询，请联网读取')
  }
  const cache=db
  const result=await personalRequest('personal/query',{name,input})
  if(session){requireClientSession(session);if(result.generation && result.generation!==session.generation){window.dispatchEvent(new CustomEvent('workhub:auth-fault',{detail:{status:409}}));throw new Error('RECOVERY_REVIEW_REQUIRED: 数据世代已改变，草稿保留，请重新验证身份后核对')}await cache.meta.put({key,value:result});requireClientSession(session)}
  return result
}
export function previewPersonal(kind:string,input:unknown,context:{requestId:string;generation:string}) { return personalRequest('personal/preview',{kind,input,...context}) }
export async function commitPersonal(context:{requestId:string;generation:string;previewId:string;planFingerprint:string}) {
  const receipt=await personalRequest('personal/commit',context,{'X-Workhub-Plan':context.planFingerprint})
  try{await applyClientReceipt(receipt)}catch(error){console.warn('[client] 已提交，缓存待重建',error)}
  notifyMirrorChanged(); return receipt
}
export async function cancelPersonal(context:{requestId:string;generation:string}) { const result=await personalRequest('personal/cancel',context);notifyMirrorChanged();return result }
