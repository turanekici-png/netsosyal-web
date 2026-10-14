'use client'

import { useEffect, useMemo, useState } from 'react'
import { confirmDialog } from '@/components/shared/GlobalConfirmDialog'
import {
  OTOMATIK_DOLUM_ETIKETLERI,
  RAPOR_ANAHTARI_ETIKETLERI,
  SORU_TURU_ETIKETLERI,
  yeniGeciciId,
  type Bolum,
  type FormAyarlari,
  type OtomatikDolum,
  type RaporAnahtari,
  type Sablon,
  type Soru,
  type SoruTuru,
  type TabloSutunu,
} from '@/lib/constants/sahaIncelemeForm'

export const dynamic = 'force-dynamic'

// Ayarlar > Sistem Ayarları > "Tahkikat Formu Tasarımı" (2026-10-13).
// "Hane Ziyareti ve Sosyal İnceleme Formu"nun bolum ve sorularini yonetir:
// bolum/soru ekleme-cikarma-siralama, soru turu, secenekler, tablo
// sutunlari, otomatik dolum ve formun basliklari/notlari. Degisiklikler
// once bu ekranda tutulur, "Kaydet" ile TEK seferde yazilir (onceki
// tasarimcidaki "kaydedildi mi?" belirsizligi olmasin diye). Kayitli
// formlar etkilenmez - her biri dolduruldugu andaki sablonun kopyasini tasir.

type ApiResponse<T> = { success: boolean; data?: T; error?: string }

const AYAR_ALANLARI: { key: keyof FormAyarlari; label: string; uzun?: boolean }[] = [
  { key: 'kurumBasligi', label: 'Kurum başlığı' },
  { key: 'formBasligi', label: 'Form başlığı' },
  { key: 'altBaslik', label: 'Alt başlık' },
  { key: 'surum', label: 'Sürüm / tarih' },
  { key: 'kullanimNotu', label: 'Kullanım notu (formun başında)', uzun: true },
  { key: 'sonNot', label: 'Ön değerlendirme altındaki not', uzun: true },
  { key: 'altBilgi', label: 'Sayfa alt bilgisi (yazdırmada)' },
]

const INPUT = 'w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-lg font-semibold text-slate-900 outline-none focus:border-[#0f2a52] focus:ring-2 focus:ring-sky-100'
const KUCUK_BTN = 'flex h-10 w-10 items-center justify-center rounded-md border border-slate-300 bg-white text-lg font-black text-slate-600 hover:bg-slate-100 disabled:opacity-30'

// Yeni eklenen bolum/sorulara DB id'si kaydedilene kadar negatif gecici id verilir.
let geciciSayac = -1
const geciciId = () => geciciSayac--

function yeniSoru(bolumId: number): Soru {
  return {
    id: geciciId(), bolumId, sira: 0, soruMetni: '', tur: 'metin', zorunlu: false, aktif: true, ipucu: null,
    secenekler: [], sutunlar: [], sabitSatirlar: [], bosSatirSayisi: 3, otomatik: null, anahtar: null,
  }
}

function tasi<T>(liste: T[], index: number, yon: -1 | 1): T[] {
  const hedef = index + yon
  if (hedef < 0 || hedef >= liste.length) return liste
  const kopya = [...liste]
  ;[kopya[index], kopya[hedef]] = [kopya[hedef], kopya[index]]
  return kopya
}

export default function SahaIncelemeFormTasarimPage() {
  const [sablon, setSablon] = useState<Sablon | null>(null)
  const [kayitliHali, setKayitliHali] = useState('')
  const [aktifBolumId, setAktifBolumId] = useState<number | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [status, setStatus] = useState<{ tur: 'hata' | 'ok'; metin: string } | null>(null)
  const [acikSoruId, setAcikSoruId] = useState<number | null>(null)

  // defaultValue kullanan alanlar (virgullu secenekler, sabit satirlar)
  // "Geri Al"/"Kaydet" sonrasi yeniden cizilsin diye kart anahtarina eklenir.
  const [yuklemeSayaci, setYuklemeSayaci] = useState(0)
  // Virgullu secenek / satir-satir sabit satir kutularinin yazilan HAM metni.
  // Her tus vuruşunda ayristirilip sablona da ANINDA islenir (eskiden sadece
  // kutudan cikinca isleniyordu - Kaydet'e dogrudan basilinca yazilan
  // kayboluyordu); ham metin ayrica tutulur ki virgul/bos satir yazilabilsin.
  const [taslaklar, setTaslaklar] = useState<Record<string, string>>({})

  const yukle = (data: Sablon) => {
    setYuklemeSayaci((n) => n + 1)
    setTaslaklar({})
    setSablon(data)
    setKayitliHali(JSON.stringify(data))
    setAktifBolumId((current) => (current && data.bolumler.some((b) => b.id === current) ? current : data.bolumler[0]?.id ?? null))
  }

  useEffect(() => {
    void (async () => {
      setIsLoading(true)
      try {
        const response = await fetch('/api/documents/saha-inceleme/sablon?tumu=1', { cache: 'no-store' })
        const payload = await response.json() as ApiResponse<Sablon>
        if (response.ok && payload.success && payload.data) yukle(payload.data)
        else setStatus({ tur: 'hata', metin: payload.error || 'Form şablonu yüklenemedi.' })
      } catch {
        setStatus({ tur: 'hata', metin: 'Form şablonu yüklenemedi.' })
      } finally {
        setIsLoading(false)
      }
    })()
  }, [])

  const degisti = useMemo(() => Boolean(sablon) && JSON.stringify(sablon) !== kayitliHali, [sablon, kayitliHali])

  // Kaydedilmemis degisiklik varken sekme/sayfa kapatilirsa uyar.
  useEffect(() => {
    if (!degisti) return
    const uyar = (event: BeforeUnloadEvent) => { event.preventDefault() }
    window.addEventListener('beforeunload', uyar)
    return () => window.removeEventListener('beforeunload', uyar)
  }, [degisti])

  const [surukleneneId, setSurukleneneId] = useState<number | null>(null)
  const [hedefId, setHedefId] = useState<number | null>(null)
  const bolumuSurukle = (kaynakId: number, hedefBolumId: number) => {
    setSablon((s) => {
      if (!s || kaynakId === hedefBolumId) return s
      const kaynak = s.bolumler.findIndex((b) => b.id === kaynakId)
      const hedef = s.bolumler.findIndex((b) => b.id === hedefBolumId)
      if (kaynak < 0 || hedef < 0) return s
      const kopya = [...s.bolumler]
      const [tasinan] = kopya.splice(kaynak, 1)
      kopya.splice(hedef, 0, tasinan)
      return { ...s, bolumler: kopya }
    })
  }

  const aktifBolum = sablon?.bolumler.find((b) => b.id === aktifBolumId) ?? null
  const aktifBolumIndex = sablon?.bolumler.findIndex((b) => b.id === aktifBolumId) ?? -1

  const bolumGuncelle = (bolumId: number, patch: Partial<Bolum>) => {
    setSablon((s) => s && { ...s, bolumler: s.bolumler.map((b) => (b.id === bolumId ? { ...b, ...patch } : b)) })
  }
  const soruGuncelle = (soruId: number, patch: Partial<Soru>) => {
    setSablon((s) => s && {
      ...s,
      bolumler: s.bolumler.map((b) => ({ ...b, sorular: b.sorular.map((q) => (q.id === soruId ? { ...q, ...patch } : q)) })),
    })
  }
  const sorulariGuncelle = (bolumId: number, fn: (sorular: Soru[]) => Soru[]) => {
    setSablon((s) => s && { ...s, bolumler: s.bolumler.map((b) => (b.id === bolumId ? { ...b, sorular: fn(b.sorular) } : b)) })
  }

  // Ayni rapor alani (ör. Aciliyet) yalnizca bir soruya baglanabilir.
  const anahtarKullanan = (anahtar: RaporAnahtari, haric: number) =>
    sablon?.bolumler.flatMap((b) => b.sorular).find((q) => q.anahtar === anahtar && q.id !== haric)

  const bolumEkle = () => {
    if (!sablon) return
    const yeni: Bolum = { id: geciciId(), sira: sablon.bolumler.length + 1, baslik: 'Yeni bölüm', aciklama: null, aktif: true, sorular: [] }
    setSablon({ ...sablon, bolumler: [...sablon.bolumler, yeni] })
    setAktifBolumId(yeni.id)
  }

  const bolumSil = async (bolum: Bolum) => {
    if (!sablon) return
    if (!(await confirmDialog(`"${bolum.baslik}" bölümü ve içindeki ${bolum.sorular.length} soru formdan çıkarılsın mı? (Kaydet'e basınca uygulanır; kayıtlı formlar etkilenmez.)`))) return
    const kalan = sablon.bolumler.filter((b) => b.id !== bolum.id)
    setSablon({ ...sablon, bolumler: kalan })
    setAktifBolumId(kalan[0]?.id ?? null)
  }

  const soruEkle = () => {
    if (!aktifBolum) return
    const soru = yeniSoru(aktifBolum.id)
    sorulariGuncelle(aktifBolum.id, (sorular) => [...sorular, soru])
    setAcikSoruId(soru.id)
  }

  const soruSil = async (soru: Soru) => {
    if (!(await confirmDialog(`"${soru.soruMetni || 'Adsız soru'}" sorusu formdan çıkarılsın mı? (Kaydet'e basınca uygulanır; kayıtlı formlar etkilenmez.)`))) return
    sorulariGuncelle(soru.bolumId, (sorular) => sorular.filter((q) => q.id !== soru.id))
  }

  const turDegistir = (soru: Soru, tur: SoruTuru) => {
    const patch: Partial<Soru> = { tur }
    if ((tur === 'tek' || tur === 'coklu') && soru.secenekler.length === 0) {
      patch.secenekler = [{ id: yeniGeciciId('s'), metin: 'Seçenek 1' }, { id: yeniGeciciId('s'), metin: 'Seçenek 2' }]
    }
    if (tur === 'tablo' && soru.sutunlar.length === 0) {
      patch.sutunlar = [{ id: yeniGeciciId('c'), baslik: 'Sütun 1', tur: 'metin' }, { id: yeniGeciciId('c'), baslik: 'Sütun 2', tur: 'metin' }]
    }
    soruGuncelle(soru.id, patch)
  }

  const kaydet = async () => {
    if (!sablon || isSaving) return
    setIsSaving(true)
    setStatus(null)
    try {
      const response = await fetch('/api/documents/saha-inceleme/sablon', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(sablon),
      })
      const payload = await response.json() as ApiResponse<Sablon>
      if (!response.ok || !payload.success || !payload.data) throw new Error(payload.error || 'Kaydedilemedi.')
      // Gecici (negatif) id'ler gercek id'lere donustu - aktif bolumu sira ile koru.
      const index = aktifBolumIndex
      yukle(payload.data)
      setAktifBolumId(payload.data.bolumler[Math.max(0, Math.min(index, payload.data.bolumler.length - 1))]?.id ?? null)
      setAcikSoruId(null)
      setStatus({ tur: 'ok', metin: 'Form kaydedildi. Bundan sonra doldurulan formlar bu haliyle açılacak.' })
    } catch (error) {
      setStatus({ tur: 'hata', metin: error instanceof Error ? error.message : 'Kaydedilemedi.' })
    } finally {
      setIsSaving(false)
    }
  }

  const vazgec = async () => {
    if (!degisti || !(await confirmDialog('Kaydedilmemiş tüm değişiklikler geri alınsın mı?'))) return
    yukle(JSON.parse(kayitliHali) as Sablon)
  }

  const sifirla = async () => {
    if (!(await confirmDialog('Form, ilk kurulumdaki "Hane Ziyareti ve Sosyal İnceleme Formu" haline döndürülsün mü? Sonradan eklenen/değiştirilen tüm bölüm ve sorular silinir. Kayıtlı formlar etkilenmez.'))) return
    setIsSaving(true)
    try {
      const response = await fetch('/api/documents/saha-inceleme/sablon?islem=sifirla', { method: 'POST' })
      const payload = await response.json() as ApiResponse<Sablon>
      if (!response.ok || !payload.success || !payload.data) throw new Error(payload.error || 'Sıfırlanamadı.')
      yukle(payload.data)
      setStatus({ tur: 'ok', metin: 'Form varsayılan haline döndürüldü.' })
    } catch (error) {
      setStatus({ tur: 'hata', metin: error instanceof Error ? error.message : 'Sıfırlanamadı.' })
    } finally {
      setIsSaving(false)
    }
  }

  const sutunGuncelle = (soru: Soru, index: number, patch: Partial<TabloSutunu>) => {
    soruGuncelle(soru.id, { sutunlar: soru.sutunlar.map((s, i) => (i === index ? { ...s, ...patch } : s)) })
  }

  const soruKarti = (soru: Soru, index: number, toplam: number) => {
    const acik = acikSoruId === soru.id
    return (
      <div key={`${soru.id}-${yuklemeSayaci}`} className={`rounded-xl border bg-white shadow-sm ${soru.aktif ? 'border-slate-300' : 'border-dashed border-slate-300 opacity-70'}`}>
        <div className="flex items-center gap-2 px-4 pt-3">
          <span className="w-8 shrink-0 text-lg font-black text-slate-400">{index + 1}.</span>
          <input
            value={soru.soruMetni}
            onChange={(e) => soruGuncelle(soru.id, { soruMetni: e.target.value })}
            placeholder="Soru metni"
            className={`${INPUT} min-w-0 flex-1 font-black`}
          />
          <select
            value={soru.tur}
            onChange={(e) => turDegistir(soru, e.target.value as SoruTuru)}
            className="w-48 shrink-0 rounded-md border border-slate-300 bg-white px-3 py-2 text-lg font-semibold text-slate-900 outline-none focus:border-[#0f2a52]"
          >
            {Object.entries(SORU_TURU_ETIKETLERI).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </div>
        <div className="flex flex-wrap items-center gap-2 px-4 pb-3 pl-14 pt-2">
          <div className="flex flex-wrap items-center gap-2">
            <label className="flex items-center gap-1.5 text-base font-black text-slate-600">
              <input type="checkbox" checked={soru.zorunlu} onChange={(e) => soruGuncelle(soru.id, { zorunlu: e.target.checked })} className="h-4 w-4" />
              Zorunlu
            </label>
            <label className="flex items-center gap-1.5 text-base font-black text-slate-600" title="Pasif sorular formda görünmez ama silinmez">
              <input type="checkbox" checked={soru.aktif} onChange={(e) => soruGuncelle(soru.id, { aktif: e.target.checked })} className="h-4 w-4" />
              Aktif
            </label>
            {/* 2026-10-14: uzun metin alaninin formdaki yuksekligi (satir); bos = otomatik */}
            {soru.tur === 'uzun_metin' && (
              <label className="flex items-center gap-1.5 text-base font-black text-slate-600" title="Alanın formdaki yüksekliği (satır sayısı). Boş bırakılırsa yazdıkça otomatik büyür.">
                Yükseklik
                <input
                  type="number"
                  min={1}
                  max={30}
                  placeholder="Oto"
                  value={soru.yukseklik ?? ''}
                  onChange={(e) => soruGuncelle(soru.id, { yukseklik: Number(e.target.value) > 0 ? Math.min(30, Math.trunc(Number(e.target.value))) : null })}
                  className="w-20 rounded-md border border-slate-300 px-2 py-1.5 text-base font-bold text-slate-900"
                />
                <span className="text-sm font-bold text-slate-400">satır</span>
              </label>
            )}
            <button type="button" onClick={() => setAcikSoruId(acik ? null : soru.id)} className="rounded-md border border-slate-300 px-3 py-2 text-base font-black text-slate-600 hover:bg-slate-50">
              {acik ? 'Ayrıntıları gizle ▲' : 'Ayrıntılar ▼'}
            </button>
            <button type="button" title="Yukarı taşı" disabled={index === 0} onClick={() => sorulariGuncelle(soru.bolumId, (l) => tasi(l, index, -1))} className={KUCUK_BTN}>↑</button>
            <button type="button" title="Aşağı taşı" disabled={index === toplam - 1} onClick={() => sorulariGuncelle(soru.bolumId, (l) => tasi(l, index, 1))} className={KUCUK_BTN}>↓</button>
            <button type="button" onClick={() => void soruSil(soru)} className="rounded-md border border-rose-300 bg-rose-50 px-3 py-2 text-base font-black text-rose-600 hover:bg-rose-100">Sil</button>
          </div>
        </div>

        {(soru.otomatik || soru.anahtar) && !acik && (
          <div className="flex flex-wrap gap-2 px-4 pb-3 pl-14">
            {soru.otomatik && <span className="rounded-full bg-sky-50 px-3 py-1 text-sm font-black text-sky-700">Otomatik dolar: {OTOMATIK_DOLUM_ETIKETLERI[soru.otomatik]}</span>}
            {soru.anahtar && <span className="rounded-full bg-amber-50 px-3 py-1 text-sm font-black text-amber-700">Raporda: {RAPOR_ANAHTARI_ETIKETLERI[soru.anahtar]}</span>}
          </div>
        )}

        {(soru.tur === 'tek' || soru.tur === 'coklu') && (
          <div className="border-t border-slate-100 px-4 py-3 pl-14">
            <p className="mb-2 text-sm font-black uppercase tracking-wide text-slate-400">Seçenekler</p>
            <div className="space-y-1.5">
              {soru.secenekler.map((secenek, i) => (
                <div key={secenek.id} className="flex items-center gap-2">
                  <span className={`h-4 w-4 shrink-0 border border-slate-400 ${soru.tur === 'tek' ? 'rounded-full' : 'rounded-sm'}`} />
                  <input
                    value={secenek.metin}
                    onChange={(e) => soruGuncelle(soru.id, { secenekler: soru.secenekler.map((s, j) => (j === i ? { ...s, metin: e.target.value } : s)) })}
                    className={INPUT}
                  />
                  <button type="button" disabled={i === 0} onClick={() => soruGuncelle(soru.id, { secenekler: tasi(soru.secenekler, i, -1) })} className={KUCUK_BTN}>↑</button>
                  <button type="button" disabled={i === soru.secenekler.length - 1} onClick={() => soruGuncelle(soru.id, { secenekler: tasi(soru.secenekler, i, 1) })} className={KUCUK_BTN}>↓</button>
                  <button type="button" title="Seçeneği sil" onClick={() => soruGuncelle(soru.id, { secenekler: soru.secenekler.filter((_, j) => j !== i) })} className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-rose-300 text-xl text-rose-500 hover:bg-rose-50">×</button>
                </div>
              ))}
            </div>
            <button
              type="button"
              onClick={() => soruGuncelle(soru.id, { secenekler: [...soru.secenekler, { id: yeniGeciciId('s'), metin: '' }] })}
              className="mt-2 rounded-md border border-dashed border-slate-300 px-4 py-2 text-base font-black text-slate-500 hover:border-[#0f2a52] hover:text-[#0f2a52]"
            >
              + Seçenek Ekle
            </button>
          </div>
        )}

        {soru.tur === 'tablo' && (
          <div className="border-t border-slate-100 px-4 py-3 pl-14">
            <p className="mb-2 text-sm font-black uppercase tracking-wide text-slate-400">Tablo sütunları</p>
            <div className="space-y-1.5">
              {soru.sutunlar.map((sutun, i) => (
                <div key={sutun.id} className="grid gap-2 lg:grid-cols-[minmax(0,1fr)_150px_minmax(0,1fr)_auto]">
                  <input value={sutun.baslik} onChange={(e) => sutunGuncelle(soru, i, { baslik: e.target.value })} placeholder="Sütun başlığı" className={INPUT} />
                  <select value={sutun.tur} onChange={(e) => sutunGuncelle(soru, i, { tur: e.target.value as TabloSutunu['tur'] })} className={INPUT}>
                    <option value="metin">Metin</option>
                    <option value="sayi">Sayı</option>
                    <option value="secim">Seçim listesi</option>
                  </select>
                  {sutun.tur === 'secim' ? (
                    <input
                      value={taslaklar[`sec-${soru.id}-${sutun.id}`] ?? (sutun.secenekler ?? []).join(', ')}
                      onChange={(e) => {
                        const ham = e.target.value
                        setTaslaklar((t) => ({ ...t, [`sec-${soru.id}-${sutun.id}`]: ham }))
                        sutunGuncelle(soru, i, { secenekler: ham.split(',').map((x) => x.trim()).filter(Boolean) })
                      }}
                      placeholder="Seçenekler (virgülle ayırın)"
                      className={INPUT}
                    />
                  ) : <span />}
                  <div className="flex gap-1.5">
                    <button type="button" disabled={i === 0} onClick={() => soruGuncelle(soru.id, { sutunlar: tasi(soru.sutunlar, i, -1) })} className={KUCUK_BTN}>↑</button>
                    <button type="button" disabled={i === soru.sutunlar.length - 1} onClick={() => soruGuncelle(soru.id, { sutunlar: tasi(soru.sutunlar, i, 1) })} className={KUCUK_BTN}>↓</button>
                    <button type="button" title="Sütunu sil" onClick={() => soruGuncelle(soru.id, { sutunlar: soru.sutunlar.filter((_, j) => j !== i) })} className="flex h-10 w-10 items-center justify-center rounded-md border border-rose-300 text-xl text-rose-500 hover:bg-rose-50">×</button>
                  </div>
                </div>
              ))}
            </div>
            <button
              type="button"
              onClick={() => soruGuncelle(soru.id, { sutunlar: [...soru.sutunlar, { id: yeniGeciciId('c'), baslik: '', tur: 'metin' }] })}
              className="mt-2 rounded-md border border-dashed border-slate-300 px-4 py-2 text-base font-black text-slate-500 hover:border-[#0f2a52] hover:text-[#0f2a52]"
            >
              + Sütun Ekle
            </button>
            <div className="mt-3 grid gap-3 lg:grid-cols-[minmax(0,1fr)_220px]">
              <label className="block text-base font-black text-slate-600">
                Sabit satırlar <span className="font-semibold text-slate-400">(her satıra bir tane; doluysa ilk sütun bu satır adlarıyla sabitlenir, personel satır ekleyip silemez - ör. gider kalemleri)</span>
                <textarea
                  value={taslaklar[`sabit-${soru.id}`] ?? soru.sabitSatirlar.join('\n')}
                  onChange={(e) => {
                    const ham = e.target.value
                    setTaslaklar((t) => ({ ...t, [`sabit-${soru.id}`]: ham }))
                    soruGuncelle(soru.id, { sabitSatirlar: ham.split('\n').map((x) => x.trim()).filter(Boolean) })
                  }}
                  rows={3}
                  className={`${INPUT} mt-1`}
                />
              </label>
              <label className="block text-base font-black text-slate-600">
                Boş formda satır sayısı
                <input type="number" min={0} max={30} value={soru.bosSatirSayisi} onChange={(e) => soruGuncelle(soru.id, { bosSatirSayisi: Number(e.target.value) || 0 })} className={`${INPUT} mt-1`} />
              </label>
            </div>
          </div>
        )}

        {acik && (
          <div className="grid gap-3 border-t border-slate-100 bg-slate-50 px-4 py-3 pl-14 lg:grid-cols-3">
            <label className="block text-base font-black text-slate-600">
              Açıklama / ipucu <span className="font-semibold text-slate-400">(sorunun yanında küçük yazılır)</span>
              <input value={soru.ipucu ?? ''} onChange={(e) => soruGuncelle(soru.id, { ipucu: e.target.value || null })} className={`${INPUT} mt-1`} />
            </label>
            <label className="block text-base font-black text-slate-600">
              Otomatik dolum <span className="font-semibold text-slate-400">(form açılınca dosyadan gelir)</span>
              <select value={soru.otomatik ?? ''} onChange={(e) => soruGuncelle(soru.id, { otomatik: (e.target.value || null) as OtomatikDolum | null })} className={`${INPUT} mt-1`}>
                <option value="">Yok</option>
                {Object.entries(OTOMATIK_DOLUM_ETIKETLERI).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            </label>
            <label className="block text-base font-black text-slate-600">
              Rapor alanı <span className="font-semibold text-slate-400">(İnceleme Formları / Sonuç Bekleyen listesinde gösterilir)</span>
              <select
                value={soru.anahtar ?? ''}
                onChange={(e) => {
                  const anahtar = (e.target.value || null) as RaporAnahtari | null
                  const kullanan = anahtar ? anahtarKullanan(anahtar, soru.id) : null
                  if (kullanan) {
                    setStatus({ tur: 'hata', metin: `"${RAPOR_ANAHTARI_ETIKETLERI[anahtar!]}" alanı zaten "${kullanan.soruMetni}" sorusuna bağlı.` })
                    return
                  }
                  soruGuncelle(soru.id, { anahtar })
                }}
                className={`${INPUT} mt-1`}
              >
                <option value="">Yok</option>
                {Object.entries(RAPOR_ANAHTARI_ETIKETLERI).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            </label>
          </div>
        )}
      </div>
    )
  }

  return (
    // Kabuk/hesap arayuz kucultmesinden (ScaledArea zoom, --shell-unzoom)
    // bagimsiz SABIT olcek - kullanici istegi (2026-10-13): "yazilar net
    // okunsun" -> tam boyut "cok buyuk" bulundu, %86'ya cekildi.
    <div className="space-y-5 p-4 text-slate-950 sm:p-6" style={{ zoom: 'calc(var(--shell-unzoom, 1) * 0.86)' } as React.CSSProperties}>
      <div className="ns-sayfa-baslik flex flex-col gap-4 rounded-lg border-b-[3px] border-[#3b82f6] bg-gradient-to-r from-[#0f2a52] to-[#173d6b] px-6 py-5 text-white shadow-sm lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0">
          <p className="text-base font-black uppercase tracking-wide text-white/70">Sistem Ayarları</p>
          <h1 className="text-2xl font-black leading-tight md:text-[26px]">Tahkikat Formu Tasarımı</h1>
          <p className="mt-1 text-lg font-semibold text-white/80">
            Hane Ziyareti ve Sosyal İnceleme Formu&apos;nun bölüm ve sorularını buradan ekleyip çıkarabilirsiniz. Değişiklikler <b>Kaydet</b>&apos;e basınca uygulanır; daha önce doldurulmuş formlar etkilenmez.
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          <a href="/api/documents/saha-inceleme/yazdir" target="_blank" rel="noreferrer" className="rounded-md border border-white/30 bg-white/10 px-4 py-2.5 text-lg font-black text-white hover:bg-white/20">
            Boş Form Önizle / Yazdır
          </a>
          <button type="button" onClick={() => void vazgec()} disabled={!degisti || isSaving} className="rounded-md border border-white/30 bg-white/10 px-4 py-2.5 text-lg font-black text-white hover:bg-white/20 disabled:opacity-40">
            Değişiklikleri Geri Al
          </button>
          <button type="button" onClick={() => void kaydet()} disabled={!degisti || isSaving} className="rounded-md bg-white px-6 py-2.5 text-lg font-black text-[#0f2a52] shadow hover:bg-sky-50 disabled:opacity-50">
            {isSaving ? 'Kaydediliyor...' : degisti ? 'Kaydet' : 'Kaydedildi ✓'}
          </button>
        </div>
      </div>

      {degisti && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-2.5 text-lg font-black text-amber-800">
          Kaydedilmemiş değişiklikler var. Uygulamak için sağ üstteki <b>Kaydet</b>&apos;e basın.
        </div>
      )}
      {status && (
        <div className={`flex items-center justify-between gap-3 rounded-lg border px-4 py-2.5 text-lg font-bold ${status.tur === 'ok' ? 'border-emerald-300 bg-emerald-50 text-emerald-800' : 'border-rose-300 bg-rose-50 text-rose-700'}`}>
          <span>{status.metin}</span>
          <button type="button" onClick={() => setStatus(null)} className="text-base font-black underline">Kapat</button>
        </div>
      )}

      {isLoading || !sablon ? (
        <div className="flex items-center justify-center py-24">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-[#0f2a52] border-t-transparent" />
        </div>
      ) : (
        <div className="grid gap-5 xl:grid-cols-[380px_minmax(0,1fr)]">
          <aside className="space-y-3">
            <div className="rounded-xl border border-slate-300 bg-white p-3 shadow-sm">
              <p className="mb-2 px-1 text-base font-black uppercase tracking-wide text-slate-500">Bölümler</p>
              {/* Kullanici istegi (2026-10-14): bolum sirasi listeden yukari/asagi oklari
                  ve surukle-birak ile degistirilir; liste uzunsa kendi icinde kayar. */}
              <div className="max-h-[60vh] space-y-1 overflow-y-auto pr-1">
                {sablon.bolumler.map((bolum, index) => {
                  const aktif = bolum.id === aktifBolumId
                  const oklar = `shrink-0 rounded px-1.5 py-0.5 text-sm font-black leading-none disabled:opacity-25 ${aktif ? 'text-white hover:bg-white/20' : 'text-slate-500 hover:bg-slate-200'}`
                  return (
                    <div
                      key={bolum.id}
                      draggable
                      onDragStart={(e) => { setSurukleneneId(bolum.id); e.dataTransfer.effectAllowed = 'move' }}
                      onDragOver={(e) => { if (surukleneneId !== null) { e.preventDefault(); setHedefId(bolum.id) } }}
                      onDragLeave={() => setHedefId((c) => (c === bolum.id ? null : c))}
                      onDrop={(e) => { e.preventDefault(); if (surukleneneId !== null) bolumuSurukle(surukleneneId, bolum.id); setSurukleneneId(null); setHedefId(null) }}
                      onDragEnd={() => { setSurukleneneId(null); setHedefId(null) }}
                      className={`flex w-full items-center gap-1 rounded-md pr-1 text-left text-lg font-black transition ${
                        aktif ? 'bg-[#0f2a52] text-white' : 'text-slate-700 hover:bg-slate-100'
                      } ${bolum.aktif ? '' : 'opacity-50'} ${surukleneneId === bolum.id ? 'opacity-40' : ''} ${hedefId === bolum.id && surukleneneId !== bolum.id ? 'ring-2 ring-sky-500' : ''}`}
                    >
                      <span title="Sürükleyip bırakın" className={`shrink-0 cursor-grab select-none pl-2 text-base ${aktif ? 'text-white/60' : 'text-slate-300'}`}>⠿</span>
                      <button type="button" onClick={() => setAktifBolumId(bolum.id)} className="flex min-w-0 flex-1 items-center gap-2 py-2 pl-1 text-left">
                        <span className="w-6 shrink-0">{index + 1}.</span>
                        <span className="min-w-0 flex-1 truncate">{bolum.baslik || 'Adsız bölüm'}</span>
                        <span className={`shrink-0 text-sm ${aktif ? 'text-white/70' : 'text-slate-400'}`}>{bolum.sorular.length}</span>
                      </button>
                      <button type="button" title="Yukarı taşı" disabled={index === 0} onClick={() => setSablon({ ...sablon, bolumler: tasi(sablon.bolumler, index, -1) })} className={oklar}>↑</button>
                      <button type="button" title="Aşağı taşı" disabled={index === sablon.bolumler.length - 1} onClick={() => setSablon({ ...sablon, bolumler: tasi(sablon.bolumler, index, 1) })} className={oklar}>↓</button>
                    </div>
                  )
                })}
              </div>
              <button type="button" onClick={bolumEkle} className="mt-2 w-full rounded-md border border-dashed border-slate-300 py-2 text-base font-black text-slate-500 hover:border-[#0f2a52] hover:text-[#0f2a52]">
                + Bölüm Ekle
              </button>
            </div>

            <div className="rounded-xl border border-slate-300 bg-white p-3 shadow-sm">
              <p className="mb-2 px-1 text-base font-black uppercase tracking-wide text-slate-500">Form başlık ve notları</p>
              <div className="space-y-2">
                {AYAR_ALANLARI.map((alan) => (
                  <label key={alan.key} className="block text-base font-black text-slate-600">
                    {alan.label}
                    {alan.uzun ? (
                      <textarea value={sablon.ayarlar[alan.key]} onChange={(e) => setSablon({ ...sablon, ayarlar: { ...sablon.ayarlar, [alan.key]: e.target.value } })} rows={4} className={`${INPUT} mt-1 text-base`} />
                    ) : (
                      <input value={sablon.ayarlar[alan.key]} onChange={(e) => setSablon({ ...sablon, ayarlar: { ...sablon.ayarlar, [alan.key]: e.target.value } })} className={`${INPUT} mt-1 text-base`} />
                    )}
                  </label>
                ))}
              </div>
            </div>

            <button type="button" onClick={() => void sifirla()} disabled={isSaving} className="w-full rounded-md border border-rose-200 bg-white px-3 py-2 text-base font-black text-rose-600 hover:bg-rose-50 disabled:opacity-50">
              Varsayılan forma dön
            </button>
          </aside>

          <main className="min-w-0 space-y-3">
            {aktifBolum ? (
              <>
                <div className="rounded-xl border border-slate-300 bg-white p-4 shadow-sm">
                  <div className="flex flex-col gap-2 lg:flex-row lg:items-center">
                    <span className="shrink-0 text-xl font-black text-[#0f2a52]">{aktifBolumIndex + 1}.</span>
                    <input
                      value={aktifBolum.baslik}
                      onChange={(e) => bolumGuncelle(aktifBolum.id, { baslik: e.target.value })}
                      placeholder="Bölüm başlığı"
                      className={`${INPUT} min-w-0 flex-1 text-xl font-black`}
                    />
                    <div className="flex shrink-0 flex-wrap items-center gap-2">
                      <label className="flex items-center gap-1.5 text-base font-black text-slate-600">
                        <input type="checkbox" checked={aktifBolum.aktif} onChange={(e) => bolumGuncelle(aktifBolum.id, { aktif: e.target.checked })} className="h-4 w-4" />
                        Aktif
                      </label>
                      <button type="button" title="Bölümü yukarı taşı" disabled={aktifBolumIndex === 0} onClick={() => setSablon({ ...sablon, bolumler: tasi(sablon.bolumler, aktifBolumIndex, -1) })} className={KUCUK_BTN}>↑</button>
                      <button type="button" title="Bölümü aşağı taşı" disabled={aktifBolumIndex === sablon.bolumler.length - 1} onClick={() => setSablon({ ...sablon, bolumler: tasi(sablon.bolumler, aktifBolumIndex, 1) })} className={KUCUK_BTN}>↓</button>
                      <button type="button" onClick={() => void bolumSil(aktifBolum)} className="rounded-md border border-rose-300 bg-rose-50 px-3 py-2 text-base font-black text-rose-600 hover:bg-rose-100">Bölümü Sil</button>
                    </div>
                  </div>
                  <label className="mt-3 block text-base font-black text-slate-600">
                    Bölüm açıklaması <span className="font-semibold text-slate-400">(isteğe bağlı, başlığın altında italik yazılır)</span>
                    <textarea value={aktifBolum.aciklama ?? ''} onChange={(e) => bolumGuncelle(aktifBolum.id, { aciklama: e.target.value || null })} rows={2} className={`${INPUT} mt-1 text-base`} />
                  </label>
                </div>

                {aktifBolum.sorular.map((soru, index) => soruKarti(soru, index, aktifBolum.sorular.length))}

                <button type="button" onClick={soruEkle} className="w-full rounded-xl border-2 border-dashed border-slate-300 bg-white py-4 text-lg font-black text-slate-500 hover:border-[#0f2a52] hover:text-[#0f2a52]">
                  + Bu bölüme soru ekle
                </button>
              </>
            ) : (
              <div className="rounded-xl border border-slate-300 bg-white p-10 text-center text-lg font-bold text-slate-500">Soldan bir bölüm seçin ya da yeni bölüm ekleyin.</div>
            )}
          </main>
        </div>
      )}
    </div>
  )
}
