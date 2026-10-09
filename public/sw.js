// Sosyal Yardım Yönetim Sistemi - Service Worker
//
// Iki isi var:
//  1) PUSH bildirimleri (masaüstü bildirimi) göster + tiklaninca sayfayi ac.
//  2) Uygulamanin "yüklenebilir" (PWA - ana ekrana/masaüstüne ekleme) olmasi
//     icin gereken minimum fetch isleyicisi.
//
// ONEMLI: Bu SW HTML/gezinme yanitlarini ONBELLEGE ALMAZ. Uygulama bilincli
// olarak "her istekte taze icerik" ister (bkz. app/layout.tsx force-dynamic
// notu) - "deploy sonrasi eski ekran" sorunu yasanmasin diye. Yalnizca ag
// TAMAMEN kesikken gezinme isteklerine kucuk bir "cevrimdisi" sayfasi
// dondurulur.

const OFFLINE_CACHE = 'netsosyal-offline-v2'
const OFFLINE_URL = '/offline.html'

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(OFFLINE_CACHE).then((cache) => cache.addAll([OFFLINE_URL, '/icons/icon-192.png'])),
  )
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    Promise.all([
      caches.keys().then((keys) =>
        Promise.all(keys.filter((k) => k !== OFFLINE_CACHE).map((k) => caches.delete(k))),
      ),
      self.clients.claim(),
    ]),
  )
})

self.addEventListener('fetch', (event) => {
  const request = event.request
  // SADECE gezinme (adres cubugu / link tiklamasi) isteklerinde devreye gir;
  // once agdan dene, ag yoksa cevrimdisi sayfasi. Diger her sey (JS/CSS/API/
  // resim) DOKUNULMADAN normal akista gider.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(() => caches.match(OFFLINE_URL)),
    )
  }
})

self.addEventListener('push', (event) => {
  let data = { title: 'Sosyal Yardım Yönetim Sistemi', body: 'Yeni bir bildiriminiz var.' }
  try {
    if (event.data) data = { ...data, ...event.data.json() }
  } catch {
    // JSON degilse varsayilan metinle devam et.
  }

  const options = {
    body: data.body,
    icon: '/icon.png',
    badge: '/icon.png',
    tag: data.tag || 'netsosyal-notification',
    data: { url: data.url || '/' },
    requireInteraction: true,
  }

  event.waitUntil(
    Promise.all([
      self.registration.showNotification(data.title, options),
      // Sekme ACIK (arka planda/simge durumunda bile) ise, sayfanın kendi
      // sesli uyarısının (varsayılan sistem sesinden daha belirgin - bkz.
      // lib/notificationSound.ts) ANINDA çalması için haber verilir.
      self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
        clientList.forEach((client) => client.postMessage({ type: 'netsosyal-push-sound' }))
      }),
    ]),
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const targetUrl = event.notification.data?.url || '/'

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if ('focus' in client) {
          client.focus()
          if ('navigate' in client) client.navigate(targetUrl)
          return
        }
      }
      if (self.clients.openWindow) return self.clients.openWindow(targetUrl)
    }),
  )
})
