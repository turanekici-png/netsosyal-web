import { ManagedReportTablePage } from '@/components/shared/ManagedReportTablePage'
import { AssistanceModeTabs } from '../_components/AssistanceModeTabs'
import { getAssistanceStatusMap } from '@/lib/services/assistanceStatusLabels.service'
import { sqlMonitorService } from '@/lib/services/sqlMonitor.service'
import { buildMappedFilterCondition, buildTextSearchClause } from '@/lib/utils'
import { buildMultiColumnOrderBy, parseSortParam } from '@/lib/sortSpec'

export const dynamic = 'force-dynamic'

type SearchParams = { page?: string; search?: string } & Record<string, string>
type ColumnValueOption = { value: string; label: string; count: number }
type FilterValueRow = { field: string; value: string; label: string; count: number }

const PAGE_SIZE = 100

const FILTER_COLUMN_MAP: Record<string, string> = {
  id: 't.id',
  dosyano: 'd.dosyano',
  inceleme_puani: 'd.inceleme_puani',
  kartno: "COALESCE(NULLIF(t.kartno, ''), NULLIF(d.kartno, ''))",
  muracaateden: 't.muracaateden',
  telefon: 'd.telefon',
  mahalle: 'd.mahalleadi',
  dosya_adresi: 'd.adres',
  muracaattarihi: 't.muracaattarihi',
  bastarih: 't.bastarih',
  bittarih: 't.bittarih',
  miktar: 't.miktar',
  durumu: 't.durumu',
  sureturu: 't.sureturu',
  durakadi: 't.durakadi',
  sorumlu_personel: "COALESCE(NULLIF(k.kullanicitamadi, ''), NULLIF(k.kullaniciadi, ''))",
  aciklama: 't.aciklama',
  karttarih: 't.karttarih',
  kartaciklama: 't.kartaciklama',
  islemtarihi: 't.islemtarihi',
  // Kullanici istegi/hata raporu: "bazı başlıklarda filtreleme ve sıralama
  // yapamıyorum" - bu sutunlar t.* icinde DEGIL (asagidaki dataQuery'de
  // owner_ceptel/sm LATERAL JOIN'lerinden geliyor), eskiden bu haritaya hic
  // eklenmemisti.
  ceptel: 'owner_ceptel.ceptel',
  son_mesaj_tarihi: 'sm.created_at',
  // ONEMLI DUZELTME (hata raporu: "SMS seçip filtrelemek istediğimde liste
  // boş geliyor") - bkz. lib/utils.ts virtualFileColumns'daki AYNI not:
  // filtre, EKRANDA GORULEN (donusturulmus "SMS"/"WhatsApp") degere
  // uygulanmali, ham (kucuk harfli) sm.kanal'a degil.
  son_mesaj_kanali: "CASE sm.kanal WHEN 'whatsapp' THEN 'WhatsApp' WHEN 'sms' THEN 'SMS' ELSE sm.kanal END",
  son_mesaj_durumu: 'sm.durum',
  son_mesaj_alici: 'sm.telefon',
}

const COLUMN_LABELS: Record<string, string> = {
  id: 'Kayıt ID',
  dosyano: 'Dosya No',
  inceleme_puani: 'İnceleme Puanı',
  kartno: 'Kart No',
  muracaateden: 'Müracaat Eden',
  telefon: 'Telefon',
  ceptel: 'Cep Telefonu',
  mahalle: 'Mahalle',
  dosya_adresi: 'Dosya Adresi',
  muracaattarihi: 'Müracaat Tarihi',
  bastarih: 'Başlangıç',
  bittarih: 'Bitiş',
  miktar: 'Miktar',
  durumu: 'Durum',
  sureturu: 'Süre Türü',
  durakadi: 'Durak',
  sorumlu_personel: 'Sorumlu Personel',
  aciklama: 'Açıklama',
  karttarih: 'Kart Tarihi',
  kartaciklama: 'Kart Açıklama',
  islemtarihi: 'Son İşlem',
  son_mesaj_tarihi: 'Son Mesaj Tarihi',
  son_mesaj_kanali: 'Son Mesaj Kanalı',
  son_mesaj_durumu: 'Son Mesaj Durumu',
  son_mesaj_alici: 'Son Mesaj Alıcısı',
}

const PREFERRED_COLUMNS = [
  'dosyano',
  'inceleme_puani',
  'kartno',
  'muracaateden',
  'telefon',
  'ceptel',
  'mahalle',
  'dosya_adresi',
  'bastarih',
  'bittarih',
  'miktar',
  'durumu',
  'sorumlu_personel',
  'durakadi',
  'aciklama',
  'karttarih',
  'kartaciklama',
]

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

export default async function EkmekYardimiPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>
}) {
  const params = await searchParams
  const currentPage = Math.max(1, Number(params.page) || 1)
  const offset = (currentPage - 1) * PAGE_SIZE
  const searchTerm = params.search?.trim() || ''

  let kayitlar: Record<string, unknown>[] = []
  let totalCount = 0
  let activeCount = 0
  let completedCount = 0
  let missingCardCount = 0
  let filterValueOptions: Record<string, ColumnValueOption[]> = {}
  let errorMessage: string | null = null
  let statusMap: Record<string, string> = {}

  try {
    statusMap = await getAssistanceStatusMap()

    const filterCondition = buildMappedFilterCondition(params, FILTER_COLUMN_MAP)
    // Türkçe-duyarsız serbest metin araması (büyük/küçük harf + aksan yok sayılır)
    const searchCondition = buildTextSearchClause(
      ['d.dosyano', 't.muracaateden', 't.aciklama', 't.kartno', 'd.kartno', 'd.telefon', 'd.mahalleadi', 'd.adres', "COALESCE(k.kullanicitamadi, k.kullaniciadi, '')"],
      searchTerm,
    )
    const baseWhere = `t.durumu = 2 ${filterCondition} ${searchCondition}`
    // Kullanici istegi: her sutun basligina tiklayinca GERCEKTEN siralama
    // yapsin - eskiden bu sorgu "sort"/"dir" parametrelerini hic okumuyordu,
    // her zaman sabit "t.id DESC" donuyordu. FILTER_COLUMN_MAP ZATEN guvenli
    // (sabit tanimli) bir sutun esleme tablosu oldugu icin AYNI harita
    // siralama icin de kullanilir - bkz. AssistanceListPage.tsx'teki AYNI
    // desen.
    const sortColumnMap: Record<string, string> = {
      ...FILTER_COLUMN_MAP,
      ceptel: 'owner_ceptel.ceptel',
      son_mesaj_tarihi: 'sm.created_at',
      son_mesaj_kanali: 'sm.kanal',
      son_mesaj_durumu: 'sm.durum',
      son_mesaj_alici: 'sm.telefon',
    }
    // Kullanici istegi: basliga Shift+tiklayarak BIRDEN FAZLA sutuna gore
    // siralanabilsin - "sort" parametresi artik "anahtar:yon,anahtar2:yon2"
    // bicimindeki COKLU siralama tanimini tasir (bkz. lib/sortSpec.ts).
    const orderByClause = buildMultiColumnOrderBy(parseSortParam((params.sort || '').trim()), sortColumnMap, 't.id DESC')

    // ONEMLI DUZELTME (hata raporu: "SMS seçip filtrelemek istediğimde sayfa
    // boş gelir"): "Son Mesaj *"/"Cep Telefonu" sutunlarina gore
    // filtrelendiginde filterCondition icine "sm.kanal"/"owner_ceptel.ceptel"
    // gibi kosullar giriyor, ama countQuery bu LATERAL JOIN'leri hic
    // icermiyordu - bu da "missing FROM-clause entry" SQL hatasina yol acip
    // TUM sorguyu basarisiz kiliyordu. countQuery de dataQuery ile AYNI
    // JOIN'leri icermeli.
    const countQuery = `
      SELECT
        COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE t.durumu = 1)::int AS active_count,
        COUNT(*) FILTER (WHERE t.durumu = 2)::int AS completed_count,
        COUNT(*) FILTER (WHERE COALESCE(NULLIF(t.kartno, ''), NULLIF(d.kartno, '')) IS NULL)::int AS missing_card_count
      FROM yrd_ekmek t
      LEFT JOIN dosyalar d ON t.dosyaid = d.id
      LEFT JOIN kullanicilar k ON k.id::text = t.kullaniciid::text
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
      LEFT JOIN LATERAL (
        SELECT durum, telefon, adisoyadi, created_at, kanal
        FROM sms_gonderim_log
        WHERE dosyaid = d.id::text
        ORDER BY created_at DESC NULLS LAST
        LIMIT 1
      ) sm ON TRUE
      WHERE ${baseWhere}
    `

    // Kullanici istegi: dosya sahibinin CEP telefonu (bireyler.ceptel) VE
    // o dosyaya en son gonderilen mesajin tarihi/durumu/alicisi/kanali da
    // listede gorunsun - AYNI mantik AssistanceListPage.tsx'te (Gıda, Giyim,
    // Hazır Yemek, Destek Paketi, Dönem Dışı Gıda, Nakit) kullanilan ile
    // birebir - Ekmek Yardimi kendi ozel sorgusunu kullandigi icin burada
    // AYRICA uygulanir. ONCEDEN SADECE WhatsApp gosteriliyordu, artik SMS de
    // dahil - hangi kanaldan gittigini ayirt etmek icin bir "kanal" sutunu
    // da eklendi. Bu sutunlar BILEREK "t.*" esdegeri alanlardan SONRA
    // secilir - varsayilan sutun sirasi (PREFERRED_COLUMNS'ta olmayan
    // sutunlar icin) SQL SELECT sirasini takip eder, boylece bu sutunlar
    // listenin EN SONUNDA gorunur.
    const dataQuery = `
      SELECT
        t.id,
        t.dosyaid,
        d.dosyano,
        d.inceleme_puani,
        COALESCE(NULLIF(t.kartno, ''), NULLIF(d.kartno, '')) AS kartno,
        t.muracaateden,
        d.telefon,
        owner_ceptel.ceptel AS ceptel,
        d.mahalleadi AS mahalle,
        d.adres AS dosya_adresi,
        t.muracaattarihi,
        t.bastarih,
        t.bittarih,
        t.miktar,
        t.durumu,
        t.sureturu,
        t.durakadi,
        COALESCE(NULLIF(k.kullanicitamadi, ''), NULLIF(k.kullaniciadi, ''), '-') AS sorumlu_personel,
        t.aciklama,
        t.karttarih,
        t.kartaciklama,
        t.islemtarihi,
        sm.created_at AS son_mesaj_tarihi,
        CASE sm.kanal WHEN 'whatsapp' THEN 'WhatsApp' WHEN 'sms' THEN 'SMS' ELSE sm.kanal END AS son_mesaj_kanali,
        sm.durum AS son_mesaj_durumu,
        NULLIF(TRIM(CONCAT_WS(' - ', NULLIF(TRIM(sm.adisoyadi), ''), NULLIF(TRIM(sm.telefon), ''))), '') AS son_mesaj_alici
      FROM yrd_ekmek t
      LEFT JOIN dosyalar d ON t.dosyaid = d.id
      LEFT JOIN kullanicilar k ON k.id::text = t.kullaniciid::text
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
      LEFT JOIN LATERAL (
        SELECT durum, telefon, adisoyadi, created_at, kanal
        FROM sms_gonderim_log
        WHERE dosyaid = d.id::text
        ORDER BY created_at DESC NULLS LAST
        LIMIT 1
      ) sm ON TRUE
      WHERE ${baseWhere}
      ORDER BY ${orderByClause}
      LIMIT ${PAGE_SIZE} OFFSET ${offset}
    `
    const filterValuesQuery = `
      SELECT field, value, label, count
      FROM (
        SELECT
          field,
          value,
          label,
          COUNT(*)::int AS count,
          ROW_NUMBER() OVER (PARTITION BY field ORDER BY label) AS row_no
        FROM (
          SELECT 'dosyano' AS field, NULLIF(d.dosyano, '')::text AS value, NULLIF(d.dosyano, '')::text AS label
          FROM yrd_ekmek t
          LEFT JOIN dosyalar d ON t.dosyaid = d.id
          LEFT JOIN kullanicilar k ON k.id::text = t.kullaniciid::text
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
          LEFT JOIN LATERAL (
            SELECT durum, telefon, adisoyadi, created_at, kanal
            FROM sms_gonderim_log
            WHERE dosyaid = d.id::text
            ORDER BY created_at DESC NULLS LAST
            LIMIT 1
          ) sm ON TRUE
          WHERE ${baseWhere}

          UNION ALL
          SELECT 'kartno', NULLIF(COALESCE(NULLIF(t.kartno, ''), NULLIF(d.kartno, '')), '')::text, NULLIF(COALESCE(NULLIF(t.kartno, ''), NULLIF(d.kartno, '')), '')::text
          FROM yrd_ekmek t
          LEFT JOIN dosyalar d ON t.dosyaid = d.id
          LEFT JOIN kullanicilar k ON k.id::text = t.kullaniciid::text
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
          LEFT JOIN LATERAL (
            SELECT durum, telefon, adisoyadi, created_at, kanal
            FROM sms_gonderim_log
            WHERE dosyaid = d.id::text
            ORDER BY created_at DESC NULLS LAST
            LIMIT 1
          ) sm ON TRUE
          WHERE ${baseWhere}

          UNION ALL
          SELECT 'muracaateden', NULLIF(t.muracaateden, '')::text, NULLIF(t.muracaateden, '')::text
          FROM yrd_ekmek t
          LEFT JOIN dosyalar d ON t.dosyaid = d.id
          LEFT JOIN kullanicilar k ON k.id::text = t.kullaniciid::text
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
          LEFT JOIN LATERAL (
            SELECT durum, telefon, adisoyadi, created_at, kanal
            FROM sms_gonderim_log
            WHERE dosyaid = d.id::text
            ORDER BY created_at DESC NULLS LAST
            LIMIT 1
          ) sm ON TRUE
          WHERE ${baseWhere}

          UNION ALL
          SELECT 'telefon', NULLIF(d.telefon, '')::text, NULLIF(d.telefon, '')::text
          FROM yrd_ekmek t
          LEFT JOIN dosyalar d ON t.dosyaid = d.id
          LEFT JOIN kullanicilar k ON k.id::text = t.kullaniciid::text
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
          LEFT JOIN LATERAL (
            SELECT durum, telefon, adisoyadi, created_at, kanal
            FROM sms_gonderim_log
            WHERE dosyaid = d.id::text
            ORDER BY created_at DESC NULLS LAST
            LIMIT 1
          ) sm ON TRUE
          WHERE ${baseWhere}

          UNION ALL
          SELECT 'mahalle', NULLIF(d.mahalleadi, '')::text, NULLIF(d.mahalleadi, '')::text
          FROM yrd_ekmek t
          LEFT JOIN dosyalar d ON t.dosyaid = d.id
          LEFT JOIN kullanicilar k ON k.id::text = t.kullaniciid::text
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
          LEFT JOIN LATERAL (
            SELECT durum, telefon, adisoyadi, created_at, kanal
            FROM sms_gonderim_log
            WHERE dosyaid = d.id::text
            ORDER BY created_at DESC NULLS LAST
            LIMIT 1
          ) sm ON TRUE
          WHERE ${baseWhere}

          UNION ALL
          SELECT 'bastarih', t.bastarih::text, TO_CHAR(t.bastarih, 'DD.MM.YYYY')
          FROM yrd_ekmek t
          LEFT JOIN dosyalar d ON t.dosyaid = d.id
          LEFT JOIN kullanicilar k ON k.id::text = t.kullaniciid::text
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
          LEFT JOIN LATERAL (
            SELECT durum, telefon, adisoyadi, created_at, kanal
            FROM sms_gonderim_log
            WHERE dosyaid = d.id::text
            ORDER BY created_at DESC NULLS LAST
            LIMIT 1
          ) sm ON TRUE
          WHERE ${baseWhere}

          UNION ALL
          SELECT 'bittarih', t.bittarih::text, TO_CHAR(t.bittarih, 'DD.MM.YYYY')
          FROM yrd_ekmek t
          LEFT JOIN dosyalar d ON t.dosyaid = d.id
          LEFT JOIN kullanicilar k ON k.id::text = t.kullaniciid::text
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
          LEFT JOIN LATERAL (
            SELECT durum, telefon, adisoyadi, created_at, kanal
            FROM sms_gonderim_log
            WHERE dosyaid = d.id::text
            ORDER BY created_at DESC NULLS LAST
            LIMIT 1
          ) sm ON TRUE
          WHERE ${baseWhere}

          UNION ALL
          SELECT 'miktar', t.miktar::text, t.miktar::text
          FROM yrd_ekmek t
          LEFT JOIN dosyalar d ON t.dosyaid = d.id
          LEFT JOIN kullanicilar k ON k.id::text = t.kullaniciid::text
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
          LEFT JOIN LATERAL (
            SELECT durum, telefon, adisoyadi, created_at, kanal
            FROM sms_gonderim_log
            WHERE dosyaid = d.id::text
            ORDER BY created_at DESC NULLS LAST
            LIMIT 1
          ) sm ON TRUE
          WHERE ${baseWhere}

          UNION ALL
          SELECT 'durumu', t.durumu::text, t.durumu::text
          FROM yrd_ekmek t
          LEFT JOIN dosyalar d ON t.dosyaid = d.id
          LEFT JOIN kullanicilar k ON k.id::text = t.kullaniciid::text
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
          LEFT JOIN LATERAL (
            SELECT durum, telefon, adisoyadi, created_at, kanal
            FROM sms_gonderim_log
            WHERE dosyaid = d.id::text
            ORDER BY created_at DESC NULLS LAST
            LIMIT 1
          ) sm ON TRUE
          WHERE ${baseWhere}

          UNION ALL
          SELECT 'sorumlu_personel', NULLIF(COALESCE(NULLIF(k.kullanicitamadi, ''), NULLIF(k.kullaniciadi, '')), '')::text, NULLIF(COALESCE(NULLIF(k.kullanicitamadi, ''), NULLIF(k.kullaniciadi, '')), '')::text
          FROM yrd_ekmek t
          LEFT JOIN dosyalar d ON t.dosyaid = d.id
          LEFT JOIN kullanicilar k ON k.id::text = t.kullaniciid::text
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
          LEFT JOIN LATERAL (
            SELECT durum, telefon, adisoyadi, created_at, kanal
            FROM sms_gonderim_log
            WHERE dosyaid = d.id::text
            ORDER BY created_at DESC NULLS LAST
            LIMIT 1
          ) sm ON TRUE
          WHERE ${baseWhere}

          UNION ALL
          SELECT 'durakadi', NULLIF(t.durakadi, '')::text, NULLIF(t.durakadi, '')::text
          FROM yrd_ekmek t
          LEFT JOIN dosyalar d ON t.dosyaid = d.id
          LEFT JOIN kullanicilar k ON k.id::text = t.kullaniciid::text
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
          LEFT JOIN LATERAL (
            SELECT durum, telefon, adisoyadi, created_at, kanal
            FROM sms_gonderim_log
            WHERE dosyaid = d.id::text
            ORDER BY created_at DESC NULLS LAST
            LIMIT 1
          ) sm ON TRUE
          WHERE ${baseWhere}
        ) options
        WHERE value IS NOT NULL
          AND value <> ''
        GROUP BY field, value, label
      ) ranked
      WHERE row_no <= 250
      ORDER BY field, label
    `

    const countResult = await sqlMonitorService.executeQuery(countQuery)
    const counts = countResult.rows[0] as {
      total?: unknown
      active_count?: unknown
      completed_count?: unknown
      missing_card_count?: unknown
    } | undefined

    totalCount = Number(counts?.total || 0)
    activeCount = Number(counts?.active_count || 0)
    completedCount = Number(counts?.completed_count || 0)
    missingCardCount = Number(counts?.missing_card_count || 0)

    const result = await sqlMonitorService.executeQuery(dataQuery)
    kayitlar = result.rows as Record<string, unknown>[]

    const filterValuesResult = await sqlMonitorService.executeQuery(filterValuesQuery)
    filterValueOptions = mapFilterValueOptions(filterValuesResult.rows as FilterValueRow[], statusMap)
  } catch (error: unknown) {
    errorMessage = error instanceof Error ? error.message : String(error)
  }

  return (
    <div className="dy-yardim-rapor-17 space-y-6">
      {errorMessage && (
        <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm font-bold text-rose-600">
          Veritabanı Hatası: {errorMessage}
        </div>
      )}

      {false && (
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
        title="Ekmek Yardımı Alanlar Listesi"
        routePath="/assistance/ekmek"
        organizedToolbar
        data={errorMessage ? [] : kayitlar}
        tableId="yrd_ekmek_profesyonel"
        totalCount={totalCount}
        currentPage={currentPage}
        pageSize={PAGE_SIZE}
        searchTerm={searchTerm}
        searchPlaceholder="Dosya no, kart no, müracaat eden, telefon, mahalle, adres, personel veya açıklama ara"
        emptyMessage="Görüntülenecek ekmek yardımı kaydı bulunamadı."
        statusMap={statusMap}
        excludedColumns={['dosyaid', 'id']}
        // Kullanici istegi (2026-09-30, 10. tur): sekmeler artik (Nakit
        // Yardimi ile AYNI yontemle) basligin ALTINDA - eskiden bu sayfayi
        // saran layout.tsx sekmeleri basligin USTUNDE gosteriyordu.
        afterHeader={(
          <AssistanceModeTabs
            basePath="/assistance/ekmek"
            yardimlarLabel="Yardım Alanlar"
            extraTabs={[{ id: 'yardim-almayanlar', label: 'Yardım Almayanlar', href: '/assistance/ekmek/yardim-almayanlar' }]}
          />
        )}
        // Kullanici istegi: sutun basliklarindaki "gorunurluk" onay
        // kutulari bazi sutunlarda pasifti (kullanici bunlari gizleyemiyor/
        // tasarimi ozgurce yapamiyordu) - artik hicbir sutun zorla
        // gorunur/kilitli degil, kullanici HER sutunu gosterip gizleyebilir.
        preferredColumnOrder={PREFERRED_COLUMNS}
        columnLabels={COLUMN_LABELS}
        filterValueOptions={filterValueOptions}
        newButtonLabel="Yeni Ekmek Yardımı"
        exportFilePrefix="ekmek-yardimi"
        deleteConfig={{
          endpoint: '/api/assistance/ekmek',
          label: 'Seçili Yardımı Sil',
        }}
      />
    </div>
  )
}
