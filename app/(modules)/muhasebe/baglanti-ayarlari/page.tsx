'use client'

import { useEffect, useState } from 'react'

type WolvoxConnectionConfig = {
  host: string
  port: number
  database: string
  user: string
  password: string
}

const emptyConfig: WolvoxConnectionConfig = {
  host: '',
  port: 3050,
  database: '',
  user: 'SYSDBA',
  password: '',
}

function FieldLabel({ title, hint }: { title: string; hint: string }) {
  return (
    <span className="flex flex-col gap-1">
      <span className="text-lg font-black uppercase tracking-wide text-slate-700">{title}</span>
      <span className="text-sm font-semibold text-slate-400">{hint}</span>
    </span>
  )
}

const inputClass =
  'rounded-xl border-2 border-slate-200 bg-slate-50 px-5 py-4 text-lg font-bold text-slate-900 outline-none transition-colors focus:border-[#0076b6] focus:bg-white'

export default function MuhasebeBaglantiAyarlariPage() {
  const [config, setConfig] = useState<WolvoxConnectionConfig>(emptyConfig)
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [isTesting, setIsTesting] = useState(false)
  const [statusMessage, setStatusMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  useEffect(() => {
    let isCancelled = false

    fetch('/api/settings/wolvox', { cache: 'no-store' })
      .then(async (response) => {
        const payload = await response.json()
        if (!isCancelled && payload.success && payload.data) {
          setConfig(payload.data)
        }
      })
      .catch(() => {})
      .finally(() => {
        if (!isCancelled) setIsLoading(false)
      })

    return () => {
      isCancelled = true
    }
  }, [])

  const handleSave = async () => {
    setIsSaving(true)
    setStatusMessage(null)
    try {
      const response = await fetch('/api/settings/wolvox', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config),
      })
      const payload = await response.json()
      if (!response.ok || !payload.success) {
        throw new Error(payload.error || 'Kaydedilemedi.')
      }
      setStatusMessage({ type: 'success', text: 'Bağlantı bilgileri kaydedildi.' })
    } catch (error) {
      setStatusMessage({ type: 'error', text: error instanceof Error ? error.message : 'Kaydedilemedi.' })
    } finally {
      setIsSaving(false)
    }
  }

  const handleTest = async () => {
    setIsTesting(true)
    setStatusMessage(null)
    try {
      const response = await fetch('/api/settings/wolvox/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config),
      })
      const payload = await response.json()
      if (!response.ok || !payload.success) {
        throw new Error(payload.error || 'Bağlantı başarısız.')
      }
      setStatusMessage({ type: 'success', text: `Bağlantı başarılı — ${payload.tableCount} tablo görüldü.` })
    } catch (error) {
      setStatusMessage({ type: 'error', text: error instanceof Error ? error.message : 'Bağlantı başarısız.' })
    } finally {
      setIsTesting(false)
    }
  }

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-[#2A3B4D] bg-[#1E2A38] p-8 text-white shadow-sm sm:p-10">
        <p className="text-base font-black uppercase tracking-wide text-white/80">Muhasebe</p>
        <h1 className="mt-2 text-4xl font-black leading-tight">Bağlantı Ayarları</h1>
        <p className="mt-3 text-lg font-semibold leading-relaxed text-white/80">
          Wolvox muhasebe/stok veritabanına (Firebird) bağlantı bilgilerini buradan girin, test edin ve kaydedin.
        </p>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-8 shadow-sm sm:p-10">
        {isLoading ? (
          <p className="text-lg font-semibold text-slate-500">Yükleniyor...</p>
        ) : (
          <div className="space-y-8">
            <div className="grid gap-6 sm:grid-cols-[2fr_1fr]">
              <label className="flex flex-col gap-2">
                <FieldLabel title="Sunucu (IP/Host)" hint="Wolvox'un çalıştığı bilgisayarın IP adresi" />
                <input
                  type="text"
                  value={config.host}
                  onChange={(e) => setConfig((prev) => ({ ...prev, host: e.target.value }))}
                  placeholder="88.247.62.145"
                  className={inputClass}
                />
              </label>

              <label className="flex flex-col gap-2">
                <FieldLabel title="Port" hint="Firebird varsayılanı 3050" />
                <input
                  type="number"
                  value={config.port}
                  onChange={(e) => setConfig((prev) => ({ ...prev, port: Number(e.target.value) || 3050 }))}
                  placeholder="3050"
                  className={inputClass}
                />
              </label>
            </div>

            <label className="flex flex-col gap-2">
              <FieldLabel title="Veritabanı Dosya Yolu" hint="Sunucudaki tam .FDB dosya yolu" />
              <input
                type="text"
                value={config.database}
                onChange={(e) => setConfig((prev) => ({ ...prev, database: e.target.value }))}
                placeholder="C:\AKINSOFT\Wolvox9\Database_FB\HayatAgaci\2026\WOLVOX.FDB"
                className={`${inputClass} font-mono text-base sm:text-lg`}
              />
            </label>

            <div className="grid gap-6 sm:grid-cols-2">
              <label className="flex flex-col gap-2">
                <FieldLabel title="Kullanıcı Adı" hint="Firebird veritabanı kullanıcısı" />
                <input
                  type="text"
                  value={config.user}
                  onChange={(e) => setConfig((prev) => ({ ...prev, user: e.target.value }))}
                  placeholder="SYSDBA"
                  className={inputClass}
                />
              </label>

              <label className="flex flex-col gap-2">
                <FieldLabel title="Şifre" hint="Firebird veritabanı şifresi" />
                <input
                  type="password"
                  value={config.password}
                  onChange={(e) => setConfig((prev) => ({ ...prev, password: e.target.value }))}
                  className={inputClass}
                />
              </label>
            </div>

            {statusMessage && (
              <p
                className={`flex items-center gap-3 rounded-xl border-2 px-5 py-4 text-base font-black ${
                  statusMessage.type === 'success'
                    ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                    : 'border-rose-200 bg-rose-50 text-rose-700'
                }`}
              >
                <span className={`h-3 w-3 shrink-0 rounded-full ${statusMessage.type === 'success' ? 'bg-emerald-500' : 'bg-rose-500'}`} />
                {statusMessage.text}
              </p>
            )}

            <div className="flex flex-wrap items-center justify-end gap-4 border-t border-slate-100 pt-6">
              <button
                type="button"
                onClick={handleTest}
                disabled={isTesting}
                className="rounded-xl border-2 border-slate-200 bg-white px-8 py-4 text-lg font-black text-slate-700 shadow-sm transition-colors hover:bg-slate-50 disabled:opacity-50"
              >
                {isTesting ? 'Test ediliyor...' : 'Bağlantıyı Test Et'}
              </button>
              <button
                type="button"
                onClick={handleSave}
                disabled={isSaving}
                className="rounded-xl bg-[#0076b6] px-8 py-4 text-lg font-black text-white shadow-sm transition-colors hover:bg-[#005c8f] disabled:opacity-50"
              >
                {isSaving ? 'Kaydediliyor...' : 'Kaydet'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
