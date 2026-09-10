#!/usr/bin/env node
/**
 * 本地 Relay 入口（独立进程形态） —— 方案 §9.6 / §10.1（P1 第 4 步）
 *
 * 拓扑（反向连接）：浏览器主动连出 relay（浏览器无 listen 能力，§9.1）；
 * Agent 以标准 MCP 接入 relay（stdio 或 WS），二者在 relay 上配对。
 * relay 只转发「工具调用请求/结果」，不持有数据、不 import repositories。
 *
 * 核心已抽到 `relay/server.mjs`（可嵌入）。本文件只负责「独立起一个 http server 并挂载它」，
 * 便于不跑前端也能单开 relay 的调试场景。**日常开发/部署请直接用整合形态**：
 *   - dev：`npm run dev`（Vite dev server 同源挂载 /relay，无需本进程）
 *   - prod：`npm run serve`（同一 Node 进程托管 dist + relay，同源 wss）
 *
 * 用法：
 *   node relay/index.mjs                      # 启动 WS（127.0.0.1:8787）
 *   node relay/index.mjs --stdio              # 额外开启 stdio MCP 入口（供本地 CLI Agent）
 *   node relay/index.mjs --dev                # 预览响应自动附 confirmToken（仅本地联调/自动化，勿用于生产）
 *   WORKHUB_RELAY_PORT=9000 node relay/index.mjs
 *   WORKHUB_RELAY_HOST=0.0.0.0 WORKHUB_RELAY_TOKEN=<≥16位> node relay/index.mjs --public
 *   WORKHUB_RELAY_TOKEN=xxx node relay/index.mjs   # 固定 token（缺省随机生成并打印）
 *   WORKHUB_RELAY_DEBUG=1 node relay/index.mjs      # 打印浏览器往返回包（排查「有回包但客户端收不到」）
 */
import { createServer } from 'node:http'
import { createRelay } from './server.mjs'

const DEFAULT_PORT = 8787
const DEFAULT_HOST = '127.0.0.1'

const args = process.argv.slice(2)
const wantStdio = args.includes('--stdio')
const wantDev = args.includes('--dev')
const wantPublic = args.includes('--public')
const port = Number(process.env.WORKHUB_RELAY_PORT || DEFAULT_PORT)
const rawHost = process.env.WORKHUB_RELAY_HOST || DEFAULT_HOST
const token = process.env.WORKHUB_RELAY_TOKEN || undefined
const log = (m) => process.stderr.write(`${m}\n`)

// 安全闸门（方案 §四.1）：绑非回环地址 = 把端口开到公网，必须显式 --public 且 token ≥16 位。
const isLoopback = rawHost === '127.0.0.1' || rawHost === 'localhost' || rawHost === '::1'
if (!isLoopback) {
  if (!wantPublic) {
    log(`[relay] 拒绝启动：WORKHUB_RELAY_HOST=${rawHost} 非回环地址，须显式加 --public（原方案承诺「只绑本机」，不开例外不得破）`)
    process.exit(1)
  }
  if (!token || token.length < 16) {
    log('[relay] 拒绝启动：绑定非回环地址时 token 必须显式提供且 ≥16 字符（拿到 token = 拿到全部业务写权限）')
    process.exit(1)
  }
}

// 独立进程形态：默认接受根路径 `/`（保持既有 `ws://127.0.0.1:8787` 用法不变）；
// 整合形态（Vite 插件 / serve.mjs）用默认 `/relay` 同源挂载。
const relay = createRelay({ token, autoIssueConfirm: wantDev, path: process.env.WORKHUB_RELAY_PATH ?? '/', log })

const server = createServer((req, res) => {
  res.writeHead(426, { 'Content-Type': 'text/plain; charset=utf-8' })
  res.end('Upgrade Required: 请使用 WebSocket 连接（MCP over WS）')
})
server.on('upgrade', (req, socket) => relay.handleUpgrade(req, socket))

server.once('error', (e) => {
  log(`[relay] 启动失败：${e?.message ?? e}`)
  process.exit(1)
})

server.listen(port, rawHost, () => {
  const actual = server.address().port
  log(`[relay] WebSocket 已监听 ws://${rawHost}:${actual}${relay.path}`)
  log(`[relay] 接入 token：${relay.token}`)
  log(`[relay] 浏览器侧：启用「AI 桥」并填入上述地址与 token`)
  log(`[relay] MCP 协议版本：${relay.protocolVersion}（标准 tools/list + tools/call）`)
  if (wantDev) log('[relay] dev 模式：预览响应会自动附带 confirmToken（仅本地联调用，勿用于生产）')
  if (wantStdio) relay.attachStdio()
})
