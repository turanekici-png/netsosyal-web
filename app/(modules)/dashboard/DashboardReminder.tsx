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

  // 2026-10-15 kullanici istegi: kurumsal (lacivert/altin) ve biraz daha
  // kucuk/derli toplu pencere. Islevler (kaydet/tamamla/sil/ertele/paylas) AYNI.
  const reminderRow = (item: Reminder) => {
    const due = !item.tamamlandi && new Date(item.hatirlatma_tarihi).getTime() <= Date.now()
    return (
      <div key={item.id} className={`rounded-lg border border-l-[3px] px-3 py-2 transition ${item.tamamlandi ? 'border-slate-200 border-l-slate-300 bg-slate-50 opacity-65' : due ? 'border-rose-200 border-l-rose-500 bg-rose-50/60' : 'border-[#D5DDE2] border-l-[#1E2A38] bg-white'}`}>
        <div className="flex items-start gap-2.5">
          <button type="button" onClick={() => void update(item.id, !item.tamamlandi)} title={item.tamamlandi ? 'Tamamlanmadı olarak işaretle' : 'Tamamlandı olarak işaretle'} className={`mt-0.5 flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded border text-[11px] ${item.tamamlandi ? 'border-emerald-600 bg-emerald-600 text-white' : 'border-slate-300 bg-white hover:border-[#1E2A38]'}`}>{item.tamamlandi ? '✓' : ''}</button>
          <div className="min-w-0 flex-1">
            <p className={`break-words text-[13.5px] font-bold text-[#1E2A38] ${item.tamamlandi ? 'line-through' : ''}`}>{item.baslik}</p>
            <p className={`mt-0.5 text-[11.5px] font-semibold ${due ? 'text-rose-700' : 'text-[#8A6D2B]'}`}>{new Date(item.hatirlatma_tarihi).toLocaleString('tr-TR', { dateStyle: 'medium', timeStyle: 'short' })}{due ? ' · gecikti' : ''}</p>
            {item.olusturan_kullanici && <p className="mt-0.5 text-[11px] font-medium text-slate-400">Oluşturan: {item.olusturan_kullanici}</p>}
            {item.not_metni && <p className="mt-1 whitespace-pre-wrap text-[12.5px] font-medium leading-5 text-slate-600">{item.not_metni}</p>}
          </div>
          <button type="button" onClick={() => void remove(item.id)} className="rounded-md px-1.5 py-0.5 text-[11.5px] font-semibold text-slate-400 hover:bg-rose-50 hover:text-rose-600">Sil</button>
        </div>
      </div>
    )
  }

  const filteredSharingUsers = sharingUsers.filter((user) => user.name.toLocaleLowerCase('tr-TR').includes(userFilter.trim().toLocaleLowerCase('tr-TR')))
  const LABEL = 'grid gap-1 text-[11px] font-bold uppercase tracking-[0.08em] text-slate-600'
  const INPUT = 'h-10 rounded-lg border border-slate-300 bg-white px-3 text-[13.5px] font-semibold normal-case tracking-normal text-[#1E2A38] outline-none transition focus:border-[#1E2A38] focus:ring-2 focus:ring-[#1E2A38]/10'
  const PANEL_TITLE = 'text-[10.5px] font-bold uppercase tracking-[0.14em] text-[#8A6D2B]'

  return <>
    {showTrigger && <div className="order-2 flex justify-end md:order-none">
      <button type="button" onClick={() => setOpen(true)} className={`relative inline-flex min-h-11 items-center gap-2 rounded-xl border px-4 text-sm font-black shadow-sm transition hover:-translate-y-0.5 hover:shadow-md ${dueCount ? 'animate-pulse border-rose-300 bg-rose-600 text-white' : 'border-amber-200 bg-gradient-to-r from-amber-50 to-orange-50 text-amber-800'}`}>
        <span className="text-lg">⏰</span> Hatırlatıcı
        {activeItems.length > 0 && <span className={`rounded-full px-2 py-0.5 text-[10px] ${dueCount ? 'bg-white text-rose-600' : 'bg-amber-600 text-white'}`}>{activeItems.length}</span>}
      </button>
    </div>}

    {open && mounted ? createPortal(
      <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-[#0f1a26]/60 p-2 backdrop-blur-[2px] sm:p-4" onMouseDown={(event) => { if (event.target === event.currentTarget) setOpen(false) }}>
        <div className="flex max-h-[88vh] w-full max-w-[1120px] flex-col overflow-hidden rounded-xl border border-[#1E2A38]/20 bg-white shadow-[0_24px_64px_rgba(16,30,43,0.35)]">
          <header className="flex items-center justify-between gap-3 border-b-[3px] border-b-[#D4B26A] bg-[#1E2A38] px-4 py-2.5 text-white sm:px-5">
            <div className="flex min-w-0 items-center gap-3">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-white/20 bg-white/10 text-[#D4B26A]">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-[18px] w-[18px]" aria-hidden><rect x="3" y="4" width="18" height="18" rx="2" /><path d="M16 2v4M8 2v4M3 10h18" /></svg>
              </span>
              <div className="min-w-0">
                <p className="text-[10.5px] font-bold uppercase tracking-[0.16em] text-[#D4B26A]">Kişisel İş Planlama</p>
                <h2 className="truncate text-[16px] font-bold tracking-wide">Takvim ve Hatırlatıcılar</h2>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span className="hidden items-center gap-2 rounded-md border border-white/15 bg-white/10 px-2.5 py-1 text-[12px] font-semibold sm:inline-flex">
                <span><b className="text-white">{activeItems.length}</b> <span className="text-white/70">aktif</span></span>
                <span className="text-white/30">|</span>
                <span className={dueCount ? 'text-rose-200' : 'text-white/70'}><b className={dueCount ? 'text-rose-100' : 'text-white'}>{dueCount}</b> geciken</span>
              </span>
              <button type="button" onClick={() => setOpen(false)} aria-label="Kapat" title="Kapat" className="flex h-8 w-8 items-center justify-center rounded-lg border border-white/20 bg-white/10 hover:bg-white/20">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" className="h-4 w-4" aria-hidden><path d="M18 6 6 18M6 6l12 12" /></svg>
              </button>
            </div>
          </header>

          <div className="grid min-h-0 flex-1 overflow-y-auto bg-[#F4F6F8] lg:grid-cols-[minmax(0,1fr)_minmax(0,0.9fr)] lg:overflow-hidden xl:grid-cols-[minmax(0,0.95fr)_minmax(0,0.85fr)_minmax(0,0.8fr)]">
            {/* 1) Takvim + secili gun */}
            <section className="min-w-0 border-b border-[#D5DDE2] p-3 sm:p-4 lg:overflow-y-auto lg:border-b-0 lg:border-r">
              <div className="mb-2 flex items-center justify-between rounded-lg border border-[#D5DDE2] bg-white px-1.5 py-1">
                <button type="button" aria-label="Önceki ay" onClick={() => setVisibleMonth(new Date(visibleMonth.getFullYear(), visibleMonth.getMonth() - 1, 1))} className="h-8 w-8 rounded-md text-[18px] font-bold text-[#1E2A38] hover:bg-[#F6F3EA]">‹</button>
                <div className="text-center leading-tight">
                  <span className="block text-[15px] font-bold text-[#1E2A38]">{MONTHS[visibleMonth.getMonth()]} {visibleMonth.getFullYear()}</span>
                  <button type="button" onClick={() => { const today = new Date(); setVisibleMonth(new Date(today.getFullYear(), today.getMonth(), 1)); selectDay(today) }} className="text-[10.5px] font-bold uppercase tracking-[0.1em] text-[#8A6D2B] hover:underline">Bugüne dön</button>
                </div>
                <button type="button" aria-label="Sonraki ay" onClick={() => setVisibleMonth(new Date(visibleMonth.getFullYear(), visibleMonth.getMonth() + 1, 1))} className="h-8 w-8 rounded-md text-[18px] font-bold text-[#1E2A38] hover:bg-[#F6F3EA]">›</button>
              </div>
              <div className="grid grid-cols-7 gap-1 text-center">{WEEKDAYS.map((day, index) => <div key={day} className={`py-0.5 text-[10.5px] font-bold uppercase tracking-wide ${index >= 5 ? 'text-[#8A6D2B]' : 'text-slate-500'}`}>{day}</div>)}</div>
              <div className="grid grid-cols-7 gap-[3px]">
                {cells.map((date) => {
                  const key = dateKey(date)
                  const dayItems = itemsByDate.get(key) || []
                  const selected = key === selectedDate
                  const today = key === dateKey(new Date())
                  const outside = date.getMonth() !== visibleMonth.getMonth()
                  const weekend = date.getDay() === 0 || date.getDay() === 6
                  const holiday = holidayName(date)
                  const overdue = dayItems.some((item) => !item.tamamlandi && new Date(item.hatirlatma_tarihi).getTime() <= Date.now())
                  return <button key={key} type="button" onClick={() => selectDay(date)} title={holiday || (weekend ? 'Hafta sonu' : undefined)} className={`relative min-h-[36px] rounded-md border px-1.5 py-0.5 text-left transition ${
                    selected ? 'border-[#1E2A38] bg-[#1E2A38] text-white shadow-sm'
                      : outside ? 'border-transparent bg-transparent text-slate-300'
                      : holiday ? 'border-rose-200 bg-rose-50 text-rose-800'
                      : today ? 'border-[#D4B26A] bg-[#FBF6E9] text-[#1E2A38]'
                      : weekend ? 'border-[#ECE3CC] bg-[#FBF9F3] text-[#6B5420] hover:border-[#D4B26A]'
                      : 'border-[#E2E7EC] bg-white text-[#1E2A38] hover:border-[#1E2A38]/40'
                  }`}>
                    <span className={`text-[12px] font-bold ${today && !selected ? 'text-[#8A6D2B]' : ''}`}>{date.getDate()}</span>
                    {holiday && <span className={`block truncate text-[8.5px] font-semibold leading-tight ${selected ? 'text-white/85' : 'text-rose-600'}`}>{holiday}</span>}
                    {dayItems.length > 0 && <span className={`absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[9.5px] font-bold ${selected ? 'bg-[#D4B26A] text-[#1E2A38]' : overdue ? 'bg-rose-600 text-white' : 'bg-[#1E2A38] text-white'}`}>{dayItems.length}</span>}
                  </button>
                })}
              </div>

              <div className="mt-3 rounded-lg border border-[#D5DDE2] bg-white p-3">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <h3 className="text-[13.5px] font-bold text-[#1E2A38]">{new Date(`${selectedDate}T12:00:00`).toLocaleDateString('tr-TR', { dateStyle: 'full' })}</h3>
                  <span className="text-[11.5px] font-semibold text-slate-500">{selectedItems.length} iş</span>
                </div>
                <div className="grid gap-1.5 sm:grid-cols-2">{selectedItems.length ? selectedItems.map(reminderRow) : <div className="col-span-full rounded-lg border border-dashed border-slate-200 p-4 text-center text-[12.5px] font-medium text-slate-400">Bu gün için planlanan iş yok.</div>}</div>
              </div>
            </section>

            {/* 2) Bildirimler + yeni hatirlatici + yaklasan isler */}
            <aside className="min-w-0 space-y-3 p-3 sm:p-4 lg:overflow-y-auto">
              {notifications}
              <form onSubmit={save} className="space-y-2.5 rounded-lg border border-[#D5DDE2] bg-white p-3">
                <div><p className={PANEL_TITLE}>Yeni Plan</p><h3 className="text-[14.5px] font-bold text-[#1E2A38]">Hatırlatıcı Oluştur</h3></div>
                <label className={LABEL}>İş Başlığı<input required maxLength={150} value={title} onChange={(event) => setTitle(event.target.value)} className={INPUT} placeholder="Örn. Dosya incelemesini tamamla" /></label>
                <label className={LABEL}>Tarih ve Saat<input required type="datetime-local" value={reminderAt} onChange={(event) => { const input = event.currentTarget; setReminderAt(input.value); if (input.value) { const date = new Date(input.value); setSelectedDate(dateKey(date)); setVisibleMonth(new Date(date.getFullYear(), date.getMonth(), 1)); window.setTimeout(() => input.blur(), 0) } }} className={INPUT} /></label>
                <label className={LABEL}>Açıklama<textarea maxLength={2000} rows={3} value={note} onChange={(event) => setNote(event.target.value)} className="resize-y rounded-lg border border-slate-300 bg-white p-2.5 text-[13.5px] font-medium normal-case leading-5 tracking-normal text-[#1E2A38] outline-none transition focus:border-[#1E2A38] focus:ring-2 focus:ring-[#1E2A38]/10" placeholder="Hatırlatılacak işin ayrıntıları" /></label>
                {selectedRecipientIds.length > 0 && <p className="rounded-md bg-[#EEF2F6] px-2.5 py-1.5 text-[12px] font-semibold text-[#1E2A38]">Size ek olarak <b>{selectedRecipientIds.length} kişiye</b> de hatırlatılacak.</p>}
                {error && <p className="rounded-md border-l-4 border-l-rose-500 bg-rose-50 px-2.5 py-1.5 text-[12.5px] font-semibold text-rose-800">{error}</p>}
                <button disabled={busy} className="h-10 w-full rounded-lg border-b-2 border-b-[#D4B26A] bg-[#1E2A38] text-[13.5px] font-bold text-white shadow-sm transition hover:bg-[#2A3B4D] disabled:opacity-50">{busy ? 'Kaydediliyor...' : 'Takvime Ekle'}</button>
              </form>

              <section className="rounded-lg border border-[#D5DDE2] bg-white p-3">
                <div className="mb-2 flex items-center justify-between"><h3 className={PANEL_TITLE}>Yaklaşan İşler</h3><span className="rounded-full bg-[#1E2A38] px-2 py-0.5 text-[11px] font-bold text-white">{activeItems.length}</span></div>
                <div className="space-y-1.5">{activeItems.length ? activeItems.slice(0, 10).map(reminderRow) : <p className="rounded-lg border border-dashed border-slate-200 p-4 text-center text-[12.5px] font-medium text-slate-400">Aktif hatırlatıcı yok.</p>}</div>
                {completedItems.length > 0 && <details className="mt-2"><summary className="cursor-pointer text-[12px] font-bold text-slate-500 hover:text-[#1E2A38]">Tamamlananlar ({completedItems.length})</summary><div className="mt-1.5 space-y-1.5">{completedItems.slice(0, 10).map(reminderRow)}</div></details>}
              </section>
            </aside>

            {/* 3) Paylasim - hatirlatilacak kullanicilar */}
            <aside className="min-w-0 border-t border-[#D5DDE2] p-3 sm:p-4 lg:col-span-2 lg:overflow-y-auto xl:col-span-1 xl:border-l xl:border-t-0">
              <section className="overflow-hidden rounded-lg border border-[#D5DDE2] bg-white">
                <div className="border-b border-[#D5DDE2] bg-[#F7F8FA] px-3 py-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <div><p className={PANEL_TITLE}>Paylaşımlı Plan</p><h3 className="text-[14px] font-bold text-[#1E2A38]">Hatırlatılacak Kişiler</h3></div>
                    {selectedRecipientIds.length > 0 && <span className="rounded-full bg-[#1E2A38] px-2 py-0.5 text-[11px] font-bold text-white">{selectedRecipientIds.length} kişi</span>}
                  </div>
                  <p className="mt-1 text-[11.5px] font-medium leading-snug text-slate-500">İsteğe bağlı. Seçtiğiniz kişilere de aynı hatırlatma gösterilir.</p>
                </div>
                <div className="p-2.5">
                  <label className="flex cursor-pointer items-center gap-2 rounded-md border border-[#D5DDE2] bg-[#F7F8FA] px-2.5 py-2 text-[12.5px] font-bold text-[#1E2A38]">
                    <input
                      type="checkbox"
                      checked={sharingUsers.length > 0 && sharingUsers.every((user) => selectedRecipientIds.includes(user.id))}
                      onChange={(event) => setSelectedRecipientIds(event.target.checked ? sharingUsers.map((user) => user.id) : [])}
                      className="h-4 w-4 accent-[#1E2A38]"
                    />
                    <span className="flex-1">Tüm kullanıcıları seç</span>
                    <span className="text-[11px] font-semibold text-slate-500">{sharingUsers.length}</span>
                  </label>
                  <input value={userFilter} onChange={(event) => setUserFilter(event.target.value)} placeholder="Kişi ara..." className="mt-2 h-9 w-full rounded-md border border-slate-300 bg-white px-2.5 text-[13px] font-semibold text-[#1E2A38] outline-none focus:border-[#1E2A38] focus:ring-2 focus:ring-[#1E2A38]/10" />
                  <div className="mt-2 max-h-[52vh] divide-y divide-slate-100 overflow-y-auto pr-0.5">
                    {filteredSharingUsers.map((user) => (
                      <label key={user.id} className={`flex cursor-pointer items-center gap-2 rounded px-1.5 py-[3px] text-[12.5px] font-semibold leading-tight transition ${selectedRecipientIds.includes(user.id) ? 'bg-[#EEF2F6] text-[#1E2A38]' : 'bg-white text-slate-700 hover:bg-[#F7F8FA]'}`}>
                        <input type="checkbox" checked={selectedRecipientIds.includes(user.id)} onChange={(event) => setSelectedRecipientIds((current) => event.target.checked ? [...current, user.id] : current.filter((id) => id !== user.id))} className="h-3.5 w-3.5 shrink-0 accent-[#1E2A38]" />
                        <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#E3E9F0] text-[8.5px] font-bold text-[#1E2A38]">{user.name.split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toLocaleUpperCase('tr-TR')}</span>
                        <span className="min-w-0 flex-1 truncate">{user.name}</span>
                      </label>
                    ))}
                    {sharingUsers.length === 0 && <p className="rounded-lg border border-dashed border-slate-200 p-4 text-center text-[12.5px] font-medium text-slate-400">Kullanıcı listesi alınamadı.</p>}
                    {sharingUsers.length > 0 && filteredSharingUsers.length === 0 && <p className="p-3 text-center text-[12.5px] font-medium text-slate-400">Eşleşen kişi yok.</p>}
                  </div>
                </div>
              </section>
            </aside>
          </div>
        </div>
      </div>, document.body) : null}

    {dueAlert && mounted ? createPortal(
      <div className="fixed inset-0 z-[11000] flex items-center justify-center bg-[#0f1a26]/70 p-4 backdrop-blur-sm">
        <div className="w-full max-w-md overflow-hidden rounded-xl border border-[#1E2A38]/20 bg-white shadow-2xl">
          <div className="border-b-[3px] border-b-[#D4B26A] bg-[#1E2A38] px-5 py-3.5 text-white"><p className="text-[10.5px] font-bold uppercase tracking-[0.16em] text-[#D4B26A]">Hatırlatma Zamanı</p><h2 className="mt-0.5 text-[18px] font-bold">{dueAlert.baslik}</h2></div>
          <div className="space-y-3 p-5"><p className="text-[13.5px] font-bold text-rose-700">{new Date(dueAlert.hatirlatma_tarihi).toLocaleString('tr-TR', { dateStyle: 'full', timeStyle: 'short' })}</p>{dueAlert.not_metni && <p className="whitespace-pre-wrap rounded-lg border border-[#D5DDE2] bg-[#F7F8FA] p-3 text-[13.5px] font-medium leading-6 text-slate-700">{dueAlert.not_metni}</p>}<div className="grid gap-2 sm:grid-cols-3"><button type="button" onClick={() => { setDueAlert(null); setOpen(true) }} className="h-10 rounded-lg border border-slate-300 bg-white text-[13px] font-bold text-[#1E2A38] hover:bg-[#F6F3EA]">Takvimi Aç</button><button type="button" onClick={() => { const next = new Date(Date.now() + 10 * 60 * 1000); void update(dueAlert.id, false, next); setDueAlert(null) }} className="h-10 rounded-lg border border-[#D4B26A] bg-[#FBF6E9] text-[13px] font-bold text-[#6B5420] hover:bg-[#F6EDD3]">10 Dk Ertele</button><button type="button" onClick={() => { void update(dueAlert.id, true); setDueAlert(null) }} className="h-10 rounded-lg border-b-2 border-b-[#D4B26A] bg-[#1E2A38] text-[13px] font-bold text-white hover:bg-[#2A3B4D]">Tamamlandı</button></div></div>
        </div>
      </div>, document.body) : null}
  </>
}
