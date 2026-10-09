import { GulkartRezervClient } from './GulkartRezervClient'
import { sqlMonitorService } from '@/lib/services/sqlMonitor.service'
import { buildGulkartRezervWhereClause, quoteIdentifier } from '@/lib/gulkart/rezervFilters'

export const dynamic = 'force-dynamic'

const TABLE_NAME = 'nakitkartrezerv'

export default async function GulkartRezervPage({
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

    const whereClause = buildGulkartRezervWhereClause(params, columns, searchTerm)
    const orderColumn = columns.includes('id') ? 't."id" DESC' : 't.ctid DESC'

    const countQuery = `
      SELECT COUNT(*)::int AS total
      FROM public.${quoteIdentifier(TABLE_NAME)} t
      WHERE 1=1 ${whereClause}
    `
    const dataQuery = `
      SELECT t.ctid::text AS "__rowid", t.*
      FROM public.${quoteIdentifier(TABLE_NAME)} t
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
    <GulkartRezervClient
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
