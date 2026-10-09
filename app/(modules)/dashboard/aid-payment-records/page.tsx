import { ManagedReportTablePage } from '@/components/shared/ManagedReportTablePage'
import { getAssistanceStatusMap, getDgnAssistanceStatusMap } from '@/lib/services/assistanceStatusLabels.service'
import { sqlMonitorService } from '@/lib/services/sqlMonitor.service'
import { buildFilterCondition, buildTextSearchClause } from '@/lib/utils'
import { buildMultiColumnOrderBy, parseSortParam } from '@/lib/sortSpec'

export const dynamic = 'force-dynamic'

type SearchParams = { page?: string; search?: string; type?: string; year?: string; title?: string } & Record<string, string>
type FilterValueRow = { field: string; value: string; label: string; count: number }
type ColumnValueOption = { value: string; label: string; count: number }

const PAID_OPERATION_CONDITION = `
  lower(trim(COALESCE(h.islemadi, ''))) IN (
    'ode', 'öde', 'Ã¶de',
    'odeme yapildi', 'ödeme yapıldı', 'Ã¶deme yapÄ±ldÄ±'
  )
`

const REPORT_SOURCES = {
  Gida: {
    label: 'Gida Yardimi',
    tableId: 'dashboard_gida_payment_records',
    statusVariant: 'default' as const,
    updateFields: ['donem', 'miktar'] as const,
    filterFields: ['dosyano', 'yil', 'donem', 'donemint', 'miktar', 'alisverismiktari', 'muracaateden', 'muracaattarihi', 'islemtarihi', 'islemadi', 'aciklama'] as const,
    baseCte: `
      WITH listed AS (
        SELECT
          h.id,
          d.dosyano,
          h.dosyaid,
          h.yardimid,
          t.muracaateden,
          t.muracaattarihi,
          h.islemtarihi,
          h.islemadi,
          h.aciklama,
          h.donemadi AS donem,
          h.donemint,
          h.miktar,
          h.alisverismiktari,
          COALESCE(
            CASE
              WHEN TRIM(COALESCE(h.donemadi, '')) ~ '^[0-9]{2}-[0-9]{4}$'
                THEN SUBSTRING(TRIM(h.donemadi) FROM '[0-9]{4}$')
              ELSE NULL
            END,
            to_char(h.islemtarihi, 'YYYY'),
            'Belirtilmedi'
          ) AS yil
        FROM yrd_gidabankasihrk h
        LEFT JOIN yrd_gidabankasi t ON t.id = h.yardimid
        LEFT JOIN dosyalar d ON d.id = h.dosyaid
        WHERE ${PAID_OPERATION_CONDITION}
      )
    `,
  },
  'Destek Paketi': {
    label: 'Destek Paketi Yardimi',
    tableId: 'dashboard_destek_paketi_payment_records',
    statusVariant: 'default' as const,
    updateFields: ['donem', 'miktar'] as const,
    filterFields: ['dosyano', 'yil', 'donem', 'donemint', 'miktar', 'alisverismiktari', 'muracaateden', 'muracaattarihi', 'islemtarihi', 'islemadi', 'aciklama'] as const,
    baseCte: `
      WITH listed AS (
        SELECT
          h.id,
          d.dosyano,
          h.dosyaid,
          h.yardimid,
          t.muracaateden,
          t.muracaattarihi,
          h.islemtarihi,
          h.islemadi,
          h.aciklama,
          h.donemadi AS donem,
          h.donemint,
          h.miktar,
          h.alisverismiktari,
          COALESCE(to_char(h.islemtarihi, 'YYYY'), 'Belirtilmedi') AS yil
        FROM yrd_destekpaketihrk h
        LEFT JOIN yrd_destekpaketi t ON t.id = h.yardimid
        LEFT JOIN dosyalar d ON d.id = h.dosyaid
        WHERE ${PAID_OPERATION_CONDITION}
      )
    `,
  },
  'Donem Disi Gida': {
    label: 'Donem Disi Gida Yardimi',
    tableId: 'dashboard_donem_disi_gida_payment_records',
    statusVariant: 'dgn' as const,
    updateFields: ['miktar'] as const,
    filterFields: ['dosyano', 'yil', 'donem', 'miktar', 'alisverismiktari', 'muracaateden', 'aciklama', 'durumu', 'durumutarih'] as const,
    baseCte: `
      WITH listed AS (
        SELECT
          d.dosyano,
          t.*,
          NULL::text AS donem,
          COALESCE(to_char(t.durumutarih, 'YYYY'), 'Belirtilmedi') AS yil
        FROM yrd_ddgidadosyali t
        LEFT JOIN dosyalar d ON d.id = t.dosyaid
        WHERE t.durumu = 6
      )
    `,
  },
  Giyim: {
    label: 'Giyim Yardimi',
    tableId: 'dashboard_giyim_payment_records',
    statusVariant: 'dgn' as const,
    updateFields: ['donem', 'etiket', 'miktar'] as const,
    filterFields: ['dosyano', 'yil', 'donem', 'etiket', 'miktar', 'alisverismiktari', 'muracaateden', 'aciklama', 'durumu', 'durumutarih'] as const,
    baseCte: `
      WITH listed AS (
        SELECT
          d.dosyano,
          t.*,
          COALESCE(to_char(t.durumutarih, 'YYYY'), 'Belirtilmedi') AS yil
        FROM yrd_giyim t
        LEFT JOIN dosyalar d ON d.id = t.dosyaid
        WHERE t.durumu = 6
      )
    `,
  },
}

function normalizeSourceType(value: string | undefined) {
  return Object.keys(REPORT_SOURCES).find((key) => key === value) as keyof typeof REPORT_SOURCES | undefined
}

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

export default async function AidPaymentRecordsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>
}) {
  const params = await searchParams
  const sourceType = normalizeSourceType(params.type)
  const source = sourceType ? REPORT_SOURCES[sourceType] : null
  const currentPage = Math.max(1, Number(params.page) || 1)
  const pageSize = 50
  const offset = (currentPage - 1) * pageSize
  const year = params.year?.trim() || ''
  const searchTerm = params.search?.trim() || ''
  const requestedTitle = params.title?.trim() || (source ? `${year} ${source.label}` : 'Yardim Raporu')
  const filterCondition = buildFilterCondition(params, 'listed')
  const sortableColumns = new Set(['id', 'dosyano', 'yil', 'donem', 'miktar', 'muracaateden', 'aciklama', ...(source?.filterFields ?? [])])
  const sortColumnMap = Object.fromEntries(Array.from(sortableColumns, (col) => [col, `listed.${col}`]))
  const orderByClause = buildMultiColumnOrderBy(parseSortParam((params.sort || '').trim()), sortColumnMap, 'listed.id DESC')

  let records: Record<string, unknown>[] = []
  let totalCount = 0
  let errorMessage = ''
  let statusMap: Record<string, string> = {}
  let filterValueOptions: Record<string, ColumnValueOption[]> = {}

  try {
    if (!source || !year) {
      throw new Error('Rapor turu veya yil bilgisi eksik.')
    }

    statusMap = source.statusVariant === 'dgn'
      ? await getDgnAssistanceStatusMap()
      : await getAssistanceStatusMap()

    const yearCondition = year === 'Belirtilmedi'
      ? " AND listed.yil = 'Belirtilmedi'"
      : ` AND listed.yil = ${sqlString(year)}`
    // Türkçe-duyarsız serbest metin araması (büyük/küçük harf + aksan yok sayılır)
    const searchCondition = buildTextSearchClause(
      ['listed.dosyano', 'listed.muracaateden', 'listed.aciklama', 'listed.donem', 'listed.miktar'],
      searchTerm,
    )

    const countResult = await sqlMonitorService.executeQuery(`
      ${source.baseCte}
      SELECT COUNT(*)::int AS total
      FROM listed
      WHERE 1 = 1 ${yearCondition} ${filterCondition} ${searchCondition};
    `)

    const dataResult = await sqlMonitorService.executeQuery(`
      ${source.baseCte}
      SELECT *
      FROM listed
      WHERE 1 = 1 ${yearCondition} ${filterCondition} ${searchCondition}
      ORDER BY ${orderByClause}
      LIMIT ${pageSize} OFFSET ${offset};
    `)

    totalCount = Number((countResult.rows[0] as { total?: unknown } | undefined)?.total || 0)
    records = dataResult.rows as Record<string, unknown>[]

    const optionParts = source.filterFields.map((field) => `
      SELECT ${sqlString(field)}::text AS field,
             NULLIF(listed.${field}::text, '') AS value,
             NULLIF(listed.${field}::text, '') AS label
      FROM listed
      WHERE 1 = 1 ${yearCondition} ${buildFacetedFilterCondition(params, field)} ${searchCondition}
    `)
    const optionResult = await sqlMonitorService.executeQuery(`
      ${source.baseCte}
      SELECT field, value, label, COUNT(*)::int AS count
      FROM (${optionParts.join('\nUNION ALL\n')}) options
      WHERE value IS NOT NULL AND value <> ''
      GROUP BY field, value, label
      ORDER BY field, label;
    `)
    filterValueOptions = (optionResult.rows as FilterValueRow[]).reduce((result, row) => {
      if (!result[row.field]) result[row.field] = []
      result[row.field].push({
        value: String(row.value),
        label: row.field === 'durumu' ? statusMap[String(row.value)] || String(row.label) : String(row.label),
        count: Number(row.count || 0),
      })
      return result
    }, {} as Record<string, ColumnValueOption[]>)
  } catch (error) {
    errorMessage = error instanceof Error ? error.message : 'Yardim odeme raporu alinamadi.'
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
        routePath="/dashboard/aid-payment-records"
        data={errorMessage ? [] : records}
        tableId={source?.tableId || 'dashboard_aid_payment_records'}
        totalCount={errorMessage ? 0 : totalCount}
        currentPage={currentPage}
        pageSize={pageSize}
        searchTerm={searchTerm}
        searchPlaceholder="Dosya no, kisi, aciklama, donem veya miktar ara"
        emptyMessage="Bu kritere uygun yardim kaydi bulunamadi."
        statusMap={statusMap}
        assistanceStatusVariant={source?.statusVariant || 'default'}
        excludedColumns={[
          'dosyaid',
          'kullaniciid',
          'ilkkullaniciid',
          'ilkislemtarihi',
          'durumuaciklama',
          'yardimid',
          'yrd_gbdnmid',
        ]}
        requiredVisibleColumns={['yil', 'donem', 'miktar', 'alisverismiktari']}
        preferredColumnOrder={[
          'dosyano',
          'yil',
          'donem',
          'miktar',
          'alisverismiktari',
          'muracaateden',
          'islemadi',
          'aciklama',
          'durumu',
          'durumutarih',
        ]}
        columnLabels={{
          dosyano: 'Dosya No',
          yil: 'Yil',
          donem: 'Donem',
          miktar: 'Miktar',
          // Kullanici istegi: acilan yardim odeme raporlarinda (Gida, Destek
          // Paketi, Donem Disi Gida, Giyim) kisinin GERCEKTEN ne kadarlik
          // alisveris yaptigi (fatura tutari) da gorunsun.
          alisverismiktari: 'Alışveriş Miktarı',
          muracaateden: 'Kisi',
          islemadi: 'Islem',
          aciklama: 'Aciklama',
          durumu: 'Durum',
          durumutarih: 'Durum Tarihi',
        }}
        filterValueOptions={filterValueOptions}
        exportFilePrefix={source?.tableId || 'dashboard_aid_payment_records'}
        tableKey={requestedTitle}
        recordUpdateConfig={source ? {
          endpoint: `/api/dashboard/aid-payment-records/bulk-update?type=${encodeURIComponent(sourceType || '')}&year=${encodeURIComponent(year)}`,
          label: `${source.label} bilgilerini guncelle`,
          fields: [...source.updateFields],
        } : undefined}
      />
    </div>
  )
}
