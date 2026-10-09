import type { Metadata } from 'next'
import {
  DEFAULT_ONLINE_APPLICATION_FORMS,
  ONLINE_APPLICATION_FORMS_SETTING_KEY,
  isFormCurrentlyPublished,
  type OnlineApplication,
} from '@/lib/constants/onlineApplicationForms'
import { settingService } from '@/lib/services'
import { sqlMonitorService } from '@/lib/services/sqlMonitor.service'
import { buildMappedFilterCondition, buildTextSearchClause } from '@/lib/utils'
import { ManagedReportTablePage } from '@/components/shared/ManagedReportTablePage'
import { OnlineApplicationClient } from './OnlineApplicationClient'
import { getSessionUser } from '@/lib/apiAuth'
import { USER_PERMISSIONS_SETTING_KEY, isActionScheduleActive, type UserPermissionsById } from '@/lib/constants/userPermissions'
import { OTOMATIK_RED_STAGE } from '@/lib/services/cashAutoReject.service'

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

const fullNameSql = `
  COALESCE(
    NULLIF(BTRIM(CONCAT_WS(' ', NULLIF(t.ad, ''), NULLIF(t.soyad, ''))), ''),
    NULLIF(t.answers->>'fullName', ''),
    NULLIF(t.answers->>'f_name', '')
  )
`

const phoneSql = `COALESCE(NULLIF(t.answers->>'phone', ''), NULLIF(t.answers->>'f_phone', ''), NULLIF(t.answers->>'telefon', ''))`
const incomeSql = `COALESCE(NULLIF(t.answers->>'income', ''), NULLIF(t.answers->>'f_income', ''))`
const vehicleStatusSql = `COALESCE(NULLIF(t.answers->>'vehicleStatus', ''), NULLIF(t.answers->>'f_1783585922150', ''))`
const vehicleModelYearSql = `COALESCE(NULLIF(t.answers->>'vehicleModelYear', ''), NULLIF(t.answers->>'f_1783665438908', ''))`
const ibanSql = `COALESCE(NULLIF(t.answers->>'iban', ''), NULLIF(t.answers->>'f_1783668607481', ''))`
const periodSql = `COALESCE(NULLIF(t.donem, ''), NULLIF(t.answers->>'period', ''), NULLIF(t.answers->>'donem', ''))`
const amountSql = `COALESCE(NULLIF(t.answers->>'amount', ''), NULLIF(t.answers->>'miktar', ''), NULLIF(t.answers->>'assistanceAmount', ''), NULLIF(t.answers->>'yardimMiktari', ''), NULLIF(t.answers->>'yardim_miktari', ''), NULLIF(t.answers->>'f_amount', ''))`

const FILTER_COLUMN_MAP: Record<string, string> = {
  id: 't.id',
  basvuru_tarihi: 't.created_at',
  tc: 't.tckimlikno',
  ad_soyad: fullNameSql,
  dogum_tarihi: 't.dogumtarihi',
  telefon: phoneSql,
  aylik_gelir: incomeSql,
  arac_durumu: vehicleStatusSql,
  arac_modeli: vehicleModelYearSql,
  iban: ibanSql,
  miktar: amountSql,
  yardim_turu: 't.yardim_turu',
  mahalle: 't.mahalleadi',
  adres: 't.adres',
  durum: 't.status',
  donem: periodSql,
  etiket: 't.etiket',
  asama: 't.asama',
  aciklama: 't.aciklama',
  basvuru_yili: 't.basvuru_yili',
  donem_grubu: 't.donem_grubu',
}

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
]

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
  // Kullanici istegi (2026-09-22): "dönem bilgisi seçtiğimizde o döneme ait
  // toplam başvuru sayısı, incelenecek başvuru sayısı ve otomatik red
  // sayısı görünsün" - SADECE dönem filtresi (f_donem) secili iken
  // hesaplanir/gosterilir. "İncelenecek" = Otomatik Red DISINDAKI tum
  // kayitlar (toplam - otomatik red) - Otomatik Red disinda her kayit
  // (henuz islenmemis/personel tarafindan incelenmis olsun) "otomatik
  // olarak elenmemis" anlaminda "incelenecek/incelenmis" kumesine dahildir.
  let donemStats: { toplam: number; otomatikRed: number; incelenecek: number } | null = null

  try {
    const filterCondition = buildMappedFilterCondition(params, FILTER_COLUMN_MAP)
    // Türkçe-duyarsız serbest metin araması (büyük/küçük harf + aksan yok sayılır)
    const searchCondition = buildTextSearchClause(
      [
        't.tckimlikno', fullNameSql, phoneSql, incomeSql, vehicleStatusSql, vehicleModelYearSql,
        ibanSql, amountSql, 't.yardim_turu', 't.mahalleadi', 't.adres', 't.status', 't.aciklama', 't.answers',
      ],
      searchTerm,
    )
    const whereClause = `1=1 ${filterCondition} ${searchCondition}`

    const countResult = await sqlMonitorService.executeQuery(`
      SELECT COUNT(*)::int AS total
      FROM online_basvurular t
      WHERE ${whereClause}
    `)
    totalCount = Number(countResult.rows[0]?.total || 0)

    if (params.f_donem) {
      const statsResult = await sqlMonitorService.executeQuery(`
        SELECT
          COUNT(*)::int AS toplam,
          COUNT(*) FILTER (WHERE t.asama = '${OTOMATIK_RED_STAGE}')::int AS otomatik_red
        FROM online_basvurular t
        WHERE ${whereClause}
      `)
      const toplam = Number(statsResult.rows[0]?.toplam || 0)
      const otomatikRed = Number(statsResult.rows[0]?.otomatik_red || 0)
      donemStats = { toplam, otomatikRed, incelenecek: toplam - otomatikRed }
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
        t.mahalleadi AS mahalle,
        t.adres,
        t.status AS durum,
        ${periodSql} AS donem,
        t.etiket,
        t.asama,
        t.aciklama,
        t.basvuru_yili,
        t.donem_grubu
      FROM online_basvurular t
      WHERE ${whereClause}
      ORDER BY t.created_at DESC NULLS LAST, t.id DESC
      LIMIT ${PAGE_SIZE} OFFSET ${offset}
    `)
    records = dataResult.rows

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
      ) options
      WHERE value IS NOT NULL AND value <> ''
      GROUP BY field, value, label
      ORDER BY field, label
    `)
    filterValueOptions = mapFilterValueOptions(filterValuesResult.rows as FilterValueRow[])
  } catch (error) {
    errorMessage = error instanceof Error ? error.message : String(error)
  }

  return (
    <div className="space-y-6">
      {errorMessage && (
        <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm font-bold text-rose-600">
          Veritabanı Hatası: {errorMessage}
        </div>
      )}

      {/* Kullanici istegi (2026-09-22): "buradaki yardım kriterleri
          alanını kaldıralım bunun yerine ... aynı dönem bilgisine ait
          yardım kriterlerini uygula" - bu panel (global/tek online-basvuru
          kriteri) kaldirildi. Otomatik red kontrolu artik her basvurunun
          KENDI donemine ozel, Ayarlar > Yardım Kriterleri'nde tanimlanan
          sinirlari kullanir (bkz. app/api/online-applications/route.ts -
          getDonemCriteriaLimits). */}

      {donemStats && (
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="mb-3 text-[13px] font-black uppercase tracking-wide text-slate-500">
            {params.f_donem} — Dönem Özeti
          </p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3">
              <p className="text-[12px] font-black uppercase text-slate-500">Toplam Başvuru</p>
              <p className="mt-1 text-2xl font-black text-slate-900">{donemStats.toplam}</p>
            </div>
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
              <p className="text-[12px] font-black uppercase text-amber-700">İncelenecek</p>
              <p className="mt-1 text-2xl font-black text-amber-700">{donemStats.incelenecek}</p>
            </div>
            <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3">
              <p className="text-[12px] font-black uppercase text-rose-700">Otomatik Red</p>
              <p className="mt-1 text-2xl font-black text-rose-700">{donemStats.otomatikRed}</p>
            </div>
          </div>
        </div>
      )}

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
        searchPlaceholder="TC, ad soyad, telefon, yardım türü, mahalle veya açıklama ara"
        emptyMessage="Listelenecek online başvuru bulunamadı."
        organizedToolbar
        excludedColumns={['id', 'mahalle', 'durum', 'basvuru_yili', 'donem_grubu']}
        requiredVisibleColumns={['basvuru_tarihi', 'tc', 'ad_soyad', 'iban', 'aylik_gelir', 'arac_durumu', 'arac_modeli', 'miktar']}
        preferredColumnOrder={PREFERRED_COLUMNS}
        columnLabels={COLUMN_LABELS}
        filterValueOptions={filterValueOptions}
        quickFilterConfig={{ fieldKey: 'donem', label: 'Yardım Dönemi', placeholder: 'Tüm Dönemler' }}
        recordUpdateConfig={canManage ? {
          endpoint: '/api/online-applications/bulk-update',
          label: 'Donem, etiket, asama ve miktar bilgilerini guncelle',
          fields: ['donem', 'etiket', 'asama', 'miktar'],
        } : undefined}
        transferConfig={canManage ? {
          endpoint: '/api/online-applications/transfer-to-cash',
          label: 'Nakit Muracaata Aktar',
          filteredLabel: 'Filtrelenenleri Nakit Muracaata Aktar',
        } : undefined}
        onlineApplicationEditConfig={canManage ? {
          endpoint: '/api/online-applications/detail',
          label: 'Basvuruyu Duzenle',
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
