// 0.40.2 的事件名为 onFileDownloadRequest；默认未保护的文件可绕过集合读取规则。
onFileDownloadRequest(e=>{
  // JSVM只提升一层嵌入字段；下载事件的HTTP请求/响应在requestEvent中。
  const request=e.requestEvent
  if(!e.record)throw new NotFoundError('附件不存在')
  if(!e.auth)throw new UnauthorizedError('需要拥有者登录态')
  const superuser=e.auth.collection().name==='_superusers'
  if(!superuser){
    const commands=require(__hooks+'/commands.js')
    commands.owner($app,e)
    if(e.record.collection().name==='attachment_staging'){
      if(e.record.getString('owner')!==e.auth.id || e.record.getFloat('expiresAt')<=Date.now())throw new NotFoundError('暂存附件已失效')
    }else{
      const auth=require(__hooks+'/personal-auth.js'),p=auth.principal($app,request)
      if(!auth.can(p,'attachments'))throw new ForbiddenError('没有附件读取权限')
    }
  }
  if(e.record.getInt('deleted')===1)throw new NotFoundError('附件已删除')
  request.response.header().set('Cache-Control','private, no-store')
  e.next()
},'attachments','attachment_staging')
// protected file 原生端点只认短期 query token；客户端走此入口，登录凭据只留在请求头。
routerAdd('GET','/api/workhub/attachments/{id}/file',e=>{
  const commands=require(__hooks+'/commands.js'),auth=require(__hooks+'/personal-auth.js')
  commands.owner($app,e)
  if(!auth.can(auth.principal($app,e),'attachments'))throw new ForbiddenError('没有附件读取权限')
  const row=commands.find($app,'attachments',e.request.pathValue('id'))
  if(!row || row.getInt('deleted')===1 || !row.getString('file'))throw new NotFoundError('附件不存在或已删除')
  const fsys=$app.newFilesystem()
  try{
    const reader=fsys.getReader(row.baseFilesPath()+'/'+row.getString('file'))
    try{
      e.response.header().set('Cache-Control','private, no-store')
      e.response.header().set('X-Content-Type-Options','nosniff')
      e.response.header().set('Content-Disposition',"attachment; filename*=UTF-8''"+encodeURIComponent(row.getString('name') || 'attachment'))
      return e.stream(200,'application/octet-stream',reader)
    }finally{reader.close()}
  }finally{fsys.close()}
},$apis.requireAuth('users'))
