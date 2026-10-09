import { sqlMonitorService } from '@/lib/services/sqlMonitor.service'
import { buildMappedFilterCondition, prepareSqlSearchTerm } from '@/lib/utils'
import { YardimHareketleriClient } from './YardimHareketleriClient'

export const dynamic = 'force-dynamic'

type YardimTipGroup = {
  yardimtip: string
  total: number | string
}

type YardimHareketleriSummary = {
  total: number | string
  total_miktar: number | string | null
}

type FilterValueRow = { field: string; value: string; label: string; count: number }
type ColumnValueOption = { value: string; label: string; count: number }

type YardimHareketleriPageProps = {
  searchParams?: Promise<{
    tip?: string
    start?: string
    end?: string
    page?: string
  } & Record<string, string>>
}

const PAGE_SIZE = 100
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/

function normalizeDate(value?: string) {
  if (!value || !DATE_PATTERN.test(value)) return ''
  return value
}

function buildDateCondition(startDate: string, endDate: string) {
  const conditions: string[] = []

  if (startDate) conditions.push(`t.tarih::date >= '${startDate}'::date`)
  if (endDate) conditions.push(`t.tarih::date <= '${endDate}'::date`)

  return conditions
}

function sqlString(value: string) {
  return `'${value.replace(/'/g, "''")}'`
}

function mapFilterValueOptions(rows: FilterValueRow[]) {
  return rows.reduce((acc, row) => {
    if (!acc[row.field]) acc[row.field] = []

    acc[row.field].push({
      value: String(row.value),
      label: String(row.label),
      count: Number(row.count || 0),
    })

    return acc
  }, {} as Record<string, ColumnValueOption[]>)
}

const movementJoins = `
  FROM yardim_hareketleri t
  LEFT JOIN dosyalar d ON d.id = t.dosyaid
  LEFT JOIN LATERAL (
    SELECT COALESCE(NULLIF(BTRIM(b.adisoyadi), ''), BTRIM(CONCAT_WS(' ', b.adi, b.soyadi))) AS dosya_sahibi
    FROM bireyler b
    WHERE b.dosyaid = d.id
    ORDER BY CASE WHEN b.yakinligi = 0 OR b.tipi = 0 THEN 0 ELSE 1 END, b.id ASC
    LIMIT 1
  ) ds ON TRUE
  LEFT JOIN mobil_kullanicilar mk ON mk.id = t.firmaid
`

export default async function YardimHareketleriPage({ searchParams }: YardimHareketleriPageProps) {
  const params = await searchParams
  const startDate = normalizeDate(params?.start)
  const endDate = normalizeDate(params?.end)
  const requestedTip = params?.tip?.trim() || ''
  const currentPage = Math.max(1, Number(params?.page) || 1)
  const offset = (currentPage - 1) * PAGE_SIZE

  let groups: Array<{ yardimtip: string; count: number }> = []
  let data: Record<string, unknown>[] = []
  let exportData: Record<string, unknown>[] = []
  let filterValueOptions: Record<string, ColumnValueOption[]> = {}
  let selectedTip = ''
  let totalCount = 0
  let totalAmount = 0
  let errorMessage: string | null = null

  try {
    const dateConditions = buildDateCondition(startDate, endDate)
    const whereByDate = dateConditions.length > 0 ? `WHERE ${dateConditions.join(' AND ')}` : ''
    const groupResult = await sqlMonitorService.executeQuery(`
      SELECT
        COALESCE(NULLIF(BTRIM(t.yardimtip), ''), 'Belirtilmeyen') AS yardimtip,
        COUNT(*)::int AS total
      FROM yardim_hareketleri t
      ${whereByDate}
      GROUP BY COALESCE(NULLIF(BTRIM(t.yardimtip), ''), 'Belirtilmeyen')
      ORDER BY yardimtip ASC;
    `)

    groups = (groupResult.rows as YardimTipGroup[]).map((group) => ({
      yardimtip: group.yardimtip,
      count: Number(group.total) || 0,
    }))
    selectedTip = groups.some((group) => group.yardimtip === requestedTip)
      ? requestedTip
      : groups[0]?.yardimtip ?? ''

    const tipValue = prepareSqlSearchTerm(selectedTip)
    const listConditions = [...dateConditions]

    if (selectedTip) {
      listConditions.push(`COALESCE(NULLIF(BTRIM(t.yardimtip), ''), 'Belirtilmeyen') = '${tipValue}'`)
    }

    const columnFilters = buildMappedFilterCondition(params || {}, {
      id: 't.id',
      dosyano: 'd.dosyano',
      inceleme_puani: 'd.inceleme_puani',
      kartno: 't.kartno',
      dosyaid: 't.dosyaid',
      firmaad: 'mk.firmaad',
      dosya_sahibi: 'ds.dosya_sahibi',
      firmatip: 't.firmatip',
      yardimtip: "COALESCE(NULLIF(BTRIM(t.yardimtip), ''), 'Belirtilmeyen')",
      miktar: 't.miktar',
      tarih: 't.tarih',
    })
    if (columnFilters) listConditions.push(columnFilters.replace(/^ AND /, ''))

    const whereClause = listConditions.length > 0 ? `WHERE ${listConditions.join(' AND ')}` : ''
    const summaryResult = await sqlMonitorService.executeQuery(`
      SELECT
        COUNT(*)::int AS total,
        COALESCE(SUM(t.miktar), 0) AS total_miktar
      ${movementJoins}
      ${whereClause};
    `)
    const summary = summaryResult.rows[0] as YardimHareketleriSummary | undefined
    totalCount = Number(summary?.total) || 0
    totalAmount = Number(summary?.total_miktar) || 0

    const dataResult = await sqlMonitorService.executeQuery(`
      SELECT
        t.id,
        d.dosyano,
        d.inceleme_puani,
        ds.dosya_sahibi,
        t.kartno,
        t.dosyaid,
        mk.firmaad,
        t.firmatip,
        COALESCE(NULLIF(BTRIM(t.yardimtip), ''), 'Belirtilmeyen') AS yardimtip,
        t.miktar,
        t.tarih
      ${movementJoins}
      ${whereClause}
      ORDER BY t.tarih DESC NULLS LAST, t.id DESC
      LIMIT ${PAGE_SIZE} OFFSET ${offset};
    `)
    data = dataResult.rows

    const exportResult = await sqlMonitorService.executeQuery(`
      SELECT
        t.id,
        d.dosyano,
        d.inceleme_puani,
        ds.dosya_sahibi,
        t.kartno,
        t.dosyaid,
        mk.firmaad,
        t.firmatip,
        COALESCE(NULLIF(BTRIM(t.yardimtip), ''), 'Belirtilmeyen') AS yardimtip,
        t.miktar,
        t.tarih
      ${movementJoins}
      ${whereClause}
      ORDER BY t.tarih DESC NULLS LAST, t.id DESC;
    `)
    exportData = exportResult.rows

    const filterOptionExpressions: Record<string, string> = {}
    const filterOptionSelectParts = Object.entries(filterOptionExpressions).map(([field, expression]) => `
      SELECT ${sqlString(field)}::text AS field,
             NULLIF(${expression}::text, '') AS value,
             NULLIF(${expression}::text, '') AS label
      ${movementJoins}
      ${whereClause}
    `)
    if (filterOptionSelectParts.length > 0) {
      const filterOptionsResult = await sqlMonitorService.executeQuery(`
        SELECT field, value, label, COUNT(*)::int AS count
        FROM (
          ${filterOptionSelectParts.join('\nUNION ALL\n')}
        ) options
        WHERE value IS NOT NULL
          AND value <> ''
        GROUP BY field, value, label
        ORDER BY field, label;
      `)
      filterValueOptions = mapFilterValueOptions(filterOptionsResult.rows as FilterValueRow[])
    }
  } catch (error) {
    errorMessage = error instanceof Error ? error.message : 'Yardim hareketleri listelenirken hata olustu.'
  }

  return (
    <YardimHareketleriClient
      groups={groups}
      data={data}
      exportData={exportData}
      filterValueOptions={filterValueOptions}
      selectedTip={selectedTip}
      startDate={startDate}
      endDate={endDate}
      totalCount={totalCount}
      totalAmount={totalAmount}
      currentPage={errorMessage ? 1 : currentPage}
      pageSize={PAGE_SIZE}
      errorMessage={errorMessage}
    />
  )
}
