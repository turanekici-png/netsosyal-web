import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db/prisma'
import { updateExpiredAssistanceStatuses } from '@/lib/services/assistanceExpiry.service'
import {
  getAssistanceStatusLabel,
  getDgnAssistanceStatusLabel,
} from '@/lib/services/assistanceStatusLabels.service'
import { predefinedValuesService } from '@/lib/services/predefinedValues.service'
import type { PredefinedValueTitlesMap, PredefinedValuesMap } from '@/lib/constants/predefinedValues'

export const dynamic = 'force-dynamic'

type ReportType = 'Gida' | 'Ekmek' | 'Destek Paketi' | 'Hazir Yemek' | 'Giyim' | 'Nakit Yardimi'

type ReportRow = {
  record_id: bigint | number | string
  dosyano: string | null
  muracaateden: string | null
  tckimlikno: string | null
  bastarih: Date | string | null
  bittarih: Date | string | null
  miktar: bigint | number | string | null
  yardim_durumu: number | null
  dosya_durumu: number | null
}

const reportTypes: ReportType[] = [
  'Gida',
  'Ekmek',
  'Destek Paketi',
  'Hazir Yemek',
  'Giyim',
  'Nakit Yardimi',
]

function toDateString(value: Date | string | null | undefined) {
  if (!value) return null
  return new Date(value).toISOString().slice(0, 10)
}

function mapReportRow(
  type: ReportType,
  row: ReportRow,
  predefinedValues: PredefinedValuesMap,
  predefinedTitles: PredefinedValueTitlesMap,
) {
  const usesDgnStatus = type === 'Giyim' || type === 'Nakit Yardimi'

  return {
    id: `${type}-${String(row.record_id)}`,
    type,
    fileNo: row.dosyano ?? '-',
    applicant: row.muracaateden ?? '-',
    identityNumber: row.tckimlikno ?? '-',
    startDate: toDateString(row.bastarih),
    endDate: toDateString(row.bittarih),
    amount: row.miktar === null ? '-' : String(row.miktar),
    assistanceStatusCode: row.yardim_durumu === null ? '' : String(row.yardim_durumu),
    assistanceStatusVariant: usesDgnStatus ? 'dgn' : 'default',
    assistanceStatus: usesDgnStatus
      ? getDgnAssistanceStatusLabel(predefinedValues, predefinedTitles, row.yardim_durumu)
      : getAssistanceStatusLabel(predefinedValues, row.yardim_durumu),
    // Kullanici istegi: "dosya durumu" acilan TUM listelerde/sayfalarda
    // AYNI sekilde renkli gorunsun - bu yuzden BURADA metne CEVRILMEDEN,
    // ham/numerik kod olarak gonderiliyor; renklendirme + metne cevirme
    // AdvancedTable'in KENDI fileStatusColumns mekanizmasinda (diger
    // raporlarla AYNI kaynak/renk kurali) yapiliyor - bkz. page.tsx.
    fileStatus: row.dosya_durumu,
  }
}

async function getRows(type: ReportType) {
  if (type === 'Gida') {
    return prisma.$queryRaw<ReportRow[]>`
      SELECT DISTINCT ON (t.dosyaid)
             t.id::bigint AS record_id, d.dosyano, t.muracaateden,
             b.tckimlikno, t.bastarih, t.bittarih, t.miktar::text AS miktar,
             t.durumu::int AS yardim_durumu, d.durumu::int AS dosya_durumu
      FROM yrd_gidabankasi t
      INNER JOIN dosyalar d ON d.id = t.dosyaid
      LEFT JOIN bireyler b ON b.dosyaid = t.dosyaid AND b.adisoyadi = t.muracaateden
      WHERE t.dosyaid IS NOT NULL AND t.durumu = 2 AND d.durumu = 3
      ORDER BY t.dosyaid, t.id DESC;
    `
  }

  if (type === 'Ekmek') {
    return prisma.$queryRaw<ReportRow[]>`
      SELECT DISTINCT ON (t.dosyaid)
             t.id::bigint AS record_id, d.dosyano, t.muracaateden,
             b.tckimlikno, t.bastarih, t.bittarih, t.miktar::text AS miktar,
             t.durumu::int AS yardim_durumu, d.durumu::int AS dosya_durumu
      FROM yrd_ekmek t
      INNER JOIN dosyalar d ON d.id = t.dosyaid
      LEFT JOIN bireyler b ON b.dosyaid = t.dosyaid AND b.adisoyadi = t.muracaateden
      WHERE t.dosyaid IS NOT NULL AND t.durumu = 2 AND d.durumu = 3
      ORDER BY t.dosyaid, t.id DESC;
    `
  }

  if (type === 'Destek Paketi') {
    return prisma.$queryRaw<ReportRow[]>`
      SELECT DISTINCT ON (t.dosyaid)
             t.id::bigint AS record_id, d.dosyano, t.muracaateden,
             b.tckimlikno, t.bastarih, t.bittarih, t.miktar::text AS miktar,
             t.durumu::int AS yardim_durumu, d.durumu::int AS dosya_durumu
      FROM yrd_destekpaketi t
      INNER JOIN dosyalar d ON d.id = t.dosyaid
      LEFT JOIN bireyler b ON b.dosyaid = t.dosyaid AND b.adisoyadi = t.muracaateden
      WHERE t.dosyaid IS NOT NULL AND t.durumu = 2 AND d.durumu = 3
      ORDER BY t.dosyaid, t.id DESC;
    `
  }

  if (type === 'Hazir Yemek') {
    return prisma.$queryRaw<ReportRow[]>`
      SELECT DISTINCT ON (t.dosyaid)
             t.id::bigint AS record_id, d.dosyano, t.muracaateden,
             b.tckimlikno, t.bastarih, t.bittarih,
             COALESCE(t.miktar, t.kisisayisi, t.ekmekmiktari)::text AS miktar,
             t.durumu::int AS yardim_durumu, d.durumu::int AS dosya_durumu
      FROM yrd_haziryemek t
      INNER JOIN dosyalar d ON d.id = t.dosyaid
      LEFT JOIN bireyler b ON b.dosyaid = t.dosyaid AND b.adisoyadi = t.muracaateden
      WHERE t.dosyaid IS NOT NULL AND t.durumu = 2 AND d.durumu = 3
      ORDER BY t.dosyaid, t.id DESC;
    `
  }

  if (type === 'Giyim') {
    return prisma.$queryRaw<ReportRow[]>`
      SELECT DISTINCT ON (t.dosyaid)
             t.id::bigint AS record_id, d.dosyano, t.muracaateden,
             b.tckimlikno, t.muracaattarihi::date AS bastarih, NULL::date AS bittarih, t.miktar::text AS miktar,
             t.durumu::int AS yardim_durumu, d.durumu::int AS dosya_durumu
      FROM yrd_giyim t
      INNER JOIN dosyalar d ON d.id = t.dosyaid
      LEFT JOIN bireyler b ON b.dosyaid = t.dosyaid AND b.adisoyadi = t.muracaateden
      WHERE t.dosyaid IS NOT NULL AND t.durumu = 6 AND d.durumu = 3
      ORDER BY t.dosyaid, t.id DESC;
    `
  }

  return prisma.$queryRaw<ReportRow[]>`
    SELECT DISTINCT ON (t.dosyaid)
           t.id::bigint AS record_id, d.dosyano, t.muracaateden,
           b.tckimlikno, t.ilkislemtarihi::date AS bastarih, NULL::date AS bittarih,
           t.miktar::text AS miktar, t.durumu::int AS yardim_durumu, d.durumu::int AS dosya_durumu
    FROM yrd_ayninakti t
    INNER JOIN dosyalar d ON d.id = t.dosyaid
    LEFT JOIN bireyler b ON b.dosyaid = t.dosyaid AND b.adisoyadi = t.muracaateden
    WHERE t.dosyaid IS NOT NULL AND t.durumu = 6 AND d.durumu = 3
    ORDER BY t.dosyaid, t.id DESC;
  `
}

export async function GET(request: NextRequest) {
  try {
    await updateExpiredAssistanceStatuses()

    const type = request.nextUrl.searchParams.get('type') as ReportType | null

    if (!type || !reportTypes.includes(type)) {
      return NextResponse.json(
        { success: false, error: 'Gecersiz yardim turu.' },
        { status: 400 }
      )
    }

    const [rows, predefinedSettings] = await Promise.all([
      getRows(type),
      predefinedValuesService.getAll(),
    ])

    return NextResponse.json({
      success: true,
      data: {
        type,
        records: rows.map((row) => mapReportRow(type, row, predefinedSettings.values, predefinedSettings.titles)),
      },
    })
  } catch (error) {
    return NextResponse.json(
      { success: false, error: (error as Error).message },
      { status: 500 }
    )
  }
}
