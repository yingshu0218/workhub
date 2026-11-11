import {expect,it} from 'vitest'
import ts from 'typescript'
import {readFileSync} from 'node:fs'
import {resolve} from 'node:path'
it('所有业务实体的持久字段与共享 SyncMeta 都由 PB schema 承接（本地 blob/synced 除外）',()=>{
 const path=resolve('src/db/types.ts'),program=ts.createProgram([path,resolve('src/db/db.ts')],{target:ts.ScriptTarget.ES2022,skipLibCheck:true}),checker=program.getTypeChecker(),source=program.getSourceFile(path)!
 const schema=JSON.parse(readFileSync('pb_setup/collections.json','utf8')) as {name:string;fields:{name:string}[]}[]
 const entities:Record<string,string>={workspaces:'Workspace',customers:'Customer',interactions:'Interaction',ledgers:'Ledger',transactions:'Transaction',todos:'Todo',todoLists:'TodoList',notes:'Note',noteFolders:'NoteFolder',quickNotes:'QuickNote',projects:'Project',projectMilestones:'ProjectMilestone',habits:'Habit',habitLogs:'HabitLog',trophies:'Trophy',attachments:'Attachment',module_configs:'ModuleConfig',customerGroups:'CustomerGroup',links:'Link'}
 const missing:string[]=[]
 for(const [table,name] of Object.entries(entities)){
  const declaration=[...source.statements,...program.getSourceFile(resolve('src/db/db.ts'))!.statements].find(n=>ts.isInterfaceDeclaration(n)&&n.name.text===name)
  expect(declaration,name).toBeTruthy()
  const fields=new Set(schema.find(c=>c.name===table)!.fields.map(f=>f.name))
  for(const property of checker.getTypeAtLocation(declaration!).getProperties())if(!['id','blob','synced'].includes(property.name)&&!fields.has(property.name))missing.push(table+'.'+property.name)
 }
 expect(missing).toEqual([])
})
