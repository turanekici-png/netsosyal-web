'use client'

import { useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { renderToStaticMarkup } from 'react-dom/server'
import { AdvancedTable } from '@/components/shared/AdvancedTable'
import { FormDesignRenderer, type FormDesign } from '@/components/shared/FormDesignRenderer'
import { printFormDesignHtml } from '@/lib/printFormDesign'
import { usePersonPredefinedOptions } from '@/lib/hooks/usePersonPredefinedOptions'
import { confirmDialog } from '@/components/shared/GlobalConfirmDialog'
import { REQUIRED_PRINT_AGENT_VERSION } from '@/lib/printAgentClient'

type Props = { rows: Record<string, unknown>[]; totalCount: number; currentPage: number; pageSize: number; searchTerm: string }
type FormState = {
  id: string; nationality: string; identityNumber: string; fullName: string; fatherName: string; motherName: string;
  birthPlace: string; birthDate: string; maritalStatus: string; gender: string; healthStatus: string; illnessName: string;
  registryCity: string; phone: string; date: string; personCount: string; amount: string; destination: string; reason: string;
}

// Genel Tipografi Tutarlilik Duzeltmesi - bkz. AcezeApplicationForm.tsx'teki
// ayni not ve app/globals.css --text-ns-* token'lari.
const inputClass = 'min-h-11 w-full min-w-0 rounded-lg border border-slate-200 bg-white px-3 ns-body outline-none focus:border-[#0076b6] focus:ring-2 focus:ring-sky-100'
const printerConfigKey = 'netsosyal:form-designer:client-printer-config'
const printerPreferencesKey = 'netsosyal:form-designer:client-printer-preferences'
const localPrintAgentUrl = 'http://127.0.0.1:17834/print'
// Kullanici istegi (2026-09-29): "agent sürümü eski diyor" hatasi - bu sabit
// eskiden '2.8.0' olarak SABITLENMISTI, gercek agent artik '2.9.0'
// (bkz. documents/page.tsx'teki ayni tarihli duzeltme notu). directPrintAgentEnabled
// false oldugu icin bu dosyada su an FIILEN calismiyor, ama tutarlilik ve
// ileride yeniden acilma ihtimaline karsi TEK kaynaktan okunacak sekilde
// duzeltildi.
const requiredPrintAgentVersion = REQUIRED_PRINT_AGENT_VERSION
const directPrintAgentEnabled = false

function text(value: unknown) { return value == null ? '' : String(value) }
function date(value: unknown) { return text(value).slice(0, 10) }
function normalize(value?: string) { return String(value || '').replace(/\s+/g, ' ').trim().toLocaleLowerCase('tr-TR') }

function rowToForm(row: Record<string, unknown>): FormState {
  return {
    id: text(row.id), nationality: text(row.uyrugu), identityNumber: text(row.tckimlikno), fullName: text(row.adisoyadi),
    fatherName: text(row.babaadi), motherName: text(row.anaadi), birthPlace: text(row.dogumyeri), birthDate: date(row.dogumtarihi),
    maritalStatus: text(row.medenihali), gender: text(row.cinsiyeti).trim(), healthStatus: text(row.saglikdurumu), illnessName: text(row.hastalikadi),
    registryCity: text(row.nufuskytili), phone: text(row.ceptel), date: date(row.tarih), personCount: text(row.kisisayisi || 1),
    amount: text(row.tutar), destination: text(row.gidecegiyer), reason: text(row.nedeni),
  }
}

function printerName(design: FormDesign) {
  try {
    const preferences = JSON.parse(localStorage.getItem(printerPreferencesKey) || '{}') as Record<string, string>
    const config = JSON.parse(localStorage.getItem(printerConfigKey) || '{}') as { designPrinters?: Record<string, string>; assistancePrinters?: Record<string, string> }
    return preferences[design.id]?.trim()
      || Object.entries(config.designPrinters || {}).find(([key]) => normalize(key) === normalize(design.name))?.[1]?.trim()
      || ''
  } catch { return '' }
}

function agentHtml(title: string, content: string, design: FormDesign) {
  const size = design.type === 'a4' ? 'A4' : `${Number(design.width || 80)}mm ${Number(design.height || 40)}mm`
  return `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title><style>@page{size:${size};margin:0}*{box-sizing:border-box}html,body{margin:0;padding:0;background:#fff;color:#000;font-family:Arial,sans-serif}.relative{position:relative}.absolute{position:absolute}.overflow-hidden{overflow:hidden}.flex{display:flex}.flex-col{flex-direction:column}.items-center{align-items:center}.gap-1{gap:.25rem}.flex-1{flex:1}.w-full{width:100%}.text-center{text-align:center}.whitespace-nowrap{white-space:nowrap}</style></head><body>${content}</body></html>`
}

export function AcezeRecordsTable({ rows, totalCount, currentPage, pageSize, searchTerm }: Props) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [search, setSearch] = useState(searchTerm)
  const [form, setForm] = useState<FormState | null>(null)
  const [selectedRow, setSelectedRow] = useState<Record<string, unknown> | null>(null)
  const [designs, setDesigns] = useState<FormDesign[]>([])
  const [busy, setBusy] = useState<'save' | 'delete' | 'print' | ''>('')
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const { maritalStatusOptions, genderOptions } = usePersonPredefinedOptions()
  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize))

  useEffect(() => {
    fetch('/api/settings/form_design_templates', { cache: 'no-store' })
      .then(async (response) => ({ response, payload: await response.json() }))
      .then(({ response, payload }) => { if (response.ok && payload.success && Array.isArray(payload.data?.value)) setDesigns(payload.data.value) })
      .catch(() => setDesigns([]))
  }, [])

  const navigate = (page: number, term = searchTerm) => {
    const params = new URLSearchParams(searchParams.toString())
    params.set('tab', 'list'); params.set('page', String(page))
    term.trim() ? params.set('search', term.trim()) : params.delete('search')
    router.push(`/assistance/aceze?${params.toString()}`)
  }

  const clearFilters = () => {
    setSearch('')
    router.push('/assistance/aceze?tab=list&page=1')
  }

  const update = (key: keyof FormState, value: string) => setForm((current) => current ? { ...current, [key]: value } : current)

  const save = async (event: React.FormEvent) => {
    event.preventDefault(); if (!form) return
    setBusy('save'); setError(''); setMessage('')
    try {
      const response = await fetch(`/api/assistance/aceze/${form.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(payload.error || 'Kayıt güncellenemedi.')
      setMessage('Aceze kaydı başarıyla güncellendi.'); router.refresh()
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Kayıt güncellenemedi.') } finally { setBusy('') }
  }

  const remove = async () => {
    if (!form || !(await confirmDialog(`${form.fullName} isimli Aceze kaydı kalıcı olarak silinsin mi?`))) return
    setBusy('delete'); setError(''); setMessage('')
    try {
      const response = await fetch(`/api/assistance/aceze/${form.id}`, { method: 'DELETE' })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(payload.error || 'Kayıt silinemedi.')
      setForm(null); router.refresh()
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Kayıt silinemedi.') } finally { setBusy('') }
  }

  const print = async (targetForm: FormState | null = form) => {
    if (!targetForm) return
    const design = designs.find((item) => normalize(item.linkedAssistance) === 'aceze') || designs.find((item) => normalize(item.linkedAssistance).includes('aceze') || normalize(item.name).includes('aceze'))
    if (!design) { setError('Aceze form dizaynı bulunamadı. Ayarlar > Form Dizayn alanında Aceze tasarımını tanımlayın.'); return }
    setBusy('print'); setError(''); setMessage('')
    const aceze = {
      id: targetForm.id,
      tc: targetForm.identityNumber,
      ad_soyad: targetForm.fullName,
      baba_adi: targetForm.fatherName,
      ana_adi: targetForm.motherName,
      dogum_yeri: targetForm.birthPlace,
      dogum_tarihi: targetForm.birthDate,
      uyruk: targetForm.nationality,
      medeni_hal: targetForm.maritalStatus,
      cinsiyet: targetForm.gender,
      nufusa_kayitli_il: targetForm.registryCity,
      saglik_durumu: targetForm.healthStatus,
      hastalik: targetForm.illnessName,
      gidecegi_yer: targetForm.destination,
      neden: targetForm.reason,
      tarih: targetForm.date,
      kisi_sayisi: targetForm.personCount,
      tutar: targetForm.amount,
      telefon: targetForm.phone,
    }
    const data = { aceze, ...Object.fromEntries(Object.entries(aceze).map(([key, value]) => [`aceze.${key}`, value])) }
    const html = renderToStaticMarkup(<FormDesignRenderer design={design} data={data} preview={false} />)
    try {
      const configuredPrinter = printerName(design)
      if (configuredPrinter && directPrintAgentEnabled) {
        const response = await fetch(localPrintAgentUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ printerName: configuredPrinter, title: design.name, assistanceType: design.linkedAssistance, designName: design.name, html: agentHtml(design.name, html, design) }) })
        const payload = await response.json().catch(() => ({}))
        if (!response.ok || payload.success === false) throw new Error(payload.error || 'Yazıcı baskıyı kabul etmedi.')
        if (payload.agentVersion !== requiredPrintAgentVersion) throw new Error(`Yazdırma agentı güncel değil. Agenttan Al ile ${requiredPrintAgentVersion} sürümünü yeniden kurun.`)
        setMessage(`Kayıt ${configuredPrinter} yazıcısına gönderildi.`)
      } else {
        printFormDesignHtml(design.name, html, { widthMm: design.type === 'a4' ? undefined : Number(design.width || 80), heightMm: design.type === 'a4' ? undefined : Number(design.height || 40), offsetXmm: Number(design.printOffsetX || 0), offsetYmm: Number(design.printOffsetY || 0), insetRightMm: Number(design.printOffsetRight || 0), insetBottomMm: Number(design.printOffsetBottom || 0) })
        setMessage(configuredPrinter ? `Yazdırma penceresi açıldı. Kayıtlı son yazıcı: ${configuredPrinter}` : 'Aceze formu yazdırma penceresine gönderildi.')
      }
    } catch (caught) { setError(`Yazdırma işlemi başarısız: ${caught instanceof Error ? caught.message : 'Bilinmeyen hata'}`) } finally { setBusy('') }
  }

  return <div className="dy-yardim-rapor-17 space-y-5">
    <div className="relative overflow-hidden rounded-3xl border border-emerald-200/80 bg-gradient-to-br from-[#064e5f] via-[#087f8c] to-[#22a76f] p-5 text-white shadow-[0_24px_60px_-34px_rgba(5,150,105,0.8)] sm:p-7">
      <div className="absolute -right-12 -top-16 h-44 w-44 rounded-full border-[26px] border-white/10" />
      <div className="absolute -bottom-14 right-1/3 h-28 w-28 rounded-full bg-sky-300/20 blur-2xl" />
      <div className="relative flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div><p className="text-[11px] font-black uppercase tracking-[0.22em] text-emerald-100">Aceze Yardımı</p><h1 className="mt-1 text-2xl font-black tracking-tight sm:text-3xl">Kayıtlı Başvurular</h1><p className="mt-2 max-w-xl text-sm font-semibold text-white/80">Başvuruları görüntüleyin, düzenleyin ve form tasarımıyla yazdırın.</p></div>
        <div className="grid grid-cols-2 gap-2 sm:flex"><div className="rounded-2xl border border-white/20 bg-white/10 px-5 py-3 backdrop-blur"><span className="block text-[10px] font-black uppercase tracking-wider text-emerald-100">Toplam Kayıt</span><strong className="mt-0.5 block text-2xl font-black">{totalCount}</strong></div><div className="rounded-2xl border border-white/20 bg-white/10 px-5 py-3 backdrop-blur"><span className="block text-[10px] font-black uppercase tracking-wider text-emerald-100">Sayfa</span><strong className="mt-0.5 block text-2xl font-black">{currentPage}/{totalPages}</strong></div></div>
      </div>
    </div>
    <form onSubmit={(event) => { event.preventDefault(); navigate(1, search) }} className="flex min-w-0 flex-col gap-3 rounded-2xl border border-sky-200/80 bg-gradient-to-r from-white via-sky-50/60 to-emerald-50/60 p-4 shadow-[0_14px_35px_-26px_rgba(2,132,199,0.9)] sm:flex-row sm:p-5">
      <div className="relative min-w-0 flex-1"><svg className="pointer-events-none absolute left-3.5 top-1/2 h-5 w-5 -translate-y-1/2 text-sky-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="7"/><path strokeLinecap="round" d="m20 20-4-4"/></svg><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Ad soyad, TC, dosya no, mahalle, adres, neden veya hastalık ara" className={`${inputClass} h-12 pl-11 shadow-sm`} /></div>
      <button className="min-h-12 rounded-xl bg-gradient-to-r from-[#006ba6] to-[#0095cf] px-8 text-sm font-black text-white shadow-lg shadow-sky-200 transition hover:-translate-y-0.5 hover:shadow-xl">Kayıtlarda Ara</button>
      <button type="button" onClick={clearFilters} className="min-h-12 rounded-xl border border-rose-200 bg-white px-6 text-sm font-black text-rose-600 shadow-sm transition hover:-translate-y-0.5 hover:bg-rose-50 hover:shadow-md">Filtreleri Temizle</button>
    </form>
    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_18px_45px_-32px_rgba(15,23,42,0.55)]">
      <div className="flex flex-col gap-3 border-b border-slate-100 bg-gradient-to-r from-sky-50 to-emerald-50 px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-5">
        <div>
          <h2 className="text-base font-black text-slate-900">Aceze Yardımları Listesi</h2>
          <p className="mt-0.5 text-xs font-bold text-slate-500">Yazdırmak için kaydı bir kez seçin; bilgilerini açmak için çift tıklayın.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {selectedRow && (
            <span className="max-w-48 truncate rounded-full border border-sky-200 bg-white px-3 py-1.5 text-[11px] font-black text-sky-700">
              Seçili: {text(selectedRow.adisoyadi || selectedRow.tckimlikno)}
            </span>
          )}
          <button
            type="button"
            onClick={() => selectedRow && void print(rowToForm(selectedRow))}
            disabled={!selectedRow || !!busy}
            className="inline-flex min-h-10 items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-500 px-5 text-[15px] font-black uppercase text-white shadow-lg shadow-emerald-200 transition hover:-translate-y-0.5 hover:shadow-xl disabled:cursor-not-allowed disabled:opacity-45"
          >
            <span aria-hidden="true">⎙</span>
            {busy === 'print' ? 'Yazdırılıyor...' : 'Yazdır'}
          </button>
          <span className="w-fit rounded-full border border-emerald-200 bg-white px-3 py-1.5 text-[11px] font-black text-emerald-700">Güncel Kayıtlar</span>
        </div>
      </div>
      <div className="p-3 sm:p-5">
      {rows.length ? <AdvancedTable data={rows} tableId="yrd_aceze" excludedColumns={['kullaniciid','ilkkullaniciid','islemtarihi','ilkislemtarihi','babaadi','anaadi','dogumyeri','dosyaid']} requiredVisibleColumns={['dosyano', 'mahalle', 'dosya_adresi', 'tutar']} preferredColumnOrder={['dosyano', 'adisoyadi', 'tckimlikno', 'tutar', 'mahalle', 'dosya_adresi']} columnLabels={{ dosyano: 'Dosya No', adisoyadi: 'Ad Soyad', tckimlikno: 'T.C. Kimlik No', tutar: 'Tutar (TL)', mahalle: 'Mahalle', dosya_adresi: 'Dosya Adresi', medenihali: 'Medeni Hali', cinsiyeti: 'Cinsiyet' }} maritalStatusColumns={['medenihali']} genderColumns={['cinsiyeti']} selectedRowIds={selectedRow ? [text(selectedRow.id)] : []} selectedRowHighlightClassName="bg-emerald-100 outline outline-2 -outline-offset-2 outline-emerald-500" onRowClick={(row) => { setSelectedRow(row); setError(''); setMessage('') }} onRowDoubleClick={(row) => { setSelectedRow(row); setForm(rowToForm(row)); setError(''); setMessage('') }} getRowId={(row, index) => text(row.id || index)} showRowNumber rowNumberStart={(currentPage - 1) * pageSize + 1} serverSideFiltering /> : <div className="py-10 text-center text-sm font-bold text-slate-500">Görüntülenecek Aceze yardımı kaydı bulunamadı.</div>}
      <div className="mt-4 flex flex-col gap-3 border-t border-slate-100 pt-4 text-xs font-bold text-slate-500 sm:flex-row sm:items-center sm:justify-between"><span>Sayfa {currentPage} / {totalPages} · Toplam {totalCount} kayıt</span><div className="grid grid-cols-2 gap-2 sm:flex"><button onClick={() => navigate(currentPage - 1)} disabled={currentPage <= 1} className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-slate-700 shadow-sm transition hover:bg-sky-50 hover:text-sky-700 disabled:opacity-40">← Önceki</button><button onClick={() => navigate(currentPage + 1)} disabled={currentPage >= totalPages} className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-emerald-700 shadow-sm transition hover:bg-emerald-100 disabled:opacity-40">Sonraki →</button></div></div>
      </div>
    </div>
    {form && <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/60 p-2 sm:p-5" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) setForm(null) }}>
      <form onSubmit={save} className="flex max-h-[96vh] w-full max-w-5xl flex-col overflow-hidden rounded-3xl border border-white/20 bg-white shadow-2xl">
        <div className="relative flex items-center justify-between overflow-hidden bg-gradient-to-r from-[#005f95] via-[#0085a9] to-[#35a96f] px-5 py-5 text-white sm:px-7"><div className="absolute -right-8 -top-12 h-32 w-32 rounded-full border-[20px] border-white/10"/><div className="relative"><p className="text-[11px] font-black uppercase tracking-[0.18em] text-sky-100">Aceze Kaydı #{form.id}</p><h2 className="mt-1 text-2xl font-black">Kayıt Bilgileri</h2></div><button type="button" onClick={() => setForm(null)} disabled={!!busy} className="relative rounded-xl border border-white/20 bg-white/15 px-4 py-2 font-black backdrop-blur transition hover:bg-white/25">Kapat</button></div>
        <div className="grid min-w-0 flex-1 gap-4 overflow-y-auto bg-gradient-to-b from-slate-50/80 to-white p-4 sm:grid-cols-2 sm:p-6 lg:grid-cols-3">
          <Field label="T.C. Kimlik No"><input inputMode="numeric" maxLength={11} value={form.identityNumber} onChange={(e) => update('identityNumber', e.target.value.replace(/\D/g,''))} className={inputClass}/></Field>
          <Field label="Doğum Tarihi"><input type="date" value={form.birthDate} onChange={(e) => update('birthDate', e.target.value)} className={inputClass}/></Field>
          <Field label="Uyruğu"><input value={form.nationality} onChange={(e) => update('nationality', e.target.value)} className={inputClass}/></Field>
          <Field label="Ad Soyad"><input required maxLength={100} value={form.fullName} onChange={(e) => update('fullName', e.target.value)} className={inputClass}/></Field>
          <Field label="Baba Adı"><input value={form.fatherName} onChange={(e) => update('fatherName', e.target.value)} className={inputClass}/></Field>
          <Field label="Ana Adı"><input value={form.motherName} onChange={(e) => update('motherName', e.target.value)} className={inputClass}/></Field>
          <Field label="Doğum Yeri"><input value={form.birthPlace} onChange={(e) => update('birthPlace', e.target.value)} className={inputClass}/></Field>
          <Field label="Medeni Hali"><select value={form.maritalStatus} onChange={(e) => update('maritalStatus', e.target.value)} className={inputClass}><option value="">Seçiniz</option>{maritalStatusOptions.map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}</select></Field>
          <Field label="Cinsiyeti"><select value={form.gender} onChange={(e) => update('gender', e.target.value)} className={inputClass}><option value="">Seçiniz</option>{genderOptions.map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}</select></Field>
          <Field label="Sağlık Durumu"><select value={form.healthStatus} onChange={(e) => update('healthStatus', e.target.value)} className={inputClass}><option value="">Seçiniz</option><option value="1">Sağlıklı</option><option value="2">Hasta</option><option value="3">Engelli</option></select></Field>
          <Field label="Hastalık Adı"><input value={form.illnessName} onChange={(e) => update('illnessName', e.target.value)} className={inputClass}/></Field>
          <Field label="Nüfusa Kayıtlı İl"><input value={form.registryCity} onChange={(e) => update('registryCity', e.target.value)} className={inputClass}/></Field>
          <Field label="Cep Telefonu"><input value={form.phone} onChange={(e) => update('phone', e.target.value)} className={inputClass}/></Field>
          <Field label="Başvuru Tarihi"><input required type="date" value={form.date} onChange={(e) => update('date', e.target.value)} className={inputClass}/></Field>
          <Field label="Kişi Sayısı"><input required type="number" min="1" max="99" value={form.personCount} onChange={(e) => update('personCount', e.target.value)} className={inputClass}/></Field>
          <Field label="Tutar (TL)"><input inputMode="decimal" placeholder="Örn: 1500 (boş bırakılabilir)" value={form.amount} onChange={(e) => update('amount', e.target.value.replace(/[^0-9.,]/g, ''))} className={inputClass}/></Field>
          <div className="sm:col-span-2 lg:col-span-3"><Field label="Gideceği Yer"><input value={form.destination} onChange={(e) => update('destination', e.target.value)} className={inputClass}/></Field></div>
          <div className="sm:col-span-2 lg:col-span-3"><Field label="Başvuru Nedeni"><textarea required maxLength={500} rows={4} value={form.reason} onChange={(e) => update('reason', e.target.value)} className={`${inputClass} py-3`}/></Field></div>
          {(error || message) && <div className={`sm:col-span-2 lg:col-span-3 rounded-lg border px-4 py-3 text-sm font-bold ${error ? 'border-rose-200 bg-rose-50 text-rose-700' : 'border-emerald-200 bg-emerald-50 text-emerald-700'}`}>{error || message}</div>}
        </div>
        <div className="flex flex-col-reverse gap-2 border-t bg-gradient-to-r from-slate-50 via-white to-sky-50 p-4 sm:flex-row sm:justify-between sm:px-7"><button type="button" onClick={() => void remove()} disabled={!!busy} className="min-h-11 rounded-xl bg-gradient-to-r from-rose-600 to-red-500 px-5 text-sm font-black text-white shadow-lg shadow-rose-200 transition hover:-translate-y-0.5 disabled:opacity-50">{busy === 'delete' ? 'Siliniyor...' : 'Kaydı Sil'}</button><div className="flex flex-col gap-2 sm:flex-row"><button type="button" onClick={() => void print()} disabled={!!busy} className="min-h-11 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-500 px-7 text-sm font-black text-white shadow-lg shadow-emerald-200 transition hover:-translate-y-0.5 disabled:opacity-50">{busy === 'print' ? 'Yazdırılıyor...' : 'Yazdır'}</button><button disabled={!!busy} className="min-h-11 rounded-xl bg-gradient-to-r from-[#006ba6] to-[#0095cf] px-7 text-sm font-black text-white shadow-lg shadow-sky-200 transition hover:-translate-y-0.5 disabled:opacity-50">{busy === 'save' ? 'Kaydediliyor...' : 'Güncelle'}</button></div></div>
      </form>
    </div>}
  </div>
}

function Field({ label, children }: { label: string; children: React.ReactNode }) { return <label className="ns-label grid min-w-0 gap-1.5">{label}{children}</label> }
