'use client'

import { useEffect, useState } from 'react'

// Bu sayfa HERKESE AÇIKTIR (oturum gerektirmez - bkz. middleware.ts) çünkü
// tam olarak "henüz veritabanı/tablolar/ilk kullanıcı yokken" devreye
// girer - o an kimsenin oturumu olamaz. Sadece uygulama bu bilgisayarda
// İLK KEZ, boş bir veritabanına karşı çalıştırıldığında görünür; mevcut
// (kurulu) sistemlerde /api/setup/status hep "ready" döndüğü için bu sayfa
// otomatik olarak /login'e yönlendirir - bkz. app/login/page.tsx.
type SetupStatus =
  | { status: 'checking' }
  | { status: 'ready' }
  | { status: 'needs-setup'; reason: 'no-database' | 'no-tables' | 'no-admin' }
  | { status: 'provisioning'; step?: string }
  | { status: 'error'; message: string }
  | { status: 'done' }

const REASON_LABELS: Record<string, string> = {
  'no-database': 'Veritabanı bu bilgisayarda henüz oluşturulmamış.',
  'no-tables': 'Veritabanı var ama içinde hiç tablo yok.',
  'no-admin': 'Tablolar kurulu ama hiç kullanıcı tanımlı değil.',
}

export default function KurulumPage() {
  const [state, setState] = useState<SetupStatus>({ status: 'checking' })
  const [isSubmitting, setIsSubmitting] = useState(false)

  const checkStatus = async () => {
    try {
      const response = await fetch('/api/setup/status', { cache: 'no-store' })
      const payload = await response.json() as { success: boolean; data?: SetupStatus }

      if (!payload.success || !payload.data) {
        setState({ status: 'error', message: 'Kurulum durumu alınamadı.' })
        return
      }

      if (payload.data.status === 'ready') {
        setState({ status: 'ready' })
        window.setTimeout(() => window.location.replace('/login'), 1200)
        return
      }

      setState(payload.data)
    } catch {
      setState({ status: 'error', message: 'Sunucuya ulaşılamadı.' })
    }
  }

  useEffect(() => {
    void checkStatus()
  }, [])

  const startProvisioning = async () => {
    setIsSubmitting(true)
    setState({ status: 'provisioning' })

    try {
      const response = await fetch('/api/setup/provision', { method: 'POST' })
      const payload = await response.json() as { success: boolean; message?: string; error?: string }

      if (!payload.success) {
        setState({ status: 'error', message: payload.error || 'Kurulum başarısız oldu.' })
        return
      }

      setState({ status: 'done' })
      window.setTimeout(() => window.location.replace('/login'), 1500)
    } catch {
      setState({ status: 'error', message: 'Sunucuya ulaşılamadı.' })
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-gradient-to-br from-[#003f82] via-[#075b9f] to-[#0f8fb8] px-4 py-8">
      <div className="w-full max-w-lg overflow-hidden rounded-2xl border border-white/20 bg-white shadow-2xl">
        <div className="bg-[#003f82] px-6 py-6 text-white">
          <p className="text-xs font-black uppercase tracking-wide text-white/70">İlk Kurulum</p>
          <h1 className="mt-1 text-2xl font-black leading-tight">Sosyal Yardım Yönetim Sistemi</h1>
        </div>

        <div className="space-y-5 px-6 py-6">
          {state.status === 'checking' && (
            <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-8 text-center text-sm font-bold text-slate-500">
              Kurulum durumu kontrol ediliyor...
            </div>
          )}

          {state.status === 'ready' && (
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-4 text-sm font-bold text-emerald-800">
              Sistem zaten kurulu. Giriş sayfasına yönlendiriliyorsunuz...
            </div>
          )}

          {state.status === 'needs-setup' && (
            <>
              <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-4 text-sm font-bold text-amber-800">
                Bu bilgisayarda veritabanı henüz hazır değil.
                <p className="mt-1 font-semibold text-amber-700">{REASON_LABELS[state.reason]}</p>
              </div>

              <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-4 text-sm font-semibold leading-relaxed text-slate-600">
                Devam ederseniz sistem otomatik olarak:
                <ul className="mt-2 list-disc space-y-1 pl-5">
                  <li>Veritabanını (gerekiyorsa) oluşturacak,</li>
                  <li>Tüm tabloları kuracak,</li>
                  <li>.env.local dosyasında tanımlı bilgilerle ilk yönetici kullanıcıyı oluşturacak.</li>
                </ul>
              </div>

              <button
                type="button"
                onClick={() => void startProvisioning()}
                disabled={isSubmitting}
                className="w-full rounded-lg bg-[#6fb744] px-5 py-3 text-sm font-black text-white shadow-sm hover:bg-[#5aa333] disabled:cursor-wait disabled:opacity-60"
              >
                {isSubmitting ? 'Kurulum başlatılıyor...' : 'Kurulumu Onayla ve Başlat'}
              </button>
            </>
          )}

          {state.status === 'provisioning' && (
            <div className="rounded-lg border border-sky-200 bg-sky-50 px-4 py-8 text-center text-sm font-bold text-sky-800">
              <span className="mb-2 block animate-pulse text-base">Kurulum yapılıyor...</span>
              Bu işlem birkaç dakika sürebilir, lütfen sayfayı kapatmayın.
            </div>
          )}

          {state.status === 'done' && (
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-4 text-sm font-bold text-emerald-800">
              Kurulum tamamlandı! Giriş sayfasına yönlendiriliyorsunuz...
            </div>
          )}

          {state.status === 'error' && (
            <>
              <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-4 text-sm font-bold text-rose-700">
                {state.message}
              </div>
              <button
                type="button"
                onClick={() => void checkStatus()}
                className="w-full rounded-lg border border-slate-200 bg-white px-5 py-3 text-sm font-black text-slate-600 hover:bg-slate-50"
              >
                Tekrar Dene
              </button>
            </>
          )}
        </div>
      </div>
    </main>
  )
}
