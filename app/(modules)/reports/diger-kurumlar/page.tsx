import { ManagedReportTablePage } from '@/components/shared/ManagedReportTablePage'
import { DEFAULT_PREDEFINED_VALUES, type PredefinedValuesMap } from '@/lib/constants/predefinedValues'
import { toAssistanceStatusMap } from '@/lib/services/assistanceStatusLabels.service'
import { predefinedValuesService } from '@/lib/services/predefinedValues.service'
import { sqlMonitorService } from '@/lib/services/sqlMonitor.service'
import { buildFilterCondition, buildMappedFilterCondition, buildTextSearchClause } from '@/lib/utils'
import { DigerKurumlarSyncButton } from './_components/DigerKurumlarSyncButton'

export const dynamic = 'force-dynamic'

// Kullanici istegi: sablon, personelin ELLE doldurmasi GEREKEN alanlarla
// sinirlandirildi ("kullaniciid", "dosyaid", "islemtarihi" gibi teknik/ic
// alanlar KALDIRILDI) - dosyaid artik personel yazmiyor, /api/reports/
// diger-kurumlar POST'u tckimlikno'ya gore bireyler tablosundan OTOMATIK
// buluyor (bkz. o dosyadaki ayni kullanici istegi notu); kullaniciid/
// ilkkullaniciid/islemtarihi/ilkislemtarihi/uyrugu de orada otomatik
// dolduruluyor.
// NOT: "aciklama" sutunu BILEREK aksansiz yazildi - gercek veritabani
// sutun adi da aksansiz "aciklama" (Turkce "açıklama" DEGIL); bu farkin
// FARKINA VARILMADAN kullanilmasi, hem eski sablonda hem arama filtresinde
// (bkz. asagidaki searchCondition duzeltmesi) veriyi SESSIZCE
// eslesmemesine/hataya yol aciyordu.
const DIGER_KURUMLAR_IMPORT_COLUMNS = [
  'tarih',
  'tckimlikno',
  'adisoyadi',
  'yardimalkrmadi',
  'yardimturu',
  'aciklama',
  'miktar',
]

type ColumnValueOption = { value: string; label: string; count: number }
type FilterValueRow = { field: string; value: string; label: string; count: number }
const FULL_FILTER_OPTION_FIELDS = new Set(['yardimalkrmadi', 'yardimturu', 'tarih'])
const NO_FILE_STATUS_FILTER_VALUE = '__NO_FILE__'

function quoteIdentifier(value: string) {
  return `"${value.replace(/"/g, '""')}"`
}

function sqlString(value: string) {
  return `'${value.replace(/'/g, "''")}'`
}

function omitFilterFields(params: Record<string, string>, fields: string[]) {
  const ignored = new Set(fields.flatMap((field) => [`f_${field}`, `f_${field}_op`, `f_${field}_v2`]))

  return Object.fromEntries(Object.entries(params).filter(([key]) => !ignored.has(key))) as Record<string, string>
}

function toFileStatusMap(values: PredefinedValuesMap) {
  return (values.fileStatus?.length ? values.fileStatus : DEFAULT_PREDEFINED_VALUES.fileStatus)
    .reduce((acc, item) => {
      acc[item.id] = item.name
      return acc
    }, {} as Record<string, string>)
}

function buildFileStatusFilterCondition(params: Record<string, string>) {
  if (params.f_dosya_durumu === NO_FILE_STATUS_FILTER_VALUE) return ' AND d.id IS NULL'

  return buildMappedFilterCondition(params, {
    dosya_durumu: 'd.durumu',
  })
}

function mapFilterValueOptions(
  rows: FilterValueRow[],
  statusMap: Record<string, string>,
  fileStatusMap: Record<string, string>,
) {
  return rows.reduce((acc, row) => {
    if (!acc[row.field]) acc[row.field] = []

    const value = String(row.value)
    acc[row.field].push({
      value,
      label: row.field === 'durumu'
        ? statusMap[value] || String(row.label)
        : row.field === 'dosya_durumu'
          ? value === NO_FILE_STATUS_FILTER_VALUE ? String(row.label) : fileStatusMap[value] || String(row.label)
          : String(row.label),
      count: Number(row.count || 0),
    })

    return acc
  }, {} as Record<string, ColumnValueOption[]>)
}

export default async function DigerKurumlarPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; search?: string } & Record<string, string>>
}) {
  const params = await searchParams
  const currentPage = Math.max(1, Number(params.page) || 1)
  const pageSize = 100
  const offset = (currentPage - 1) * pageSize
  const searchTerm = params.search?.trim() || ''

  let kayitlar: Record<string, unknown>[] = []
  let totalCount = 0
  let totalMiktar = 0
  let errorMessage: string | null = null
  let filterValueOptions: Record<string, ColumnValueOption[]> = {}
  const { values: predefinedValues } = await predefinedValuesService.getAll()
  const statusMap = toAssistanceStatusMap(predefinedValues)
  const fileStatusMap = toFileStatusMap(predefinedValues)

  try {
    const tableFilterParams = omitFilterFields(params, ['dosya_durumu'])
    const filterCondition = `${buildFilterCondition(tableFilterParams, 't')}${buildFileStatusFilterCondition(params)}`
    // ONEMLI DUZELTME: bu kosul "t.muracaateden" ve "t.etiket" gibi
    // yrd_digerkrmalyrdm tablosunda HIC OLMAYAN sutunlara, "açıklama"
    // (aksanli) ise gercek sutun adi "aciklama" (aksansiz) OLMADIGI icin
    // YANLIS sutuna atifta bulunuyordu - arama kutusuna bir sey yazildigi
    // AN sorgu "column does not exist" hatasi veriyordu (kullanici arama
    // yapamaz hale geliyordu). Gercek sutunlarla (adisoyadi, aciklama,
    // tckimlikno) degistirildi.
    // Türkçe-duyarsız serbest metin araması (büyük/küçük harf + aksan yok sayılır)
    const searchCondition = buildTextSearchClause(['t.adisoyadi', 't.aciklama', 't.tckimlikno', 'd.dosyano'], searchTerm)

    // Kullanici istegi (2026-10-07): "dosya numarasina gore filtreleme
    // yaptigimizda o dosyada kac tane diger kurum yardimi var ve toplam ne
    // kadar aliyor onlari gorebilelim" - sayfadaki filtrelerle (dosya no
    // dahil) AYNI WHERE kosulu kullanilarak kayit sayisi + miktar toplami
    // birlikte hesaplanir, asagida ozet kutusu olarak gosterilir. Sadece
    // "dosya no" filtresine ozgu degil - o an uygulanan HANGI filtre
    // kombinasyonu olursa olsun gecerlidir (dosya no'ya gore filtrelenince
    // dogal olarak o TEK dosyanin toplami gorunur).
    const countQuery = `
      SELECT COUNT(*)::int as total, COALESCE(SUM(t.miktar), 0)::bigint as toplam_miktar
      FROM yrd_digerkrmalyrdm t
      LEFT JOIN dosyalar d ON t.dosyaid = d.id
      WHERE 1=1 ${filterCondition} ${searchCondition}
    `
    const dataQuery = `
      SELECT
        d.dosyano,
        d.durumu AS dosya_durumu,
        d.inceleme_puani,
        t.*
      FROM yrd_digerkrmalyrdm t
      LEFT JOIN dosyalar d ON t.dosyaid = d.id
      WHERE 1=1 ${filterCondition} ${searchCondition}
      ORDER BY t.id DESC LIMIT ${pageSize} OFFSET ${offset}
    `

    const countResult = await sqlMonitorService.executeQuery(countQuery)
    const countRow = countResult.rows[0] as { total?: unknown; toplam_miktar?: unknown } | undefined
    totalCount = Number(countRow?.total || 0)
    totalMiktar = Number(countRow?.toplam_miktar || 0)

    const result = await sqlMonitorService.executeQuery(dataQuery)
    kayitlar = result.rows as Record<string, unknown>[]

    const tableColumns = await sqlMonitorService.getTableColumns('yrd_digerkrmalyrdm')
    const excluded = new Set(['dosyaid', 'kullaniciid', 'ilkkullaniciid', 'islemtarihi', 'ilkislemtarihi', 'id', 'uyrugu'])
    const optionFields = tableColumns
      .map((column) => column.columnName)
      .filter((field, index, self) => self.indexOf(field) === index && !excluded.has(field) && FULL_FILTER_OPTION_FIELDS.has(field))
    const optionSelectParts = [
      `
        SELECT 'dosya_durumu'::text AS field,
               CASE WHEN d.id IS NULL THEN '${NO_FILE_STATUS_FILTER_VALUE}' ELSE NULLIF(d.durumu::text, '') END AS value,
               CASE WHEN d.id IS NULL THEN 'Dosyasi Yok' ELSE NULLIF(d.durumu::text, '') END AS label
        FROM yrd_digerkrmalyrdm t
        LEFT JOIN dosyalar d ON t.dosyaid = d.id
        WHERE 1=1 ${filterCondition} ${searchCondition}
      `,
      ...optionFields.map((field) => {
      const expression = field === 'dosyano' ? 'd.dosyano' : `t.${quoteIdentifier(field)}`
      const valueExpression = field === 'tarih' ? `to_char(${expression}::date, 'YYYY-MM-DD')` : `${expression}::text`
      const labelExpression = field === 'tarih' ? `to_char(${expression}::date, 'DD.MM.YYYY')` : `${expression}::text`

      return `
        SELECT ${sqlString(field)}::text AS field,
               NULLIF(${valueExpression}, '') AS value,
               NULLIF(${labelExpression}, '') AS label
        FROM yrd_digerkrmalyrdm t
        LEFT JOIN dosyalar d ON t.dosyaid = d.id
        WHERE 1=1 ${filterCondition} ${searchCondition}
      `
    }),
    ]

    if (optionSelectParts.length > 0) {
      const filterValuesResult = await sqlMonitorService.executeQuery(`
        SELECT field, value, label, COUNT(*)::int AS count
        FROM (
          ${optionSelectParts.join('\nUNION ALL\n')}
        ) options
        WHERE value IS NOT NULL
          AND value <> ''
        GROUP BY field, value, label
        ORDER BY field, label;
      `)
      filterValueOptions = mapFilterValueOptions(filterValuesResult.rows as FilterValueRow[], statusMap, fileStatusMap)
    }
  } catch (error: unknown) {
    errorMessage = error instanceof Error ? error.message : String(error)
  }

  return (
    <div className="space-y-6">
      {errorMessage && (
        <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm font-bold text-rose-600">
          Veritabanı Hatası: {errorMessage}
        </div>
      )}

      {!errorMessage && (
        <div className="flex flex-wrap items-center gap-3 rounded-xl border-2 border-slate-200 bg-white px-4 py-3 shadow-sm">
          <span className="text-xs font-black uppercase tracking-wide text-slate-500">
            {Object.keys(params).some((key) => key.startsWith('f_')) ? 'Filtrelenen Sonuç' : 'Tüm Kayıtlar'}
          </span>
          <span className="inline-flex items-center gap-1.5 rounded-lg bg-sky-50 px-3 py-1.5 text-sm font-extrabold text-sky-700">
            {totalCount.toLocaleString('tr-TR')} kayıt
          </span>
          <span className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-50 px-3 py-1.5 text-sm font-extrabold text-emerald-700">
            Toplam: {totalMiktar.toLocaleString('tr-TR')}
          </span>
        </div>
      )}

      <div className="dy-yardim-rapor-17">
      <ManagedReportTablePage
        eyebrow="Raporlar"
        title="Diğer Kurumlar Raporu"
        routePath="/reports/diger-kurumlar"
        data={errorMessage ? [] : kayitlar}
        tableId="yrd_digerkrmalyrdm"
        totalCount={totalCount}
        currentPage={currentPage}
        pageSize={pageSize}
        // Kullanici istegi: "daha önceden diğer kurum yardımı var ama
        // dosyası yok ise ve sonradan dosya açılmışsa" kaydin dosya
        // numarasini guncelleyen buton - bkz. DigerKurumlarSyncButton.tsx
        // ve app/api/reports/diger-kurumlar/sync-files/route.ts.
        extraToolbarButtons={<DigerKurumlarSyncButton />}
        searchTerm={searchTerm}
        searchPlaceholder="Dosya no, TC kimlik no, ad soyad veya açıklama ara"
        emptyMessage="Görüntülenecek kayıt bulunamadı."
        statusMap={statusMap}
        excludedColumns={['dosyaid', 'kullaniciid', 'ilkkullaniciid', 'islemtarihi', 'ilkislemtarihi', 'id', 'uyrugu']}
        // Kullanici istegi: "bazı başlıkları pasif kaldıramıyorum" - Dosya
        // No/Durumu/İnceleme Puanı ONCEDEN "requiredVisibleColumns" ile
        // HER ZAMAN acik/kilitli tutuluyordu (personel Sütun Ayarları'ndan
        // kapatamiyordu). Bu tablodaki kayitlarin BUYUK KISMI zaten bir
        // dosyaya bagli olmayabiliyor (bkz. "Dosyasi Yok" filtresi) - bu 3
        // sutunun HER ZAMAN gorunur kalmasi zorunlu degil, kaldirildi.
        preferredColumnOrder={['dosyano', 'dosya_durumu', 'inceleme_puani']}
        extraFilterColumns={['yardimalkrmadi', 'yardimturu', 'tarih']}
        columnLabels={{
          dosyano: 'Dosya No',
          dosya_durumu: 'Dosya Durumu',
          inceleme_puani: 'İnceleme Puanı',
          yardimalkrmadi: 'Yardım Aldığı Kurum',
          yardimturu: 'Yardım Türü',
          tarih: 'Tarih',
          aciklama: 'Açıklama',
        }}
        filterValueOptions={filterValueOptions}
        exportFilePrefix="diger-kurumlar"
        deleteConfig={{
          endpoint: '/api/reports/diger-kurumlar',
          label: 'Seçilenleri Sil',
          allowFilteredDelete: true,
          filteredLabel: 'Filtrelenen Tümünü Sil',
        }}
        importConfig={{
          endpoint: '/api/reports/diger-kurumlar',
          columns: DIGER_KURUMLAR_IMPORT_COLUMNS,
          title: 'Diğer Kurumlar Veri Aktarımı',
          // Kullanici istegi: sablon artik sadece elle doldurulacak 7
          // alani listeler - dosya baglantisi (dosyaid), kayit sahibi ve
          // islem tarihi gibi teknik bilgiler sistem tarafindan tckimlikno
          // uzerinden OTOMATIK dolduruluyor.
          description: 'Excel şablonunu indirip doldurun (TC Kimlik No zorunludur), sonra buradan yükleyin. Kişi dosyası, TC Kimlik No üzerinden otomatik bulunup bağlanır - dosya numarası veya başka teknik bilgi girmenize gerek yoktur.',
          templateFileName: `diger-kurumlar-sablon-${new Date().toISOString().slice(0, 10)}.xlsx`,
        }}
      />
      </div>
    </div>
  )
}
