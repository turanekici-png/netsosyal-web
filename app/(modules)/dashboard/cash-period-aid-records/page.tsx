import { ManagedReportTablePage } from '@/components/shared/ManagedReportTablePage'
import { getDgnAssistanceStatusMap } from '@/lib/services/assistanceStatusLabels.service'
import { sqlMonitorService } from '@/lib/services/sqlMonitor.service'
import { buildFilterCondition, buildTextSearchClause } from '@/lib/utils'
import { buildMultiColumnOrderBy, parseSortParam } from '@/lib/sortSpec'

export const dynamic = 'force-dynamic'

type SearchParams = { page?: string; search?: string; title?: string } & Record<string, string>
type FilterValueRow = { field: string; value: string; label: string; count: number }
type ColumnValueOption = { value: string; label: string; count: number }

const FILTER_OPTION_FIELDS = [
  'dosyano',
  'yil',
  'donem',
  'etiket',
  'asama',
  'durumu',
  'miktar',
  'muracaateden',
  'tckimlikno',
  'iban',
]

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

function mapFilterValueOptions(rows: FilterValueRow[], statusMap: Record<string, string>) {
  return rows.reduce((acc, row) => {
    if (!acc[row.field]) acc[row.field] = []

    acc[row.field].push({
      value: String(row.value),
      label: row.field === 'durumu' ? statusMap[String(row.value)] || String(row.label) : String(row.label),
      count: Number(row.count || 0),
    })

    return acc
  }, {} as Record<string, ColumnValueOption[]>)
}

export default async function CashPeriodAidRecordsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>
}) {
  const params = await searchParams
  const currentPage = Math.max(1, Number(params.page) || 1)
  const pageSize = 50
  const offset = (currentPage - 1) * pageSize
  const searchTerm = params.search?.trim() || ''
  const requestedTitle = params.title?.trim() || 'Nakit Yardimi Donem Listesi'
  const sortableColumns = new Set(['id', 'dosyano', 'yil', 'donem', 'asama', 'etiket', 'miktar', 'muracaateden', 'tckimlikno', 'iban', 'durumu'])
  const sortColumnMap = Object.fromEntries(Array.from(sortableColumns, (col) => [col, `listed.${col}`]))
  const orderByClause = buildMultiColumnOrderBy(parseSortParam((params.sort || '').trim()), sortColumnMap, 'listed.id DESC')

  const filterCondition = buildFilterCondition(params, 'listed')
  // Türkçe-duyarsız serbest metin araması (büyük/küçük harf + aksan yok sayılır)
  const searchCondition = buildTextSearchClause(
    ['listed.dosyano', 'listed.muracaateden', 'listed.tckimlikno', 'listed.iban', 'listed.donem', 'listed.asama', 'listed.etiket', 'listed.yil'],
    searchTerm,
  )

  const baseCte = `
    WITH listed AS (
      SELECT
        d.dosyano,
        CASE
          WHEN TRIM(t.donem::text) ~ '[0-9]{4}' THEN SUBSTRING(TRIM(t.donem::text) FROM '[0-9]{4}')
          ELSE 'Belirtilmedi'
        END AS yil,
        t.*
      FROM yrd_ayninakti t
      LEFT JOIN dosyalar d ON d.id = t.dosyaid
      WHERE t.durumu = 6
    )
  `

  let records: Record<string, unknown>[] = []
  let totalCount = 0
  let errorMessage = ''
  let statusMap: Record<string, string> = {}
  let filterValueOptions: Record<string, ColumnValueOption[]> = {}

  try {
    statusMap = await getDgnAssistanceStatusMap()

    const countResult = await sqlMonitorService.executeQuery(`
      ${baseCte}
      SELECT COUNT(*)::int AS total
      FROM listed
      WHERE 1 = 1 ${filterCondition} ${searchCondition};
    `)

    const dataResult = await sqlMonitorService.executeQuery(`
      ${baseCte}
      SELECT *
      FROM listed
      WHERE 1 = 1 ${filterCondition} ${searchCondition}
      ORDER BY ${orderByClause}
      LIMIT ${pageSize} OFFSET ${offset};
    `)

    totalCount = Number((countResult.rows[0] as { total?: unknown } | undefined)?.total || 0)
    records = dataResult.rows as Record<string, unknown>[]

    const filterSelectParts = FILTER_OPTION_FIELDS.map((field) => `
      SELECT ${sqlString(field)}::text AS field,
             NULLIF(listed.${field}::text, '') AS value,
             NULLIF(listed.${field}::text, '') AS label
      FROM listed
      WHERE 1 = 1 ${buildFacetedFilterCondition(params, field)} ${searchCondition}
    `)
    const filterOptionsResult = await sqlMonitorService.executeQuery(`
      ${baseCte}
      SELECT field, value, label, COUNT(*)::int AS count
      FROM (
        ${filterSelectParts.join('\nUNION ALL\n')}
      ) options
      WHERE value IS NOT NULL
        AND value <> ''
      GROUP BY field, value, label
      ORDER BY field, label;
    `)
    filterValueOptions = mapFilterValueOptions(filterOptionsResult.rows as FilterValueRow[], statusMap)
  } catch (error) {
    errorMessage = error instanceof Error ? error.message : 'Nakit yardimi listesi alinamadi.'
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
        routePath="/dashboard/cash-period-aid-records"
        data={errorMessage ? [] : records}
        tableId="dashboard_cash_period_aid_records"
        totalCount={errorMessage ? 0 : totalCount}
        currentPage={currentPage}
        pageSize={pageSize}
        searchTerm={searchTerm}
        searchPlaceholder="Dosya no, kisi, TC, IBAN, donem, yil, etiket veya asama ara"
        emptyMessage="Bu kritere uygun nakit yardimi kaydi bulunamadi."
        statusMap={statusMap}
        assistanceStatusVariant="dgn"
        excludedColumns={[
          'dosyaid',
          'kullaniciid',
          'ilkkullaniciid',
          'islemtarihi',
          'ilkislemtarihi',
          'durumuaciklama',
          'asamanotu',
          'muracaatnotu',
          'asamaozelkod',
        ]}
        requiredVisibleColumns={['yil', 'donem', 'asama', 'miktar']}
        preferredColumnOrder={[
          'dosyano',
          'yil',
          'donem',
          'asama',
          'etiket',
          'miktar',
          'muracaateden',
          'tckimlikno',
          'iban',
          'durumu',
        ]}
        columnLabels={{
          dosyano: 'Dosya No',
          yil: 'Yil',
          donem: 'Donem',
          asama: 'Asama',
          etiket: 'Etiket',
          miktar: 'Miktar',
          muracaateden: 'Kisi',
          tckimlikno: 'TC',
          iban: 'IBAN',
          durumu: 'Durum',
        }}
        filterValueOptions={filterValueOptions}
        exportFilePrefix="dashboard_nakit_donem"
        tableKey={requestedTitle}
        recordUpdateConfig={{
          endpoint: '/api/assistance/nakit/bulk-update',
          label: 'Donem, etiket, miktar ve asama guncelle',
          sourceStatus: 6,
          fields: ['donem', 'etiket', 'miktar', 'asama'],
        }}
      />
    </div>
  )
}
