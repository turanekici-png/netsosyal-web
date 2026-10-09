import { NextResponse, type NextRequest } from 'next/server'
import { settingService } from '@/lib/services/settings.service'
import { USER_PERMISSIONS_SETTING_KEY, type UserPermissionsById } from '@/lib/constants/userPermissions'
import { STARTUP_PAGE_OPTIONS } from '@/lib/constants/startupPages'
import { hasPageAccess, getPermissionPath, isKnownInternalPath, hasHizliSatisAccess } from '@/lib/constants/pageAccess'

// Kullanici istegi (14 Eylul 2026, 15. tur): "yetkisi olmayan bir kullanici
// gizlenen buton disinda da olsa hicbir sayfaya giris yapamasin". Onceden
// sayfa-bazli yetki kontrolu SADECE istemci tarafinda (AppShell.tsx,
// sayfa ZATEN sunucuda render/veri-cekimi TAMAMLANDIKTAN sonra) yapiliyordu -
// yani yetkisiz bir kullanici adres cubuguna doğrudan URL yazdiginda, o
// sayfanin sunucu bileseni once verisini çekip HTML/RSC gövdesine
// gömüyordu, AppShell bunu SADECE GORSEL olarak "AccessDenied" kartinin
// ARKASINA gizliyordu (agir istek/DOM incelemesiyle veri yine de goruluyordu).
// Bu, Node.js runtime'a gecirilerek (asagidaki "export const runtime")
// veritabanindan (Setting tablosu, 30 sn'lik bellek onbellegi - bkz.
// settings.service.ts - bu yuzden HER istekte DB'ye gitmiyor) gercek yetkiyi
// okuyup, erisimi olmayan bilinen bir ic sayfaya (bkz. KNOWN_INTERNAL_ROUTE_
// PREFIXES) gidildiginde sayfa hic render edilmeden, kullanicinin ERISIMI
// OLAN ilk sayfaya (app/page.tsx'teki "/" fallback taramasiyla AYNI mantik)
// yonlendirilerek kapatiliyor.
async function resolveAllowedRedirect(userId: string, pathname: string, searchParams: URLSearchParams): Promise<string | null> {
  if (pathname === '/' || !isKnownInternalPath(pathname)) return null

  try {
    const permissionsSetting = await settingService.getByKey(USER_PERMISSIONS_SETTING_KEY)
    const permissions = permissionsSetting?.value as UserPermissionsById | undefined
    const permissionConfig = permissions?.[userId] ?? null
    // Kullanici istegi (2026-10-07, 3. tur): "/satis" (Hizli Satis) artik
    // iki ayri yolla erisilebilir (bkz. hasHizliSatisAccess - YENI bagimsiz
    // "/hizli-satis" yetkisi VEYA ESKI genel "/muhasebe" yetkisi) - tek
    // getPermissionPath eslemesi (sadece "/muhasebe"ye bakardi) bunu EKSIK
    // birakiyordu (SADECE "/hizli-satis" yetkisi olan - "/muhasebe" OLMAYAN -
    // bir kullanici "/satis"a dogrudan giderken BURADAN uzaklastiriliyordu).
    const canAccessPathOrOption = (path: string) => (
      path === '/satis' ? hasHizliSatisAccess(permissionConfig) : hasPageAccess(permissionConfig, getPermissionPath(path, searchParams))
    )

    if (canAccessPathOrOption(pathname)) return null

    const fallback = STARTUP_PAGE_OPTIONS.find((opt) => canAccessPathOrOption(opt.path))
    if (!fallback || fallback.path === pathname) return null

    return fallback.path
  } catch {
    // Ayar okunamadi (DB gecici sorun) - butun uygulamanin sayfa yonlendirmesini
    // burada durdurmak yerine (her sayfa gorunumu bu kontrolden geciyor,
    // API rotalarindaki tekil requireApiAccess'ten FARKLI olarak etki alani
    // TUM uygulama), bu ek katman sessizce atlanir; asil yetki denetimi zaten
    // API rotalarinda (requireApiAccess) ve AppShell.tsx'te devam eder.
    return null
  }
}

// NOT: "proxy.ts" (Next.js 16'nin eski "middleware.ts" yerine gecen adi)
// HER ZAMAN Node.js runtime'da calisir (Edge degil) - "export const runtime"
// ile secim yapilamaz, build bunu acikca reddediyor ("Route segment config
// is not allowed in Proxy file"). Bu yuzden yukaridaki DB tabanli (Prisma)
// yetki kontrolu ekstra bir ayar gerekmeden calisir. Dosyanin geri kalanindaki
// oturum dogrulamasinin Web Crypto ile elle yazilmis olmasi artik zorunluluktan
// degil, tarihi nedenlerle (middleware.ts Edge donemi) boyle - dokunulmadi.
const PUBLIC_FILE_PATTERN = /\.(.*)$/
const AUTH_COOKIE_NAME = 'netsosyal_session'
// Eski cerez adi - yeniden adlandirma sirasinda mevcut oturumlar dusmesin.
const LEGACY_AUTH_COOKIE_NAMES = ['nextsosyal_session']

// lib/auth.ts ile AYNI deger (Edge runtime o modulu import edemedigi icin
// burada tekrar tanimli). Degistirirken iki dosyayi birlikte guncelle.
const SESSION_ABSOLUTE_SECONDS = 60 * 60 * 24

function readSessionCookie(request: NextRequest): string | undefined {
  const current = request.cookies.get(AUTH_COOKIE_NAME)?.value
  if (current) return current
  for (const legacy of LEGACY_AUTH_COOKIE_NAMES) {
    const v = request.cookies.get(legacy)?.value
    if (v) return v
  }
  return undefined
}

function getAuthSecret() {
  const secret = process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET
  if (!secret) throw new Error('AUTH_SECRET tanımlanmalıdır.')
  return secret
}

function bufferToHex(buffer: ArrayBuffer) {
  return Array.from(new Uint8Array(buffer))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}

async function signPayload(payload: string) {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(getAuthSecret()),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload))

  return bufferToHex(signature)
}

// Edge runtime'da Node'un crypto.timingSafeEqual'i yok (lib/auth.ts'teki
// asil/kanonik oturum dogrulamasi bunu kullanir) - burada AYNI sabit-zamanli
// karsilastirma davranisini elle tekrar ediyoruz: erken "return" ile kisa
// devre yapmadan TUM karakterleri gezip XOR biriktiriyoruz, boylece imza
// karsilastirmasinin suresi eslesen karakter sayisina gore sizinti vermiyor.
function timingSafeStringEqual(a: string, b: string) {
  if (a.length !== b.length) return false

  let mismatch = 0
  for (let index = 0; index < a.length; index += 1) {
    mismatch |= a.charCodeAt(index) ^ b.charCodeAt(index)
  }
  return mismatch === 0
}

// Hem yeni 4 parcali (`userId.issuedAt.expiresAt.sig`) hem eski 3 parcali
// (`userId.expiresAt.sig`) bicimi kabul eder - bkz. lib/auth.ts. expiresAt,
// hareketsizlik (idle) son tarihidir; her kullanici etkilesiminde istemci
// /api/auth/heartbeat ile ileri attirir. 180 dk islem yapilmazsa dolar.
async function parseSessionValue(value?: string | null) {
  if (!value) return null

  const parts = value.split('.')
  const nowSeconds = Math.floor(Date.now() / 1000)

  if (parts.length === 4) {
    const [userId, issuedAtValue, expiresAtValue, signature] = parts
    if (!userId || !/^\d+$/.test(userId) || !/^\d+$/.test(issuedAtValue) || !/^\d+$/.test(expiresAtValue) || !signature) {
      return null
    }
    const issuedAt = Number(issuedAtValue)
    const expiresAt = Number(expiresAtValue)
    if (!Number.isSafeInteger(issuedAt) || !Number.isSafeInteger(expiresAt)) return null
    if (expiresAt <= nowSeconds) return null
    if (issuedAt + SESSION_ABSOLUTE_SECONDS <= nowSeconds) return null
    const expected = await signPayload(`${userId}.${issuedAt}.${expiresAt}`)
    return timingSafeStringEqual(signature, expected) ? userId : null
  }

  if (parts.length === 3) {
    const [userId, expiresAtValue, signature] = parts
    if (!userId || !/^\d+$/.test(userId) || !/^\d+$/.test(expiresAtValue) || !signature) return null
    const expiresAt = Number(expiresAtValue)
    if (!Number.isSafeInteger(expiresAt) || expiresAt <= nowSeconds) return null
    const expected = await signPayload(`${userId}.${expiresAt}`)
    return timingSafeStringEqual(signature, expected) ? userId : null
  }

  return null
}

function isPublicApiRequest(request: NextRequest) {
  const { pathname } = request.nextUrl
  const method = request.method.toUpperCase()

  if (pathname === '/api/auth/login' || pathname === '/api/auth/logout' || pathname === '/api/auth/change-password' || pathname === '/api/auth/forgot-password' || pathname === '/api/auth/verify-otp') return true
  if (pathname === '/api/online-applications' && method === 'POST') return true
  if (pathname === '/api/online-applications/status' && method === 'POST') return true
  if (pathname === '/api/nvi' && method === 'POST') return true
  // İlk kurulum akışı (bkz. app/kurulum/page.tsx) - veritabanı/tablolar/ilk
  // kullanıcı henüz yokken çalışır, o an tanımı gereği kimsenin oturumu
  // olamaz. lib/services/provisioning.service.ts kendi içinde, sistem
  // zaten kuruluysa (mevcut/canlı kurulumlar) bu uçların hiçbir etkisi
  // olmayacağını garanti eder.
  if (pathname === '/api/setup/status' && method === 'GET') return true
  if (pathname === '/api/setup/provision' && method === 'POST') return true

  return false
}

function isUnsafeMethod(method: string) {
  return !['GET', 'HEAD', 'OPTIONS'].includes(method.toUpperCase())
}

function isSameOriginBrowserRequest(request: NextRequest) {
  if (!isUnsafeMethod(request.method)) return true

  const origin = request.headers.get('origin')
  if (!origin) return true

  const forwardedHost = request.headers.get('x-forwarded-host')?.split(',')[0]?.trim()
  const host = forwardedHost || request.headers.get('host')
  if (!host) return false

  const forwardedProtocol = request.headers.get('x-forwarded-proto')?.split(',')[0]?.trim()
  const protocol = forwardedProtocol || request.nextUrl.protocol.replace(':', '')

  try {
    return new URL(origin).origin === `${protocol}://${host}`
  } catch {
    return false
  }
}

function apiResponse() {
  const response = NextResponse.next()
  response.headers.set('Cache-Control', 'no-store')
  return response
}

// Kullanici istegi (Ekim 2026): 'use client' sayfalari Next tarafindan
// "statik" isaretlenip 1 YILLIK onbellek basligi aliyor - her deploy
// sonrasi tarayici ESKI HTML kabugunu (ve eski JS parcalarini) gosteriyor,
// "Kısayollar paneli hala goruniyor" gibi hayalet sorunlara yol aciyor.
// next.config.js headers() Cache-Control'u statik sayfalar icin (wildcard
// source'ta) guvenilir sekilde EZEMIYOR; middleware ise HER istekte
// calisip yaniti kesin gunceller. Sadece SAYFA (HTML) istekleri icin -
// /_next statik varliklar (hash'li, kalici onbellekli) DOKUNULMAZ.
function pageResponse() {
  const response = NextResponse.next()
  response.headers.set('Cache-Control', 'no-store, must-revalidate')
  return response
}

export async function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl

  if (pathname.startsWith('/api')) {
    if (!isSameOriginBrowserRequest(request)) {
      return NextResponse.json(
        { success: false, error: 'Gecersiz istek kaynagi.' },
        { status: 403, headers: { 'Cache-Control': 'no-store' } },
      )
    }

    if (isPublicApiRequest(request)) return apiResponse()

    const userId = await parseSessionValue(readSessionCookie(request))
    if (!userId) {
      return NextResponse.json(
        { success: false, error: 'Oturum bulunamadi.' },
        { status: 401, headers: { 'Cache-Control': 'no-store' } },
      )
    }

    return apiResponse()
  }

  if (
    pathname.startsWith('/_next') ||
    pathname === '/favicon.ico' ||
    PUBLIC_FILE_PATTERN.test(pathname)
  ) {
    return NextResponse.next()
  }

  if (pathname === '/login') {
    const userId = await parseSessionValue(readSessionCookie(request))
    if (userId) {
      // "/" -> kisinin sectigi baslangic sayfasina yonlenir (bkz. app/page.tsx).
      return NextResponse.redirect(new URL('/', request.url))
    }
    return pageResponse()
  }

  // İlk kurulum sayfası (bkz. yukarıdaki not) - oturum gerektirmez, mevcut
  // kurulu sistemlerde zaten kendisi otomatik /login'e döner.
  if (pathname === '/kurulum') {
    return pageResponse()
  }

  if (pathname === '/online' && request.nextUrl.searchParams.get('form')) {
    return pageResponse()
  }

  // Kullanici istegi (14 Eylul 2026, 2. tur): "/onlinebasvuru" artik kurumun
  // acik olan TUM online basvuru turlerinin listelendigi (veya tek form
  // aktifse dogrudan ona yonlendiren) genel, oturum GEREKTIRMEYEN ana sayfa -
  // bkz. app/onlinebasvuru/page.tsx. Eskiden bu adres next.config.js
  // redirects() ile (middleware/proxy hic calismadan, config asamasinda)
  // cozuluyordu; artik gercek bir sayfa oldugu icin BURADA da acikca genel
  // erisime acilmasi gerekiyor - aksi halde asagidaki oturum kontrolu
  // vatandasi /login'e yonlendirirdi.
  if (pathname === '/onlinebasvuru') {
    return pageResponse()
  }

  const userId = await parseSessionValue(readSessionCookie(request))

  // Kullanici istegi (2026-10-07, 6. tur): "/satis" -> "/wolvox/hizli-satis"
  // zinciri eskiden app/satis/page.tsx icinde React'in kendi redirect()'i ile
  // yapiliyordu - bu, Next.js'in istemci tarafi (RSC) gezinme mekanizmasiyla
  // bir SONRAKI adimda GERCEK bir Route Handler'a (app/wolvox/[[...path]]/
  // route.ts, Flask'tan HAM HTML donduren bir proxy - normal bir React
  // sayfasi DEGIL) atlıyordu. Kullanici "KASA2 ile girince Ana Sayfa/Yetkisiz
  // Erisim geliyor, sadece bazen dogru calisiyor" sikayetinde bulundu - bu,
  // istemci tarafi RSC gezinmesinin bir Route Handler'in HAM (RSC-olmayan)
  // yanitini isleyememesiyle tutarli bir belirti. Burada, middleware'in HER
  // istekte (hem ilk yukleme hem istemci tarafi RSC fetch'i dahil) calismasi
  // garanti oldugu icin, yetkili bir kullanici "/satis"a ULASTIGI ANDA
  // GERCEK bir HTTP 307 ile dogrudan "/wolvox/hizli-satis"e yonlendirilir -
  // React sayfasi/istemci tarafi gezinmesi hic devreye girmez.
  // Ayni nedenle kok adres ("/") icin de AYNI kisayol gerekir - app/page.tsx
  // normalde Dosya Yonetimi'ne erisimi olmayan kullaniciyi STARTUP_PAGE_
  // OPTIONS sirasina gore (Hizli Satis -> Dernek -> Ana Sayfa -> ...) React
  // redirect() ile yonlendirir; bu da YUKARIDAKI AYNI "/satis" ara-adimindan
  // GECTIGI icin kok neden burada da gecerli. SADECE Hizli Satis'in hedefi
  // bir Route Handler oldugu icin BU TEK secenek ozel olarak burada, en
  // erken asamada (React hic devreye girmeden) cozuluyor - digerleri
  // (Dernek, Ana Sayfa, Dosyalar vb.) gercek React sayfalari oldugundan bu
  // sorunu yasamiyor, app/page.tsx'teki genel tarama onlar icin degismeden
  // calismaya devam ediyor.
  if (userId && (pathname === '/satis' || pathname === '/')) {
    try {
      const permissionsSetting = await settingService.getByKey(USER_PERMISSIONS_SETTING_KEY)
      const permissions = permissionsSetting?.value as UserPermissionsById | undefined
      const permissionConfig = permissions?.[userId] ?? null
      const hasDocumentsAccess = hasPageAccess(permissionConfig, getPermissionPath('/documents', request.nextUrl.searchParams))
      if (pathname === '/satis' && hasHizliSatisAccess(permissionConfig)) {
        return NextResponse.redirect(new URL('/wolvox/hizli-satis', request.url))
      }
      if (pathname === '/' && !hasDocumentsAccess && hasHizliSatisAccess(permissionConfig)) {
        return NextResponse.redirect(new URL('/wolvox/hizli-satis', request.url))
      }
    } catch {
      // ayar okunamadi - asagidaki normal akisa (app/page.tsx / AppShell'in kendi kontrolu) devam
    }
  }

  if (!userId) {
    // Kullanici istegi (14 Eylul 2026, 10. tur): "https://netsosyal.sivas.
    // bel.tr/ bu adres disinda hicbir sekilde uygulama giris paneli
    // gelmesin" - eskiden oturumu olmayan biri HERHANGI bir korumali
    // sayfaya (ör. /online, /dashboard, yazim hatalari) gittiginde
    // "/login?next=..." adresine yonlendirilip "burada oturum gerektiren
    // bir sistem var" bilgisi ifsa ediliyordu. Artik SADECE tam kok adres
    // ("/") bu sekilde /login'e yonlendiriyor; DIGER TUM korumali
    // sayfalarda ise adres cubugu OLDUGU GIBI kalirken (rewrite - redirect
    // DEGIL) icerik olarak genel "Sayfa bulunamadı" gosteriliyor - hicbir
    // ipucu, hicbir yonlendirme yok. NOT: Bu, oturumu suresi dolan
    // PERSONEL icin de gecerli - artik otomatik giris sayfasina
    // yonlenmiyorlar, tekrar giris yapmak icin "/login" adresini kendileri
    // yazmalari gerekiyor (kullanicinin bilincli tercihiyle boyle).
    if (pathname === '/') {
      return NextResponse.redirect(new URL('/login', request.url))
    }

    // Kullanici istegi (Ekim 2026): "/satis" - kasiyerlerin dogrudan
    // paylasabilecegi kisa adres, oturumu olmayan ziyaretciyi "/" ile AYNI
    // sekilde BILINCLI olarak /login'e yonlendirir (yukaridaki genel "ipucu
    // verme" kuralinin KASITLI tek istisnasi - bu adresin herkese acik,
    // bilinen bir giris noktasi olmasi ISTENIYOR). Giris sonrasi dogrudan
    // Satis ekranina donebilmesi icin "next=/satis" eklenir (bkz. app/login/
    // page.tsx goToNextPath - SADECE bu sabit deger kabul edilir, rastgele
    // yonlendirme riski yok). Eskiden "/hizli-satis" adi da vardi -
    // kullanici istegiyle KALDIRILDI, tek giris noktasi artik "/satis".
    if (pathname === '/satis') {
      return NextResponse.redirect(new URL('/login?next=%2Fsatis', request.url))
    }

    // ONEMLI: usePathname() (AppShell.tsx, istemci tarafi) rewrite HEDEFINI
    // DEGIL, TARAYICIDA GORUNEN ORIJINAL adresi (ör. "/dashboard") dondurur -
    // yani AppShell salt pathname'e bakarak bunun aslinda oturumsuz-sahte-404
    // oldugunu ANLAYAMAZ, "bilinen bir ic sayfa" sanip sidebar'i yine
    // gosterebilirdi. Bunu KESIN olarak cozmek icin: istek basligina acik bir
    // isaret ekleniyor; app/layout.tsx (sunucu bileseni) bunu headers() ile
    // okuyup AppShell'e "forceStandalone" prop'u olarak iletiyor - boylece
    // karar sunucu tarafinda, senkron ve garanti sekilde veriliyor.
    const requestHeaders = new Headers(request.headers)
    requestHeaders.set('x-netsosyal-unauth-notfound', '1')

    const notFoundUrl = new URL(request.url)
    notFoundUrl.pathname = '/__oturum_gerekli_sayfa_bulunamadi__'
    notFoundUrl.search = ''
    const response = NextResponse.rewrite(notFoundUrl, { request: { headers: requestHeaders } })
    response.headers.set('Cache-Control', 'no-store, must-revalidate')
    response.headers.set('X-Robots-Tag', 'noindex, nofollow')
    return response
  }

  // Gecerli bir oturum var ama bu KULLANICIYA bu spesifik sayfa icin yetki
  // verilmemis olabilir - bkz. yukaridaki "resolveAllowedRedirect" notu.
  // Erisimi olan bir sayfa bulunamazsa (cok nadir - hicbir STARTUP_PAGE_
  // OPTIONS secenegine erisimi yok) burada YONLENDIRME YAPILMAZ; sayfa
  // normal akısına devam eder ve AppShell.tsx istemci tarafinda ayni
  // kontrolle "AccessDenied" karti gosterir (dongu olusmasin diye kasitli).
  const allowedRedirect = await resolveAllowedRedirect(userId, pathname, request.nextUrl.searchParams)
  if (allowedRedirect) {
    return NextResponse.redirect(new URL(allowedRedirect, request.url))
  }

  return pageResponse()
}

export const config = {
  matcher: '/:path*',
}
