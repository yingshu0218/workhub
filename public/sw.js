/**
 * 寻鸽工作台 Service Worker（Phase 7 PWA 过渡，开发计划 2.0 终端路线·阶段二）
 * 策略：
 * - 同源静态资源（/assets/ 指纹文件 + 预缓存壳）→ cache-first
 * - 页面导航 → network-first，失败回退缓存 index.html（离线可用）
 * - API（/api/ 同步请求）→ 永远走网络，绝不缓存（数据一致性由 Dexie 本地库保证）
 * 注意：仅在生产构建注册（main.tsx），开发模式不受影响。
 * 版本：缓存名随发布 bump（nexus-static-vN），activate 时清理旧缓存；
 * SW 文件更新会触发 install → skipWaiting → clients.claim 的自动接管。
 */
const CACHE = 'nexus-static-v3'
const PRECACHE = ['/', '/index.html', '/favicon.svg', '/manifest.webmanifest']

/** 断网导航的提示页（不再回退缓存壳：见 fetch 里的注释） */
const OFFLINE_HTML = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>无法连接服务器</title>
<style>body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;
background:#f8f9ff;color:#191c23;font:14px/1.7 Inter,"Noto Sans SC",system-ui,sans-serif}
main{max-width:420px;padding:32px;text-align:center}h1{font-size:18px;margin:0 0 8px}
p{margin:0;color:#5a6070}</style></head><body><main>
<h1>无法连接服务器</h1>
<p>工作台的数据在服务器上，需要联网打开。请检查网络后重试。</p>
</main></body></html>`

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(PRECACHE)).then(() => self.skipWaiting()),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', (event) => {
  const req = event.request
  if (req.method !== 'GET') return
  const url = new URL(req.url)
  if (url.origin !== self.location.origin) return

  // API：网络优先且不落缓存（离线时同步引擎本地写入，不依赖 SW 缓存）
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(fetch(req).catch(() => new Response(JSON.stringify({ error: 'offline' }), { status: 503, headers: { 'Content-Type': 'application/json' } })))
    return
  }

  // 页面导航：**只走网络**（2026-11-03 起 Web 端不做离线兜底）
  // 旧行为是失败回退缓存壳 → 断网也能打开旧页面、再读本地库 → 出现「服务器是空的、
  // 页面却是满的」这种自相矛盾的状态。服务端唯一真源下页面必须在线打开；
  // 断网就直说打不开，不装作能用（离线场景由桌面端承担）。
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req).catch(
        () =>
          new Response(OFFLINE_HTML, {
            status: 503,
            headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
          }),
      ),
    )
    return
  }

  // 其余同源静态资源：cache-first + 后台更新
  event.respondWith(
    caches.match(req).then((cached) => {
      const network = fetch(req)
        .then((res) => {
          if (res.ok && url.pathname.startsWith('/assets/')) {
            const copy = res.clone()
            void caches.open(CACHE).then((c) => c.put(req, copy))
          }
          return res
        })
        .catch(() => cached)
      return cached || network
    }),
  )
})
