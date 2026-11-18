// 可撤销 Agent 配对：旧 tokenHash / capabilities / generation 语义保持不变。
migrate(app => {
  const col = app.findCollectionByNameOrId('agent_credentials')
  const fields = [
    new TextField({ name: 'pairCodeHash' }),
    new NumberField({ name: 'pairExpiresAt' }),
    new NumberField({ name: 'pairedAt' }),
  ]
  for (const field of fields) if (!col.fields.getByName(field.name)) col.fields.add(field)
  const index = "CREATE UNIQUE INDEX idx_agent_pair_code_hash ON agent_credentials(pairCodeHash) WHERE pairCodeHash != ''"
  if (!col.indexes.includes(index)) col.indexes.push(index)
  app.save(col)
}, app => {
  const col = app.findCollectionByNameOrId('agent_credentials')
  col.indexes = col.indexes.filter(index => !index.includes('idx_agent_pair_code_hash'))
  for (const name of ['pairCodeHash', 'pairExpiresAt', 'pairedAt']) col.fields.removeByName(name)
  app.save(col)
})
