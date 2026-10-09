'use client'

import { useCallback, useEffect, useState } from 'react'

type Reminder = { id: string; baslik: string; not_metni: string; hatirlatma_tarihi: string; tamamlandi: boolean }

async function payload(response: Response) {
  const text = await response.text()
  if (!text.trim()) return null
  try { return JSON.parse(text) } catch { return null }
}

export function ReminderDueNotifier() {
  const [due, setDue] = useState<Reminder | null>(null)
  const [busy, setBusy] = useState(false)

  const check = useCallback(async () => {
    try {
      const response = await fetch('/api/reminders', { cache: 'no-store' })
      if (!response.ok) return
      const result = await payload(response)
      const items = Array.isArray(result?.data) ? result.data as Reminder[] : []
      const nextDue = items.find((item) => !item.tamamlandi && new Date(item.hatirlatma_tarihi).getTime() <= Date.now()) || null
      setDue((current) => current && items.some((item) => item.id === current.id && !item.tamamlandi) ? current : nextDue)
    } catch { /* Oturum veya bağlantı yoksa bir sonraki kontrolde yeniden denenir. */ }
  }, [])

  useEffect(() => {
    void check()
    const interval = window.setInterval(() => void check(), 30000)
    const onVisible = () => { if (document.visibilityState === 'visible') void check() }
    document.addEventListener('visibilitychange', onVisible)
    return () => { window.clearInterval(interval); document.removeEventListener('visibilitychange', onVisible) }
  }, [check])

  const change = async (completed: boolean, reminderAt?: string) => {
    if (!due) return
    setBusy(true)
    try {
      const response = await fetch('/api/reminders', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: due.id, completed, reminderAt }),
      })
      if (!response.ok) throw new Error('İşlem kaydedilemedi.')
      setDue(null)
      window.setTimeout(() => void check(), 300)
    } finally { setBusy(false) }
  }

  if (!due) return null
  return <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-slate-950/70 p-3 backdrop-blur-sm">
    <div className="w-full max-w-xl overflow-hidden rounded-3xl border border-amber-200 bg-white shadow-[0_30px_90px_rgba(0,0,0,0.45)]">
      <div className="relative overflow-hidden bg-gradient-to-r from-amber-500 via-orange-500 to-rose-500 px-6 py-6 text-white">
        <div className="absolute -right-10 -top-12 h-32 w-32 rounded-full border-[20px] border-white/10" />
        <div className="relative flex items-center gap-4"><span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl border border-white/30 bg-white/20 text-3xl shadow-inner">⏰</span><div><p className="text-[10px] font-black uppercase tracking-[0.22em] text-amber-100">Hatırlatma Zamanı</p><h2 className="mt-1 text-2xl font-black">{due.baslik}</h2></div></div>
      </div>
      <div className="p-6">
        <div className="rounded-2xl border border-amber-200 bg-gradient-to-br from-amber-50 to-orange-50 p-4">
          <p className="text-xs font-black uppercase tracking-wide text-orange-700">Planlanan Zaman</p>
          <p className="mt-1 text-lg font-black text-slate-900">{new Date(due.hatirlatma_tarihi).toLocaleString('tr-TR')}</p>
          {due.not_metni && <p className="mt-4 whitespace-pre-wrap border-t border-amber-200 pt-4 text-base font-semibold leading-relaxed text-slate-700">{due.not_metni}</p>}
        </div>
        <div className="mt-5 grid gap-3 sm:grid-cols-2">
          <button type="button" disabled={busy} onClick={() => void change(false, new Date(Date.now() + 60 * 60000).toISOString())} className="min-h-12 rounded-xl border border-amber-300 bg-amber-50 px-4 text-sm font-black text-amber-800 shadow-sm transition hover:bg-amber-100 disabled:opacity-50">Daha Sonra Hatırlat · 60 Dakika</button>
          <button type="button" disabled={busy} onClick={() => void change(true)} className="min-h-12 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-500 px-4 text-sm font-black text-white shadow-lg shadow-emerald-200 transition hover:-translate-y-0.5 disabled:opacity-50">Tamam</button>
        </div>
      </div>
    </div>
  </div>
}
