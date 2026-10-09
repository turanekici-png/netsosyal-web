import { ManagedReportTablePage } from '@/components/shared/ManagedReportTablePage'
import {
  getAssistanceStatusMap,
  getDgnAssistanceStatusMap,
} from '@/lib/services/assistanceStatusLabels.service'
import { getCashLabelFilterOptions } from '@/lib/services/cashPredefinedLabels.service'
import { sqlMonitorService } from '@/lib/services/sqlMonitor.service'
import { buildMappedFilterCondition, buildTextSearchClause } from '@/lib/utils'
import { buildMultiColumnOrderBy, parseSortParam } from '@/lib/sortSpec'
import { computeNeighborhoodPaymentWindow } from '@/lib/utils/paymentWindow'
import { AssistanceModeTabs } from './AssistanceModeTabs'
import { ASSISTANCE_MODE_TABS_CONFIG, getAssistanceModeTabsBasePath } from './assistanceModeTabsConfig'
import { NakitApplicationsSyncButton } from '../nakit/_components/NakitApplicationsSyncButton'
import { NakitPhoneSyncButton } from '../nakit/_components/NakitPhoneSyncButton'

type SearchParams = { page?: string; search?: string } & Record<string, string>
type ColumnInfo = { column_name: string }
type FilterValueRow = { field: string; value: string; label: string; count: number }
type ColumnValueOption = { value: string; label: string; count: number }

// Bu alanlarin acilir menusu, o an ekrandaki sayfadaki kayitlardan degil,
// TUM filtrelenmis veri kumesinden (SQL ile) hesaplanir - aksi halde ör.
// "Tahkikatpers" acilir menusunde sadece o sayfada goruntulenen 50 kayittaki
// personel isimleri gorunur, listede olup da baska bir sayfada olan
// personel secilemezdi. Kullanici istegi (Nakit Yardimi listesi): "asama",
// "etiket" ("tahkikatpers" DAHIL EDILMEMISTI - eksikligi buydu) ve "donem"
// zaten bu kumedeydi; "tahkikatpers" eksikti, AssistanceRequestListPage.tsx'teki
// (Muracaatlar) AYNI duzeltmeyle burada da eklendi. "Yardım Kişileri (TC)"
// ve "Yardım Kişi Sayısı" da AYNI sekilde eklendi - bu veri SEYREK
// oldugundan, sayfa-bazli (sadece ekrandaki 50 kayit) deger listesi
// neredeyse HER ZAMAN bos gorunuyordu, kullanici "filtreler bos/kullanilamiyor"
// saniyordu.
// Hata raporu (devam): ayni "sayfa-bazli deger listesi bos gorunuyor"
// sikayeti BASKA alanlar icin de gecerliydi - "durumuaciklama"/
// "muracaatozelkod"/"medenihal"/"topbirey" DUSUK-KARDINALITE (az sayida
// farkli deger alan, gercekten "listeden sec" mantigina uygun) alanlar
// oldugundan bunlar da eklendi. YUKSEK-kardinaliteli serbest metin
// alanlari (muracaatnotu, asamanotu, iban, ceptel, dosyaid vb.) KASITLI
// OLARAK BURAYA EKLENMEDI - binlerce farkli deger acilir menude ANLAMSIZ/
// KULLANILAMAZ olurdu, bu alanlar zaten ustteki serbest metin "İçerir"
// kutusuyla (HICBIR whitelist'e tabi degil, HER alan icin calisir)
// filtrelenebilir.
const FULL_FILTER_OPTION_FIELDS = new Set([
  'donem', 'etiket', 'asama', 'mahalle', 'tahkikatpers', 'yardimkisitc', 'yardimkisisayisi',
  'durumuaciklama', 'muracaatozelkod', 'medenihal', 'topbirey',
])

type AssistanceListConfig = {
  title: string
  newButtonLabel?: string
  routePath: string
  tableName: string
  tableId: string
  whereClause: string
  searchColumns: string[]
  searchPlaceholder: string
  emptyMessage: string
  excludedColumns: string[]
  showSummary?: boolean
  loadFilterOptions?: boolean
  personnelAssignConfig?: {
    endpoint: string
    label?: string
  }
  copyConfig?: {
    endpoint: string
    label?: string
    sourceStatus: number
  }
  recordUpdateConfig?: {
    endpoint: string
    label?: string
    sourceStatus?: number
  }
  phoneFieldPriority?: string[]
}

type AssistanceListPageProps = {
  searchParams: Promise<SearchParams>
  config: AssistanceListConfig
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
  whereClause: string,
  searchCondition: string,
  params: SearchParams,
  filterColumnMap: Record<string, string>,
  needsGulkartJoin: boolean,
) {
  if (!isSafeIdentifier(tableName)) return ''

  const excluded = new Set(excludedColumns)
  const optionFields = Array.from(new Set([...columns.map((column) => column.column_name), 'mahalle'])).filter((field) => {
    if (excluded.has(field) || field === 'id') return false
    return FULL_FILTER_OPTION_FIELDS.has(field) && isSafeIdentifier(field)
  })

  if (optionFields.length === 0) return ''

  // NOT: her sutunun kendi acilir menusu, DIGER sutunlarin filtresine gore
  // daralmali ama KENDI filtresine gore DARALMAMALI - aksi halde bir deger
  // secildikten sonra o sutunun menusunde SADECE secili deger kalir, baska
  // bir degere gecmek icin once filtreyi temizlemek gerekirdi. Bu yuzden
  // her alan icin "excludeField" ile O ALANIN KENDI filtresi haric tutulan,
  // AYRI bir filtre kosulu hesaplaniyor (Dosyalar/Bireyler'deki "faceted
  // search" ile ayni mantik).
  const selectParts = optionFields.map((field) => {
    const expression = field === 'mahalle' ? 'd.mahalleadi' : field === 'dosyano' ? 'd.dosyano' : `t.${quoteIdentifier(field)}`
    const fieldFilterCondition = buildMappedFilterCondition(params, filterColumnMap, field)

    // ONEMLI DUZELTME (hata raporu: "SMS seçip filtrelemek istediğimde sayfa
    // boş gelir"): DIGER alanlarin fieldFilterCondition'i "sm."/"owner_ceptel."
    // referans edebilir (ör. Son Mesaj Kanalı ile Dönem ayni anda filtrelenirse)
    // - bu subquery'nin bu JOIN'leri hic icermemesi "missing FROM-clause
    // entry" hatasina yol aciyordu. PERFORMANS DUZELTMESI (hata raporu:
    // "nakit yardımları listesini açarken yavaş açılıyor" - kok neden:
    // nakitkart.tckimlikno indexsizdi, EXPLAIN ANALYZE ile bir alan tek
    // basina 111 SANIYE olcculdu; index eklendi ANCAK bu 3 JOIN yine de
    // FILTRESIZ varsayilan sayfa acilisinda (hicbir "sm."/"owner_ceptel."/
    // "gk." filtresi YOKKEN) GEREKSIZ YERE her satirda calisiyordu - artik
    // SADECE gercekten bir filtre bu JOIN'e ihtiyac duyuyorsa eklenir,
    // filtresiz acilista bu 3 pahali LATERAL JOIN TAMAMEN atlanir.
    const conditionsToCheck = [whereClause, fieldFilterCondition, searchCondition]
    const needsOwnerCeptelHere = conditionsToCheck.some((condition) => condition.includes('owner_ceptel.'))
    const needsMessageLogHere = conditionsToCheck.some((condition) => condition.includes('sm.'))
    const needsGulkartHere = needsGulkartJoin && conditionsToCheck.some((condition) => condition.includes('gk.'))

    // PERFORMANS DUZELTMESI (hata raporu: "nakit yardımları listelerinde
    // filtreleme yapamıyorum, sayfa boşsa diğer sayfalardaki verileri
    // göstermiyor" - kok neden arastirilirken bulundu): oncesinde TUM
    // alanlarin UNION ALL'i birlestirilip GROUP BY EN SONDA, TEK SEFERDE
    // (tum birlesmis satirlar uzerinde) yapiliyordu - bu, 100 binin uzerinde
    // satirli tablolarda (ör. Yardımlar sekmesi) canli olculen 18 SANIYEYI
    // asan bir maliyete yol aciyordu (Postgres 9.4 boylesi buyuk bir
    // birlesik kumeyi tek seferde sort/grup edemiyordu). Artik GROUP BY HER
    // DALIN KENDI ICINDE (kucuk, kendi tablosunun/durumunun satir sayisiyla
    // sinirli) yapiliyor, sonra SADECE COKTAN KUCULTULMUS sonuclar
    // birlestiriliyor - AYNI canli veride 18 saniyeden ~1.4 saniyeye dustu.
    return `
      SELECT ${sqlString(field)}::text AS field, v.value, v.value AS label, COUNT(*)::int AS count
      FROM (
        SELECT NULLIF(${expression}::text, '') AS value
        FROM ${tableName} t
        LEFT JOIN dosyalar d ON t.dosyaid = d.id
        ${needsOwnerCeptelHere ? `
        LEFT JOIN LATERAL (
          SELECT NULLIF(BTRIM(b.ceptel), '') AS ceptel
          FROM bireyler b
          WHERE b.dosyaid = d.id
          ORDER BY
            CASE WHEN b.tipi = 1 THEN 0 WHEN b.yakinligi = 0 THEN 1 ELSE 2 END,
            b.id ASC
          LIMIT 1
        ) owner_ceptel ON TRUE
        ` : ''}
        ${needsMessageLogHere ? `
        LEFT JOIN LATERAL (
          SELECT durum, telefon, adisoyadi, created_at, kanal
          FROM sms_gonderim_log
          WHERE dosyaid = d.id::text
          ORDER BY created_at DESC NULLS LAST
          LIMIT 1
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
        WHERE ${whereClause} ${fieldFilterCondition} ${searchCondition}
      ) v
      WHERE v.value IS NOT NULL AND v.value <> ''
      GROUP BY v.value
    `
  })

  return `
    ${selectParts.join('\nUNION ALL\n')}
    ORDER BY field, label
  `
}

export async function AssistanceListPage({ searchParams, config }: AssistanceListPageProps) {
  const params = await searchParams
  const currentPage = Math.max(1, Number(params.page) || 1)
  const pageSize = 50
  const offset = (currentPage - 1) * pageSize
  const searchTerm = params.search?.trim() || ''
  const showSummary = config.showSummary !== false
  const loadFilterOptions = config.loadFilterOptions !== false
  const modeTabsBasePath = getAssistanceModeTabsBasePath(config.routePath)
  const modeTabsConfig = ASSISTANCE_MODE_TABS_CONFIG[modeTabsBasePath]

  let kayitlar: Record<string, unknown>[] = []
  let totalCount = 0
  let activeCount = 0
  let completedCount = 0
  let missingCardCount = 0
  let filterValueOptions: Record<string, ColumnValueOption[]> = {}
  let canSoftDelete = false
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
    const hasStatusColumn = columnNames.has('durumu')
    const hasCardColumn = columnNames.has('kartno')
    canSoftDelete = hasStatusColumn

    const filterColumnMap = Object.fromEntries(tableColumns.map((column) => [column.column_name, `t.${quoteIdentifier(column.column_name)}`]))
    filterColumnMap.dosyano = 'd.dosyano'
    filterColumnMap.inceleme_puani = 'd.inceleme_puani'
    filterColumnMap.dosya_durumu = 'd.durumu'
    filterColumnMap.mahalle = 'd.mahalleadi'
    filterColumnMap.dosya_adresi = 'd.adres'
    // Kullanici istegi/hata raporu: "bazı başlıklarda filtreleme ve sıralama
    // yapamıyorum" - bu sutunlar da t.* icinde DEGIL (asagidaki dataQuery'de
    // owner_ceptel/sm LATERAL JOIN'lerinden geliyor), eskiden filterColumnMap'e
    // hic eklenmemisti - eslesmeyen alanlar buildMappedFilterCondition
    // tarafindan SESSIZCE yok sayildigi icin (hata vermeden) filtre hicbir
    // sey yapmiyordu.
    filterColumnMap.dosya_telefonu = 'd.telefon'
    filterColumnMap.ceptel = 'owner_ceptel.ceptel'
    filterColumnMap.son_mesaj_tarihi = 'sm.created_at'
    // ONEMLI DUZELTME (hata raporu: "SMS seçip filtrelemek istediğimde liste
    // boş geliyor") - bkz. lib/utils.ts virtualFileColumns'daki AYNI not:
    // filtre, EKRANDA GORULEN (donusturulmus "SMS"/"WhatsApp") degere
    // uygulanmali, ham (kucuk harfli) sm.kanal'a degil.
    filterColumnMap.son_mesaj_kanali = "CASE sm.kanal WHEN 'whatsapp' THEN 'WhatsApp' WHEN 'sms' THEN 'SMS' ELSE sm.kanal END"
    filterColumnMap.son_mesaj_durumu = 'sm.durum'
    filterColumnMap.son_mesaj_alici = 'sm.telefon'
    // Kullanici istegi: Nakit Yardimlari listesinde (Müracaatlar, Yardımlar,
    // İptal Edilenler - bu component Yardımlar/İptal Edilenler'i kapsar),
    // ilgili kisinin Gülkart Listesi'nde (nakitkart tablosu) kayitli bir
    // karti VARSA o da gorunsun. nakitkart.tckimlikno ile yrd_ayninakti'nin
    // KENDI tckimlikno alani eslestirilir (dosya uzerinden DEGIL, dogrudan
    // TC ile - kart HENUZ bir dosyaya baglanmamis olsa bile eslesir).
    filterColumnMap.gulkart = 'gk.kartno'
    // Kullanici istegi: liste sayfalarindaki HER sutun basligina tiklayinca
    // GERCEKTEN siralama yapsin - eskiden bu sorgu "sort"/"dir" parametrelerini
    // hic okumuyordu, her zaman sabit "t.id DESC" donuyordu (baslik aktif
    // gorunse de gercek satir sirasi degismiyordu). filterColumnMap ZATEN
    // guvenli (quoteIdentifier'lanmis) sutun esleme tablosu oldugu icin
    // AYNI harita siralama icin de kullanilir - ham "sort" degeri asla SQL'e
    // dogrudan yazilmaz, sadece bu ONCEDEN TANIMLI haritadan bir deger secer.
    const sortColumnMap: Record<string, string> = {
      ...filterColumnMap,
      dosya_telefonu: 'd.telefon',
      ceptel: 'owner_ceptel.ceptel',
      son_mesaj_tarihi: 'sm.created_at',
      son_mesaj_kanali: 'sm.kanal',
      son_mesaj_durumu: 'sm.durum',
      son_mesaj_alici: 'sm.telefon',
      gulkart: 'gk.kartno',
    }
    const orderByClause = buildMultiColumnOrderBy(parseSortParam((params.sort || '').trim()), sortColumnMap, 't.id DESC')
    const filterCondition = buildMappedFilterCondition(params, filterColumnMap)
    // Türkçe-duyarsız serbest metin araması (büyük/küçük harf + aksan yok sayılır)
    const searchCondition = buildTextSearchClause([...config.searchColumns, 'd.mahalleadi', 'd.adres'], searchTerm)
    // "d." disinda "sm."/"owner_ceptel." kullanan bir filtre de "dosyalar d"
    // JOIN'ini (ikisi de d.id'ye bagli) GEREKTIRIR - bkz. asagidaki
    // countQuery duzeltme notu.
    const countNeedsFileJoin = ['d.', 'sm.', 'owner_ceptel.'].some((prefix) => (
      config.whereClause.includes(prefix) || filterCondition.includes(prefix) || searchCondition.includes(prefix)
    ))
    // Kullanici istegi: "nakit yardımları listesinde bulunan kayıtların
    // müracaatlar, yardımlar ve iptal edilenler listesinde ilgili kaydın
    // gülkart listesinde kartı var ise o da listede görünsün" - SADECE
    // Nakit Yardımı tablosu (yrd_ayninakti) icin gecerli, diger yardim
    // turlerinde (Ekmek, Gıda Bankası vb.) Gülkart kavrami yok. Bu JOIN
    // "dosyalar d"ye BAGIMLI DEGIL (t.tckimlikno uzerinden dogrudan
    // eslesir), bu yuzden countNeedsFileJoin'den AYRI kendi bayragiyla
    // yonetilir.
    const needsGulkartJoin = config.tableName === 'yrd_ayninakti'
    const gulkartJoinNeededInCount = needsGulkartJoin && (
      config.whereClause.includes('gk.') || filterCondition.includes('gk.') || searchCondition.includes('gk.')
    )
    // Kullanici istegi: Yardimlar alanindaki TUM liste sayfalarinda, o
    // dosyaya en son gonderilen mesajin tarihi/durumu/alicisi/kanali da
    // gorunsun ("kime gonderdik, kim okudu, ne zaman"). sms_gonderim_log
    // kaydi belirli bir yardim kaydina degil DOSYAYA baglidir (dosyaid) - bu
    // yuzden o dosya icin en SON (created_at DESC) mesaj kaydi LATERAL JOIN
    // ile alinir. Once SADECE Nakit Yardimlari sayfasina ozeldi, artik TUM
    // yardim turlerinde (Ekmek, Gıda Bankası, Giyim, Hazır Yemek, Nakit,
    // Dönem Dışı Gıda, Destek Paketi) aktif. ONCEDEN SADECE WhatsApp
    // (kanal='whatsapp') gosteriliyordu - kullanici artik SMS de
    // gonderebildigi icin kanal filtresi kaldirildi, hangi kanaldan (SMS ya
    // da WhatsApp) olursa olsun O DOSYAYA en son gonderilen mesaj gosterilir;
    // hangisinden gittigini ayirt etmek icin bir "kanal" sutunu da eklendi.
    const needsMessageLogJoin = true

    // ONEMLI DUZELTME (hata raporu: "SMS seçip filtrelemek istediğimde sayfa
    // boş gelir"): "Son Mesaj *"/"Cep Telefonu" sutunlarina gore
    // filtrelendiginde filterCondition icine "sm.kanal"/"owner_ceptel.ceptel"
    // gibi kosullar giriyor, ama countQuery bu LATERAL JOIN'leri hic
    // icermiyordu - bu da "missing FROM-clause entry" SQL hatasina yol acip
    // TUM sorguyu basarisiz kiliyordu. countQuery de dataQuery ile AYNI
    // JOIN'leri icermeli (owner_ceptel dataQuery'de zaten KOSULSUZ, sm ise
    // needsMessageLogJoin=true oldugu icin burada da hep eklenir).
    // Kullanici istegi: "yardım kişi sayısı, miktar gibi bazı alanların
    // toplamlarını altta gösterelim" - AYNI countQuery'ye eklenir (ekstra
    // bir sorgu GEREKMEZ), TUM FILTRELENMIS veri kumesi (sadece ekrandaki
    // sayfa DEGIL) uzerinden hesaplanir. "miktar"/"yardimkisisayisi"
    // kolonlari HER tabloda olmayabilir - SADECE gercekten var olan
    // kolonlar icin SUM eklenir.
    const hasAmountColumn = columnNames.has('miktar')
    const hasPersonCountColumn = columnNames.has('yardimkisisayisi')

    const countQuery = `
      SELECT
        COUNT(*)::int as total,
        ${showSummary && hasStatusColumn ? 'COUNT(*) FILTER (WHERE t.durumu = 1)::int' : '0'} as active_count,
        ${showSummary && hasStatusColumn ? 'COUNT(*) FILTER (WHERE t.durumu = 2)::int' : '0'} as completed_count,
        ${showSummary && hasCardColumn ? "COUNT(*) FILTER (WHERE NULLIF(t.kartno, '') IS NULL)::int" : '0'} as missing_card_count,
        ${hasAmountColumn ? 'COALESCE(SUM(t.miktar), 0)::float8' : '0'} as total_amount,
        ${hasPersonCountColumn ? 'COALESCE(SUM(t.yardimkisisayisi), 0)::float8' : '0'} as total_person_count
      FROM ${config.tableName} t
      ${countNeedsFileJoin ? 'LEFT JOIN dosyalar d ON t.dosyaid = d.id' : ''}
      ${countNeedsFileJoin ? `
      LEFT JOIN LATERAL (
        SELECT NULLIF(BTRIM(b.ceptel), '') AS ceptel
        FROM bireyler b
        WHERE b.dosyaid = d.id
        ORDER BY
          CASE
            WHEN b.tipi = 1 THEN 0
            WHEN b.yakinligi = 0 THEN 1
            ELSE 2
          END,
          b.id ASC
        LIMIT 1
      ) owner_ceptel ON TRUE
      ` : ''}
      ${countNeedsFileJoin && needsMessageLogJoin ? `
      LEFT JOIN LATERAL (
        SELECT durum, telefon, adisoyadi, created_at, kanal
        FROM sms_gonderim_log
        WHERE dosyaid = d.id::text
        ORDER BY created_at DESC NULLS LAST
        LIMIT 1
      ) sm ON TRUE
      ` : ''}
      ${gulkartJoinNeededInCount ? `
      LEFT JOIN LATERAL (
        SELECT nk.kartno
        FROM nakitkart nk
        WHERE nk.tckimlikno = t.tckimlikno
        ORDER BY nk.id DESC
        LIMIT 1
      ) gk ON TRUE
      ` : ''}
      WHERE ${config.whereClause} ${filterCondition} ${searchCondition}
    `
    // Kullanici istegi: Gıda Bankası/Destek Paketi listesinden TOPLU WhatsApp
    // gonderirken "(abaşlangıç)/(abitiş)" kisayollarinin dönemin TAMAMI
    // (bastarih/bittarih) degil, kisinin MAHALLESINE atanmis "Ödeme Günü"nden
    // hesaplanan GERCEK alisveris penceresini tasimasi icin, mahallenin
    // odeme_gunu/odeme_gunu_bitis alanlari da (SADECE bu iki tabloda) ayrica
    // secilir - GERCEK tarih hesaplamasi asagida JS tarafinda
    // computeNeighborhoodPaymentWindow ile yapilir (bkz.
    // lib/utils/paymentWindow.ts - app/api/documents/fetch/route.ts'teki AYNI
    // algoritmanin SQL yerine JS uygulamasi).
    const needsPaymentWindowJoin = config.tableName === 'yrd_gidabankasi' || config.tableName === 'yrd_destekpaketi'
    // Kullanici istegi: son mesaj tarihi/durumu sutunlari listenin
    // EN SONUNDA gorunsun - varsayilan sutun sirasi (preferredColumnOrder
    // verilmediginde) SQL SELECT sirasini takip ettigi icin (bkz.
    // AdvancedTable.tsx "allKeys = Object.keys(data[0])"), bu sutunlar
    // BILEREK "t.*"DAN SONRA secilir.
    const dataQuery = `
      SELECT
        d.dosyano,
        d.inceleme_puani,
        d.mahalleadi AS mahalle,
        d.adres AS dosya_adresi,
        d.telefon AS dosya_telefonu,
        owner_ceptel.ceptel AS ceptel,
        d.durumu AS dosya_durumu,
        ${needsPaymentWindowJoin ? `
        mh.mahalle_odeme_gunu,
        mh.mahalle_odeme_gunu_bitis,
        ` : ''}
        t.*
        ${needsMessageLogJoin ? `,
        sm.created_at AS son_mesaj_tarihi,
        CASE sm.kanal WHEN 'whatsapp' THEN 'WhatsApp' WHEN 'sms' THEN 'SMS' ELSE sm.kanal END AS son_mesaj_kanali,
        sm.durum AS son_mesaj_durumu,
        NULLIF(TRIM(CONCAT_WS(' - ', NULLIF(TRIM(sm.adisoyadi), ''), NULLIF(TRIM(sm.telefon), ''))), '') AS son_mesaj_alici
        ` : ''}
        ${needsGulkartJoin ? ', gk.kartno AS gulkart' : ''}
      FROM ${config.tableName} t
      LEFT JOIN dosyalar d ON t.dosyaid = d.id
      -- Kullanici istegi: Yardimlar alanindaki tum raporlar sayfalarinda
      -- dosyanin CEP telefonu (bireyler.ceptel - d.telefon "dosya
      -- telefonu"ndan AYRI) da gorunsun. Dosya sahibinin bireyler kaydi
      -- ayni oncelik sirasiyla (once tipi=1 "basvuru sahibi", sonra
      -- yakinligi=0 "hane reisi") secilir - lib/documents/documentsListQuery.ts
      -- ile AYNI mantik.
      LEFT JOIN LATERAL (
        SELECT NULLIF(BTRIM(b.ceptel), '') AS ceptel
        FROM bireyler b
        WHERE b.dosyaid = d.id
        ORDER BY
          CASE
            WHEN b.tipi = 1 THEN 0
            WHEN b.yakinligi = 0 THEN 1
            ELSE 2
          END,
          b.id ASC
        LIMIT 1
      ) owner_ceptel ON TRUE
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
      ${needsPaymentWindowJoin ? `
      LEFT JOIN LATERAL (
        SELECT m.odemegunu AS mahalle_odeme_gunu, m.odemegunubitis AS mahalle_odeme_gunu_bitis
        FROM mahalleler m
        WHERE m.id = d.mahalleid OR lower(trim(m.mahalleadi)) = lower(trim(d.mahalleadi))
        ORDER BY CASE WHEN m.id = d.mahalleid THEN 0 ELSE 1 END
        LIMIT 1
      ) mh ON TRUE
      ` : ''}
      WHERE ${config.whereClause} ${filterCondition} ${searchCondition}
      ORDER BY ${orderByClause} LIMIT ${pageSize} OFFSET ${offset}
    `
    const filterOptionsQuery = loadFilterOptions
      ? buildFilterOptionsQuery(
          config.tableName,
          tableColumns,
          config.excludedColumns,
          config.whereClause,
          searchCondition,
          params,
          filterColumnMap,
          needsGulkartJoin,
        )
      : ''

    const [countResult, result, filterValuesResult, cashLabelOptions] = await Promise.all([
      sqlMonitorService.executeQuery(countQuery),
      sqlMonitorService.executeQuery(dataQuery),
      filterOptionsQuery ? sqlMonitorService.executeQuery(filterOptionsQuery) : Promise.resolve(null),
      config.tableName === 'yrd_ayninakti' ? getCashLabelFilterOptions() : Promise.resolve([]),
    ])
    const counts = countResult.rows[0] as {
      total?: unknown
      active_count?: unknown
      completed_count?: unknown
      missing_card_count?: unknown
      total_amount?: unknown
      total_person_count?: unknown
    } | undefined

    totalCount = Number(counts?.total || 0)
    activeCount = Number(counts?.active_count || 0)
    completedCount = Number(counts?.completed_count || 0)
    missingCardCount = Number(counts?.missing_card_count || 0)

    if (hasAmountColumn) columnTotals.miktar = Number(counts?.total_amount || 0)
    if (hasPersonCountColumn) columnTotals.yardimkisisayisi = Number(counts?.total_person_count || 0)

    kayitlar = result.rows as Record<string, unknown>[]

    // Gıda Bankası/Destek Paketi: mahallenin odeme_gunu/odeme_gunu_bitis
    // (yukarida ayrica SELECT edildi) + kaydin donemi (donemint, "YYYYAA"
    // formatinda) kullanilarak GERCEK alisveris penceresi hesaplanir - bkz.
    // lib/utils/paymentWindow.ts (fetch/route.ts'teki SQL CASE ifadesiyle
    // AYNI algoritma). Sonuc "odeme_baslangic"/"odeme_bitis" olarak eklenir -
    // ManagedReportTablePage bu kolon adlarini "(abaşlangıç)/(abitiş)"
    // kisayollari icin ONCELIKLE arar (bkz. buildRecipientTokens).
    if (needsPaymentWindowJoin) {
      kayitlar = kayitlar.map((row) => {
        const donemint = Number(row.donemint)
        if (!Number.isInteger(donemint) || donemint < 100001) return row

        const year = Math.floor(donemint / 100)
        const month = donemint % 100
        if (month < 1 || month > 12) return row

        const startDay = row.mahalle_odeme_gunu === null || row.mahalle_odeme_gunu === undefined ? null : Number(row.mahalle_odeme_gunu)
        const endDay = row.mahalle_odeme_gunu_bitis === null || row.mahalle_odeme_gunu_bitis === undefined ? null : Number(row.mahalle_odeme_gunu_bitis)
        const window = computeNeighborhoodPaymentWindow(startDay, endDay, year, month)

        return { ...row, odeme_baslangic: window.startDate, odeme_bitis: window.endDate }
      })
    }

    if (filterValuesResult) {
      filterValueOptions = mapFilterValueOptions(filterValuesResult.rows as FilterValueRow[], statusMap)
    }

    if (config.tableName === 'yrd_ayninakti') {
      filterValueOptions = applyPredefinedCashLabelOptions(filterValueOptions, cashLabelOptions)
    }
  } catch (error: unknown) {
    errorMessage = error instanceof Error ? error.message : String(error)
  }

  return (
    <div className="dy-yardim-rapor-17 space-y-6">
      {errorMessage && (
        <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm font-bold text-rose-600">
          Veritabanı Hatası: {errorMessage}
          <p className="mt-2 text-[11px] font-medium text-rose-500">
            Not: <span>{config.tableName}</span> tablosu veya beklenen sütunlar veritabanında mevcut olmayabilir.
          </p>
        </div>
      )}

      {false && showSummary && (
      <div className="grid gap-3 md:grid-cols-4 print:hidden">
        <div className="rounded-xl border border-sky-100 bg-white p-4 shadow-sm">
          <p className="text-[11px] font-black uppercase tracking-wide text-sky-700">Listelenen Kayıt</p>
          <p className="mt-2 text-2xl font-black text-slate-950">{totalCount}</p>
        </div>
        <div className="rounded-xl border border-emerald-100 bg-white p-4 shadow-sm">
          <p className="text-[11px] font-black uppercase tracking-wide text-emerald-700">Devam Eden</p>
          <p className="mt-2 text-2xl font-black text-slate-950">{activeCount}</p>
        </div>
        <div className="rounded-xl border border-blue-100 bg-white p-4 shadow-sm">
          <p className="text-[11px] font-black uppercase tracking-wide text-blue-700">Tamamlanan</p>
          <p className="mt-2 text-2xl font-black text-slate-950">{completedCount}</p>
        </div>
        <div className="rounded-xl border border-amber-100 bg-white p-4 shadow-sm">
          <p className="text-[11px] font-black uppercase tracking-wide text-amber-700">Kart No Eksik</p>
          <p className="mt-2 text-2xl font-black text-slate-950">{missingCardCount}</p>
        </div>
      </div>
      )}

      <ManagedReportTablePage
        eyebrow="Yardım Yönetimi"
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
        // "mahalle_odeme_gunu"/"mahalle_odeme_gunu_bitis" sadece "(abaşlangıç)/
        // (abitiş)" kisayollarinin JS tarafinda hesaplanmasi icin secilen,
        // kullaniciya gosterilmesi anlamsiz HAM kolonlardir - her sayfanin
        // kendi config'ine eklemek yerine burada TEK yerden gizlenir.
        excludedColumns={[...config.excludedColumns, 'mahalle_odeme_gunu', 'mahalle_odeme_gunu_bitis']}
        // Kullanici istegi: hicbir sutun artik zorla gorunur/kilitli degil -
        // eskiden bazi sutunlarin "gorunurluk" onay kutusu pasifti, kullanici
        // sayfa tasarimini (sutun ekleme/kaldirma) ozgurce yapamiyordu.
        columnReorderingControls={config.routePath.startsWith('/assistance/nakit')}
        columnLabels={{
          inceleme_puani: 'İnceleme Puanı',
          mahalle: 'Mahalle',
          dosya_adresi: 'Dosya Adresi',
          // Kullanici istegi (2026-09-28): "online işlemlerdeki kaydı nakit
          // yardımları tablosuna taşırken kayıt sırasında alınan adres
          // bilgisinide taşıyalım ve nakit yardımları listesinde bu adres
          // bilgisinide görelim" - bu, "Dosya Adresi"nden (dosyaya bagli,
          // guncel adres) AYRI bir alan: basvuru ANINDA vatandaşın kendi
          // yazdigi adres, dosyaya hic baglanmamis olsa bile hep kalir.
          adres: 'Başvuru Adresi',
          dosya_durumu: 'Dosya Durumu',
          durumu: 'Müracaat Durumu',
          son_mesaj_tarihi: 'Son Mesaj Tarihi',
          son_mesaj_kanali: 'Son Mesaj Kanalı',
          son_mesaj_durumu: 'Son Mesaj Durumu',
          son_mesaj_alici: 'Son Mesaj Alıcısı',
          ceptel: 'Cep Telefonu',
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
          // nakit yardımı listelerinde de okunakli bir baslikla gorunsun.
          yardimkisisayisi: 'Yardım Kişi Sayısı',
          yardimkisitc: 'Yardım Kişileri (TC)',
        }}
        filterValueOptions={filterValueOptions}
        newButtonLabel={config.newButtonLabel}
        exportFilePrefix={config.tableId}
        exportEndpoint={`/api/assistance/list-export?table=${encodeURIComponent(config.tableName)}&scope=${encodeURIComponent(config.whereClause)}`}
        afterHeader={modeTabsConfig ? (
          <AssistanceModeTabs basePath={modeTabsBasePath} {...modeTabsConfig} />
        ) : undefined}
        extraToolbarButtons={config.tableName === 'yrd_ayninakti' ? (
          <>
            <NakitApplicationsSyncButton />
            <NakitPhoneSyncButton />
          </>
        ) : undefined}
        deleteConfig={canSoftDelete ? {
          endpoint: `/api/assistance/records?table=${encodeURIComponent(config.tableName)}&mode=aid`,
          label: 'Seçili Yardımı Sil',
        } : undefined}
        personnelAssignConfig={config.personnelAssignConfig}
        copyConfig={config.copyConfig}
        recordUpdateConfig={config.recordUpdateConfig}
        phoneFieldPriority={config.phoneFieldPriority}
        // Kullanici istegi: Gıda Bankası/Destek Paketi/Nakit Yardımı
        // listelerinde "Filtrelenen Tümünü Seç" ile TÜM sayfalardaki
        // kayitlara (isim, dosya no, IBAN, alışveriş günleri her kişiye
        // kendi bilgisiyle) toplu WhatsApp gönderilebilsin - bkz.
        // app/api/assistance/bulk-whatsapp-recipients/route.ts (tableName
        // oradaki whitelist'le eşleşmeli). "whereClause" gönderilir çünkü
        // Nakit Yardımı AYNI tabloyu Yardımlar/İptal Edilenler sayfaları
        // FARKLI durumu degeriyle kullanir - sunucu bu degeri "t.durumu =
        // <sayı>" kalıbına uyup uymadığını doğruladıktan sonra kullanır.
        bulkWhatsappAllFilteredConfig={
          // Kullanici istegi (Eylul 2026): "Nakit Yardimlari VE diger tum
          // yardim listelerinde filtreledikten sonra Filtrelenen Tumunu Sec ile
          // hepsine SMS/WhatsApp gonderebilelim". Eskiden sadece 3 tablo vardi;
          // artik TUM yrd_* tablolari (endpoint jenerik hale getirildi).
          config.tableName.startsWith('yrd_')
            ? { endpoint: '/api/assistance/bulk-whatsapp-recipients', tableName: config.tableName, whereClause: config.whereClause }
            : undefined
        }
      />
    </div>
  )
}
