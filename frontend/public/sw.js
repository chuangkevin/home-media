/**
 * Service Worker for 家用多媒體中心 PWA
 *
 * 緩存策略：
 * - App Shell (HTML, CSS, JS) - Cache First
 * - API 請求 - Network First
 * - 音頻串流 - 不緩存（由後端 audio-cache 處理）
 * - 靜態資源 - Cache First
 */

const CACHE_NAME = 'home-media-v1';
const STATIC_CACHE_NAME = 'home-media-static-v1';

// 需要預緩存的資源
const PRECACHE_URLS = [
  '/',
  '/index.html',
  '/manifest.json',
];

// 安裝事件 - 預緩存核心資源
self.addEventListener('install', (event) => {
  console.log('[SW] Installing...');
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        console.log('[SW] Precaching app shell');
        return cache.addAll(PRECACHE_URLS);
      })
      .then(() => self.skipWaiting())
  );
});

// 啟動事件 - 清理舊緩存
self.addEventListener('activate', (event) => {
  console.log('[SW] Activating...');
  event.waitUntil(
    caches.keys()
      .then((cacheNames) => {
        return Promise.all(
          cacheNames
            .filter((name) => name !== CACHE_NAME && name !== STATIC_CACHE_NAME)
            .map((name) => {
              console.log('[SW] Deleting old cache:', name);
              return caches.delete(name);
            })
        );
      })
      .then(() => self.clients.claim())
  );
});

// 請求攔截
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // 跳過非 HTTP(S) 請求
  if (!request.url.startsWith('http')) {
    return;
  }

  // 跳過 WebSocket 連接
  if (request.url.includes('/socket.io')) {
    return;
  }

  // API 請求 - Network First
  if (url.pathname.startsWith('/api')) {
    event.respondWith(networkFirst(request));
    return;
  }

  // 音頻串流 - 直接網絡請求，不緩存
  if (url.pathname.includes('/stream') || url.pathname.includes('/audio')) {
    return;
  }

  // 靜態資源 (JS, CSS, 圖片) - Cache First
  if (isStaticAsset(request.url)) {
    event.respondWith(cacheFirst(request));
    return;
  }

  // 其他請求 - Network First with Cache Fallback
  event.respondWith(networkFirstWithFallback(request));
});

// 判斷是否為靜態資源
function isStaticAsset(url) {
  return /\.(js|css|png|jpg|jpeg|gif|svg|woff|woff2|ttf|eot|ico)(\?.*)?$/.test(url);
}

// Cache First 策略
async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) {
    return cached;
  }

  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(STATIC_CACHE_NAME);
      cache.put(request, response.clone());
    }
    return response;
  } catch (error) {
    console.error('[SW] Cache first fetch failed:', error);
    throw error;
  }
}

// Network First 策略
async function networkFirst(request) {
  try {
    const response = await fetch(request);
    return response;
  } catch (error) {
    console.warn('[SW] Network first fetch failed for:', request.url, error);
    
    // 嘗試從緩存獲取
    const cached = await caches.match(request);
    if (cached) {
      console.log('[SW] Returning cached response for:', request.url);
      return cached;
    }
    
    // 如果既沒有網絡也沒有緩存，返回 503 Service Unavailable
    // 而不是拋出錯誤，讓應用有機會優雅地處理
    console.error('[SW] No network and no cache for:', request.url);
    return new Response(
      JSON.stringify({ 
        error: 'Service Unavailable',
        message: 'Network request failed and no cached response available'
      }),
      { 
        status: 503,
        statusText: 'Service Unavailable',
        headers: { 'Content-Type': 'application/json' }
      }
    );
  }
}

// Network First with Offline Fallback
async function networkFirstWithFallback(request) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, response.clone());
    }
    return response;
  } catch (error) {
    console.warn('[SW] Network first with fallback failed for:', request.url, error);
    
    const cached = await caches.match(request);
    if (cached) {
      console.log('[SW] Returning cached response for:', request.url);
      return cached;
    }

    // 如果是導航請求，返回首頁（SPA fallback）
    if (request.mode === 'navigate') {
      const indexCache = await caches.match('/index.html');
      if (indexCache) {
        console.log('[SW] Returning cached index.html for navigate request');
        return indexCache;
      }
    }

    // 返回 503 而不是拋出錯誤
    console.error('[SW] No fallback available for:', request.url);
    return new Response(
      'Service Unavailable',
      { 
        status: 503,
        statusText: 'Service Unavailable'
      }
    );
  }
}

// 接收來自主線程的消息
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
