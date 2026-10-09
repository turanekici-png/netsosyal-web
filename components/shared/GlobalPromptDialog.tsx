'use client'

import { useEffect, useState } from 'react'

type QueuedPrompt = {
  id: number
  title: string
  message: string
  placeholder: string
  confirmLabel: string
  cancelLabel: string
  resolve: (value: string | null) => void
}

// GlobalConfirmDialog.tsx'teki confirmDialog(...) ile AYNI mantik: tarayicinin
// yerlesik window.prompt(...) penceresi (siyah, konumlandirilamayan, marka
// disi) yerine ekranin ORTASINDA, renkli/profesyonel bir metin girisi
// modali gosteren asenkron promptDialog(...) fonksiyonu. window.prompt gibi
// SENKRON calisamaz (React render'iyla celisir), bu yuzden cagri
// noktalarinda "const deger = window.prompt(...)" yerine
// "const deger = await promptDialog(...)" kullanilir.
let nextPromptId = 1
let enqueuePrompt: (
  (title: string, message: string, placeholder: string, confirmLabel: string, cancelLabel: string) => Promise<string | null>
) | null = null

export function promptDialog(
  message: string,
  options?: { title?: string; placeholder?: string; confirmLabel?: string; cancelLabel?: string },
): Promise<string | null> {
  if (enqueuePrompt) {
    return enqueuePrompt(
      options?.title ?? 'Gerekçe Gerekiyor',
      message,
      options?.placeholder ?? '',
      options?.confirmLabel ?? 'Onayla',
      options?.cancelLabel ?? 'Vazgeç',
    )
  }
  // GlobalPromptDialog henuz mount olmadiysa (ör. cok erken bir cagri)
  // tarayicinin yerlesik prompt'una geri don - hicbir zaman sessizce
  // engelleme/onay atlatma davranisi sergileme.
  if (typeof window !== 'undefined' && typeof window.prompt === 'function') {
    return Promise.resolve(window.prompt(message))
  }
  return Promise.resolve(null)
}

export function GlobalPromptDialog() {
  const [queue, setQueue] = useState<QueuedPrompt[]>([])
  const [value, setValue] = useState('')

  useEffect(() => {
    enqueuePrompt = (title, message, placeholder, confirmLabel, cancelLabel) => (
      new Promise<string | null>((resolve) => {
        setQueue((prev) => [...prev, { id: nextPromptId++, title, message, placeholder, confirmLabel, cancelLabel, resolve }])
      })
    )

    return () => {
      enqueuePrompt = null
    }
  }, [])

  const current = queue[0]

  useEffect(() => {
    setValue('')
  }, [current?.id])

  const respond = (result: string | null) => {
    current?.resolve(result)
    setQueue((prev) => prev.slice(1))
  }

  if (!current) return null

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-sm"
      role="alertdialog"
      aria-modal="true"
    >
      <div className="w-full max-w-md overflow-hidden rounded-2xl border-2 border-amber-300 bg-white shadow-2xl dark:border-amber-700 dark:bg-slate-900">
        <div className="flex items-center gap-3 bg-gradient-to-r from-amber-500 via-amber-500 to-orange-500 px-5 py-4 text-white">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white/20 text-lg font-black">
            !
          </span>
          <h3 className="text-base font-black uppercase tracking-wide">{current.title}</h3>
        </div>
        <div className="space-y-3 px-5 py-5">
          <p className="whitespace-pre-line text-sm font-bold leading-6 text-slate-800 dark:text-slate-100">
            {current.message}
          </p>
          <input
            autoFocus
            value={value}
            onChange={(event) => setValue(event.target.value)}
            placeholder={current.placeholder}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && value.trim()) respond(value.trim())
              if (event.key === 'Escape') respond(null)
            }}
            className="w-full rounded-lg border-2 border-amber-200 bg-amber-50/50 px-3 py-2 text-sm font-bold text-slate-900 outline-none focus:border-amber-500 focus:bg-white dark:border-amber-800 dark:bg-slate-800 dark:text-white"
          />
        </div>
        <div className="flex justify-end gap-2 border-t border-slate-100 bg-slate-50 px-5 py-3 dark:border-slate-800 dark:bg-slate-950/40">
          <button
            type="button"
            onClick={() => respond(null)}
            className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-5 py-2 text-sm font-extrabold text-slate-700 shadow-sm transition hover:bg-slate-100 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700"
          >
            {current.cancelLabel}
          </button>
          <button
            type="button"
            disabled={!value.trim()}
            onClick={() => respond(value.trim())}
            className="inline-flex items-center gap-2 rounded-lg bg-amber-600 px-5 py-2 text-sm font-extrabold text-white shadow-sm transition hover:bg-amber-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {current.confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
