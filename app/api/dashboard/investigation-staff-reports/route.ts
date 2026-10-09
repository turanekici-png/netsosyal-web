import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db/prisma'
import { getDgnAssistanceStatusLabel } from '@/lib/services/assistanceStatusLabels.service'
import { predefinedValuesService } from '@/lib/services/predefinedValues.service'
import type { PredefinedValueTitlesMap, PredefinedValuesMap } from '@/lib/constants/predefinedValues'

export const dynamic = 'force-dynamic'

type StaffReportRow = {
  record_id: bigint | number | string
  dosyano: string | null
  muracaateden: string | null
  tckimlikno: string | null
  tahkikatpers: string | null
  muracaattarihi: Date | string | null
  miktar: bigint | number | string | null
  asama: string | null
  durumu: number | null
  dosya_durumu: number | null
}

function toDateString(value: Date | string | null | undefined) {
  if (!value) return null
  return new Date(value).toISOString().slice(0, 10)
}

function mapStaffReportRow(
  row: StaffReportRow,
  predefinedValues: PredefinedValuesMap,
  predefinedTitles: PredefinedValueTitlesMap,
) {
  return {
    id: `nakit-${String(row.record_id)}`,
    fileNo: row.dosyano ?? '-',
    applicant: row.muracaateden ?? '-',
    identityNumber: row.tckimlikno ?? '-',
    staff: row.tahkikatpers?.trim() || 'Belirtilmedi',
    applicationDate: toDateString(row.muracaattarihi),
    amount: row.miktar === null ? '-' : String(row.miktar),
    stage: row.asama ?? '-',
    status: getDgnAssistanceStatusLabel(predefinedValues, predefinedTitles, row.durumu),
    // Kullanici istegi: bu alan (raporun en saginda gorunen "dosya
    // durumu") diger raporlardaki (Dosyalar, Belgeler vb.) gibi renkli
    // gosterilsin - bu yuzden BURADA metne CEVRILMEDEN, ham/numerik kod
    // olarak gonderiliyor; renklendirme + metne cevirme AdvancedTable'in
    // KENDI fileStatusColumns mekanizmasinda (digerleriyle AYNI kaynak/
    // renk kurali) yapiliyor - bkz. investigation-staff-reports/page.tsx.
    fileStatus: row.dosya_durumu,
  }
}

export async function GET(request: NextRequest) {
  try {
    const staff = request.nextUrl.searchParams.get('staff') || 'Belirtilmedi'

    const [rows, predefinedSettings] = await Promise.all([
      prisma.$queryRaw<StaffReportRow[]>`
      SELECT t.id::bigint AS record_id, d.dosyano, t.muracaateden,
             COALESCE(t.tckimlikno, b.tckimlikno) AS tckimlikno,
             t.tahkikatpers, t.muracaattarihi, t.miktar::text AS miktar,
             t.asama::text AS asama, t.durumu::int AS durumu,
             d.durumu::int AS dosya_durumu
      FROM yrd_ayninakti t
      LEFT JOIN dosyalar d ON d.id = t.dosyaid
      LEFT JOIN bireyler b ON b.dosyaid = t.dosyaid AND b.adisoyadi = t.muracaateden
      WHERE t.durumu = 0
        AND COALESCE(NULLIF(TRIM(t.tahkikatpers), ''), 'Belirtilmedi') = ${staff}
      ORDER BY
        CASE
          WHEN t.asama ILIKE '%ince%' OR t.asama ILIKE '%İnce%' OR t.asama ILIKE '%İNCE%' THEN 0
          ELSE 1
        END ASC,
        LOWER(COALESCE(NULLIF(TRIM(t.asama), ''), 'Belirtilmedi')) ASC,
        LOWER(COALESCE(NULLIF(TRIM(t.muracaateden), ''), d.dosyano, '')) ASC,
        t.id DESC;
    `,
      predefinedValuesService.getAll(),
    ])

    return NextResponse.json({
      success: true,
      data: {
        staff,
        records: rows.map((row) => mapStaffReportRow(row, predefinedSettings.values, predefinedSettings.titles)),
      },
    })
  } catch (error) {
    return NextResponse.json(
      { success: false, error: (error as Error).message },
      { status: 500 }
    )
  }
}
