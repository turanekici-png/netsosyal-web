import type { MetadataRoute } from 'next'

// Next.js bu dosyayi otomatik olarak /manifest.webmanifest adresinde
// yayinlar ve sayfa <head>'ine gerekli <link rel="manifest"> etiketini
// KENDISI ekler - layout.tsx'te ekstra bir sey yapmaya gerek yok.
//
// Bu manifest, tarayicinin "Uygulama olarak yükle" / "Ana ekrana ekle"
// ozelliginde kullanilir. "display: standalone" -> yuklendiginde adres
// cubugu olmadan, kendi penceresinde/uygulama gibi acilir.
//
// NOT: Android/masaüstünde TEK DOKUNUSLA "Yükle" cikmasi icin site HTTPS
// uzerinden sunulmali. HTTP'de: iOS Safari "Ana Ekrana Ekle" yine calisir;
// Android/masaüstünde manifest ikonuyla bir kisayol olusturulabilir.
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: '/',
    name: 'Sosyal Yardım Yönetim Sistemi',
    short_name: 'Sosyal Yardım',
    description: 'Sivas Belediyesi Sosyal Yardım Yönetim Sistemi',
    start_url: '/?source=pwa',
    scope: '/',
    display: 'standalone',
    orientation: 'any',
    lang: 'tr',
    dir: 'ltr',
    background_color: '#003f82',
    theme_color: '#0076b6',
    categories: ['business', 'productivity', 'government'],
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-192-maskable.png', sizes: '192x192', type: 'image/png', purpose: 'maskable' },
      { src: '/icons/icon-512-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  }
}
