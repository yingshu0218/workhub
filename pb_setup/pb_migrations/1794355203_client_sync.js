migrate(app=>{
  // 全局增量读取不能退化为按对象索引扫描全部历史。
  const effects=app.findCollectionByNameOrId('operation_effects')
  const index='CREATE INDEX idx_effect_sync ON operation_effects (sequence, ordinal, id)'
  if(!effects.indexes.includes(index)){effects.indexes.push(index);app.save(effects)}
  // 同步到新设备的文件元数据不能成为匿名直链，保留既有文件并加访问门禁。
  for(const name of ['attachments','attachment_staging']){const collection=app.findCollectionByNameOrId(name);collection.fields.getByName('file').protected=true;app.save(collection)}
},()=>{throw new Error('已切换客户端同步协议，不允许删除同步索引回退')})
