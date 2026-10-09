'use client'

import { useEffect, useState } from 'react'

export const dynamic = 'force-dynamic'

type AutoRejectMatch = {
  id: string
  dosyaid: string
  muracaateden: string | null
  tckimlikno: string | null
  donem: string | null
  totalGelir: number
  maxVehicleYear: number | null
  reasons: string[]
}

type Thresholds = {
  gelirLimit: number | null
  aracYearLimit: number | null
}

export default function OtomatikRedSonuclariPage() {
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState('')
  const [checkedCount, setCheckedCount] = useState(0)
  const [thresholds, setThresholds] = useState<Thresholds>({ gelirLimit: null, aracYearLimit: null })
  const [matches, setMatches] = useState<AutoRejectMatch[]>([])
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [isApplying, setIsApplying] = useState(false)
  const [updatedCount, setUpdatedCount] = useState<number | null>(null)

  useEffect(() => {
    let isCancelled = false

    async function loadPreview() {
      try {
        const response = await fetch('/api/assistance/nakit/auto-reject', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ mode: 'preview' }),
        })
        const payload = await response.json().catch(() => ({}))
        if (!response.ok || !payload.success) {
          throw new Error(payload.error || 'Otomatik red kontrolü yapılamadı.')
        }
        if (!isCancelled) {
          setCheckedCount(payload.data.checkedCount)
          setThresholds(payload.data.thresholds)
          setMatches(payload.data.matches)
          setSelectedIds(new Set(payload.data.matches.map((match: AutoRejectMatch) => match.id)))
          setError('')
        }
      } catch (err) {
        if (!isCancelled) {
          setError(err instanceof Error ? err.message : 'Otomatik red kontrolü yapılamadı.')
        }
      } finally {
        if (!isCancelled) setIsLoading(false)
      }
    }

    void loadPreview()
    return () => { isCancelled = true }
  }, [])

  const toggleRow = (id: string) => {
    setSelectedIds((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const toggleAll = () => {
    setSelectedIds((current) => (
      current.size === matches.length ? new Set() : new Set(matches.map((match) => match.id))
    ))
  }

  const applySelected = async () => {
    if (selectedIds.size === 0) return
    setError('')
    setIsApplying(true)
    try {
      // Kullanici istegi (2026-09-29): "otomatik red açıklamasını nakit
      // yardımları tablosunda da görelim" - bu sayfadaki her satirin
      // reasons'i (asagidaki tabloda zaten gosteriliyor) apply istegiyle
      // birlikte gonderilip durumuaciklama alanina yazilir.
      const selectedMatches = matches
        .filter((match) => selectedIds.has(match.id))
        .map((match) => ({ id: match.id, reason: (match.reasons || []).join('; ') }))
      const response = await fetch('/api/assistance/nakit/auto-reject', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'apply', matches: selectedMatches }),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok || !payload.success) {
        throw new Error(payload.error || 'Otomatik red uygulanamadı.')
      }
      setUpdatedCount(payload.data.updatedCount)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Otomatik red uygulanamadı.')
    } finally {
      setIsApplying(false)
    }
  }

  const thresholdLabels = [
    thresholds.gelirLimit !== null ? `Aylık Gelir Sınırı: ${thresholds.gelirLimit.toLocaleString('tr-TR')} TL` : null,
    thresholds.aracYearLimit !== null ? `Araç Modeli Sınırı: ${thresholds.aracYearLimit}` : null,
  ].filter((label): label is string => Boolean(label))

  return (
    <div className="space-y-5 text-slate-950">
      <div className="rounded-md border border-rose-300 bg-gradient-to-r from-rose-700 via-rose-600 to-orange-600 px-5 py-4 text-white shadow-sm">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-[13px] font-black uppercase tracking-wide text-white/90">Nakit Yardımı Müracaatları</p>
            <h1 className="mt-1 text-3xl font-black leading-tight tracking-normal md:text-[34px]">Otomatik Red Kontrolü</h1>
            <p className="mt-1 text-sm font-bold text-white/85">
              Sadece durumu &quot;Yeni Müracaat&quot; (bekleyen) olan kayıtlar, Yardım Kriterleri sınırlarına göre kontrol edildi. Onay vermeden hiçbir kayıt değişmez.
            </p>
          </div>
          <div className="rounded-md border border-white/30 bg-white/15 px-4 py-2 text-sm font-bold">
            Kontrol Edilen: {isLoading ? '...' : checkedCount}
          </div>
        </div>
        {thresholdLabels.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-2">
            {thresholdLabels.map((label) => (
              <span key={label} className="rounded-full border border-white/30 bg-white/15 px-3 py-1 text-xs font-bold">
                {label}
              </span>
            ))}
          </div>
        )}
      </div>

      {error && (
        <div className="rounded-md border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-bold text-rose-700">
          {error}
        </div>
      )}

      {isLoading ? (
        <div className="rounded-md border border-slate-200 bg-white p-8 text-center text-sm font-bold text-slate-500 shadow-sm">
          Müracaatlar kontrol ediliyor...
        </div>
      ) : updatedCount !== null ? (
        <div className="rounded-md border border-emerald-200 bg-emerald-50 p-8 text-center text-sm font-bold text-emerald-700 shadow-sm">
          {updatedCount} müracaat &quot;Otomatik Red&quot; olarak güncellendi. Bu sekmeyi kapatabilirsiniz.
        </div>
      ) : matches.length === 0 ? (
        !error && (
          <div className="rounded-md border border-slate-200 bg-white p-8 text-center text-sm font-bold text-slate-500 shadow-sm">
            Yardım Kriterleri sınırlarını aşan bekleyen (durumu=0) müracaat bulunamadı.
          </div>
        )
      ) : (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex items-center gap-3">
              <label className="flex items-center gap-2 text-xs font-black uppercase text-slate-600">
                <input
                  type="checkbox"
                  checked={selectedIds.size === matches.length && matches.length > 0}
                  onChange={toggleAll}
                  className="h-4 w-4"
                />
                Tümünü Seç
              </label>
              <span className="rounded-full bg-rose-50 px-3 py-1 text-xs font-black text-rose-700">
                {matches.length} müracaat kriterleri aşıyor
              </span>
              <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-black text-slate-600">
                {selectedIds.size} seçili
              </span>
            </div>
            <button
              type="button"
              onClick={applySelected}
              disabled={isApplying || selectedIds.size === 0}
              className="rounded-md bg-rose-600 px-5 py-2.5 text-sm font-extrabold text-white shadow-sm transition hover:bg-rose-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isApplying ? 'Uygulanıyor...' : `Onayla ve Otomatik Red Uygula (${selectedIds.size} kayıt)`}
            </button>
          </div>

          <div className="overflow-x-auto rounded-md border border-slate-200 bg-white shadow-sm">
            <table className="w-full min-w-[820px] border-collapse text-left text-sm">
              <thead className="bg-rose-50 text-xs font-extrabold uppercase text-rose-800">
                <tr>
                  <th className="border-b border-rose-100 px-3 py-2"></th>
                  <th className="border-b border-rose-100 px-3 py-2">Müracaat Eden</th>
                  <th className="border-b border-rose-100 px-3 py-2">TC No</th>
                  <th className="border-b border-rose-100 px-3 py-2">Dönem</th>
                  <th className="border-b border-rose-100 px-3 py-2">Aşılan Kriter(ler)</th>
                </tr>
              </thead>
              <tbody>
                {matches.map((match) => (
                  <tr key={match.id} className="odd:bg-white even:bg-slate-50/60 hover:bg-rose-50/40">
                    <td className="border-b border-slate-100 px-3 py-2">
                      <input
                        type="checkbox"
                        checked={selectedIds.has(match.id)}
                        onChange={() => toggleRow(match.id)}
                        className="h-4 w-4"
                      />
                    </td>
                    <td className="border-b border-slate-100 px-3 py-2 font-bold text-slate-900">{match.muracaateden || '-'}</td>
                    <td className="border-b border-slate-100 px-3 py-2 font-bold">{match.tckimlikno || '-'}</td>
                    <td className="border-b border-slate-100 px-3 py-2 font-bold">{match.donem || '-'}</td>
                    <td className="border-b border-slate-100 px-3 py-2 font-semibold text-rose-700">{match.reasons.join(', ')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
