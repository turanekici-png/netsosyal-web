'use client'

import { useState } from 'react'
import { usePwa } from './PwaProvider'

// Kurumun gecerli sertifikali HTTPS adresi (IIS -> :3000).
const SECURE_ORIGIN = 'https://netsosyal.sivas.bel.tr'

type Props = {
  /** 'prominent' = büyük renkli buton (giriş ekranı), 'compact' = küçük (header) */
  variant?: 'prominent' | 'compact'
  className?: string
}

export function InstallAppButton({ variant = 'prominent', className = '' }: Props) {
  const { canPrompt, isInstalled, isIOS, isSecureContext, promptInstall } = usePwa()
  const [showHelp, setShowHelp] = useState(false)
  const [busy, setBusy] = useState(false)
  // Tarayicinin yukleme istemi hata verdiyse nedeni (talimat penceresinde gosterilir).
  const [promptError, setPromptError] = useState('')

  // Zaten yüklüyse hiç gösterme.
  if (isInstalled) return null

  // HTTP (ör. http://10.0.0.183:3000) ile girilmisse tarayici yuklemeye izin
  // vermez - kurulum icin kurumun HTTPS adresi kullanilmali.
  const secureUrl = typeof window !== 'undefined' && !isSecureContext
    ? `${SECURE_ORIGIN}${window.location.pathname}${window.location.search}`
    : ''

  const handleClick = async () => {
    setPromptError('')
    if (canPrompt) {
      setBusy(true)
      try {
        await promptInstall()
      } catch (error) {
        setPromptError(error instanceof Error && error.message ? error.message : 'Tarayıcı yükleme penceresini açamadı.')
        setShowHelp(true)
      } finally {
        setBusy(false)
      }
      return
    }
    // Gerçek istem yok (iOS her zaman; Android/masaüstü HTTPS yoksa) -> talimat göster.
    setShowHelp(true)
  }

  const label = variant === 'compact' ? 'Uygulamayı Yükle' : 'Uygulamayı Yükle / Ana Ekrana Ekle'

  return (
    <>
      <button
        type="button"
        onClick={handleClick}
        disabled={busy}
        title="Uygulamayı cihazınıza ekleyin"
        className={
          variant === 'prominent'
            ? `flex w-full items-center justify-center gap-2 rounded-lg border border-[#1E2A38]/25 bg-white px-4 py-2.5 text-[14px] font-bold text-[#1E2A38] shadow-sm transition hover:border-[#1E2A38]/50 hover:bg-[#F6F3EA] disabled:opacity-60 ${className}`
            : `inline-flex min-h-10 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg border border-[#E2E5DE] bg-white px-2.5 py-2 text-[11px] font-black uppercase tracking-wide text-[#16232B] shadow-sm transition hover:bg-[#F1F3EF] disabled:opacity-60 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700 sm:px-3 sm:text-xs ${className}`
        }
      >
        <svg viewBox="0 0 24 24" className={variant === 'prominent' ? 'h-4 w-4' : 'h-3.5 w-3.5'} fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M12 3v12" />
          <path d="m7 10 5 5 5-5" />
          <path d="M5 21h14" />
        </svg>
        {label}
      </button>

      {showHelp && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-sm" onClick={() => setShowHelp(false)}>
          <div className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl" onClick={(event) => event.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h3 className="text-base font-extrabold text-[#003f82]">Uygulamayı Cihazınıza Ekleyin</h3>
              <button type="button" onClick={() => setShowHelp(false)} className="rounded-full p-1 text-slate-400 hover:bg-rose-50 hover:text-rose-500">✕</button>
            </div>
            <p className="mt-2 text-[13px] font-semibold text-slate-600">
              Uygulamayı yükledikten sonra ana ekrandaki simgeye dokunarak adres yazmadan girebilirsiniz.
            </p>

            {promptError && (
              <p className="mt-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-[12px] font-bold text-rose-700">
                Tarayıcı yüklemeyi başlatamadı ({promptError}). Uygulama bu bilgisayarda zaten yüklü olabilir ya da
                tarayıcı ayarı/kurum politikası yüklemeyi engelliyor olabilir. Aşağıdaki adımları deneyin.
              </p>
            )}

            {!isIOS && secureUrl && (
              <div className="mt-3 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2.5 text-[12.5px] font-bold text-amber-800">
                Bu bilgisayar uygulamaya güvenli olmayan bir adresle bağlanıyor ({typeof window !== 'undefined' ? window.location.host : ''}).
                Tarayıcılar bu adreste uygulama yüklemeye izin vermez. Yüklemek için şu adresi kullanın:
                <a href={secureUrl} className="mt-1.5 block break-all font-black text-[#003f82] underline">
                  {SECURE_ORIGIN}
                </a>
                <span className="mt-1 block font-semibold text-amber-700">
                  Adres açılmıyorsa bilgisayarın ağ (DNS) ayarı eksiktir; bilgi işlem birimine bildirin.
                </span>
              </div>
            )}

            <div className="mt-4 space-y-3 text-[12.5px] font-semibold text-slate-700">
              {isIOS ? (
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                  <p className="font-black text-slate-900">iPhone / iPad (Safari)</p>
                  <ol className="mt-1 list-decimal space-y-1 pl-5">
                    <li>Alttaki <span className="font-black">Paylaş</span> simgesine (kutu + yukarı ok) dokunun.</li>
                    <li><span className="font-black">Ana Ekrana Ekle</span> seçeneğine dokunun.</li>
                    <li><span className="font-black">Ekle</span>&apos;ye dokunun.</li>
                  </ol>
                </div>
              ) : (
                <>
                  <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                    <p className="font-black text-slate-900">Android (Chrome)</p>
                    <ol className="mt-1 list-decimal space-y-1 pl-5">
                      <li>Sağ üstteki <span className="font-black">⋮</span> menüsüne dokunun.</li>
                      <li><span className="font-black">Uygulamayı yükle</span> / <span className="font-black">Ana ekrana ekle</span>&apos;ye dokunun.</li>
                    </ol>
                  </div>
                  <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                    <p className="font-black text-slate-900">Bilgisayar (Chrome / Edge)</p>
                    <ol className="mt-1 list-decimal space-y-1 pl-5">
                      <li>Adres çubuğunun sağındaki <span className="font-black">yükle simgesine</span> (ekran + ok) tıklayın.</li>
                      <li>Yoksa: <span className="font-black">⋮</span> menü → <span className="font-black">Uygulamalar → Bu sayfayı uygulama olarak yükle</span>.</li>
                    </ol>
                  </div>
                </>
              )}
            </div>

            {isIOS || !isSecureContext ? null : (
              <p className="mt-4 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-[11.5px] font-bold text-slate-600">
                Not: Tarayıcı yükleme düğmesini birkaç saniye site kullanıldıktan
                sonra kendiliğinden de gösterebilir. Görünmüyorsa yukarıdaki
                <span className="font-black"> ⋮</span> menü adımını kullanın.
              </p>
            )}
          </div>
        </div>
      )}
    </>
  )
}
