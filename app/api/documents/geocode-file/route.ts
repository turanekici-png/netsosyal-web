import { createHash } from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db/prisma'
import { requireApiAccess, getSessionUser } from '@/lib/apiAuth'
import { buildGeocodeAddress, buildGeocodeAddressCandidates, geocodeSivasAddress } from '@/lib/services/geocoding'
import { getAuditMetaFromRequest, withAuditedWrite } from '@/lib/db/auditContext'
import { checkRateLimit, getRequestClientKey } from '@/lib/security/rateLimit'

export const dynamic = 'force-dynamic'

type FileAddressRow = {
  id: bigint
  adres: string | null
  adresno: string | null
  mahalleadi: string | null
  cadde: string | null
  sokak: string | null
  binano: string | null
  site: string | null
  blok: string | null
  konum_enlem: number | null
  konum_boylam: number | null
  konum_durumu: string | null
}

const getAddressHash = (value: string) => createHash('sha1').update(value).digest('hex')

function cleanBigInt(value: unknown) {
  const text = String(value ?? '').trim()
  if (!text || !/^\d+$/.test(text)) return null
  try {
    return BigInt(text)
  } catch {
    return null
  }
}

// Dosya detayindaki "Haritada Goster" butonu icin ANLIK (tek dosyalik)
// geocode ucu.
//
// NOT: Gercek Sivas adresleriyle Nominatim'e karsi CANLI test edilerek
// bulundu - "Sokak, Mahalle Mahallesi, Sivas" gibi KISA/SADE sorgular
// guvenilir sekilde calisirken, TUM adres bilgisini (site/blok/ic kapi no
// dahil) TEK BIR uzun metinde birlestirmek CogUNLUKLA sonuc bulamiyordu
// (bu, "adres yerine genel/il capinda bir yer gosteriyor" sikayetinin kok
// nedeniydi). buildGeocodeAddressCandidates, EN DETAYLIDAN EN GENELE dogru
// SIRALI birden fazla aday uretir; asagidaki fonksiyon ilk basarili
// adayi kullanir - boylece en azindan mahalle duzeyinde bir sonuc,
// "bulunamadi" ile bitmekten HER ZAMAN daha iyi kabul edilir.
export async function POST(request: NextRequest) {
  try {
    const accessDenied = await requireApiAccess({ page: '/documents' })
    if (accessDenied) return accessDenied

    // Bu uc, dosya ekrani her acildiginda OTOMATIK olarak (buton tiklamasi
    // beklemeden, arka planda) tetikleniyor - hiz siniri olmadan, personel
    // hizli sekilde birçok dosya arasinda gezinirse Nominatim/Google'a kisa
    // surede cok sayida istek gidebilir. Nominatim'in kullanim politikasi
    // KATI (saniyede en fazla 1 istek, agir otomatik kullanim yasak) - bunu
    // ihlal etmek sunucunun IP'sinin engellenmesine (TUM kullanicilar icin
    // haritanin tamamen bozulmasina) yol acabilir. Bu yuzden makul bir
    // kullanici bazli hiz siniri uygulaniyor.
    // Kullanici bazli sinir - ters proxy yokken IP (getRequestClientKey)
    // sabit oldugu icin oturum kullanicisi anahtara eklenir; boylece bir
    // personelin hizli gezinmesi digerlerini etkilemez.
    const geocodeUser = await getSessionUser()
    const rateLimit = checkRateLimit(`geocode-file:${geocodeUser?.id ?? getRequestClientKey(request)}`, { limit: 60, windowMs: 60 * 1000 })
    if (!rateLimit.allowed) {
      return NextResponse.json(
        { success: false, error: 'Çok fazla konum sorgusu yapıldı. Lütfen kısa süre sonra tekrar deneyin.' },
        { status: 429, headers: { 'Retry-After': String(rateLimit.retryAfterSeconds) } },
      )
    }

    const payload = await request.json().catch(() => ({}))
    const fileId = cleanBigInt(payload.fileId)
    if (!fileId) {
      return NextResponse.json({ success: false, error: 'Dosya bilgisi zorunludur.' }, { status: 400 })
    }

    const rows = await prisma.$queryRaw<FileAddressRow[]>`
      SELECT id, adres, adresno, mahalleadi, cadde, sokak, binano, site, blok, konum_enlem, konum_boylam, konum_durumu
      FROM dosyalar
      WHERE id = ${fileId}
      LIMIT 1
    `
    const row = rows[0]
    if (!row) {
      return NextResponse.json({ success: false, error: 'Dosya bulunamadı.' }, { status: 404 })
    }

    // Daha once basariyla cozulmus bir konum varsa, HARICI servise (Google/
    // Nominatim) TEKRAR istek atmadan aninda donuyoruz - hem gereksiz gecikme
    // hem de yukaridaki kullanim-politikasi riskini onler.
    if (row.konum_durumu === 'ok' && row.konum_enlem !== null && row.konum_boylam !== null) {
      return NextResponse.json({ success: true, lat: row.konum_enlem, lon: row.konum_boylam, cached: true })
    }

    const address = buildGeocodeAddress(row)
    const candidates = buildGeocodeAddressCandidates(row)
    // Kullanici istegi: konum, ONCE Sivas Belediyesi'nin KENDI Kent Rehberi
    // servisinden, dosyanin (NVİ'den gelen) UAVT adres numarasiyla aranir -
    // bu, serbest metin adresi TAHMIN eden Google/Nominatim'den daha isabetli
    // VE hicbir kota/anahtar gerektirmiyor. Sadece o basarisiz olursa (adresno
    // yok, UAVT'de yok ya da o binanin harita geometrisi henuz islenmemis)
    // mevcut metin tabanli akisa dusulur (bkz. lib/services/geocoding.ts).
    const outcome = await geocodeSivasAddress(row.adresno, candidates)

    if (outcome.status !== 'ok') {
      return NextResponse.json({ success: false, error: outcome.error }, { status: 422 })
    }

    // Sonucu ileride tekrar kullanilabilsin diye kaydediyoruz.
    const addressHash = getAddressHash(address)
    await withAuditedWrite(async (tx) => {
      await tx.$executeRaw`
        UPDATE dosyalar
        SET konum_enlem = ${outcome.result.lat},
            konum_boylam = ${outcome.result.lon},
            konum_kaynagi = ${outcome.result.source},
            konum_guven = ${outcome.result.score ?? null},
            konum_durumu = 'ok',
            konum_hata = NULL,
            konum_adres_hash = ${addressHash}
        WHERE id = ${fileId};
      `
    }, getAuditMetaFromRequest(request))

    return NextResponse.json({ success: true, lat: outcome.result.lat, lon: outcome.result.lon })
  } catch (error) {
    console.error('geocode-file hatasi:', error)
    return NextResponse.json({ success: false, error: 'Konum bulunamadı.' }, { status: 500 })
  }
}
