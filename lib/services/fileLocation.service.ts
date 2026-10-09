// Kullanici istegi: bir dosyanin adresi (el ile "Dosya Duzenle" ekranindan
// ya da NVİ'den otomatik tazeleme ile - bkz. addressAutoRefresh.service.ts)
// DEGISTIGINDE, haritadaki konum ESKI (bulunmus) degerde TAKILI KALMASIN -
// "eski dosyalari adreslerini sorguladikca yeni koordinatlar guncellenir"
// istegi burada karsilaniyor. Cagiran taraf, adres alanlarini guncelledikten
// SONRA regeocodeFileLocationInBackground'i cagirir: konum ARKA PLANDA
// (yaniti bekletmeden) ONCE Sivas Kent Rehberi'nden (UAVT adres numarasiyla,
// varsa), o basarisiz olursa Google/Nominatim'den yeniden hesaplanip
// kaydedilir - kullanici dosyayi tekrar acmasa BILE harita guncel adresi
// yansitir.
import { createHash } from 'crypto'
import { prisma } from '@/lib/db/prisma'
import { withAuditedWrite } from '@/lib/db/auditContext'
import { buildGeocodeAddress, buildGeocodeAddressCandidates, geocodeSivasAddress } from '@/lib/services/geocoding'

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
}

type AuditMeta = { ip?: string | null; path?: string | null }

const getAddressHash = (value: string) => createHash('sha1').update(value).digest('hex')

// Dis servis cagrisi (geocoding) icerdigi icin BILEREK bir DB transaction'i
// icinde DEGIL - auditContext.ts'teki uyariya uygun olarak, her yazma kendi
// KISA transaction'inda (withAuditedWrite) yapiliyor.
export async function regeocodeFileLocation(fileId: bigint, auditMeta?: AuditMeta): Promise<void> {
  const rows = await prisma.$queryRaw<FileAddressRow[]>`
    SELECT id, adres, adresno, mahalleadi, cadde, sokak, binano, site, blok
    FROM dosyalar
    WHERE id = ${fileId}
    LIMIT 1
  `
  const row = rows[0]
  if (!row) return

  const address = buildGeocodeAddress(row)
  const candidates = buildGeocodeAddressCandidates(row)
  const addressHash = getAddressHash(address)
  const outcome = await geocodeSivasAddress(row.adresno, candidates)

  if (outcome.status === 'ok') {
    await withAuditedWrite(async (tx) => {
      await tx.$executeRaw`
        UPDATE dosyalar
        SET konum_enlem = ${outcome.result.lat},
            konum_boylam = ${outcome.result.lon},
            konum_kaynagi = ${outcome.result.source},
            konum_guven = ${outcome.result.score ?? null},
            konum_durumu = 'ok',
            konum_hata = NULL,
            konum_adres_hash = ${addressHash},
            konum_tarihi = CURRENT_TIMESTAMP
        WHERE id = ${fileId};
      `
    }, auditMeta)
    return
  }

  // Gecici bir durum olan "rate_limited" haric, basarisizligi da kaydediyoruz
  // (ör. "Sivas il merkezi disinda") - ayni adres tekrar tekrar bosuna
  // denenmesin, ama kullanici "Haritada Goster" ile YINE de elle deneyebilir.
  if (outcome.status !== 'rate_limited') {
    await withAuditedWrite(async (tx) => {
      await tx.$executeRaw`
        UPDATE dosyalar
        SET konum_durumu = ${outcome.status},
            konum_hata = ${outcome.error},
            konum_adres_hash = ${addressHash},
            konum_tarihi = CURRENT_TIMESTAMP
        WHERE id = ${fileId};
      `
    }, auditMeta)
  }
}

// HTTP rota/arka plan gorevinin YANITI BEKLETMEDEN cagirmasi icin - hatalar
// sessizce yutulur (yan islem, kullanicinin asil islemini bozmamali).
export function regeocodeFileLocationInBackground(fileId: bigint, auditMeta?: AuditMeta): void {
  void regeocodeFileLocation(fileId, auditMeta).catch(() => { /* yan islem - sessizce yoksay */ })
}
