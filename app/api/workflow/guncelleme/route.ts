import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db/prisma'
import { ensureIncelemeDegerlendirmeSchema } from '@/app/api/documents/inceleme-degerlendirme/_lib/schema'

export const dynamic = 'force-dynamic'

type UpdateWorkflowRow = {
  file_id: bigint | number | string
  file_no: string | null
  applicant_name: string | null
  phone: string | null
  neighborhood: string | null
  address: string | null
  updated_at: Date | string | null
  last_visit_date: Date | string | null
  last_visit_info: string | null
  visit_user_name: string | null
  last_tahkikat_date: Date | string | null
  last_tahkikat_karar: string | null
  last_tahkikat_puan: number | null
  last_tahkikat_maksimum_puan: number | null
  last_tahkikat_eliminasyon: string | null
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
    // Kullanici istegi (13 Eylul 2026): "Sonuç Bekleyen sayfasinida ayni
    // sekilde ön inceleme ve tahkikat sayfasinda oldugu gibi duzenleyelim" -
    // telefon/mahalle/adres eklendi (ayni LATERAL deseni). "b.tipi = 0" da
    // ayni hatali kosuldu (workflow-preliminary-review/route.ts ve
    // workflow/tahkikat/route.ts'deki AYNI hatanin bir kopyasi) - b.tipi = 1
    // olarak duzeltildi.
    //
    // Kullanici istegi (13 Eylul 2026, devami): "bu alanda aynı zamanda en
    // son yapılan tahkikat raporu bilgiside görünsün" - dosya artik Tahkikat
    // Formu kaydedilince (durumu=2) buraya dusuyor (bkz. app/api/documents/
    // inceleme-degerlendirme/route.ts POST), o yuzden eski evziyareti tabanli
    // "Son Ev Ziyareti" cogu zaman bos kaliyor - en son inceleme_degerlendirme_
    // formu kaydi (tarih/karar/puan/eliminasyon) da ayrica cekiliyor.
    await ensureIncelemeDegerlendirmeSchema()

    const rows = await prisma.$queryRaw<UpdateWorkflowRow[]>`
      SELECT
        d.id AS file_id,
        d.dosyano AS file_no,
        COALESCE(NULLIF(owner.adisoyadi, ''), NULLIF(TRIM(CONCAT(owner.adi, ' ', owner.soyadi)), ''), '-') AS applicant_name,
        COALESCE(NULLIF(owner.ceptel, ''), NULLIF(d.telefon, '')) AS phone,
        COALESCE(NULLIF(owner.nfmahkoy, ''), NULLIF(d.mahalleadi, '')) AS neighborhood,
        COALESCE(NULLIF(owner.adres, ''), NULLIF(d.adres, '')) AS address,
        d.islemtarihi AS updated_at,
        last_visit.tarih AS last_visit_date,
        last_visit.rapor AS last_visit_info,
        COALESCE(NULLIF(visit_user.kullanicitamadi, ''), NULLIF(visit_user.kullaniciadi, ''), '-') AS visit_user_name,
        last_tahkikat.tarih AS last_tahkikat_date,
        last_tahkikat.karar AS last_tahkikat_karar,
        last_tahkikat.toplam_puan AS last_tahkikat_puan,
        last_tahkikat.maksimum_puan AS last_tahkikat_maksimum_puan,
        last_tahkikat.eliminasyon_sonucu AS last_tahkikat_eliminasyon
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
      LEFT JOIN LATERAL (
        SELECT v.tarih, v.rapor, v.kullaniciid, v.islemtarihi, v.id
        FROM evziyareti v
        WHERE v.dosyaid = d.id
        ORDER BY COALESCE(v.tarih::timestamp, v.islemtarihi, v.ilkislemtarihi) DESC NULLS LAST, v.id DESC
        LIMIT 1
      ) last_visit ON true
      LEFT JOIN kullanicilar visit_user ON visit_user.id::text = last_visit.kullaniciid::text
      LEFT JOIN LATERAL (
        SELECT f.tarih, f.karar, f.toplam_puan, f.maksimum_puan, f.eliminasyon_sonucu, f.id
        FROM inceleme_degerlendirme_formu f
        WHERE f.dosyaid = d.id
        ORDER BY f.tarih DESC NULLS LAST, f.id DESC
        LIMIT 1
      ) last_tahkikat ON true
      WHERE d.durumu = 2
      ORDER BY COALESCE(last_visit.tarih::timestamp, d.islemtarihi, d.ilkislemtarihi) DESC NULLS LAST, d.id DESC;
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
        updatedAt: toDateTimeString(row.updated_at),
        lastVisitDate: toDateTimeString(row.last_visit_date),
        lastVisitInfo: toText(row.last_visit_info),
        visitUserName: toText(row.visit_user_name),
        lastTahkikatDate: toDateTimeString(row.last_tahkikat_date),
        lastTahkikatKarar: row.last_tahkikat_karar,
        lastTahkikatPuan: row.last_tahkikat_puan,
        lastTahkikatMaksimumPuan: row.last_tahkikat_maksimum_puan,
        lastTahkikatEliminasyon: row.last_tahkikat_eliminasyon,
      })),
    })
  } catch (error) {
    return NextResponse.json(
      { success: false, error: (error as Error).message || 'Guncelleme dosyalari alinamadi.' },
      { status: 500 },
    )
  }
}
