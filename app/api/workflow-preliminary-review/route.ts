import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db/prisma'

export const dynamic = 'force-dynamic'

type PreliminaryReviewFileRow = {
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

export async function GET() {
  try {
    // Kullanici istegi (13 Eylul 2026): "dosya sahibi kim ise onun adiyla
    // gorunsun" - "b.tipi = 0" hatali bir kosuldu (projedeki TUM diger
    // "dosya sahibi/asil basvuru sahibi" sorgulari b.tipi = 1 kullanir,
    // bkz. app/api/documents/fetch/route.ts, gulkart/liste, nakit/sync-*
    // vb.) - bu yuzden burada YANLIS kisi (ya da hic kimse) "Dosya Sahibi"
    // olarak gorunuyordu. Ayrica telefon/mahalle/adres de artik cekiliyor.
    const rows = await prisma.$queryRaw<PreliminaryReviewFileRow[]>`
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
        COALESCE(NULLIF(k.kullanicitamadi, ''), NULLIF(k.kullaniciadi, ''), '-') AS user_name
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
      WHERE d.durumu = 5
      ORDER BY COALESCE(d.durumutarih, d.islemtarihi, d.ilkislemtarihi) DESC NULLS LAST, d.id DESC;
    `

    return NextResponse.json({
      success: true,
      data: rows.map((row) => ({
        fileId: String(row.file_id),
        fileNo: toText(row.file_no),
        applicantName: toText(row.applicant_name),
        phone: toText(row.phone),
        neighborhood: toText(row.neighborhood, 'Belirtilmemiş'),
        address: toText(row.address),
        statusDate: toDateTimeString(row.status_date),
        statusDescription: toText(row.status_description),
        updatedAt: toDateTimeString(row.updated_at),
        userName: toText(row.user_name),
      })),
    })
  } catch (error) {
    return NextResponse.json(
      { success: false, error: (error as Error).message || 'Ön inceleme dosyaları alınamadı.' },
      { status: 500 },
    )
  }
}
