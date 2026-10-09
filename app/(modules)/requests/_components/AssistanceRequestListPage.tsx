import { ManagedReportTablePage } from '@/components/shared/ManagedReportTablePage'
import {
  getAssistanceStatusMap,
  getDgnAssistanceStatusMap,
} from '@/lib/services/assistanceStatusLabels.service'
import { getCashLabelFilterOptions } from '@/lib/services/cashPredefinedLabels.service'
import { sqlMonitorService } from '@/lib/services/sqlMonitor.service'
import { buildFilterCondition, buildTextSearchClause } from '@/lib/utils'
import { buildMultiColumnOrderBy, parseSortParam } from '@/lib/sortSpec'
import { AssistanceModeTabs } from '../../assistance/_components/AssistanceModeTabs'
import { ASSISTANCE_MODE_TABS_CONFIG, getAssistanceModeTabsBasePath } from '../../assistance/_components/assistanceModeTabsConfig'
import { NakitApplicationsSyncButton } from '../../assistance/nakit/_components/NakitApplicationsSyncButton'
import { NakitAutoRejectButton } from '../../assistance/nakit/_components/NakitAutoRejectButton'
import { NakitPhoneSyncButton } from '../../assistance/nakit/_components/NakitPhoneSyncButton'

type SearchParams = { page?: string; search?: string } & Record<string, string>
type ColumnInfo = { column_name: string }
type FilterValueRow = { field: string; value: string; label: string; count: number }
type ColumnValueOption = { value: string; label: string; count: number }

// Her sutunun acilir filtre menusu, o an ekrandaki sayfadaki kayitlardan
// degil, TUM filtrelenmis veri kumesinden (SQL ile) hesaplanir - aksi halde
// ör. "Tahkikatpers" acilir menusunde sadece o sayfada goruntulenen 50
// kayittaki personel isimleri gorunur, listede olup da baska bir sayfada
// olan personel secilemezdi.
//
// Kullanici istegi (Ekim 2026): "örneğin aşama bilgilerinde ... bilgi
// gösterilen sayfada olmadığı için filtre listesinde de çıkmıyor, bu yüzden
// listenin genelindeki bilgilerin grubu filtre listesinde görünsün - tüm
// alanlar için bunu uygula" - ONCEDEN bu SADECE belirli (dusuk-kardinaliteli
// sanilan) bir alan listesiyle SINIRLIYDI (FULL_FILTER_OPTION_FIELDS); artik
// "id" DISINDAKI TUM sutunlar icin calisir. Gercekten YUKSEK-kardinaliteli
// serbest metin alanlarinin (muracaatnotu, iban, dosyaid vb.) acilir menuyu
// anlamsiz/devasa hale getirmemesi icin asagidaki sorguda ALAN BASINA "LIMIT
// FULL_FILTER_OPTION_MAX_VALUES" (en sik gorulen N deger) sinirlamasi
// eklendi - boylece HICBIR alan ozel olarak haric tutulmak zorunda kalmadan
// guvenli bir ust sinirla calisir.
const FULL_FILTER_OPTION_MAX_VALUES = 300
type NakitPeriodSummaryRow = {
  donem: string
  total: number
  incelenecek: number
  uygun: number
  uygunOlmayan: number
}

type AssistanceRequestListConfig = {
  title: string
  newButtonLabel: string
  sectionTitle: string
  emptyMessage: string
  searchPlaceholder: string
  routePath: string
  tableName: string
  tableId: string
  searchColumns: string[]
  excludedColumns: string[]
  personnelAssignConfig?: {
    endpoint: string
    label?: string
  }
  copyConfig?: {
    endpoint: string
    label?: string
    sourceStatus: number
  }
  investigationReportConfig?: {
    endpoint: string
    label?: string
  }
  recordUpdateConfig?: {
    endpoint: string
    label?: string
    sourceStatus?: number
  }
  createFileConfig?: {
    endpoint: string
    label?: string
  }
  importConfig?: {
    endpoint: string
    columns: string[]
    title: string
    description: string
    templateFileName: string
  }
  phoneFieldPriority?: string[]
}

type AssistanceRequestListPageProps = {
  searchParams: Promise<SearchParams>
  config: AssistanceRequestListConfig
}

const dgnAssistanceTables = new Set(['yrd_ddgidadosyali', 'yrd_giyim', 'yrd_ayninakti'])

function isSafeIdentifier(value: string) {
  return /^[a-zA-Z0-9_]+$/.test(value)
}

function quoteIdentifier(value: string) {
  return `"${value.replace(/"/g, '""')}"`
}

function sqlString(value: string) {
  return `'${value.replace(/'/g, "''")}'`
}

async function getTableColumns(tableName: string) {
  if (!isSafeIdentifier(tableName)) return []

  const result = await sqlMonitorService.executeQuery(`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = ${sqlString(tableName)}
    ORDER BY ordinal_position
  `)

  return result.rows as ColumnInfo[]
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

function applyPredefinedCashLabelOptions(
  currentOptions: Record<string, ColumnValueOption[]>,
  predefinedOptions: ColumnValueOption[],
) {
  if (predefinedOptions.length === 0) return currentOptions

  const existingCounts = new Map(
    (currentOptions.etiket ?? []).map((option) => [option.label || option.value, option.count])
  )

  return {
    ...currentOptions,
    etiket: predefinedOptions.map((option) => ({
      ...option,
      count: existingCounts.get(option.label) ?? existingCounts.get(option.value) ?? 0,
    })),
  }
}

function buildFilterOptionsQuery(
  tableName: string,
  columns: ColumnInfo[],
  excludedColumns: string[],
  searchCondition: string,
  params: SearchParams,
  needsMessageLogJoin: boolean,
  needsGulkartJoin: boolean,
) {
  if (!isSafeIdentifier(tableName)) return ''

  const excluded = new Set(excludedColumns)
  const optionFields = Array.from(new Set(columns.map((column) => column.column_name))).filter((field) => {
    if (excluded.has(field) || field === 'id') return false
    return isSafeIdentifier(field)
  })

  if (optionFields.length === 0) return ''

  // NOT: her sutunun kendi acilir menusu, DIGER sutunlarin filtresine gore
  // daralmali ama KENDI filtresine gore DARALMAMALI - aksi halde bir deger
  // secildikten sonra o sutunun menusunde SADECE secili deger kalir. Bu
  // yuzden her alan icin "excludeField" ile O ALANIN KENDI filtresi haric
  // tutulan, AYRI bir filtre kosulu hesaplaniyor. Bu kosul (DIGER alanlardan)
  // "Son Mesaj *" ile ilgili bir filtre iceriyorsa "sm" LATERAL JOIN'i de
  // gerekir - bkz. countQuery'deki AYNI duzeltme notu ("missing FROM-clause
  // entry for table sm" hatasi).
  const selectParts = optionFields.map((field) => {
    const expression = field === 'dosyano' ? 'd.dosyano' : `t.${quoteIdentifier(field)}`
    const fieldFilterCondition = buildFilterCondition(params, 't', field)

    // PERFORMANS DUZELTMESI (hata raporu: "nakit yardımları listesini
    // açarken yavaş açılıyor" - kok neden: nakitkart.tckimlikno indexsizdi,
    // EXPLAIN ANALYZE ile bir alan tek basina 111 SANIYE olcculdu; index
    // eklendi ANCAK bu JOIN'ler yine de FILTRESIZ varsayilan sayfa
    // acilisinda (hicbir "sm."/"gk." filtresi YOKKEN) GEREKSIZ YERE her
    // satirda calisiyordu - artik SADECE gercekten bir filtre bu JOIN'e
    // ihtiyac duyuyorsa eklenir, filtresiz acilista bu pahali LATERAL
    // JOIN'ler TAMAMEN atlanir.
    const conditionsToCheck = [fieldFilterCondition, searchCondition]
    const needsMessageLogHere = needsMessageLogJoin && conditionsToCheck.some((condition) => condition.includes('sm.'))
    const needsGulkartHere = needsGulkartJoin && conditionsToCheck.some((condition) => condition.includes('gk.'))

    // PERFORMANS DUZELTMESI (hata raporu: "nakit yardımları listelerinde
    // filtreleme yapamıyorum, sayfa boşsa diğer sayfalardaki verileri
    // göstermiyor" - kok neden arastirilirken bulundu): oncesinde TUM
    // alanlarin UNION ALL'i birlestirilip GROUP BY EN SONDA, TEK SEFERDE
    // (tum birlesmis satirlar uzerinde) yapiliyordu - bu, 100 binin
    // uzerinde satirli tablolarda (ör. Yardımlar sekmesi) canli olculen
    // 18 SANIYEYI asan bir maliyete yol aciyordu (Postgres 9.4 boylesi
    // buyuk bir birlesik kumeyi tek seferde sort/grup edemiyordu). Artik
    // GROUP BY HER DALIN KENDI ICINDE (kucuk, kendi tablosunun/durumunun
        // satir sayisiyla sinirli) yapiliyor, sonra SADECE COKTAN
    // KUCULTULMUS sonuclar birlestiriliyor - AYNI canli veride 18
    // saniyeden ~1.4 saniyeye dustu.
    return `
      SELECT field, value, label, count FROM (
        SELECT ${sqlString(field)}::text AS field, v.value, v.value AS label, COUNT(*)::int AS count
        FROM (
          SELECT NULLIF(${expression}::text, '') AS value
          FROM ${tableName} t
          LEFT JOIN dosyalar d ON t.dosyaid = d.id
          ${needsMessageLogHere ? `
          LEFT JOIN LATERAL (
            SELECT durum, telefon, created_at, kanal FROM sms_gonderim_log WHERE dosyaid = d.id::text ORDER BY created_at DESC NULLS LAST LIMIT 1
          ) sm ON TRUE
          ` : ''}
          ${needsGulkartHere ? `
          LEFT JOIN LATERAL (
            SELECT nk.kartno
            FROM nakitkart nk
            WHERE nk.tckimlikno = t.tckimlikno
            ORDER BY nk.id DESC
            LIMIT 1
          ) gk ON TRUE
          ` : ''}
          WHERE t.durumu = 0 ${fieldFilterCondition} ${searchCondition}
        ) v
        WHERE v.value IS NOT NULL AND v.value <> ''
        GROUP BY v.value
        ORDER BY count DESC
        LIMIT ${FULL_FILTER_OPTION_MAX_VALUES}
      ) capped
    `
  })

  return `
    ${selectParts.join('\nUNION ALL\n')}
    ORDER BY field, label
  `
}

export async function AssistanceRequestListPage({
  searchParams,
  config,
}: AssistanceRequestListPageProps) {
  const params = await searchParams
  const currentPage = Math.max(1, Number(params.page) || 1)
  const pageSize = 50
  const offset = (currentPage - 1) * pageSize
  const searchTerm = params.search?.trim() || ''
  const modeTabsBasePath = getAssistanceModeTabsBasePath(config.routePath)
  const modeTabsConfig = ASSISTANCE_MODE_TABS_CONFIG[modeTabsBasePath]

  let kayitlar: Record<string, unknown>[] = []
  let totalCount = 0
  let waitingCount = 0
  let missingCardCount = 0
  let distinctFileCount = 0
  let filterValueOptions: Record<string, ColumnValueOption[]> = {}
  let nakitPeriodSummaryRows: NakitPeriodSummaryRow[] = []
  // Kullanici istegi: "yardım kişi sayısı, miktar gibi bazı alanların
  // toplamlarını altta gösterelim" - bkz. AdvancedTable.tsx <tfoot>.
  const columnTotals: Record<string, number> = {}
  let errorMessage: string | null = null

  let statusMap: Record<string, string> = {}

  try {
    const isDgnAssistanceTable = dgnAssistanceTables.has(config.tableName)
    const [loadedStatusMap, tableColumns] = await Promise.all([
      isDgnAssistanceTable ? getDgnAssistanceStatusMap() : getAssistanceStatusMap(),
      getTableColumns(config.tableName),
    ])
    statusMap = loadedStatusMap
    const columnNames = new Set(tableColumns.map((column) => column.column_name))
    const hasCardColumn = columnNames.has('kartno')

    const filterCondition = buildFilterCondition(params, 't')
    // Türkçe-duyarsız serbest metin araması (büyük/küçük harf + aksan yok sayılır)
    const searchCondition = buildTextSearchClause(config.searchColumns, searchTerm)

    // Kullanici istegi: Nakit Muracaatlari listesinde de (Yardimlar >
    // Nakit Yardimlari ile AYNI mantik) o dosyaya en son gonderilen mesajin
    // tarihi/durumu/alicisi/kanali gorunsun. ONCEDEN bu SADECE WhatsApp
    // (kanal='whatsapp') kayitlarina bakiyordu - kullanici artik SMS de
    // gonderebildigi icin ("sadece whatsap olarak göstermeyelim... hangi
    // platformdan mesaj çekilmişse onun bilgileri görünsün") kanal filtresi
    // TAMAMEN kaldirildi - hangi kanaldan (SMS ya da WhatsApp) olursa olsun
    // O DOSYAYA en son gonderilen mesaj (created_at'e gore) gosterilir; ayrica
    // hangi kanaldan gittigini ayirt edebilmek icin bir "kanal" sutunu da
    // eklendi.
    const needsMessageLogJoin = config.tableName === 'yrd_ayninakti'
    // Kullanici istegi: "nakit yardımları listesinde bulunan kayıtların
    // müracaatlar, yardımlar ve iptal edilenler listesinde ilgili kaydın
    // gülkart listesinde kartı var ise o da listede görünsün" - SADECE
    // Nakit Yardımı Müracaatları icin gecerli (bu component başka yardım
    // türlerinin müracaat listelerini de kapsar).
    const needsGulkartJoin = config.tableName === 'yrd_ayninakti'
    // ONEMLI DUZELTME (hata raporu: "SMS seçip filtrelemek istediğimde sayfa
    // boş gelir"): "Son Mesaj *" sutunlarina gore filtrelendiginde
    // filterCondition icine "sm.kanal ILIKE ..." gibi bir kosul giriyor
    // (bkz. lib/utils.ts virtualFileColumns), ama countQuery'nin FROM
    // blogunda "sm" LATERAL JOIN'i HIC YOKTU - bu da "missing FROM-clause
    // entry for table sm" SQL hatasina yol acip TUM sorguyu (dolayisiyla
    // sayfayi) basarisiz kiliyordu. countQuery de dataQuery ile AYNI
    // LATERAL JOIN'i icermeli.
    // Kullanici istegi: "yardım kişi sayısı, miktar gibi bazı alanların
    // toplamlarını altta gösterelim" - AYNI countQuery'ye eklenir (ekstra
    // bir sorgu GEREKMEZ), TUM FILTRELENMIS veri kumesi (sadece ekrandaki
    // sayfa DEGIL) uzerinden hesaplanir. "miktar"/"yardimkisisayisi"
    // kolonlari HER tabloda olmayabilir (bu bilesen Ekmek/Gıda/Giyim vb.
    // muracaat listelerini de kapsar) - bu yuzden SADECE gercekten var
    // olan kolonlar icin SUM eklenir.
    const hasAmountColumn = columnNames.has('miktar')
    const hasPersonCountColumn = columnNames.has('yardimkisisayisi')

    const countQuery = `
      SELECT
        COUNT(*)::int as total,
        COUNT(*) FILTER (WHERE t.durumu = 0)::int as waiting_count,
        COUNT(DISTINCT t.dosyaid)::int as distinct_file_count,
        ${hasCardColumn ? "COUNT(*) FILTER (WHERE NULLIF(t.kartno, '') IS NULL)::int" : '0'} as missing_card_count,
        ${hasAmountColumn ? 'COALESCE(SUM(t.miktar), 0)::float8' : '0'} as total_amount,
        ${hasPersonCountColumn ? 'COALESCE(SUM(t.yardimkisisayisi), 0)::float8' : '0'} as total_person_count
      FROM ${config.tableName} t
      LEFT JOIN dosyalar d ON t.dosyaid = d.id
      ${needsMessageLogJoin ? `
      LEFT JOIN LATERAL (
        SELECT durum, telefon, adisoyadi, created_at, kanal
        FROM sms_gonderim_log
        WHERE dosyaid = d.id::text
        ORDER BY created_at DESC NULLS LAST
        LIMIT 1
      ) sm ON TRUE
      ` : ''}
      ${needsGulkartJoin ? `
      LEFT JOIN LATERAL (
        SELECT nk.kartno
        FROM nakitkart nk
        WHERE nk.tckimlikno = t.tckimlikno
        ORDER BY nk.id DESC
        LIMIT 1
      ) gk ON TRUE
      ` : ''}
      WHERE t.durumu = 0 ${filterCondition} ${searchCondition}
    `
    // Kullanici istegi: her sutun basligina tiklayinca GERCEKTEN siralama
    // yapsin - eskiden bu sorgu "sort"/"dir" parametrelerini hic okumuyordu,
    // her zaman sabit "t.id DESC" donuyordu. "sort" degeri asla SQL'e
    // DOGRUDAN yazilmaz - ya bilinen "sanal" (d./sm. tablosundan gelen)
    // sutunlardan birine, ya da (guvenli kimlik regex'i ile dogrulandiktan
    // sonra) quoteIdentifier ile t.* sutununa eslenir.
    const virtualSortColumns: Record<string, string> = {
      dosyano: 'd.dosyano',
      inceleme_puani: 'd.inceleme_puani',
      dosya_telefonu: 'd.telefon',
      dosya_durumu: 'd.durumu',
      ...(needsMessageLogJoin ? {
        son_mesaj_tarihi: 'sm.created_at',
        son_mesaj_kanali: 'sm.kanal',
        son_mesaj_durumu: 'sm.durum',
        son_mesaj_alici: 'sm.telefon',
      } : {}),
      ...(needsGulkartJoin ? { gulkart: 'gk.kartno' } : {}),
    }
    const orderByClause = buildMultiColumnOrderBy(
      parseSortParam((params.sort || '').trim()),
      virtualSortColumns,
      't.id DESC',
      (key) => (isSafeIdentifier(key) ? `t.${quoteIdentifier(key)}` : undefined),
    )
    const dataQuery = `
      SELECT
        d.dosyano,
        d.inceleme_puani,
        d.telefon AS dosya_telefonu,
        d.durumu AS dosya_durumu,
        ${needsMessageLogJoin ? `
        sm.created_at AS son_mesaj_tarihi,
        CASE sm.kanal WHEN 'whatsapp' THEN 'WhatsApp' WHEN 'sms' THEN 'SMS' ELSE sm.kanal END AS son_mesaj_kanali,
        sm.durum AS son_mesaj_durumu,
        NULLIF(TRIM(CONCAT_WS(' - ', NULLIF(TRIM(sm.adisoyadi), ''), NULLIF(TRIM(sm.telefon), ''))), '') AS son_mesaj_alici,
        ` : ''}
        ${needsGulkartJoin ? 'gk.kartno AS gulkart,' : ''}
        t.*
      FROM ${config.tableName} t
      LEFT JOIN dosyalar d ON t.dosyaid = d.id
      ${needsMessageLogJoin ? `
      LEFT JOIN LATERAL (
        SELECT durum, telefon, adisoyadi, created_at, kanal
        FROM sms_gonderim_log
        WHERE dosyaid = d.id::text
        ORDER BY created_at DESC NULLS LAST
        LIMIT 1
      ) sm ON TRUE
      ` : ''}
      ${needsGulkartJoin ? `
      LEFT JOIN LATERAL (
        SELECT nk.kartno
        FROM nakitkart nk
        WHERE nk.tckimlikno = t.tckimlikno
        ORDER BY nk.id DESC
        LIMIT 1
      ) gk ON TRUE
      ` : ''}
      WHERE t.durumu = 0 ${filterCondition} ${searchCondition}
      ORDER BY ${orderByClause} LIMIT ${pageSize} OFFSET ${offset}
    `

    const filterOptionsQuery = buildFilterOptionsQuery(
      config.tableName,
      tableColumns,
      config.excludedColumns,
      searchCondition,
      params,
      needsMessageLogJoin,
      needsGulkartJoin,
    )
    const summaryQuery = config.tableName === 'yrd_ayninakti'
      ? `
        SELECT
          COALESCE(NULLIF(TRIM(t.donem), ''), 'Belirtilmedi') AS donem,
          COUNT(*)::int AS total,
          COUNT(*) FILTER (
            WHERE t.asama ILIKE '%ince%'
               OR t.asama ILIKE '%İnce%'
               OR t.asama ILIKE '%İNCE%'
          )::int AS incelenecek,
          COUNT(*) FILTER (
            WHERE t.asama ILIKE '%uygun%'
              AND t.asama NOT ILIKE '%değil%'
              AND t.asama NOT ILIKE '%degil%'
              AND t.asama NOT ILIKE '%olmayan%'
          )::int AS uygun,
          COUNT(*) FILTER (
            WHERE t.asama ILIKE '%uygun%'
              AND (
                t.asama ILIKE '%değil%'
                OR t.asama ILIKE '%degil%'
                OR t.asama ILIKE '%olmayan%'
              )
          )::int AS uygun_olmayan
        FROM ${config.tableName} t
        LEFT JOIN dosyalar d ON t.dosyaid = d.id
        ${needsMessageLogJoin ? `
        LEFT JOIN LATERAL (
          SELECT durum, telefon, adisoyadi, created_at, kanal
          FROM sms_gonderim_log
          WHERE dosyaid = d.id::text
          ORDER BY created_at DESC NULLS LAST
          LIMIT 1
        ) sm ON TRUE
        ` : ''}
        ${needsGulkartJoin ? `
        LEFT JOIN LATERAL (
          SELECT nk.kartno
          FROM nakitkart nk
          WHERE nk.tckimlikno = t.tckimlikno
          ORDER BY nk.id DESC
          LIMIT 1
        ) gk ON TRUE
        ` : ''}
        WHERE t.durumu = 0 ${filterCondition} ${searchCondition}
        GROUP BY COALESCE(NULLIF(TRIM(t.donem), ''), 'Belirtilmedi')
        ORDER BY donem
      `
      : ''

    const [countResult, result, filterValuesResult, cashLabelOptions, summaryResult] = await Promise.all([
      sqlMonitorService.executeQuery(countQuery),
      sqlMonitorService.executeQuery(dataQuery),
      filterOptionsQuery ? sqlMonitorService.executeQuery(filterOptionsQuery) : Promise.resolve(null),
      config.tableName === 'yrd_ayninakti' ? getCashLabelFilterOptions() : Promise.resolve([]),
      summaryQuery ? sqlMonitorService.executeQuery(summaryQuery) : Promise.resolve(null),
    ])
    const counts = countResult.rows[0] as {
      total?: unknown
      waiting_count?: unknown
      distinct_file_count?: unknown
      missing_card_count?: unknown
      total_amount?: unknown
      total_person_count?: unknown
    } | undefined

    totalCount = Number(counts?.total || 0)
    waitingCount = Number(counts?.waiting_count || 0)
    distinctFileCount = Number(counts?.distinct_file_count || 0)
    missingCardCount = Number(counts?.missing_card_count || 0)

    if (hasAmountColumn) columnTotals.miktar = Number(counts?.total_amount || 0)
    if (hasPersonCountColumn) columnTotals.yardimkisisayisi = Number(counts?.total_person_count || 0)

    kayitlar = result.rows as Record<string, unknown>[]

    if (filterValuesResult) {
      filterValueOptions = mapFilterValueOptions(filterValuesResult.rows as FilterValueRow[], statusMap)
    }

    if (config.tableName === 'yrd_ayninakti') {
      filterValueOptions = applyPredefinedCashLabelOptions(filterValueOptions, cashLabelOptions)
    }

    if (summaryResult) {
      nakitPeriodSummaryRows = (summaryResult.rows as Array<Record<string, unknown>>).map((row) => ({
        donem: String(row.donem || 'Belirtilmedi'),
        total: Number(row.total || 0),
        incelenecek: Number(row.incelenecek || 0),
        uygun: Number(row.uygun || 0),
        uygunOlmayan: Number(row.uygun_olmayan || 0),
      }))
    }
  } catch (error: unknown) {
    errorMessage = error instanceof Error ? error.message : String(error)
  }

  const nakitSummaryRows: Array<{ donem: string; asama: string; durumu: string; total: number }> = []

  return (
    <div className="space-y-6">
      {errorMessage && (
        <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm font-bold text-rose-600">
          Veritabanı Hatası: {errorMessage}
          <p className="mt-2 text-[11px] font-medium text-rose-500">
            Not: <span>{config.tableName}</span> tablosu veya <span>durumu</span> sütunu veritabanında mevcut olmayabilir.
          </p>
        </div>
      )}

      {false && (config.tableName === 'yrd_ayninakti' ? (
        <div className="grid gap-3 md:grid-cols-5 print:hidden">
          <div className="rounded-xl border border-sky-100 bg-white p-4 shadow-sm">
            <p className="text-[11px] font-black uppercase tracking-wide text-sky-700">Toplam Müracaat</p>
            <p className="mt-2 text-2xl font-black text-slate-950">{totalCount}</p>
          </div>
          <div className="rounded-xl border border-indigo-100 bg-white p-4 shadow-sm">
            <p className="text-[11px] font-black uppercase tracking-wide text-indigo-700">Dönem ve Sayıları</p>
            <div className="mt-2 max-h-28 space-y-1 overflow-y-auto pr-1">
              {nakitPeriodSummaryRows.map((row) => (
                <div key={`total-${row.donem}`} className="flex items-center justify-between gap-2 text-[15px] font-black text-slate-700">
                  <span className="min-w-0 truncate">{row.donem}</span>
                  <span className="shrink-0 text-slate-950">{row.total}</span>
                </div>
              ))}
            </div>
          </div>
          <div className="rounded-xl border border-emerald-100 bg-white p-4 shadow-sm">
            <p className="text-[11px] font-black uppercase tracking-wide text-emerald-700">Dönem / İncelenecek</p>
            <div className="mt-2 max-h-28 space-y-1 overflow-y-auto pr-1">
              {nakitPeriodSummaryRows.map((row) => (
                <div key={`incelenecek-${row.donem}`} className="flex items-center justify-between gap-2 text-[15px] font-black text-slate-700">
                  <span className="min-w-0 truncate">{row.donem}</span>
                  <span className="shrink-0 text-slate-950">{row.incelenecek}</span>
                </div>
              ))}
            </div>
          </div>
          <div className="rounded-xl border border-blue-100 bg-white p-4 shadow-sm">
            <p className="text-[11px] font-black uppercase tracking-wide text-blue-700">Dönem / Uygun</p>
            <div className="mt-2 max-h-28 space-y-1 overflow-y-auto pr-1">
              {nakitPeriodSummaryRows.map((row) => (
                <div key={`uygun-${row.donem}`} className="flex items-center justify-between gap-2 text-[15px] font-black text-slate-700">
                  <span className="min-w-0 truncate">{row.donem}</span>
                  <span className="shrink-0 text-slate-950">{row.uygun}</span>
                </div>
              ))}
            </div>
          </div>
          <div className="rounded-xl border border-amber-100 bg-white p-4 shadow-sm">
            <p className="text-[11px] font-black uppercase tracking-wide text-amber-700">Dönem / Uygun Olmayan</p>
            <div className="mt-2 max-h-28 space-y-1 overflow-y-auto pr-1">
              {nakitPeriodSummaryRows.map((row) => (
                <div key={`uygun-olmayan-${row.donem}`} className="flex items-center justify-between gap-2 text-[15px] font-black text-slate-700">
                  <span className="min-w-0 truncate">{row.donem}</span>
                  <span className="shrink-0 text-slate-950">{row.uygunOlmayan}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      ) : (
      <div className="grid gap-3 md:grid-cols-4 print:hidden">
        <div className="rounded-xl border border-sky-100 bg-white p-4 shadow-sm">
          <p className="text-[11px] font-black uppercase tracking-wide text-sky-700">Listelenen Kayıt</p>
          <p className="mt-2 text-2xl font-black text-slate-950">{totalCount}</p>
        </div>
        <div className="rounded-xl border border-emerald-100 bg-white p-4 shadow-sm">
          <p className="text-[11px] font-black uppercase tracking-wide text-emerald-700">Bekleyen Müracaat</p>
          <p className="mt-2 text-2xl font-black text-slate-950">{waitingCount}</p>
        </div>
        <div className="rounded-xl border border-blue-100 bg-white p-4 shadow-sm">
          <p className="text-[11px] font-black uppercase tracking-wide text-blue-700">Dosya Sayısı</p>
          <p className="mt-2 text-2xl font-black text-slate-950">{distinctFileCount}</p>
        </div>
        <div className="rounded-xl border border-amber-100 bg-white p-4 shadow-sm">
          <p className="text-[11px] font-black uppercase tracking-wide text-amber-700">Kart No Eksik</p>
          <p className="mt-2 text-2xl font-black text-slate-950">{missingCardCount}</p>
        </div>
      </div>
      ))}

      {false && config.tableName === 'yrd_ayninakti' && (
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm print:hidden">
          <div className="mb-3 flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="text-[11px] font-black uppercase tracking-wide text-indigo-700">Nakit Müracaat Özeti</p>
              <h2 className="mt-1 text-lg font-black text-slate-950">Dönem ve Aşama Durumu</h2>
            </div>
            <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-[15px] font-black text-slate-600">
              Toplam Müracaat: {totalCount}
            </div>
          </div>

          {nakitSummaryRows.length === 0 ? (
            <div className="rounded-lg border border-slate-100 bg-slate-50 px-4 py-5 text-center text-sm font-bold text-slate-500">
              Özet rapor için kayıt bulunamadı.
            </div>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-slate-200">
              <table className="w-full border-collapse text-left text-[13px] font-semibold">
                <thead className="bg-indigo-50 text-[11px] font-black uppercase text-indigo-700">
                  <tr>
                    <th className="border-b border-indigo-100 px-3 py-2">Dönem</th>
                    <th className="border-b border-indigo-100 px-3 py-2">Aşama</th>
                    <th className="border-b border-indigo-100 px-3 py-2">Durum</th>
                    <th className="border-b border-indigo-100 px-3 py-2 text-right">Toplam Müracaat</th>
                  </tr>
                </thead>
                <tbody>
                  {nakitSummaryRows.map((row, index) => (
                    <tr key={`${row.donem}-${row.asama}-${row.durumu}-${index}`} className={index % 2 === 0 ? 'bg-white' : 'bg-slate-50/70'}>
                      <td className="border-b border-slate-100 px-3 py-2 text-slate-900">{row.donem}</td>
                      <td className="border-b border-slate-100 px-3 py-2 text-slate-900">{row.asama}</td>
                      <td className="border-b border-slate-100 px-3 py-2 text-slate-900">{statusMap[row.durumu] || row.durumu}</td>
                      <td className="border-b border-slate-100 px-3 py-2 text-right font-black text-slate-950">{row.total}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      <ManagedReportTablePage
        eyebrow="Müracaat Yönetimi"
        title={config.title}
        routePath={config.routePath}
        organizedToolbar
        data={errorMessage ? [] : kayitlar}
        tableId={config.tableId}
        columnTotals={Object.keys(columnTotals).length > 0 ? columnTotals : undefined}
        columnTotalsLabel="Toplam (Tüm Sonuçlar)"
        totalCount={totalCount}
        currentPage={currentPage}
        pageSize={pageSize}
        searchTerm={searchTerm}
        searchPlaceholder={config.searchPlaceholder}
        emptyMessage={config.emptyMessage}
        statusMap={statusMap}
        assistanceStatusVariant={dgnAssistanceTables.has(config.tableName) ? 'dgn' : 'default'}
        excludedColumns={config.excludedColumns}
        // Kullanici istegi: hicbir sutun artik zorla gorunur/kilitli degil -
        // eskiden bazi sutunlarin "gorunurluk" onay kutusu pasifti, kullanici
        // sayfa tasarimini (sutun ekleme/kaldirma) ozgurce yapamiyordu.
        columnReorderingControls={config.routePath.startsWith('/assistance/nakit')}
        columnLabels={{
          inceleme_puani: 'İnceleme Puanı',
          dosya_durumu: 'Dosya Durumu',
          // Kullanici istegi (2026-09-28): online basvurudan aktarilan
          // muracaatlarda, basvuru aninda vatandaşın yazdigi adres burada
          // da gorunsun (bkz. transfer-to-cash/route.ts - yeni "adres"
          // kolonu).
          adres: 'Başvuru Adresi',
          durumu: 'Müracaat Durumu',
          son_mesaj_tarihi: 'Son Mesaj Tarihi',
          son_mesaj_kanali: 'Son Mesaj Kanalı',
          son_mesaj_durumu: 'Son Mesaj Durumu',
          son_mesaj_alici: 'Son Mesaj Alıcısı',
          gulkart: 'Gülkart',
          // Kullanici istegi: "tabloda bulunan tüm veriler bu listede
          // görünsün, istediğimizi biz ekleyip kaldırabilelim" - eskiden
          // excludedColumns ile TAMAMEN gizlenen alanlar artik goruntu
          // secenegi olarak sunuluyor, okunakli bir baslikla.
          dosyaid: 'Dosya ID',
          kullaniciid: 'Kullanıcı ID',
          ilkkullaniciid: 'İlk Kullanıcı ID',
          islemtarihi: 'İşlem Tarihi',
          ilkislemtarihi: 'İlk İşlem Tarihi',
          durumuaciklama: 'Durum Açıklaması',
          asamanotu: 'Aşama Notu',
          muracaatnotu: 'Müracaat Notu',
          asamaozelkod: 'Aşama Özel Kodu',
          // Kullanici istegi: "Yardım Kişi Sayısı" ve girilen TC kimlik
          // no'lari (bkz. documents/page.tsx - Ayni/Nakdi Müracaat formu)
          // nakit müracaat listesinde de okunakli bir baslikla gorunsun.
          yardimkisisayisi: 'Yardım Kişi Sayısı',
          yardimkisitc: 'Yardım Kişileri (TC)',
        }}
        filterValueOptions={filterValueOptions}
        newButtonLabel={config.newButtonLabel}
        exportFilePrefix={config.tableId}
        exportEndpoint={`/api/assistance/list-export?table=${encodeURIComponent(config.tableName)}&scope=${encodeURIComponent('t.durumu = 0')}`}
        tableKey={config.sectionTitle}
        importConfig={config.importConfig}
        // Kullanici istegi: Nakit Müracaatları sayfasında "Filtrelenen
        // Tümünü Seç" ile TÜM sayfalardaki müracaatlara toplu WhatsApp
        // gönderilebilsin - bkz. app/api/assistance/
        // bulk-whatsapp-recipients/route.ts (bu sayfanin whereClause'i
        // HER ZAMAN "t.durumu = 0"dir).
        bulkWhatsappAllFilteredConfig={
          // Kullanici istegi (Eylul 2026): tum yardim MURACAAT listelerinde de
          // "Filtrelenen Tumunu Sec -> toplu SMS/WhatsApp". Muracaat sayfasinin
          // whereClause'i her zaman "t.durumu = 0".
          config.tableName.startsWith('yrd_')
            ? { endpoint: '/api/assistance/bulk-whatsapp-recipients', tableName: config.tableName, whereClause: 't.durumu = 0' }
            : undefined
        }
        afterHeader={modeTabsConfig ? (
          <AssistanceModeTabs basePath={modeTabsBasePath} {...modeTabsConfig} />
        ) : undefined}
        extraToolbarButtons={config.tableName === 'yrd_ayninakti' ? (
          <>
            <NakitApplicationsSyncButton />
            <NakitAutoRejectButton />
            <NakitPhoneSyncButton />
          </>
        ) : undefined}
        deleteConfig={{
          endpoint: `/api/assistance/records?table=${encodeURIComponent(config.tableName)}&mode=request`,
          label: 'Seçili Müracaatı Sil',
        }}
        createFileConfig={config.createFileConfig}
        cancelConfig={
          config.tableName === 'yrd_ayninakti'
            ? { endpoint: '/api/requests/nakit/cancel', label: 'İptal Et' }
            : undefined
        }
        personnelAssignConfig={config.personnelAssignConfig}
        copyConfig={config.copyConfig}
        investigationReportConfig={config.investigationReportConfig}
        recordUpdateConfig={config.recordUpdateConfig}
        phoneFieldPriority={config.phoneFieldPriority}
      />
    </div>
  )
}
