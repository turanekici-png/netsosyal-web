'use client'

// Bir sayfada (route segmenti) beklenmedik bir hata olustugunda Next.js bu
// bilesegi gosterir - ham hata yigini yerine nazik bir ekran + "Tekrar Dene".
// Uygulama kabugu (Header/Sidebar) korunur; sadece icerik alani degisir.

import { useEffect } from 'react'

export default function RouteError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    // Sunucu loglarina (server-err.log) dusmesi icin.
    console.error('[route-error]', error)
  }, [error])

  return (
    <div className="flex min-h-[420px] items-center justify-center p-4">
      <div className="max-w-lg rounded-xl border border-rose-200 bg-white p-6 text-center shadow-sm dark:border-rose-500/30 dark:bg-slate-900">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full border border-rose-200 bg-rose-50 text-lg font-black text-rose-700 dark:bg-rose-500/10">
          !
        </div>
        <h1 className="mt-4 text-xl font-black text-slate-950 dark:text-slate-100">Bir şeyler ters gitti</h1>
        <p className="mt-2 text-sm font-semibold text-slate-600 dark:text-slate-400">
          Bu bölüm yüklenirken beklenmeyen bir hata oluştu. Tekrar deneyebilir veya
          sayfayı yenileyebilirsiniz. Sorun sürerse sistem yöneticisine bildirin.
        </p>
        {error?.digest && (
          <p className="mt-3 rounded-md bg-slate-100 px-2 py-1 font-mono text-[11px] text-slate-500 dark:bg-slate-800 dark:text-slate-400">
            Hata kodu: {error.digest}
          </p>
        )}
        <div className="mt-5 flex justify-center gap-2">
          <button
            type="button"
            onClick={reset}
            className="rounded-lg bg-teal-600 px-4 py-2 text-sm font-bold text-white hover:bg-teal-700"
          >
            Tekrar Dene
          </button>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-bold text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200"
          >
            Sayfayı Yenile
          </button>
        </div>
      </div>
    </div>
  )
}
