'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { confirmDialog } from '@/components/shared/GlobalConfirmDialog'

type UserOption = { id: string; name: string }
type CommunicationItem = {
  id: string
  type: 'mesaj' | 'duyuru'
  subject?: string | null
  content: string
  priority: number
  senderUserId: string
  senderName: string
  recipients: Array<{ userId: string; name: string; readAt?: string | null }>
  readAt?: string | null
  startsAt?: string | null
  expiresAt?: string | null
  createdAt: string
}

const formatDate = (value?: string | null) => value
  ? new Intl.DateTimeFormat('tr-TR', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value))
  : '-'

export default function CommunicationPage() {
  const [items, setItems] = useState<CommunicationItem[]>([])
  const [users, setUsers] = useState<UserOption[]>([])
  const [box, setBox] = useState<'inbox' | 'sent'>('inbox')
  const [filter, setFilter] = useState<'all' | 'mesaj' | 'duyuru'>('all')
  const [selectedId, setSelectedId] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [composeOpen, setComposeOpen] = useState(false)
  const [canPublishAnnouncement, setCanPublishAnnouncement] = useState(false)
  const [type, setType] = useState<'mesaj' | 'duyuru'>('mesaj')
  const [recipientId, setRecipientId] = useState('')
  const [allUsers, setAllUsers] = useState(true)
  const [subject, setSubject] = useState('')
  const [content, setContent] = useState('')
  const [priority, setPriority] = useState(0)
  const [startsAt, setStartsAt] = useState('')
  const [expiresAt, setExpiresAt] = useState('')
  const [sending, setSending] = useState(false)
  const [deletingId, setDeletingId] = useState('')

  const loadItems = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const query = new URLSearchParams({ box })
      if (filter !== 'all') query.set('type', filter)
      const response = await fetch(`/api/communication?${query}`, { cache: 'no-store' })
      const payload = await response.json()
      if (!response.ok) throw new Error(payload.error || 'İletiler alınamadı.')
      setItems(payload.data || [])
      setSelectedId((current) => payload.data?.some((item: CommunicationItem) => item.id === current) ? current : '')
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'İletiler alınamadı.')
    } finally {
      setLoading(false)
    }
  }, [box, filter])

  useEffect(() => { void loadItems() }, [loadItems])

  useEffect(() => {
    fetch('/api/communication/users', { cache: 'no-store' })
      .then(async (response) => ({ response, payload: await response.json() }))
      .then(({ response, payload }) => {
        if (!response.ok) throw new Error(payload.error)
        setUsers(payload.data || [])
        setCanPublishAnnouncement(Boolean(payload.canPublishAnnouncement))
      })
      .catch(() => setUsers([]))
  }, [])

  const selected = useMemo(() => items.find((item) => item.id === selectedId) || null, [items, selectedId])
  const unreadCount = items.filter((item) => box === 'inbox' && !item.readAt).length

  const openItem = async (item: CommunicationItem) => {
    setSelectedId(item.id)
    if (box === 'inbox' && !item.readAt) {
      setItems((current) => current.map((entry) => entry.id === item.id ? { ...entry, readAt: new Date().toISOString() } : entry))
      await fetch(`/api/communication/${item.id}/read`, { method: 'PATCH' }).catch(() => null)
      window.dispatchEvent(new Event('communication:updated'))
    }
  }

  const resetCompose = () => {
    setType('mesaj')
    setRecipientId('')
    setAllUsers(true)
    setSubject('')
    setContent('')
    setPriority(0)
    setStartsAt('')
    setExpiresAt('')
  }

  const send = async (event: React.FormEvent) => {
    event.preventDefault()
    setSending(true)
    setError('')
    try {
      const response = await fetch('/api/communication', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type,
          recipientUserIds: recipientId ? [recipientId] : [],
          allUsers: type === 'duyuru' && allUsers,
          subject,
          content,
          priority,
          startsAt: startsAt || null,
          expiresAt: expiresAt || null,
        }),
      })
      const payload = await response.json()
      if (!response.ok) throw new Error(payload.error || 'İleti gönderilemedi.')
      resetCompose()
      setComposeOpen(false)
      setBox('sent')
      await loadItems()
      window.dispatchEvent(new Event('communication:updated'))
    } catch (sendError) {
      setError(sendError instanceof Error ? sendError.message : 'İleti gönderilemedi.')
    } finally {
      setSending(false)
    }
  }

  const deleteMessage = async (scope: 'me' | 'everyone') => {
    if (!selected) return
    const confirmation = scope === 'everyone'
      ? 'Bu mesaj ve ekleri karşı taraftan da kalıcı olarak silinsin mi?'
      : 'Bu mesaj yalnızca sizin ekranınızdan silinsin mi?'
    if (!(await confirmDialog(confirmation))) return

    setDeletingId(selected.id)
    setError('')
    try {
      const response = await fetch(`/api/communication/${encodeURIComponent(selected.id)}?scope=${scope}`, { method: 'DELETE' })
      const payload = await response.json().catch(() => null) as { success?: boolean; error?: string } | null
      if (!response.ok || !payload?.success) throw new Error(payload?.error || 'Mesaj silinemedi.')
      setSelectedId('')
      await loadItems()
      window.dispatchEvent(new Event('communication:updated'))
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : 'Mesaj silinemedi.')
    } finally {
      setDeletingId('')
    }
  }

  return (
    <div className="flex min-h-[calc(100dvh-11rem)] min-w-0 flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm md:min-h-[620px] md:rounded-2xl">
      <div className="flex flex-col gap-3 border-b border-slate-200 bg-slate-50 px-3 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-4">
        <div className="min-w-0">
          <h1 className="truncate text-base font-black text-slate-950 sm:text-lg">Kurum İçi İletişim</h1>
          <p className="text-xs font-semibold text-slate-500">Personel mesajları ve kurum duyuruları</p>
        </div>
        <button onClick={() => setComposeOpen(true)} className="w-full rounded-lg bg-[#005f95] px-4 py-2.5 text-sm font-black text-white hover:bg-[#004b76] sm:w-auto sm:py-2">
          Yeni ileti
        </button>
      </div>

      {error && <div className="border-b border-rose-200 bg-rose-50 px-4 py-2 text-sm font-bold text-rose-700">{error}</div>}

      <div className="grid min-h-0 min-w-0 flex-1 md:grid-cols-[360px_minmax(0,1fr)]">
        <section className={`${selected ? 'hidden md:block' : 'block'} min-w-0 border-slate-200 md:border-r`}>
          <div className="grid grid-cols-2 gap-2 border-b border-slate-100 p-3 sm:flex">
            <button onClick={() => setBox('inbox')} className={`min-w-0 rounded-lg px-3 py-2.5 text-xs font-black sm:py-2 ${box === 'inbox' ? 'bg-sky-100 text-[#005f95]' : 'bg-slate-100 text-slate-600'}`}>Gelen {unreadCount > 0 ? `(${unreadCount})` : ''}</button>
            <button onClick={() => setBox('sent')} className={`min-w-0 rounded-lg px-3 py-2.5 text-xs font-black sm:py-2 ${box === 'sent' ? 'bg-sky-100 text-[#005f95]' : 'bg-slate-100 text-slate-600'}`}>Gönderilen</button>
            <select value={filter} onChange={(event) => setFilter(event.target.value as typeof filter)} className="col-span-2 min-h-10 min-w-0 rounded-lg border border-slate-200 bg-white px-3 text-xs font-bold sm:col-span-1 sm:ml-auto sm:min-h-0 sm:px-2">
              <option value="all">Tümü</option><option value="mesaj">Mesaj</option><option value="duyuru">Duyuru</option>
            </select>
          </div>
          <div className="max-h-[calc(100dvh-19rem)] overflow-y-auto md:max-h-[560px]">
            {loading ? <p className="p-5 text-center text-sm font-bold text-slate-400">Yükleniyor...</p> : items.length === 0 ? <p className="p-5 text-center text-sm font-bold text-slate-400">Kayıt bulunamadı.</p> : items.map((item) => (
              <button key={item.id} onClick={() => void openItem(item)} className={`block w-full border-b border-slate-100 p-3 text-left hover:bg-sky-50 ${selectedId === item.id ? 'bg-sky-50' : ''}`}>
                <div className="flex min-w-0 items-center gap-2">
                  {box === 'inbox' && !item.readAt && <span className="h-2 w-2 shrink-0 rounded-full bg-sky-600" />}
                  <span className={`rounded px-1.5 py-0.5 text-[10px] font-black uppercase ${item.type === 'duyuru' ? 'bg-amber-100 text-amber-700' : 'bg-cyan-100 text-cyan-700'}`}>{item.type}</span>
                  {item.priority > 0 && <span className="text-[10px] font-black text-rose-600">ÖNEMLİ</span>}
                  <span className="ml-auto shrink-0 text-[10px] font-bold text-slate-400">{formatDate(item.createdAt)}</span>
                </div>
                <p className="mt-1 truncate text-sm font-black text-slate-900">{item.subject || (box === 'sent' ? item.recipients.map((r) => r.name).join(', ') : item.senderName)}</p>
                <p className="mt-0.5 line-clamp-2 text-xs font-semibold text-slate-500">{item.content}</p>
              </button>
            ))}
          </div>
        </section>

        <section className={`${selected ? 'block' : 'hidden md:block'} min-h-0 min-w-0 p-3 sm:p-5 md:min-h-[420px]`}>
          {!selected ? <div className="flex h-full items-center justify-center text-sm font-bold text-slate-400">Okumak için bir ileti seçin.</div> : (
            <article className="mx-auto min-w-0 max-w-3xl">
              <button type="button" onClick={() => setSelectedId('')} className="mb-3 inline-flex min-h-10 items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 text-sm font-black text-[#005f95] shadow-sm md:hidden">
                <span aria-hidden="true">←</span> İleti listesine dön
              </button>
              <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-200 pb-4">
                <div className="min-w-0"><p className="text-xs font-black uppercase text-[#005f95]">{selected.type}</p><h2 className="mt-1 break-words text-lg font-black text-slate-950 sm:text-xl">{selected.subject || 'Personel mesajı'}</h2></div>
                <div className="flex flex-wrap items-center justify-end gap-2">
                  <button type="button" disabled={deletingId === selected.id} onClick={() => void deleteMessage('me')} className="rounded-lg border border-rose-200 bg-white px-3 py-2 text-[11px] font-black text-rose-600 hover:bg-rose-50 disabled:opacity-50">Benden Sil</button>
                  {box === 'sent' && <button type="button" disabled={deletingId === selected.id} onClick={() => void deleteMessage('everyone')} className="rounded-lg bg-rose-600 px-3 py-2 text-[11px] font-black text-white hover:bg-rose-700 disabled:opacity-50">Herkesten Sil</button>}
                  <time className="text-xs font-bold text-slate-500">{formatDate(selected.createdAt)}</time>
                </div>
              </div>
              <dl className="mt-4 grid min-w-0 gap-2 rounded-xl bg-slate-50 p-3 text-sm sm:p-4">
                <div className="min-w-0 break-words"><dt className="inline font-black text-slate-500">Gönderen: </dt><dd className="inline font-bold text-slate-800">{selected.senderName}</dd></div>
                <div className="min-w-0 break-words"><dt className="inline font-black text-slate-500">Alıcı: </dt><dd className="inline font-bold text-slate-800">{selected.recipients.map((r) => r.name).join(', ')}</dd></div>
                {selected.expiresAt && <div><dt className="inline font-black text-slate-500">Yayın sonu: </dt><dd className="inline font-bold text-slate-800">{formatDate(selected.expiresAt)}</dd></div>}
              </dl>
              <p className="mt-5 break-words whitespace-pre-wrap text-sm font-medium leading-6 text-slate-700 sm:text-[15px] sm:leading-7">{selected.content}</p>
              {box === 'sent' && <p className="mt-6 text-xs font-bold text-slate-400">Okuyan: {selected.recipients.filter((r) => r.readAt).length} / {selected.recipients.length}</p>}
            </article>
          )}
        </section>
      </div>

      {composeOpen && (
        <div className="fixed inset-0 z-[6000] flex items-center justify-center overflow-hidden bg-slate-950/45 sm:overflow-y-auto sm:p-6">
          <form onSubmit={send} className="h-[100dvh] w-full min-w-0 overflow-y-auto bg-white p-4 shadow-2xl sm:my-auto sm:h-auto sm:max-h-[calc(100dvh-3rem)] sm:max-w-4xl sm:rounded-2xl sm:p-7">
            <div className="sticky -top-4 z-10 flex items-center justify-between border-b border-slate-100 bg-white py-3 sm:static sm:border-0 sm:py-0"><h2 className="text-lg font-black text-slate-950">Yeni ileti</h2><button type="button" onClick={() => setComposeOpen(false)} aria-label="Pencereyi kapat" className="flex h-10 w-10 items-center justify-center rounded-lg text-2xl font-bold text-slate-500 hover:bg-slate-100">×</button></div>
            <div className="mt-4 grid gap-4">
              <label className="grid min-w-0 gap-1 text-xs font-black text-slate-600">Tür<select value={type} onChange={(event) => setType(event.target.value as typeof type)} className="min-h-11 min-w-0 w-full rounded-lg border border-slate-200 p-2.5 text-base sm:text-sm"><option value="mesaj">Personel mesajı</option>{canPublishAnnouncement && <option value="duyuru">Duyuru</option>}</select></label>
              {type === 'duyuru' && <label className="flex min-h-11 items-center gap-3 rounded-lg bg-slate-50 px-3 text-sm font-bold text-slate-700"><input type="checkbox" checked={allUsers} onChange={(event) => setAllUsers(event.target.checked)} className="h-5 w-5 shrink-0" /> Tüm aktif personele gönder</label>}
              {(type === 'mesaj' || !allUsers) && <label className="grid min-w-0 gap-1 text-xs font-black text-slate-600">Alıcı<select required value={recipientId} onChange={(event) => setRecipientId(event.target.value)} className="min-h-11 min-w-0 w-full rounded-lg border border-slate-200 p-2.5 text-base sm:text-sm"><option value="">Personel seçin</option>{users.map((user) => <option key={user.id} value={user.id}>{user.name}</option>)}</select></label>}
              {type === 'duyuru' && <label className="grid min-w-0 gap-1 text-xs font-black text-slate-600">Başlık<input required maxLength={200} value={subject} onChange={(event) => setSubject(event.target.value)} className="min-h-11 min-w-0 w-full rounded-lg border border-slate-200 p-2.5 text-base sm:text-sm" /></label>}
              <label className="grid min-w-0 gap-1 text-xs font-black text-slate-600">İçerik<textarea required maxLength={10000} rows={7} value={content} onChange={(event) => setContent(event.target.value)} className="min-w-0 w-full resize-y rounded-lg border border-slate-200 p-2.5 text-base sm:text-sm" /></label>
              {type === 'duyuru' && <div className="grid min-w-0 items-start gap-4 lg:grid-cols-[180px_minmax(260px,1fr)_minmax(260px,1fr)]"><label className="grid min-w-0 gap-1 text-xs font-black text-slate-600">Önem<select value={priority} onChange={(event) => setPriority(Number(event.target.value))} className="min-h-11 min-w-0 w-full rounded-lg border border-slate-200 p-3 text-base sm:text-sm"><option value={0}>Normal</option><option value={1}>Önemli</option><option value={2}>Kritik</option></select></label><label className="grid min-w-0 gap-1 text-xs font-black text-slate-600">Yayın başlangıcı<input type="datetime-local" value={startsAt} onChange={(event) => setStartsAt(event.target.value)} className="min-h-11 min-w-0 w-full max-w-full rounded-lg border border-slate-200 p-3 text-base sm:text-sm" /><span className="font-semibold text-slate-400">Boşsa hemen yayınlanır</span></label><label className="grid min-w-0 gap-1 text-xs font-black text-slate-600">Yayın bitişi<input type="datetime-local" min={startsAt || undefined} value={expiresAt} onChange={(event) => setExpiresAt(event.target.value)} className="min-h-11 min-w-0 w-full max-w-full rounded-lg border border-slate-200 p-3 text-base sm:text-sm" /></label></div>}
            </div>
            <div className="mt-5 grid grid-cols-2 gap-2 border-t border-slate-100 bg-white pt-4 sm:flex sm:justify-end"><button type="button" onClick={() => setComposeOpen(false)} className="min-h-11 rounded-lg border border-slate-200 px-4 py-2 text-sm font-black text-slate-600">Vazgeç</button><button disabled={sending} className="min-h-11 rounded-lg bg-[#005f95] px-4 py-2 text-sm font-black text-white disabled:opacity-60">{sending ? 'Gönderiliyor...' : 'Gönder'}</button></div>
          </form>
        </div>
      )}
    </div>
  )
}
