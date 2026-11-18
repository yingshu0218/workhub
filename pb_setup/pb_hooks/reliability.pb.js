routerAdd('GET', '/api/workhub/state', e => require(__hooks + '/commands.js').state(e), e => require(__hooks+'/personal-auth.js').ownerOrAgent(e))
routerAdd('POST', '/api/workhub/commands', e => require(__hooks + '/commands.js').commit(e), e => require(__hooks+'/personal-auth.js').ownerOrAgent(e), $apis.bodyLimit(4 * 1024 * 1024))
routerAdd('POST', '/api/workhub/operations/lookup', e => require(__hooks + '/commands.js').operation(e), e => require(__hooks+'/personal-auth.js').ownerOrAgent(e))
routerAdd('POST', '/api/workhub/initialize', e => require(__hooks + '/commands.js').initialize(e), $apis.requireSuperuserAuth())

routerAdd('POST', '/api/workhub/stage-attachment', e => require(__hooks + '/commands.js').stageAttachment(e), e => require(__hooks+'/personal-auth.js').ownerOrAgent(e), $apis.bodyLimit(6 * 1024 * 1024))
routerAdd('POST', '/api/workhub/finance', e => require(__hooks + '/commands.js').finance(e), e => require(__hooks+'/personal-auth.js').ownerOrAgent(e))

routerAdd('POST', '/api/workhub/preview', e => require(__hooks + '/commands.js').preview(e), e => require(__hooks+'/personal-auth.js').ownerOrAgent(e), $apis.bodyLimit(4 * 1024 * 1024))

cronAdd('workhubStagingCleanup', '17 * * * *', () => require(__hooks + '/commands.js').cleanupStaging())
