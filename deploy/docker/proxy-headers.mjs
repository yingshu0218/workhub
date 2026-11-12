/**
 * 补齐反代头。
 *
 * ⚠️ 这里必须**先把原始 Host 记进 `X-Forwarded-Host`，再改写 `Host`**（2026-10-28 修）。
 * 原先只改写 `Host`、不补 forwarded 头，导致上游 serve.mjs 里 `req.headers.host` 变成
 * `127.0.0.1:9001` —— relay 拿它拼配对响应里的 `url`，返回
 * `https://127.0.0.1:9001/relay/mcp`，任何照着这个字段配置的 MCP 客户端都必然连不上，
 * 而错误现场看起来完全像「客户端配错」。
 */
export function forwardHeaders(req, target) {
  // 外层 nginx 已透传时沿用它的值（多级反代只有最外层知道真实域名）
  const originalHost = req.headers['x-forwarded-host'] || req.headers.host
  // Web 内层仍执行同源校验，必须保留浏览器实际请求的 Host；不能用可伪造的 forwarded 头替代。
  const headers = { ...req.headers, host: target.preserveHost ? req.headers.host : `${target.host}:${target.port}` }
  if (originalHost) headers['x-forwarded-host'] = originalHost
  const ip = req.socket?.remoteAddress
  if (ip) headers['x-forwarded-for'] = headers['x-forwarded-for'] ? `${headers['x-forwarded-for']}, ${ip}` : ip
  headers['x-forwarded-proto'] = req.headers['x-forwarded-proto'] || 'http'
  return headers
}

