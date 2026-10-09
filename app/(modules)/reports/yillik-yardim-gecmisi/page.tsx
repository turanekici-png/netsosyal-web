import { ManagedReportTablePage } from '@/components/shared/ManagedReportTablePage'
import { sqlMonitorService } from '@/lib/services/sqlMonitor.service'
import { foldTurkish, prepareSqlSearchTerm, sqlFoldExpr } from '@/lib/utils'

export const dynamic = 'force-dynamic'

type SearchParams = {
  page?: string
  search?: string
  baslangic?: string
  bitis?: string
  donem_filtresi?: string
  f_yardim_turu?: string
  dosya?: string
} & Record<string, string>

type ReportSummary = {
  dosya_sayisi?: unknown
  toplam_miktar?: unknown
  yardim_kaydi_sayisi?: unknown
  toplam_donem_sayisi?: unknown
  tek_donem_dosya_sayisi?: unknown
  coklu_donem_dosya_sayisi?: unknown
  ortalama_yardim_ayi?: unknown
}

type FilePeriodRow = {
  yardim_turu: string
  donem_baslangici: string
  donem_bitisi: string
  ay_sayisi: number
  tutar: unknown
  sira_no: number
  toplam_donem: number
}

type FileYearRow = {
  yardim_turu: string
  yil: number
  ay_sayisi: number
  tutar: unknown
}

type FileTotalRow = {
  yardim_turu: string
  toplam_ay: number
  toplam_tutar: unknown
  ilk_yardim: string
  son_yardim: string
}

function sqlString(value: string) {
  return `'${value.replace(/'/g, "''")}'`
}

function validDate(value: string | undefined, fallback: string) {
  return value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : fallback
}

const monthLabelSql = `CASE EXTRACT(MONTH FROM ay)::int WHEN 1 THEN 'Ocak' WHEN 2 THEN 'Şubat' WHEN 3 THEN 'Mart' WHEN 4 THEN 'Nisan' WHEN 5 THEN 'Mayıs' WHEN 6 THEN 'Haziran' WHEN 7 THEN 'Temmuz' WHEN 8 THEN 'Ağustos' WHEN 9 THEN 'Eylül' WHEN 10 THEN 'Ekim' WHEN 11 THEN 'Kasım' WHEN 12 THEN 'Aralık' END`

// Yardım kaynaklarının TAMAMINI (7 yardım türü) aylık kayıtlara açan ortak
// gövde - hem ana liste sorgusu hem de tek dosya detay paneli AYNI bu
// tanımı kullanır, tutarlılık için tek yerden yönetilir.
function buildRawHistorySql() {
  return `
    SELECT h.dosyaid::bigint AS dosyaid, d.dosyano::text AS dosyano, COALESCE(t.muracaateden, '-')::text AS kisi,
           'Gıda Bankası'::text AS yardim_turu, date_trunc('month', h.islemtarihi::date)::date AS ay,
           COALESCE(h.miktar, 0)::numeric AS miktar
    FROM yrd_gidabankasihrk h LEFT JOIN yrd_gidabankasi t ON t.id = h.yardimid LEFT JOIN dosyalar d ON d.id = h.dosyaid

    UNION ALL
    SELECT h.dosyaid::bigint, d.dosyano::text, COALESCE(t.muracaateden, '-')::text, 'Destek Paketi'::text,
           date_trunc('month', h.islemtarihi::date)::date, COALESCE(h.miktar, 0)::numeric
    FROM yrd_destekpaketihrk h LEFT JOIN yrd_destekpaketi t ON t.id = h.yardimid LEFT JOIN dosyalar d ON d.id = h.dosyaid

    UNION ALL
    SELECT t.dosyaid::bigint, d.dosyano::text, COALESCE(t.muracaateden, '-')::text, 'Ekmek'::text, generated.ay::date,
           COALESCE(t.miktar, 0)::numeric
    FROM yrd_ekmek t LEFT JOIN dosyalar d ON d.id = t.dosyaid
    CROSS JOIN LATERAL generate_series(date_trunc('month', COALESCE(t.bastarih, t.muracaattarihi, CURRENT_DATE)), date_trunc('month', COALESCE(t.bittarih, CASE WHEN t.durumu = 2 THEN CURRENT_DATE ELSE t.durumutarih END, t.bastarih, t.muracaattarihi, CURRENT_DATE)), interval '1 month') generated(ay)
    WHERE t.durumu <> 0

    UNION ALL
    SELECT t.dosyaid::bigint, d.dosyano::text, COALESCE(t.muracaateden, '-')::text, 'Hazır Yemek'::text, generated.ay::date,
           COALESCE(t.miktar, 0)::numeric
    FROM yrd_haziryemek t LEFT JOIN dosyalar d ON d.id = t.dosyaid
    CROSS JOIN LATERAL generate_series(date_trunc('month', COALESCE(t.bastarih, t.muracaattarihi, CURRENT_DATE)), date_trunc('month', COALESCE(t.bittarih, CASE WHEN t.durumu = 2 THEN CURRENT_DATE ELSE t.durumutarih END, t.bastarih, t.muracaattarihi, CURRENT_DATE)), interval '1 month') generated(ay)
    WHERE t.durumu <> 0

    UNION ALL
    SELECT t.dosyaid::bigint, d.dosyano::text, COALESCE(t.muracaateden, '-')::text, 'Giyim'::text,
           date_trunc('month', t.muracaattarihi)::date, COALESCE(t.miktar, 0)::numeric
    FROM yrd_giyim t LEFT JOIN dosyalar d ON d.id = t.dosyaid WHERE t.durumu = 6

    UNION ALL
    SELECT t.dosyaid::bigint, d.dosyano::text, COALESCE(t.muracaateden, '-')::text, 'Dönem Dışı Gıda'::text,
           date_trunc('month', t.muracaattarihi)::date, COALESCE(t.miktar, 0)::numeric
    FROM yrd_ddgidadosyali t LEFT JOIN dosyalar d ON d.id = t.dosyaid WHERE t.durumu = 6

    UNION ALL
    SELECT t.dosyaid::bigint, d.dosyano::text, COALESCE(t.muracaateden, '-')::text, 'Ayni/Nakdi'::text,
           date_trunc('month', t.muracaattarihi)::date, COALESCE(t.miktar, 0)::numeric
    FROM yrd_ayninakti t LEFT JOIN dosyalar d ON d.id = t.dosyaid WHERE t.durumu = 6
  `
}

function createHistoryCte(startDate: string, endDate: string) {
  return `
  WITH raw_history AS (${buildRawHistorySql()}
  ), monthly AS (
    SELECT dosyaid, dosyano, kisi, yardim_turu, ay, MAX(miktar) AS miktar
    FROM raw_history
    WHERE ay IS NOT NULL
      AND ay BETWEEN date_trunc('month', ${sqlString(startDate)}::date)::date AND date_trunc('month', ${sqlString(endDate)}::date)::date
    GROUP BY dosyaid, dosyano, kisi, yardim_turu, ay
  -- ÖNEMLİ: month_order/period_group hesabı SADECE (dosyaid, yardim_turu) ile
  -- bölümlenir, takvim yılı ile DEĞİL - aksi halde Aralık'tan bir sonraki
  -- yılın Ocak'ına KESİNTİSİZ devam eden gerçek bir yardım, yıl sınırında
  -- yapay şekilde "kesilmiş ve yeniden açılmış" gibi görünürdü (canlı veride
  -- doğrulanmış gerçek bir hataydı - bkz. dosya no 00003, Ekmek Yardımı).
  ), ordered_months AS (
    SELECT *, ROW_NUMBER() OVER (PARTITION BY dosyaid, yardim_turu ORDER BY ay) AS month_order
    FROM monthly
  ), period_rows AS (
    SELECT *, ay - (month_order::int * interval '1 month') AS period_group
    FROM ordered_months
  ), true_periods AS (
    SELECT dosyaid, yardim_turu, period_group, MIN(ay)::date AS donem_baslangici, MAX(ay)::date AS donem_bitisi
    FROM period_rows
    GROUP BY dosyaid, yardim_turu, period_group
  ), true_periods_numbered AS (
    SELECT *, ROW_NUMBER() OVER (PARTITION BY dosyaid, yardim_turu ORDER BY donem_baslangici) AS donem_sira_no
    FROM true_periods
  ), periods AS (
    -- Yillik liste satirlarinda gosterim icin: gercek (yil sinirini asabilen)
    -- donemler, o donemin KESISTIGI her yil icin ayri bir satir olarak da
    -- listelenir (bir donem birden fazla yilda gorunebilir - bu dogru ve
    -- beklenen bir davranistir, ör. Kas.2024-Şub.2025 hem 2024 hem 2025
    -- satirinda gorunur).
    SELECT p.dosyaid, p.yardim_turu, y.yil, p.donem_baslangici, p.donem_bitisi, p.donem_sira_no
    FROM true_periods_numbered p
    CROSS JOIN LATERAL generate_series(EXTRACT(YEAR FROM p.donem_baslangici)::int, EXTRACT(YEAR FROM p.donem_bitisi)::int) y(yil)
  ), period_summary AS (
    SELECT dosyaid, yardim_turu, yil, COUNT(*)::int AS yardim_donemi_sayisi,
           string_agg(
             (CASE WHEN donem_sira_no = 1 THEN '' ELSE '↻ ' END) ||
             CASE WHEN donem_baslangici = donem_bitisi THEN to_char(donem_baslangici, 'MM.YYYY')
                  ELSE to_char(donem_baslangici, 'MM.YYYY') || ' - ' || to_char(donem_bitisi, 'MM.YYYY') END,
             ' | ' ORDER BY donem_baslangici
           ) AS yardim_donemleri
    FROM periods GROUP BY dosyaid, yardim_turu, yil
  ), summary_base AS (
    SELECT CONCAT(m.dosyaid, '-', m.yardim_turu, '-', EXTRACT(YEAR FROM m.ay)::int) AS id,
           m.dosyaid, m.dosyano, m.kisi, m.yardim_turu, EXTRACT(YEAR FROM m.ay)::int AS yil,
           COUNT(DISTINCT m.ay)::int AS yardim_verilen_ay_sayisi,
           string_agg(${monthLabelSql}, ', ' ORDER BY m.ay) AS yardim_verilen_aylar,
           MIN(m.ay)::date AS ilk_yardim_ayi, MAX(m.ay)::date AS son_yardim_ayi, SUM(m.miktar)::numeric AS toplam_miktar
    FROM monthly m GROUP BY m.dosyaid, m.dosyano, m.kisi, m.yardim_turu, EXTRACT(YEAR FROM m.ay)
  ), assistance_calendar AS (
    SELECT m.dosyaid, m.yardim_turu, EXTRACT(YEAR FROM m.ay)::int AS yil,
           string_agg(to_char(m.ay, 'MM'), '-' ORDER BY m.ay) AS yardim_takvimi
    FROM monthly m
    GROUP BY m.dosyaid, m.yardim_turu, EXTRACT(YEAR FROM m.ay)
  ), summarized AS (
    SELECT s.*, p.yardim_donemi_sayisi, p.yardim_donemleri, c.yardim_takvimi
    FROM summary_base s
    LEFT JOIN period_summary p ON p.dosyaid = s.dosyaid AND p.yardim_turu = s.yardim_turu AND p.yil = s.yil
    LEFT JOIN assistance_calendar c ON c.dosyaid = s.dosyaid AND c.yardim_turu = s.yardim_turu AND c.yil = s.yil
  )
  `
}

// Tek bir dosyanın TÜM ZAMANLAR (tarih aralığı filtresinden bağımsız)
// geçmişini getirir - "Dosya Geçmişi Detayı" paneli için. Aynı kesintisiz
// dönem tespiti (yıl sınırını doğru işleyen) burada da kullanılır.
async function loadFileHistoryDetail(dosyano: string) {
  const safeDosyano = sqlString(dosyano.trim())
  const cte = `
    WITH target_dosya AS (
      SELECT id, dosyano FROM dosyalar WHERE dosyano::text = ${safeDosyano} LIMIT 1
    ), raw_history AS (${buildRawHistorySql()}
    ), monthly AS (
      SELECT r.dosyaid, r.dosyano, r.kisi, r.yardim_turu, r.ay, MAX(r.miktar) AS miktar
      FROM raw_history r
      JOIN target_dosya td ON td.id = r.dosyaid
      WHERE r.ay IS NOT NULL
      GROUP BY r.dosyaid, r.dosyano, r.kisi, r.yardim_turu, r.ay
    ), ordered_months AS (
      SELECT *, ROW_NUMBER() OVER (PARTITION BY yardim_turu ORDER BY ay) AS month_order
      FROM monthly
    ), period_rows AS (
      SELECT *, ay - (month_order::int * interval '1 month') AS period_group
      FROM ordered_months
    ), periods AS (
      SELECT yardim_turu, period_group, MIN(ay)::date AS donem_baslangici, MAX(ay)::date AS donem_bitisi,
             COUNT(*)::int AS ay_sayisi, SUM(miktar)::numeric AS tutar
      FROM period_rows GROUP BY yardim_turu, period_group
    )
  `

  const [targetResult, periodsResult, yearResult, totalResult] = await Promise.all([
    sqlMonitorService.executeQuery(`WITH target_dosya AS (SELECT id, dosyano FROM dosyalar WHERE dosyano::text = ${safeDosyano} LIMIT 1) SELECT id, dosyano FROM target_dosya;`),
    sqlMonitorService.executeQuery(`${cte}
      SELECT yardim_turu, donem_baslangici, donem_bitisi, ay_sayisi, tutar,
             ROW_NUMBER() OVER (PARTITION BY yardim_turu ORDER BY donem_baslangici)::int AS sira_no,
             COUNT(*) OVER (PARTITION BY yardim_turu)::int AS toplam_donem
      FROM periods ORDER BY yardim_turu, donem_baslangici;`),
    sqlMonitorService.executeQuery(`${cte}
      SELECT yardim_turu, EXTRACT(YEAR FROM ay)::int AS yil, COUNT(*)::int AS ay_sayisi, SUM(miktar)::numeric AS tutar
      FROM monthly GROUP BY yardim_turu, EXTRACT(YEAR FROM ay) ORDER BY yardim_turu, yil;`),
    sqlMonitorService.executeQuery(`${cte}
      SELECT yardim_turu, COUNT(*)::int AS toplam_ay, SUM(miktar)::numeric AS toplam_tutar,
             MIN(ay)::date AS ilk_yardim, MAX(ay)::date AS son_yardim
      FROM monthly GROUP BY yardim_turu ORDER BY yardim_turu;`),
  ])

  const target = targetResult.rows[0] as { id: unknown; dosyano: string } | undefined
  if (!target) return null

  return {
    dosyano: target.dosyano,
    periods: periodsResult.rows as FilePeriodRow[],
    years: yearResult.rows as FileYearRow[],
    totals: totalResult.rows as FileTotalRow[],
  }
}

export default async function AnnualAssistanceHistoryPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const params = await searchParams
  const currentPage = Math.max(1, Number(params.page) || 1)
  const pageSize = 50
  const currentYear = new Date().getFullYear()
  let startDate = validDate(params.baslangic, `${currentYear}-01-01`)
  let endDate = validDate(params.bitis, `${currentYear}-12-31`)
  if (startDate > endDate) [startDate, endDate] = [endDate, startDate]

  const assistanceType = (params.f_yardim_turu || '').trim()
  const multiplePeriodsOnly = params.donem_filtresi === 'coklu'
  const searchTerm = params.search?.trim() || ''
  const conditions = ['1 = 1']
  if (assistanceType) conditions.push(`yardim_turu = ${sqlString(assistanceType)}`)
  if (multiplePeriodsOnly) conditions.push('yardim_donemi_sayisi > 1')
  // Türkçe-duyarsız serbest metin araması (büyük/küçük harf + aksan yok sayılır)
  const foldedTerm = prepareSqlSearchTerm(foldTurkish(searchTerm))
  if (foldedTerm) {
    conditions.push(
      `(${sqlFoldExpr('dosyano')} LIKE '%${foldedTerm}%' OR ${sqlFoldExpr('kisi')} LIKE '%${foldedTerm}%' OR ${sqlFoldExpr('yardim_turu')} LIKE '%${foldedTerm}%')`,
    )
  }
  const whereSql = conditions.join(' AND ')
  const historyCte = createHistoryCte(startDate, endDate)
  const assistanceTypeOptions = ['Gıda Bankası', 'Destek Paketi', 'Ekmek', 'Hazır Yemek', 'Giyim', 'Dönem Dışı Gıda', 'Ayni/Nakdi']
    .map((value) => ({ value, label: value, count: 0 }))

  let records: Record<string, unknown>[] = []
  let totalCount = 0
  let summary: ReportSummary = {}
  let errorMessage = ''
  try {
    const countResult = await sqlMonitorService.executeQuery(`${historyCte} SELECT COUNT(*)::int AS total FROM summarized WHERE ${whereSql};`)
    const dataResult = await sqlMonitorService.executeQuery(`${historyCte} SELECT * FROM summarized WHERE ${whereSql} ORDER BY yil DESC, yardim_verilen_ay_sayisi DESC, dosyano, yardim_turu LIMIT ${pageSize} OFFSET ${(currentPage - 1) * pageSize};`)
    const summaryResult = await sqlMonitorService.executeQuery(`${historyCte}
      SELECT COUNT(DISTINCT dosyaid)::int AS dosya_sayisi, COALESCE(SUM(toplam_miktar), 0)::numeric AS toplam_miktar,
             COUNT(*)::int AS yardim_kaydi_sayisi, COALESCE(SUM(yardim_donemi_sayisi), 0)::int AS toplam_donem_sayisi,
             COUNT(DISTINCT CASE WHEN yardim_donemi_sayisi = 1 THEN dosyaid END)::int AS tek_donem_dosya_sayisi,
             COUNT(DISTINCT CASE WHEN yardim_donemi_sayisi > 1 THEN dosyaid END)::int AS coklu_donem_dosya_sayisi,
             COALESCE(AVG(yardim_verilen_ay_sayisi), 0)::numeric AS ortalama_yardim_ayi
      FROM summarized WHERE ${whereSql};`)
    totalCount = Number((countResult.rows[0] as { total?: unknown } | undefined)?.total || 0)
    records = dataResult.rows as Record<string, unknown>[]
    summary = (summaryResult.rows[0] || {}) as ReportSummary
  } catch (error) {
    errorMessage = error instanceof Error ? error.message : 'Yıllık yardım geçmişi alınamadı.'
  }

  const dosyaQuery = (params.dosya || '').trim()
  let fileDetail: Awaited<ReturnType<typeof loadFileHistoryDetail>> = null
  let fileDetailError = ''
  if (dosyaQuery) {
    try {
      fileDetail = await loadFileHistoryDetail(dosyaQuery)
      if (!fileDetail) fileDetailError = `"${dosyaQuery}" dosya numarasıyla kayıtlı bir dosya bulunamadı.`
    } catch (error) {
      fileDetailError = error instanceof Error ? error.message : 'Dosya geçmişi alınamadı.'
    }
  }

  const number = (value: unknown) => new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 2 }).format(Number(value) || 0)
  const monthTr = (value: string) => {
    const date = new Date(value)
    return date.toLocaleDateString('tr-TR', { month: 'long', year: 'numeric' })
  }

  return <div className="space-y-5">
    <section className="overflow-hidden rounded-2xl border border-sky-200 bg-white shadow-[0_18px_45px_rgba(15,23,42,0.08)]">
      <div className="bg-gradient-to-r from-sky-700 via-cyan-600 to-emerald-600 px-5 py-4 text-white">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-white/15 ring-1 ring-white/30 text-2xl">📅</div>
          <div>
            <p className="text-[11px] font-black uppercase tracking-[0.2em] text-sky-100">Raporlar</p>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-lg font-black leading-tight">Yıllık ve Dönemsel Yardım Geçmişi</h1>
              <span className="rounded-full border border-white/30 bg-white/15 px-3 py-1 text-[11px] font-bold">{startDate} / {endDate}</span>
            </div>
          </div>
        </div>
        <p className="mt-2 text-xs text-sky-50">Dosyaların yardım aldığı ayları, kesintileri ve yeniden başlayan dönemleri karşılaştırın; tek bir dosyanın tüm zamanlar geçmişini ve toplamlarını inceleyin.</p>
      </div>
      <div className="bg-gradient-to-b from-sky-50/60 via-white to-white p-4">
        <form method="get" action="/reports/yillik-yardim-gecmisi" className="flex flex-wrap items-end gap-3">
          <label className="grid min-w-[190px] gap-1 text-xs font-bold uppercase tracking-wide text-slate-600">
            Başlangıç Tarihi
            <input type="date" name="baslangic" defaultValue={startDate} className="h-10 rounded-lg border-2 border-sky-200 bg-white px-3 text-sm font-semibold text-slate-800 outline-none focus:border-sky-500" />
          </label>
          <label className="grid min-w-[190px] gap-1 text-xs font-bold uppercase tracking-wide text-slate-600">
            Bitiş Tarihi
            <input type="date" name="bitis" defaultValue={endDate} className="h-10 rounded-lg border-2 border-sky-200 bg-white px-3 text-sm font-semibold text-slate-800 outline-none focus:border-sky-500" />
          </label>
          <button type="submit" name="donem_filtresi" value="tum" className={`h-10 rounded-lg px-5 text-sm font-bold shadow-sm transition ${multiplePeriodsOnly ? 'border border-slate-300 bg-white text-slate-700 hover:bg-slate-50' : 'bg-sky-600 text-white hover:bg-sky-700'}`}>Tüm Yardımları Göster</button>
          <button type="submit" name="donem_filtresi" value="coklu" className={`h-10 rounded-lg px-5 text-sm font-bold shadow-sm transition ${multiplePeriodsOnly ? 'bg-violet-600 text-white hover:bg-violet-700' : 'border border-violet-300 bg-violet-50 text-violet-700 hover:bg-violet-100'}`}>Farklı Dönemlerde Yardım Alanlar</button>
        </form>
        <p className="mt-3 text-xs font-medium text-slate-500">Farklı dönem filtresi; yardım ayları arasında en az bir boş ay bulunan dosyaları gösterir. Örnek: Ocak–Mart ve Eylül–Kasım. &quot;↻&quot; işareti, o dönemin bir ARA VERMENİN ARDINDAN yeniden açıldığını belirtir.</p>
      </div>
    </section>

    <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-6">
      {[
        ['Yardım Verilen Dosya', number(summary.dosya_sayisi), 'bg-sky-600'],
        ['Toplam Yardım Miktarı', number(summary.toplam_miktar), 'bg-emerald-600'],
        ['Tek Dönem Alan Dosya', number(summary.tek_donem_dosya_sayisi), 'bg-cyan-600'],
        ['Farklı Dönem Alan Dosya', number(summary.coklu_donem_dosya_sayisi), 'bg-violet-600'],
        ['Toplam Yardım Dönemi', number(summary.toplam_donem_sayisi), 'bg-amber-500'],
        ['Ortalama Yardım Ayı', number(summary.ortalama_yardim_ayi), 'bg-rose-500'],
      ].map(([label, value, color]) => <div key={label} className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className={`h-1.5 ${color}`} />
        <div className="p-4"><p className="min-h-8 text-[11px] font-bold uppercase tracking-wide text-slate-500">{label}</p><p className="mt-1 text-2xl font-black text-slate-900">{value}</p></div>
      </div>)}
    </section>

    <section className="overflow-hidden rounded-2xl border border-violet-200 bg-white shadow-sm">
      <div className="flex items-center gap-3 bg-gradient-to-r from-violet-600 to-fuchsia-600 px-5 py-4 text-white">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-white/15 ring-1 ring-white/30 text-2xl">🔍</div>
        <div>
          <p className="text-[11px] font-black uppercase tracking-wide text-white/80">Tek Dosya İncele</p>
          <h2 className="text-lg font-black leading-tight">Dosya Geçmişi Detayı</h2>
        </div>
      </div>
      <div className="space-y-4 bg-gradient-to-b from-violet-50/50 via-white to-white p-5">
        <form method="get" action="/reports/yillik-yardim-gecmisi" className="flex flex-wrap items-end gap-3">
          <label className="grid min-w-[220px] gap-1 text-xs font-bold uppercase tracking-wide text-slate-600">
            Dosya No
            <input type="text" name="dosya" defaultValue={dosyaQuery} placeholder="Örn: 04576" className="h-10 rounded-lg border-2 border-violet-200 bg-white px-3 text-sm font-semibold text-slate-800 outline-none focus:border-violet-500" />
          </label>
          <button type="submit" className="h-10 rounded-lg bg-violet-600 px-5 text-sm font-bold text-white shadow-sm hover:bg-violet-700">Dosyayı İncele</button>
          {dosyaQuery && <a href="/reports/yillik-yardim-gecmisi" className="h-10 rounded-lg border border-slate-200 bg-white px-4 text-sm font-bold leading-10 text-slate-600 hover:bg-slate-50">Kapat</a>}
        </form>
        <p className="text-xs font-semibold text-slate-500">Bir dosya numarası girin; o dosyanın <strong>tüm zamanlar</strong> boyunca (tarih filtresinden bağımsız) her yardım türünde hangi dönemlerde başladığını, hangi dönemlerde yeniden açıldığını ve yıllık/genel toplamlarını görün.</p>

        {fileDetailError && (
          <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-bold text-rose-700">{fileDetailError}</div>
        )}

        {fileDetail && (
          <div className="space-y-5">
            <div className="rounded-lg border-2 border-violet-200 bg-violet-50 px-4 py-3 text-sm font-black text-violet-900">
              Dosya No: {fileDetail.dosyano}
            </div>

            {/* Yardım türü bazlı dönem zaman çizelgesi */}
            <div className="space-y-3">
              <h3 className="text-sm font-black text-slate-900">Yardım Türlerine Göre Dönem Geçmişi</h3>
              {fileDetail.periods.length === 0 && (
                <p className="rounded-lg border border-dashed border-slate-200 bg-slate-50 px-4 py-6 text-center text-xs font-bold text-slate-400">
                  Bu dosya için kayıtlı bir yardım geçmişi bulunamadı.
                </p>
              )}
              {Object.entries(
                fileDetail.periods.reduce((acc, row) => {
                  if (!acc[row.yardim_turu]) acc[row.yardim_turu] = []
                  acc[row.yardim_turu].push(row)
                  return acc
                }, {} as Record<string, FilePeriodRow[]>)
              ).map(([tur, periods]) => (
                <div key={tur} className="overflow-hidden rounded-xl border border-slate-200">
                  <div className="flex items-center justify-between gap-2 border-b border-slate-100 bg-slate-50 px-4 py-2.5">
                    <span className="text-sm font-black text-slate-800">{tur}</span>
                    <span className="rounded-full bg-slate-800 px-2.5 py-1 text-[10px] font-black text-white">{periods.length} dönem</span>
                  </div>
                  <div className="space-y-2 p-4">
                    {periods.map((period) => (
                      <div key={`${period.sira_no}`} className="flex flex-wrap items-center gap-3 rounded-lg border border-slate-100 bg-white px-3 py-2.5">
                        <span className={`rounded-full px-2.5 py-1 text-[10px] font-black ${period.sira_no === 1 ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'}`}>
                          {period.sira_no === 1 ? 'İlk Başlangıç' : `${period.sira_no}. Kez Yeniden Açıldı`}
                        </span>
                        <span className="text-sm font-bold text-slate-700">
                          {monthTr(period.donem_baslangici)}{period.donem_baslangici !== period.donem_bitisi ? ` – ${monthTr(period.donem_bitisi)}` : ''}
                        </span>
                        <span className="text-xs font-semibold text-slate-400">({period.ay_sayisi} ay)</span>
                        {Number(period.tutar) > 0 && (
                          <span className="ml-auto text-sm font-black text-emerald-700">{number(period.tutar)} ₺</span>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>

            {/* Yillik ozet tablosu */}
            {fileDetail.years.length > 0 && (
              <div className="overflow-hidden rounded-xl border border-slate-200">
                <div className="border-b border-slate-100 bg-slate-50 px-4 py-2.5">
                  <span className="text-sm font-black text-slate-800">Yıllık Özet</span>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-slate-50 text-left text-[11px] font-black uppercase text-slate-500">
                        <th className="px-4 py-2">Yardım Türü</th>
                        <th className="px-4 py-2">Yıl</th>
                        <th className="px-4 py-2">Ay Sayısı</th>
                        <th className="px-4 py-2">Tutar</th>
                      </tr>
                    </thead>
                    <tbody>
                      {fileDetail.years.map((row, index) => (
                        <tr key={`${row.yardim_turu}-${row.yil}`} className={index % 2 === 0 ? 'bg-white' : 'bg-slate-50/60'}>
                          <td className="px-4 py-2 font-bold text-slate-700">{row.yardim_turu}</td>
                          <td className="px-4 py-2 font-bold text-slate-700">{row.yil}</td>
                          <td className="px-4 py-2 font-bold text-slate-700">{row.ay_sayisi}</td>
                          <td className="px-4 py-2 font-black text-emerald-700">{number(row.tutar)} ₺</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Genel toplamlar */}
            {fileDetail.totals.length > 0 && (
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {fileDetail.totals.map((row) => (
                  <div key={row.yardim_turu} className="overflow-hidden rounded-xl border border-emerald-200 bg-emerald-50/50">
                    <div className="border-b border-emerald-100 bg-emerald-100/60 px-4 py-2">
                      <span className="text-xs font-black uppercase text-emerald-800">{row.yardim_turu} - Genel Toplam</span>
                    </div>
                    <div className="space-y-1 px-4 py-3 text-xs font-bold text-slate-600">
                      <p>Toplam Ay: <span className="text-slate-900">{row.toplam_ay}</span></p>
                      <p>Toplam Tutar: <span className="text-emerald-700">{number(row.toplam_tutar)} ₺</span></p>
                      <p>İlk Yardım: <span className="text-slate-900">{monthTr(row.ilk_yardim)}</span></p>
                      <p>Son Yardım: <span className="text-slate-900">{monthTr(row.son_yardim)}</span></p>
                    </div>
                  </div>
                ))}
                <div className="overflow-hidden rounded-xl border border-slate-300 bg-slate-900 text-white">
                  <div className="border-b border-white/10 bg-black/20 px-4 py-2">
                    <span className="text-xs font-black uppercase text-white/80">Tüm Yardım Türleri - Genel Toplam</span>
                  </div>
                  <div className="space-y-1 px-4 py-3 text-xs font-bold text-white/90">
                    <p>Toplam Ay: <span className="text-white">{fileDetail.totals.reduce((sum, row) => sum + Number(row.toplam_ay || 0), 0)}</span></p>
                    <p>Toplam Tutar: <span className="text-emerald-300">{number(fileDetail.totals.reduce((sum, row) => sum + Number(row.toplam_tutar || 0), 0))} ₺</span></p>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </section>

    <div className="flex flex-wrap items-center gap-2 rounded-xl border border-sky-200 bg-sky-50 px-4 py-3 text-xs font-semibold text-slate-600">
      <span className="font-black text-sky-800">Yardım Alınan Aylar:</span>
      <span>Aylar tabloda 01-02-05 biçiminde gösterilir. Örnek: Ocak, Şubat ve Mayıs. Dönem sütununda &quot;↻&quot; işareti, o dönemin bir ara vermenin ardından yeniden açıldığını belirtir.</span>
    </div>

    {errorMessage && <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm font-bold text-rose-700">Veritabanı Hatası: {errorMessage}</div>}
    <ManagedReportTablePage eyebrow="Raporlar" title={`${startDate} / ${endDate} Yardım Geçmişi`} routePath="/reports/yillik-yardim-gecmisi"
      data={errorMessage ? [] : records} tableId="annual_assistance_history" totalCount={errorMessage ? 0 : totalCount}
      currentPage={currentPage} pageSize={pageSize} searchTerm={searchTerm} searchPlaceholder="Dosya no, kişi veya yardım türü ara"
      emptyMessage="Seçilen tarih aralığı için yardım geçmişi bulunamadı." extraFilterColumns={['yardim_turu']}
      filterValueOptions={{ yardim_turu: assistanceTypeOptions }}
      requiredVisibleColumns={['dosyano', 'kisi', 'yardim_turu', 'yil', 'yardim_donemi_sayisi', 'yardim_donemleri', 'yardim_takvimi', 'yardim_verilen_ay_sayisi', 'yardim_verilen_aylar']}
      preferredColumnOrder={['dosyano', 'kisi', 'yardim_turu', 'yil', 'yardim_donemi_sayisi', 'yardim_donemleri', 'yardim_takvimi', 'yardim_verilen_ay_sayisi', 'yardim_verilen_aylar', 'ilk_yardim_ayi', 'son_yardim_ayi', 'toplam_miktar']}
      excludedColumns={['id', 'dosyaid']} columnLabels={{ dosyano: 'Dosya No', kisi: 'Kişi', yardim_turu: 'Yardım Türü', yil: 'Yıl', yardim_donemi_sayisi: 'Dönem Sayısı', yardim_donemleri: 'Yardım Dönemleri', yardim_takvimi: 'Yardım Alınan Aylar', yardim_verilen_ay_sayisi: 'Toplam Yardım Ayı', yardim_verilen_aylar: 'Yardım Verilen Aylar', ilk_yardim_ayi: 'İlk Yardım Ayı', son_yardim_ayi: 'Son Yardım Ayı', toplam_miktar: 'Toplam Miktar' }}
      exportFilePrefix={`yardim-gecmisi-${startDate}-${endDate}`} tableKey={`annual-assistance-history-${startDate}-${endDate}`} />
  </div>
}
