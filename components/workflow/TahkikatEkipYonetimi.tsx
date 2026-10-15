'use client'

import { useEffect, useMemo, useState } from 'react'
import { foldTurkish } from '@/lib/utils'

// Kullanici istegi (2026-10-15): tahkikat ekipleri (tahkikat1/2 hesaplari)
// SABIT kalir, ekipte calisan personel buradan degistirilir. Tablette ekip
// hesabiyla girildiginde bu listedeki personel secim ekraninda cikar (bkz.
// components/layout/TahkikatEkipKapisi.tsx).

type Kisi = { id: string; name: string; username?: string }
type Veri = { ekipler: Kisi[]; kullanicilar: Kisi[]; uyeler: Record<string, string[]> }

export function TahkikatEkipYonetimi({ onClose }: { onClose: () => void }) {
  const [veri, setVeri] = useState<Veri | null>(null)
  const [uyeler, setUyeler] = useState<Record<string, string[]>>({})
  const [aktifEkip, setAktifEkip] = useState('')
  const [arama, setArama] = useState('')
  const [hata, setHata] = useState('')
  const [durum, setDurum] = useState<'yukleniyor' | 'hazir' | 'kaydediliyor'>('yukleniyor')

  useEffect(() => {
    let iptal = false
    void (async () => {
      try {
        const res = await fetch('/api/tahkikat-ekip?yonetim=1', { cache: 'no-store' })
        const payload = await res.json()
        if (!res.ok || !payload.success) throw new Error(payload.error || 'Ekip bilgisi alınamadı.')
        if (iptal) return
        setVeri(payload.data)
        setUyeler(payload.data.uyeler ?? {})
        setAktifEkip(payload.data.ekipler?.[0]?.id ?? '')
        setDurum('hazir')
      } catch (err) {
        if (!iptal) {
          setHata(err instanceof Error ? err.message : 'Ekip bilgisi alınamadı.')
          setDurum('hazir')
        }
      }
    })()
    return () => { iptal = true }
  }, [])

  const ekipIdleri = useMemo(() => new Set((veri?.ekipler ?? []).map((e) => e.id)), [veri])
  const seciliUyeler = useMemo(() => new Set(uyeler[aktifEkip] ?? []), [uyeler, aktifEkip])

  // Personelin baska bir ekipte olup olmadigini gostermek icin.
  const digerEkip = useMemo(() => {
    const map = new Map<string, string>()
    for (const ekip of veri?.ekipler ?? []) {
      if (ekip.id === aktifEkip) continue
      for (const id of uyeler[ekip.id] ?? []) map.set(id, ekip.name)
    }
    return map
  }, [veri, uyeler, aktifEkip])

  const liste = useMemo(() => {
    const terim = foldTurkish(arama.trim())
    return (veri?.kullanicilar ?? [])
      .filter((k) => !ekipIdleri.has(k.id))
      .filter((k) => !terim || foldTurkish(`${k.name} ${k.username ?? ''}`).includes(terim))
      .sort((a, b) => Number(seciliUyeler.has(b.id)) - Number(seciliUyeler.has(a.id)) || a.name.localeCompare(b.name, 'tr-TR'))
  }, [veri, arama, ekipIdleri, seciliUyeler])

  const degistir = (kisiId: string) => {
    setUyeler((onceki) => {
      const mevcut = new Set(onceki[aktifEkip] ?? [])
      if (mevcut.has(kisiId)) mevcut.delete(kisiId)
      else mevcut.add(kisiId)
      return { ...onceki, [aktifEkip]: [...mevcut] }
    })
  }

  const kaydet = async () => {
    setDurum('kaydediliyor')
    setHata('')
    try {
      const res = await fetch('/api/tahkikat-ekip', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ uyeler }),
      })
      const payload = await res.json()
      if (!res.ok || !payload.success) throw new Error(payload.error || 'Kaydedilemedi.')
      onClose()
    } catch (err) {
      setHata(err instanceof Error ? err.message : 'Kaydedilemedi.')
      setDurum('hazir')
    }
  }

  const kisiAdi = (id: string) => veri?.kullanicilar.find((k) => k.id === id)?.name ?? `#${id}`

  return (
    <div className="fixed inset-0 z-[2200] flex items-center justify-center bg-slate-900/70 p-2 backdrop-blur-sm md:p-4">
      <div className="flex max-h-[92vh] w-full max-w-3xl flex-col overflow-hidden rounded-xl border border-[#c9a227]/40 bg-white shadow-2xl">
        <div className="flex shrink-0 items-start justify-between border-b-4 border-[#c9a227] bg-gradient-to-r from-[#0a3a57] to-[#0d4f6e] px-5 py-4 text-white">
          <div>
            <h3 className="text-[18px] font-black">Tahkikat Ekip Personeli</h3>
            <p className="mt-0.5 text-[13px] font-semibold text-white/75">
              Ekip hesapları sabittir; ekipte çalışan personeli buradan değiştirin. Ekip hesabıyla girildiğinde bu personel listelenir.
            </p>
          </div>
          <button type="button" onClick={onClose} className="ml-3 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-white/70 hover:bg-white/10 hover:text-white">x</button>
        </div>

        {durum === 'yukleniyor' ? (
          <div className="p-8 text-center text-[14px] font-bold text-slate-500">Yükleniyor...</div>
        ) : !veri || veri.ekipler.length === 0 ? (
          <div className="p-8 text-center text-[14px] font-bold text-slate-500">
            {hata || 'Kullanıcı adı "tahkikat" ile başlayan aktif ekip hesabı bulunamadı.'}
          </div>
        ) : (
          <div className="flex min-h-0 flex-1 flex-col">
            <div className="flex shrink-0 flex-wrap gap-1.5 border-b border-slate-100 px-4 pt-3">
              {veri.ekipler.map((ekip) => (
                <button
                  key={ekip.id}
                  type="button"
                  onClick={() => setAktifEkip(ekip.id)}
                  className={`rounded-t-lg border border-b-0 px-4 py-2 text-[14px] font-black transition ${aktifEkip === ekip.id ? 'border-[#0a3a57] bg-[#0a3a57] text-white' : 'border-slate-200 bg-slate-50 text-slate-600 hover:bg-slate-100'}`}
                >
                  {ekip.name} <span className="opacity-70">({(uyeler[ekip.id] ?? []).length})</span>
                </button>
              ))}
            </div>

            <div className="shrink-0 space-y-2 px-4 py-3">
              <div className="flex flex-wrap gap-1.5">
                {(uyeler[aktifEkip] ?? []).length === 0 ? (
                  <span className="text-[13px] font-bold text-slate-400">Bu ekipte personel yok - ekip hesabı eskisi gibi doğrudan çalışır.</span>
                ) : (
                  (uyeler[aktifEkip] ?? []).map((id) => (
                    <button
                      key={id}
                      type="button"
                      onClick={() => degistir(id)}
                      className="inline-flex items-center gap-1 rounded-full border border-[#c9a227] bg-amber-50 px-3 py-1 text-[13px] font-black text-[#0a3a57] hover:bg-amber-100"
                      title="Ekipten çıkar"
                    >
                      {kisiAdi(id)} <span className="text-slate-400">×</span>
                    </button>
                  ))
                )}
              </div>
              <input
                value={arama}
                onChange={(e) => setArama(e.target.value)}
                placeholder="Personel ara (ad, kullanıcı adı)..."
                className="h-10 w-full rounded-lg border border-slate-200 px-3 text-[14px] font-bold text-slate-900 outline-none focus:border-[#0076b6]"
              />
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-3">
              <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                {liste.map((kisi) => {
                  const secili = seciliUyeler.has(kisi.id)
                  const diger = digerEkip.get(kisi.id)
                  return (
                    <label
                      key={kisi.id}
                      className={`flex cursor-pointer items-center gap-2.5 rounded-lg border px-3 py-2 transition ${secili ? 'border-[#0a3a57] bg-sky-50' : 'border-slate-200 bg-white hover:bg-slate-50'}`}
                    >
                      <input type="checkbox" checked={secili} onChange={() => degistir(kisi.id)} className="h-4 w-4 accent-[#0a3a57]" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[14px] font-black text-slate-900">{kisi.name}</span>
                        <span className="block truncate text-[12px] font-bold text-slate-500">
                          {kisi.username}{diger ? ` · ${diger} ekibinde de` : ''}
                        </span>
                      </span>
                    </label>
                  )
                })}
              </div>
            </div>
          </div>
        )}

        {hata && veri && (
          <div className="mx-4 mb-2 rounded border border-rose-200 bg-rose-50 px-3 py-2 text-[13px] font-bold text-rose-700">{hata}</div>
        )}

        <div className="flex shrink-0 justify-end gap-2 border-t border-slate-100 bg-slate-50 px-4 py-3">
          <button type="button" onClick={onClose} className="rounded border border-slate-200 bg-white px-4 py-1.5 text-[14px] font-extrabold text-slate-600 hover:bg-slate-100">
            Vazgeç
          </button>
          <button
            type="button"
            onClick={() => void kaydet()}
            disabled={durum !== 'hazir' || !veri || veri.ekipler.length === 0}
            className="rounded border border-[#0a3a57] bg-[#0a3a57] px-5 py-1.5 text-[14px] font-extrabold text-white hover:bg-[#0d4f6e] disabled:opacity-50"
          >
            {durum === 'kaydediliyor' ? 'Kaydediliyor...' : 'Kaydet'}
          </button>
        </div>
      </div>
    </div>
  )
}
