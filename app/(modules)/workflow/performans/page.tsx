'use client'

import { Fragment, useCallback, useEffect, useMemo, useState } from 'react'
import { useTabs } from '@/lib/context/TabContext'

export const dynamic = 'force-dynamic'

// Kullanici istegi (2026-10-15): İş Akışı > Performans Raporu - personelin
// Ön İnceleme, Tahkikat ve Sonuç Bekleyen islemleri günlük/haftalık/aylık/
// yıllık. Veri: is_akisi_performans (bkz. lib/workflow/performans.ts).

type Donem = 'gun' | 'hafta' | 'ay' | 'yil'
type Tur = 'on_inceleme' | 'tahkikat' | 'sonuc_bekleyen'
type Satir = { donem: string; kullaniciId: string | null; ad: string; tur: Tur; adet: number }

const TURLER: Array<{ id: Tur; ad: string; renk: string; zemin: string }> = [
  { id: 'on_inceleme', ad: 'Ön İnceleme', renk: 'bg-amber-500', zemin: 'bg-amber-50 text-amber-800 ring-amber-200' },
  { id: 'tahkikat', ad: 'Tahkikat', renk: 'bg-orange-600', zemin: 'bg-orange-50 text-orange-800 ring-orange-200' },
  { id: 'sonuc_bekleyen', ad: 'Sonuç Bekleyen', renk: 'bg-blue-600', zemin: 'bg-blue-50 text-blue-800 ring-blue-200' },
]

const DONEMLER: Array<{ id: Donem; ad: string }> = [
  { id: 'gun', ad: 'Günlük' },
  { id: 'hafta', ad: 'Haftalık' },
  { id: 'ay', ad: 'Aylık' },
  { id: 'yil', ad: 'Yıllık' },
]

const AYLAR = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık']

function isoTarih(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// Doneme gore makul varsayilan aralik
function varsayilanAralik(donem: Donem): { baslangic: string; bitis: string } {
  const bugun = new Date()
  const bas = new Date(bugun)
  if (donem === 'gun') bas.setDate(bas.getDate() - 29)
  else if (donem === 'hafta') bas.setDate(bas.getDate() - 7 * 11 - ((bas.getDay() + 6) % 7))
  else if (donem === 'ay') { bas.setMonth(0); bas.setDate(1) }
  else { bas.setFullYear(bas.getFullYear() - 4); bas.setMonth(0); bas.setDate(1) }
  return { baslangic: isoTarih(bas), bitis: isoTarih(bugun) }
}

function donemEtiketi(donem: Donem, iso: string) {
  const [y, m, d] = iso.split('-').map(Number)
  if (donem === 'yil') return String(y)
  if (donem === 'ay') return `${AYLAR[m - 1]} ${y}`
  if (donem === 'hafta') {
    const bas = new Date(y, m - 1, d)
    const son = new Date(y, m - 1, d + 6)
    const f = (t: Date) => `${String(t.getDate()).padStart(2, '0')}.${String(t.getMonth() + 1).padStart(2, '0')}`
    return `${f(bas)} – ${f(son)}.${son.getFullYear()}`
  }
  const gun = new Date(y, m - 1, d).toLocaleDateString('tr-TR', { weekday: 'short' })
  return `${String(d).padStart(2, '0')}.${String(m).padStart(2, '0')}.${y} ${gun}`
}

function csvIndir(dosyaAdi: string, basliklar: string[], satirlar: Array<Array<string | number>>) {
  const kac = (v: string | number) => {
    const t = String(v)
    return /[";\r\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t
  }
  const icerik = [basliklar.map(kac).join(';'), ...satirlar.map((s) => s.map(kac).join(';'))].join('\r\n')
  const url = URL.createObjectURL(new Blob(['﻿' + icerik], { type: 'text/csv;charset=utf-8' }))
  const a = document.createElement('a')
  a.href = url
  a.download = `${dosyaAdi}_${isoTarih(new Date())}.csv`
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

// 2026-10-15: personele / doneme (ya da tablodaki bir sayiya) tiklayinca
// altinda acilan, o islemlerin yapildigi DOSYALARIN listesi.
type DetaySatiri = { id: string; tur: Tur; zaman: string; sonuc: string | null; dosyaid: string | null; dosyaNo: string | null; personel: string | null; dosyaSahibi: string | null; mahalle: string | null }

function DetayListesi({ donem, aralik, turler, kullaniciAnahtari, donemBaslangici, onDosyaAc }: {
  donem: Donem
  aralik: { baslangic: string; bitis: string }
  turler: Set<Tur>
  kullaniciAnahtari?: string | null
  donemBaslangici?: string | null
  onDosyaAc: (dosyaid: string, dosyaNo: string | null) => void
}) {
  const [satirlar, setSatirlar] = useState<DetaySatiri[] | null>(null)
  const [hata, setHata] = useState('')
  const turlerMetni = [...turler].join(',')

  useEffect(() => {
    let iptal = false
    const q = new URLSearchParams({ detay: '1', donem, baslangic: aralik.baslangic, bitis: aralik.bitis, turler: turlerMetni })
    if (kullaniciAnahtari) {
      if (kullaniciAnahtari.startsWith('ad:')) q.set('kullaniciAdi', kullaniciAnahtari.slice(3))
      else q.set('kullaniciId', kullaniciAnahtari)
    }
    if (donemBaslangici) q.set('donemBaslangici', donemBaslangici)
    fetch(`/api/workflow/performans?${q.toString()}`, { cache: 'no-store' })
      .then((r) => r.json())
      .then((p) => {
        if (iptal) return
        if (!p.success) throw new Error(p.error || 'Liste alınamadı.')
        setSatirlar(p.data ?? [])
      })
      .catch((err) => { if (!iptal) setHata(err instanceof Error ? err.message : 'Liste alınamadı.') })
    return () => { iptal = true }
  }, [donem, aralik.baslangic, aralik.bitis, turlerMetni, kullaniciAnahtari, donemBaslangici])

  const turBilgisi = (tur: Tur) => TURLER.find((t) => t.id === tur)

  return (
    <div className="border-y-2 border-[#c9a227]/60 bg-amber-50/40 px-3 py-3">
      {hata ? (
        <p className="text-sm font-bold text-rose-700">{hata}</p>
      ) : satirlar === null ? (
        <p className="text-sm font-bold text-slate-500 lg:text-base">Dosyalar yükleniyor...</p>
      ) : satirlar.length === 0 ? (
        <p className="text-sm font-bold text-slate-500 lg:text-base">Kayıt bulunamadı.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <table className="w-full min-w-[760px] border-collapse text-left">
            <thead className="bg-slate-100 text-xs font-black uppercase tracking-wide text-slate-600 lg:text-sm">
              <tr>
                <th className="px-3 py-2">Tarih / Saat</th>
                <th className="px-3 py-2">İşlem</th>
                <th className="px-3 py-2">Dosya No</th>
                <th className="px-3 py-2">Dosya Sahibi</th>
                <th className="px-3 py-2">Mahalle</th>
                <th className="px-3 py-2">Personel</th>
                <th className="px-3 py-2">Sonuç</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-sm lg:text-base">
              {satirlar.map((s) => {
                const t = turBilgisi(s.tur)
                return (
                  <tr key={s.id} className="hover:bg-sky-50/60">
                    <td className="whitespace-nowrap px-3 py-1.5 font-semibold text-slate-600">
                      {new Date(s.zaman).toLocaleString('tr-TR', { dateStyle: 'short', timeStyle: 'short' })}
                    </td>
                    <td className="px-3 py-1.5">
                      {t && <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 font-black ring-1 ${t.zemin}`}><span className={`h-2 w-2 rounded-full ${t.renk}`} />{t.ad}</span>}
                    </td>
                    <td className="px-3 py-1.5">
                      {s.dosyaid ? (
                        <button type="button" onClick={() => onDosyaAc(s.dosyaid!, s.dosyaNo)} className="rounded bg-slate-100 px-2 py-0.5 font-mono font-black text-[#0a3a57] hover:bg-[#0a3a57] hover:text-white" title="Dosyayı aç">
                          {s.dosyaNo || `#${s.dosyaid}`}
                        </button>
                      ) : '—'}
                    </td>
                    <td className="px-3 py-1.5 font-black text-slate-900">{s.dosyaSahibi || '—'}</td>
                    <td className="px-3 py-1.5 font-semibold text-slate-600">{s.mahalle || '—'}</td>
                    <td className="px-3 py-1.5 font-semibold text-slate-700">{s.personel || '—'}</td>
                    <td className="px-3 py-1.5 font-semibold text-slate-600">{s.sonuc || '—'}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          {satirlar.length >= 1000 && <p className="px-3 py-2 text-xs font-bold text-slate-500">İlk 1.000 kayıt gösteriliyor.</p>}
        </div>
      )}
    </div>
  )
}

export default function PerformansRaporuPage() {
  const [donem, setDonem] = useState<Donem>('gun')
  const [aralik, setAralik] = useState(() => varsayilanAralik('gun'))
  const [secilenTurler, setSecilenTurler] = useState<Set<Tur>>(new Set(TURLER.map((t) => t.id)))
  const [secilenPersonel, setSecilenPersonel] = useState<string | null>(null)
  // Acik dosya listesi: personel tablosunda bir satir ya da donem tablosunda
  // bir satir/hucre (kimin, hangi donemde yaptigi dosyalar)
  const [acikDetay, setAcikDetay] = useState<{ yer: 'personel' | 'donem'; anahtar: string; kullanici: string | null; donemBaslangici: string | null } | null>(null)
  const { addTab } = useTabs()
  const dosyaAc = (dosyaid: string, dosyaNo: string | null) => addTab({ title: dosyaNo ? `Dosya ${dosyaNo}` : 'Dosya', path: `/documents?fileId=${encodeURIComponent(dosyaid)}` })
  const detayAcKapat = (yeni: { yer: 'personel' | 'donem'; anahtar: string; kullanici: string | null; donemBaslangici: string | null }) =>
    setAcikDetay((onceki) => (onceki && onceki.yer === yeni.yer && onceki.anahtar === yeni.anahtar ? null : yeni))
  const [satirlar, setSatirlar] = useState<Satir[]>([])
  const [ilkKayit, setIlkKayit] = useState<string | null>(null)
  const [durum, setDurum] = useState<'yukleniyor' | 'hazir' | 'hata'>('yukleniyor')
  const [hata, setHata] = useState('')

  const yukle = useCallback(async (d: Donem, a: { baslangic: string; bitis: string }) => {
    setDurum('yukleniyor')
    setHata('')
    try {
      const q = new URLSearchParams({ donem: d, baslangic: a.baslangic, bitis: a.bitis })
      const res = await fetch(`/api/workflow/performans?${q.toString()}`, { cache: 'no-store' })
      const payload = await res.json()
      if (!res.ok || !payload.success) throw new Error(payload.error || 'Rapor alınamadı.')
      setSatirlar(payload.data.satirlar ?? [])
      setIlkKayit(payload.data.ilkKayitTarihi ?? null)
      setDurum('hazir')
    } catch (err) {
      setHata(err instanceof Error ? err.message : 'Rapor alınamadı.')
      setDurum('hata')
    }
  }, [])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- veri yukleme efekti
    void yukle(donem, aralik)
  }, [donem, aralik, yukle])

  const donemDegistir = (yeni: Donem) => {
    setDonem(yeni)
    setAralik(varsayilanAralik(yeni))
  }

  const gorunen = useMemo(() => satirlar.filter((s) => secilenTurler.has(s.tur)), [satirlar, secilenTurler])

  // Personel x tur ozeti
  const personeller = useMemo(() => {
    const map = new Map<string, { anahtar: string; ad: string; turler: Record<Tur, number>; toplam: number }>()
    for (const s of gorunen) {
      const anahtar = s.kullaniciId ?? `ad:${s.ad}`
      const p = map.get(anahtar) ?? { anahtar, ad: s.ad, turler: { on_inceleme: 0, tahkikat: 0, sonuc_bekleyen: 0 }, toplam: 0 }
      p.turler[s.tur] += s.adet
      p.toplam += s.adet
      map.set(anahtar, p)
    }
    return [...map.values()].sort((a, b) => b.toplam - a.toplam || a.ad.localeCompare(b.ad, 'tr-TR'))
  }, [gorunen])

  const turToplamlari = useMemo(() => {
    const t: Record<Tur, number> = { on_inceleme: 0, tahkikat: 0, sonuc_bekleyen: 0 }
    for (const s of gorunen) t[s.tur] += s.adet
    return t
  }, [gorunen])
  const genelToplam = turToplamlari.on_inceleme + turToplamlari.tahkikat + turToplamlari.sonuc_bekleyen
  const enYuksek = personeller[0]?.toplam ?? 0

  // Donem x personel tablosu (secili personel varsa sadece o)
  const pivot = useMemo(() => {
    const kaynak = secilenPersonel ? gorunen.filter((s) => (s.kullaniciId ?? `ad:${s.ad}`) === secilenPersonel) : gorunen
    const donemler = [...new Set(kaynak.map((s) => s.donem))].sort((a, b) => b.localeCompare(a))
    const sutunlar = secilenPersonel
      ? TURLER.filter((t) => secilenTurler.has(t.id)).map((t) => ({ anahtar: t.id as string, ad: t.ad }))
      : personeller.map((p) => ({ anahtar: p.anahtar, ad: p.ad }))
    const hucre = new Map<string, number>()
    for (const s of kaynak) {
      const sutun = secilenPersonel ? s.tur : (s.kullaniciId ?? `ad:${s.ad}`)
      const k = `${s.donem}|${sutun}`
      hucre.set(k, (hucre.get(k) ?? 0) + s.adet)
    }
    return { donemler, sutunlar, hucre }
  }, [gorunen, secilenPersonel, personeller, secilenTurler])

  const secilenAd = secilenPersonel ? personeller.find((p) => p.anahtar === secilenPersonel)?.ad ?? '' : ''

  const turDegistir = (tur: Tur) => {
    setSecilenTurler((onceki) => {
      const yeni = new Set(onceki)
      if (yeni.has(tur)) { if (yeni.size > 1) yeni.delete(tur) } else yeni.add(tur)
      return yeni
    })
  }

  const personelCsv = () => csvIndir(
    'performans_personel',
    ['Personel', ...TURLER.map((t) => t.ad), 'Toplam'],
    personeller.map((p) => [p.ad, ...TURLER.map((t) => p.turler[t.id]), p.toplam]),
  )
  const donemCsv = () => csvIndir(
    `performans_${donem}`,
    ['Dönem', ...pivot.sutunlar.map((s) => s.ad), 'Toplam'],
    pivot.donemler.map((d) => {
      const degerler = pivot.sutunlar.map((s) => pivot.hucre.get(`${d}|${s.anahtar}`) ?? 0)
      return [donemEtiketi(donem, d), ...degerler, degerler.reduce((a, b) => a + b, 0)]
    }),
  )

  const kartlar = [
    { ad: 'Toplam İşlem', deger: genelToplam, serit: 'bg-[#0a3a57]' },
    ...TURLER.map((t) => ({ ad: t.ad, deger: turToplamlari[t.id], serit: t.renk })),
  ]

  return (
    <div className="ns-yazi-masaustu space-y-4 text-slate-950">
      <div className="ns-sayfa-baslik relative overflow-hidden rounded-xl border-b-4 border-[#c9a227] p-6 text-white shadow-sm">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-sm font-bold uppercase tracking-[0.18em] text-[#e8cf7a]">İş Akışı</p>
            <h1 className="mt-1 text-3xl font-black leading-tight">Performans Raporu</h1>
            <p className="mt-1 max-w-3xl text-base font-semibold text-white/80">
              Personelin Ön İnceleme, Tahkikat ve Sonuç Bekleyen işlemleri; günlük, haftalık, aylık ve yıllık.
            </p>
          </div>
          <div className="inline-flex overflow-hidden rounded-lg border border-white/25 bg-white/10 p-1">
            {DONEMLER.map((d) => (
              <button
                key={d.id}
                type="button"
                onClick={() => donemDegistir(d.id)}
                className={`rounded-md px-4 py-2 text-base font-black transition lg:text-lg ${donem === d.id ? 'bg-[#c9a227] text-[#0a3a57] shadow' : 'text-white hover:bg-white/10'}`}
              >
                {d.ad}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-end gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
        <label className="block">
          <span className="mb-1 block text-xs font-black uppercase tracking-wide text-slate-500 lg:text-sm">Başlangıç</span>
          <input type="date" value={aralik.baslangic} max={aralik.bitis} onChange={(e) => e.target.value && setAralik((a) => ({ ...a, baslangic: e.target.value }))} className="h-10 rounded-lg border border-slate-300 bg-slate-50 px-3 text-base font-semibold outline-none focus:border-[#0a3a57]" />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-black uppercase tracking-wide text-slate-500 lg:text-sm">Bitiş</span>
          <input type="date" value={aralik.bitis} min={aralik.baslangic} onChange={(e) => e.target.value && setAralik((a) => ({ ...a, bitis: e.target.value }))} className="h-10 rounded-lg border border-slate-300 bg-slate-50 px-3 text-base font-semibold outline-none focus:border-[#0a3a57]" />
        </label>
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="mr-1 text-xs font-black uppercase tracking-wide text-slate-500 lg:text-sm">İşlem:</span>
          {TURLER.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => turDegistir(t.id)}
              className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-black ring-1 transition lg:text-base ${secilenTurler.has(t.id) ? t.zemin : 'bg-white text-slate-400 ring-slate-200 line-through'}`}
            >
              <span className={`h-2.5 w-2.5 rounded-full ${secilenTurler.has(t.id) ? t.renk : 'bg-slate-300'}`} />
              {t.ad}
            </button>
          ))}
        </div>
        <button type="button" onClick={() => void yukle(donem, aralik)} className="ml-auto h-10 rounded-lg bg-[#0a3a57] px-4 text-base font-black text-white hover:bg-[#0d4f6e]">
          Yenile
        </button>
      </div>

      {hata && <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-base font-bold text-rose-700">{hata}</div>}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {kartlar.map((k) => (
          <div key={k.ad} className="relative overflow-hidden rounded-lg border border-slate-200 bg-white py-3 pl-5 pr-4 shadow-sm">
            <span className={`absolute inset-y-0 left-0 w-1.5 ${k.serit}`} />
            <p className="text-sm font-black uppercase tracking-wide text-slate-500">{k.ad}</p>
            <p className="mt-1 text-3xl font-black text-[#0a3a57] lg:text-4xl">{durum === 'yukleniyor' ? '…' : k.deger.toLocaleString('tr-TR')}</p>
          </div>
        ))}
      </div>

      <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b-2 border-[#c9a227] bg-gradient-to-r from-[#0a3a57] to-[#0d4f6e] px-4 py-3 text-white">
          <div>
            <h2 className="text-lg font-black lg:text-xl">Personel Bazında</h2>
            <p className="text-sm font-semibold text-white/75">Satıra tıklayın: aşağıdaki dönem tablosu o personele göre açılır.</p>
          </div>
          <button type="button" onClick={personelCsv} disabled={personeller.length === 0} className="rounded-lg border border-white/30 bg-white/10 px-3 py-1.5 text-sm font-black hover:bg-white/20 disabled:opacity-50">
            Excel&apos;e Aktar
          </button>
        </div>
        <div className="overflow-x-auto">
          <table className="ns-tablo ns-tablo-sql w-full min-w-[760px] border-collapse text-left">
            <thead>
              <tr>
                <th className="px-3 py-2">#</th>
                <th className="px-3 py-2">Personel</th>
                {TURLER.filter((t) => secilenTurler.has(t.id)).map((t) => <th key={t.id} className="px-3 py-2 text-right">{t.ad}</th>)}
                <th className="px-3 py-2 text-right">Toplam</th>
                <th className="w-[28%] px-3 py-2">Dağılım</th>
              </tr>
            </thead>
            <tbody>
              {durum === 'yukleniyor' ? (
                <tr><td colSpan={7} className="px-4 py-10 text-center font-bold text-slate-500">Yükleniyor...</td></tr>
              ) : personeller.length === 0 ? (
                <tr><td colSpan={7} className="px-4 py-10 text-center font-bold text-slate-500">Bu aralıkta işlem bulunamadı.</td></tr>
              ) : personeller.map((p, i) => {
                const secili = secilenPersonel === p.anahtar
                const detayAcik = acikDetay?.yer === 'personel' && acikDetay.anahtar === p.anahtar
                return (
                  <Fragment key={p.anahtar}>
                  <tr
                    onClick={() => {
                      setSecilenPersonel(secili && detayAcik ? null : p.anahtar)
                      detayAcKapat({ yer: 'personel', anahtar: p.anahtar, kullanici: p.anahtar, donemBaslangici: null })
                    }}
                    title="Bu personelin işlem yaptığı dosyaları göster / gizle"
                    className={`cursor-pointer transition ${secili ? 'bg-amber-50' : i % 2 === 0 ? 'bg-white' : 'bg-slate-50/70'} hover:bg-sky-50/70`}
                  >
                    <td className="px-3 font-black text-slate-400">{i + 1}</td>
                    <td className="px-3 font-black text-slate-900">
                      <span className={`mr-1.5 inline-block text-xs text-[#c9a227] transition-transform ${detayAcik ? 'rotate-90' : ''}`}>▶</span>
                      {p.ad}
                    </td>
                    {TURLER.filter((t) => secilenTurler.has(t.id)).map((t) => (
                      <td key={t.id} className="px-3 text-right font-bold tabular-nums">{p.turler[t.id] || <span className="text-slate-300">0</span>}</td>
                    ))}
                    <td className="px-3 text-right font-black tabular-nums text-[#0a3a57]">{p.toplam.toLocaleString('tr-TR')}</td>
                    <td className="px-3">
                      <div className="flex h-3.5 w-full overflow-hidden rounded-full bg-slate-100" title={TURLER.map((t) => `${t.ad}: ${p.turler[t.id]}`).join(' · ')}>
                        {TURLER.filter((t) => secilenTurler.has(t.id)).map((t) => (
                          <span key={t.id} className={t.renk} style={{ width: `${enYuksek ? (p.turler[t.id] / enYuksek) * 100 : 0}%` }} />
                        ))}
                      </div>
                    </td>
                  </tr>
                  {detayAcik && (
                    <tr>
                      <td colSpan={7} className="!p-0">
                        <DetayListesi donem={donem} aralik={aralik} turler={secilenTurler} kullaniciAnahtari={p.anahtar} onDosyaAc={dosyaAc} />
                      </td>
                    </tr>
                  )}
                  </Fragment>
                )
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b-2 border-[#c9a227] bg-gradient-to-r from-[#0a3a57] to-[#0d4f6e] px-4 py-3 text-white">
          <div>
            <h2 className="text-lg font-black lg:text-xl">
              {DONEMLER.find((d) => d.id === donem)?.ad} Dağılım{secilenAd ? ` — ${secilenAd}` : ' — Tüm Personel'}
            </h2>
            <p className="text-sm font-semibold text-white/75">
              {secilenAd ? 'Seçili personelin işlem türlerine göre dağılımı.' : 'Her dönemde hangi personelin kaç işlem yaptığı.'}
            </p>
          </div>
          <div className="flex gap-2">
            {secilenPersonel && (
              <button type="button" onClick={() => setSecilenPersonel(null)} className="rounded-lg border border-white/30 bg-white/10 px-3 py-1.5 text-sm font-black hover:bg-white/20">
                Tüm Personel
              </button>
            )}
            <button type="button" onClick={donemCsv} disabled={pivot.donemler.length === 0} className="rounded-lg border border-white/30 bg-white/10 px-3 py-1.5 text-sm font-black hover:bg-white/20 disabled:opacity-50">
              Excel&apos;e Aktar
            </button>
          </div>
        </div>
        <div className="max-h-[640px] overflow-auto">
          <table className="ns-tablo ns-tablo-sql w-full min-w-[640px] border-collapse text-left">
            <thead className="sticky top-0 z-10">
              <tr>
                <th className="px-3 py-2">Dönem</th>
                {pivot.sutunlar.map((s) => <th key={s.anahtar} className="whitespace-nowrap px-3 py-2 text-right">{s.ad}</th>)}
                <th className="px-3 py-2 text-right">Toplam</th>
              </tr>
            </thead>
            <tbody>
              {durum !== 'yukleniyor' && pivot.donemler.length === 0 ? (
                <tr><td colSpan={pivot.sutunlar.length + 2} className="px-4 py-10 text-center font-bold text-slate-500">Bu aralıkta işlem bulunamadı.</td></tr>
              ) : pivot.donemler.map((d, i) => {
                const degerler = pivot.sutunlar.map((s) => pivot.hucre.get(`${d}|${s.anahtar}`) ?? 0)
                const toplam = degerler.reduce((a, b) => a + b, 0)
                const satirAcik = acikDetay?.yer === 'donem' && acikDetay.anahtar.startsWith(`${d}|`)
                return (
                  <Fragment key={d}>
                  <tr className={satirAcik ? 'bg-amber-50' : i % 2 === 0 ? 'bg-white' : 'bg-slate-50/70'}>
                    <td
                      className="cursor-pointer whitespace-nowrap px-3 font-black text-slate-800 hover:text-[#0a3a57] hover:underline"
                      title="Bu dönemde işlem yapılan dosyaları göster / gizle"
                      onClick={() => detayAcKapat({ yer: 'donem', anahtar: `${d}|*`, kullanici: secilenPersonel, donemBaslangici: d })}
                    >
                      <span className={`mr-1.5 inline-block text-xs text-[#c9a227] transition-transform ${satirAcik ? 'rotate-90' : ''}`}>▶</span>
                      {donemEtiketi(donem, d)}
                    </td>
                    {degerler.map((v, j) => {
                      const sutun = pivot.sutunlar[j].anahtar
                      return (
                        <td
                          key={sutun}
                          className={`px-3 text-right font-bold tabular-nums ${v ? 'cursor-pointer hover:bg-amber-100 hover:underline' : ''}`}
                          title={v ? 'Bu dosyaları göster' : undefined}
                          onClick={v ? () => detayAcKapat({
                            yer: 'donem',
                            anahtar: `${d}|${sutun}`,
                            // Tum personel gorunumunde sutun = personel; secili personelde sutun = islem turu
                            kullanici: secilenPersonel ?? sutun,
                            donemBaslangici: d,
                          }) : undefined}
                        >
                          {v ? v.toLocaleString('tr-TR') : <span className="text-slate-300">–</span>}
                        </td>
                      )
                    })}
                    <td
                      className="cursor-pointer px-3 text-right font-black tabular-nums text-[#0a3a57] hover:underline"
                      onClick={() => detayAcKapat({ yer: 'donem', anahtar: `${d}|*`, kullanici: secilenPersonel, donemBaslangici: d })}
                    >
                      {toplam.toLocaleString('tr-TR')}
                    </td>
                  </tr>
                  {satirAcik && acikDetay && (
                    <tr>
                      <td colSpan={pivot.sutunlar.length + 2} className="!p-0">
                        <DetayListesi
                          donem={donem}
                          aralik={aralik}
                          turler={secilenPersonel && acikDetay.anahtar.split('|')[1] !== '*' ? new Set([acikDetay.anahtar.split('|')[1] as Tur]) : secilenTurler}
                          kullaniciAnahtari={acikDetay.kullanici}
                          donemBaslangici={acikDetay.donemBaslangici}
                          onDosyaAc={dosyaAc}
                        />
                      </td>
                    </tr>
                  )}
                  </Fragment>
                )
              })}
            </tbody>
          </table>
        </div>
      </section>

      <p className="text-sm font-semibold text-slate-500">
        Kayıtlar <b>is_akisi_performans</b> tablosunda saklanır. Ön İnceleme ve Tahkikat geçmişi tamamen aktarıldı;
        Sonuç Bekleyen için geçmişten yalnızca konusu &quot;Komisyon Raporu&quot; olan kayıtlar alındı, bundan sonraki her kayıt konusundan bağımsız sayılır.
        {ilkKayit && <> İlk kayıt: {ilkKayit.split('-').reverse().join('.')}.</>}
      </p>
    </div>
  )
}
