/**
 * 当前工作区常量 —— 从 db.ts 提出（agentOps 服务端化 P1）
 *
 * 为什么单独成文件：`DEFAULT_WORKSPACE_ID` 此前住在 db.ts，而 `newId()`（repositories）
 * 依赖它——执行链里任何模块 import db.ts 都会把整份 Dexie schema 拖进服务端 bundle。
 * 常量本体零依赖，提出后服务端可只 import 本文件；db.ts 保留 re-export 不破坏既有引用。
 *
 * 本期单工作区：Personal（种子写入 ws-main）。
 */
export const DEFAULT_WORKSPACE_ID = 'ws-main'
