import { ManagedReportTablePage } from '@/components/shared/ManagedReportTablePage'
import { AssistanceModeTabs } from '../../_components/AssistanceModeTabs'
import { getAssistanceStatusMap } from '@/lib/services/assistanceStatusLabels.service'
import { sqlMonitorService } from '@/lib/services/sqlMonitor.service'
import { buildMappedFilterCondition, buildTextSearchClause } from '@/lib/utils'

export const dynamic = 'force-dynamic'

// "Yardım Alanlar" (durumu = 2, bkz. ../page.tsx) dışında kalan, ama hâlâ bir
// müracaat aşamasını geçmiş (durumu != 0) tüm kayıtları gösterir: İptal
// Edildi, Yardımı Durduruldu, Durduruldu vb. Bu dosya bilerek ../page.tsx ile
// AYNI sorgu/kolon yapısını birebir tekrar eder (sadece durum filtresi
// farklı) - ekmek modülü ManagedReportTablePage'i özel bir sorguyla kullandığı
// için ortak AssistanceListPage bileşenine taşınamıyor.

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
}

const COLUMN_LABELS: Record<string, string> = {
  id: 'Kayıt ID',
  dosyano: 'Dosya No',
  inceleme_puani: 'İnceleme Puanı',
  kartno: 'Kart No',
  muracaateden: 'Müracaat Eden',
  telefon: 'Telefon',
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
}

const PREFERRED_COLUMNS = [
  'dosyano',
  'inceleme_puani',
  'kartno',
  'muracaateden',
  'telefon',
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

export default async function EkmekYardimiAlmayanlarPage({
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
    const baseWhere = `t.durumu != 0 AND t.durumu != 2 ${filterCondition} ${searchCondition}`

    const countQuery = `
      SELECT
        COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE t.durumu = 1)::int AS active_count,
        COUNT(*) FILTER (WHERE t.durumu = 2)::int AS completed_count,
        COUNT(*) FILTER (WHERE COALESCE(NULLIF(t.kartno, ''), NULLIF(d.kartno, '')) IS NULL)::int AS missing_card_count
      FROM yrd_ekmek t
      LEFT JOIN dosyalar d ON t.dosyaid = d.id
      LEFT JOIN kullanicilar k ON k.id::text = t.kullaniciid::text
      WHERE ${baseWhere}
    `

    const dataQuery = `
      SELECT
        t.id,
        t.dosyaid,
        d.dosyano,
        d.inceleme_puani,
        COALESCE(NULLIF(t.kartno, ''), NULLIF(d.kartno, '')) AS kartno,
        t.muracaateden,
        d.telefon,
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
        t.islemtarihi
      FROM yrd_ekmek t
      LEFT JOIN dosyalar d ON t.dosyaid = d.id
      LEFT JOIN kullanicilar k ON k.id::text = t.kullaniciid::text
      WHERE ${baseWhere}
      ORDER BY t.id DESC
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
          WHERE ${baseWhere}

          UNION ALL
          SELECT 'kartno', NULLIF(COALESCE(NULLIF(t.kartno, ''), NULLIF(d.kartno, '')), '')::text, NULLIF(COALESCE(NULLIF(t.kartno, ''), NULLIF(d.kartno, '')), '')::text
          FROM yrd_ekmek t
          LEFT JOIN dosyalar d ON t.dosyaid = d.id
          LEFT JOIN kullanicilar k ON k.id::text = t.kullaniciid::text
          WHERE ${baseWhere}

          UNION ALL
          SELECT 'muracaateden', NULLIF(t.muracaateden, '')::text, NULLIF(t.muracaateden, '')::text
          FROM yrd_ekmek t
          LEFT JOIN dosyalar d ON t.dosyaid = d.id
          LEFT JOIN kullanicilar k ON k.id::text = t.kullaniciid::text
          WHERE ${baseWhere}

          UNION ALL
          SELECT 'telefon', NULLIF(d.telefon, '')::text, NULLIF(d.telefon, '')::text
          FROM yrd_ekmek t
          LEFT JOIN dosyalar d ON t.dosyaid = d.id
          LEFT JOIN kullanicilar k ON k.id::text = t.kullaniciid::text
          WHERE ${baseWhere}

          UNION ALL
          SELECT 'mahalle', NULLIF(d.mahalleadi, '')::text, NULLIF(d.mahalleadi, '')::text
          FROM yrd_ekmek t
          LEFT JOIN dosyalar d ON t.dosyaid = d.id
          LEFT JOIN kullanicilar k ON k.id::text = t.kullaniciid::text
          WHERE ${baseWhere}

          UNION ALL
          SELECT 'bastarih', t.bastarih::text, TO_CHAR(t.bastarih, 'DD.MM.YYYY')
          FROM yrd_ekmek t
          LEFT JOIN dosyalar d ON t.dosyaid = d.id
          LEFT JOIN kullanicilar k ON k.id::text = t.kullaniciid::text
          WHERE ${baseWhere}

          UNION ALL
          SELECT 'bittarih', t.bittarih::text, TO_CHAR(t.bittarih, 'DD.MM.YYYY')
          FROM yrd_ekmek t
          LEFT JOIN dosyalar d ON t.dosyaid = d.id
          LEFT JOIN kullanicilar k ON k.id::text = t.kullaniciid::text
          WHERE ${baseWhere}

          UNION ALL
          SELECT 'miktar', t.miktar::text, t.miktar::text
          FROM yrd_ekmek t
          LEFT JOIN dosyalar d ON t.dosyaid = d.id
          LEFT JOIN kullanicilar k ON k.id::text = t.kullaniciid::text
          WHERE ${baseWhere}

          UNION ALL
          SELECT 'durumu', t.durumu::text, t.durumu::text
          FROM yrd_ekmek t
          LEFT JOIN dosyalar d ON t.dosyaid = d.id
          LEFT JOIN kullanicilar k ON k.id::text = t.kullaniciid::text
          WHERE ${baseWhere}

          UNION ALL
          SELECT 'sorumlu_personel', NULLIF(COALESCE(NULLIF(k.kullanicitamadi, ''), NULLIF(k.kullaniciadi, '')), '')::text, NULLIF(COALESCE(NULLIF(k.kullanicitamadi, ''), NULLIF(k.kullaniciadi, '')), '')::text
          FROM yrd_ekmek t
          LEFT JOIN dosyalar d ON t.dosyaid = d.id
          LEFT JOIN kullanicilar k ON k.id::text = t.kullaniciid::text
          WHERE ${baseWhere}

          UNION ALL
          SELECT 'durakadi', NULLIF(t.durakadi, '')::text, NULLIF(t.durakadi, '')::text
          FROM yrd_ekmek t
          LEFT JOIN dosyalar d ON t.dosyaid = d.id
          LEFT JOIN kullanicilar k ON k.id::text = t.kullaniciid::text
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
    <div className="space-y-6">
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
        title="Ekmek Yardımı Almayanlar Listesi"
        routePath="/assistance/ekmek/yardim-almayanlar"
        organizedToolbar
        data={errorMessage ? [] : kayitlar}
        tableId="yrd_ekmek_almayanlar"
        totalCount={totalCount}
        currentPage={currentPage}
        pageSize={PAGE_SIZE}
        searchTerm={searchTerm}
        searchPlaceholder="Dosya no, kart no, müracaat eden, telefon, mahalle, adres, personel veya açıklama ara"
        emptyMessage="Görüntülenecek ekmek yardımı kaydı bulunamadı."
        statusMap={statusMap}
        excludedColumns={['dosyaid', 'id']}
        // Kullanici istegi (2026-09-30, 10. tur): sekmeler artik (Nakit
        // Yardimi ile AYNI yontemle) basligin ALTINDA.
        afterHeader={(
          <AssistanceModeTabs
            basePath="/assistance/ekmek"
            yardimlarLabel="Yardım Alanlar"
            extraTabs={[{ id: 'yardim-almayanlar', label: 'Yardım Almayanlar', href: '/assistance/ekmek/yardim-almayanlar' }]}
          />
        )}
        // Kullanici istegi: hicbir sutun artik zorla gorunur/kilitli degil -
        // kullanici HER sutunu gosterip gizleyebilir (sayfa tasarimi
        // ozgurlugu).
        preferredColumnOrder={PREFERRED_COLUMNS}
        columnLabels={COLUMN_LABELS}
        filterValueOptions={filterValueOptions}
        newButtonLabel="Yeni Ekmek Yardımı"
        exportFilePrefix="ekmek-yardimi-almayanlar"
        deleteConfig={{
          endpoint: '/api/assistance/ekmek',
          label: 'Seçili Yardımı Sil',
        }}
      />
    </div>
  )
}
