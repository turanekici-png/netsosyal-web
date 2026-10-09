import { createHash } from 'crypto'
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db/prisma'
import { requireApiAccess } from '@/lib/apiAuth'
import { buildGeocodeAddress, buildGeocodeAddressCandidates, geocodeByUavtAdresNo, geocodeSivasMerkezAddressCandidates, isSivasMerkezAddressText } from '@/lib/services/geocoding'
import { getAuditMetaFromRequest, withAuditedWrite } from '@/lib/db/auditContext'

export const dynamic = 'force-dynamic'

type RequestAddressRow = {
  id: bigint
  adres: string | null
  adresno: string | null
  mahalleadi: string | null
  cadde: string | null
  sokak: string | null
  site: string | null
  blok: string | null
  binano: string | null
  daireno: string | null
  konum_adres_hash: string | null
}

const getAddressHash = (value: string) => createHash('sha1').update(value).digest('hex')

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

export async function POST(request: Request) {
  // Bu uc, dis servislere (Google/ucretsiz Nominatim) toplu istek atan bir
  // bakim/toplu-isleme ucu - herhangi bir yetki kontrolu YOKTU, yani
  // oturum acmis HERHANGI bir kullanici (dusuk yetkili olsa bile) bunu
  // tekrar tekrar tetikleyip harici servis kullanim politikasini
  // zorlayabilir/IP engellenmesine yol acabilirdi. Sayfa erisimini zaten
  // gerektiren "/assistance/map" izniyle sinirlandirildi.
  const accessDenied = await requireApiAccess({ page: '/assistance/map' })
  if (accessDenied) return accessDenied

  const body = await request.json().catch(() => ({})) as { limit?: number; force?: boolean }
  const limit = Math.min(Math.max(Number(body.limit) || 5, 1), 10)
  const force = Boolean(body.force)

  const rows = await prisma.$queryRawUnsafe<RequestAddressRow[]>(
    `WITH yardim_dosyalar AS (
       SELECT dosyaid FROM yrd_ekmek WHERE durumu = 2
       UNION
       SELECT dosyaid FROM yrd_gidabankasi WHERE durumu = 2
       UNION
       SELECT dosyaid FROM yrd_haziryemek WHERE durumu = 2
       UNION
       SELECT dosyaid FROM yrd_destekpaketi WHERE durumu = 2
     )
     SELECT d.id, d.adres, d.adresno, d.mahalleadi, d.cadde, d.sokak, d.site, d.blok, d.binano, d.daireno, d.konum_adres_hash
     FROM dosyalar d
     INNER JOIN yardim_dosyalar y ON y.dosyaid = d.id
     WHERE d.durumu = 3
       AND d.adres IS NOT NULL
       AND d.adres <> ''
       AND UPPER(d.adres) LIKE '%MERKEZ%'
       AND (
         $1::boolean = true OR
         d.konum_enlem IS NULL OR
         d.konum_boylam IS NULL OR
         d.konum_durumu IS DISTINCT FROM 'ok'
       )
     ORDER BY d.id
     LIMIT $2`,
    force,
    limit
  )

  const results: Array<{ id: string; status: string; error?: string }> = []

  for (const row of rows) {
    const address = buildGeocodeAddress(row)
    const candidates = buildGeocodeAddressCandidates(row)
    const hash = getAddressHash(address)

    // Kullanici istegi: ONCE Sivas Belediyesi'nin KENDI Kent Rehberi
    // servisinden, dosyanin (NVİ'den gelen) UAVT adres numarasiyla denenir -
    // bu, serbest metin adresi TAHMIN eden Google/Nominatim'den daha isabetli
    // VE kota/anahtar gerektirmiyor (bkz. lib/services/geocoding.ts). Sadece
    // basarisiz olursa (adresno yok, UAVT'de yok ya da o binanin harita
    // geometrisi henuz islenmemis) asagidaki mevcut metin tabanli akisa
    // dusulur - "outside_center" kisa devresi de bu yuzden BURADAN SONRA.
    const kentRehberiOutcome = await geocodeByUavtAdresNo(row.adresno)
    if (kentRehberiOutcome.status === 'ok') {
      await withAuditedWrite((tx) => tx.$executeRawUnsafe(
        `UPDATE dosyalar
         SET konum_enlem = $1,
             konum_boylam = $2,
             konum_kaynagi = $3,
             konum_durumu = $4,
             konum_guven = $5,
             konum_adres_hash = $6,
             konum_hata = NULL,
             konum_tarihi = CURRENT_TIMESTAMP
         WHERE id = $7`,
        kentRehberiOutcome.result.lat,
        kentRehberiOutcome.result.lon,
        kentRehberiOutcome.result.source,
        'ok',
        kentRehberiOutcome.result.score ?? null,
        hash,
        row.id
      ), getAuditMetaFromRequest(request))
      results.push({ id: row.id.toString(), status: 'ok' })
      continue
    }

    if (candidates.length === 0 || !isSivasMerkezAddressText(address)) {
      await withAuditedWrite((tx) => tx.$executeRawUnsafe(
        `UPDATE dosyalar
         SET konum_durumu = $1, konum_hata = $2, konum_adres_hash = $3, konum_tarihi = CURRENT_TIMESTAMP
         WHERE id = $4`,
        'outside_center',
        'Adres Sivas il merkezi disinda',
        hash,
        row.id
      ), getAuditMetaFromRequest(request))
      results.push({ id: row.id.toString(), status: 'outside_center' })
      continue
    }

    const outcome = await geocodeSivasMerkezAddressCandidates(candidates)

    if (outcome.status === 'ok') {
      await withAuditedWrite((tx) => tx.$executeRawUnsafe(
        `UPDATE dosyalar
         SET konum_enlem = $1,
             konum_boylam = $2,
             konum_kaynagi = $3,
             konum_durumu = $4,
             konum_guven = $5,
             konum_adres_hash = $6,
             konum_hata = NULL,
             konum_tarihi = CURRENT_TIMESTAMP
         WHERE id = $7`,
        outcome.result.lat,
        outcome.result.lon,
        outcome.result.source,
        'ok',
        outcome.result.score ?? null,
        hash,
        row.id
      ), getAuditMetaFromRequest(request))
      results.push({ id: row.id.toString(), status: 'ok' })
      await sleep(1300)
      continue
    }

    const shouldPersistFailure = outcome.status !== 'rate_limited'
    if (shouldPersistFailure) {
      await withAuditedWrite((tx) => tx.$executeRawUnsafe(
        `UPDATE dosyalar
         SET konum_durumu = $1,
             konum_hata = $2,
             konum_adres_hash = $3,
             konum_tarihi = CURRENT_TIMESTAMP
         WHERE id = $4`,
        outcome.status,
        outcome.error,
        hash,
        row.id
      ), getAuditMetaFromRequest(request))
    }

    results.push({ id: row.id.toString(), status: outcome.status, error: outcome.error })
    if (outcome.status === 'rate_limited') break
    await sleep(1300)
  }

  return NextResponse.json({
    success: true,
    processed: results.length,
    ok: results.filter(result => result.status === 'ok').length,
    results,
  })
}
