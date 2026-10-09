'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { DestructiveAuthorizationDialog, type DestructiveAuthorizationDialogHandle } from '@/components/security/DestructiveAuthorizationDialog'

type Tender = {
  id: string
  yil: number
  ihale_turu: string
  ihale_miktari: string
  birim_fiyati: string
  kdv_orani: string
  damga_vergisi_orani: string
  teslim_alinan_miktar: string
  damga_vergisi: string
  odenen_toplam_tutar: string
  gerceklesme_yuzdesi: string
  kalan_miktar: string
  ihale_bedel_tutari: string
  ihale_baslangic_tarihi?: string | null
  ihale_bitis_tarihi?: string | null
  aciklama?: string | null
}

type MonthlyRecord = {
  id: string
  hakedis_id: string
  yil: number
  ay: number
  teslim_alinan_miktar: string
  kdv_orani: string
  damga_vergisi_orani: string
  brut_tutar: string
  kdv_tutari: string
  damga_vergisi_tutari: string
  odenecek_tutar: string
  aciklama?: string | null
}

const currentYear = new Date().getFullYear()
const currentMonth = new Date().getMonth() + 1
const monthNames = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık']
const typeNames: Record<string, string> = { ekmek: 'Ekmek', hazir_yemek: 'Hazır Yemek', kahvalti: 'Kahvaltı' }
const number = (value: string | number | undefined) => Number(value || 0)
const money = (value: string | number | undefined) => new Intl.NumberFormat('tr-TR', { style: 'currency', currency: 'TRY', maximumFractionDigits: 2 }).format(number(value))
const quantity = (value: string | number | undefined) => new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 3 }).format(number(value))
const dateInputValue = (value?: string | null) => value ? value.slice(0, 10) : ''

export default function HakedisPage() {
  const [tenders, setTenders] = useState<Tender[]>([])
  const [monthly, setMonthly] = useState<MonthlyRecord[]>([])
  const [yearFilter, setYearFilter] = useState(String(currentYear))
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [editingTenderId, setEditingTenderId] = useState<string | null>(null)
  const destructiveAuthorizationRef = useRef<DestructiveAuthorizationDialogHandle>(null)
  const [message, setMessage] = useState<{ tone: 'success' | 'error'; text: string } | null>(null)
  const [tenderForm, setTenderForm] = useState({
    year: String(currentYear), type: 'ekmek', tenderAmount: '', unitPrice: '', vatRate: '10', stampRate: '0.948', startDate: '', endDate: '', description: '',
  })
  const [monthlyForm, setMonthlyForm] = useState({
    tenderId: '', year: String(currentYear), month: String(currentMonth), quantity: '', vatRate: '', stampRate: '', description: '',
  })

  const load = useCallback(async () => {
    setLoading(true)
    setMessage(null)
    try {
      const query = yearFilter ? `?year=${encodeURIComponent(yearFilter)}` : ''
      const response = await fetch(`/api/hakedis${query}`, { cache: 'no-store' })
      const payload = await response.json()
      if (!response.ok || !payload.success) throw new Error(payload.error || 'Hakediş bilgileri alınamadı.')
      setTenders(Array.isArray(payload.data?.tenders) ? payload.data.tenders : [])
      setMonthly(Array.isArray(payload.data?.monthly) ? payload.data.monthly : [])
    } catch (error) {
      setMessage({ tone: 'error', text: error instanceof Error ? error.message : 'Hakediş bilgileri alınamadı.' })
    } finally {
      setLoading(false)
    }
  }, [yearFilter])

  useEffect(() => { void load() }, [load])

  const selectedTender = tenders.find((item) => item.id === monthlyForm.tenderId)
  const preview = useMemo(() => {
    const qty = number(monthlyForm.quantity)
    const unit = number(selectedTender?.birim_fiyati)
    const vatRate = monthlyForm.vatRate === '' ? number(selectedTender?.kdv_orani) : number(monthlyForm.vatRate)
    const stampRate = monthlyForm.stampRate === '' ? number(selectedTender?.damga_vergisi_orani) : number(monthlyForm.stampRate)
    const gross = qty * unit
    const vat = gross * vatRate / 100
    const stamp = gross * stampRate / 100
    return { gross, vat, stamp, payable: gross + vat - stamp }
  }, [monthlyForm.quantity, monthlyForm.stampRate, monthlyForm.vatRate, selectedTender])

  const totals = useMemo(() => tenders.reduce((sum, item) => ({
    tender: sum.tender + number(item.ihale_miktari),
    delivered: sum.delivered + number(item.teslim_alinan_miktar),
    remaining: sum.remaining + number(item.kalan_miktar),
    paid: sum.paid + number(item.odenen_toplam_tutar),
    value: sum.value + number(item.ihale_bedel_tutari),
  }), { tender: 0, delivered: 0, remaining: 0, paid: 0, value: 0 }), [tenders])
  const totalProgress = totals.tender > 0 ? Math.min(100, totals.delivered / totals.tender * 100) : 0

  // Kullanici istegi: ihale miktarini tanimlarken, HER ihale turu (Ekmek/
  // Kahvalti/Hazir Yemek) icin AYRI bir ozet gorunsun - ust kisimdaki KPI
  // kartlari TUM turlerin TOPLAMINI gosteriyordu, tur bazinda kirilim yoktu.
  // Ayni turden BIRDEN FAZLA ihale kaydi olabilir (ör. "Tum Yillar"
  // filtresinde farkli yillara ait kayitlar) - bu yuzden miktar/tutarlar
  // TOPLANIR, birim fiyati ise (kayitlar arasinda farkli olabilecegi icin)
  // toplam ihale bedeli / toplam ihale miktari ile AGIRLIKLI ORTALAMA
  // olarak hesaplanir.
  const typeSummaries = useMemo(() => {
    const byType = new Map<string, {
      type: string
      recordCount: number
      tenderQty: number
      deliveredQty: number
      remainingQty: number
      totalValue: number
      paidTotal: number
    }>()

    for (const item of tenders) {
      const current = byType.get(item.ihale_turu) || {
        type: item.ihale_turu, recordCount: 0, tenderQty: 0, deliveredQty: 0, remainingQty: 0, totalValue: 0, paidTotal: 0,
      }
      current.recordCount += 1
      current.tenderQty += number(item.ihale_miktari)
      current.deliveredQty += number(item.teslim_alinan_miktar)
      current.remainingQty += number(item.kalan_miktar)
      current.totalValue += number(item.ihale_bedel_tutari)
      current.paidTotal += number(item.odenen_toplam_tutar)
      byType.set(item.ihale_turu, current)
    }

    return Array.from(byType.values())
      .map((summary) => ({
        ...summary,
        weightedUnitPrice: summary.tenderQty > 0 ? summary.totalValue / summary.tenderQty : 0,
        progressPct: summary.tenderQty > 0 ? Math.min(100, summary.deliveredQty / summary.tenderQty * 100) : 0,
      }))
      .sort((a, b) => (typeNames[a.type] || a.type).localeCompare(typeNames[b.type] || b.type, 'tr-TR'))
  }, [tenders])

  const saveTender = async (event: React.FormEvent) => {
    event.preventDefault()
    setSaving(true)
    setMessage(null)
    try {
      const response = await fetch('/api/hakedis', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: editingTenderId ? 'updateTender' : 'tender', tenderId: editingTenderId, ...tenderForm }),
      })
      const payload = await response.json()
      if (!response.ok || !payload.success) throw new Error(payload.error || 'İhale kaydedilemedi.')
      setTenderForm((current) => ({ ...current, tenderAmount: '', unitPrice: '', startDate: '', endDate: '', description: '' }))
      setEditingTenderId(null)
      setYearFilter(tenderForm.year)
      setMessage({ tone: 'success', text: editingTenderId ? 'İhale bilgisi başarıyla güncellendi.' : 'İhale bilgisi başarıyla kaydedildi.' })
      await load()
    } catch (error) {
      setMessage({ tone: 'error', text: error instanceof Error ? error.message : 'İhale kaydedilemedi.' })
    } finally { setSaving(false) }
  }

  const editTender = (item: Tender) => {
    setEditingTenderId(item.id)
    setTenderForm({
      year: String(item.yil), type: item.ihale_turu, tenderAmount: item.ihale_miktari,
      unitPrice: item.birim_fiyati, vatRate: item.kdv_orani, stampRate: item.damga_vergisi_orani,
      startDate: dateInputValue(item.ihale_baslangic_tarihi), endDate: dateInputValue(item.ihale_bitis_tarihi),
      description: item.aciklama || '',
    })
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const cancelEdit = () => {
    setEditingTenderId(null)
    setTenderForm({ year: String(currentYear), type: 'ekmek', tenderAmount: '', unitPrice: '', vatRate: '10', stampRate: '0.948', startDate: '', endDate: '', description: '' })
  }

  const deleteTender = async (item: Tender) => {
    const token = await destructiveAuthorizationRef.current?.authorize('İhale Kaydı Silme Onayı')
    if (!token) return
    setSaving(true)
    setMessage(null)
    try {
      const response = await fetch(`/api/hakedis?id=${encodeURIComponent(item.id)}`, {
        method: 'DELETE', headers: { 'x-destructive-authorization': token },
      })
      const payload = await response.json()
      if (!response.ok || !payload.success) throw new Error(payload.error || 'İhale silinemedi.')
      if (editingTenderId === item.id) cancelEdit()
      setMessage({ tone: 'success', text: `${typeNames[item.ihale_turu] || item.ihale_turu} ihalesi ve bağlı aylık kayıtlar silindi.` })
      await load()
    } catch (error) {
      setMessage({ tone: 'error', text: error instanceof Error ? error.message : 'İhale silinemedi.' })
    } finally { setSaving(false) }
  }

  const saveMonthly = async (event: React.FormEvent) => {
    event.preventDefault()
    setSaving(true)
    setMessage(null)
    try {
      const response = await fetch('/api/hakedis', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'monthly', ...monthlyForm }),
      })
      const payload = await response.json()
      if (!response.ok || !payload.success) throw new Error(payload.error || 'Aylık teslimat kaydedilemedi.')
      setMonthlyForm((current) => ({ ...current, quantity: '', description: '' }))
      setMessage({ tone: 'success', text: `Aylık hakediş kaydedildi. Ödenecek tutar: ${money(payload.data?.payable)}` })
      await load()
    } catch (error) {
      setMessage({ tone: 'error', text: error instanceof Error ? error.message : 'Aylık teslimat kaydedilemedi.' })
    } finally { setSaving(false) }
  }

  const inputClass = 'h-12 w-full rounded-lg border border-slate-300 bg-white px-4 text-xl font-bold text-slate-900 outline-none focus:border-orange-400 focus:ring-2 focus:ring-orange-100'
  const labelClass = 'grid gap-1.5 text-lg font-black uppercase tracking-wide text-slate-500'

  return (
    <div className="space-y-5 pb-8 text-slate-950">
      <header className="overflow-hidden rounded-2xl border border-[#2A3B4D] bg-[#1E2A38] p-6 text-white shadow-lg">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div><p className="text-xl font-black uppercase tracking-[0.18em] text-white/80">Satın Alma ve Ödeme Takibi</p><h1 className="mt-1 text-3xl font-black">İhale Bilgileri</h1><p className="mt-1.5 text-xl font-semibold text-white/80">Ekmek, hazır yemek ve kahvaltı ihalelerinin aylık gerçekleşme ve ödeme görünümü</p></div>
          <label className="grid gap-1.5 text-lg font-black uppercase text-white/80">Rapor Yılı<select value={yearFilter} onChange={(event) => setYearFilter(event.target.value)} className="h-12 rounded-lg border border-white/30 bg-white px-4 text-xl font-black text-slate-900"><option value="">Tüm Yıllar</option>{Array.from({ length: 8 }, (_, index) => currentYear + 2 - index).map((year) => <option key={year}>{year}</option>)}</select></label>
        </div>
      </header>

      {message && <div className={`rounded-xl border px-4 py-3 text-xl font-bold ${message.tone === 'success' ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-rose-200 bg-rose-50 text-rose-700'}`}>{message.text}</div>}

      {/* Kullanici istegi: buradaki miktar bazli (İhale Miktarı/Teslim Alınan/
          Kalan Miktar) kartlar kaldirildi - bu bilgi artik asagidaki "İhale
          Türlerine Göre Özet" bolumunde tur tur zaten var, burada TEKRARI
          gereksizdi. Bunlarin yerine ozet 3 deger birakildi: toplam ihale
          tutari (₺), toplam odeme (₺) ve genel gerceklesme yuzdesi. */}
      <section className="grid gap-3 sm:grid-cols-3">
        {[['Toplam İhale Tutarı', money(totals.value), 'bg-violet-600'], ['Toplam Ödeme', money(totals.paid), 'bg-orange-600'], ['Genel Gerçekleşme', `%${totalProgress.toLocaleString('tr-TR', { maximumFractionDigits: 2 })}`, 'bg-emerald-600']].map(([label, value, color]) => <div key={label} className="rounded-xl border border-slate-300 bg-white p-4 shadow-sm"><span className={`mb-3 block h-1.5 w-14 rounded-full ${color}`} /><p className="text-lg font-black uppercase text-slate-400">{label}</p><p className="mt-1.5 break-words text-2xl font-black text-slate-900">{value}</p></div>)}
      </section>

      <section className="rounded-xl border border-emerald-200 bg-white p-4 shadow-sm">
        <div className="flex items-center justify-between gap-3"><div><h2 className="text-xl font-black uppercase text-emerald-800">Genel İhale Gerçekleşmesi</h2><p className="text-lg font-bold text-slate-400">Teslim alınan miktar / toplam ihale miktarı</p></div><strong className="text-2xl font-black text-emerald-700">%{totalProgress.toLocaleString('tr-TR', { maximumFractionDigits: 2 })}</strong></div>
        <div className="mt-3 h-4 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-cyan-500 transition-all" style={{ width: `${totalProgress}%` }} /></div>
      </section>

      {typeSummaries.length > 0 && (
        <section className="overflow-hidden rounded-2xl border border-amber-200 bg-white shadow-sm">
          <div className="bg-gradient-to-r from-amber-600 to-orange-600 px-5 py-4 text-white">
            <h2 className="text-xl font-black">İhale Türlerine Göre Özet</h2>
            <p className="text-lg font-semibold text-amber-100">Her ihale türü için tanımlanan miktar, ödeme ve gerçekleşme durumu ayrı ayrı</p>
          </div>
          <div className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-3">
            {typeSummaries.map((summary) => {
              const toneClass = summary.type === 'ekmek'
                ? 'border-orange-200 bg-orange-50'
                : summary.type === 'kahvalti'
                  ? 'border-sky-200 bg-sky-50'
                  : 'border-emerald-200 bg-emerald-50'
              const badgeClass = summary.type === 'ekmek'
                ? 'bg-orange-600'
                : summary.type === 'kahvalti'
                  ? 'bg-sky-600'
                  : 'bg-emerald-600'
              return (
                <div key={summary.type} className={`rounded-xl border ${toneClass} p-4`}>
                  <div className="flex items-center justify-between gap-2">
                    <span className={`rounded-full px-3.5 py-1.5 text-lg font-black uppercase text-white ${badgeClass}`}>{typeNames[summary.type] || summary.type}</span>
                    <span className="text-xl font-black text-slate-900">%{summary.progressPct.toLocaleString('tr-TR', { maximumFractionDigits: 2 })}</span>
                  </div>
                  <p className="mt-1.5 text-base font-bold text-slate-400">{summary.recordCount} kayıtlı ihale{summary.recordCount > 1 ? ' (toplanmış)' : ''}</p>
                  <div className="mt-2 h-2 overflow-hidden rounded-full bg-white"><div className={`h-full rounded-full ${badgeClass}`} style={{ width: `${summary.progressPct}%` }} /></div>
                  <div className="mt-3 grid grid-cols-2 gap-2 text-lg">
                    <div className="rounded-lg bg-white p-2.5"><p className="font-black uppercase text-slate-400">İhale Miktarı</p><p className="mt-1 font-black text-slate-900">{quantity(summary.tenderQty)}</p></div>
                    <div className="rounded-lg bg-white p-2.5"><p className="font-black uppercase text-slate-400">Birim Fiyatı{summary.recordCount > 1 ? ' (ort.)' : ''}</p><p className="mt-1 font-black text-slate-900">{money(summary.weightedUnitPrice)}</p></div>
                    <div className="rounded-lg bg-white p-2.5"><p className="font-black uppercase text-slate-400">Toplam İhale Tutarı</p><p className="mt-1 font-black text-violet-700">{money(summary.totalValue)}</p></div>
                    <div className="rounded-lg bg-white p-2.5"><p className="font-black uppercase text-slate-400">Ödenen Tutar</p><p className="mt-1 font-black text-emerald-700">{money(summary.paidTotal)}</p></div>
                    <div className="rounded-lg bg-white p-2.5"><p className="font-black uppercase text-slate-400">Kalan Miktar</p><p className="mt-1 font-black text-rose-700">{quantity(summary.remainingQty)}</p></div>
                    <div className="rounded-lg bg-white p-2.5"><p className="font-black uppercase text-slate-400">Kalan Tutar</p><p className="mt-1 font-black text-rose-700">{money(Math.max(summary.totalValue - summary.paidTotal, 0))}</p></div>
                  </div>
                </div>
              )
            })}
          </div>
        </section>
      )}

      <div className="grid items-start gap-5 xl:grid-cols-2">
        <form onSubmit={saveTender} className="overflow-hidden rounded-2xl border border-sky-200 bg-white shadow-sm">
          <div className="bg-gradient-to-r from-sky-700 to-cyan-600 px-5 py-4 text-white"><h2 className="text-xl font-black">1. İhale Miktarlarını Tanımla</h2><p className="text-lg font-semibold text-sky-100">Ekmek, Kahvaltı ve Hazır Yemek için ihale miktarını ayrı ayrı kaydedin</p></div>
          <div className="grid gap-3 p-5 sm:grid-cols-2 lg:grid-cols-3">
            <label className={labelClass}>Yıl<input required type="number" min="2000" max="2200" value={tenderForm.year} onChange={(e) => setTenderForm({ ...tenderForm, year: e.target.value })} className={inputClass} /></label>
            <label className={labelClass}>İhale Türü<select value={tenderForm.type} onChange={(e) => setTenderForm({ ...tenderForm, type: e.target.value })} className={inputClass}><option value="ekmek">Ekmek</option><option value="hazir_yemek">Hazır Yemek</option><option value="kahvalti">Kahvaltı</option></select></label>
            <label className={labelClass}>İhale Miktarı<input required type="number" min="0.001" step="0.001" value={tenderForm.tenderAmount} onChange={(e) => setTenderForm({ ...tenderForm, tenderAmount: e.target.value })} className={inputClass} /></label>
            <label className={labelClass}>Birim Fiyatı<input required type="number" min="0" step="0.0001" value={tenderForm.unitPrice} onChange={(e) => setTenderForm({ ...tenderForm, unitPrice: e.target.value })} className={inputClass} /></label>
            <label className={labelClass}>KDV Oranı (%)<input required type="number" min="0" max="100" step="0.01" value={tenderForm.vatRate} onChange={(e) => setTenderForm({ ...tenderForm, vatRate: e.target.value })} className={inputClass} /></label>
            <label className={labelClass}>Damga Vergisi (%)<input required type="number" min="0" max="100" step="0.0001" value={tenderForm.stampRate} onChange={(e) => setTenderForm({ ...tenderForm, stampRate: e.target.value })} className={inputClass} /></label>
            <label className={labelClass}>Başlangıç<input type="date" value={tenderForm.startDate} onChange={(e) => setTenderForm({ ...tenderForm, startDate: e.target.value })} className={inputClass} /></label>
            <label className={labelClass}>Bitiş<input type="date" value={tenderForm.endDate} onChange={(e) => setTenderForm({ ...tenderForm, endDate: e.target.value })} className={inputClass} /></label>
            <label className={`${labelClass} sm:col-span-2 lg:col-span-1`}>Açıklama<input maxLength={500} value={tenderForm.description} onChange={(e) => setTenderForm({ ...tenderForm, description: e.target.value })} className={inputClass} /></label>
          </div>
          <div className="flex justify-end gap-2 border-t border-slate-100 bg-slate-50 px-5 py-4">{editingTenderId && <button type="button" onClick={cancelEdit} disabled={saving} className="rounded-lg border border-slate-300 bg-white px-6 py-3 text-xl font-black text-slate-600 hover:bg-slate-100">Vazgeç</button>}<button disabled={saving} className="rounded-lg bg-sky-700 px-6 py-3 text-xl font-black text-white hover:bg-sky-800 disabled:opacity-50">{editingTenderId ? 'İhaleyi Güncelle' : 'İhaleyi Kaydet'}</button></div>
        </form>

        <form onSubmit={saveMonthly} className="overflow-hidden rounded-2xl border border-emerald-200 bg-white shadow-sm">
          <div className="bg-gradient-to-r from-emerald-700 to-teal-600 px-5 py-4 text-white"><h2 className="text-xl font-black">2. Aylık Teslimat ve Hakediş</h2><p className="text-lg font-semibold text-emerald-100">Ay ay teslim alınan miktarı girin; kalan ve yüzde otomatik hesaplansın</p></div>
          <div className="grid gap-3 p-5 sm:grid-cols-2 lg:grid-cols-3">
            <label className={`${labelClass} sm:col-span-2 lg:col-span-3`}>İhale<select required value={monthlyForm.tenderId} onChange={(e) => setMonthlyForm({ ...monthlyForm, tenderId: e.target.value, vatRate: '', stampRate: '' })} className={inputClass}><option value="">İhale seçin</option>{tenders.map((item) => <option key={item.id} value={item.id}>{item.yil} · {typeNames[item.ihale_turu] || item.ihale_turu} · İhale: {quantity(item.ihale_miktari)} · Kalan: {quantity(item.kalan_miktar)}</option>)}</select></label>
            {selectedTender && <div className="grid grid-cols-3 gap-2 rounded-lg border border-emerald-200 bg-emerald-50 p-3 sm:col-span-2 lg:col-span-3"><div><p className="text-base font-black uppercase text-slate-400">İhale</p><p className="font-black text-slate-900">{quantity(selectedTender.ihale_miktari)}</p></div><div><p className="text-base font-black uppercase text-slate-400">Teslim</p><p className="font-black text-emerald-700">{quantity(selectedTender.teslim_alinan_miktar)}</p></div><div><p className="text-base font-black uppercase text-slate-400">Kalan</p><p className="font-black text-rose-700">{quantity(selectedTender.kalan_miktar)}</p></div></div>}
            <label className={labelClass}>Yıl<input required type="number" min="2000" max="2200" value={monthlyForm.year} onChange={(e) => setMonthlyForm({ ...monthlyForm, year: e.target.value })} className={inputClass} /></label>
            <label className={labelClass}>Ay<select value={monthlyForm.month} onChange={(e) => setMonthlyForm({ ...monthlyForm, month: e.target.value })} className={inputClass}>{monthNames.map((name, index) => <option key={name} value={index + 1}>{name}</option>)}</select></label>
            <label className={labelClass}>Teslim Miktarı<input required type="number" min="0" step="0.001" value={monthlyForm.quantity} onChange={(e) => setMonthlyForm({ ...monthlyForm, quantity: e.target.value })} className={inputClass} /></label>
            <label className={labelClass}>KDV (%)<input type="number" min="0" max="100" step="0.01" placeholder={selectedTender?.kdv_orani || 'İhaleden'} value={monthlyForm.vatRate} onChange={(e) => setMonthlyForm({ ...monthlyForm, vatRate: e.target.value })} className={inputClass} /></label>
            <label className={labelClass}>Damga Vergisi (%)<input type="number" min="0" max="100" step="0.0001" placeholder={selectedTender?.damga_vergisi_orani || 'İhaleden'} value={monthlyForm.stampRate} onChange={(e) => setMonthlyForm({ ...monthlyForm, stampRate: e.target.value })} className={inputClass} /></label>
            <label className={labelClass}>Açıklama<input maxLength={500} value={monthlyForm.description} onChange={(e) => setMonthlyForm({ ...monthlyForm, description: e.target.value })} className={inputClass} /></label>
          </div>
          <div className="grid grid-cols-2 gap-2 border-t border-emerald-100 bg-emerald-50 p-4 text-lg sm:grid-cols-4">{[['Brüt', preview.gross], ['KDV', preview.vat], ['Damga Vergisi', preview.stamp], ['Ödenecek', preview.payable]].map(([label, value]) => <div key={label as string} className="rounded-lg border border-emerald-200 bg-white p-3 text-center"><p className="font-black uppercase text-slate-400">{label}</p><p className="mt-1 text-xl font-black text-emerald-800">{money(value as number)}</p></div>)}</div>
          <div className="flex justify-end border-t border-slate-100 bg-slate-50 px-5 py-4"><button disabled={saving || !selectedTender} className="rounded-lg bg-emerald-700 px-6 py-3 text-xl font-black text-white hover:bg-emerald-800 disabled:opacity-50">Aylık Hakedişi Kaydet</button></div>
        </form>
      </div>

      {tenders.length > 0 && <section className="overflow-hidden rounded-2xl border border-indigo-200 bg-white shadow-sm">
        <div className="bg-gradient-to-r from-indigo-700 to-violet-600 px-5 py-4 text-white"><h2 className="text-xl font-black">Kayıtlı İhale Bilgileri</h2><p className="text-lg font-semibold text-indigo-100">Daha önce girilen ihale bilgilerini düzenleyebilir veya silebilirsiniz</p></div>
        <div className="overflow-x-auto"><table className="w-full min-w-[950px] text-lg"><thead className="bg-indigo-50 text-left text-base font-black uppercase text-indigo-800"><tr><th className="p-3">Yıl</th><th className="p-3">İhale Türü</th><th className="p-3 text-right">İhale Miktarı</th><th className="p-3 text-right">Teslim</th><th className="p-3 text-right">Kalan</th><th className="p-3 text-right">Gerçekleşme</th><th className="p-3 text-right">İşlemler</th></tr></thead>
          <tbody>{tenders.map((item) => <tr key={item.id} className={`border-t border-slate-100 ${editingTenderId === item.id ? 'bg-amber-50' : 'hover:bg-slate-50'}`}><td className="p-3 font-black">{item.yil}</td><td className="p-3 font-black text-indigo-800">{typeNames[item.ihale_turu] || item.ihale_turu}</td><td className="p-3 text-right font-bold">{quantity(item.ihale_miktari)}</td><td className="p-3 text-right font-bold text-emerald-700">{quantity(item.teslim_alinan_miktar)}</td><td className="p-3 text-right font-bold text-rose-700">{quantity(item.kalan_miktar)}</td><td className="p-3 text-right font-black">%{number(item.gerceklesme_yuzdesi).toLocaleString('tr-TR', { maximumFractionDigits: 2 })}</td><td className="p-3"><div className="flex justify-end gap-2"><button type="button" onClick={() => editTender(item)} disabled={saving} className="rounded-lg bg-amber-100 px-4 py-2.5 text-base font-black text-amber-800 hover:bg-amber-200 disabled:opacity-50">Düzenle</button><button type="button" onClick={() => void deleteTender(item)} disabled={saving} className="rounded-lg bg-rose-100 px-4 py-2.5 text-base font-black text-rose-700 hover:bg-rose-200 disabled:opacity-50">Sil</button></div></td></tr>)}</tbody>
        </table></div>
      </section>}

      <section className="overflow-hidden rounded-2xl border border-slate-300 bg-white shadow-sm">
        <div className="border-b border-slate-200 bg-[#1E2A38] px-5 py-4 text-white"><h2 className="text-xl font-black">İhale Gerçekleşme Durumu</h2></div>
        {loading ? <p className="p-8 text-center text-xl font-bold text-slate-400">Yükleniyor...</p> : tenders.length === 0 ? <p className="p-8 text-center text-xl font-bold text-slate-400">Seçilen yılda ihale kaydı bulunamadı.</p> : <div className="grid gap-4 p-4 lg:grid-cols-2">{tenders.map((item) => {
          const progress = Math.min(100, number(item.gerceklesme_yuzdesi))
          const records = monthly.filter((record) => record.hakedis_id === item.id)
          return <article key={item.id} className="overflow-hidden rounded-xl border border-slate-300 bg-slate-50"><div className="flex flex-wrap items-center justify-between gap-3 bg-white p-4"><div><span className="rounded bg-orange-100 px-2.5 py-1.5 text-base font-black uppercase text-orange-700">{item.yil}</span><h3 className="mt-2 text-2xl font-black text-slate-900">{typeNames[item.ihale_turu] || item.ihale_turu}</h3><p className="text-lg font-bold text-slate-400">Birim fiyat: {money(item.birim_fiyati)} · KDV %{item.kdv_orani} · Damga %{item.damga_vergisi_orani}</p></div><strong className="text-2xl font-black text-emerald-700">%{progress.toLocaleString('tr-TR')}</strong></div><div className="px-4 pb-4"><div className="h-3 overflow-hidden rounded-full bg-slate-200"><div className="h-full rounded-full bg-gradient-to-r from-orange-500 to-emerald-500" style={{ width: `${progress}%` }} /></div><div className="mt-3 grid grid-cols-3 gap-2 text-center text-lg"><div className="rounded-lg bg-white p-2.5"><p className="font-black text-slate-400">İhale</p><p className="font-black">{quantity(item.ihale_miktari)}</p></div><div className="rounded-lg bg-white p-2.5"><p className="font-black text-slate-400">Teslim</p><p className="font-black text-emerald-700">{quantity(item.teslim_alinan_miktar)}</p></div><div className="rounded-lg bg-white p-2.5"><p className="font-black text-slate-400">Ödenen</p><p className="font-black text-orange-700">{money(item.odenen_toplam_tutar)}</p></div></div>{records.length > 0 && <div className="mt-3 overflow-x-auto rounded-lg border border-slate-300"><table className="w-full min-w-[680px] bg-white text-base"><thead className="bg-slate-100 text-left text-base font-black uppercase text-slate-500"><tr><th className="p-2.5">Dönem</th><th className="p-2.5 text-right">Teslim</th><th className="p-2.5 text-right">Brüt</th><th className="p-2.5 text-right">KDV</th><th className="p-2.5 text-right">Damga</th><th className="p-2.5 text-right">Ödenecek</th></tr></thead><tbody>{records.map((record) => <tr key={record.id} className="border-t border-slate-200"><td className="p-2.5 font-black">{monthNames[record.ay - 1]} {record.yil}</td><td className="p-2.5 text-right font-bold">{quantity(record.teslim_alinan_miktar)}</td><td className="p-2.5 text-right">{money(record.brut_tutar)}</td><td className="p-2.5 text-right">{money(record.kdv_tutari)}</td><td className="p-2.5 text-right text-rose-600">-{money(record.damga_vergisi_tutari)}</td><td className="p-2.5 text-right font-black text-emerald-700">{money(record.odenecek_tutar)}</td></tr>)}</tbody></table></div>}</div></article>
        })}</div>}
      </section>
      <DestructiveAuthorizationDialog ref={destructiveAuthorizationRef} />
    </div>
  )
}
