import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db/prisma'
import {
  BENEFICIARY_CHAINABLE_COLUMNS,
  BENEFICIARY_FROM_CLAUSE,
  buildBeneficiaryWhereClause,
} from '@/lib/beneficiary/beneficiaryListQuery'

export const dynamic = 'force-dynamic'

type OptionRow = { value: string | null; count: bigint | number | string | null }
type ColumnOption = { value: string; label: string; count: number }

// "Bireyler" listesindeki sutun basligi filtrelerinin (Mahalle, İlçe) acilir
// menusunu besler - bkz. app/api/documents/filter-options/route.ts'deki ayni
// desenin aciklamasi.
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const search = searchParams.get('search')?.trim() || ''
    const requestedColumns = (searchParams.get('columns') || '')
      .split(',')
      .map((value) => value.trim())
      .filter((value): value is keyof typeof BENEFICIARY_CHAINABLE_COLUMNS => Boolean(value) && value in BENEFICIARY_CHAINABLE_COLUMNS)

    if (requestedColumns.length === 0) {
      return NextResponse.json({ success: true, data: {} })
    }

    const data: Record<string, ColumnOption[]> = {}

    await Promise.all(requestedColumns.map(async (columnKey) => {
      const expression = BENEFICIARY_CHAINABLE_COLUMNS[columnKey]
      const whereClause = buildBeneficiaryWhereClause(searchParams, search, columnKey)

      const rows = await prisma.$queryRawUnsafe<OptionRow[]>(`
        SELECT NULLIF(BTRIM((${expression})::text), '') AS value, COUNT(*)::bigint AS count
        ${BENEFICIARY_FROM_CLAUSE}
        ${whereClause.sql}
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
