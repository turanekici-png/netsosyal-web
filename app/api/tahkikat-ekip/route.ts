import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { getSessionUser, requireAdminAccess } from '@/lib/apiAuth'
import { userService } from '@/lib/services'
import { checkRateLimit, clearRateLimit, getRequestClientKey } from '@/lib/security/rateLimit'
import { getTahkikatPersonelListesi } from '@/app/api/workflow/tahkikat/_lib/personnel'
import {
  aktifKisileriGetir,
  ekipDurumunuGetir,
  ekipPersonelCereziniYaz,
  ekipPersonelDegeriOlustur,
  ekipUyeleriniGetir,
  ekipUyeleriniKaydet,
  oturumNumarasi,
  tumAktifKullanicilar,
  type EkipUyeleri,
} from '@/lib/auth/tahkikatEkip'

export const dynamic = 'force-dynamic'

// Tahkikat ekip hesabi (tahkikat1, tahkikat2...) + o ekipte calisan
// personel - bkz. lib/auth/tahkikatEkip.ts.
//
// GET              -> oturumdaki ekibin durumu (uyeler + secili personel)
// GET ?yonetim=1   -> (admin) tum ekipler + aktif kullanicilar + uyelikler
// POST             -> personel kendini secip KENDI sifresiyle dogrulanir
// DELETE           -> "Personel Değiştir": secili personeli birakir
// PUT              -> (admin) ekip uyelerini kaydeder

export async function GET(request: Request) {
  try {
    const sessionUser = await getSessionUser()
    if (!sessionUser) {
      return NextResponse.json({ success: false, error: 'Oturum bulunamadı.' }, { status: 401 })
    }

    // 2026-10-15: Hane Ziyareti formundaki personel adi acilir listesi icin
    // (yalniz isimler). Ekip hesabiysa SADECE kendi ekibi; degilse uyesi
    // tanimli tum ekipler (ekip adina gore gruplu).
    if (new URL(request.url).searchParams.get('secim') === '1') {
      const [ekipListesi, uyelikler] = await Promise.all([getTahkikatPersonelListesi(), ekipUyeleriniGetir()])
      const tumIdler = [...new Set(Object.values(uyelikler).flat())]
      const kisiler = new Map((await aktifKisileriGetir(tumIdler)).map((k) => [k.id, k.name]))
      const ekipAdlari = new Map((await aktifKisileriGetir(ekipListesi.map((e) => e.id))).map((k) => [k.id, k.username || k.name]))
      const kendiEkibi = uyelikler[String(sessionUser.id)] ? String(sessionUser.id) : null
      const ekipler = Object.entries(uyelikler)
        .filter(([ekipId]) => ekipAdlari.has(ekipId) && (!kendiEkibi || ekipId === kendiEkibi))
        .map(([ekipId, uyeIdleri]) => ({
          id: ekipId,
          ad: ekipAdlari.get(ekipId) || ekipId,
          uyeler: uyeIdleri.map((id) => kisiler.get(id)).filter((ad): ad is string => Boolean(ad)).sort((a, b) => a.localeCompare(b, 'tr-TR')),
        }))
        .filter((e) => e.uyeler.length > 0)
        .sort((a, b) => a.ad.localeCompare(b.ad, 'tr-TR', { numeric: true }))
      return NextResponse.json({ success: true, data: { kendiEkibi, ekipler } })
    }

    if (new URL(request.url).searchParams.get('yonetim') === '1') {
      const denied = await requireAdminAccess()
      if (denied) return denied
      const [ekipListesi, kullanicilar, uyeler] = await Promise.all([
        getTahkikatPersonelListesi(),
        tumAktifKullanicilar(),
        ekipUyeleriniGetir(),
      ])
      // Ekip sekmeleri KULLANICI ADIYLA (tahkikat1, tahkikat2...) gosterilir -
      // tahkikat1'in gorunen adi bir kisi adi ("Erhan Temel") oldugu icin
      // uyeler yanlis ekibe kaydedilmisti (2026-10-15).
      const ekipler = ekipListesi
        .map((e) => {
          const username = kullanicilar.find((k) => k.id === e.id)?.username || e.name
          return { id: e.id, name: username, username }
        })
        .sort((a, b) => a.name.localeCompare(b.name, 'tr-TR', { numeric: true }))
      return NextResponse.json({ success: true, data: { ekipler, kullanicilar, uyeler } })
    }

    const durum = await ekipDurumunuGetir(sessionUser, await cookies())
    return NextResponse.json({ success: true, data: durum })
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Ekip bilgisi alınamadı.' },
      { status: 500 },
    )
  }
}

export async function POST(request: Request) {
  try {
    const sessionUser = await getSessionUser()
    if (!sessionUser) {
      return NextResponse.json({ success: false, error: 'Oturum bulunamadı.' }, { status: 401 })
    }

    const body = await request.json().catch(() => ({})) as { personelId?: unknown; password?: unknown }
    const personelId = String(body.personelId ?? '').trim()
    const password = String(body.password ?? '').trim()
    if (!personelId || !password) {
      return NextResponse.json({ success: false, error: 'Personel ve şifre zorunludur.' }, { status: 400 })
    }

    const cookieStore = await cookies()
    const durum = await ekipDurumunuGetir(sessionUser, cookieStore)
    const personel = durum?.uyeler.find((u) => u.id === personelId)
    if (!durum || !personel) {
      return NextResponse.json({ success: false, error: 'Bu personel bu ekipte tanımlı değil.' }, { status: 403 })
    }

    // Giris ekraniyla ayni limit mantigi (bkz. app/api/auth/login/route.ts).
    const rateLimitKey = `ekip-personel:${getRequestClientKey(request)}:${personelId}`
    const rateLimit = checkRateLimit(rateLimitKey, { limit: 10, windowMs: 60 * 1000 })
    if (!rateLimit.allowed) {
      return NextResponse.json(
        { success: false, error: 'Çok fazla hatalı deneme yapıldı. Lütfen kısa süre sonra tekrar deneyin.', retryAfterSeconds: rateLimit.retryAfterSeconds },
        { status: 429 },
      )
    }

    const dogrulanan = await userService.authenticate(personel.username, password)
    if (!dogrulanan || String(dogrulanan.id) !== personel.id) {
      return NextResponse.json({ success: false, error: 'Şifre hatalı.' }, { status: 401 })
    }
    clearRateLimit(rateLimitKey)

    if (dogrulanan.mustChangePassword) {
      return NextResponse.json(
        { success: false, error: 'Şifrenizi değiştirmeniz gerekiyor. Önce kendi kullanıcı adınızla programa bir kez giriş yapıp şifrenizi yenileyin.' },
        { status: 403 },
      )
    }

    const response = NextResponse.json({ success: true, data: { ...durum, aktifPersonel: personel } })
    return ekipPersonelCereziniYaz(response, request, ekipPersonelDegeriOlustur(durum.ekip.id, oturumNumarasi(cookieStore), personel.id))
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Personel girişi yapılamadı.' },
      { status: 500 },
    )
  }
}

export async function DELETE(request: Request) {
  return ekipPersonelCereziniYaz(NextResponse.json({ success: true }), request, null)
}

export async function PUT(request: Request) {
  try {
    const denied = await requireAdminAccess()
    if (denied) return denied

    const body = await request.json().catch(() => ({})) as { uyeler?: unknown }
    if (!body.uyeler || typeof body.uyeler !== 'object' || Array.isArray(body.uyeler)) {
      return NextResponse.json({ success: false, error: 'Geçersiz veri.' }, { status: 400 })
    }

    // Sadece gercek ekip hesaplari (tahkikat*) icin kayit kabul edilir.
    const ekipIdleri = new Set((await getTahkikatPersonelListesi()).map((e) => e.id))
    const temiz: EkipUyeleri = {}
    for (const [ekipId, liste] of Object.entries(body.uyeler as Record<string, unknown>)) {
      if (!ekipIdleri.has(ekipId) || !Array.isArray(liste)) continue
      const uyeler = [...new Set(liste.map((u) => String(u)).filter((u) => /^\d+$/.test(u) && u !== ekipId))]
      if (uyeler.length > 0) temiz[ekipId] = uyeler
    }

    await ekipUyeleriniKaydet(temiz)
    return NextResponse.json({ success: true, data: temiz })
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Ekip üyeleri kaydedilemedi.' },
      { status: 500 },
    )
  }
}
