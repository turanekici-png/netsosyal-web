import type { Metadata } from 'next'
import Link from 'next/link'
import {
  DEFAULT_ONLINE_APPLICATION_FORMS,
  ONLINE_APPLICATION_FORMS_SETTING_KEY,
  isFormCurrentlyPublished,
  type OnlineApplication,
} from '@/lib/constants/onlineApplicationForms'
import { settingService } from '@/lib/services'
import { sqlMonitorService } from '@/lib/services/sqlMonitor.service'
import { ManagedReportTablePage } from '@/components/shared/ManagedReportTablePage'
import { OnlineApplicationClient } from './OnlineApplicationClient'
import { getSessionUser } from '@/lib/apiAuth'
import { USER_PERMISSIONS_SETTING_KEY, isActionScheduleActive, type UserPermissionsById } from '@/lib/constants/userPermissions'
import { OTOMATIK_RED_STAGE } from '@/lib/services/cashAutoReject.service'
import {
  amountSql,
  buildOnlineApplicationsWhere,
  fullNameSql,
  ibanSql,
  incomeSql,
  neighborhoodSql,
  periodSql,
  phoneSql,
  vehicleModelYearSql,
  vehicleStatusSql,
} from '@/lib/onlineApplications/listQuery'

export const dynamic = 'force-dynamic'

// Kullanici istegi (2026-09-22): "yetkisi olmayan kullanıcı hiçbir işlem
// yapamasın ... sadece arama yapabilsin ve başvuruları görebilsin" - API
// uclarinin KENDISI zaten "online.forms.manage" yetkisini zorunlu kilar
// (asil guvenlik siniri odur, bkz. detail/bulk-update/transfer-to-cash/
// delete route'lari), ama bu tek basina yetersizdi: bu yetkiye sahip
// OLMAYAN bir kullanici bile "Başvuruyu Düzenle"/"Sil"/"Nakite Aktar" gibi
// butonlari EKRANDA GORUYOR, tikladiginda ise sunucu reddediyordu - kafa
// karistirici bir deneyim. Bu fonksiyon, ManagedReportTablePage'e asagida
// hangi islem YAPILANDIRMALARININ (recordUpdateConfig/transferConfig/
// onlineApplicationEditConfig/deleteConfig) hic GONDERILMEYECEGINI belirler -
// yetkisi olmayan bir kullanici icin bu proplar tamamen ATLANIR, boylece
// ilgili butonlar EN BASTAN hic render edilmez (sadece server-side kontrolle
// degil, TUTARLI bir UI deneyimiyle de "hicbir islem yapamasin" saglanir).
async function canManageOnlineApplications(): Promise<boolean> {
  const user = await getSessionUser()
  if (!user) return false

  const permissionsSetting = await settingService.getByKey(USER_PERMISSIONS_SETTING_KEY)
  const permissions = permissionsSetting?.value as UserPermissionsById | undefined
  const permissionConfig = permissions?.[String(user.id)]

  if (!permissionConfig || permissionConfig.isAdmin) return true
  if (permissionConfig.isActive === false) return false

  const actionId = 'online.forms.manage'
  return (permissionConfig.allowedActions || []).includes(actionId)
    && isActionScheduleActive(permissionConfig.actionSchedules?.[actionId])
}

const GENERAL_SETTINGS_KEY = 'general_settings'

type OnlineGeneralSettings = {
  institutionName?: string
  departmentName?: string
  address?: string
  phone1?: string
  phone2?: string
  email?: string
  website?: string
  logoDataUrl?: string
  onlineApplicationInfoText?: string
  onlineApplicationSuccessMessage?: string
  workingHours?: string
}

type OnlinePageProps = {
  searchParams: Promise<{ page?: string; search?: string; form?: string } & Record<string, string>>
}

type ColumnValueOption = { value: string; label: string; count: number }
type FilterValueRow = { field: string; value: string; label: string; count: number }

const PAGE_SIZE = 100

// Sorgu ifadeleri (ad soyad, telefon, İBAN, mahalle ...) ve filtre/arama
// koşulu lib/onlineApplications/listQuery.ts'de - toplu güncelleme ve nakite
// aktarma ile ORTAK (ekranda görünenle işlemin uygulandığı kayıtlar aynı olsun).

const COLUMN_LABELS: Record<string, string> = {
  id: 'Kayıt ID',
  basvuru_tarihi: 'Başvuru Tarihi',
  tc: 'TC Kimlik No',
  ad_soyad: 'Ad Soyad',
  dogum_tarihi: 'Doğum Tarihi',
  telefon: 'Telefon',
  aylik_gelir: 'Aylık Gelir',
  arac_durumu: 'Araç Durumu',
  arac_modeli: 'Araç Modeli',
  iban: 'IBAN',
  miktar: 'Miktar',
  yardim_turu: 'Yardım Türü',
  mahalle: 'Mahalle',
  adres: 'Adres',
  durum: 'Durum',
  donem: 'Dönem',
  etiket: 'Etiket',
  asama: 'Aşama',
  aciklama: 'Açıklama',
  basvuru_yili: 'Başvuru Yılı',
  donem_grubu: 'Dönem Grubu',
  ek_cevaplar: 'Ek Cevaplar',
}

const PREFERRED_COLUMNS = [
  'basvuru_tarihi',
  'tc',
  'ad_soyad',
  'telefon',
  'iban',
  'aylik_gelir',
  'arac_durumu',
  'arac_modeli',
  'yardim_turu',
  'miktar',
  'donem',
  'etiket',
  'asama',
  'mahalle',
  'ek_cevaplar',
]

// Formda sorulan ama tabloda kendi sütunu OLMAYAN sorular (yönetici Ayarlar >
// Online Başvuru Formları'ndan yeni alan eklediğinde) eskiden hiçbir yerde
// görünmüyordu. Bu anahtarlar zaten kendi sütunlarında/sistem alanı olarak
// gösteriliyor; geri kalan cevaplar "Ek Cevaplar" sütununda, form alanının
// ETİKETİYLE gösterilir.
const STANDARD_ANSWER_KEYS = new Set([
  'tc', 'fullName', 'birthDate', 'address', 'addressNo', 'adresNo', 'adresno', 'formId', 'formTitle',
  'autoEvaluation', 'phone', 'telefon', 'iban', 'income', 'vehicleStatus', 'vehicleModelYear',
  'amount', 'miktar', 'assistanceAmount', 'yardimMiktari', 'yardim_miktari', 'period', 'donem',
  'label', 'etiket', 'stage', 'asama', 'propertyInfo', 'property', 'mulkiyet', 'mulkiyetBilgisi',
  'f_tc', 'f_name', 'f_phone', 'f_income', 'f_address', 'f_addressNo', 'f_adresNo', 'f_birthDate', 'f_amount',
  'f_1783585922150', 'f_1783665438908', 'f_1783668607481',
])

function buildExtraAnswersText(answers: unknown, fieldLabels: Map<string, string>): string {
  if (!answers || typeof answers !== 'object' || Array.isArray(answers)) return ''
  return Object.entries(answers as Record<string, unknown>)
    .filter(([key, value]) => !STANDARD_ANSWER_KEYS.has(key) && typeof value === 'string' && value.trim() !== '')
    .map(([key, value]) => `${fieldLabels.get(key) || key}: ${String(value).trim()}`)
    .join(' · ')
}

async function getOnlineForms() {
  try {
    const setting = await settingService.getByKey(ONLINE_APPLICATION_FORMS_SETTING_KEY)
    return Array.isArray(setting?.value)
      ? setting.value as OnlineApplication[]
      : DEFAULT_ONLINE_APPLICATION_FORMS
  } catch {
    return DEFAULT_ONLINE_APPLICATION_FORMS
  }
}

async function getGeneralSettings(): Promise<OnlineGeneralSettings> {
  try {
    const setting = await settingService.getByKey(GENERAL_SETTINGS_KEY)
    return setting?.value && typeof setting.value === 'object'
      ? setting.value as OnlineGeneralSettings
      : {}
  } catch {
    return {}
  }
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

// Türkiye saatine göre YYYY-MM-DD (sunucu saat dilimi Türkiye).
function localDateString(date: Date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

// Vatandasa acik basvuru formu icin ("?form=...") sekme/pencere basligini
// o formun basligina gore ozellestirir; ic yonetim listesinde (parametresiz)
// genel uygulama basligi korunur.
export async function generateMetadata({ searchParams }: OnlinePageProps): Promise<Metadata> {
  const params = await searchParams
  if (!params.form) return {}

  const forms = await getOnlineForms()
  const selectedForm = forms.find((form) => form.id === params.form)
  return selectedForm ? { title: selectedForm.title } : {}
}

export default async function OnlineApplicationPage({ searchParams }: OnlinePageProps) {
  const params = await searchParams
  const { form: requestedFormId } = params
  const forms = await getOnlineForms()
  const generalSettings = await getGeneralSettings()
  // Kullanici istegi (2026-09-22): "o tarih ve saat geldiğinde yayına
  // girsin ve zamanı dolunca yayından çıksın" - vatandasa gosterilecek
  // "yayinda mi" karari artik ham "active" DEGIL, zamanlamayi da kontrol
  // eden isFormCurrentlyPublished. Dogrudan link (?form=xxx) ile gelen bir
  // form, ID ile YINE bulunur (henuz baslamamis/suresi dolmus olsa bile) -
  // ama "active" alani asagida COMPUTED degerle EZILIR, boylece
  // OnlineApplicationClient'in zaten var olan "Bu başvuru formu yayında
  // değil" kontrolu (selectedForm?.active) DOGRU calisir, o dosyaya
  // DOKUNULMADAN.
  const now = new Date()
  const selectedFormRaw =
    forms.find((form) => form.id === requestedFormId) ??
    forms.find((form) => isFormCurrentlyPublished(form, now)) ??
    forms[0]
  const selectedForm = selectedFormRaw
    ? { ...selectedFormRaw, active: isFormCurrentlyPublished(selectedFormRaw, now) }
    : selectedFormRaw

  if (requestedFormId) {
    return (
      <OnlineApplicationClient
        selectedForm={selectedForm}
        activeForms={forms.filter((form) => isFormCurrentlyPublished(form, now))}
        generalSettings={generalSettings}
      />
    )
  }

  // Kullanici istegi (2026-09-22): "yetkisi olmayan kullanıcı hiçbir işlem
  // yapamasın ... sadece arama yapabilsin ve başvuruları görebilsin" -
  // "online.forms.manage" yetkisi olmayan bir kullanici icin asagidaki 4
  // islem yapilandirmasi (duzenle/toplu guncelle/nakite aktar/sil) hic
  // GONDERILMEZ - ilgili butonlar UI'da hic gorunmez (sadece API'nin
  // reddetmesiyle degil).
  const canManage = await canManageOnlineApplications()

  const currentPage = Math.max(1, Number(params.page) || 1)
  const offset = (currentPage - 1) * PAGE_SIZE
  const searchTerm = params.search?.trim() || ''

  let records: Record<string, unknown>[] = []
  let totalCount = 0
  let filterValueOptions: Record<string, ColumnValueOption[]> = {}
  let errorMessage: string | null = null
  // Kullanici istegi (2026-09-22): dönem seçilince toplam / incelenecek /
  // otomatik red sayıları. 2026-10-14: özet artık HER ZAMAN görünür (dönem
  // seçilmeden de) ve "bugün gelen" sayısını da içerir; sayılar listenin o
  // anki filtre/aramasına göredir. "İncelenecek" = Otomatik Red dışındaki
  // tüm kayıtlar.
  let summary = { toplam: 0, otomatikRed: 0, incelenecek: 0, bugun: 0 }
  let hasExtraAnswers = false

  // Hızlı tarih filtreleri - mevcut sütun filtresi parametrelerini
  // (f_basvuru_tarihi + _op=gte) kullanır; sütun başlığındaki tarih filtresi
  // ile aynı mekanizma.
  const todayValue = localDateString(now)
  const daysAgo = (days: number) => localDateString(new Date(now.getFullYear(), now.getMonth(), now.getDate() - days))
  const dateRanges = [
    { key: 'all', label: 'Tümü', value: '' },
    { key: 'today', label: 'Bugün', value: todayValue },
    { key: '7', label: 'Son 7 gün', value: daysAgo(6) },
    { key: '30', label: 'Son 30 gün', value: daysAgo(29) },
  ]
  const activeDateValue = params.f_basvuru_tarihi_op === 'gte' ? params.f_basvuru_tarihi || '' : (params.f_basvuru_tarihi ? '__other' : '')
  const buildDateHref = (value: string) => {
    const next = new URLSearchParams()
    Object.entries(params).forEach(([key, val]) => {
      if (!val || key === 'page' || key === 'f_basvuru_tarihi' || key === 'f_basvuru_tarihi_op' || key === 'f_basvuru_tarihi_v2') return
      next.set(key, String(val))
    })
    if (value) {
      next.set('f_basvuru_tarihi', value)
      next.set('f_basvuru_tarihi_op', 'gte')
    }
    const query = next.toString()
    return query ? `/online?${query}` : '/online'
  }

  try {
    const whereClause = buildOnlineApplicationsWhere(params)

    const countResult = await sqlMonitorService.executeQuery(`
      SELECT
        COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE t.asama = '${OTOMATIK_RED_STAGE}')::int AS otomatik_red,
        COUNT(*) FILTER (
          WHERE ((t.created_at AT TIME ZONE 'UTC') AT TIME ZONE 'Europe/Istanbul')::date
            = (NOW() AT TIME ZONE 'Europe/Istanbul')::date
        )::int AS bugun
      FROM online_basvurular t
      WHERE ${whereClause}
    `)
    totalCount = Number(countResult.rows[0]?.total || 0)
    const otomatikRed = Number(countResult.rows[0]?.otomatik_red || 0)
    summary = {
      toplam: totalCount,
      otomatikRed,
      incelenecek: totalCount - otomatikRed,
      bugun: Number(countResult.rows[0]?.bugun || 0),
    }

    const dataResult = await sqlMonitorService.executeQuery(`
      SELECT
        t.id,
        t.created_at AS basvuru_tarihi,
        t.tckimlikno AS tc,
        ${fullNameSql} AS ad_soyad,
        t.dogumtarihi AS dogum_tarihi,
        ${phoneSql} AS telefon,
        ${ibanSql} AS iban,
        ${incomeSql} AS aylik_gelir,
        ${vehicleStatusSql} AS arac_durumu,
        ${vehicleModelYearSql} AS arac_modeli,
        ${amountSql} AS miktar,
        t.yardim_turu,
        ${neighborhoodSql} AS mahalle,
        t.adres,
        t.status AS durum,
        ${periodSql} AS donem,
        t.etiket,
        t.asama,
        t.aciklama,
        t.basvuru_yili,
        t.donem_grubu,
        t.answers AS _answers
      FROM online_basvurular t
      WHERE ${whereClause}
      ORDER BY t.created_at DESC NULLS LAST, t.id DESC
      LIMIT ${PAGE_SIZE} OFFSET ${offset}
    `)

    const forms = await getOnlineForms()
    const fieldLabels = new Map<string, string>()
    forms.forEach((form) => form.fields.forEach((field) => {
      if (!fieldLabels.has(field.id)) fieldLabels.set(field.id, field.label)
    }))
    records = dataResult.rows.map((row: Record<string, unknown>) => {
      const { _answers, ...rest } = row
      const ekCevaplar = buildExtraAnswersText(_answers, fieldLabels)
      if (ekCevaplar) hasExtraAnswers = true
      return { ...rest, ek_cevaplar: ekCevaplar }
    })

    const filterValuesResult = await sqlMonitorService.executeQuery(`
      SELECT field, value, label, COUNT(*)::int AS count
      FROM (
        SELECT 'yardim_turu' AS field, NULLIF(t.yardim_turu, '')::text AS value, NULLIF(t.yardim_turu, '')::text AS label FROM online_basvurular t WHERE ${whereClause}
        UNION ALL
        SELECT 'donem', ${periodSql}::text, ${periodSql}::text FROM online_basvurular t WHERE ${whereClause}
        UNION ALL
        SELECT 'etiket', NULLIF(t.etiket, '')::text, NULLIF(t.etiket, '')::text FROM online_basvurular t WHERE ${whereClause}
        UNION ALL
        SELECT 'asama', NULLIF(t.asama, '')::text, NULLIF(t.asama, '')::text FROM online_basvurular t WHERE ${whereClause}
        UNION ALL
        SELECT 'arac_durumu', ${vehicleStatusSql}::text, ${vehicleStatusSql}::text FROM online_basvurular t WHERE ${whereClause}
        UNION ALL
        SELECT 'mahalle', ${neighborhoodSql}::text, ${neighborhoodSql}::text FROM online_basvurular t WHERE ${whereClause}
      ) options
      WHERE value IS NOT NULL AND value <> ''
      GROUP BY field, value, label
      ORDER BY field, label
    `)
    filterValueOptions = mapFilterValueOptions(filterValuesResult.rows as FilterValueRow[])
  } catch (error) {
    errorMessage = error instanceof Error ? error.message : String(error)
  }

  const summaryTiles = [
    { label: 'Toplam Başvuru', value: summary.toplam, accent: 'bg-[#1E2A38]', valueClass: 'text-[#1E2A38]' },
    { label: 'İncelenecek', value: summary.incelenecek, accent: 'bg-emerald-500', valueClass: 'text-emerald-700' },
    { label: 'Otomatik Red', value: summary.otomatikRed, accent: 'bg-rose-500', valueClass: 'text-rose-700' },
    { label: 'Bugün Gelen', value: summary.bugun, accent: 'bg-[#0E7C86]', valueClass: 'text-[#0A5F67]' },
  ]

  return (
    <div className="space-y-5">
      {errorMessage && (
        <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm font-bold text-rose-600">
          Veritabanı Hatası: {errorMessage}
        </div>
      )}

      {/* 2026-10-14: kurumsal özet paneli (Ayarlar > Online Başvuru Formları
          ile aynı dil: altın sol çizgi, lacivert/teal vurgular). */}
      <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-col gap-4 border-l-4 border-[#b8860b] px-5 py-4 xl:flex-row xl:items-center xl:justify-between">
          <div className="min-w-0">
            <p className="text-[13px] font-bold uppercase tracking-[0.12em] text-[#0E7C86]">Başvuru Özeti</p>
            <h2 className="mt-0.5 text-[20px] font-bold text-[#1E2A38]">{params.f_donem || 'Tüm Dönemler'}</h2>
            <p className="mt-0.5 text-[14px] font-medium text-slate-500">Sayılar, listede uygulanan filtre ve aramaya göre hesaplanır.</p>
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {summaryTiles.map((tile) => (
              <div key={tile.label} className="min-w-[150px] rounded-lg border border-slate-200 bg-[#f6f8fb] px-4 py-3">
                <div className="flex items-center gap-2">
                  <span className={`h-2.5 w-2.5 rounded-full ${tile.accent}`} />
                  <p className="text-[13px] font-bold uppercase tracking-wide text-slate-500">{tile.label}</p>
                </div>
                <p className={`mt-1 text-[28px] font-bold leading-tight ${tile.valueClass}`}>{tile.value.toLocaleString('tr-TR')}</p>
              </div>
            ))}
          </div>
        </div>
        <div className="flex flex-col gap-3 border-t border-slate-200 bg-[#f6f8fb] px-5 py-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[14px] font-bold text-[#1E2A38]">Başvuru tarihi:</span>
            {dateRanges.map((range) => {
              const isActive = range.value === activeDateValue
              return (
                <Link
                  key={range.key}
                  href={buildDateHref(range.value)}
                  className={`rounded-full border px-3.5 py-1.5 text-[14px] font-bold transition ${isActive ? 'border-[#0E7C86] bg-[#0E7C86] text-white' : 'border-slate-300 bg-white text-[#1E2A38] hover:border-[#0E7C86] hover:text-[#0A5F67]'}`}
                >
                  {range.label}
                </Link>
              )
            })}
          </div>
          <p className="text-[13px] font-medium text-slate-500">
            Nakit müracaata aktarılan başvurular bu listeden kalkar; <span className="font-bold text-slate-600">Nakit Yardımı › Müracaatlar</span> ekranında görünür.
          </p>
        </div>
      </section>

      <ManagedReportTablePage
        eyebrow="Online Başvurular"
        title="Vatandaş Başvuru Listesi"
        routePath="/online"
        data={errorMessage ? [] : records}
        tableId="online_basvurular"
        totalCount={totalCount}
        currentPage={currentPage}
        pageSize={PAGE_SIZE}
        searchTerm={searchTerm}
        searchPlaceholder="TC, ad soyad, telefon, İBAN, mahalle, adres veya açıklama ara"
        emptyMessage="Listelenecek online başvuru bulunamadı."
        organizedToolbar
        excludedColumns={hasExtraAnswers ? ['id', 'durum', 'basvuru_yili', 'donem_grubu'] : ['id', 'durum', 'basvuru_yili', 'donem_grubu', 'ek_cevaplar']}
        requiredVisibleColumns={['basvuru_tarihi', 'tc', 'ad_soyad', 'iban', 'aylik_gelir', 'arac_durumu', 'arac_modeli', 'miktar']}
        preferredColumnOrder={PREFERRED_COLUMNS}
        columnLabels={COLUMN_LABELS}
        filterValueOptions={filterValueOptions}
        quickFilterConfig={{ fieldKey: 'donem', label: 'Yardım Dönemi', placeholder: 'Tüm Dönemler' }}
        recordUpdateConfig={canManage ? {
          endpoint: '/api/online-applications/bulk-update',
          label: 'Dönem, etiket, aşama ve miktar bilgilerini güncelle',
          fields: ['donem', 'etiket', 'asama', 'miktar'],
        } : undefined}
        transferConfig={canManage ? {
          endpoint: '/api/online-applications/transfer-to-cash',
          label: 'Nakit Müracaata Aktar',
          filteredLabel: 'Filtrelenenleri Nakit Müracaata Aktar',
        } : undefined}
        onlineApplicationEditConfig={canManage ? {
          endpoint: '/api/online-applications/detail',
          label: 'Başvuruyu Düzenle',
        } : undefined}
        deleteConfig={canManage ? {
          endpoint: '/api/online-applications/delete',
          label: 'Seçilenleri Sil',
          showToolbarButton: true,
        } : undefined}
        exportFilePrefix="online-basvurular"
      />
    </div>
  )
}
