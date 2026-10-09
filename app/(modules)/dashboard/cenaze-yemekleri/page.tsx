'use client'

import { useEffect, useMemo, useState } from 'react'

export const dynamic = 'force-dynamic'

const MONTH_NAMES = [
  'Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran',
  'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık',
]

type FuneralMealRow = {
  id: string
  yil: number
  ay: number
  yemekMiktari: number
  tutar: number
  aciklama: string | null
}

type FormState = {
  id: string | null
  yil: string
  ay: string
  yemekMiktari: string
  tutar: string
  aciklama: string
}

function formatNumber(value: number) {
  return new Intl.NumberFormat('tr-TR').format(value)
}

function formatMoney(value: number) {
  return new Intl.NumberFormat('tr-TR', { style: 'currency', currency: 'TRY', maximumFractionDigits: 2 }).format(value)
}

function emptyForm(): FormState {
  const now = new Date()
  return {
    id: null,
    yil: String(now.getFullYear()),
    ay: String(now.getMonth() + 1),
    yemekMiktari: '',
    tutar: '',
    aciklama: '',
  }
}

export default function CenazeYemekleriReportPage() {
  const [rows, setRows] = useState<FuneralMealRow[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [formError, setFormError] = useState('')
  const [form, setForm] = useState<FormState>(emptyForm())

  const loadRows = async () => {
    setIsLoading(true)
    setLoadError('')
    try {
      const response = await fetch('/api/dashboard/cenaze-yemekleri', { cache: 'no-store' })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok || !payload.success) {
        throw new Error(payload.error || 'Cenaze yemekleri kayıtları alınamadı.')
      }
      setRows(payload.data || [])
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : 'Cenaze yemekleri kayıtları alınamadı.')
      setRows([])
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    void loadRows()
  }, [])

  const openAddModal = () => {
    setForm(emptyForm())
    setFormError('')
    setIsModalOpen(true)
  }

  const openEditModal = (row: FuneralMealRow) => {
    setForm({
      id: row.id,
      yil: String(row.yil),
      ay: String(row.ay),
      yemekMiktari: String(row.yemekMiktari),
      tutar: String(row.tutar),
      aciklama: row.aciklama || '',
    })
    setFormError('')
    setIsModalOpen(true)
  }

  const submitForm = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setFormError('')

    const yil = Number(form.yil)
    const ay = Number(form.ay)
    const yemekMiktari = Number(form.yemekMiktari)
    const tutar = Number(form.tutar)

    if (!Number.isInteger(yil) || yil < 2000 || yil > 2200) { setFormError('Geçerli bir yıl giriniz.'); return }
    if (!Number.isInteger(ay) || ay < 1 || ay > 12) { setFormError('Geçerli bir ay seçiniz.'); return }
    if (!Number.isFinite(yemekMiktari) || yemekMiktari < 0) { setFormError('Geçerli bir yemek miktarı giriniz.'); return }
    if (!Number.isFinite(tutar) || tutar < 0) { setFormError('Geçerli bir tutar giriniz.'); return }

    setIsSaving(true)
    try {
      const response = await fetch('/api/dashboard/cenaze-yemekleri', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          yil, ay, yemekMiktari, tutar,
          aciklama: form.aciklama.trim() || undefined,
        }),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok || !payload.success) {
        throw new Error(payload.error || 'Kayıt yapılamadı.')
      }
      setIsModalOpen(false)
      await loadRows()
    } catch (error) {
      setFormError(error instanceof Error ? error.message : 'Kayıt yapılamadı.')
    } finally {
      setIsSaving(false)
    }
  }

  const deleteRow = async (row: FuneralMealRow) => {
    if (!window.confirm(`${MONTH_NAMES[row.ay - 1]} ${row.yil} kaydı silinsin mi?`)) return
    try {
      const response = await fetch(`/api/dashboard/cenaze-yemekleri?id=${encodeURIComponent(row.id)}`, { method: 'DELETE' })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok || !payload.success) {
        throw new Error(payload.error || 'Kayıt silinemedi.')
      }
      await loadRows()
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Kayıt silinemedi.')
    }
  }

  const groupedByYear = useMemo(() => {
    const years = Array.from(new Set(rows.map((row) => row.yil))).sort((a, b) => b - a)
    return years.map((year) => {
      const items = rows.filter((row) => row.yil === year).sort((a, b) => a.ay - b.ay)
      const total = items.reduce((acc, row) => ({ miktar: acc.miktar + row.yemekMiktari, tutar: acc.tutar + row.tutar }), { miktar: 0, tutar: 0 })
      return { year, items, total }
    })
  }, [rows])

  const grandTotal = useMemo(
    () => rows.reduce((acc, row) => ({ miktar: acc.miktar + row.yemekMiktari, tutar: acc.tutar + row.tutar }), { miktar: 0, tutar: 0 }),
    [rows],
  )

  return (
    <div className="space-y-5 text-slate-950">
      <div className="rounded-md border border-amber-300 bg-gradient-to-r from-orange-700 via-amber-600 to-yellow-600 px-5 py-4 text-white shadow-sm">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-[15px] font-black uppercase tracking-wide text-white/90">Ana Sayfa Raporu</p>
            <h1 className="mt-1 text-3xl font-black leading-tight tracking-normal md:text-[34px]">Cenaze Yemekleri Raporu</h1>
            <p className="mt-1 text-sm font-bold text-white/85">Aylık verilen yemek sayısı ve ödenen tutar kayıtları</p>
          </div>
          <div className="flex items-center gap-3">
            <div className="rounded-md border border-white/30 bg-white/15 px-4 py-2 text-sm font-bold">
              Genel Toplam: {isLoading ? '...' : `${formatNumber(grandTotal.miktar)} yemek / ${formatMoney(grandTotal.tutar)}`}
            </div>
            <button
              type="button"
              onClick={openAddModal}
              className="rounded-md border border-white/30 bg-white/20 px-4 py-2 text-sm font-black transition hover:bg-white/30"
            >
              + Veri Gir
            </button>
          </div>
        </div>
      </div>

      {loadError && (
        <div className="rounded-md border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-bold text-rose-700">
          {loadError}
        </div>
      )}

      {isLoading ? (
        <div className="rounded-md border border-slate-200 bg-white p-8 text-center text-sm font-bold text-slate-500 shadow-sm">
          Kayıtlar yükleniyor...
        </div>
      ) : rows.length === 0 ? (
        <div className="rounded-md border border-slate-200 bg-white p-8 text-center text-sm font-bold text-slate-500 shadow-sm">
          Henüz cenaze yemeği kaydı girilmemiş.
        </div>
      ) : (
        <div className="space-y-4">
          {groupedByYear.map((group) => (
            <section key={group.year} className="overflow-hidden rounded-md border border-slate-200 bg-white shadow-sm">
              <div className="flex items-center justify-between border-b border-slate-100 bg-orange-50 px-4 py-3">
                <h2 className="text-base font-extrabold text-orange-800">{group.year} Yılı</h2>
                <span className="rounded-full border border-orange-200 bg-white px-3 py-1 text-[14px] font-extrabold text-orange-700">
                  Yıl Toplamı: {formatNumber(group.total.miktar)} yemek / {formatMoney(group.total.tutar)}
                </span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[720px] border-collapse text-left text-sm">
                  <thead className="bg-white text-[14px] font-extrabold uppercase text-slate-600">
                    <tr>
                      <th className="border-b border-slate-200 px-3 py-2">Dönem</th>
                      <th className="border-b border-slate-200 px-3 py-2 text-right">Miktar</th>
                      <th className="border-b border-slate-200 px-3 py-2 text-right">Tutar</th>
                      <th className="border-b border-slate-200 px-3 py-2">Açıklama</th>
                      <th className="border-b border-slate-200 px-3 py-2 text-right">İşlem</th>
                    </tr>
                  </thead>
                  <tbody>
                    {group.items.map((row) => (
                      <tr key={row.id} className="odd:bg-white even:bg-slate-50/60 hover:bg-orange-50/50">
                        <td className="border-b border-slate-100 px-3 py-2 font-black text-slate-900">{MONTH_NAMES[row.ay - 1]}</td>
                        <td className="border-b border-slate-100 px-3 py-2 text-right font-bold">{formatNumber(row.yemekMiktari)}</td>
                        <td className="border-b border-slate-100 px-3 py-2 text-right font-bold text-emerald-700">{formatMoney(row.tutar)}</td>
                        <td className="border-b border-slate-100 px-3 py-2 font-bold text-slate-600">{row.aciklama || '-'}</td>
                        <td className="border-b border-slate-100 px-3 py-2 text-right">
                          <div className="flex justify-end gap-3">
                            <button type="button" onClick={() => openEditModal(row)} className="text-[14px] font-black text-sky-600 hover:underline">Düzenle</button>
                            <button type="button" onClick={() => void deleteRow(row)} className="text-[14px] font-black text-rose-600 hover:underline">Sil</button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          ))}
        </div>
      )}

      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-sm">
          <form onSubmit={submitForm} className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3">
              <h3 className="text-base font-extrabold text-orange-700">
                {form.id ? 'Cenaze Yemeği Kaydını Düzenle' : 'Cenaze Yemeği Verisi Gir'}
              </h3>
              <button
                type="button"
                onClick={() => setIsModalOpen(false)}
                className="rounded-full p-1.5 text-slate-400 transition hover:bg-rose-50 hover:text-rose-500"
              >
                ✕
              </button>
            </div>
            <div className="space-y-3 p-5">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-[14px] font-black uppercase text-slate-500">Yıl</label>
                  <input
                    type="number"
                    value={form.yil}
                    onChange={(event) => setForm({ ...form, yil: event.target.value })}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-bold"
                    required
                  />
                </div>
                <div>
                  <label className="mb-1 block text-[14px] font-black uppercase text-slate-500">Ay</label>
                  <select
                    value={form.ay}
                    onChange={(event) => setForm({ ...form, ay: event.target.value })}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-bold"
                  >
                    {MONTH_NAMES.map((name, index) => (
                      <option key={name} value={index + 1}>{name}</option>
                    ))}
                  </select>
                </div>
              </div>
              <div>
                <label className="mb-1 block text-[14px] font-black uppercase text-slate-500">Yemek Miktarı</label>
                <input
                  type="number"
                  min={0}
                  value={form.yemekMiktari}
                  onChange={(event) => setForm({ ...form, yemekMiktari: event.target.value })}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-bold"
                  required
                />
              </div>
              <div>
                <label className="mb-1 block text-[14px] font-black uppercase text-slate-500">Tutar (TL)</label>
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  value={form.tutar}
                  onChange={(event) => setForm({ ...form, tutar: event.target.value })}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-bold"
                  required
                />
              </div>
              <div>
                <label className="mb-1 block text-[14px] font-black uppercase text-slate-500">Açıklama (opsiyonel)</label>
                <input
                  value={form.aciklama}
                  onChange={(event) => setForm({ ...form, aciklama: event.target.value })}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-bold"
                />
              </div>
              {form.id && (
                <p className="text-[11px] font-bold text-slate-400">
                  Not: Yıl/Ay değeri başka bir mevcut kayıtla aynı olacak şekilde değiştirilirse, bu kayıt o dönemin verisiyle birleşir.
                </p>
              )}
              {formError && (
                <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-bold text-rose-700">
                  {formError}
                </div>
              )}
            </div>
            <div className="flex justify-end gap-2 border-t border-slate-100 bg-slate-50 px-5 py-3">
              <button
                type="button"
                onClick={() => setIsModalOpen(false)}
                className="rounded-md border border-slate-300 bg-white px-4 py-2 text-[14px] font-extrabold text-slate-600 transition hover:bg-slate-100"
              >
                Vazgeç
              </button>
              <button
                type="submit"
                disabled={isSaving}
                className="rounded-md bg-orange-600 px-4 py-2 text-[14px] font-extrabold text-white transition hover:bg-orange-700 disabled:opacity-60"
              >
                {isSaving ? 'Kaydediliyor...' : 'Kaydet'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  )
}
