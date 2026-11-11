// 独立缓存进程，复用真实客户端代码；非浏览器、非第二套同步实现。
import 'fake-indexeddb/auto'
class MemoryStorage {
  values = new Map<string,string>()
  get length(){return this.values.size}
  getItem(key:string){return this.values.get(String(key)) ?? null}
  setItem(key:string,value:string){this.values.set(String(key),String(value))}
  removeItem(key:string){this.values.delete(String(key))}
  clear(){this.values.clear()}
  key(index:number){return [...this.values.keys()][index] ?? null}
}
const base=process.env.CLIENT_TEST_BASE!
const browserWindow=new EventTarget()
const browserDocument=Object.assign(new EventTarget(),{visibilityState:'visible'})
let online=true
Object.assign(globalThis,{window:browserWindow,document:browserDocument,location:{origin:base},localStorage:new MemoryStorage(),sessionStorage:new MemoryStorage()})
Object.defineProperty(globalThis,'navigator',{configurable:true,value:{get onLine(){return online}}})
const nativeFetch=globalThis.fetch
globalThis.fetch=(input,init)=>nativeFetch(typeof input==='string'&&input.startsWith('/')?base+input:input,init)
const sessions=await import('@/storage/clientSession.ts')
const database=await import('@/db/db.ts')
const auth=await import('@/shared/authToken.ts')
const sync=await import('@/sync/clientSync.ts')
const personal=await import('@/domain/personal.ts')
const mirror=await import('@/storage/clientMirror.ts')
process.on('message',async(message:{id:number;method:string;args:Record<string,any>})=>{
 const {id,method,args}=message
 try{
  let result:unknown
  if(method==='init'){
   auth.saveAuthSession(args.token,'synthetic owner',args.owner)
   result=sessions.activateClientSession(args.owner,args.generation,6)
  }else if(method==='pull'){await sync.pullClientChanges(Boolean(args.full));result={cursor:(await database.db.meta.get(mirror.MIRROR_CURSOR))?.value}}
  else if(method==='row')result=await database.db.table(args.table).get(args.id) ?? null
  else if(method==='query')result=await personal.queryPersonal(args.name,args.input)
  else if(method==='online'){online=Boolean(args.value);result=online}
  else if(method==='apply') {await mirror.applyClientReceipt(args.receipt);result=true}
  else if(method==='draft'){localStorage.setItem(sessions.scopedClientKey('workhub.draft.root'),args.value);result=true}
  else if(method==='drafts')result=Array.from({length:localStorage.length},(_,i)=>localStorage.key(i)).filter(k=>k?.startsWith('workhub.draft.')).map(key=>({key,value:localStorage.getItem(key!)}))
  else if(method==='action'){
   const context={requestId:args.requestId,generation:sessions.clientSession()!.generation}
   const preview=await personal.previewPersonal(args.kind,args.input,context)
   result=preview.committed?preview.receipt:await personal.commitPersonal({...context,previewId:String(preview.previewId),planFingerprint:String(preview.planFingerprint)})
  }else throw new Error('unknown audit method')
  process.send?.({id,ok:true,result})
 }catch(error){process.send?.({id,ok:false,error:String(error)})}
})
process.send?.({ready:true})
