'use client'

import { type ReactNode, useCallback, useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { confirmDialog } from '@/components/shared/GlobalConfirmDialog'

type Reminder = {
  id: string
  baslik: string
  not_metni: string
  hatirlatma_tarihi: string
  tamamlandi: boolean
  olusturan_kullanici?: string
}

type UserOption = { id: string; name: string }

type DashboardReminderProps = {
  open?: boolean
  onOpenChange?: (open: boolean) => void
  showTrigger?: boolean
  notifications?: ReactNode
}

const MONTHS = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık']
const WEEKDAYS = ['Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt', 'Paz']
const FIXED_HOLIDAYS: Record<string, string> = {
  '01-01': 'Yılbaşı',
  '04-23': 'Ulusal Egemenlik ve Çocuk Bayramı',
  '05-01': 'Emek ve Dayanışma Günü',
  '05-19': 'Atatürk’ü Anma, Gençlik ve Spor Bayramı',
  '07-15': 'Demokrasi ve Millî Birlik Günü',
  '08-30': 'Zafer Bayramı',
  '10-29': 'Cumhuriyet Bayramı',
}

function dateKey(value: Date | string) {
  const date = typeof value === 'string' ? new Date(value) : value
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function holidayName(date: Date) {
  return FIXED_HOLIDAYS[`${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`] || ''
}

function localDateTime(date: Date) {
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16)
}

function defaultDateTime(base = new Date()) {
  const date = new Date(base)
  date.setHours(dateKey(date) === dateKey(new Date()) ? Math.max(date.getHours() + 1, 9) : 9, 0, 0, 0)
  return localDateTime(date)
}

function monthCells(month: Date) {
  const first = new Date(month.getFullYear(), month.getMonth(), 1)
  const mondayOffset = (first.getDay() + 6) % 7
  const start = new Date(first)
  start.setDate(first.getDate() - mondayOffset)
  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(start)
    date.setDate(start.getDate() + index)
    return date
  })
}

async function readJsonResponse(response: Response) {
  const text = await response.text()
  if (!text.trim()) return { success: false, error: `Sunucu boş yanıt verdi (${response.status}).` }
  try { return JSON.parse(text) } catch { return { success: false, error: `Sunucudan geçersiz yanıt alındı (${response.status}).` } }
}

export function DashboardReminder({ open: controlledOpen, onOpenChange, showTrigger = true, notifications }: DashboardReminderProps = {}) {
  const [internalOpen, setInternalOpen] = useState(false)
  const open = controlledOpen ?? internalOpen
  const setOpen = (nextOpen: boolean) => {
    setInternalOpen(nextOpen)
    onOpenChange?.(nextOpen)
  }

  const now = new Date()
  const [mounted, setMounted] = useState(false)
  const [items, setItems] = useState<Reminder[]>([])
  const [visibleMonth, setVisibleMonth] = useState(new Date(now.getFullYear(), now.getMonth(), 1))
  const [selectedDate, setSelectedDate] = useState(dateKey(now))
  const [title, setTitle] = useState('')
  const [note, setNote] = useState('')
  const [reminderAt, setReminderAt] = useState(defaultDateTime(now))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [dueAlert, setDueAlert] = useState<Reminder | null>(null)
  const [sharingUsers, setSharingUsers] = useState<UserOption[]>([])
  const [selectedRecipientIds, setSelectedRecipientIds] = useState<string[]>([])
  const [userFilter, setUserFilter] = useState('')

  const load = useCallback(async () => {
    try {
      const response = await fetch('/api/reminders', { cache: 'no-store' })
      const payload = await readJsonResponse(response)
      if (!response.ok || !payload.success) throw new Error(payload.error || 'Hatırlatıcılar yüklenemedi.')
      setItems(payload.data || [])
      setError('')
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Hatırlatıcılar yüklenemedi.')
    }
  }, [])

  useEffect(() => {
    setMounted(true)
    void load()
    const intervalId = window.setInterval(() => void load(), 30_000)
    return () => window.clearInterval(intervalId)
  }, [load])

  useEffect(() => {
    fetch('/api/communication/users', { cache: 'no-store' })
      .then(async (response) => ({ response, payload: await response.json() }))
      .then(({ response, payload }) => {
        if (!response.ok || !payload.success) throw new Error(payload.error || 'Kullanıcılar alınamadı.')
        setSharingUsers(payload.data || [])
      })
      .catch(() => setSharingUsers([]))
  }, [])

  useEffect(() => {
    if (!mounted || dueAlert) return
    const due = items.find((item) => {
      if (item.tamamlandi || new Date(item.hatirlatma_tarihi).getTime() > Date.now()) return false
      return !window.sessionStorage.getItem(`reminder-alert:${item.id}:${item.hatirlatma_tarihi}`)
    })
    if (!due) return
    const alertKey = `reminder-alert:${due.id}:${due.hatirlatma_tarihi}`
    window.sessionStorage.setItem(alertKey, 'shown')
    setDueAlert(due)
  }, [dueAlert, items, mounted])

  const activeItems = useMemo(() => items.filter((item) => !item.tamamlandi), [items])
  const completedItems = useMemo(() => items.filter((item) => item.tamamlandi), [items])
  const dueCount = activeItems.filter((item) => new Date(item.hatirlatma_tarihi).getTime() <= Date.now()).length
  const cells = useMemo(() => monthCells(visibleMonth), [visibleMonth])
  const itemsByDate = useMemo(() => {
    const grouped = new Map<string, Reminder[]>()
    items.forEach((item) => {
      const key = dateKey(item.hatirlatma_tarihi)
      grouped.set(key, [...(grouped.get(key) || []), item])
    })
    return grouped
  }, [items])
  const selectedItems = itemsByDate.get(selectedDate) || []

  const selectDay = (date: Date) => {
    setSelectedDate(dateKey(date))
    setVisibleMonth(new Date(date.getFullYear(), date.getMonth(), 1))
    const chosen = new Date(date)
    chosen.setHours(9, 0, 0, 0)
    if (dateKey(chosen) === dateKey(new Date()) && chosen.getTime() <= Date.now()) chosen.setHours(new Date().getHours() + 1, 0, 0, 0)
    setReminderAt(localDateTime(chosen))
  }

  const save = async (event: React.FormEvent) => {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      const response = await fetch('/api/reminders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title,
          note,
          reminderAt: new Date(reminderAt).toISOString(),
          recipientUserIds: selectedRecipientIds,
        }),
      })
      const payload = await readJsonResponse(response)
      if (!response.ok || !payload.success) throw new Error(payload.error || 'Hatırlatıcı kaydedilemedi.')
      setTitle('')
      setNote('')
      setSelectedRecipientIds([])
      await load()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Hatırlatıcı kaydedilemedi.')
    } finally {
      setBusy(false)
    }
  }

  const update = async (id: string, completed: boolean, nextDate?: Date) => {
    const response = await fetch('/api/reminders', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, completed, reminderAt: nextDate?.toISOString() }),
    })
    const payload = await readJsonResponse(response)
    if (!response.ok || !payload.success) setError(payload.error || 'Hatırlatıcı güncellenemedi.')
    await load()
  }

  const remove = async (id: string) => {
    if (!(await confirmDialog('Hatırlatıcı silinsin mi?'))) return
    await fetch('/api/reminders', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) })
    await load()
  }

  const reminderRow = (item: Reminder) => {
    const due = !item.tamamlandi && new Date(item.hatirlatma_tarihi).getTime() <= Date.now()
    return (
      <div key={item.id} className={`rounded-xl border p-3 transition ${item.tamamlandi ? 'border-slate-200 bg-slate-50 opacity-65' : due ? 'border-rose-300 bg-rose-50 shadow-sm' : 'border-sky-200 bg-white shadow-sm'}`}>
        <div className="flex items-start gap-3">
          <button type="button" onClick={() => void update(item.id, !item.tamamlandi)} className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded border text-xs ${item.tamamlandi ? 'border-emerald-500 bg-emerald-500 text-white' : 'border-slate-300 bg-white'}`}>{item.tamamlandi ? '✓' : ''}</button>
          <div className="min-w-0 flex-1">
            <p className={`break-words text-sm font-black text-slate-900 ${item.tamamlandi ? 'line-through' : ''}`}>{item.baslik}</p>
            <p className={`mt-0.5 text-[11px] font-black ${due ? 'text-rose-700' : 'text-sky-700'}`}>{new Date(item.hatirlatma_tarihi).toLocaleString('tr-TR', { dateStyle: 'medium', timeStyle: 'short' })}</p>
            {item.olusturan_kullanici && <p className="mt-0.5 text-[10px] font-bold text-slate-400">Oluşturan: {item.olusturan_kullanici}</p>}
            {item.not_metni && <p className="mt-1.5 whitespace-pre-wrap text-xs font-semibold leading-5 text-slate-600">{item.not_metni}</p>}
          </div>
          <button type="button" onClick={() => void remove(item.id)} className="rounded-md px-2 py-1 text-[10px] font-black text-rose-600 hover:bg-rose-100">Sil</button>
        </div>
      </div>
    )
  }

  return <>
    {showTrigger && <div className="order-2 flex justify-end md:order-none">
      <button type="button" onClick={() => setOpen(true)} className={`relative inline-flex min-h-11 items-center gap-2 rounded-xl border px-4 text-sm font-black shadow-sm transition hover:-translate-y-0.5 hover:shadow-md ${dueCount ? 'animate-pulse border-rose-300 bg-rose-600 text-white' : 'border-amber-200 bg-gradient-to-r from-amber-50 to-orange-50 text-amber-800'}`}>
        <span className="text-lg">⏰</span> Hatırlatıcı
        {activeItems.length > 0 && <span className={`rounded-full px-2 py-0.5 text-[10px] ${dueCount ? 'bg-white text-rose-600' : 'bg-amber-600 text-white'}`}>{activeItems.length}</span>}
      </button>
    </div>}

    {open && mounted ? createPortal(
      <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-slate-950/65 p-2 backdrop-blur-[2px] sm:p-4" onMouseDown={(event) => { if (event.target === event.currentTarget) setOpen(false) }}>
        <div className="flex max-h-[97vh] w-full max-w-7xl flex-col overflow-hidden rounded-2xl border border-sky-200 bg-white shadow-2xl">
          <header className="flex items-center justify-between bg-gradient-to-r from-[#005f95] via-[#0076b6] to-emerald-600 px-4 py-3 text-white sm:px-6 sm:py-4">
            <div><p className="text-[10px] font-black uppercase tracking-[0.2em] text-sky-100">Kişisel İş Planlama</p><h2 className="text-lg font-black sm:text-2xl">Takvim ve Hatırlatıcılarım</h2></div>
            <div className="flex items-center gap-2"><span className="hidden rounded-full bg-white/15 px-3 py-1 text-xs font-black sm:inline">{activeItems.length} aktif · {dueCount} geciken</span><button type="button" onClick={() => setOpen(false)} className="rounded-lg border border-white/25 bg-white/15 px-3 py-2 text-xs font-black hover:bg-white/25">Kapat</button></div>
          </header>

          <div className="grid min-h-0 flex-1 overflow-y-auto xl:grid-cols-[minmax(460px,.95fr)_minmax(360px,.75fr)_minmax(290px,.55fr)] xl:overflow-hidden">
            <section className="min-w-0 border-b border-sky-100 bg-gradient-to-br from-sky-50/80 to-white p-3 sm:p-5 xl:overflow-y-auto xl:border-b-0 xl:border-r">
              <div className="mb-3 flex items-center justify-between rounded-xl border border-sky-200 bg-white p-2 shadow-sm">
                <button type="button" onClick={() => setVisibleMonth(new Date(visibleMonth.getFullYear(), visibleMonth.getMonth() - 1, 1))} className="h-9 w-10 rounded-lg bg-sky-50 text-xl font-black text-[#005f95] hover:bg-sky-100">‹</button>
                <button type="button" onClick={() => { const today = new Date(); setVisibleMonth(new Date(today.getFullYear(), today.getMonth(), 1)); selectDay(today) }} className="text-center"><span className="block text-lg font-black text-slate-900">{MONTHS[visibleMonth.getMonth()]} {visibleMonth.getFullYear()}</span><span className="text-[10px] font-black uppercase text-sky-600">Bugüne dön</span></button>
                <button type="button" onClick={() => setVisibleMonth(new Date(visibleMonth.getFullYear(), visibleMonth.getMonth() + 1, 1))} className="h-9 w-10 rounded-lg bg-sky-50 text-xl font-black text-[#005f95] hover:bg-sky-100">›</button>
              </div>
              <div className="grid grid-cols-7 gap-1 text-center">{WEEKDAYS.map((day, index) => <div key={day} className={`py-2 text-[10px] font-black uppercase ${index >= 5 ? 'text-amber-700' : 'text-slate-500'}`}>{day}</div>)}</div>
              <div className="grid grid-cols-7 gap-1 sm:gap-1.5">
                {cells.map((date) => {
                  const key = dateKey(date)
                  const dayItems = itemsByDate.get(key) || []
                  const selected = key === selectedDate
                  const today = key === dateKey(new Date())
                  const outside = date.getMonth() !== visibleMonth.getMonth()
                  const weekend = date.getDay() === 0 || date.getDay() === 6
                  const holiday = holidayName(date)
                  const overdue = dayItems.some((item) => !item.tamamlandi && new Date(item.hatirlatma_tarihi).getTime() <= Date.now())
                  return <button key={key} type="button" onClick={() => selectDay(date)} title={holiday || (weekend ? 'Hafta sonu' : undefined)} className={`relative min-h-14 rounded-lg border p-1.5 text-left transition sm:min-h-16 ${selected ? 'border-[#0076b6] bg-[#0076b6] text-white shadow-md' : holiday ? 'border-rose-300 bg-rose-50 text-rose-900' : weekend ? 'border-amber-200 bg-amber-50/80 text-amber-900' : today ? 'border-emerald-400 bg-emerald-50' : outside ? 'border-slate-100 bg-slate-50/70 text-slate-400' : 'border-slate-200 bg-white text-slate-800 hover:border-sky-300 hover:bg-sky-50'}`}>
                    <span className={`text-xs font-black sm:text-sm ${today && !selected ? 'text-emerald-700' : ''}`}>{date.getDate()}</span>
                    {holiday && <span className={`mt-0.5 block truncate text-[7px] font-black sm:text-[8px] ${selected ? 'text-white/90' : 'text-rose-600'}`}>{holiday}</span>}
                    {dayItems.length > 0 && <div className="mt-1 flex flex-wrap gap-1"><span className={`rounded-full px-1.5 py-0.5 text-[9px] font-black ${selected ? 'bg-white text-[#005f95]' : overdue ? 'bg-rose-100 text-rose-700' : 'bg-sky-100 text-sky-700'}`}>{dayItems.length} iş</span></div>}
                  </button>
                })}
              </div>

              <div className="mt-4 rounded-2xl border border-sky-200 bg-white p-4 shadow-sm">
                <h3 className="text-sm font-black text-[#005f95]">{new Date(`${selectedDate}T12:00:00`).toLocaleDateString('tr-TR', { dateStyle: 'full' })}</h3>
                <div className="mt-3 grid gap-2 lg:grid-cols-2">{selectedItems.length ? selectedItems.map(reminderRow) : <div className="col-span-full rounded-xl border border-dashed border-slate-200 p-5 text-center text-xs font-bold text-slate-400">Bu gün için planlanan iş bulunmuyor.</div>}</div>
              </div>
            </section>

            <aside className="min-w-0 space-y-4 bg-slate-50 p-3 sm:p-5 xl:overflow-y-auto">
              {notifications}
              <form onSubmit={save} className="space-y-3 rounded-2xl border border-emerald-200 bg-white p-4 shadow-sm">
                <div><p className="text-[10px] font-black uppercase tracking-wider text-emerald-600">Yeni Plan</p><h3 className="text-base font-black text-slate-900">Hatırlatıcı Oluştur</h3></div>
                <label className="grid gap-1 text-[11px] font-black uppercase text-slate-600">İş Başlığı<input required maxLength={150} value={title} onChange={(event) => setTitle(event.target.value)} className="min-h-11 rounded-lg border border-slate-200 bg-white px-3 text-sm font-bold normal-case text-slate-900 outline-none focus:border-emerald-500" placeholder="Örn. Dosya incelemesini tamamla" /></label>
                <label className="grid gap-1 text-[11px] font-black uppercase text-slate-600">Tarih ve Saat<input required type="datetime-local" value={reminderAt} onChange={(event) => { const input = event.currentTarget; setReminderAt(input.value); if (input.value) { const date = new Date(input.value); setSelectedDate(dateKey(date)); setVisibleMonth(new Date(date.getFullYear(), date.getMonth(), 1)); window.setTimeout(() => input.blur(), 0) } }} className="min-h-11 rounded-lg border border-slate-200 bg-white px-3 text-sm font-bold normal-case text-slate-900 outline-none focus:border-emerald-500" /></label>
                <label className="grid gap-1 text-[11px] font-black uppercase text-slate-600">Açıklama<textarea maxLength={2000} rows={4} value={note} onChange={(event) => setNote(event.target.value)} className="resize-y rounded-lg border border-slate-200 bg-white p-3 text-sm font-semibold normal-case leading-5 text-slate-900 outline-none focus:border-emerald-500" placeholder="Hatırlatılacak işin ayrıntıları" /></label>
                {error && <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-bold text-rose-700">{error}</p>}
                <div className="sticky bottom-0 z-10 -mx-1 rounded-xl border border-emerald-200 bg-white/95 p-1 shadow-[0_-8px_20px_rgba(15,118,110,0.10)] backdrop-blur-sm"><button disabled={busy} className="min-h-11 w-full rounded-lg bg-gradient-to-r from-emerald-600 to-teal-600 text-sm font-black text-white shadow-sm hover:brightness-105 disabled:opacity-50">{busy ? 'Kaydediliyor...' : 'Takvime Ekle'}</button></div>
              </form>

              <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                <div className="mb-3 flex items-center justify-between"><h3 className="text-sm font-black uppercase text-slate-700">Yaklaşan İşler</h3><span className="rounded-full bg-sky-100 px-2 py-1 text-[10px] font-black text-sky-700">{activeItems.length}</span></div>
                <div className="space-y-2">{activeItems.length ? activeItems.slice(0, 10).map(reminderRow) : <p className="rounded-xl border border-dashed border-slate-200 p-5 text-center text-xs font-bold text-slate-400">Aktif hatırlatıcı bulunmuyor.</p>}</div>
                {completedItems.length > 0 && <details className="mt-3"><summary className="cursor-pointer text-xs font-black text-slate-500">Tamamlananlar ({completedItems.length})</summary><div className="mt-2 space-y-2">{completedItems.slice(0, 10).map(reminderRow)}</div></details>}
              </section>
            </aside>

            <aside className="min-w-0 border-t border-violet-200 bg-gradient-to-b from-violet-50 to-white p-3 sm:p-5 xl:overflow-y-auto xl:border-l xl:border-t-0">
              <section className="overflow-hidden rounded-2xl border border-violet-200 bg-white shadow-sm">
                <div className="bg-gradient-to-r from-violet-700 to-indigo-600 px-4 py-3 text-white">
                  <div className="flex items-center justify-between gap-2"><div><p className="text-[9px] font-black uppercase tracking-wider text-violet-200">Paylaşımlı Plan</p><h3 className="text-sm font-black">Hatırlatılacak Kullanıcılar</h3></div>{selectedRecipientIds.length > 0 && <span className="rounded-full bg-white px-2 py-1 text-[9px] font-black text-violet-700">{selectedRecipientIds.length} kişi</span>}</div>
                  <p className="mt-1 text-[10px] font-semibold text-violet-100">Hatırlatma size ve seçtiğiniz kullanıcılara ayrı ayrı gösterilir.</p>
                </div>
                <div className="p-3">
                  <label className="flex cursor-pointer items-center gap-2 rounded-xl border border-violet-200 bg-violet-50 px-3 py-2.5 text-xs font-black text-violet-800">
                    <input
                      type="checkbox"
                      checked={sharingUsers.length > 0 && sharingUsers.every((user) => selectedRecipientIds.includes(user.id))}
                      onChange={(event) => setSelectedRecipientIds(event.target.checked ? sharingUsers.map((user) => user.id) : [])}
                      className="h-4 w-4 accent-violet-600"
                    />
                    <span className="flex-1">Tüm Kullanıcıları Seç</span>
                    <span className="rounded-full bg-white px-2 py-0.5 text-[9px] text-violet-600">{sharingUsers.length}</span>
                  </label>
                  <input value={userFilter} onChange={(event) => setUserFilter(event.target.value)} placeholder="Kullanıcı ara..." className="mt-3 h-10 w-full rounded-lg border border-violet-200 bg-white px-3 text-xs font-bold outline-none focus:border-violet-500" />
                  <div className="mt-3 max-h-[54vh] space-y-1.5 overflow-y-auto pr-1">
                    {sharingUsers.filter((user) => user.name.toLocaleLowerCase('tr-TR').includes(userFilter.trim().toLocaleLowerCase('tr-TR'))).map((user) => (
                      <label key={user.id} className={`flex cursor-pointer items-center gap-2 rounded-lg border px-2.5 py-2.5 text-xs font-bold transition ${selectedRecipientIds.includes(user.id) ? 'border-violet-300 bg-violet-50 text-violet-900' : 'border-slate-100 bg-white text-slate-700 hover:border-violet-200'}`}>
                        <input type="checkbox" checked={selectedRecipientIds.includes(user.id)} onChange={(event) => setSelectedRecipientIds((current) => event.target.checked ? [...current, user.id] : current.filter((id) => id !== user.id))} className="h-4 w-4 accent-violet-600" />
                        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-violet-100 text-[9px] font-black text-violet-700">{user.name.split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toLocaleUpperCase('tr-TR')}</span>
                        <span className="min-w-0 flex-1 truncate">{user.name}</span>
                      </label>
                    ))}
                    {sharingUsers.length === 0 && <p className="rounded-xl border border-dashed border-slate-200 p-5 text-center text-xs font-bold text-slate-400">Aktif kullanıcı bulunamadı.</p>}
                  </div>
                </div>
              </section>
            </aside>
          </div>
        </div>
      </div>, document.body) : null}

    {dueAlert && mounted ? createPortal(
      <div className="fixed inset-0 z-[11000] flex items-center justify-center bg-slate-950/70 p-4 backdrop-blur-sm">
        <div className="w-full max-w-lg overflow-hidden rounded-2xl border border-rose-200 bg-white shadow-2xl">
          <div className="bg-gradient-to-r from-rose-600 to-orange-500 px-5 py-4 text-white"><p className="text-[10px] font-black uppercase tracking-[0.2em] text-rose-100">Hatırlatma Zamanı</p><h2 className="mt-1 text-xl font-black">{dueAlert.baslik}</h2></div>
          <div className="space-y-4 p-5"><p className="text-sm font-black text-rose-700">{new Date(dueAlert.hatirlatma_tarihi).toLocaleString('tr-TR', { dateStyle: 'full', timeStyle: 'short' })}</p>{dueAlert.not_metni && <p className="whitespace-pre-wrap rounded-xl bg-slate-50 p-4 text-sm font-semibold leading-6 text-slate-700">{dueAlert.not_metni}</p>}<div className="grid gap-2 sm:grid-cols-3"><button type="button" onClick={() => { setDueAlert(null); setOpen(true) }} className="min-h-11 rounded-lg border border-sky-200 bg-sky-50 text-sm font-black text-sky-800">Takvimi Aç</button><button type="button" onClick={() => { const next = new Date(Date.now() + 10 * 60 * 1000); void update(dueAlert.id, false, next); setDueAlert(null) }} className="min-h-11 rounded-lg border border-amber-200 bg-amber-50 text-sm font-black text-amber-800">10 Dk Ertele</button><button type="button" onClick={() => { void update(dueAlert.id, true); setDueAlert(null) }} className="min-h-11 rounded-lg bg-emerald-600 text-sm font-black text-white">Tamamlandı</button></div></div>
        </div>
      </div>, document.body) : null}
  </>
}
