'use client'

import { useEffect, useState } from 'react'

type QueuedConfirm = {
  id: number
  message: string
  confirmLabel: string
  cancelLabel: string
  resolve: (value: boolean) => void
}

// GlobalAlertDialog.tsx uygulamanin window.alert(...) cagrilarini ekranin
// ortasinda, renkli/profesyonel bir modalla degistiriyor. Ayni gorunumu
// window.confirm(...) icin de saglamak istendi ("bu ve buna benzer verilen
// tum bildirimler ... renkli sekilde versin"). ANCAK confirm() TARAYICIDA
// SENKRON bir boolean donuyor - ozel bir DOM modali (React state ile) bunu
// ASLA senkron taklit edemez (JS calisma dongusunu bloke edip React'in
// render etmesine izin vermek birbiriyle celisir). Bu yuzden window.confirm
// KENDISI degistirilmiyor; bunun yerine asenkron bir confirmDialog(...)
// fonksiyonu disa aktariliyor ve TUM cagri noktalarindaki
// "if (window.confirm(...))" satirlari "if (await confirmDialog(...))"
// seklinde guncellendi (bkz. bu degisiklikle birlikte guncellenen dosyalar).
let nextConfirmId = 1
let enqueueConfirm: ((message: string, confirmLabel?: string, cancelLabel?: string) => Promise<boolean>) | null = null

export function confirmDialog(message: string, confirmLabel = 'Evet, Onayla', cancelLabel = 'İptal'): Promise<boolean> {
  if (enqueueConfirm) return enqueueConfirm(message, confirmLabel, cancelLabel)
  // GlobalConfirmDialog henuz mount olmadiysa (ör. cok erken bir cagri)
  // tarayicinin yerlesik confirm'ine geri don - hicbir zaman "true" gibi
  // davranip guvenlik kontrolunu sessizce atlatma.
  if (typeof window !== 'undefined' && typeof window.confirm === 'function') {
    return Promise.resolve(window.confirm(message))
  }
  return Promise.resolve(false)
}

export function GlobalConfirmDialog() {
  const [queue, setQueue] = useState<QueuedConfirm[]>([])

  useEffect(() => {
    enqueueConfirm = (message: string, confirmLabel = 'Evet, Onayla', cancelLabel = 'İptal') => (
      new Promise<boolean>((resolve) => {
        setQueue((prev) => [...prev, { id: nextConfirmId++, message, confirmLabel, cancelLabel, resolve }])
      })
    )

    return () => {
      enqueueConfirm = null
    }
  }, [])

  const current = queue[0]

  const respond = (value: boolean) => {
    current?.resolve(value)
    setQueue((prev) => prev.slice(1))
  }

  if (!current) return null

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-sm"
      role="alertdialog"
      aria-modal="true"
    >
      <div className="w-full max-w-sm overflow-hidden rounded-2xl border border-white/60 bg-white shadow-2xl dark:border-slate-700 dark:bg-slate-900">
        <div className="flex items-center gap-3 bg-gradient-to-r from-amber-500 to-orange-500 px-5 py-4 text-white">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white/20 text-lg font-black text-white">
            ?
          </span>
          <h3 className="text-base font-black uppercase tracking-wide">Onay Gerekiyor</h3>
        </div>
        <div className="px-5 py-5">
          <p className="whitespace-pre-line text-sm font-bold leading-6 text-slate-800 dark:text-slate-100">
            {current.message}
          </p>
        </div>
        <div className="flex justify-end gap-2 border-t border-slate-100 bg-slate-50 px-5 py-3 dark:border-slate-800 dark:bg-slate-950/40">
          <button
            type="button"
            onClick={() => respond(false)}
            className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-5 py-2 text-sm font-extrabold text-slate-700 shadow-sm transition hover:bg-slate-100 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700"
          >
            {current.cancelLabel}
          </button>
          <button
            type="button"
            autoFocus
            onClick={() => respond(true)}
            className="inline-flex items-center gap-2 rounded-lg bg-amber-600 px-5 py-2 text-sm font-extrabold text-white shadow-sm transition hover:bg-amber-700"
          >
            {current.confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
