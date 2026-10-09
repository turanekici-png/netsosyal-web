import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db/prisma'
import {
  buildDocumentsFromClause,
  buildDocumentsWhereClause,
  DOCUMENTS_CHAINABLE_COLUMNS,
} from '@/lib/documents/documentsListQuery'

export const dynamic = 'force-dynamic'

type OptionRow = { value: string | null; count: bigint | number | string | null }
type ColumnOption = { value: string; label: string; count: number }

// "Dosyalar" listesindeki sutun basligi filtrelerinin (Mahalle, Cadde,
// Sokak...) acilir "▼" menusundeki "Sütundaki Değerler" listesini besler.
// Onceden bu liste sadece EKRANDAKI SAYFANIN (50 kayit) verisinden
// uretiliyordu - ör. "Mahalle" listesinde sadece o an ekrandaki dosyalarin
// mahalleleri gorunuyordu, sistemdeki TUM mahalleler degil. Bu uc, ayni
// listeleme sorgusunun (documentsListQuery) WHERE mantigini kullanarak
// TUM eslesen kayitlar uzerinden hesaplar - boylece "Dosya Durumu = Yeni
// Müracaat" secildikten sonra Mahalle listesi de SADECE o durumdaki
// dosyalarin bulundugu mahalleleri gosterir (zincirlenmis/faceted filtre).
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const search = searchParams.get('search')?.trim() || ''
    const requestedColumns = (searchParams.get('columns') || '')
      .split(',')
      .map((value) => value.trim())
      .filter((value): value is keyof typeof DOCUMENTS_CHAINABLE_COLUMNS => Boolean(value) && value in DOCUMENTS_CHAINABLE_COLUMNS)

    if (requestedColumns.length === 0) {
      return NextResponse.json({ success: true, data: {} })
    }

    const data: Record<string, ColumnOption[]> = {}

    await Promise.all(requestedColumns.map(async (columnKey) => {
      const expression = DOCUMENTS_CHAINABLE_COLUMNS[columnKey]
      const whereClause = buildDocumentsWhereClause(searchParams, search, columnKey)
      const fromClause = buildDocumentsFromClause(whereClause.sql)

      const rows = await prisma.$queryRawUnsafe<OptionRow[]>(`
        SELECT NULLIF(BTRIM((${expression})::text), '') AS value, COUNT(*)::bigint AS count
        ${fromClause}
        GROUP BY NULLIF(BTRIM((${expression})::text), '')
        HAVING NULLIF(BTRIM((${expression})::text), '') IS NOT NULL
        ORDER BY count DESC, value ASC
        LIMIT 500
      `, ...whereClause.values)

      data[columnKey] = rows
        .filter((row) => row.value !== null)
        .map((row) => ({ value: row.value as string, label: row.value as string, count: Number(row.count) }))
    }))

    return NextResponse.json({ success: true, data })
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Filtre seçenekleri alınamadı.' },
      { status: 500 },
    )
  }
}
