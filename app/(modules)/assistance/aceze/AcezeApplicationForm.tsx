'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { renderToStaticMarkup } from 'react-dom/server'
import { FormDesignRenderer, type FormDesign } from '@/components/shared/FormDesignRenderer'
import { printFormDesignHtml } from '@/lib/printFormDesign'
import { usePersonPredefinedOptions } from '@/lib/hooks/usePersonPredefinedOptions'
import { REQUIRED_PRINT_AGENT_VERSION } from '@/lib/printAgentClient'

const today = () => new Date().toISOString().slice(0, 10)

const initialForm = {
  nationality: 'T.C.',
  identityNumber: '',
  fullName: '',
  fatherName: '',
  motherName: '',
  birthPlace: '',
  birthDate: '',
  maritalStatus: '',
  gender: '',
  healthStatus: '',
  illnessName: '',
  registryCity: '',
  phone: '',
  date: today(),
  personCount: '1',
  amount: '',
  destination: '',
  reason: '',
}

// Kullanici istegi (Genel Tipografi Tutarlilik Duzeltmesi): bu form kendi
// kucuk "Field"/inputClass'ini kullaniyordu ve etiket/govde puntolari
// uygulamanin geri kalanindan (ör. Gulkart panelleri) belirgin sekilde
// kucuk/soluk kaliyordu. Merkezi ".ns-*" recipe siniflarina (bkz.
// app/globals.css --text-ns-* token'lari) tasindi.
const inputClass = 'min-h-11 w-full min-w-0 rounded-lg border border-slate-200 bg-white px-3 ns-body outline-none transition focus:border-[#0076b6] focus:ring-2 focus:ring-sky-100'
const localPrintAgentUrl = 'http://127.0.0.1:17834/print'
// Kullanici istegi (2026-09-29): "agent sürümü eski diyor" hatasi - bkz.
// documents/page.tsx'teki ayni tarihli duzeltme notu. Tek kaynaktan okunur.
const requiredPrintAgentVersion = REQUIRED_PRINT_AGENT_VERSION
const directPrintAgentEnabled = false
const printerConfigKey = 'netsosyal:form-designer:client-printer-config'
const printerPreferencesKey = 'netsosyal:form-designer:client-printer-preferences'

type SavedAcezeForm = typeof initialForm & { id: string }

function normalizeKey(value?: string) {
  return String(value || '').replace(/\s+/g, ' ').trim().toLocaleLowerCase('tr-TR')
}

function resolvePrinterName(design: FormDesign) {
  try {
    const preferences = JSON.parse(localStorage.getItem(printerPreferencesKey) || '{}') as Record<string, string>
    const config = JSON.parse(localStorage.getItem(printerConfigKey) || '{}') as {
      designPrinters?: Record<string, string>
      assistancePrinters?: Record<string, string>
    }
    const manualPrinter = preferences[design.id]?.trim()
    if (manualPrinter) return manualPrinter

    const designPrinter = Object.entries(config.designPrinters || {}).find(([name]) => normalizeKey(name) === normalizeKey(design.name))?.[1]?.trim()
    if (designPrinter) return designPrinter

    return ''
  } catch {
    return ''
  }
}

function buildAgentHtml(title: string, content: string, design: FormDesign) {
  const size = design.type === 'a4' ? 'A4' : `${Number(design.width || 80)}mm ${Number(design.height || 40)}mm`
  return `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title><style>
    @page{size:${size};margin:0}*{box-sizing:border-box}html,body{margin:0;padding:0;background:#fff;color:#000;font-family:Arial,sans-serif}
    .relative{position:relative}.absolute{position:absolute}.pointer-events-none{pointer-events:none}.overflow-hidden{overflow:hidden}
    .border{border:1px solid #e2e8f0}.border-none{border:0}.border-b{border-bottom:1px solid #e2e8f0}.border-dashed{border-style:dashed}
    .bg-white{background:#fff}.bg-slate-950{background:#020617}.bg-slate-50{background:#f8fafc}.leading-tight{line-height:1.25}
    .break-words{overflow-wrap:break-word}.whitespace-nowrap{white-space:nowrap}.flex{display:flex}.flex-col{flex-direction:column}
    .items-center{align-items:center}.gap-1{gap:.25rem}.flex-1{flex:1 1 0%}.w-full{width:100%}.text-center{text-align:center}
  </style></head><body>${content}</body></html>`
}

export function AcezeApplicationForm() {
  const router = useRouter()
  const [form, setForm] = useState(initialForm)
  const [saving, setSaving] = useState(false)
  const [lookupStatus, setLookupStatus] = useState<'idle' | 'loading'>('idle')
  const [lookupMessage, setLookupMessage] = useState('')
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [formDesigns, setFormDesigns] = useState<FormDesign[]>([])
  const [lastSaved, setLastSaved] = useState<SavedAcezeForm | null>(null)
  const [printing, setPrinting] = useState(false)
  const { maritalStatusOptions, genderOptions } = usePersonPredefinedOptions()

  useEffect(() => {
    fetch('/api/settings/form_design_templates', { cache: 'no-store' })
      .then(async (response) => ({ response, payload: await response.json() }))
      .then(({ response, payload }) => {
        if (response.ok && payload.success && Array.isArray(payload.data?.value)) setFormDesigns(payload.data.value)
      })
      .catch(() => setFormDesigns([]))
  }, [])

  const update = (field: keyof typeof form, value: string) => setForm((current) => ({ ...current, [field]: value }))

  const lookupFromNvi = async () => {
    if (!/^\d{11}$/.test(form.identityNumber) || !/^\d{4}-\d{2}-\d{2}$/.test(form.birthDate)) {
      setLookupMessage('NVI sorgusu için 11 haneli T.C. Kimlik No ve doğum tarihini girin.')
      return
    }

    setLookupStatus('loading')
    setLookupMessage('Kimlik bilgileri NVI üzerinden sorgulanıyor...')
    try {
      const response = await fetch('/api/nvi', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tcNo: form.identityNumber,
          dogumYili: new Date(form.birthDate).getFullYear(),
          dogumTarihi: form.birthDate,
          serviceId: 'tcKimlik',
        }),
      })
      const payload = await response.json()
      if (!response.ok || !payload.success || !payload.data) {
        setLookupMessage(`${payload.error || 'NVI kaydı bulunamadı.'} Bilgileri manuel doldurabilirsiniz.`)
        return
      }

      const person = payload.data
      const gender = String(person.cinsiyet || '').toLocaleUpperCase('tr-TR')
      const maritalText = String(person.medeniHal || '').toLocaleUpperCase('tr-TR')
      const resolvedGender = genderOptions.find((option) => {
        const label = option.name.toLocaleUpperCase('tr-TR')
        return option.id.toLocaleUpperCase('tr-TR') === gender || label === gender || (gender === 'ERKEK' && label.includes('ERKEK')) || (gender === 'KADIN' && label.includes('KADIN'))
      })?.id
      const resolvedMaritalStatus = maritalStatusOptions.find((option) => {
        const label = option.name.toLocaleUpperCase('tr-TR')
        return option.id === maritalText || label === maritalText || label.includes(maritalText) || maritalText.includes(label)
      })?.id
      setForm((current) => ({
        ...current,
        identityNumber: String(person.tcKimlikNo || current.identityNumber),
        fullName: [person.ad, person.soyad].filter(Boolean).join(' ') || current.fullName,
        fatherName: String(person.babaAdi || current.fatherName),
        motherName: String(person.anneAdi || current.motherName),
        birthPlace: String(person.dogumYeri || current.birthPlace),
        birthDate: current.birthDate,
        gender: resolvedGender || current.gender,
        maritalStatus: resolvedMaritalStatus || current.maritalStatus,
      }))
      setLookupMessage('Kimlik bilgileri NVI üzerinden başarıyla getirildi. Alanları kontrol ederek başvuruyu kaydedebilirsiniz.')
    } catch {
      setLookupMessage('NVI servisine ulaşılamadı. Bilgileri manuel doldurabilirsiniz.')
    } finally {
      setLookupStatus('idle')
    }
  }

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    setSaving(true)
    setError('')
    setSuccess('')

    try {
      const response = await fetch('/api/assistance/aceze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })
      const payload = await response.json()
      if (!response.ok) throw new Error(payload.error || 'Başvuru kaydedilemedi.')

      const savedForm = { ...form, id: String(payload.data.id) }
      setLastSaved(savedForm)
      setSuccess(`Aceze başvurusu yrd_aceze tablosuna kaydedildi. Kayıt no: ${payload.data.id}`)
      setForm({ ...initialForm, date: today() })
      setLookupMessage('')
      router.refresh()
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'Başvuru kaydedilemedi.')
    } finally {
      setSaving(false)
    }
  }

  const printSavedApplication = async () => {
    if (!lastSaved) {
      setError('Yazdırmadan önce başvuruyu kaydetmelisiniz.')
      return
    }

    const design = formDesigns.find((item) => normalizeKey(item.linkedAssistance) === 'aceze')
      || formDesigns.find((item) => normalizeKey(item.linkedAssistance).includes('aceze') || normalizeKey(item.name).includes('aceze'))
    if (!design) {
      setError('Aceze form dizaynı bulunamadı. Ayarlar > Form Dizayn alanında Aceze tasarımını tanımlayın.')
      return
    }

    setPrinting(true)
    setError('')
    const data = {
      aceze: {
        id: lastSaved.id,
        tc: lastSaved.identityNumber,
        ad_soyad: lastSaved.fullName,
        baba_adi: lastSaved.fatherName,
        ana_adi: lastSaved.motherName,
        dogum_yeri: lastSaved.birthPlace,
        dogum_tarihi: lastSaved.birthDate,
        uyruk: lastSaved.nationality,
        medeni_hal: lastSaved.maritalStatus,
        cinsiyet: lastSaved.gender,
        nufusa_kayitli_il: lastSaved.registryCity,
        saglik_durumu: lastSaved.healthStatus,
        hastalik: lastSaved.illnessName,
        gidecegi_yer: lastSaved.destination,
        neden: lastSaved.reason,
        tarih: lastSaved.date,
        kisi_sayisi: lastSaved.personCount,
        tutar: lastSaved.amount,
        telefon: lastSaved.phone,
      },
      'aceze.tutar': lastSaved.amount,
      'aceze.tc': lastSaved.identityNumber,
      'aceze.ad_soyad': lastSaved.fullName,
      'aceze.baba_adi': lastSaved.fatherName,
      'aceze.ana_adi': lastSaved.motherName,
      'aceze.dogum_yeri': lastSaved.birthPlace,
      'aceze.dogum_tarihi': lastSaved.birthDate,
      'aceze.uyruk': lastSaved.nationality,
      'aceze.medeni_hal': lastSaved.maritalStatus,
      'aceze.cinsiyet': lastSaved.gender,
      'aceze.nufusa_kayitli_il': lastSaved.registryCity,
      'aceze.telefon': lastSaved.phone,
      'aceze.kisi_sayisi': lastSaved.personCount,
      'aceze.tarih': lastSaved.date,
      'aceze.saglik_durumu': lastSaved.healthStatus,
      'aceze.hastalik': lastSaved.illnessName,
      'aceze.gidecegi_yer': lastSaved.destination,
      'aceze.neden': lastSaved.reason,
    }
    const renderedHtml = renderToStaticMarkup(<FormDesignRenderer design={design} data={data} preview={false} />)
    const printerName = resolvePrinterName(design)

    try {
      if (printerName && directPrintAgentEnabled) {
        const response = await fetch(localPrintAgentUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            printerName,
            title: design.name,
            assistanceType: design.linkedAssistance,
            designName: design.name,
            html: buildAgentHtml(design.name, renderedHtml, design),
          }),
        })
        const payload = await response.json().catch(() => ({}))
        if (!response.ok || payload.success === false) throw new Error(payload.error || 'Yazıcı baskıyı kabul etmedi.')
        if (payload.agentVersion !== requiredPrintAgentVersion) throw new Error(`Yazdırma agentı güncel değil. Agenttan Al ile ${requiredPrintAgentVersion} sürümünü yeniden kurun.`)
        setSuccess(`Kayıt ${printerName} yazıcısına gönderildi.`)
      } else {
        printFormDesignHtml(design.name, renderedHtml, {
          widthMm: design.type === 'a4' ? undefined : Number(design.width || 80),
          heightMm: design.type === 'a4' ? undefined : Number(design.height || 40),
          offsetXmm: Number(design.printOffsetX || 0),
          offsetYmm: Number(design.printOffsetY || 0),
          insetRightMm: Number(design.printOffsetRight || 0),
          insetBottomMm: Number(design.printOffsetBottom || 0),
        })
        setSuccess(printerName ? `Yazdırma penceresi açıldı. Kayıtlı son yazıcı: ${printerName}` : 'Aceze form dizaynı yazdırma penceresine gönderildi.')
      }
    } catch (printError) {
      setError(`Yazdırma işlemi başarısız: ${printError instanceof Error ? printError.message : 'Bilinmeyen hata'}`)
    } finally {
      setPrinting(false)
    }
  }

  return (
    <form onSubmit={submit} className="overflow-hidden rounded-3xl border border-sky-200/80 bg-white shadow-[0_24px_65px_-35px_rgba(0,95,149,0.65)]">
      <div className="relative overflow-hidden border-b border-white/15 bg-gradient-to-br from-[#004f7d] via-[#007bb8] to-[#28a776] px-5 py-6 text-white sm:px-7 sm:py-7">
        <div className="absolute -right-16 -top-20 h-52 w-52 rounded-full border-[28px] border-white/10" />
        <div className="absolute bottom-0 right-1/4 h-20 w-20 translate-y-1/2 rounded-full bg-emerald-300/20 blur-xl" />
        <div className="relative flex items-center gap-4">
          <div className="hidden h-14 w-14 shrink-0 items-center justify-center rounded-2xl border border-white/25 bg-white/15 shadow-inner backdrop-blur sm:flex">
            <svg className="h-7 w-7" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M12 6v12m6-6H6M5 4h14a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1Z" /></svg>
          </div>
          <div><p className="text-[11px] font-black uppercase tracking-[0.2em] text-sky-100">Aceze Yardımı</p>
          <h1 className="mt-1 text-2xl font-black tracking-tight sm:text-3xl">Yeni Başvuru Formu</h1>
          <p className="mt-1.5 text-sm font-semibold text-white/85">Başvuru sahibi ve yardım bilgilerini eksiksiz girin.</p></div>
        </div>
      </div>

      <div className="grid min-w-0 gap-5 bg-gradient-to-b from-slate-50/70 to-white p-4 lg:grid-cols-2 lg:p-7">
        <fieldset className="grid min-w-0 gap-3 rounded-2xl border border-sky-200 bg-gradient-to-br from-white to-sky-50/70 p-4 shadow-[0_14px_30px_-24px_rgba(2,132,199,0.8)] sm:p-5">
          <legend className="ns-section-title rounded-full border border-sky-200 bg-sky-100 px-4 py-1.5 uppercase tracking-wider text-[#005f95] shadow-sm">Kişi Bilgileri</legend>
          <div className="grid min-w-0 gap-3 sm:grid-cols-2">
            <div className="grid min-w-0 gap-3 rounded-2xl border border-sky-200 bg-gradient-to-r from-sky-100/80 to-cyan-50 p-3 shadow-inner sm:col-span-2 sm:grid-cols-2">
              <Field label="T.C. Kimlik No"><input inputMode="numeric" maxLength={11} value={form.identityNumber} onChange={(e) => { update('identityNumber', e.target.value.replace(/\D/g, '')); setLookupMessage('') }} className={inputClass} /></Field>
              <Field label="Doğum Tarihi"><input type="date" value={form.birthDate} onChange={(e) => { update('birthDate', e.target.value); setLookupMessage('') }} className={inputClass} /></Field>
              <div className="flex min-w-0 flex-col gap-2 sm:col-span-2 sm:flex-row sm:items-center">
                <button type="button" onClick={() => void lookupFromNvi()} disabled={lookupStatus === 'loading'} className="min-h-11 shrink-0 rounded-lg bg-[#0076b6] px-5 text-sm font-black text-white shadow-sm hover:bg-[#005f95] disabled:cursor-wait disabled:opacity-60">
                  {lookupStatus === 'loading' ? 'NVI Sorgulanıyor...' : 'NVI’den Sorgula'}
                </button>
                <p className={`min-w-0 text-xs font-bold leading-5 ${lookupMessage.includes('başarıyla') ? 'text-emerald-700' : 'text-slate-600'}`}>{lookupMessage || 'Kayıt bulunursa bilgiler otomatik gelir; bulunamazsa alanları manuel doldurabilirsiniz.'}</p>
              </div>
            </div>
            <Field label="Uyruğu"><select value={form.nationality} onChange={(e) => update('nationality', e.target.value)} className={inputClass}><option value="T.C.">T.C.</option><option value="Yabancı">Yabancı</option></select></Field>
            <div className="sm:col-span-2"><Field label="Ad Soyad" required><input required maxLength={100} value={form.fullName} onChange={(e) => update('fullName', e.target.value)} className={inputClass} /></Field></div>
            <Field label="Baba Adı"><input maxLength={50} value={form.fatherName} onChange={(e) => update('fatherName', e.target.value)} className={inputClass} /></Field>
            <Field label="Ana Adı"><input maxLength={50} value={form.motherName} onChange={(e) => update('motherName', e.target.value)} className={inputClass} /></Field>
            <Field label="Doğum Yeri"><input maxLength={50} value={form.birthPlace} onChange={(e) => update('birthPlace', e.target.value)} className={inputClass} /></Field>
            <Field label="Medeni Hali"><select value={form.maritalStatus} onChange={(e) => update('maritalStatus', e.target.value)} className={inputClass}><option value="">Seçiniz</option>{maritalStatusOptions.map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}</select></Field>
            <Field label="Cinsiyeti"><select value={form.gender} onChange={(e) => update('gender', e.target.value)} className={inputClass}><option value="">Seçiniz</option>{genderOptions.map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}</select></Field>
            <Field label="Sağlık Durumu"><select value={form.healthStatus} onChange={(e) => update('healthStatus', e.target.value)} className={inputClass}><option value="">Seçiniz</option><option value="1">Sağlıklı</option><option value="2">Hasta</option><option value="3">Engelli</option></select></Field>
            <Field label="Hastalık Adı"><input maxLength={100} value={form.illnessName} onChange={(e) => update('illnessName', e.target.value)} className={inputClass} /></Field>
            <Field label="Nüfusa Kayıtlı İl"><input maxLength={50} value={form.registryCity} onChange={(e) => update('registryCity', e.target.value)} className={inputClass} /></Field>
            <Field label="Cep Telefonu"><input inputMode="tel" maxLength={20} value={form.phone} onChange={(e) => update('phone', e.target.value)} className={inputClass} /></Field>
          </div>
        </fieldset>

        <fieldset className="grid min-w-0 content-start gap-3 rounded-2xl border border-emerald-200 bg-gradient-to-br from-white to-emerald-50/80 p-4 shadow-[0_14px_30px_-24px_rgba(5,150,105,0.8)] sm:p-5">
          <legend className="ns-section-title rounded-full border border-emerald-200 bg-emerald-100 px-4 py-1.5 uppercase tracking-wider text-emerald-800 shadow-sm">Yardım Bilgileri</legend>
          <div className="grid min-w-0 gap-3 sm:grid-cols-2">
            <Field label="Başvuru Tarihi" required><input required type="date" value={form.date} onChange={(e) => update('date', e.target.value)} className={inputClass} /></Field>
            <Field label="Kişi Sayısı" required><input required type="number" min="1" max="99" value={form.personCount} onChange={(e) => update('personCount', e.target.value)} className={inputClass} /></Field>
            <Field label="Tutar (TL)"><input inputMode="decimal" placeholder="İsteğe bağlı — sonradan da girilebilir" value={form.amount} onChange={(e) => update('amount', e.target.value.replace(/[^0-9.,]/g, ''))} className={inputClass} /></Field>
            <div className="sm:col-span-2"><Field label="Gideceği Yer"><input maxLength={150} value={form.destination} onChange={(e) => update('destination', e.target.value)} className={inputClass} /></Field></div>
            <div className="sm:col-span-2"><Field label="Başvuru Nedeni" required><textarea required maxLength={500} rows={8} value={form.reason} onChange={(e) => update('reason', e.target.value)} className={`${inputClass} resize-y py-3`} /></Field></div>
          </div>
        </fieldset>
      </div>

      {(error || success) && <div className={`mx-4 mb-4 rounded-lg border px-4 py-3 text-sm font-bold lg:mx-6 ${error ? 'border-rose-200 bg-rose-50 text-rose-700' : 'border-emerald-200 bg-emerald-50 text-emerald-700'}`}>{error || success}</div>}

      <div className="flex flex-col-reverse gap-2 border-t border-slate-100 bg-gradient-to-r from-slate-50 via-white to-sky-50 px-4 py-5 sm:flex-row sm:justify-end sm:px-7">
        <button type="button" onClick={() => { setForm({ ...initialForm, date: today() }); setLookupMessage(''); setError(''); setSuccess(''); setLastSaved(null) }} className="min-h-11 rounded-xl border border-slate-200 bg-white px-5 text-sm font-black text-slate-600 shadow-sm transition hover:-translate-y-0.5 hover:bg-slate-100 hover:shadow-md">Formu Temizle</button>
        <button disabled={saving} className="min-h-11 rounded-xl bg-gradient-to-r from-[#006ba6] to-[#0095cf] px-7 text-sm font-black text-white shadow-lg shadow-sky-200 transition hover:-translate-y-0.5 hover:shadow-xl disabled:opacity-60">{saving ? 'Kaydediliyor...' : 'Kaydet'}</button>
        <button type="button" onClick={() => void printSavedApplication()} disabled={!lastSaved || printing} className="min-h-11 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-500 px-7 text-sm font-black text-white shadow-lg shadow-emerald-200 transition hover:-translate-y-0.5 hover:shadow-xl disabled:cursor-not-allowed disabled:opacity-50">{printing ? 'Yazdırılıyor...' : 'Yazdır'}</button>
      </div>
    </form>
  )
}

function Field({ label, required = false, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return <label className="ns-label grid min-w-0 gap-1.5">{label}{required && <span className="sr-only"> zorunlu</span>}{children}</label>
}
