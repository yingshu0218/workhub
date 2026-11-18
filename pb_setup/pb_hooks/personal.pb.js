routerAdd('POST','/api/workhub/personal/query',e=>require(__hooks+'/personal.js').query(e),e=>require(__hooks+'/personal-auth.js').ownerOrAgent(e),$apis.bodyLimit(64*1024))
routerAdd('POST','/api/workhub/personal/preview',e=>require(__hooks+'/personal.js').preview(e),e=>require(__hooks+'/personal-auth.js').ownerOrAgent(e),$apis.bodyLimit(1024*1024))
routerAdd('POST','/api/workhub/personal/commit',e=>require(__hooks+'/personal.js').commit(e),e=>require(__hooks+'/personal-auth.js').ownerOrAgent(e),$apis.bodyLimit(64*1024))
routerAdd('POST','/api/workhub/agents',e=>require(__hooks+'/personal.js').agents(e),$apis.requireAuth('users'),$apis.bodyLimit(64*1024))
// Agent verification is the credential itself; shared-transition is separately owner-authenticated in the handler.
routerAdd('POST','/api/workhub/agents/verify',e=>require(__hooks+'/personal.js').verify(e),$apis.bodyLimit(4096),e=>require(__hooks+'/personal-auth.js').agentVerifyOrOwner(e))
routerAdd('POST','/api/workhub/scoped',e=>require(__hooks+'/personal.js').scoped(e),e=>require(__hooks+'/personal-auth.js').ownerOrAgent(e),$apis.bodyLimit(16384))
routerAdd('POST','/api/workhub/personal/cancel',e=>require(__hooks+'/personal.js').cancel(e),e=>require(__hooks+'/personal-auth.js').ownerOrAgent(e),$apis.bodyLimit(4096))
cronAdd('workhubPersonalPendingCleanup','23 * * * *',()=>require(__hooks+'/personal.js').cleanupPending())
