routerAdd('GET','/api/workhub/client-state',e=>require(__hooks+'/client-sync.js').state(e),$apis.requireAuth('users'))
routerAdd('POST','/api/workhub/sync',e=>require(__hooks+'/client-sync.js').sync(e),$apis.requireAuth('users'),$apis.bodyLimit(8192))
