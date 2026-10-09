import { NextRequest, NextResponse } from 'next/server'
import { requireApiAccess, getSessionUser } from '@/lib/apiAuth'
import { parseSessionValue, readSessionCookie } from '@/lib/auth'
import { settingService } from '@/lib/services'
import { USER_PERMISSIONS_SETTING_KEY, type UserPermissionsById } from '@/lib/constants/userPermissions'

// Bagimsiz, bu makinede yerel olarak calisan Flask uygulamalarini (Hizli
// Satis + Dernek Islemleri) NetSosyal origin'i altinda sunan ortak
// ters-proxy mantigi - app/wolvox/[[...path]]/route.ts, app/static/
// [[...path]]/route.ts VE app/dernek-app/[[...path]]/route.ts tarafindan
// kullanilir (her biri kendi backend origin + onekini verir).
//
// Hizli Satis: kaynak koddan ("python app.py") calistiginda certs/
// klasorundeki mkcert sertifikasiyla 0.0.0.0:5870'te HTTPS sunar - ama bu
// uygulama KENDISI, tam olarak BIZIM senaryomuz (bir ters proxy'nin
// iceriden konusmasi) icin app.py'de AYRI bir port tanimliyor: IC_PORT
// (varsayilan 5869), sadece 127.0.0.1'e bakan DUZ HTTP bir ic dinleyici.
//
// Dernek Islemleri: kendi route'lari onek TASIMAZ (ör. "/login",
// "/kesilen-faturalar") - NetSosyal altinda "/dernek-app" altina
// gomulebilmesi icin run_prefixed.py (DERNEK IŞLEMLERİ klasorunde, orijinal
// app.py'ye DOKUNMADAN) Werkzeug DispatcherMiddleware ile SCRIPT_NAME="/dernek-app"
// uygulayip 127.0.0.1:5858'de sunar - Flask'in kendi url_for() ciktisi
// bu sayede OTOMATIK "/dernek-app/..." halini alir, hicbir template degismez.
const STRIP_RESPONSE_HEADERS = new Set([
  'content-length', 'transfer-encoding', 'connection', 'keep-alive',
  'content-encoding', 'content-security-policy', 'x-frame-options',
])

// Performans notu (Ekim 2026 - "Dernek/Hizli Satis yavas" sikayeti): Hizli
// Satis'in kendi ic sayfasi her 6 saniyede bir yoklama YAPIYOR, static
// dosyalari ayrica cekiyor vb. - yani BU PROXY, sayfa gecisi disinda da
// SIK SIK calisiyor. getSessionUser() (X-NetSosyal-User basligi icin)
// her cagrida PRISMA'dan TAZE bir kullanici sorgusu CEKIYORDU - guvenlik
// kontrolu (requireApiAccess, DEGISTIRILMEDI) icin DEGIL, sadece GORUNTU
// amacli (backend'in kendi oturumuna otomatik giris icin kullandigi isim)
// oldugundan, kisa sureli bir yerel onbellek burada GUVENLI (settings.
// service.ts'teki AYNI deseni, SADECE bu dar amac icin kullanir).
const sessionUserNameCacheTtlMs = 60_000
const sessionUserNameCache = new Map<string, { expiresAt: number; name: string }>()

// ONEMLI: userId'yi cookie'den (parseSessionValue - imza dogrulamasi disinda
// VERITABANINA GITMEZ) cikarip ONCE onbellege bakariz - onbellekte varsa
// getSessionUser()/Prisma sorgusu HIC CALISMAZ. Guvenlik kontrolu
// (requireApiAccess, bu fonksiyondan TAMAMEN BAGIMSIZ, HER ZAMAN taze
// calisir) bundan ETKILENMEZ - bu SADECE goruntu amacli isim cozumlemesi.
async function resolveNetsosyalUserName(req: NextRequest): Promise<string> {
  const userId = parseSessionValue(readSessionCookie(req.cookies))
  if (!userId) return ''

  const cached = sessionUserNameCache.get(userId)
  if (cached && cached.expiresAt > Date.now()) return cached.name

  const user = await getSessionUser()
  const name = user?.name || user?.username || ''
  sessionUserNameCache.set(userId, { expiresAt: Date.now() + sessionUserNameCacheTtlMs, name })
  return name
}

// Kullanici istegi (2026-10-07): Hizli Satis'ta VE Dernek İşlemleri'nde
// kullanici adi/sifre sorulmadan, NetSosyal'deki "Kullanici Yetkileri >
// Görebileceği Sayfalar" ekraninda (bkz. app/(modules)/settings/page.tsx -
// "Muhasebe" ve "Dernek İşlemleri" gruplari) isaretli SANAL alt-sayfalara
// gore otomatik olarak dogru yere girmesi icin - backend bu basliklara gore
// secim ekranini atlar ya da sadece izinli sayfalari/kasalari gosterir.
// Donus degeri bos dize = "sinirsiz" (header hic kisitlama tasimaz, backend
// her seyi gosterir - eski davranis) - kullanici bu yeni sisteme HENUZ hic
// dahil edilmemisse (asagidaki sanal alt-sayfalardan HICBIRI isaretli
// degilse) GERIYE DONUK UYUMLULUK icin de sinirsiz sayilir.
// Kullanici istegi (2026-10-07, 2. tur): KASA1/2/3/CARI'nin yaninda, Hizli
// Satis'in kendi ic kullanici_yetki.py sistemindeki GERCEK ISIMLI hesaplar
// (TURAN - tam yetkili, MUHASEBE - daha genis ama yonetici olmayan modul
// seti) de ayni sekilde SSO ile (sifresiz) secilebilsin diye eklendi - kod
// degerleri, backend'deki hizli_satis_kullanici tablosundaki kullaniciAdi
// degerleriyle BIREBIR AYNI olmali (buyuk harf).
// Kullanici istegi (2026-10-07, 3. tur): "ayrı bir yetki alanı eklemeliyiz"
// - eskiden bu alt-sayfalar "/muhasebe" altinda SANAL yollardi (sadece
// "child implies parent" kuraliyla DOLAYLI olarak "/muhasebe" iznini
// tetikliyorlardi, AYRI/ACIK bir "Hizli Satis" kutusu YOKTU). Artik KENDI
// BAGIMSIZ "/hizli-satis" alaninda - asagidaki requireHizliSatisAccess
// bunu once dener, geriye donuk uyumluluk icin BULUNAMAZSA eski "/muhasebe"
// genel yetkisine de bakar (ESKIDEN SADECE "/muhasebe" olan kullanicilar
// kaybetmesin diye).
const HIZLI_SATIS_KASA_PATH_TO_CODE: Record<string, string> = {
  '/hizli-satis/kasa1': 'KASA1',
  '/hizli-satis/kasa2': 'KASA2',
  '/hizli-satis/kasa3': 'KASA3',
  '/hizli-satis/cari': 'CARI',
  '/hizli-satis/muhasebe': 'MUHASEBE',
  '/hizli-satis/turan': 'TURAN',
}

// Dernek İşlemleri'nin kendi ic sayfalari icin SANA alt-sayfa anahtarlari -
// NetSosyal tarafindaki path'ten KISA koda cevrilir (backend'e kisa kod
// olarak gider, bkz. app.py - X-NetSosyal-Dernek-Sayfalar).
const DERNEK_SAYFA_PATH_TO_KOD: Record<string, string> = {
  '/dernek/gelen-faturalar': 'gelen-faturalar',
  '/dernek/kesilen-faturalar': 'kesilen-faturalar',
  '/dernek/cari': 'cari',
  '/dernek/gelir-gider': 'gelir-gider',
  '/dernek/kurban': 'kurban',
  '/dernek/wolvox-raporlari': 'wolvox-raporlari',
  '/dernek/yonetim': 'yonetim',
}

const permissionScopeCacheTtlMs = 60_000
const hizliSatisKasaCache = new Map<string, { expiresAt: number; value: string }>()
const dernekSayfaCache = new Map<string, { expiresAt: number; value: string }>()

async function resolveAllowedVirtualPages(
  req: NextRequest,
  pathToCode: Record<string, string>,
  cache: Map<string, { expiresAt: number; value: string }>,
): Promise<string> {
  const userId = parseSessionValue(readSessionCookie(req.cookies))
  if (!userId) return ''

  const cached = cache.get(userId)
  if (cached && cached.expiresAt > Date.now()) return cached.value

  let value = ''
  try {
    const permissionsSetting = await settingService.getByKey(USER_PERMISSIONS_SETTING_KEY)
    const permissions = permissionsSetting?.value as UserPermissionsById | undefined
    const permissionConfig = permissions?.[userId]

    if (permissionConfig && !permissionConfig.isAdmin) {
      const allowedPages = permissionConfig.allowedPages || []
      const virtualPaths = Object.keys(pathToCode)
      const hasAnyVirtualPage = virtualPaths.some((p) => allowedPages.includes(p))
      if (hasAnyVirtualPage) {
        value = virtualPaths
          .filter((p) => allowedPages.includes(p))
          .map((p) => pathToCode[p])
          .join(',')
      }
    }
  } catch {
    value = ''
  }

  cache.set(userId, { expiresAt: Date.now() + permissionScopeCacheTtlMs, value })
  return value
}

async function resolveHizliSatisAllowedKasalar(req: NextRequest): Promise<string> {
  return resolveAllowedVirtualPages(req, HIZLI_SATIS_KASA_PATH_TO_CODE, hizliSatisKasaCache)
}

async function resolveDernekAllowedSayfalar(req: NextRequest): Promise<string> {
  return resolveAllowedVirtualPages(req, DERNEK_SAYFA_PATH_TO_KOD, dernekSayfaCache)
}

export function createLocalAppProxy(options: { origin: string; backendPrefix: string; label: string }) {
  const origin = options.origin.replace(/\/+$/, '')
  const { backendPrefix, label } = options

  function backendUrl(req: NextRequest, pathParts: string[] | undefined) {
    const sub = (pathParts ?? []).map(encodeURIComponent).join('/')
    const search = req.nextUrl.search || ''
    // Kok istek (pathParts bos, ör. "/dernek-app"): backend'e SONUNDA "/"
    // ile istenir - aksi halde Flask/Werkzeug "/dernek-app/" olmasi
    // gerektigini soyleyip KENDI 308'ini doner, bu da Next.js'in "/dernek-app/"
    // -> "/dernek-app" OTOMATIK trailing-slash normalizasyonuyla CAKISIP
    // sonsuz yonlendirme dongusu olusturuyordu (next.js kendi normalizasyonunu
    // route handler'a HIC ULASMADAN, ondan ONCE uyguluyor).
    return `${origin}${backendPrefix}${sub ? `/${sub}` : '/'}${search}`
  }

  // Werkzeug'un kendi "strict_slashes" otomatik yonlendirmesi (ör. "/dernek-app"
  // -> "/dernek-app/") TAM (mutlak, backend'in kendi host:port'unu iceren)
  // bir Location uretir - bu, oldugu gibi gecirilirse tarayiciyi dogrudan
  // 127.0.0.1:PORT'a (disaridan erisilemez) gonderir. Backend origin'i
  // Location'in basindan sokup GERIYE KALAN (zaten dogru onekli) yolu
  // birakmak, tarayicinin bunu KENDI (NetSosyal) origin'ine gore cozmesini saglar.
  function rewriteLocation(location: string): string {
    if (location.startsWith(origin)) {
      const rest = location.slice(origin.length)
      return rest.startsWith('/') ? rest : `/${rest}`
    }
    return location
  }

  async function proxy(req: NextRequest, pathParts: string[] | undefined) {
    // Sidebar'daki ilgili modul iznini olan kullanicilar erisebilsin - gercek
    // URL /wolvox, /static veya /dernek-app altinda olsa da, yetki anahtari
    // kasitli olarak sidebar'daki ana modul yoluyla AYNI ("canViewPath(...)"
    // ile), tek tutarli bir izin kapsami.
    //
    // Kullanici istegi (2026-10-07, 3. tur): Hizli Satis icin artik ONCE
    // KENDI BAGIMSIZ "/hizli-satis" yetkisi denenir (acikca, "Hızlı Satış -
    // Giriş İzni" kutusu VEYA herhangi bir kasa/isimli-kullanici alt
    // kutusu isaretliyse gecer); BULUNAMAZSA (eski kurulum/kullanicilar
    // icin) genel "/muhasebe" yetkisine DUSULUR - boylece "Muhasebe"
    // modulune tam erisimi olan eski kullanicilar KAYBETMEZ, ama artik
    // SADECE Hizli Satis'a yetkili kullanicilar icin AYRI, acik bir kutu var.
    const denied = label === 'dernek'
      ? await requireApiAccess({ page: '/dernek' })
      : await (async () => {
          const hizliSatisDenied = await requireApiAccess({ page: '/hizli-satis' })
          if (!hizliSatisDenied) return null
          return requireApiAccess({ page: '/muhasebe' })
        })()
    if (denied) return denied

    const target = backendUrl(req, pathParts)

    // Backend'in KENDI ikinci bir kullanici adi/sifre girisi ISTEMEMESI
    // icin (NetSosyal zaten yetkiyi dogruladi) - giris yapan NetSosyal
    // kullanicisinin adi bu baslikla iletilir; backend (ör. Dernek
    // Islemleri'nin login_required'i) bunu GUVENILIR sayip oturumu
    // otomatik acar. Bu baslik SADECE bu sunucu tarafindan, loopback
    // (127.0.0.1) uzerinden eklenir - disaridan taklit edilemez.
    const netsosyalUserName = await resolveNetsosyalUserName(req)
    const isDernek = label === 'dernek'
    const allowedKasalar = isDernek ? '' : await resolveHizliSatisAllowedKasalar(req)
    const allowedDernekSayfalar = isDernek ? await resolveDernekAllowedSayfalar(req) : ''

    const fwdHeaders = new Headers()
    req.headers.forEach((value, key) => {
      const k = key.toLowerCase()
      if (k === 'host' || k === 'content-length' || k === 'connection') return
      if (k === 'x-netsosyal-user' || k === 'x-netsosyal-hizlisatis-kasalar' || k === 'x-netsosyal-dernek-sayfalar') return // disaridan gelen sahte degeri at
      fwdHeaders.set(key, value)
    })
    if (netsosyalUserName) fwdHeaders.set('X-NetSosyal-User', netsosyalUserName)
    if (!isDernek) fwdHeaders.set('X-NetSosyal-HizliSatis-Kasalar', allowedKasalar)
    if (isDernek) fwdHeaders.set('X-NetSosyal-Dernek-Sayfalar', allowedDernekSayfalar)

    const method = req.method.toUpperCase()
    const hasBody = method !== 'GET' && method !== 'HEAD'
    const body = hasBody ? Buffer.from(await req.arrayBuffer()) : undefined

    let backendRes: Response
    try {
      backendRes = await fetch(target, {
        method,
        headers: fwdHeaders,
        body,
        redirect: 'manual',
        signal: AbortSignal.timeout(30_000),
      })
    } catch (error) {
      return NextResponse.json(
        { error: `${label} uygulamasına ulaşılamadı (${origin} kapalı olabilir).`, detail: error instanceof Error ? error.message : String(error) },
        { status: 502 },
      )
    }

    const outHeaders = new Headers()
    backendRes.headers.forEach((value, key) => {
      if (STRIP_RESPONSE_HEADERS.has(key.toLowerCase())) return
      if (key.toLowerCase() === 'location') { outHeaders.set('location', rewriteLocation(value)); return }
      outHeaders.set(key, value)
    })

    // set-cookie'ler: backend duz HTTP uzerinden calistigi icin "Secure"
    // bayragi tasimaz - tarayici (bu proxy de http/https farketmeksizin)
    // cookie'yi normal sekilde kabul eder.
    const setCookies = typeof backendRes.headers.getSetCookie === 'function'
      ? backendRes.headers.getSetCookie()
      : (backendRes.headers.get('set-cookie') ? [backendRes.headers.get('set-cookie') as string] : [])
    for (const c of setCookies) {
      outHeaders.append('set-cookie', c.replace(/;\s*[Dd]omain=[^;]*/i, ''))
    }

    const buf = Buffer.from(await backendRes.arrayBuffer())
    return new NextResponse(buf, { status: backendRes.status, headers: outHeaders })
  }

  type Ctx = { params: Promise<{ path?: string[] }> }

  const handler = async (req: NextRequest, ctx: Ctx) => proxy(req, (await ctx.params).path)

  return {
    GET: handler,
    POST: handler,
    PUT: handler,
    PATCH: handler,
    DELETE: handler,
    HEAD: handler,
    OPTIONS: handler,
  }
}

const HIZLI_SATIS_ORIGIN = (
  process.env.HIZLI_SATIS_ORIGIN
  || (process.env.HIZLI_SATIS_IC_PORT ? `http://127.0.0.1:${process.env.HIZLI_SATIS_IC_PORT}` : 'http://127.0.0.1:5869')
)

export function createHizliSatisProxy(backendPrefix: string) {
  return createLocalAppProxy({ origin: HIZLI_SATIS_ORIGIN, backendPrefix, label: 'Hızlı Satış' })
}

const DERNEK_ORIGIN = process.env.DERNEK_ORIGIN || 'http://127.0.0.1:5858'

export function createDernekProxy(backendPrefix: string) {
  return createLocalAppProxy({ origin: DERNEK_ORIGIN, backendPrefix, label: 'dernek' })
}
