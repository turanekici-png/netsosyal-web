'use client'

import { useEffect, useState } from 'react'

type AlertTone = 'success' | 'error' | 'warning' | 'info'

type QueuedAlert = {
  id: number
  message: string
  tone: AlertTone
}

// Uygulama genelinde YUZLERCE yerde dogrudan tarayicinin yerlesik
// window.alert(...) fonksiyonu kullaniliyor - bunlarin tek tek ozel bir
// bilesene cevrilmesi gerceci degil (cok sayida dosya/cagri noktasi).
// Bunun yerine window.alert'in KENDISINI, sayfa boyanir boyanmaz, ekranin
// ortasinda goruntulenen, renkli/profesyonel bu ozel modalimizi acacak
// sekilde DEGISTIRIYORUZ - boylece TUM mevcut alert(...) cagrilari, kod
// tek tek degistirilmeden otomatik olarak bu yeni gorunumu kazaniyor.
// NOT: window.confirm() AYNI SEKILDE (otomatik override ile) degistirilmedi
// - confirm() senkron bir boolean donmesi gerekiyor, ozel bir DOM modali ise
// bunu ASLA senkron taklit edemez. Onay pencereleri icin bunun yerine
// GlobalConfirmDialog.tsx'teki ASENKRON confirmDialog(...) fonksiyonu
// kullaniliyor - tum "window.confirm(...)" cagri noktalari elle
// "await confirmDialog(...)" seklinde guncellendi (bkz. GlobalConfirmDialog.tsx).
function detectAlertTone(message: string): AlertTone {
  const text = message.toLocaleLowerCase('tr-TR')

  if (/(başarı(lı|yla)?|tamamlandı|kaydedildi|oluşturuldu|güncellendi|gönderildi|silindi|dönüştürüldü|eklendi|atandı|kabul edildi)/.test(text)) {
    return 'success'
  }
  if (/(hata|başarısız|olamadı|olamaz|bulunamadı|silinemedi|kaydedilemedi|gönderilemedi|yetkiniz yok|geçersiz|hatalı|reddedildi)/.test(text)) {
    return 'error'
  }
  if (/(zorunlu|seçili değil|seçilmedi|gerekli|dikkat|uyarı|giriniz|seçiniz|eksik)/.test(text)) {
    return 'warning'
  }
  return 'info'
}

const TONE_STYLES: Record<AlertTone, { header: string; icon: string; iconGlyph: string; button: string }> = {
  success: {
    header: 'bg-gradient-to-r from-emerald-600 to-emerald-500',
    icon: 'bg-white/20 text-white',
    iconGlyph: '✓',
    button: 'bg-emerald-600 hover:bg-emerald-700',
  },
  error: {
    header: 'bg-gradient-to-r from-rose-600 to-red-500',
    icon: 'bg-white/20 text-white',
    iconGlyph: '✕',
    button: 'bg-rose-600 hover:bg-rose-700',
  },
  warning: {
    header: 'bg-gradient-to-r from-amber-500 to-orange-500',
    icon: 'bg-white/20 text-white',
    iconGlyph: '!',
    button: 'bg-amber-600 hover:bg-amber-700',
  },
  info: {
    header: 'bg-gradient-to-r from-[#0076b6] to-sky-500',
    icon: 'bg-white/20 text-white',
    iconGlyph: 'i',
    button: 'bg-[#0076b6] hover:bg-[#005f95]',
  },
}

const TONE_TITLES: Record<AlertTone, string> = {
  success: 'Başarılı',
  error: 'Hata',
  warning: 'Uyarı',
  info: 'Bilgi',
}

let nextAlertId = 1

export function GlobalAlertDialog() {
  const [queue, setQueue] = useState<QueuedAlert[]>([])

  useEffect(() => {
    const originalAlert = window.alert
    window.alert = (message?: unknown) => {
      const text = message === undefined ? '' : String(message)
      setQueue((prev) => [...prev, { id: nextAlertId++, message: text, tone: detectAlertTone(text) }])
    }

    return () => {
      window.alert = originalAlert
    }
  }, [])

  const current = queue[0]

  const dismiss = () => {
    setQueue((prev) => prev.slice(1))
  }

  if (!current) return null

  const style = TONE_STYLES[current.tone]

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-sm"
      role="alertdialog"
      aria-modal="true"
      onClick={dismiss}
    >
      <div
        className="w-full max-w-sm overflow-hidden rounded-2xl border border-white/60 bg-white shadow-2xl dark:border-slate-700 dark:bg-slate-900"
        onClick={(event) => event.stopPropagation()}
      >
        <div className={`flex items-center gap-3 px-5 py-4 text-white ${style.header}`}>
          <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-lg font-black ${style.icon}`}>
            {style.iconGlyph}
          </span>
          <h3 className="text-base font-black uppercase tracking-wide">{TONE_TITLES[current.tone]}</h3>
        </div>
        <div className="px-5 py-5">
          <p className="whitespace-pre-line text-sm font-bold leading-6 text-slate-800 dark:text-slate-100">
            {current.message}
          </p>
        </div>
        <div className="flex justify-end border-t border-slate-100 bg-slate-50 px-5 py-3 dark:border-slate-800 dark:bg-slate-950/40">
          <button
            type="button"
            autoFocus
            onClick={dismiss}
            className={`inline-flex items-center gap-2 rounded-lg px-5 py-2 text-sm font-extrabold text-white shadow-sm transition ${style.button}`}
          >
            Tamam
          </button>
        </div>
      </div>
    </div>
  )
}
