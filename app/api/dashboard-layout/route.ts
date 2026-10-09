import { NextResponse } from 'next/server'
import { getSessionUser, requireApiAccess } from '@/lib/apiAuth'
import { prisma } from '@/lib/db/prisma'
import { upsertSetting } from '@/lib/db/upsertSetting'

export const dynamic = 'force-dynamic'

// Kullanici istegi: Ana Sayfa'daki (ve sonradan Dosya Yonetimi'ndeki)
// rapor/panel kutularinin boyutu/konumu HER KULLANICI KENDINE GORE
// ayarlayabilsin ve bu duzen kalicidir - bu yuzden (AdvancedTable'in sutun
// duzeni gibi TEK bir global anahtarla degil) HER KULLANICIYA OZEL bir
// anahtarla (<grid>_layout_<kullaniciId>) app_settings tablosunda saklanir.
// Yeni bir tabloya/migrasyona gerek kalmadan mevcut key-value "Setting"
// mekanizmasi bu sekilde yeniden kullanilir.
//
// ONEMLI DUZELTME (kullanici istegi): bu uc nokta bir ARA donemde
// tarayici localStorage'ina tasinmisti ("her BILGISAYARA ozel" olsun diye)
// - ama kullanici bunun YANLIS oldugunu, AYNI bilgisayarda FARKLI
// hesaplarla giren personelin HALA AYNI (o bilgisayara ait) duzeni
// gordugunu, istediginin ise GERCEKTEN "HANGI HESAPLA girilirse o hesabin
// KENDI duzeni" oldugunu bildirdi. Bu yuzden sunucu tarafinda, kullanici
// HESABINA (oturum acan kullaniciId'ye) gore saklama YENIDEN devreye
// alindi - artik hangi bilgisayardan girilirse girilsin, AYNI hesap HER
// ZAMAN kendi duzenini gorur; farkli bir hesapla (ayni bilgisayardan bile
// olsa) girildiginde O HESABIN kendi (veya hic yoksa varsayilan) duzeni
// gelir.
//
// "grid" parametresi, bu mekanizmanin BIRDEN FAZLA farkli sayfa/izgara
// icin (ör. "dashboard" = Ana Sayfa, "documents-dosya-yonetimi" = Dosya
// Yonetimi) AYRI AYRI kayit anahtarlariyla paylasilarak kullanilmasini
// saglar - varsayilani "dashboard" olarak birakildi ki mevcut Ana Sayfa
// kayitlarinin anahtari (dashboard_layout_<id>) DEGISMESIN, geriye donuk
// uyumlu kalsin.
function layoutKeyFor(userId: string, grid: string) {
  return `${grid}_layout_${userId}`
}

const ALLOWED_GRID_IDS = new Set(['dashboard', 'documents-dosya-yonetimi'])

function resolveGridId(rawGrid: string | null): string {
  return rawGrid && ALLOWED_GRID_IDS.has(rawGrid) ? rawGrid : 'dashboard'
}

// Kullanici istegi: kutulari boyutlandirirken adimlar COK KABA kalıyordu
// ("sekme sekme" degisiyor, komsu kutuyla TAM hizalanamiyordu) - bu yuzden
// grid COK inceltildi (12 sutun -> 48 sutun, bkz. components/shared/
// DashboardGrid.tsx). Bu, ONCEDEN kaydedilmis duzenlerin koordinat
// SISTEMINI degistirir.
//
// ONEMLI (surum 2 -> 3 duzeltmesi): ILK denemede (surum 2) yukseklik (h)
// donusumu YAKLASIK bir oranla (x4) yapilmisti - react-grid-layout'un
// GERCEK ic formulu (`h*rowHeight + max(0,h-1)*margin`, DUZ bir oran
// DEGIL) ile TAM ORTUSMEDIGI icin kucuk sapmalar birikip, izgaranin
// otomatik sikistirma/yerlesim mantigiyla birlesince kutularin BEKLENMEDIK
// sekilde yeniden dizilmesine (kullanicinin duzeninin bozulmasina) yol
// acti. Bu surumde yukseklik donusumu artik bu formulun TAM TERSI
// alinarak KESIN/PIKSEL-DOGRU hesaplanir (bkz. convertLegacyHeightUnits).
// Daha once (surum 2 ile) YANLIS yukseltilmis kayitlar ise (o an dogru/
// orijinal veri ARTIK geri getirilemeyecek sekilde ustune yazildigi icin)
// guvenli sekilde varsayilana donsun diye BURADA taninmiyor - surum 3'e
// YALNIZCA gercek ESKI (gridVersion yok, 12 sutunluk) kayitlardan gecilir.
const CURRENT_GRID_VERSION = 3
const LEGACY_COL_SCALE = 4 // eski 12 sutun -> yeni 48 sutun (KESIN - tam sayi*4)
const LEGACY_ROW_HEIGHT = 20
const LEGACY_ROW_MARGIN = 16
const NEW_ROW_HEIGHT = 5
const NEW_ROW_MARGIN = 4

type RawLayoutItem = Record<string, unknown>

// react-grid-layout'un GERCEK ic formulunun (calcGridItemWHPx) TAM TERSI -
// bkz. components/shared/LocalDesignGrid.tsx'teki AYNI mantigin ikizi.
function convertLegacyHeightUnits(legacyH: number): number {
  const pixelHeight = legacyH * LEGACY_ROW_HEIGHT + Math.max(0, legacyH - 1) * LEGACY_ROW_MARGIN
  const newH = (pixelHeight + NEW_ROW_MARGIN) / (NEW_ROW_HEIGHT + NEW_ROW_MARGIN)
  return Math.max(1, Math.round(newH))
}

function upscaleLegacyLayoutItems(items: unknown): RawLayoutItem[] {
  if (!Array.isArray(items)) return []
  return items.map((rawItem) => {
    const item = rawItem as RawLayoutItem
    return {
      ...item,
      // Yatay (x/w): tam sayi carpimi (x4) - KESIN, yaklasiklik yok.
      x: typeof item.x === 'number' ? item.x * LEGACY_COL_SCALE : item.x,
      w: typeof item.w === 'number' ? Math.max(1, item.w * LEGACY_COL_SCALE) : item.w,
      // Dikey konum (y) DOGRUSAL oldugu icin oran KESIN (36/9 = tam 4);
      // sadece h (yukseklik SPANI) icin tam-ters formul kullanilir.
      y: typeof item.y === 'number'
        ? Math.round(item.y * ((LEGACY_ROW_HEIGHT + LEGACY_ROW_MARGIN) / (NEW_ROW_HEIGHT + NEW_ROW_MARGIN)))
        : item.y,
      h: typeof item.h === 'number' ? convertLegacyHeightUnits(item.h) : item.h,
    }
  })
}

export async function GET(request: Request) {
  const gridId = resolveGridId(new URL(request.url).searchParams.get('grid'))
  // "dashboard" (Ana Sayfa) icin eskiden beri gecerli sayfa-yetkisi kontrolu
  // aynen korunuyor; diger izgaralar (ör. Dosya Yonetimi) icin o sayfayi
  // zaten gorebilen HERKES kendi duzenini okuyabilir (bu ozellik onceden de
  // ayri bir yetkiye baglanmamisti, o davranis degistirilmedi).
  const accessDenied = await requireApiAccess({ page: gridId === 'dashboard' ? '/dashboard' : '/documents' })
  if (accessDenied) return accessDenied

  const user = await getSessionUser()
  if (!user) {
    return NextResponse.json({ success: false, error: 'Oturum bulunamadi.' }, { status: 401 })
  }

  try {
    const setting = await prisma.setting.findUnique({
      where: { key: layoutKeyFor(String(user.id), gridId) },
    })

    // Kullanici istegi: kutulari gizleyip gosterebilme eklendi - bu yuzden
    // kayit sekli {layouts, hiddenIds} olarak GENISLETILDI. DAHA ONCE
    // kaydedilmis (sadece {lg, sm} iceren, "hiddenIds" OLMAYAN) eski
    // kayitlar bozulmasin diye burada eski/yeni sekil ayirt edilip
    // normalize ediliyor.
    const rawValue = setting?.value as Record<string, unknown> | null | undefined
    const isNewShape = Boolean(rawValue && typeof rawValue === 'object' && 'layouts' in rawValue)
    let normalized = rawValue
      ? isNewShape
        ? { layouts: rawValue.layouts ?? null, hiddenIds: Array.isArray(rawValue.hiddenIds) ? rawValue.hiddenIds : [], gridVersion: rawValue.gridVersion }
        : { layouts: rawValue, hiddenIds: [], gridVersion: undefined }
      : null

    // Eski (12 sutunluk -> 48 sutunluk) koordinat-sistemi yukseltmesi
    // SADECE "dashboard" icin gecerli - Dosya Yonetimi izgarasi sunucuda
    // hic saklanmamisti (yeni), gecmis/eski bir veri formati YOK, yukseltme
    // gerekmez.
    if (gridId === 'dashboard' && normalized && normalized.layouts && normalized.gridVersion !== CURRENT_GRID_VERSION) {
      if (normalized.gridVersion === undefined) {
        // Gercek ESKI (12 sutunluk, gridVersion hic yok) kayit - KESIN
        // formulle bir kereye mahsus yukseltilip hemen kalici geri yazilir.
        const layoutsRecord = normalized.layouts as Record<string, unknown>
        const upscaledLayouts: Record<string, unknown> = {}
        for (const breakpoint of Object.keys(layoutsRecord)) {
          upscaledLayouts[breakpoint] = upscaleLegacyLayoutItems(layoutsRecord[breakpoint])
        }
        normalized = { layouts: upscaledLayouts, hiddenIds: normalized.hiddenIds, gridVersion: CURRENT_GRID_VERSION }
        await upsertSetting(layoutKeyFor(String(user.id), gridId), normalized)
      } else {
        // gridVersion 2 (bir onceki YAKLASIK/hatali gecis denemesinden
        // kalma) - o an dogru veri zaten ustune yazilarak kaybedildigi
        // icin GUVENILIR DEGIL; kayit tamamen silinip varsayilana dusulur.
        await prisma.setting.deleteMany({ where: { key: layoutKeyFor(String(user.id), gridId) } })
        normalized = null
      }
    }

    return NextResponse.json({ success: true, data: normalized })
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Duzen okunamadi.' },
      { status: 500 },
    )
  }
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null)
  const gridId = resolveGridId(typeof body?.grid === 'string' ? body.grid : null)

  // Kullanici istegi: duzeni FIILEN DEGISTIRME (kaydetme), "dashboard" icin
  // eskiden beri Kullanici Yetkileri'nde "Ana sayfa duzenini degistirme"
  // acikca verilmis personelde calisir (digerleri GET ile mevcut/varsayilan
  // duzeni gorebilir ama buraya istek atsalar bile 403 doner) - bu davranis
  // AYNEN korundu. Diger izgaralar (ör. Dosya Yonetimi) icin ozel bir
  // duzenleme yetkisi ONCEDEN de yoktu (sayfayi goren herkes Tasarim
  // Modu'nu kullanabiliyordu) - o davranis da degistirilmedi.
  const accessDenied = await requireApiAccess(
    gridId === 'dashboard' ? { action: 'dashboard.layout' } : { page: '/documents' },
  )
  if (accessDenied) return accessDenied

  const user = await getSessionUser()
  if (!user) {
    return NextResponse.json({ success: false, error: 'Oturum bulunamadi.' }, { status: 401 })
  }

  try {
    if (!body || typeof body !== 'object' || !('layouts' in body)) {
      return NextResponse.json({ success: false, error: 'Gecersiz duzen verisi.' }, { status: 400 })
    }

    const hiddenIds = Array.isArray(body.hiddenIds) ? body.hiddenIds : []
    await upsertSetting(layoutKeyFor(String(user.id), gridId), { layouts: body.layouts, hiddenIds, gridVersion: CURRENT_GRID_VERSION })

    return NextResponse.json({ success: true })
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Duzen kaydedilemedi.' },
      { status: 500 },
    )
  }
}

export async function DELETE(request: Request) {
  const gridId = resolveGridId(new URL(request.url).searchParams.get('grid'))
  const accessDenied = await requireApiAccess(
    gridId === 'dashboard' ? { action: 'dashboard.layout' } : { page: '/documents' },
  )
  if (accessDenied) return accessDenied

  const user = await getSessionUser()
  if (!user) {
    return NextResponse.json({ success: false, error: 'Oturum bulunamadi.' }, { status: 401 })
  }

  try {
    await prisma.setting.deleteMany({ where: { key: layoutKeyFor(String(user.id), gridId) } })
    return NextResponse.json({ success: true })
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Duzen sifirlanamadi.' },
      { status: 500 },
    )
  }
}
