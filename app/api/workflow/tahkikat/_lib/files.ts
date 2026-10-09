import { prisma } from '@/lib/db/prisma'
import { foldTurkish } from '@/lib/utils'
import { ensureTahkikatAtamalariTable } from './assignments'
import { ensureTahkikatPaketleriTable } from './rotation'
import { applyDueRotations } from './autoRotate'

type PaketOwnerRow = {
  id: bigint | number | string
  mahalleler: unknown
  sorumlukullaniciid: bigint | number | string | null
  sorumlu_ad: string | null
}

type InvestigationFileRow = {
  file_id: bigint | number | string
  file_no: string | null
  applicant_name: string | null
  phone: string | null
  neighborhood: string | null
  address: string | null
  status_date: Date | string | null
  status_description: string | null
  updated_at: Date | string | null
  user_name: string | null
  assigned_user_id: bigint | number | string | null
  assigned_user_name: string | null
  assigned_seen: boolean | null
}

function toDateTimeString(value: Date | string | null) {
  if (!value) return null
  const date = value instanceof Date ? value : new Date(value)
  return Number.isNaN(date.getTime()) ? String(value) : date.toISOString()
}

function toText(value: unknown, fallback = '-') {
  const text = String(value ?? '').trim()
  return text || fallback
}

export type AnnotatedTahkikatFile = {
  fileId: string
  fileNo: string
  applicantName: string
  phone: string
  neighborhood: string
  address: string
  statusDate: string | null
  statusDescription: string
  updatedAt: string | null
  userName: string
  assignedUserId: string | null
  assignedUserName: string | null
  assignedSeen: boolean | null
  zoneOwnerId: string | null
  zoneOwnerName: string | null
  effectiveOwnerId: string | null
}

// Tahkikat asamasindaki (dosyalar.durumu = 1) TUM dosyalari, her birinin
// "fiili sahibi" (effectiveOwnerId: MANUEL atama varsa o, yoksa o ayki
// paket/mahalle rotasyonu) ile birlikte doner. Hem ana liste (GET
// /api/workflow/tahkikat - gorunurluk kisitlamasi icin) hem de personel
// sekmesi (GET /api/workflow/tahkikat/personnel - "kimde kac dosya var"
// sayaci icin) AYNI bu fonksiyonu kullanir - iki yerde ayri ayri
// hesaplanirsa (bkz. 2026-10-08 duzeltmesi) sayilar birbirini tutmaz hale
// gelebiliyordu (sekme rozetleri "0" gosterirken liste dogru filtreleniyordu).
export async function getAnnotatedTahkikatFiles(): Promise<AnnotatedTahkikatFile[]> {
  await ensureTahkikatAtamalariTable()
  await ensureTahkikatPaketleriTable()

  const rows = await prisma.$queryRaw<InvestigationFileRow[]>`
    SELECT
      d.id AS file_id,
      d.dosyano AS file_no,
      COALESCE(NULLIF(owner.adisoyadi, ''), NULLIF(TRIM(CONCAT(owner.adi, ' ', owner.soyadi)), ''), '-') AS applicant_name,
      COALESCE(NULLIF(owner.ceptel, ''), NULLIF(d.telefon, '')) AS phone,
      COALESCE(NULLIF(owner.nfmahkoy, ''), NULLIF(d.mahalleadi, '')) AS neighborhood,
      COALESCE(NULLIF(owner.adres, ''), NULLIF(d.adres, '')) AS address,
      d.durumutarih AS status_date,
      d.durumuaciklama AS status_description,
      d.islemtarihi AS updated_at,
      COALESCE(NULLIF(k.kullanicitamadi, ''), NULLIF(k.kullaniciadi, ''), '-') AS user_name,
      ta.atanankullaniciid AS assigned_user_id,
      COALESCE(NULLIF(ak.kullanicitamadi, ''), NULLIF(ak.kullaniciadi, '')) AS assigned_user_name,
      ta.gorundu AS assigned_seen
    FROM dosyalar d
    LEFT JOIN LATERAL (
      SELECT b.adisoyadi, b.adi, b.soyadi, b.ceptel, b.nfmahkoy, b.adres
      FROM bireyler b
      WHERE b.dosyaid = d.id
      ORDER BY
        CASE
          WHEN b.tipi = 1 THEN 0
          WHEN b.yakinligi = 0 THEN 1
          ELSE 2
        END,
        b.id ASC
      LIMIT 1
    ) owner ON true
    LEFT JOIN kullanicilar k ON k.id::text = d.kullaniciid::text
    LEFT JOIN tahkikat_atamalari ta ON ta.dosyaid = d.id
    LEFT JOIN kullanicilar ak ON ak.id::text = ta.atanankullaniciid::text
    WHERE d.durumu = 1
    ORDER BY COALESCE(d.durumutarih, d.islemtarihi, d.ilkislemtarihi) DESC NULLS LAST, d.id DESC;
  `

  await applyDueRotations()

  const paketRows = await prisma.$queryRaw<PaketOwnerRow[]>`
    SELECT p.id, p.mahalleler, p.sorumlukullaniciid,
      COALESCE(NULLIF(u.kullanicitamadi, ''), NULLIF(u.kullaniciadi, '')) AS sorumlu_ad
    FROM tahkikat_paketleri p
    LEFT JOIN kullanicilar u ON u.id::text = p.sorumlukullaniciid::text
    ORDER BY p.sira ASC, p.id ASC;
  `

  const mahalleToOwnerId = new Map<string, string>()
  const mahalleToOwnerName = new Map<string, string>()
  for (const paket of paketRows) {
    if (!paket.sorumlukullaniciid) continue
    const ownerId = String(paket.sorumlukullaniciid)
    const mahalleler = Array.isArray(paket.mahalleler) ? paket.mahalleler.filter((m): m is string => typeof m === 'string') : []
    for (const mahalle of mahalleler) {
      const normalized = foldTurkish(mahalle).trim()
      if (!normalized) continue
      mahalleToOwnerId.set(normalized, ownerId)
      if (paket.sorumlu_ad) mahalleToOwnerName.set(normalized, paket.sorumlu_ad)
    }
  }

  return rows.map((row) => {
    const neighborhood = toText(row.neighborhood, 'Belirtilmemiş')
    const normalizedNeighborhood = foldTurkish(neighborhood).trim()
    const zoneOwnerId = normalizedNeighborhood ? (mahalleToOwnerId.get(normalizedNeighborhood) ?? null) : null
    const zoneOwnerName = normalizedNeighborhood ? (mahalleToOwnerName.get(normalizedNeighborhood) ?? null) : null
    const assignedUserId = row.assigned_user_id ? String(row.assigned_user_id) : null
    const effectiveOwnerId = assignedUserId || zoneOwnerId

    return {
      fileId: String(row.file_id),
      fileNo: toText(row.file_no),
      applicantName: toText(row.applicant_name),
      phone: toText(row.phone),
      neighborhood,
      address: toText(row.address),
      statusDate: toDateTimeString(row.status_date),
      statusDescription: toText(row.status_description),
      updatedAt: toDateTimeString(row.updated_at),
      userName: toText(row.user_name),
      assignedUserId,
      assignedUserName: row.assigned_user_name ? String(row.assigned_user_name) : null,
      assignedSeen: row.assigned_seen ?? null,
      zoneOwnerId,
      zoneOwnerName,
      effectiveOwnerId,
    }
  })
}
