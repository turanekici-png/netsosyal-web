'use client'

import { useEffect, useMemo, useState } from 'react'

export const dynamic = 'force-dynamic'

type Neighborhood = { id: string; name: string | null }

type Paket = {
  id: string
  ad: string
  sira: number
  mahalleler: string[]
  ownerUserId: string | null
  ownerName: string | null
}

type Personel = { id: string; name: string }

type RotasyonTetik = { gun: number; saat: string; sonTetikTarihi: string | null; sonrakiTetikTarihi: string }

function formatDateTimeTr(value: string | null) {
  if (!value) return null
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString('tr-TR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

// Kullanici istegi (2026-10-08): sol sidebardaki İş Akışı altinda "Mahalle
// Grupları" sayfasi - 65 mahalleyi admin'in olusturdugu GRUPLARA bolup, her
// gruba BIR sorumlu tahkikat gorevlisi atar. Tahkikat listesindeki
// gorunurluk (bkz. ../../../api/workflow/tahkikat/route.ts) bu atamaya
// gore kisitlanir - bir tahkikat gorevlisi SADECE kendi grubundaki
// mahallelerin dosyalarini gorur.
//
// Kullanici istegi (6. tur, SON karar): "yeni grup ekleyelim, mahalle
// seçelim, en üstünde sorumlu kullanıcıyı seçelim. dönüşüm için TEK tarih
// ve saat ekleyelim (ör. her ayın 1. günü) - o tarih geldiğinde sorumlu
// kullanıcılar yer değiştirsin." Bu, ONCEKI IKI modeli (otomatik ay
// formulu, sonra admin'in grup basina elle girdigi tarih araligi takvimi)
// TAMAMEN degistirdi - artik: her grubun TEK, DOGRUDAN duzenlenebilir bir
// sorumlusu var + TEK global "gun/saat" tetikleyicisi (bkz.
// app/api/workflow/tahkikat/_lib/autoRotate.ts) bu tarih gelince TUM
// gruplarin sorumlularini dairesel olarak kaydirir.
export default function MahalleGruplariPage() {
  const [neighborhoods, setNeighborhoods] = useState<Neighborhood[]>([])
  const [paketler, setPaketler] = useState<Paket[]>([])
  const [personelListesi, setPersonelListesi] = useState<Personel[]>([])
  const [canAssign, setCanAssign] = useState(false)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [error, setError] = useState('')

  const [editTarget, setEditTarget] = useState<Paket | 'new' | null>(null)
  const [editAd, setEditAd] = useState('')
  const [editSorumluId, setEditSorumluId] = useState('')
  const [editMahalleler, setEditMahalleler] = useState<Set<string>>(new Set())
  const [editSearch, setEditSearch] = useState('')
  const [editStatus, setEditStatus] = useState<'idle' | 'saving'>('idle')
  const [editError, setEditError] = useState('')

  const [tetik, setTetik] = useState<RotasyonTetik | null>(null)
  const [tetikGunInput, setTetikGunInput] = useState('1')
  const [tetikSaatInput, setTetikSaatInput] = useState('00:00')
  const [tetikSaving, setTetikSaving] = useState(false)
  const [tetikError, setTetikError] = useState('')

  async function loadAll(isCancelled?: () => boolean) {
    setStatus('loading')
    setError('')
    try {
      const [neighborhoodsRes, paketlerRes, tetikRes] = await Promise.all([
        fetch('/api/settings/neighborhoods', { cache: 'no-store' }),
        fetch('/api/workflow/tahkikat/paketler', { cache: 'no-store' }),
        fetch('/api/workflow/tahkikat/rotasyon-tetik', { cache: 'no-store' }),
      ])
      const neighborhoodsPayload = await neighborhoodsRes.json()
      const paketlerPayload = await paketlerRes.json()
      const tetikPayload = await tetikRes.json()

      if (!paketlerRes.ok || !paketlerPayload.success) {
        throw new Error(paketlerPayload.error || 'Gruplar alınamadı.')
      }

      if (!isCancelled?.()) {
        setNeighborhoods(neighborhoodsPayload?.success ? (neighborhoodsPayload.data ?? []) : [])
        setPaketler(paketlerPayload.data?.paketler ?? [])
        setPersonelListesi(paketlerPayload.data?.personelListesi ?? [])
        setCanAssign(Boolean(paketlerPayload.data?.canAssign))
        if (tetikPayload?.success) {
          setTetik(tetikPayload.data)
          setTetikGunInput(String(tetikPayload.data.gun))
          setTetikSaatInput(tetikPayload.data.saat)
        }
        setStatus('ready')
      }
    } catch (err) {
      if (!isCancelled?.()) {
        setError(err instanceof Error ? err.message : 'Veriler yüklenirken hata oluştu.')
        setStatus('error')
      }
    }
  }

  useEffect(() => {
    let isCancelled = false
    void loadAll(() => isCancelled)
    return () => { isCancelled = true }
  }, [])

  // Hangi mahalle hangi grupta - duplike (iki grupta birden) kullanimi
  // isaretlemek icin.
  const mahalleToPaketAd = useMemo(() => {
    const map = new Map<string, string>()
    for (const paket of paketler) {
      for (const mahalle of paket.mahalleler) {
        if (!map.has(mahalle)) map.set(mahalle, paket.ad)
      }
    }
    return map
  }, [paketler])

  const unassignedPaketler = paketler.filter((p) => !p.ownerUserId)

  const openNewPaket = () => {
    setEditTarget('new')
    setEditAd(`${paketler.length + 1}. Grup`)
    setEditSorumluId('')
    setEditMahalleler(new Set())
    setEditSearch('')
    setEditError('')
  }

  const openEditPaket = (paket: Paket) => {
    setEditTarget(paket)
    setEditAd(paket.ad)
    setEditSorumluId(paket.ownerUserId || '')
    setEditMahalleler(new Set(paket.mahalleler))
    setEditSearch('')
    setEditError('')
  }

  const closeEdit = () => {
    if (editStatus === 'saving') return
    setEditTarget(null)
    setEditError('')
  }

  const toggleMahalle = (name: string) => {
    setEditMahalleler((prev) => {
      const next = new Set(prev)
      if (next.has(name)) next.delete(name)
      else next.add(name)
      return next
    })
  }

  const savePaket = async () => {
    if (!editTarget) return
    const ad = editAd.trim()
    if (!ad) {
      setEditError('Grup adı zorunludur.')
      return
    }

    setEditStatus('saving')
    setEditError('')
    try {
      const isNew = editTarget === 'new'
      const url = isNew ? '/api/workflow/tahkikat/paketler' : `/api/workflow/tahkikat/paketler/${editTarget.id}`
      const response = await fetch(url, {
        method: isNew ? 'POST' : 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ad,
          sira: isNew ? paketler.length : editTarget.sira,
          mahalleler: [...editMahalleler],
          sorumluKullaniciId: editSorumluId || null,
        }),
      })
      const payload = await response.json()
      if (!response.ok || !payload.success) {
        throw new Error(payload.error || 'Kaydedilemedi.')
      }
      setEditTarget(null)
      await loadAll()
    } catch (err) {
      setEditError(err instanceof Error ? err.message : 'Kaydedilirken hata oluştu.')
    } finally {
      setEditStatus('idle')
    }
  }

  const deletePaket = async (paket: Paket) => {
    if (!window.confirm(`"${paket.ad}" grubunu silmek istediğinize emin misiniz?`)) return
    try {
      const response = await fetch(`/api/workflow/tahkikat/paketler/${paket.id}`, { method: 'DELETE' })
      const payload = await response.json()
      if (!response.ok || !payload.success) {
        throw new Error(payload.error || 'Grup silinemedi.')
      }
      await loadAll()
    } catch (err) {
      window.alert(err instanceof Error ? err.message : 'Grup silinirken hata oluştu.')
    }
  }

  const saveTetik = async () => {
    const gun = Number.parseInt(tetikGunInput, 10)
    setTetikSaving(true)
    setTetikError('')
    try {
      const response = await fetch('/api/workflow/tahkikat/rotasyon-tetik', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ gun, saat: tetikSaatInput }),
      })
      const payload = await response.json()
      if (!response.ok || !payload.success) {
        throw new Error(payload.error || 'Rotasyon ayarı kaydedilemedi.')
      }
      await loadAll()
    } catch (err) {
      setTetikError(err instanceof Error ? err.message : 'Kaydedilirken hata oluştu.')
    } finally {
      setTetikSaving(false)
    }
  }

  const filteredNeighborhoods = useMemo(() => {
    const term = editSearch.trim().toLocaleLowerCase('tr-TR')
    const list = neighborhoods.filter((n) => n.name)
    if (!term) return list
    return list.filter((n) => (n.name || '').toLocaleLowerCase('tr-TR').includes(term))
  }, [neighborhoods, editSearch])

  return (
    <div className="space-y-5 text-slate-950">
      <div className="relative overflow-hidden rounded-lg border border-indigo-200 bg-white px-5 py-4 shadow-sm">
        <div className="absolute inset-y-0 left-0 w-1.5 bg-gradient-to-b from-indigo-500 to-violet-600" />
        <p className="text-[18px] font-black uppercase tracking-wide text-indigo-700">İş Akışı</p>
        <h1 className="mt-1 text-3xl font-black leading-tight tracking-normal text-slate-950 md:text-[34px]">Mahalle Grupları</h1>
        <p className="mt-1 text-[18px] font-bold text-slate-500">
          Mahalleleri gruplara ayırın, her gruba bir sorumlu seçin - aşağıdaki tarih/saat geldiğinde sorumlular otomatik yer değiştirir.
        </p>
      </div>

      {error && (
        <div className="rounded-md border border-rose-200 bg-rose-50 px-4 py-3 text-[18px] font-bold text-rose-700">
          {error}
        </div>
      )}

      {/* Rotasyon tetikleyici */}
      {canAssign && tetik && (
        <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
          <h2 className="text-[18px] font-black uppercase text-indigo-800">Dönüşüm Tarihi</h2>
          <p className="mt-1 text-[18px] font-bold text-slate-500">
            Her ayın seçtiğiniz gününde, belirttiğiniz saatte, tüm grupların sorumluları otomatik olarak bir sonrakine kayar.
          </p>
          <p className="mt-1 text-[18px] font-bold text-indigo-700">
            Sıradaki değişim: {formatDateTimeTr(tetik.sonrakiTetikTarihi)}
          </p>
          {tetikError && (
            <div className="mt-2 rounded border border-rose-200 bg-rose-50 px-3 py-1.5 text-[18px] font-bold text-rose-700">{tetikError}</div>
          )}
          <div className="mt-3 flex flex-wrap items-end gap-2">
            <label className="flex flex-col gap-1">
              <span className="text-[18px] font-extrabold uppercase text-slate-600">Ayın Günü</span>
              <input
                type="number"
                min={1}
                max={31}
                value={tetikGunInput}
                onChange={(e) => setTetikGunInput(e.target.value)}
                className="h-9 w-24 rounded-lg border border-slate-200 px-2 text-[18px] font-bold text-slate-950 outline-none focus:border-indigo-500"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[18px] font-extrabold uppercase text-slate-600">Saat</span>
              <input
                type="time"
                value={tetikSaatInput}
                onChange={(e) => setTetikSaatInput(e.target.value)}
                className="h-9 rounded-lg border border-slate-200 px-2 text-[18px] font-bold text-slate-950 outline-none focus:border-indigo-500"
              />
            </label>
            <button
              type="button"
              onClick={() => void saveTetik()}
              disabled={tetikSaving}
              className="h-9 rounded-lg border border-indigo-600 bg-indigo-600 px-4 text-[18px] font-extrabold text-white shadow-sm hover:bg-indigo-700 disabled:cursor-wait disabled:opacity-60"
            >
              {tetikSaving ? 'Kaydediliyor...' : 'Kaydet'}
            </button>
          </div>
        </div>
      )}

      {/* Grup listesi */}
      <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-[18px] font-black uppercase text-indigo-800">Mahalle Grupları ({paketler.length})</h2>
          {canAssign && (
            <button
              type="button"
              onClick={openNewPaket}
              className="rounded-lg border border-indigo-600 bg-indigo-600 px-4 py-1.5 text-[18px] font-extrabold text-white shadow-sm hover:bg-indigo-700"
            >
              + Yeni Grup
            </button>
          )}
        </div>

        {status === 'loading' ? (
          <div className="mt-3 flex items-center gap-2 text-[18px] font-bold text-slate-500">
            <span className="h-5 w-5 animate-spin rounded-full border-2 border-indigo-300 border-t-indigo-600" />
            Yükleniyor...
          </div>
        ) : paketler.length === 0 ? (
          <p className="mt-3 text-[18px] font-bold text-slate-500">Henüz grup oluşturulmadı.</p>
        ) : (
          <div className="mt-3 space-y-2">
            {paketler.map((paket) => (
              <div key={paket.id} className="rounded-lg border border-indigo-200 bg-indigo-50/40 p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="text-[18px] font-black text-indigo-900">{paket.ad}</p>
                    <p className="mt-0.5 text-[18px] font-bold text-indigo-700">
                      Görevlisi: {paket.ownerName || <span className="text-slate-400">Atanmadı</span>}
                      <span className="ml-2 text-slate-500">· {paket.mahalleler.length} mahalle</span>
                    </p>
                  </div>
                  <div className="inline-flex shrink-0 items-center gap-2">
                    <button
                      type="button"
                      onClick={() => openEditPaket(paket)}
                      className="rounded-md border border-slate-300 bg-white px-2.5 py-1 text-[18px] font-black uppercase text-slate-700 shadow-sm hover:bg-slate-50"
                    >
                      {canAssign ? 'Düzenle' : 'Gör'}
                    </button>
                    {canAssign && (
                      <button
                        type="button"
                        onClick={() => void deletePaket(paket)}
                        className="rounded-md border border-rose-300 bg-white px-2.5 py-1 text-[18px] font-black uppercase text-rose-700 shadow-sm hover:bg-rose-50"
                      >
                        Sil
                      </button>
                    )}
                  </div>
                </div>
                {paket.mahalleler.length > 0 && (
                  <p className="mt-2 text-[18px] font-bold text-slate-700">{paket.mahalleler.join(', ')}</p>
                )}
              </div>
            ))}
          </div>
        )}
        {unassignedPaketler.length > 0 && (
          <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[18px] font-bold text-amber-800">
            Sorumlusu atanmamış gruplar var - bu gruplardaki mahallelerin dosyaları şu an sadece admin tarafından görülebiliyor.
          </div>
        )}
      </div>

      {editTarget && (
        <div className="fixed inset-0 z-[2200] flex items-center justify-center bg-slate-900/70 p-2 backdrop-blur-sm md:p-4">
          <div className="flex max-h-[92vh] w-full max-w-4xl flex-col overflow-hidden rounded-xl border border-indigo-200 bg-white shadow-2xl">
            <div className="flex shrink-0 items-center justify-between border-b border-indigo-100 bg-indigo-50 px-4 py-3 md:px-5 md:py-4">
              <h3 className="text-[18px] font-black text-indigo-900">
                {editTarget === 'new' ? 'Yeni Grup' : canAssign ? 'Grubu Düzenle' : 'Grup Mahalleleri'}
              </h3>
              <button
                type="button"
                onClick={closeEdit}
                disabled={editStatus === 'saving'}
                className="inline-flex h-8 w-8 items-center justify-center rounded-full text-slate-400 hover:bg-rose-50 hover:text-rose-500 disabled:cursor-wait disabled:opacity-60"
              >
                x
              </button>
            </div>

            <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4 md:p-5">
              {editError && (
                <div className="rounded border border-rose-200 bg-rose-50 px-3 py-2 text-[18px] font-bold text-rose-700">{editError}</div>
              )}

              {/* Kullanici istegi: "en üstünde bu mahallelerden sorumlu
                  olan kullanıcıyı seçelim" - sorumlu secici EN USTTE. */}
              <div className="flex flex-wrap gap-3 rounded-lg border border-indigo-200 bg-indigo-50/50 p-3">
                <label className="flex min-w-[220px] flex-1 flex-col gap-1">
                  <span className="text-[18px] font-extrabold uppercase text-indigo-700">Sorumlu Kullanıcı</span>
                  <select
                    value={editSorumluId}
                    onChange={(e) => setEditSorumluId(e.target.value)}
                    disabled={!canAssign}
                    className="h-9 w-full rounded-lg border border-slate-200 bg-white px-2 text-[18px] font-bold text-slate-950 outline-none focus:border-indigo-500"
                  >
                    <option value="">Atanmadı</option>
                    {personelListesi.map((p) => (
                      <option key={p.id} value={p.id}>{p.name}</option>
                    ))}
                  </select>
                </label>
                <label className="flex min-w-[220px] flex-1 flex-col gap-1">
                  <span className="text-[18px] font-extrabold uppercase text-indigo-700">Grup Adı</span>
                  <input
                    value={editAd}
                    onChange={(e) => setEditAd(e.target.value)}
                    disabled={!canAssign}
                    className="h-9 w-full rounded-lg border border-slate-200 bg-white px-2 text-[18px] font-bold text-slate-950 outline-none focus:border-indigo-500"
                    placeholder="Örn. 1. Grup"
                  />
                </label>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-3">
                <span className="text-[18px] font-extrabold uppercase tracking-wide text-slate-600">
                  Mahalleler <span className="text-indigo-700">({editMahalleler.size} seçili)</span>
                </span>
                <div className="flex items-center gap-2">
                  {canAssign && editMahalleler.size > 0 && (
                    <button
                      type="button"
                      onClick={() => setEditMahalleler(new Set())}
                      className="text-[18px] font-bold text-slate-400 underline-offset-2 hover:text-rose-600 hover:underline"
                    >
                      Seçimi temizle
                    </button>
                  )}
                  <input
                    value={editSearch}
                    onChange={(e) => setEditSearch(e.target.value)}
                    placeholder="Mahalle ara..."
                    className="h-9 w-56 rounded-lg border border-slate-200 px-3 text-[18px] font-bold text-slate-950 outline-none focus:border-indigo-500"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 gap-x-3 gap-y-0.5 rounded-lg border border-slate-200 bg-slate-50/50 p-2 sm:grid-cols-2">
                {filteredNeighborhoods.map((n) => {
                  const name = n.name || ''
                  const selected = editMahalleler.has(name)
                  const currentOwnerAd = mahalleToPaketAd.get(name)
                  const usedElsewhere = !selected && currentOwnerAd && currentOwnerAd !== editAd
                  return (
                    <label
                      key={n.id}
                      title={usedElsewhere ? `Şu an "${currentOwnerAd}" grubunda - seçerseniz oradan çıkıp buraya taşınır` : undefined}
                      className={`flex items-center gap-2 rounded-lg px-2.5 py-2 text-[18px] font-bold transition-colors ${
                        canAssign ? 'cursor-pointer hover:bg-indigo-100/70' : 'cursor-default'
                      } ${selected ? 'bg-indigo-100/70 text-indigo-900' : 'text-slate-700'}`}
                    >
                      <input
                        type="checkbox"
                        checked={selected}
                        disabled={!canAssign}
                        onChange={() => toggleMahalle(name)}
                        className="h-4 w-4 shrink-0 accent-indigo-600"
                      />
                      <span className="min-w-0 flex-1 break-words leading-snug">{name}</span>
                      {usedElsewhere && (
                        <span className="shrink-0 rounded-full bg-amber-100 px-2 py-0.5 text-[14px] font-black uppercase tracking-wide text-amber-700">
                          {currentOwnerAd}
                        </span>
                      )}
                    </label>
                  )
                })}
              </div>
            </div>

            {canAssign && (
              <div className="flex shrink-0 justify-end gap-2 border-t border-slate-100 bg-slate-50 px-4 py-3 md:px-5 md:py-4">
                <button
                  type="button"
                  onClick={closeEdit}
                  disabled={editStatus === 'saving'}
                  className="rounded border border-slate-200 bg-white px-4 py-1.5 text-[18px] font-extrabold text-slate-600 hover:bg-slate-100 disabled:cursor-wait disabled:opacity-60"
                >
                  Vazgeç
                </button>
                <button
                  type="button"
                  onClick={() => void savePaket()}
                  disabled={editStatus === 'saving'}
                  className="rounded border border-indigo-600 bg-indigo-600 px-5 py-1.5 text-[18px] font-extrabold text-white shadow-sm hover:bg-indigo-700 disabled:cursor-wait disabled:opacity-60"
                >
                  {editStatus === 'saving' ? 'Kaydediliyor...' : 'Kaydet'}
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
