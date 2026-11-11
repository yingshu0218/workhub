// 基础 SyncMeta 是所有业务 repository 的共同契约，显式清空也需要服务端列承接。
// 新编号兼容已经应用 1794355200 的实例，绝不改写旧迁移或清库绕过。
migrate(app => {
  const names = ['workspaces','customers','interactions','ledgers','transactions','todos','todoLists','notes','noteFolders','quickNotes','projects','projectMilestones','habits','habitLogs','trophies','attachments','module_configs','customerGroups','links']
  for (const name of names) {
    const col = app.findCollectionByNameOrId(name)
    if (!col.fields.getByName('deletedAt')) col.fields.add(new NumberField({name:'deletedAt'}))
    if (!col.fields.getByName('restoredAt')) col.fields.add(new NumberField({name:'restoredAt'}))
    if (!col.fields.getByName('trashSnapshot')) col.fields.add(new JSONField({name:'trashSnapshot'}))
    if (name === 'ledgers' && !col.fields.getByName('isDefault')) col.fields.add(new BoolField({name:'isDefault'}))
    app.save(col)
  }
}, () => { throw new Error('可靠性元数据不能向后降级删除') })
