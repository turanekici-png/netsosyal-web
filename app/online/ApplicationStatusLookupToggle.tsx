'use client'

import { useEffect, useState } from 'react'

const GENERAL_SETTINGS_KEY = 'general_settings'

type SettingResponse<T> = {
  success: boolean
  data?: {
    value?: T
  }
  error?: string
}

type GeneralSettingsValue = {
  applicationStatusLookupEnabled?: boolean
  [key: string]: unknown
}

// Kullanici istegi (2026-09-22, 2. tur -> 3. tur): "bunu Ayarlar'dan alip
// Online Başvurular alaninin icine alalim" (2. tur) -> "Online Başvurular
// sayfasina değilde sol sidebardaki Ayarlar içinde olan Online Başvuru
// Formları sayfasina alalim" (3. tur) - bu bileşen artik Ayarlar > Sistem
// Ayarları > Online Başvuru Formları sekiminde (app/(modules)/settings/
// page.tsx, activeTab==='online') kullanılıyor. Kaydetme/yetki kontrolu
// icin bkz. app/api/online-applications/status-lookup-visibility/route.ts
// (online.forms.statusLookup yetkisi).
export function ApplicationStatusLookupToggle() {
  const [enabled, setEnabled] = useState(true)
  const [isLoaded, setIsLoaded] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [status, setStatus] = useState<{ type: 'success' | 'error'; message: string } | null>(null)

  useEffect(() => {
    let active = true

    const loadSetting = async () => {
      try {
        const response = await fetch(`/api/settings/${GENERAL_SETTINGS_KEY}`)
        if (response.status === 404) return
        const payload = await response.json() as SettingResponse<GeneralSettingsValue>
        if (!response.ok || !payload.success) throw new Error(payload.error || 'Ayar alınamadı.')
        if (active && payload.data?.value) {
          setEnabled(payload.data.value.applicationStatusLookupEnabled !== false)
        }
      } catch {
        // sessizce varsayilan (acik) ile devam - vatandasa acik sayfayi bozmayalim
      } finally {
        if (active) setIsLoaded(true)
      }
    }

    void loadSetting()
    return () => {
      active = false
    }
  }, [])

  const toggleEnabled = async () => {
    const next = !enabled
    setEnabled(next)
    setIsSaving(true)
    setStatus(null)

    try {
      // Kullanici istegi (2026-09-22, 3. tur): "bu işlemler için hangi
      // kullanıcıya yetki verilmiş ise o işlem yapabilsin" - artik genel/
      // paylasimli (ve genis "settings.update" yetkisi isteyen)
      // "/api/settings" yerine, ozel yetkiyi (online.forms.statusLookup)
      // kontrol eden ayri bir uc nokta kullaniliyor. Diger genel ayarlari
      // (kurum adi, telefon vb.) BOZMAMA mantigi artik SUNUCU tarafinda
      // (bkz. status-lookup-visibility/route.ts) yapiliyor.
      const saveResponse = await fetch('/api/online-applications/status-lookup-visibility', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: next }),
      })
      const payload = await saveResponse.json() as SettingResponse<GeneralSettingsValue>
      if (!saveResponse.ok || !payload.success) throw new Error(payload.error || 'Kaydedilemedi.')

      setStatus({
        type: 'success',
        message: next ? 'Başvuru sorgulama alanı vatandaşlara açık.' : 'Başvuru sorgulama alanı gizlendi.',
      })
    } catch (error) {
      setEnabled(!next)
      setStatus({ type: 'error', message: error instanceof Error ? error.message : 'Kaydedilemedi.' })
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-violet-200 bg-gradient-to-r from-violet-50 via-white to-white px-4 py-3 shadow-sm">
      <div className="flex items-center gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-violet-100 text-lg">🔍</span>
        <div>
          <p className="text-[10px] font-black uppercase tracking-wide text-violet-700">Başvuru Sorgulama</p>
          <p className="text-sm font-bold text-slate-700">
            {enabled
              ? 'Vatandaşlar /onlinebasvuru sayfasından başvurularını sorgulayabilir'
              : 'Sorgulama alanı vatandaşlardan gizli'}
          </p>
          {status && (
            <p className={`mt-0.5 text-xs font-bold ${status.type === 'error' ? 'text-rose-600' : 'text-emerald-600'}`}>
              {status.message}
            </p>
          )}
        </div>
      </div>
      <label className="relative inline-flex h-7 w-[52px] shrink-0 cursor-pointer items-center">
        <input
          type="checkbox"
          checked={enabled}
          disabled={!isLoaded || isSaving}
          onChange={() => void toggleEnabled()}
          className="peer sr-only"
        />
        <span className="absolute inset-0 rounded-full bg-slate-300 transition peer-checked:bg-violet-600 peer-disabled:opacity-60" />
        <span className="absolute left-1 h-5 w-5 rounded-full bg-white shadow transition peer-checked:translate-x-[24px]" />
      </label>
    </div>
  )
}
