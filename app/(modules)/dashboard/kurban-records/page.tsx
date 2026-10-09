import { ManagedReportTablePage } from '@/components/shared/ManagedReportTablePage'
import { ensureKurbanCountsTable } from '@/lib/services/kurbanCounts.service'
import { sqlMonitorService } from '@/lib/services/sqlMonitor.service'
import { buildFilterCondition, buildTextSearchClause } from '@/lib/utils'
import { buildMultiColumnOrderBy, parseSortParam } from '@/lib/sortSpec'

export const dynamic = 'force-dynamic'

type SearchParams = { page?: string; search?: string; title?: string; year?: string; period?: string } & Record<string, string>
type ColumnValueOption = { value: string; label: string; count: number }

function sqlString(value: string) {
  return `'${value.replace(/'/g, "''")}'`
}

function buildFacetedFilterCondition(params: SearchParams, excludedField: string) {
  const scopedParams = Object.fromEntries(
    Object.entries(params).filter(([key]) => ![
      `f_${excludedField}`,
      `f_${excludedField}_op`,
      `f_${excludedField}_v2`,
    ].includes(key)),
  )
  return buildFilterCondition(scopedParams, 'listed')
}

export default async function KurbanRecordsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>
}) {
  const params = await searchParams
  const currentPage = Math.max(1, Number(params.page) || 1)
  const pageSize = 50
  const offset = (currentPage - 1) * pageSize
  const searchTerm = params.search?.trim() || ''
  const year = params.year?.trim() || ''
  const period = params.period?.trim() || ''
  const requestedTitle = params.title?.trim() || 'Kurban Kayitlari'
  const sortableColumns = new Set(['id', 'tarih', 'yil', 'ay', 'kurban_turu', 'kurban_cinsi', 'adet'])
  const sortColumnMap = Object.fromEntries(Array.from(sortableColumns, (col) => [col, `listed.${col}`]))
  const requestedSortSpecs = parseSortParam((params.sort || '').trim())
  const orderByClause = buildMultiColumnOrderBy(
    requestedSortSpecs.length > 0 ? requestedSortSpecs : [{ key: 'tarih', direction: 'desc' }],
    sortColumnMap,
    'listed.id DESC',
  )

  const filterCondition = buildFilterCondition(params, 'listed')
  const yearCondition = year && year !== 'all' ? ` AND listed.yil = ${sqlString(year)}` : ''
  const periodCondition = period && period !== 'all' ? ` AND listed.ay = ${sqlString(period)}` : ''
  // Türkçe-duyarsız serbest metin araması (büyük/küçük harf + aksan yok sayılır)
  const searchCondition = buildTextSearchClause(
    ['listed.tarih_text', 'listed.kurban_turu', 'listed.kurban_cinsi', 'listed.adet', 'listed.yil', 'listed.ay'],
    searchTerm,
  )

  const baseCte = `
    WITH listed AS (
      SELECT
        k.id,
        to_char(k.tarih, 'YYYY-MM-DD') AS tarih,
        to_char(k.tarih, 'YYYY-MM-DD') AS tarih_text,
        COALESCE(to_char(k.tarih, 'YYYY'), 'Belirtilmedi') AS yil,
        COALESCE(to_char(k.tarih, 'YYYY-MM'), 'Belirtilmedi') AS ay,
        k.kurban_turu,
        k.kurban_cinsi,
        k.adet,
        k.ilkislemtarihi,
        k.islemtarihi
      FROM public.yrd_kurban k
    )
  `

  let records: Record<string, unknown>[] = []
  let totalCount = 0
  let errorMessage = ''
  let filterValueOptions: Record<string, ColumnValueOption[]> = {}

  try {
    await ensureKurbanCountsTable()

    const countResult = await sqlMonitorService.executeQuery(`
      ${baseCte}
      SELECT COUNT(*)::int AS total
      FROM listed
      WHERE 1 = 1 ${yearCondition} ${periodCondition} ${filterCondition} ${searchCondition};
    `)

    const dataResult = await sqlMonitorService.executeQuery(`
      ${baseCte}
      SELECT *
      FROM listed
      WHERE 1 = 1 ${yearCondition} ${periodCondition} ${filterCondition} ${searchCondition}
      ORDER BY ${orderByClause}
      LIMIT ${pageSize} OFFSET ${offset};
    `)

    totalCount = Number((countResult.rows[0] as { total?: unknown } | undefined)?.total || 0)
    records = dataResult.rows as Record<string, unknown>[]

    const optionFields = ['tarih', 'yil', 'ay', 'kurban_turu', 'kurban_cinsi', 'adet'] as const
    const optionResult = await sqlMonitorService.executeQuery(`
      ${baseCte}
      SELECT field, value, COUNT(*)::int AS count
      FROM (
        ${optionFields.map((field) => `
          SELECT ${sqlString(field)} AS field, NULLIF(listed.${field}::text, '') AS value
          FROM listed
          WHERE 1 = 1 ${yearCondition} ${periodCondition} ${buildFacetedFilterCondition(params, field)} ${searchCondition}
        `).join('\nUNION ALL\n')}
      ) options
      WHERE value IS NOT NULL AND value <> ''
      GROUP BY field, value
      ORDER BY field, value;
    `)
    filterValueOptions = (optionResult.rows as Array<{ field: string; value: string; count: number }>).reduce((result, row) => {
      if (!result[row.field]) result[row.field] = []
      result[row.field].push({ value: String(row.value), label: String(row.value), count: Number(row.count || 0) })
      return result
    }, {} as Record<string, ColumnValueOption[]>)
  } catch (error) {
    errorMessage = error instanceof Error ? error.message : 'Kurban kayitlari alinamadi.'
  }

  return (
    <div className="space-y-5">
      {errorMessage && (
        <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm font-bold text-rose-600">
          Veritabani Hatasi: {errorMessage}
        </div>
      )}

      <ManagedReportTablePage
        eyebrow="Ana Sayfa Raporu"
        title={requestedTitle}
        routePath="/dashboard/kurban-records"
        data={errorMessage ? [] : records}
        tableId="dashboard_kurban_records"
        totalCount={errorMessage ? 0 : totalCount}
        currentPage={currentPage}
        pageSize={pageSize}
        searchTerm={searchTerm}
        searchPlaceholder="Tarih, yil, ay, kurban turu, cinsi veya adet ara"
        emptyMessage="Bu kritere uygun kurban kaydi bulunamadi."
        excludedColumns={['tarih_text', 'ilkislemtarihi', 'islemtarihi']}
        requiredVisibleColumns={['tarih', 'kurban_turu', 'kurban_cinsi', 'adet']}
        preferredColumnOrder={['tarih', 'yil', 'ay', 'kurban_turu', 'kurban_cinsi', 'adet']}
        columnLabels={{
          tarih: 'Tarih',
          yil: 'Yil',
          ay: 'Ay',
          kurban_turu: 'Kurban Turu',
          kurban_cinsi: 'Kurban Cinsi',
          adet: 'Adet',
        }}
        filterValueOptions={filterValueOptions}
        exportFilePrefix="dashboard_kurban_records"
        tableKey={requestedTitle}
        recordUpdateConfig={{
          endpoint: '/api/dashboard/kurban-records',
          label: 'Kurban kaydi guncelle',
          fields: ['tarih', 'kurban_turu', 'kurban_cinsi', 'adet'],
        }}
        deleteConfig={{
          endpoint: '/api/dashboard/kurban-records',
          label: 'Secili Kurban Kaydini Sil',
          allowFilteredDelete: true,
          filteredLabel: 'Filtrelenen Kurban Kayitlarini Sil',
        }}
      />
    </div>
  )
}
