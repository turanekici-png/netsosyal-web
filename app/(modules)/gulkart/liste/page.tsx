import { GulkartListeClient } from './GulkartListeClient'
import { sqlMonitorService } from '@/lib/services/sqlMonitor.service'
import { buildGulkartListWhereClause, quoteIdentifier } from '@/lib/gulkart/listeFilters'

export const dynamic = 'force-dynamic'

const TABLE_NAME = 'nakitkart'

export default async function GulkartListePage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; search?: string } & Record<string, string>>
}) {
  const params = await searchParams
  const currentPage = Math.max(1, Number(params.page) || 1)
  const pageSize = 50
  const offset = (currentPage - 1) * pageSize
  const searchTerm = params.search?.trim() || ''

  let kayitlar: Record<string, unknown>[] = []
  let columns: string[] = []
  let totalCount = 0
  let errorMessage: string | null = null

  try {
    const tableColumns = await sqlMonitorService.getTableColumns(TABLE_NAME)
    columns = tableColumns.map((column) => column.columnName)

    const whereClause = buildGulkartListWhereClause(params, columns, searchTerm)
    const orderColumn = columns.includes('id') ? 't."id" DESC' : 't.ctid DESC'

    // Kullanici istegi: kayitlarin dosya numaralarini gorebilelim ve ilgili
    // kayda cift tikladigimizda dosyasini acabilelim - "dosyaid" (nakitkart'in
    // kendi kolonu) sadece HAM veritabani ID'si, kullaniciya anlamli olan
    // "dosyalar.dosyano" (formatFileNo ile gosterilen) LEFT JOIN ile eklenir.
    // Karta HENUZ bir dosya baglanmamissa (cogu kayitta - bkz. arastirma:
    // ~7674/7862 kayitta dosyaid NULL) dosyaNo da NULL/bos kalir, bu normal.
    const countQuery = `
      SELECT COUNT(*)::int AS total
      FROM public.${quoteIdentifier(TABLE_NAME)} t
      LEFT JOIN public.dosyalar d ON d.id = t.dosyaid
      WHERE 1=1 ${whereClause}
    `
    const dataQuery = `
      SELECT t.ctid::text AS "__rowid", t.*, d.dosyano AS "dosyaNo"
      FROM public.${quoteIdentifier(TABLE_NAME)} t
      LEFT JOIN public.dosyalar d ON d.id = t.dosyaid
      WHERE 1=1 ${whereClause}
      ORDER BY ${orderColumn}
      LIMIT ${pageSize} OFFSET ${offset}
    `

    const countResult = await sqlMonitorService.executeQuery(countQuery)
    totalCount = Number((countResult.rows[0] as { total?: unknown } | undefined)?.total || 0)

    const result = await sqlMonitorService.executeQuery(dataQuery)
    kayitlar = result.rows as Record<string, unknown>[]
  } catch (error: unknown) {
    errorMessage = error instanceof Error ? error.message : String(error)
  }

  return (
    <GulkartListeClient
      data={errorMessage ? [] : kayitlar}
      columns={columns}
      totalCount={totalCount}
      currentPage={currentPage}
      pageSize={pageSize}
      searchTerm={searchTerm}
      errorMessage={errorMessage}
    />
  )
}
