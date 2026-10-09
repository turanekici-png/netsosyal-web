import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db/prisma'
import { getFileStatusLabel } from '@/lib/services/fileStatusLabels.service'
import { predefinedValuesService } from '@/lib/services/predefinedValues.service'
import type { PredefinedValuesMap } from '@/lib/constants/predefinedValues'

export const dynamic = 'force-dynamic'

type SummaryKind = 'all-files' | 'assisted-files' | 'all-beneficiaries' | 'assisted-beneficiaries' | 'documents'

type SummaryRow = {
  id: bigint | number | string
  file_no: string | null
  name: string | null
  identity_no: string | null
  phone: string | null
  address: string | null
  status: bigint | number | string | null
  detail: string | null
  record_date: Date | string | null
}

const reportTitles: Record<SummaryKind, string> = {
  'all-files': 'Toplam Dosya Listesi',
  'assisted-files': 'Yardim Alan Dosyalar',
  'all-beneficiaries': 'Toplam Birey Listesi',
  'assisted-beneficiaries': 'Yardim Alan Bireyler',
  documents: 'Belge Kayitlari',
}

function toDateString(value: Date | string | null | undefined) {
  if (!value) return null
  return new Date(value).toISOString().slice(0, 10)
}

function mapSummaryRow(row: SummaryRow, kind: SummaryKind, predefinedValues: PredefinedValuesMap) {
  const isFileStatus = kind === 'all-files' || kind === 'assisted-files'

  return {
    id: String(row.id),
    fileNo: row.file_no ?? '-',
    name: row.name ?? '-',
    identityNumber: row.identity_no ?? '-',
    phone: row.phone ?? '-',
    address: row.address ?? '-',
    status: isFileStatus ? getFileStatusLabel(predefinedValues, row.status) : row.status === null ? '-' : String(row.status),
    detail: row.detail ?? '-',
    date: toDateString(row.record_date),
  }
}

async function getRows(kind: SummaryKind) {
  if (kind === 'all-files' || kind === 'assisted-files') {
    const onlyAssisted = kind === 'assisted-files'

    return prisma.$queryRaw<SummaryRow[]>`
      SELECT
        d.id::bigint AS id,
        d.dosyano AS file_no,
        owner.adisoyadi AS name,
        owner.tckimlikno AS identity_no,
        COALESCE(owner.ceptel, d.telefon) AS phone,
        d.adres AS address,
        d.durumu::int AS status,
        COALESCE(NULLIF(TRIM(d.durumuaciklama), ''), 'Dosya kaydi') AS detail,
        d.ilkislemtarihi::date AS record_date
      FROM dosyalar d
      LEFT JOIN LATERAL (
        SELECT b.adisoyadi, b.tckimlikno, b.ceptel
        FROM bireyler b
        WHERE b.dosyaid = d.id
        ORDER BY
          CASE WHEN COALESCE(b.yakinligi, -1) = 0 OR COALESCE(b.tipi, -1) = 0 THEN 0 ELSE 1 END,
          b.id ASC
        LIMIT 1
      ) owner ON true
      WHERE (${onlyAssisted}::boolean = false OR d.durumu = 3)
      ORDER BY d.id DESC;
    `
  }

  if (kind === 'all-beneficiaries' || kind === 'assisted-beneficiaries') {
    const onlyAssisted = kind === 'assisted-beneficiaries'

    return prisma.$queryRaw<SummaryRow[]>`
      SELECT
        b.id::bigint AS id,
        d.dosyano AS file_no,
        b.adisoyadi AS name,
        b.tckimlikno AS identity_no,
        b.ceptel AS phone,
        COALESCE(NULLIF(TRIM(b.adres), ''), d.adres) AS address,
        b.tipi::int AS status,
        CONCAT('Yakinlik: ', COALESCE(b.yakinligi::text, '-')) AS detail,
        b.ilkislemtarihi::date AS record_date
      FROM bireyler b
      LEFT JOIN dosyalar d ON d.id = b.dosyaid
      WHERE (${onlyAssisted}::boolean = false OR d.durumu = 3)
      ORDER BY b.id DESC;
    `
  }

  return prisma.$queryRaw<SummaryRow[]>`
    SELECT
      e.id::bigint AS id,
      COALESCE(e.dosyano, d.dosyano) AS file_no,
      e.adisoyadi AS name,
      e.tckimlikno AS identity_no,
      NULL::text AS phone,
      NULL::text AS address,
      e.durum AS status,
      e.evrak_adi AS detail,
      COALESCE(e.istenme_tarihi, e.created_at)::date AS record_date
    FROM beklenen_evraklar e
    LEFT JOIN dosyalar d ON d.id = e.dosyaid
    ORDER BY e.id DESC;
  `
}

export async function GET(request: NextRequest) {
  try {
    const kind = request.nextUrl.searchParams.get('kind') as SummaryKind | null

    if (!kind || !(kind in reportTitles)) {
      return NextResponse.json(
        { success: false, error: 'Gecersiz ozet rapor turu.' },
        { status: 400 }
      )
    }

    const [rows, predefinedSettings] = await Promise.all([
      getRows(kind),
      predefinedValuesService.getAll(),
    ])

    return NextResponse.json({
      success: true,
      data: {
        kind,
        title: reportTitles[kind],
        records: rows.map((row) => mapSummaryRow(row, kind, predefinedSettings.values)),
      },
    })
  } catch (error) {
    return NextResponse.json(
      { success: false, error: (error as Error).message },
      { status: 500 }
    )
  }
}
