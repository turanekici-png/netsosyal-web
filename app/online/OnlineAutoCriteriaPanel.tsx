'use client'

import { useEffect, useState } from 'react'
import {
  DEFAULT_ONLINE_APPLICATION_AUTO_CRITERIA,
  ONLINE_APPLICATION_AUTO_CRITERIA_SETTING_KEY,
  normalizeOnlineApplicationAutoCriteria,
  type OnlineApplicationAutoCriteria,
} from '@/lib/constants/onlineApplicationForms'

type SettingResponse<T> = {
  success: boolean
  data?: {
    value?: T
  }
  error?: string
}

type ApplyCriteriaResponse = {
  success: boolean
  data?: {
    examined: number
    rejected: number
    updated: number
  }
  error?: string
}

// Kullanici istegi (2026-09-22): "üstteki otomatik eleme kriterleri alanını
// daha profesyonel ve açılır pencere şeklinde yapalım" - eskiden bu panel
// sayfanin EN USTUNDE, her zaman acik/buyuk bir kutu olarak duruyordu
// (listeyi asagi itiyordu). Artik ince, tek satirlik bir "durum çubuğu" +
// "Kriterleri Yönet" butonu var; asil form bir MODAL icinde acilir. Tum
// veri/kaydetme/uygulama mantigi (fetch/save/apply) AYNEN korundu, sadece
// gorunum degisti.
export function OnlineAutoCriteriaPanel() {
  const [isOpen, setIsOpen] = useState(false)
  const [criteria, setCriteria] = useState<OnlineApplicationAutoCriteria>(DEFAULT_ONLINE_APPLICATION_AUTO_CRITERIA)
  const [status, setStatus] = useState('')
  const [isSaving, setIsSaving] = useState(false)
  const [isApplying, setIsApplying] = useState(false)

  useEffect(() => {
    let active = true

    const loadCriteria = async () => {
      try {
        const response = await fetch(`/api/settings/${ONLINE_APPLICATION_AUTO_CRITERIA_SETTING_KEY}`)
        if (response.status === 404) return
        const payload = await response.json() as SettingResponse<Partial<OnlineApplicationAutoCriteria>>
        if (!response.ok || !payload.success) throw new Error(payload.error || 'Kriterler alinamadi.')
        if (active) setCriteria(normalizeOnlineApplicationAutoCriteria(payload.data?.value))
      } catch (error) {
        if (active) setStatus(error instanceof Error ? error.message : 'Kriterler alinamadi.')
      }
    }

    void loadCriteria()
    return () => {
      active = false
    }
  }, [])

  const updateCriteria = <K extends keyof OnlineApplicationAutoCriteria>(key: K, value: OnlineApplicationAutoCriteria[K]) => {
    setCriteria((current) => ({ ...current, [key]: value }))
  }

  // Kullanici istegi (2026-09-22, 3. tur): "bu işlemler için hangi
  // kullanıcıya yetki verilmiş ise o işlem yapabilsin" - kaydetme artik
  // genel/paylasimli (ve genis "settings.update" yetkisi isteyen)
  // "/api/settings" yerine, asagidaki "Kriterlere Uygula" ile AYNI ozel
  // yetkiyi (online.forms.criteria) kontrol eden ayri bir uc noktadan geçer.
  const persistCriteria = async () => {
    const nextCriteria = normalizeOnlineApplicationAutoCriteria(criteria)
    const response = await fetch('/api/online-applications/auto-criteria', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ criteria: nextCriteria }),
    })
    const payload = await response.json() as SettingResponse<OnlineApplicationAutoCriteria>
    if (!response.ok || !payload.success) throw new Error(payload.error || 'Kriterler kaydedilemedi.')
    setCriteria(nextCriteria)
    return nextCriteria
  }

  const saveCriteria = async () => {
    setIsSaving(true)
    setStatus('')

    try {
      await persistCriteria()
      setStatus('Otomatik eleme kriterleri kaydedildi.')
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Kriterler kaydedilemedi.')
    } finally {
      setIsSaving(false)
    }
  }

  const applyCriteria = async () => {
    setIsApplying(true)
    setStatus('')

    try {
      const nextCriteria = await persistCriteria()
      const response = await fetch('/api/online-applications/apply-criteria', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ criteria: nextCriteria }),
      })
      const payload = await response.json() as ApplyCriteriaResponse
      if (!response.ok || !payload.success) throw new Error(payload.error || 'Kriterler uygulanamadi.')

      const examined = payload.data?.examined ?? 0
      const rejected = payload.data?.rejected ?? 0
      const updated = payload.data?.updated ?? 0
      setStatus(`${examined} basvuru incelendi. ${rejected} basvuru kriterlere uymadi, ${updated} kayit guncellendi.`)
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Kriterler uygulanamadi.')
    } finally {
      setIsApplying(false)
    }
  }

  const activeCriteriaCount = [
    criteria.maxIncomeEnabled,
    criteria.minAgeEnabled,
    criteria.maxAgeEnabled,
    criteria.maxVehicleModelYearEnabled,
  ].filter(Boolean).length

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-200 bg-gradient-to-r from-amber-50 via-white to-white px-4 py-3 shadow-sm">
        <div className="flex items-center gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-amber-100 text-lg">⚙️</span>
          <div>
            <p className="text-[10px] font-black uppercase tracking-wide text-amber-700">Otomatik Eleme Kriterleri</p>
            <p className="text-sm font-bold text-slate-700">
              {activeCriteriaCount > 0
                ? `${activeCriteriaCount} kriter aktif — kayıt anında bunları aşan başvurular otomatik "Uygun Değil" olur`
                : 'Henüz aktif kriter yok'}
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => setIsOpen(true)}
          className="rounded-lg bg-amber-600 px-4 py-2 text-xs font-black uppercase tracking-wide text-white shadow-sm hover:bg-amber-700"
        >
          Kriterleri Yönet
        </button>
      </div>

      {isOpen && (
        <div
          className="fixed inset-0 z-[1500] flex items-center justify-center bg-slate-900/60 p-3 backdrop-blur-sm"
          onClick={() => setIsOpen(false)}
        >
          <div
            className="flex max-h-[90vh] w-full max-w-[720px] flex-col overflow-hidden rounded-2xl border border-amber-200 bg-white shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex shrink-0 items-center justify-between gap-2 bg-gradient-to-r from-amber-500 to-orange-500 px-5 py-4 text-white">
              <div className="min-w-0">
                <p className="text-[10px] font-black uppercase tracking-wide text-white/80">Otomatik Eleme Kriterleri</p>
                <h2 className="text-lg font-black leading-tight">Kayıt anında uygun değil yapılacak başvurular</h2>
              </div>
              <button
                type="button"
                onClick={() => setIsOpen(false)}
                aria-label="Kapat"
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-white/80 transition hover:bg-white/15 hover:text-white"
              >
                ✕
              </button>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto p-5">
              <p className="mb-4 text-xs font-semibold text-slate-500">
                Başvuru alınırken bu kriterler kontrol edilir; aşan kayıtlar otomatik UYGUN DEĞİL durumuna düşer.
              </p>

              <div className="grid gap-3 sm:grid-cols-2">
                <label className="flex flex-col gap-2 rounded-lg border border-amber-200 bg-amber-50/40 px-3 py-2.5">
                  <span className="flex items-center gap-2 text-sm font-bold text-slate-700">
                    <input
                      type="checkbox"
                      checked={criteria.maxIncomeEnabled}
                      onChange={(event) => updateCriteria('maxIncomeEnabled', event.target.checked)}
                      className="h-4 w-4"
                    />
                    Gelir üst sınırı
                  </span>
                  <input
                    type="number"
                    min={1}
                    value={criteria.maxIncome}
                    onChange={(event) => updateCriteria('maxIncome', Math.max(1, Number(event.target.value) || 10000))}
                    className="rounded border border-slate-300 bg-white px-2.5 py-2 text-sm font-black text-slate-800 outline-none focus:border-[#0076b6]"
                  />
                </label>

                <label className="flex flex-col gap-2 rounded-lg border border-emerald-200 bg-emerald-50/40 px-3 py-2.5">
                  <span className="flex items-center gap-2 text-sm font-bold text-slate-700">
                    <input
                      type="checkbox"
                      checked={criteria.minAgeEnabled}
                      onChange={(event) => updateCriteria('minAgeEnabled', event.target.checked)}
                      className="h-4 w-4"
                    />
                    Yaş alt sınırı
                  </span>
                  <input
                    type="number"
                    min={1}
                    value={criteria.minAge}
                    onChange={(event) => updateCriteria('minAge', Math.max(1, Number(event.target.value) || 18))}
                    className="rounded border border-slate-300 bg-white px-2.5 py-2 text-sm font-black text-slate-800 outline-none focus:border-emerald-600"
                  />
                </label>

                <label className="flex flex-col gap-2 rounded-lg border border-amber-200 bg-amber-50/40 px-3 py-2.5">
                  <span className="flex items-center gap-2 text-sm font-bold text-slate-700">
                    <input
                      type="checkbox"
                      checked={criteria.maxVehicleModelYearEnabled}
                      onChange={(event) => updateCriteria('maxVehicleModelYearEnabled', event.target.checked)}
                      className="h-4 w-4"
                    />
                    Araç model üst sınırı
                  </span>
                  <input
                    type="number"
                    min={1900}
                    value={criteria.maxVehicleModelYear}
                    onChange={(event) => updateCriteria('maxVehicleModelYear', Math.max(1900, Number(event.target.value) || 2005))}
                    className="rounded border border-slate-300 bg-white px-2.5 py-2 text-sm font-black text-slate-800 outline-none focus:border-[#0076b6]"
                  />
                </label>

                <label className="flex flex-col gap-2 rounded-lg border border-amber-200 bg-amber-50/40 px-3 py-2.5">
                  <span className="flex items-center gap-2 text-sm font-bold text-slate-700">
                    <input
                      type="checkbox"
                      checked={criteria.maxAgeEnabled}
                      onChange={(event) => updateCriteria('maxAgeEnabled', event.target.checked)}
                      className="h-4 w-4"
                    />
                    Yaş üst sınırı
                  </span>
                  <input
                    type="number"
                    min={1}
                    value={criteria.maxAge}
                    onChange={(event) => updateCriteria('maxAge', Math.max(1, Number(event.target.value) || 65))}
                    className="rounded border border-slate-300 bg-white px-2.5 py-2 text-sm font-black text-slate-800 outline-none focus:border-[#0076b6]"
                  />
                </label>
              </div>

              {status && (
                <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-bold text-amber-800">
                  {status}
                </div>
              )}
            </div>

            <div className="flex shrink-0 flex-col gap-2 border-t border-slate-100 p-4 sm:flex-row sm:justify-end">
              <button
                type="button"
                onClick={() => void applyCriteria()}
                disabled={isApplying || isSaving}
                className="rounded-lg bg-emerald-600 px-4 py-2 text-xs font-black uppercase text-white shadow-sm hover:bg-emerald-700 disabled:cursor-wait disabled:opacity-60"
              >
                {isApplying ? 'Uygulanıyor...' : 'Kriterlere Uygula'}
              </button>
              <button
                type="button"
                onClick={() => void saveCriteria()}
                disabled={isSaving || isApplying}
                className="rounded-lg bg-[#0076b6] px-4 py-2 text-xs font-black uppercase text-white shadow-sm hover:bg-[#005c8f] disabled:cursor-wait disabled:opacity-60"
              >
                {isSaving ? 'Kaydediliyor...' : 'Kriterleri Kaydet'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
