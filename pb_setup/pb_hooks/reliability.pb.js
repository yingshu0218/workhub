routerAdd('GET', '/api/workhub/state', e => require(__hooks + '/commands.js').state(e), $apis.requireAuth('users'))
routerAdd('POST', '/api/workhub/commands', e => require(__hooks + '/commands.js').commit(e), $apis.requireAuth('users'), $apis.bodyLimit(4 * 1024 * 1024))
routerAdd('POST', '/api/workhub/operations/lookup', e => require(__hooks + '/commands.js').operation(e), $apis.requireAuth('users'))
routerAdd('POST', '/api/workhub/initialize', e => require(__hooks + '/commands.js').initialize(e), $apis.requireSuperuserAuth())

routerAdd('POST', '/api/workhub/stage-attachment', e => require(__hooks + '/commands.js').stageAttachment(e), $apis.requireAuth('users'), $apis.bodyLimit(6 * 1024 * 1024))
routerAdd('POST', '/api/workhub/finance', e => require(__hooks + '/commands.js').finance(e), $apis.requireAuth('users'))

routerAdd('POST', '/api/workhub/preview', e => require(__hooks + '/commands.js').preview(e), $apis.requireAuth('users'), $apis.bodyLimit(4 * 1024 * 1024))

cronAdd('workhubStagingCleanup', '17 * * * *', () => require(__hooks + '/commands.js').cleanupStaging())
