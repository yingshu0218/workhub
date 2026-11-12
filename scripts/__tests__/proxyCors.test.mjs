import { it, expect } from 'vitest'
import { createServer, request } from 'node:http'
import { once } from 'node:events'
import { applyClientCors } from '../client-cors.mjs'
import { forwardHeaders } from '../../deploy/docker/proxy-headers.mjs'

it('双层代理保留Web Host：浏览器模块/字体及带Origin的请求可达，伪造forwarded头不能放行外源', async () => {
  const inner = createServer((req, res) => {
    if (!applyClientCors(req, res)) res.writeHead(200).end(req.headers.host)
  })
  inner.listen(0, '127.0.0.1'); await once(inner, 'listening')
  const target = { host: '127.0.0.1', port: inner.address().port, preserveHost: true }
  const outer = createServer((req, res) => {
    if (applyClientCors(req, res)) return
    const upstream = request({ host: target.host, port: target.port, path: req.url,
      method: req.method, headers: forwardHeaders(req, target) }, response => {
      res.writeHead(response.statusCode, response.headers); response.pipe(res)
    })
    req.pipe(upstream)
  })
  outer.listen(0, '127.0.0.1'); await once(outer, 'listening')
  const base = `http://127.0.0.1:${outer.address().port}`
  try {
    for (const path of ['/assets/index.js', '/assets/style.css', '/fonts/inter.woff2', '/relay/auth-status']) {
      const response = await fetch(base + path, { headers: { Origin: base } })
      expect(response.status).toBe(200)
      expect(await response.text()).toBe(new URL(base).host)
    }
    expect((await fetch(base + '/assets/index.js')).status).toBe(200)
    expect((await fetch(base, { headers: { Origin: 'https://foreign.example', 'X-Forwarded-Host': 'foreign.example' } })).status).toBe(403)
    expect((await fetch(base, { headers: { Origin: base, 'X-Forwarded-Host': 'foreign.example' } })).status).toBe(200)
    expect((await fetch(base, { headers: { Origin: 'https://tauri.localhost' } })).status).toBe(200)
    expect(forwardHeaders({headers:{host:'public.example'},socket:{}}, {host:'127.0.0.1',port:8090}).host).toBe('127.0.0.1:8090')
  } finally {
    for (const server of [outer, inner]) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)) }
  }
})
