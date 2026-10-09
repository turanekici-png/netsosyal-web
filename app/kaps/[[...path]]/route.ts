import { NextRequest, NextResponse } from 'next/server'
import { requireApiAccess } from '@/lib/apiAuth'

export const dynamic = 'force-dynamic'

// KAPS / NVİ Sorgu Ekranı ters-proxy'si
// ------------------------------------
// kpsv2 C# köprüsünün (IIS Express, yalnız localhost:3500) KENDİ sorgu
// ekranını, NetSosyal'in origin'i üzerinden /kaps altında sunar. Böylece:
//  - CSP (frame-src 'self') gömülü iframe'e izin verir,
//  - ekran her istemciden (kurum LAN'ı gerekmeden) erişilebilir.
//
// Basit next.config "rewrites" YETMEDİ: kpsv2 ekranı ASP.NET WebForms -
// "Sorgula" bir postback (form action="./"). Sayfa /kaps yerine /kaps/ ile
// sunulmazsa "./" YANLIŞ çözülüp (kök '/') sorgu kayboluyordu. Bu handler
// yanıtın <head>'ine <base href="/kaps/"> enjekte eder → tüm göreli URL'ler
// (postback dahil) /kaps/ altında çözülür. Ayrıca ASP.NET oturum çerezinin
// yolunu /kaps'a çeker ve backend yönlendirmelerini /kaps'a haritalar.

const KPSV2_ORIGIN = (
  process.env.KPSV2_ORIGIN
  || (process.env.KPSV2_PORT ? `http://localhost:${process.env.KPSV2_PORT}` : 'http://localhost:3500')
).replace(/\/+$/, '')

// İstemciye AYNEN geçirilmeyecek yanıt başlıkları (uzunluk/aktarım kodlaması
// Next tarafından yeniden hesaplanır; güvenlik başlıklarını global headers() verir).
const STRIP_RESPONSE_HEADERS = new Set([
  'content-length', 'transfer-encoding', 'connection', 'keep-alive',
  'content-encoding', 'content-security-policy', 'x-frame-options',
])

function backendUrl(req: NextRequest, pathParts: string[] | undefined) {
  const sub = (pathParts ?? []).map(encodeURIComponent).join('/')
  const search = req.nextUrl.search || ''
  // Kök istek ("/kaps" veya "/kaps/") -> backend kökü "/"
  return `${KPSV2_ORIGIN}/${sub}${search}`
}

function rewriteLocation(location: string): string {
  try {
    if (location.startsWith(KPSV2_ORIGIN)) {
      const rest = location.slice(KPSV2_ORIGIN.length)
      return `/kaps${rest.startsWith('/') ? rest : `/${rest}`}`
    }
    if (location.startsWith('/')) return `/kaps${location}`
    return location // göreli - <base> hallediyor
  } catch {
    return location
  }
}

async function proxy(req: NextRequest, pathParts: string[] | undefined) {
  // Ayarlar > NVİ Entegrasyonu ekranını görebilenler erişebilsin.
  const denied = await requireApiAccess({ page: '/settings' })
  if (denied) return denied

  const target = backendUrl(req, pathParts)

  // İstek başlıkları: Host'u kaldır (backend kendi Host'unu kullansın),
  // Cookie/Content-Type/Referer vb. geçir.
  const fwdHeaders = new Headers()
  req.headers.forEach((value, key) => {
    const k = key.toLowerCase()
    if (k === 'host' || k === 'content-length' || k === 'connection') return
    fwdHeaders.set(key, value)
  })

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
      { error: 'KPSV2 sorgu ekranına ulaşılamadı (localhost:3500 kapalı olabilir).', detail: error instanceof Error ? error.message : String(error) },
      { status: 502 },
    )
  }

  const contentType = backendRes.headers.get('content-type') || ''
  const isHtml = contentType.includes('text/html')

  const outHeaders = new Headers()
  backendRes.headers.forEach((value, key) => {
    if (STRIP_RESPONSE_HEADERS.has(key.toLowerCase())) return
    if (key.toLowerCase() === 'location') { outHeaders.set('location', rewriteLocation(value)); return }
    outHeaders.set(key, value)
  })
  // set-cookie'ler (birden fazla olabilir): Path=/ -> Path=/kaps
  const setCookies = typeof backendRes.headers.getSetCookie === 'function'
    ? backendRes.headers.getSetCookie()
    : (backendRes.headers.get('set-cookie') ? [backendRes.headers.get('set-cookie') as string] : [])
  for (const c of setCookies) {
    outHeaders.append('set-cookie', c.replace(/;\s*Path=\/(?![\w-])/i, '; Path=/kaps').replace(/;\s*[Dd]omain=[^;]*/i, ''))
  }

  if (isHtml) {
    let html = await backendRes.text()
    // <base href="/kaps/"> -> göreli varlık/link URL'leri (AdminKps.aspx,
    // Scripts/... vb.) /kaps/ altında çözülür.
    if (!/<base\b/i.test(html)) {
      html = html.replace(/<head(\s[^>]*)?>/i, (m) => `${m}<base href="/kaps/">`)
    }
    // Kullanici istegi (2026-09-30): Ayarlar > NVI Entegrasyonu icindeki bu
    // ekranin (harici kpsv2 WebForms uygulamasinin kendi HTML/CSS'i) yazi ve
    // alan boyutlari kucuk kaliyordu. Uygulamanin KENDI kaynagina dokunmadan
    // - sadece bu ters-proxy'nin zaten yaptigi HTML enjeksiyonuna ek olarak -
    // </head>'ten once bir override <style> ekleniyor; ayni sinif adlarini
    // kullandigindan (kaynak sirasi geregi) kpsv2'nin kendi <style>'inin
    // uzerine yazar. SADECE GORUNUM (font-size/min-height/padding/genislik);
    // hicbir islevsellik/postback/JS davranisi degismiyor.
    html = html.replace(/<\/head>/i, () => `
    <style>
        .page-shell { width: min(1800px, calc(100% - 32px)); }
        body { font-size: 20px; }
        .page-title { font-size: 40px; }
        .field label { font-size: 18px; margin-bottom: 10px; }
        input[type=text] { font-size: 23px; min-height: 66px; padding: 16px 18px; }
        .button { font-size: 22px; min-height: 66px; padding: 0 38px; }
        .admin-link { font-size: 19px; min-height: 56px; padding: 0 24px; }
        .section-title { font-size: 24px; }
        .meta-label { font-size: 16px; }
        .meta-value { font-size: 20px; }
        .badge { font-size: 16px; min-height: 34px; padding: 6px 13px; }
    </style>
</head>`)
    // Postback formunun action="./" değerini /kaps yap - böylece sorgu
    // POST'u dogrudan bu handler'a gelir (trailing-slash 308'i olmadan).
    html = html.replace(/(<form\b[^>]*\baction=")\.\/(")/i, '$1/kaps$2')
    outHeaders.set('content-type', 'text/html; charset=utf-8')
    return new NextResponse(html, { status: backendRes.status, headers: outHeaders })
  }

  const buf = Buffer.from(await backendRes.arrayBuffer())
  return new NextResponse(buf, { status: backendRes.status, headers: outHeaders })
}

type Ctx = { params: Promise<{ path?: string[] }> }

export async function GET(req: NextRequest, ctx: Ctx) { return proxy(req, (await ctx.params).path) }
export async function POST(req: NextRequest, ctx: Ctx) { return proxy(req, (await ctx.params).path) }
export async function PUT(req: NextRequest, ctx: Ctx) { return proxy(req, (await ctx.params).path) }
export async function PATCH(req: NextRequest, ctx: Ctx) { return proxy(req, (await ctx.params).path) }
export async function DELETE(req: NextRequest, ctx: Ctx) { return proxy(req, (await ctx.params).path) }
export async function HEAD(req: NextRequest, ctx: Ctx) { return proxy(req, (await ctx.params).path) }
export async function OPTIONS(req: NextRequest, ctx: Ctx) { return proxy(req, (await ctx.params).path) }
