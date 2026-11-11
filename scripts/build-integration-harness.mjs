import { build } from 'esbuild'
await build({entryPoints:['scripts/integration/repositories.ts'],bundle:true,platform:'node',format:'esm',target:'node20',tsconfig:'tsconfig.app.json',outfile:'dist-server/repository-harness.mjs',plugins:[{name:'no-browser',setup(b){b.onResolve({filter:/browser$/},a=>a.kind==='dynamic-import'&&a.importer.includes('storage')?{path:a.path,external:true}:undefined)}}]})

await build({entryPoints:['scripts/integration/client-runtime.ts'],bundle:true,platform:'node',format:'esm',target:'node24',tsconfig:'tsconfig.app.json',outfile:'dist-server/client-runtime.mjs',define:{'import.meta.env.PROD':'true','import.meta.env.DEV':'false'}})
