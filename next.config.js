const isDev = process.env.NODE_ENV === 'development'
const contentSecurityPolicy = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ''}`,
  // style-src/font-src'ye cdnjs.cloudflare.com eklendi: Hızlı Satış (Wolvox
  // kiosk, bkz. app/wolvox/[[...path]]/route.ts proxy'si) kendi ikon fontunu
  // (Font Awesome) bu CDN'den yüklüyor - CSP engelleyince ikonlar (emoji
  // olmayanlar) hiç görünmüyordu.
  "style-src 'self' 'unsafe-inline' https://cdnjs.cloudflare.com",
  "img-src 'self' data: blob: https://api.qrserver.com https://*.tile.openstreetmap.org",
  "font-src 'self' data: https://cdnjs.cloudflare.com",
  `connect-src 'self' http://127.0.0.1:17834 http://localhost:17834 https://nominatim.openstreetmap.org${isDev ? ' ws: wss:' : ''}`,
  "media-src 'self' data: blob:",
  "worker-src 'self' blob:",
  "frame-src 'self' data: blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'self'",
].join('; ')

/** @type {import('next').NextConfig} */
const nextConfig = {
  // IIS uzerinden yayin: IIS (ARR/URL Rewrite ile) bu Node surecine ters
  // proxy yapacak - iisnode DEGIL, cunku bu uygulamada IIS'in istek basina
  // worker recycle modeliyle uyusmayan, SUREKLI ayakta kalmasi gereken arka
  // plan isleri var (WhatsApp Web/Chromium oturumu, zamanli SQL gorevleri,
  // yedekleme zamanlayicisi - bkz. instrumentation.ts). "standalone" modu
  // derlemeyi TEK BASINA calisabilen, kucuk bir klasore (.next/standalone)
  // paketler - IIS sunucusuna tasinacak olan budur (bkz. scripts/yayinla-iis.ps1).
  //
  // ONEMLI: "next start" (bu makinedeki normal calisma sekli) "output:
  // standalone" ile birlikte CALISMIYOR (Next acikca uyariyor: '"next
  // start" does not work with "output: standalone" configuration'). Bu
  // yuzden standalone SADECE IIS paketi alinirken (BUILD_TARGET=iis) acilir;
  // normal `npm run build && npm start` akisinda devre disi kalir, boylece
  // gunluk calismayi bozmaz. scripts/yayinla-iis.ps1 bu degiskeni kendisi set eder.
  ...(process.env.BUILD_TARGET === 'iis' ? { output: 'standalone' } : {}),

  // IIS/standalone paketini, bu makinede CALISAN `next start` servisinin
  // `.next` klasorune DOKUNMADAN ayri bir klasore uretmek icin. yayinla-iis.ps1
  // bunu `.next-iis` yapar; normal `gonder` akisinda set edilmez -> `.next`.
  ...(process.env.STANDALONE_DIST ? { distDir: process.env.STANDALONE_DIST } : {}),

  // Next.js 16'da varsayilan paketleyici Turbopack'tir.
  turbopack: {},

  // Sunucu dosya izlemesi (NFT) - whatsapp-web.js'in dinamik require'lari
  // izleyiciyi proje kokune kadar genisletiyor; bu da BUILD sirasinda calisan
  // sunucunun Chromium'unun KILITLI tuttugu .wwebjs_auth/.wwebjs_cache
  // dosyalarini okumaya calisip "os error 33" ile build'i patlatiyordu
  // (Next 16.3 ile sertlesen davranis). Bu klasorler calisma-zamani oturum
  // verisi - derlemeye dahil edilmelerine gerek yok.
  outputFileTracingExcludes: {
    '*': [
      '**/.wwebjs_auth/**',
      '**/.wwebjs_cache/**',
      '.wwebjs_auth/**',
      '.wwebjs_cache/**',
      '**/scripts/dev/**',
      '**/backups/**',
      '**/logs/**',
      // kpsv2/ ayri bir .NET/IIS Express projesi (NVI koprusu) - Node
      // sunucusu tarafindan HICBIR ZAMAN dosya sisteminden okunmuyor,
      // kendi IIS Express sureciyle bagimsiz calisiyor (bkz. scripts/
      // start-kpsv2.ps1). "standalone" paketine dahil olmasina gerek yok.
      '**/kpsv2/**',
      'kpsv2/**',
    ],
  },

  // Sunucunun "Next.js" oldugunu belirten "X-Powered-By" basligini
  // kaldirir - islevsel bir etkisi yok, sadece kolay parmak izi
  // cikarmayi (framework/versiyon tespiti) biraz zorlastirir.
  poweredByHeader: false,

  transpilePackages: ['@prisma/client'],

  // KAPS / NVİ Sorgu Ekranı (kpsv2 IIS Express uygulamasi) SADECE sunucuda
  // localhost:3500'e bagli. Uygulamanin KENDI origin'i uzerinden (/kaps)
  // ters-proxy'lenir - bkz. app/kaps/[[...path]]/route.ts (ASP.NET postback'i
  // icin <base href> enjeksiyonu + cookie yol duzeltmesi gerektiginden basit
  // "rewrites" YETMEDI, route handler'a tasindi).

  // Gelistirme ortaminda LAN uzerinden acilan tarayicilarin dev server'a
  // istek atabilmesi icin yerel ag origin'lerini acikca izinli yap.
  allowedDevOrigins: [
    'localhost',
    '127.0.0.1',
    '10.0.0.183',
    '10.0.0.*',
    '10.20.1.100',
    '10.20.1.*',
    '192.168.*.*',
    // Kurumun dis (statik) IP'si - dev sunucusuna bu adres uzerinden
    // acilan tarayicilarin istek atabilmesi icin. (Prod'da - next start -
    // bu liste zaten yok sayilir.)
    '88.247.62.145',
  ],

  // Kullanici istegi (14 Eylul 2026): "/onlinebasvuru" sade adresi
  // baslangicta TEK bir forma (app_1) sabit yonlendiriyordu. 2. tur istek:
  // kurum ayni anda BIRDEN FAZLA online basvuru turu actiginda vatandas
  // buradan hangisine basvuracagini SECEBILMELI - bu artik statik bir
  // redirects() kurali ile yapilamaz (aktif form sayisina gore davranisi
  // DEGISMELI), bu yuzden gercek bir sayfaya tasindi: bkz.
  // app/onlinebasvuru/page.tsx (tek aktif form varsa dogrudan o forma
  // yonlendirir, birden fazlaysa secim sayfasi gosterir) ve proxy.ts'teki
  // public-erisim istisnasi.

  async headers() {
    // 'use client' sayfalari Next tarafindan uzun sureli
    // (s-maxage=31536000) onbelleklenir; ne "export const dynamic" ne
    // wildcard headers() bunu ezebiliyor - ama TAM (exact) veya prefix'li
    // source'lar EZIYOR (ör. mevcut "/dashboard" kurali). Bu yuzden TUM
    // sayfa oneklerini tek tek "no-store" ile isaretliyoruz - boylece her
    // deploy sonrasi tarayici taze HTML/JS alir, "silinen panel hala
    // goruniyor" gibi hayalet sorunlar biter.
    const pagePrefixes = [
      '/', '/login', '/kurulum', '/online', '/onlinebasvuru', '/dashboard', '/documents',
      '/beneficiary', '/approval-queue', '/communication', '/assistance',
      '/reports', '/requests', '/gulkart', '/settings', '/users', '/workflow',
      '/logs', '/hakedis', '/muhasebe', '/dernek', '/satis', '/forms-report', '/scheduled-tasks', '/sql-monitor',
    ]
    const noStorePageRules = pagePrefixes.flatMap((prefix) => {
      const base = prefix === '/' ? '/' : prefix
      const rules = [{ source: base, headers: [{ key: 'Cache-Control', value: 'no-store, must-revalidate' }] }]
      if (prefix !== '/') {
        rules.push({ source: `${prefix}/:path*`, headers: [{ key: 'Cache-Control', value: 'no-store, must-revalidate' }] })
      }
      return rules
    })

    return [
      ...noStorePageRules,
      {
        source: '/:path*',
        headers: [
          { key: 'Content-Security-Policy', value: contentSecurityPolicy },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(self), microphone=(), geolocation=(self), browsing-topics=()' },
          { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
          { key: 'X-DNS-Prefetch-Control', value: 'off' },
          { key: 'X-Permitted-Cross-Domain-Policies', value: 'none' },
          // HTTPS uzerinden sunulmadikca tarayicilar bu basligi zaten yok
          // sayar - HTTP'de zararsizdir, ileride HTTPS'e gecildiginde
          // protokol dusurme (downgrade) saldirilarina karsi koruma saglar.
          { key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' },
        ],
      },
      {
        // Hash'li (icerik degisince adi degisen) statik varliklar - kalici
        // onbellek. Yukaridaki genel "no-store"u SON eslesen kural olarak ezer.
        // SADECE PROD build'de (webpack content-hash gercekten degisir) -
        // DEV'de (`next dev`) bu chunk dosya adlari BUILD'LER ARASI ayni
        // kalabiliyor; "immutable, max-age=1 yil" tarayiciya "bu URL'i BIR
        // DAHA HIC AGA SORMA" dedigi icin - Ctrl+F5/Ctrl+Shift+R BILE bunu
        // her zaman atlatmiyor - dev sunucusu yeniden baslatilip kod
        // degissede tarayici HALA eski JS'i kullanmaya devam ediyordu
        // ("hiçbir değişiklik yok" sikayetlerinin gercek kok nedeni buydu).
        source: '/_next/static/:path*',
        headers: isDev
          ? [{ key: 'Cache-Control', value: 'no-store, must-revalidate' }]
          : [{ key: 'Cache-Control', value: 'public, max-age=31536000, immutable' }],
      },
    ]
  },
}

module.exports = nextConfig
