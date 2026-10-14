'use client'

// Kullanici istegi (2026-10-14): "Online Başvuru Formları sayfasını işleyişi
// bozmadan güncelle, daha profesyonel ve kurumsal yap" - bu sekme eskiden
// settings/page.tsx icinde ~760 satirlik satir ici JSX idi; ayri bilesene
// tasindi. Kaydedilen veri yapisi (OnlineApplication[], app_settings
// 'online_application_forms') BIREBIR AYNI - sadece duzenleme arayuzu,
// kaydetmeden once dogrulama, alan siralama, form cogaltma, gorsel
// sikistirma ve kaydedilmemis degisiklik uyarisi eklendi.

import { useEffect, useMemo, useState, type Dispatch, type SetStateAction } from 'react'
import { confirmDialog } from '@/components/shared/GlobalConfirmDialog'
import { ApplicationStatusLookupToggle } from '@/app/online/ApplicationStatusLookupToggle'
import {
  normalizeOnlineApplicationCriteria,
  normalizeOnlineApplicationIntro,
  type OnlineApplication,
  type OnlineApplicationCriteria,
  type OnlineApplicationIntro,
  type OnlineFormField,
} from '@/lib/constants/onlineApplicationForms'

type OnlineCriterionType = 'minAge' | 'uniqueAddressNo' | 'uniqueIdentity' | 'maxIncome' | 'maxVehicleModelYear' | 'maxAge'

// "type" anahtarlari ve enabledField/valueField eslesmeleri ESKISIYLE AYNI
// (kayitli formlarin criteria nesnesi degismesin diye). Sadece etiketler,
// sunucunun GERCEKTE yaptigi seyi anlatacak sekilde netlestirildi:
// - uniqueAddressNo: ayni haneden ikinci basvuru engeli artik sunucuda
//   HER formda kosulsuz calisiyor; bu anahtarin kalan TEK etkisi, adres no
//   NVİ'den dogrulanamayan kisinin basvurusunun alinmamasi
//   (OnlineApplicationClient.tsx).
// - minAge: 18 yas alti zaten her formda reddediliyor - alt sinir 18.
const ONLINE_CRITERION_OPTIONS: Array<{
  type: OnlineCriterionType
  label: string
  enabledField: keyof OnlineApplicationCriteria
  valueField?: keyof OnlineApplicationCriteria
  defaultValue?: number
  min?: number
  unit?: string
}> = [
  { type: 'minAge', label: 'Belirlenen yaşın altındakiler başvuramasın', enabledField: 'minAgeEnabled', valueField: 'minAge', defaultValue: 18, min: 18, unit: 'yaş' },
  { type: 'maxAge', label: 'Yaş üst sınırını aşanlar başvuramasın', enabledField: 'maxAgeEnabled', valueField: 'maxAge', defaultValue: 65, min: 18, unit: 'yaş' },
  { type: 'maxIncome', label: 'Aylık geliri üst sınırı aşanlar başvuramasın', enabledField: 'maxIncomeEnabled', valueField: 'maxIncome', defaultValue: 10000, min: 1, unit: '₺' },
  { type: 'maxVehicleModelYear', label: 'Araç model yılı sınırı aşanlar başvuramasın', enabledField: 'maxVehicleModelYearEnabled', valueField: 'maxVehicleModelYear', defaultValue: 2005, min: 1900, unit: 'model' },
  { type: 'uniqueIdentity', label: 'Aynı T.C. kimlik no ile bu forma ikinci başvuru yapılamasın', enabledField: 'uniqueIdentityEnabled' },
  { type: 'uniqueAddressNo', label: 'Adres numarası doğrulanamayanlar başvuramasın', enabledField: 'uniqueAddressNoEnabled' },
]

// Sunucunun (app/api/online-applications/route.ts) form ayarindan BAGIMSIZ,
// her basvuruda uyguladigi kurallar - yonetici "bunu da isaretlemeli miyim"
// diye dusunmesin diye bilgi olarak gosterilir.
const ALWAYS_APPLIED_RULES = [
  '18 yaşından küçükler başvuru yapamaz.',
  'Adres bilgisi alınamayan ve köy adresinde ikamet edenlerin başvurusu alınmaz.',
  'Aynı haneden (aynı adres no) aynı forma ikinci aktif başvuru yapılamaz.',
  'Aynı dönem için nakit yardımı müracaatı bulunan kişi ve hane tekrar başvuramaz.',
  'Telefon, İBAN ve araç model yılı biçim kontrolünden geçer.',
]

const FIELD_TYPE_LABELS: Record<OnlineFormField['type'], string> = {
  text: 'Kısa Metin',
  number: 'Sayı',
  select: 'Seçenekli',
  textarea: 'Uzun Metin',
  file: 'Dosya Yükleme (desteklenmiyor)',
}
// "Dosya Yükleme" vatandas sayfasinda dosya secme kutusu gosteriyor ama
// secilen dosya HIC gonderilmiyor/kaydedilmiyordu - yeni alan olarak
// eklenemez; eski bir formda varsa uyari ile birlikte gorunmeye devam eder.
const SELECTABLE_FIELD_TYPES: Array<OnlineFormField['type']> = ['text', 'number', 'select', 'textarea']

const LARGE_IMAGE_BYTES = 300 * 1024

export type OnlineFormIssue = {
  formId: string
  level: 'error' | 'warning'
  message: string
}

function parseLocalDate(value?: string | null) {
  if (!value) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

function dataUrlBytes(value: string) {
  if (!value.startsWith('data:')) return 0
  const base64 = value.slice(value.indexOf(',') + 1)
  return Math.round((base64.length * 3) / 4)
}

function formatBytes(bytes: number) {
  return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.round(bytes / 1024)} KB`
}

function formatShortDate(value?: string | null) {
  const date = parseLocalDate(value)
  return date ? date.toLocaleString('tr-TR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : ''
}

// Kaydetmeden once TUM formlar icin calisir. "error" kaydi engeller (vatandas
// tarafinda bozuk/eksik form yayinlanmasin), "warning" sadece bilgi verir.
export function validateOnlineForms(forms: OnlineApplication[], donemNames: string[]): OnlineFormIssue[] {
  const issues: OnlineFormIssue[] = []
  const now = new Date()
  const titleCounts = new Map<string, number>()
  forms.forEach(form => {
    const key = form.title.trim().toLocaleUpperCase('tr-TR')
    titleCounts.set(key, (titleCounts.get(key) ?? 0) + 1)
  })

  for (const form of forms) {
    const add = (level: OnlineFormIssue['level'], message: string) => issues.push({ formId: form.id, level, message })
    const title = form.title.trim()

    if (!title) add('error', 'Form başlığı (dönem) seçilmemiş.')
    else if (donemNames.length > 0 && !donemNames.includes(title)) {
      add('warning', 'Başlık "Dönem Bilgisi" listesinde yok; dönem kriterleri ve mükerrer başvuru kontrolleri bu başlıkla eşleşmeyebilir.')
    }
    if (title && (titleCounts.get(title.toLocaleUpperCase('tr-TR')) ?? 0) > 1) {
      add('warning', 'Aynı başlıkta başka bir form daha var; iki form aynı dönemi paylaşır.')
    }

    const start = parseLocalDate(form.publishStartAt)
    const end = parseLocalDate(form.publishEndAt)
    if (form.publishStartAt && !start) add('error', 'Yayın başlangıç tarihi geçersiz.')
    if (form.publishEndAt && !end) add('error', 'Yayın bitiş tarihi geçersiz.')
    if (start && end && end <= start) add('error', 'Yayın bitişi, başlangıçtan sonra olmalı.')
    if (form.active && end && end < now) add('warning', 'Yayın süresi dolmuş; form vatandaşlara görünmüyor.')

    const fieldIds = new Set(form.fields.map(field => field.id))
    form.fields.forEach((field, index) => {
      const name = field.label.trim() || `${index + 1}. alan`
      if (!field.label.trim()) add('error', `${index + 1}. alanın adı boş.`)
      if (field.type === 'select' && (field.options ?? []).filter(option => option.trim()).length === 0) {
        add('error', `"${name}" seçenekli alan ama hiç seçenek girilmemiş.`)
      }
      if (field.type === 'file') {
        add('warning', `"${name}" dosya yükleme alanı: vatandaşın seçtiği dosya kaydedilmez. Alanı silmeniz veya türünü değiştirmeniz önerilir.`)
      }
      if (field.showWhen?.fieldId) {
        if (!fieldIds.has(field.showWhen.fieldId)) {
          add('warning', `"${name}" alanının görünme koşulu silinmiş bir alana bağlı; alan her zaman görünecek.`)
        } else if (!field.showWhen.value.trim()) {
          add('error', `"${name}" alanının görünme koşulu için değer seçilmemiş; alan hiç görünmez.`)
        }
      }
    })

    const imageBytes = dataUrlBytes(normalizeOnlineApplicationIntro(form.intro).imageUrl)
    if (imageBytes > LARGE_IMAGE_BYTES) {
      add('warning', `Popup görseli büyük (${formatBytes(imageBytes)}); vatandaş sayfasını yavaşlatır. "Görseli Optimize Et" ile küçültebilirsiniz.`)
    }
  }

  return issues
}

// Kayit oncesi: secenekli alanlarin seceneklerini kirpar, bos satirlari atar
// (duzenleme sirasinda ham tutuluyorlar - bkz. updateFieldOptions).
export function normalizeOnlineFormsForSave(forms: OnlineApplication[]): OnlineApplication[] {
  return forms.map(form => ({
    ...form,
    fields: form.fields.map(field => (field.options
      ? { ...field, options: field.options.map(option => option.trim()).filter(Boolean) }
      : field)),
  }))
}

// Yuklenen gorseli tarayicida en fazla 720px'e kucultup WebP'ye cevirir
// (seffaflik korunur). Sonuc orijinalden buyukse orijinal kullanilir. SVG
// dokunulmadan birakilir.
function compressImageDataUrl(source: string, maxSize = 720): Promise<string> {
  return new Promise(resolve => {
    if (source.startsWith('data:image/svg')) return resolve(source)
    const image = new Image()
    image.onload = () => {
      const scale = Math.min(1, maxSize / Math.max(image.width, image.height))
      const canvas = document.createElement('canvas')
      canvas.width = Math.max(1, Math.round(image.width * scale))
      canvas.height = Math.max(1, Math.round(image.height * scale))
      const context = canvas.getContext('2d')
      if (!context) return resolve(source)
      context.drawImage(image, 0, 0, canvas.width, canvas.height)
      let result = canvas.toDataURL('image/webp', 0.85)
      if (!result.startsWith('data:image/webp')) result = canvas.toDataURL('image/png')
      resolve(result.length < source.length ? result : source)
    }
    image.onerror = () => resolve(source)
    image.src = source
  })
}

function getFormStatus(form: OnlineApplication) {
  if (!form.active) return { label: 'Pasif', detail: 'Manuel olarak kapalı', tone: 'slate' as const }
  const now = new Date()
  const start = parseLocalDate(form.publishStartAt)
  const end = parseLocalDate(form.publishEndAt)
  if (start && now < start) return { label: 'Zamanlanmış', detail: `${formatShortDate(form.publishStartAt)} tarihinde yayına girecek`, tone: 'amber' as const }
  if (end && now > end) return { label: 'Süresi Doldu', detail: `${formatShortDate(form.publishEndAt)} tarihinde yayından kalktı`, tone: 'rose' as const }
  return { label: 'Yayında', detail: end ? `${formatShortDate(form.publishEndAt)} tarihine kadar yayında` : 'Süresiz yayında', tone: 'emerald' as const }
}

const TONE_BADGE: Record<'slate' | 'amber' | 'rose' | 'emerald', string> = {
  slate: 'border-slate-200 bg-slate-100 text-slate-600',
  amber: 'border-amber-200 bg-amber-50 text-amber-800',
  rose: 'border-rose-200 bg-rose-50 text-rose-700',
  emerald: 'border-emerald-200 bg-emerald-50 text-emerald-700',
}
const TONE_DOT: Record<'slate' | 'amber' | 'rose' | 'emerald', string> = {
  slate: 'bg-slate-400',
  amber: 'bg-amber-500',
  rose: 'bg-rose-500',
  emerald: 'bg-emerald-500',
}

const inputClass = 'w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-[19px] font-semibold text-slate-900 outline-none transition focus:border-[#0E7C86] focus:ring-2 focus:ring-[#0E7C86]/15 disabled:bg-slate-100 disabled:text-slate-500'
const labelClass = 'text-[15px] font-bold uppercase tracking-wide text-slate-500'
const secondaryButton = 'inline-flex items-center justify-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-2 text-[16px] font-bold text-[#1E2A38] shadow-sm transition hover:border-[#0E7C86] hover:text-[#0A5F67] disabled:cursor-not-allowed disabled:opacity-50'
const primaryButton = 'inline-flex items-center justify-center gap-1.5 rounded-lg bg-[#0E7C86] px-3 py-2 text-[16px] font-bold text-white shadow-sm transition hover:bg-[#0A5F67] disabled:cursor-not-allowed disabled:opacity-50'

function SectionCard({ step, title, description, children, aside }: {
  step: number
  title: string
  description?: string
  children: React.ReactNode
  aside?: React.ReactNode
}) {
  return (
    <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-[#f6f8fb] px-4 py-3">
        <div className="flex items-center gap-3">
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-[#1E2A38] text-[16px] font-bold text-white">{step}</span>
          <div>
            <h3 className="text-[19px] font-bold uppercase tracking-wide text-[#1E2A38]">{title}</h3>
            {description && <p className="text-[16px] font-medium text-slate-500">{description}</p>}
          </div>
        </div>
        {aside}
      </header>
      <div className="p-4">{children}</div>
    </section>
  )
}

export type OnlineFormsTabProps = {
  forms: OnlineApplication[]
  setForms: Dispatch<SetStateAction<OnlineApplication[]>>
  selectedFormId: string | null
  setSelectedFormId: (id: string | null) => void
  donemOptions: Array<{ id: string | number; name: string }>
  publicBaseUrl: string
  branding: {
    logoUrl: string
    institutionName: string
    departmentName: string
  }
  isDirty: boolean
  isSaving: boolean
  status: string
  setStatus: (message: string) => void
  onSave: () => void
  onOpenPreview: () => void
}

export function OnlineFormsTab({
  forms,
  setForms,
  selectedFormId,
  setSelectedFormId,
  donemOptions,
  publicBaseUrl,
  branding,
  isDirty,
  isSaving,
  status,
  setStatus,
  onSave,
  onOpenPreview,
}: OnlineFormsTabProps) {
  const [newFieldName, setNewFieldName] = useState('')
  const [newFieldType, setNewFieldType] = useState<OnlineFormField['type']>('text')
  const [isOptimizingImage, setIsOptimizingImage] = useState(false)
  // Kosul editoru, kosulu olmayan alanlarda kalabalik yapmasin diye "Koşul"
  // dugmesiyle acilir (kosulu olan alanda her zaman acik).
  const [openConditionIds, setOpenConditionIds] = useState<string[]>([])

  const selectedForm = forms.find(form => form.id === selectedFormId) ?? null
  const criteria = normalizeOnlineApplicationCriteria(selectedForm?.criteria)
  const intro = normalizeOnlineApplicationIntro(selectedForm?.intro)
  const activeCriteriaRows = ONLINE_CRITERION_OPTIONS.filter(option => Boolean(criteria[option.enabledField]))
  const donemNames = useMemo(() => donemOptions.map(option => option.name), [donemOptions])
  // Zamana bagli durumlar (Yayında -> Süresi Doldu) ust sayfanin 15 sn'lik
  // yeniden cizimiyle guncel kalsin diye memo'lanmiyor.
  const issues = validateOnlineForms(forms, donemNames)
  const selectedIssues = issues.filter(issue => issue.formId === selectedFormId)
  const errorCountByForm = (() => {
    const counts = new Map<string, number>()
    issues.forEach(issue => {
      if (issue.level === 'error') counts.set(issue.formId, (counts.get(issue.formId) ?? 0) + 1)
    })
    return counts
  })()

  const stats = (() => {
    const result = { total: forms.length, live: 0, scheduled: 0, passive: 0 }
    forms.forEach(form => {
      const formStatus = getFormStatus(form)
      if (formStatus.tone === 'emerald') result.live += 1
      else if (formStatus.tone === 'amber') result.scheduled += 1
      else result.passive += 1
    })
    return result
  })()

  // Secili form silinirse/yoksa ilk formu sec - editor bos kalmasin.
  useEffect(() => {
    if (!selectedForm && forms.length > 0) setSelectedFormId(forms[0].id)
  }, [selectedForm, forms, setSelectedFormId])

  const formUrl = selectedForm
    ? `${publicBaseUrl || ''}/online?form=${encodeURIComponent(selectedForm.id)}`
    : `${publicBaseUrl || ''}/online`
  const hubUrl = `${publicBaseUrl || ''}/onlinebasvuru`

  const copyText = async (text: string, successMessage: string) => {
    try {
      await navigator.clipboard.writeText(text)
      setStatus(successMessage)
    } catch {
      setStatus('Bağlantı kopyalanamadı. Linki elle seçip kopyalayabilirsiniz.')
    }
  }

  // ---- form duzeyi islemler -------------------------------------------------
  const patchForm = (id: string, updater: (form: OnlineApplication) => OnlineApplication) => {
    setForms(prev => prev.map(form => (form.id === id ? updater(form) : form)))
  }
  const updateForm = <K extends keyof OnlineApplication>(id: string, key: K, value: OnlineApplication[K]) => {
    patchForm(id, form => ({ ...form, [key]: value }))
  }
  // Tarih girilince "Form Yayında" otomatik acilir (2026-09-22 davranisi
  // korundu); tarihi temizlemek ise yayini KAPATMAZ.
  const updateSchedule = (id: string, key: 'publishStartAt' | 'publishEndAt', value: string | null) => {
    patchForm(id, form => ({ ...form, [key]: value, active: value ? true : form.active }))
  }
  const updateCriteria = <K extends keyof OnlineApplicationCriteria>(id: string, key: K, value: OnlineApplicationCriteria[K]) => {
    patchForm(id, form => ({ ...form, criteria: { ...normalizeOnlineApplicationCriteria(form.criteria), [key]: value } }))
  }
  const updateIntro = <K extends keyof OnlineApplicationIntro>(id: string, key: K, value: OnlineApplicationIntro[K]) => {
    patchForm(id, form => ({ ...form, intro: { ...normalizeOnlineApplicationIntro(form.intro), [key]: value } }))
  }

  const addForm = () => {
    const firstUnusedDonem = donemNames.find(name => !forms.some(form => form.title === name))
    const newForm: OnlineApplication = {
      id: 'app_' + Date.now(),
      title: firstUnusedDonem || 'Yeni Başvuru Formu',
      active: false,
      criteria: normalizeOnlineApplicationCriteria(),
      intro: normalizeOnlineApplicationIntro(),
      fields: [
        { id: 'f_tc', label: 'T.C. Kimlik No', required: true, type: 'text', isFixed: true },
        { id: 'f_name', label: 'Ad Soyad', required: true, type: 'text', isFixed: true },
        { id: 'f_phone', label: 'Telefon', required: true, type: 'text' },
      ],
    }
    setForms(prev => [newForm, ...prev])
    setSelectedFormId(newForm.id)
    setStatus('Yeni form oluşturuldu (pasif). Düzenleyip "Kaydet" ile kaydedin.')
  }

  // Bir onceki donemin formunu ayni alan/kriter/popup ayarlariyla yeni bir
  // form olarak kopyalar - yeni donem acarken her seyi bastan girmemek icin.
  // Kopya PASIF ve zamanlamasiz baslar (yanlislikla yayina girmesin diye).
  const duplicateForm = (form: OnlineApplication) => {
    const copy: OnlineApplication = {
      ...JSON.parse(JSON.stringify(form)),
      id: 'app_' + Date.now(),
      title: `${form.title} (Kopya)`,
      active: false,
      publishStartAt: null,
      publishEndAt: null,
    }
    setForms(prev => {
      const index = prev.findIndex(item => item.id === form.id)
      const next = [...prev]
      next.splice(index + 1, 0, copy)
      return next
    })
    setSelectedFormId(copy.id)
    setStatus('Form kopyalandı (pasif). Dönem başlığını seçip kaydedin.')
  }

  const removeForm = async (form: OnlineApplication) => {
    const ok = await confirmDialog(
      `"${form.title}" formu silinsin mi? Bu formdan daha önce gelen başvurular silinmez; ancak form vatandaş sayfasından kalkar. Silme işlemi "Kaydet" ile kalıcı olur.`,
      'Evet, Formu Sil',
      'Vazgeç',
    )
    if (!ok) return
    setForms(prev => prev.filter(item => item.id !== form.id))
    setSelectedFormId(null)
    setStatus(`"${form.title}" kaldırıldı. Kalıcı olması için "Kaydet"e basın.`)
  }

  // ---- kriterler -------------------------------------------------------------
  const addCriterion = (id: string) => {
    const nextOption = ONLINE_CRITERION_OPTIONS.find(option => !criteria[option.enabledField])
    if (!nextOption) return
    patchForm(id, form => {
      const current = normalizeOnlineApplicationCriteria(form.criteria)
      return {
        ...form,
        criteria: {
          ...current,
          [nextOption.enabledField]: true,
          ...(nextOption.valueField ? { [nextOption.valueField]: current[nextOption.valueField] || nextOption.defaultValue || 1 } : {}),
        },
      }
    })
  }
  const removeCriterion = (id: string, type: OnlineCriterionType) => {
    const option = ONLINE_CRITERION_OPTIONS.find(candidate => candidate.type === type)
    if (option) updateCriteria(id, option.enabledField, false as OnlineApplicationCriteria[typeof option.enabledField])
  }
  const changeCriterion = (id: string, currentType: OnlineCriterionType, nextType: OnlineCriterionType) => {
    if (currentType === nextType) return
    const currentOption = ONLINE_CRITERION_OPTIONS.find(option => option.type === currentType)
    const nextOption = ONLINE_CRITERION_OPTIONS.find(option => option.type === nextType)
    if (!currentOption || !nextOption) return
    patchForm(id, form => {
      const current = normalizeOnlineApplicationCriteria(form.criteria)
      return {
        ...form,
        criteria: {
          ...current,
          [currentOption.enabledField]: false,
          [nextOption.enabledField]: true,
          ...(nextOption.valueField ? { [nextOption.valueField]: current[nextOption.valueField] || nextOption.defaultValue || 1 } : {}),
        },
      }
    })
  }
  const setManualCriteria = (id: string, updater: (items: string[]) => string[]) => {
    patchForm(id, form => {
      const current = normalizeOnlineApplicationCriteria(form.criteria)
      return { ...form, criteria: { ...current, manualInfoCriteria: updater(current.manualInfoCriteria) } }
    })
  }

  // ---- alanlar ---------------------------------------------------------------
  const setFields = (id: string, updater: (fields: OnlineFormField[]) => OnlineFormField[]) => {
    patchForm(id, form => ({ ...form, fields: updater(form.fields) }))
  }
  const updateField = <K extends keyof OnlineFormField>(formId: string, fieldId: string, key: K, value: OnlineFormField[K]) => {
    setFields(formId, fields => fields.map(field => (field.id === fieldId ? { ...field, [key]: value } : field)))
  }
  const updateFieldType = (formId: string, fieldId: string, type: OnlineFormField['type']) => {
    setFields(formId, fields => fields.map(field => {
      if (field.id !== fieldId) return field
      return { ...field, type, options: type === 'select' ? (field.options?.length ? field.options : ['Var', 'Yok']) : field.options }
    }))
  }
  // Yazarken satirlar ham tutulur (Enter ile yeni satir, secenek icinde
  // bosluk yazilabilsin); odak cikinca kirpilip bos satirlar atilir. Eskiden
  // her tusta kirpilip virgulden bolunuyordu: Enter ve kelime arasi bosluk
  // yazilamiyordu.
  const updateFieldOptions = (formId: string, fieldId: string, rawValue: string, normalize = false) => {
    const lines = rawValue.split('\n')
    updateField(formId, fieldId, 'options', normalize ? lines.map(option => option.trim()).filter(Boolean) : lines)
  }
  const updateFieldCondition = (formId: string, fieldId: string, key: 'fieldId' | 'value', value: string) => {
    setFields(formId, fields => fields.map(field => {
      if (field.id !== fieldId) return field
      const current = field.showWhen || { fieldId: '', value: '' }
      // Kaynak alan degisince eski deger artik gecersiz - sifirlanir.
      const next = key === 'fieldId' ? { fieldId: value, value: '' } : { ...current, value }
      return { ...field, showWhen: next.fieldId ? next : undefined }
    }))
  }
  const moveField = (formId: string, index: number, direction: -1 | 1) => {
    setFields(formId, fields => {
      const target = index + direction
      if (target < 0 || target >= fields.length) return fields
      const next = [...fields]
      ;[next[index], next[target]] = [next[target], next[index]]
      return next
    })
  }
  const removeField = async (formId: string, field: OnlineFormField) => {
    const dependents = selectedForm?.fields.filter(candidate => candidate.showWhen?.fieldId === field.id) ?? []
    const message = dependents.length > 0
      ? `"${field.label}" alanı silinsin mi? ${dependents.map(item => `"${item.label}"`).join(', ')} alanı bu alana bağlı; koşulu kaldırılıp her zaman görünür olacak.`
      : `"${field.label}" alanı silinsin mi?`
    if (!(await confirmDialog(message, 'Evet, Sil', 'Vazgeç'))) return
    setFields(formId, fields => fields
      .filter(item => item.id !== field.id)
      .map(item => (item.showWhen?.fieldId === field.id ? { ...item, showWhen: undefined } : item)))
  }
  const addField = (formId: string) => {
    const label = newFieldName.trim()
    if (!label) return
    setFields(formId, fields => [...fields, {
      id: 'f_' + Date.now(),
      label,
      required: false,
      type: newFieldType,
      options: newFieldType === 'select' ? ['Var', 'Yok'] : undefined,
    }])
    setNewFieldName('')
  }

  // ---- popup gorseli ---------------------------------------------------------
  const handleImageUpload = (formId: string, file?: File | null) => {
    if (!file) return
    if (!file.type.startsWith('image/')) {
      setStatus('Lütfen bir resim dosyası seçin.')
      return
    }
    const reader = new FileReader()
    reader.onload = async () => {
      setIsOptimizingImage(true)
      const compressed = await compressImageDataUrl(String(reader.result || ''))
      setIsOptimizingImage(false)
      updateIntro(formId, 'imageUrl', compressed)
    }
    reader.readAsDataURL(file)
  }
  const optimizeCurrentImage = async (formId: string) => {
    setIsOptimizingImage(true)
    const before = dataUrlBytes(intro.imageUrl)
    const compressed = await compressImageDataUrl(intro.imageUrl)
    setIsOptimizingImage(false)
    updateIntro(formId, 'imageUrl', compressed)
    setStatus(`Görsel ${formatBytes(before)} → ${formatBytes(dataUrlBytes(compressed))} küçültüldü. Kalıcı olması için "Kaydet"e basın.`)
  }

  const errorCount = issues.filter(issue => issue.level === 'error').length
  const imageBytes = dataUrlBytes(intro.imageUrl)
  const formStatus = selectedForm ? getFormStatus(selectedForm) : null

  return (
    <div className="space-y-5">
      {/* Ozet + islem cubugu. Sayfanin kendi lacivert basligi (ns-sayfa-baslik)
          zaten "Online Başvuru Formları" yaziyor - burada tekrar edilmez;
          altin sol cizgi Dosya Yönetimi kurumsal diliyle ayni. */}
      <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-col gap-3 border-l-4 border-[#b8860b] px-4 py-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
            {[
              { label: 'Toplam form', value: stats.total, dot: 'bg-[#1E2A38]' },
              { label: 'Yayında', value: stats.live, dot: TONE_DOT.emerald },
              { label: 'Zamanlanmış', value: stats.scheduled, dot: TONE_DOT.amber },
              { label: 'Pasif / süresi dolmuş', value: stats.passive, dot: TONE_DOT.slate },
            ].map(item => (
              <div key={item.label} className="flex items-center gap-2">
                <span className={`h-2 w-2 rounded-full ${item.dot}`} />
                <span className="text-[24px] font-bold leading-none text-[#1E2A38]">{item.value}</span>
                <span className="text-[16px] font-semibold text-slate-500">{item.label}</span>
              </div>
            ))}
            <span className="hidden h-5 w-px bg-slate-200 lg:block" />
            {isDirty ? (
              <span className="inline-flex items-center gap-2 rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-[16px] font-bold text-amber-800">
                <span className="h-2 w-2 animate-pulse rounded-full bg-amber-500" />
                Kaydedilmemiş değişiklikler var
              </span>
            ) : (
              <span className="inline-flex items-center gap-2 text-[16px] font-semibold text-slate-500">
                <span className="h-2 w-2 rounded-full bg-emerald-500" />
                Tüm değişiklikler kayıtlı
              </span>
            )}
            {errorCount > 0 && (
              <span className="rounded-full border border-rose-200 bg-rose-50 px-3 py-1 text-[16px] font-bold text-rose-700">{errorCount} hata kaydı engelliyor</span>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={onOpenPreview} disabled={!selectedForm} className={secondaryButton}>
              Ekran Önizlemesi
            </button>
            <button type="button" onClick={addForm} className={secondaryButton}>
              + Yeni Form
            </button>
            <button type="button" onClick={onSave} disabled={isSaving || !isDirty} className={`${primaryButton} px-5`}>
              {isSaving ? 'Kaydediliyor…' : 'Kaydet'}
            </button>
          </div>
        </div>
      </div>

      {status && (
        <div className="flex items-start justify-between gap-3 rounded-lg border border-[#0E7C86]/30 bg-[#0E7C86]/5 px-4 py-2.5 text-[19px] font-semibold text-[#0A5F67]">
          <span>{status}</span>
          <button type="button" onClick={() => setStatus('')} className="text-[24px] leading-none text-[#0A5F67]/60 hover:text-[#0A5F67]" aria-label="Mesajı kapat">×</button>
        </div>
      )}

      <ApplicationStatusLookupToggle />

      <div className="grid gap-5 xl:grid-cols-[380px_minmax(0,1fr)]">
        {/* Sol sutun: form listesi + baglantilar + vatandas gorunumu. Duzenleyici
            orta+sag alani tek basina kullanir (alan adlari kirpilmasin diye). */}
        <div className="space-y-5">
          {/* ---- Sol: form listesi ---- */}
          <aside className="space-y-3">
            <div className="flex items-center justify-between">
              <p className={labelClass}>Formlar</p>
              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[15px] font-bold text-slate-500">{forms.length}</span>
            </div>
            <div className="space-y-2">
              {forms.map(form => {
                const itemStatus = getFormStatus(form)
                const isSelected = form.id === selectedFormId
                const formErrors = errorCountByForm.get(form.id) ?? 0
                return (
                  <button
                    type="button"
                    key={form.id}
                    onClick={() => setSelectedFormId(form.id)}
                    className={`w-full rounded-xl border bg-white p-3 text-left transition ${isSelected ? 'border-[#0E7C86] shadow-[inset_3px_0_0_#0E7C86] ring-1 ring-[#0E7C86]/20' : 'border-slate-200 hover:border-slate-300 hover:bg-slate-50'}`}
                  >
                    <p className="text-[19px] font-bold leading-snug text-[#1E2A38]">{form.title || 'Başlıksız form'}</p>
                    <div className="mt-2 flex flex-wrap items-center gap-1.5">
                      <span className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[15px] font-bold ${TONE_BADGE[itemStatus.tone]}`}>
                        <span className={`h-1.5 w-1.5 rounded-full ${TONE_DOT[itemStatus.tone]}`} />
                        {itemStatus.label}
                      </span>
                      <span className="text-[15px] font-semibold text-slate-400">{form.fields.length} alan</span>
                      {formErrors > 0 && (
                        <span className="rounded-full bg-rose-100 px-2 py-0.5 text-[15px] font-bold text-rose-700">{formErrors} hata</span>
                      )}
                    </div>
                    {(form.publishStartAt || form.publishEndAt) && (
                      <p className="mt-1.5 text-[15px] font-medium text-slate-500">
                        {form.publishStartAt ? formatShortDate(form.publishStartAt) : '…'} – {form.publishEndAt ? formatShortDate(form.publishEndAt) : '…'}
                      </p>
                    )}
                  </button>
                )
              })}
              {forms.length === 0 && (
                <div className="rounded-xl border border-dashed border-slate-300 bg-white p-5 text-center text-[16px] font-semibold text-slate-500">
                  Henüz form yok. “+ Yeni Form” ile oluşturun.
                </div>
              )}
            </div>
          </aside>

          {/* ---- Sag: baglantilar + canli onizleme ---- */}
          <aside className="space-y-4 ">
            {[
              {
                eyebrow: 'Seçili Form',
                title: 'Başvuru Bağlantısı',
                text: 'Bu formu doğrudan açar. Web sitesi butonlarında, QR kodlarda ve duyurularda kullanılabilir.',
                url: formUrl,
                disabled: !selectedForm,
                onCopy: () => void copyText(formUrl, 'Seçili formun başvuru bağlantısı kopyalandı.'),
              },
              {
                eyebrow: 'Tüm Formlar',
                title: 'Başvuru Ana Sayfası',
                text: 'O an yayında olan tüm başvuru türlerini listeler; tek form yayındaysa doğrudan ona yönlendirir. Genel duyurularda bu bağlantıyı kullanın.',
                url: hubUrl,
                disabled: false,
                onCopy: () => void copyText(hubUrl, 'Başvuru ana sayfası bağlantısı kopyalandı.'),
              },
            ].map(card => (
              <div key={card.title} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                <p className="text-[15px] font-bold uppercase tracking-wide text-[#0E7C86]">{card.eyebrow}</p>
                <h3 className="mt-0.5 text-[19px] font-bold text-[#1E2A38]">{card.title}</h3>
                <p className="mt-1 text-[16px] font-medium leading-relaxed text-slate-500">{card.text}</p>
                <input
                  readOnly
                  value={card.url}
                  onFocus={event => event.target.select()}
                  className="mt-3 w-full rounded-lg border border-slate-200 bg-[#f6f8fb] px-2.5 py-2 font-mono text-[15px] font-semibold text-slate-700 outline-none"
                />
                <div className="mt-2 grid grid-cols-2 gap-2">
                  <button type="button" onClick={card.onCopy} disabled={card.disabled} className={primaryButton}>Kopyala</button>
                  <a
                    href={card.url}
                    target="_blank"
                    rel="noreferrer"
                    className={`${secondaryButton} ${card.disabled ? 'pointer-events-none opacity-50' : ''}`}
                  >
                    Yeni Sekmede Aç
                  </a>
                </div>
              </div>
            ))}

            <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
              <div className="flex items-center justify-between border-b border-slate-200 bg-[#f6f8fb] px-4 py-2.5">
                <p className="text-[15px] font-bold uppercase tracking-wide text-slate-500">Vatandaş Görünümü</p>
                <button type="button" onClick={onOpenPreview} disabled={!selectedForm} className="text-[15px] font-bold text-[#0E7C86] hover:underline disabled:opacity-50">
                  Büyük önizleme
                </button>
              </div>
              <div className="bg-slate-100 p-3">
                <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
                  {/* Renkler vatandas sayfasinin (app/online) GERCEK renkleri -
                      yonetim paneli paleti degil. */}
                  <div className="bg-[#003f82] px-3 py-3 text-white">
                    <div className="flex items-center gap-2.5">
                      <img src={branding.logoUrl} alt={branding.institutionName} className="h-9 w-9 rounded-full bg-white object-contain p-0.5" />
                      <div className="min-w-0">
                        <p className="truncate text-[14px] font-semibold uppercase text-white/70">{branding.institutionName}</p>
                        <p className="truncate text-[16px] font-bold">{branding.departmentName}</p>
                      </div>
                    </div>
                  </div>
                  <div className="space-y-2.5 p-3">
                    <p className="text-[19px] font-bold leading-tight text-[#1E2A38]">{selectedForm?.title || 'Başvuru Formu'}</p>
                    <div className="grid grid-cols-2 gap-2">
                      {['T.C. Kimlik No', 'Doğum Tarihi'].map(label => (
                        <div key={label} className="space-y-1">
                          <p className="text-[14px] font-bold uppercase text-slate-500">{label} <span className="text-rose-500">*</span></p>
                          <div className="h-7 rounded border border-slate-200 bg-slate-50" />
                        </div>
                      ))}
                    </div>
                    {(selectedForm?.fields ?? [])
                      .filter(field => {
                        const label = field.label.toLocaleLowerCase('tr-TR')
                        return !label.includes('tc') && !label.includes('kimlik') && !label.includes('doğum')
                      })
                      .slice(0, 5)
                      .map(field => (
                        <div key={field.id} className="space-y-1">
                          <p className="text-[14px] font-bold uppercase text-slate-500">
                            {field.label} {field.required && <span className="text-rose-500">*</span>}
                            {field.showWhen?.fieldId && <span className="ml-1 font-semibold normal-case text-slate-400">(koşullu)</span>}
                          </p>
                          <div className="h-7 rounded border border-slate-200 bg-slate-50" />
                        </div>
                      ))}
                    <div className="rounded bg-[#6fb744] py-1.5 text-center text-[15px] font-bold text-white">Başvuruyu Gönder</div>
                  </div>
                </div>
              </div>
            </div>
          </aside>
        </div>

        {/* ---- Orta: duzenleyici ---- */}
        <div className="min-w-0 space-y-4">
          {!selectedForm ? (
            <div className="rounded-xl border border-dashed border-slate-300 bg-white py-20 text-center text-[19px] font-semibold text-slate-500">
              Düzenlemek için soldan bir form seçin.
            </div>
          ) : (
            <>
              {selectedIssues.length > 0 && (
                <div className="space-y-1.5">
                  {selectedIssues.map((issue, index) => (
                    <div
                      key={index}
                      className={`flex items-start gap-2 rounded-lg border px-3 py-2 text-[16px] font-semibold ${issue.level === 'error' ? 'border-rose-200 bg-rose-50 text-rose-800' : 'border-amber-200 bg-amber-50 text-amber-900'}`}
                    >
                      <span className="mt-px font-bold">{issue.level === 'error' ? 'Hata:' : 'Uyarı:'}</span>
                      <span>{issue.message}</span>
                    </div>
                  ))}
                </div>
              )}

              <SectionCard
                step={1}
                title="Genel Bilgiler ve Yayın"
                description="Formun ait olduğu dönem ve vatandaşa açık olacağı zaman aralığı."
                aside={formStatus && (
                  <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[15px] font-bold ${TONE_BADGE[formStatus.tone]}`}>
                    <span className={`h-1.5 w-1.5 rounded-full ${TONE_DOT[formStatus.tone]}`} />
                    {formStatus.label}
                  </span>
                )}
              >
                <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
                  <label className="flex flex-col gap-1.5">
                    <span className={labelClass}>Form Başlığı (Dönem)</span>
                    {/* Basliklar Hazir Degerler > "Dönem Bilgisi" listesinden
                        secilir (2026-09-22); listede olmayan eski bir baslik
                        kaybolmasin diye secenek olarak eklenir. */}
                    <select
                      value={selectedForm.title}
                      onChange={event => updateForm(selectedForm.id, 'title', event.target.value)}
                      className={`${inputClass} text-[20px] font-bold`}
                    >
                      {!donemNames.includes(selectedForm.title) && (
                        <option value={selectedForm.title}>{selectedForm.title} (listede yok)</option>
                      )}
                      {donemOptions.map(option => (
                        <option key={option.id} value={option.name}>{option.name}</option>
                      ))}
                    </select>
                  </label>
                  <label className="flex cursor-pointer items-center gap-3 rounded-lg border border-slate-300 bg-white px-3 py-2">
                    <span className="relative inline-flex h-6 w-11 shrink-0 items-center">
                      <input
                        type="checkbox"
                        checked={selectedForm.active}
                        onChange={event => updateForm(selectedForm.id, 'active', event.target.checked)}
                        className="peer sr-only"
                      />
                      <span className="absolute inset-0 rounded-full bg-slate-300 transition peer-checked:bg-[#0E7C86]" />
                      <span className="absolute left-0.5 h-5 w-5 rounded-full bg-white shadow transition peer-checked:translate-x-5" />
                    </span>
                    <span className="text-[16px] font-bold uppercase tracking-wide text-[#1E2A38]">Form Yayında</span>
                  </label>
                </div>

                <div className="mt-4 rounded-lg border border-slate-200 bg-[#f6f8fb] p-3">
                  <p className={labelClass}>Yayın Zamanlaması <span className="font-medium normal-case tracking-normal text-slate-400">(isteğe bağlı)</span></p>
                  <div className="mt-2 grid gap-3 sm:grid-cols-2">
                    {([
                      { key: 'publishStartAt' as const, label: 'Başlangıç' },
                      { key: 'publishEndAt' as const, label: 'Bitiş' },
                    ]).map(item => (
                      <label key={item.key} className="flex flex-col gap-1">
                        <span className="text-[16px] font-semibold text-slate-600">{item.label}</span>
                        <div className="flex gap-2">
                          <input
                            type="datetime-local"
                            value={selectedForm[item.key] || ''}
                            onChange={event => updateSchedule(selectedForm.id, item.key, event.target.value || null)}
                            className={`${inputClass} min-w-0 flex-1`}
                          />
                          {selectedForm[item.key] && (
                            <button
                              type="button"
                              onClick={() => updateForm(selectedForm.id, item.key, null)}
                              className="rounded-lg border border-slate-300 bg-white px-2.5 text-[19px] font-bold text-slate-500 hover:text-rose-600"
                              aria-label={`${item.label} tarihini temizle`}
                            >
                              ×
                            </button>
                          )}
                        </div>
                      </label>
                    ))}
                  </div>
                  <p className="mt-2 text-[16px] font-medium text-slate-500">
                    Tarih girildiğinde “Form Yayında” otomatik açılır; form başlangıçta yayına girer, bitişte kendiliğinden kalkar. Boş alan sınır koymaz.
                  </p>
                  {formStatus && (
                    <p className={`mt-2 rounded-md border px-3 py-1.5 text-[16px] font-bold ${TONE_BADGE[formStatus.tone]}`}>
                      Şu an: {formStatus.label} — {formStatus.detail}
                    </p>
                  )}
                </div>
              </SectionCard>

              <SectionCard step={2} title="Bilgilendirme Penceresi" description="Vatandaş başvuru sayfasını açtığında ilk göreceği bilgilendirme ekranı.">
                <div className="grid gap-5 md:grid-cols-[190px_minmax(0,1fr)] md:items-start">
                  <div className="space-y-2">
                    <div className="flex h-40 items-center justify-center overflow-hidden rounded-lg border border-slate-200 bg-[#f6f8fb]">
                      <img src={intro.imageUrl || branding.logoUrl} alt="Popup görseli" className="h-full w-full object-contain p-2" />
                    </div>
                    <p className="text-center text-[15px] font-semibold text-slate-500">
                      {intro.imageUrl ? (imageBytes ? `Yüklenen görsel · ${formatBytes(imageBytes)}` : 'Bağlantıdan görsel') : 'Kurum logosu kullanılıyor'}
                    </p>
                    <label className={`${primaryButton} w-full cursor-pointer`}>
                      {isOptimizingImage ? 'İşleniyor…' : 'Resim Yükle'}
                      <input
                        type="file"
                        accept="image/*"
                        onChange={event => {
                          handleImageUpload(selectedForm.id, event.target.files?.[0])
                          event.target.value = ''
                        }}
                        className="hidden"
                      />
                    </label>
                    {imageBytes > LARGE_IMAGE_BYTES && (
                      <button type="button" onClick={() => void optimizeCurrentImage(selectedForm.id)} disabled={isOptimizingImage} className={`${secondaryButton} w-full border-amber-300 text-amber-800`}>
                        Görseli Optimize Et
                      </button>
                    )}
                    {intro.imageUrl && (
                      <button type="button" onClick={() => updateIntro(selectedForm.id, 'imageUrl', '')} className={`${secondaryButton} w-full`}>
                        Görseli Kaldır
                      </button>
                    )}
                  </div>
                  <div className="grid gap-3">
                    <label className="flex flex-col gap-1.5">
                      <span className={labelClass}>Başlık</span>
                      <input
                        type="text"
                        value={intro.title}
                        onChange={event => updateIntro(selectedForm.id, 'title', event.target.value)}
                        placeholder={selectedForm.title}
                        className={`${inputClass} font-bold`}
                      />
                    </label>
                    <label className="flex flex-col gap-1.5">
                      <span className={labelClass}>Açıklama</span>
                      <textarea
                        rows={8}
                        value={intro.description}
                        onChange={event => updateIntro(selectedForm.id, 'description', event.target.value)}
                        placeholder="Başvuruya devam etmeden önce vatandaşın okumasını istediğiniz bilgilendirme metnini yazın."
                        className={`${inputClass} leading-relaxed`}
                      />
                    </label>
                    {!intro.imageUrl.startsWith('data:') && (
                      <label className="flex flex-col gap-1.5">
                        <span className={labelClass}>Görsel Bağlantısı (isteğe bağlı)</span>
                        <input
                          type="text"
                          value={intro.imageUrl}
                          onChange={event => updateIntro(selectedForm.id, 'imageUrl', event.target.value)}
                          placeholder="Boş bırakılırsa kurum logosu kullanılır"
                          className={`${inputClass} text-[16px]`}
                        />
                      </label>
                    )}
                  </div>
                </div>
              </SectionCard>

              <SectionCard step={3} title="Başvuru Kriterleri" description="Bu forma özel ön eleme kuralları. Kurala uymayan kişinin başvurusu alınmaz.">
                <div className="mb-4 rounded-lg border border-[#1E2A38]/10 bg-[#f6f8fb] p-3">
                  <p className="text-[16px] font-bold text-[#1E2A38]">Her formda otomatik uygulanan kurallar</p>
                  <ul className="mt-1.5 grid gap-1 text-[16px] font-medium text-slate-600 md:grid-cols-2">
                    {ALWAYS_APPLIED_RULES.map(rule => (
                      <li key={rule} className="flex gap-1.5"><span className="text-[#0E7C86]">✓</span>{rule}</li>
                    ))}
                  </ul>
                  <p className="mt-2 text-[15px] font-medium text-slate-500">
                    Başvuruyu alıp “Otomatik Red” aşamasına düşüren dönem sınırları (gelir, yaş, araç, yabancı uyruklu) ise
                    <span className="font-bold"> Ayarlar › Yardım Kriterleri</span> ekranından, form başlığındaki döneme göre okunur.
                  </p>
                </div>

                <div className="space-y-2">
                  {activeCriteriaRows.map(option => {
                    const usedTypes = activeCriteriaRows.map(row => row.type)
                    const selectable = ONLINE_CRITERION_OPTIONS.filter(candidate => candidate.type === option.type || !usedTypes.includes(candidate.type))
                    return (
                      <div key={option.type} className="grid gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 sm:grid-cols-[minmax(0,1fr)_auto_32px] sm:items-center">
                        <select
                          value={option.type}
                          onChange={event => changeCriterion(selectedForm.id, option.type, event.target.value as OnlineCriterionType)}
                          className={inputClass}
                        >
                          {selectable.map(candidate => (
                            <option key={candidate.type} value={candidate.type}>{candidate.label}</option>
                          ))}
                        </select>
                        {option.valueField ? (
                          <div className="flex items-center gap-2">
                            <input
                              type="number"
                              min={option.min || 1}
                              value={Number(criteria[option.valueField]) || option.defaultValue || 1}
                              onChange={event => updateCriteria(
                                selectedForm.id,
                                option.valueField!,
                                Math.max(option.min || 1, Number(event.target.value) || option.defaultValue || 1) as OnlineApplicationCriteria[typeof option.valueField],
                              )}
                              className={`${inputClass} w-28 font-bold`}
                              aria-label={option.label}
                            />
                            <span className="w-10 text-[16px] font-semibold text-slate-500">{option.unit}</span>
                          </div>
                        ) : (
                          <span className="hidden sm:block" />
                        )}
                        <button
                          type="button"
                          onClick={() => removeCriterion(selectedForm.id, option.type)}
                          className="flex h-8 w-8 items-center justify-center rounded-md text-[20px] font-bold text-slate-400 hover:bg-rose-50 hover:text-rose-600"
                          aria-label="Kriteri kaldır"
                        >
                          ×
                        </button>
                      </div>
                    )
                  })}
                  {criteria.manualInfoCriteria.map((item, index) => (
                    <div key={`manual-${index}`} className="grid gap-2 rounded-lg border border-dashed border-slate-300 bg-white px-3 py-2 sm:grid-cols-[auto_minmax(0,1fr)_32px] sm:items-center">
                      <span className="rounded bg-slate-100 px-2 py-1 text-[14px] font-bold uppercase text-slate-500">Bilgi</span>
                      <input
                        type="text"
                        value={item}
                        onChange={event => setManualCriteria(selectedForm.id, items => items.map((value, itemIndex) => (itemIndex === index ? event.target.value : value)))}
                        placeholder="Vatandaşa gösterilecek bilgilendirme maddesi. Örn: Şahsın vergi mükellefi olmaması gerekir."
                        className={inputClass}
                      />
                      <button
                        type="button"
                        onClick={() => setManualCriteria(selectedForm.id, items => items.filter((_, itemIndex) => itemIndex !== index))}
                        className="flex h-8 w-8 items-center justify-center rounded-md text-[20px] font-bold text-slate-400 hover:bg-rose-50 hover:text-rose-600"
                        aria-label="Bilgilendirme maddesini kaldır"
                      >
                        ×
                      </button>
                    </div>
                  ))}
                  {activeCriteriaRows.length === 0 && criteria.manualInfoCriteria.length === 0 && (
                    <p className="rounded-lg border border-dashed border-slate-300 px-3 py-3 text-center text-[16px] font-semibold text-slate-500">
                      Bu forma özel kriter yok; yalnızca yukarıdaki genel kurallar uygulanır.
                    </p>
                  )}
                  <div className="flex flex-wrap gap-2 pt-1">
                    <button
                      type="button"
                      onClick={() => addCriterion(selectedForm.id)}
                      disabled={activeCriteriaRows.length >= ONLINE_CRITERION_OPTIONS.length}
                      className={secondaryButton}
                    >
                      + Kriter Ekle
                    </button>
                    <button type="button" onClick={() => setManualCriteria(selectedForm.id, items => [...items, ''])} className={secondaryButton}>
                      + Bilgilendirme Maddesi
                    </button>
                  </div>
                </div>
              </SectionCard>

              <SectionCard
                step={4}
                title="Form Alanları"
                description="Vatandaşın dolduracağı alanlar, görünme sırasıyla."
                aside={<span className="rounded-full bg-slate-200/70 px-2.5 py-1 text-[15px] font-bold text-slate-600">{selectedForm.fields.length} alan</span>}
              >
                <p className="mb-3 text-[16px] font-medium text-slate-500">
                  T.C. Kimlik No ve Doğum Tarihi her formda en üstte sorulur; ad soyad ve adres nüfus kaydından otomatik doldurulur.
                  Araç / Gelir / İBAN alanları kendi aralarında sabit sırada gösterilir.
                </p>
                <div className="space-y-2">
                  {selectedForm.fields.map((field, index) => {
                    const conditionSource = selectedForm.fields.find(candidate => candidate.id === field.showWhen?.fieldId)
                    const conditionCandidates = selectedForm.fields.filter(candidate => candidate.id !== field.id && candidate.type === 'select')
                    const showCondition = !field.isFixed && (Boolean(field.showWhen?.fieldId) || openConditionIds.includes(field.id))
                    const typeOptions = field.type === 'file' ? [...SELECTABLE_FIELD_TYPES, 'file' as const] : SELECTABLE_FIELD_TYPES
                    return (
                      <div key={field.id} className={`rounded-lg border bg-white ${field.isFixed ? 'border-slate-200 bg-slate-50/60' : 'border-slate-200'}`}>
                        <div className="grid gap-2 p-2.5 md:grid-cols-[56px_minmax(0,1fr)_170px_112px_88px_36px] md:items-center">
                          <div className="flex items-center gap-1">
                            <span className="w-5 text-center text-[16px] font-bold text-slate-400">{index + 1}</span>
                            <div className="flex flex-col">
                              <button type="button" onClick={() => moveField(selectedForm.id, index, -1)} disabled={index === 0} className="h-4 text-[14px] leading-none text-slate-400 hover:text-[#0E7C86] disabled:opacity-30" aria-label="Yukarı taşı">▲</button>
                              <button type="button" onClick={() => moveField(selectedForm.id, index, 1)} disabled={index === selectedForm.fields.length - 1} className="h-4 text-[14px] leading-none text-slate-400 hover:text-[#0E7C86] disabled:opacity-30" aria-label="Aşağı taşı">▼</button>
                            </div>
                          </div>
                          <input
                            type="text"
                            value={field.label}
                            disabled={field.isFixed}
                            onChange={event => updateField(selectedForm.id, field.id, 'label', event.target.value)}
                            className={`${inputClass} ${!field.label.trim() ? 'border-rose-400' : ''}`}
                            placeholder="Alan adı"
                          />
                          <select
                            value={field.type}
                            disabled={field.isFixed}
                            onChange={event => updateFieldType(selectedForm.id, field.id, event.target.value as OnlineFormField['type'])}
                            className={`${inputClass} ${field.type === 'file' ? 'border-amber-400 text-amber-800' : ''}`}
                          >
                            {typeOptions.map(type => <option key={type} value={type}>{FIELD_TYPE_LABELS[type]}</option>)}
                          </select>
                          <label className="flex cursor-pointer items-center gap-2 text-[16px] font-bold text-slate-600">
                            <input
                              type="checkbox"
                              checked={field.required}
                              onChange={event => updateField(selectedForm.id, field.id, 'required', event.target.checked)}
                              className="h-4 w-4 accent-[#0E7C86]"
                            />
                            Zorunlu
                          </label>
                          {field.isFixed ? <span className="hidden md:block" /> : (
                            <button
                              type="button"
                              onClick={() => setOpenConditionIds(prev => (prev.includes(field.id) ? prev.filter(id => id !== field.id) : [...prev, field.id]))}
                              className={`rounded-md border px-2 py-1.5 text-[15px] font-bold transition ${field.showWhen?.fieldId ? 'border-[#0E7C86]/40 bg-[#0E7C86]/10 text-[#0A5F67]' : 'border-slate-200 text-slate-500 hover:border-[#0E7C86]/40 hover:text-[#0A5F67]'}`}
                              title="Bu alanın hangi cevapta görüneceğini belirleyin"
                            >
                              {field.showWhen?.fieldId ? 'Koşullu' : 'Koşul'}
                            </button>
                          )}
                          {field.isFixed ? (
                            <span title="Sistem alanı - değiştirilemez" className="flex h-8 w-8 items-center justify-center rounded-md bg-slate-200/70 text-[16px] text-slate-500">🔒</span>
                          ) : (
                            <button
                              type="button"
                              onClick={() => void removeField(selectedForm.id, field)}
                              className="flex h-8 w-8 items-center justify-center rounded-md text-[20px] font-bold text-slate-400 hover:bg-rose-50 hover:text-rose-600"
                              title="Alanı sil"
                            >
                              ×
                            </button>
                          )}
                        </div>

                        {(field.type === 'select' || showCondition) && (
                          <div className={`grid gap-3 border-t border-slate-100 px-2.5 py-2.5 ${field.type === 'select' && showCondition ? 'md:grid-cols-2' : ''}`}>
                            {field.type === 'select' && (
                              <label className="flex flex-col gap-1">
                                <span className={labelClass}>Seçenekler <span className="font-medium normal-case tracking-normal text-slate-400">(her satıra bir seçenek)</span></span>
                                <textarea
                                  rows={2}
                                  value={(field.options ?? []).join('\n')}
                                  onChange={event => updateFieldOptions(selectedForm.id, field.id, event.target.value)}
                                  onBlur={event => updateFieldOptions(selectedForm.id, field.id, event.target.value, true)}
                                  placeholder={'Var\nYok'}
                                  className={`${inputClass} ${(field.options ?? []).filter(option => option.trim()).length === 0 ? 'border-rose-400' : ''}`}
                                />
                              </label>
                            )}
                            {showCondition && (
                              <div className={`grid gap-2 ${field.type === 'select' ? '' : 'sm:grid-cols-2'}`}>
                                <label className="flex flex-col gap-1">
                                  <span className={labelClass}>Görünme koşulu</span>
                                  <select
                                    value={field.showWhen?.fieldId || ''}
                                    onChange={event => updateFieldCondition(selectedForm.id, field.id, 'fieldId', event.target.value)}
                                    className={inputClass}
                                  >
                                    <option value="">Her zaman görünsün</option>
                                    {conditionCandidates.map(candidate => (
                                      <option key={candidate.id} value={candidate.id}>“{candidate.label}” alanına göre</option>
                                    ))}
                                  </select>
                                </label>
                                {field.showWhen?.fieldId && (
                                  <label className="flex flex-col gap-1">
                                    <span className={labelClass}>Şu değer seçilince</span>
                                    {conditionSource?.options?.some(option => option.trim()) ? (
                                      <select
                                        value={field.showWhen.value || ''}
                                        onChange={event => updateFieldCondition(selectedForm.id, field.id, 'value', event.target.value)}
                                        className={`${inputClass} ${!field.showWhen.value ? 'border-rose-400' : ''}`}
                                      >
                                        <option value="">Değer seçin</option>
                                        {conditionSource.options.filter(option => option.trim()).map(option => <option key={option} value={option}>{option}</option>)}
                                      </select>
                                    ) : (
                                      <input
                                        type="text"
                                        value={field.showWhen.value || ''}
                                        onChange={event => updateFieldCondition(selectedForm.id, field.id, 'value', event.target.value)}
                                        placeholder="Örn: Var"
                                        className={`${inputClass} ${!field.showWhen.value ? 'border-rose-400' : ''}`}
                                      />
                                    )}
                                  </label>
                                )}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>

                <div className="mt-3 grid gap-2 rounded-lg border border-dashed border-[#0E7C86]/40 bg-[#0E7C86]/[0.03] p-2.5 md:grid-cols-[minmax(0,1fr)_170px_auto]">
                  <input
                    type="text"
                    placeholder="Yeni alan adı… (ör. Hanede Engelli Birey Var mı?)"
                    value={newFieldName}
                    onChange={event => setNewFieldName(event.target.value)}
                    onKeyDown={event => {
                      if (event.key === 'Enter') {
                        event.preventDefault()
                        addField(selectedForm.id)
                      }
                    }}
                    className={inputClass}
                  />
                  <select value={newFieldType} onChange={event => setNewFieldType(event.target.value as OnlineFormField['type'])} className={inputClass}>
                    {SELECTABLE_FIELD_TYPES.map(type => <option key={type} value={type}>{FIELD_TYPE_LABELS[type]}</option>)}
                  </select>
                  <button type="button" onClick={() => addField(selectedForm.id)} disabled={!newFieldName.trim()} className={primaryButton}>
                    + Alan Ekle
                  </button>
                </div>
              </SectionCard>

              <div className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-[16px] font-bold text-[#1E2A38]">Form işlemleri</p>
                  <p className="text-[15px] font-medium text-slate-500">Kopya pasif ve zamanlamasız oluşturulur. Silinen formun önceki başvuruları korunur.</p>
                </div>
                <div className="flex gap-2">
                  <button type="button" onClick={() => duplicateForm(selectedForm)} className={secondaryButton}>Formu Çoğalt</button>
                  <button type="button" onClick={() => void removeForm(selectedForm)} className="inline-flex items-center rounded-lg border border-rose-200 bg-white px-3 py-2 text-[16px] font-bold text-rose-600 hover:bg-rose-50">
                    Formu Sil
                  </button>
                </div>
              </div>
            </>
          )}
        </div>

      </div>
    </div>
  )
}
