// 增量扩展，不删除未知字段或集合；任何金额异常让整次迁移回滚，供预演报告人工处理。
migrate((app) => {
  const schema = __SCHEMA__.sort((a, b) => a.name === 'command_state' ? -1 : b.name === 'command_state' ? 1 : 0)
  for (const def of schema) {
    let col
    try { col = app.findCollectionByNameOrId(def.name) } catch { col = null }
    if (!col) { col = new Collection(def) }
    else {
      for (const field of def.fields) {
        if (field.name === 'id') continue
        if (!col.fields.getByName(field.name)) col.fields.add(new ({text: TextField, number: NumberField, bool: BoolField, json: JSONField, autodate: AutodateField, file: FileField, select: SelectField, relation: RelationField}[field.type])(field))
      }
      col.createRule = def.createRule; col.updateRule = def.updateRule; col.deleteRule = def.deleteRule
      col.listRule = def.listRule; col.viewRule = def.viewRule
      for (const idx of def.indexes || []) if (!col.indexes.includes(idx)) col.indexes.push(idx)
    }
    app.save(col)
  }
  const users = app.findCollectionByNameOrId('users')
  users.createRule = null; users.deleteRule = null; users.manageRule = null
  users.listRule = 'id = @request.auth.id'; users.viewRule = 'id = @request.auth.id'; users.updateRule = 'id = @request.auth.id'
  users.passwordAuth.identityFields = ['email']
  if (!users.fields.getByName('username')) users.fields.add(new TextField({ name: 'username', max: 32 }))
  app.save(users)
  let state
  try { state = app.findFirstRecordByFilter('command_state', 'id != ""') } catch { state = new Record(app.findCollectionByNameOrId('command_state')) }
  if (!state.getString('generation')) state.set('generation', $security.randomString(32))
  state.set('schemaVersion', 1)
  if (!state.getString('ownerId')) {
    const owners = app.findRecordsByFilter('users', '', 'created', 2)
    if (owners.length === 1) state.set('ownerId', owners[0].id)
    else if (owners.length > 1) {
      const selected = $os.getenv('WORKHUB_OWNER_ID')
      if (!selected) throw new Error('OWNER_SELECTION_REQUIRED: 多账号存量库须显式配置拥有者 ID')
      app.findRecordById('users', selected); state.set('ownerId', selected)
    }
  }
  app.save(state)
  const core = require(__hooks + '/command-core.js')
  for (const table of ['transactions', 'ledgers']) {
    let offset = 0
    for (;;) {
      const rows = app.findRecordsByFilter(table, '', 'id', 200, offset)
      for (const row of rows) {
        if (table === 'transactions') {
          row.set('amountMinor', core.minorUnits(row.get('amount')))
          if (!row.getString('currency')) {
            const ledger = app.findFirstRecordByFilter('ledgers', 'localId = {:id}', { id: row.getString('ledgerId') })
            if (!['CNY', 'USD', 'EUR'].includes(ledger.getString('currency'))) throw new Error('CURRENCY_REQUIRED: ' + row.id)
            row.set('currency', ledger.getString('currency'))
          }
        } else row.set('openingBalanceMinor', core.minorUnits(row.get('openingBalance')))
        app.save(row)
      }
      if (rows.length < 200) break
      offset += rows.length
    }
  }
}, () => { throw new Error('新命令写入后不可降级丢弃操作历史；请使用兼容版本或隔离恢复') })
