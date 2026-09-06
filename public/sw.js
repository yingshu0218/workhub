/**
 * 寻鸽工作台 Service Worker（Phase 7 PWA 过渡，开发计划 2.0 终端路线·阶段二）
 * 策略：
 * - 同源静态资源（/assets/ 指纹文件 + 预缓存壳）→ cache-first
 * - 页面导航 → network-first，失败回退缓存 index.html（离线可用）
 * - API（/api/ 同步请求）→ 永远走网络，绝不缓存（数据一致性由 Dexie 本地库保证）
 * 注意：仅在生产构建注册（main.tsx），开发模式不受影响。
 */
const CACHE = 'nexus-static-v1'
const PRECACHE = ['/', '/index.html', '/favicon.svg', '/manifest.webmanifest']

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

  // 页面导航：network-first，失败回退缓存壳
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone()
          void caches.open(CACHE).then((c) => c.put('/index.html', copy))
          return res
        })
        .catch(() => caches.match('/index.html')),
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
