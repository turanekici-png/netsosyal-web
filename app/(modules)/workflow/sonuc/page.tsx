'use client'

import { useEffect, useMemo, useState } from 'react'
import { useTabs } from '@/lib/context/TabContext'
import { foldTurkish, formatFileNo } from '@/lib/utils'
import { confirmDialog } from '@/components/shared/GlobalConfirmDialog'
import {
  PRELIMINARY_REVIEW_FORM_TEMPLATE_SETTING_KEY,
  type PreliminaryReviewFormTemplate,
} from '@/lib/constants/preliminaryReviewForm'

// İş Akışı > İnceleme Formları (2026-10-15 kurumsal tur): yapilan TUM Ön
// İnceleme, Tahkikat ve Sonuç Bekleyen (komisyon) raporlari dosyaya gore
// gruplu ya da tek liste; dosya no / ad soyad / TC / telefon ile aranir,
// her raporun formu sayfadan cikmadan goruntulenir. Duzenle/Sil islevleri
// onceki surumle AYNI API'leri kullanir. Veri: /api/workflow/sonuc-raporu.

type Tur = 'onInceleme' | 'inceleme' | 'guncelleme'

type HamOrtak = {
  id: string
  dosyaid: string | null
  dosyaNo: string | null
  dosyaSahibi: string | null
  telefon: string | null
  adres: string | null
  islemYapan: string | null
  islemtarihi: string | null
}
type GuncellemeRow = HamOrtak & { formTarihi: string | null; sonuc: string | null; aciklama: string | null }
type OnIncelemeRow = HamOrtak & { tarih: string | null; sonuc: string | null; aciklama: string | null; cevaplar: Record<string, string> | null }
type IncelemeRow = HamOrtak & {
  formTarihi: string | null
  adSoyad: string | null
  ziyaretSonucu: string | null
  aciliyet: string | null
  oncelikliIhtiyac: string | null
  onDegerlendirme: string | null
  ozet: string | null
}
type SummaryData = {
  totals: { guncelleme: number; onInceleme: number; inceleme: number; all: number }
  bySonuc: Array<{ type: string; sonuc: string; count: number }>
}

// Birlesik satir: her turden rapor tek bicimde
type Rapor = {
  anahtar: string
  id: string
  tur: Tur
  tarih: string | null
  islemZamani: string | null
  dosyaid: string | null
  dosyaNo: string | null
  dosyaSahibi: string | null
  telefon: string | null
  adres: string | null
  sonuc: string | null
  aciklama: string | null
  islemYapan: string | null
}

// Is Akisi renkleri (menu ve form sekmeleriyle ayni)
const TUR: Record<Tur, { ad: string; rozet: string; serit: string; nokta: string; kart: string }> = {
  onInceleme: { ad: 'Ön İnceleme', rozet: 'bg-amber-100 text-amber-900 ring-amber-300', serit: 'border-l-amber-400', nokta: 'bg-amber-400', kart: 'bg-amber-500' },
  inceleme: { ad: 'Tahkikat', rozet: 'bg-orange-100 text-orange-900 ring-orange-300', serit: 'border-l-orange-500', nokta: 'bg-orange-500', kart: 'bg-orange-600' },
  guncelleme: { ad: 'Sonuç Bekleyen', rozet: 'bg-blue-100 text-blue-900 ring-blue-300', serit: 'border-l-blue-600', nokta: 'bg-blue-600', kart: 'bg-blue-600' },
}
const TUR_SIRASI: Tur[] = ['onInceleme', 'inceleme', 'guncelleme']

function sonucRozeti(sonuc: string) {
  const n = foldTurkish(sonuc)
  if (n.includes('uygun degil') || n.includes('iptal') || n.includes('yapilamaz') || n.startsWith('acil')) return 'bg-rose-50 text-rose-800 ring-rose-200'
  if (n.includes('oncelikli')) return 'bg-amber-50 text-amber-800 ring-amber-200'
  if (n.includes('rutin') || n.includes('belirtilmemis')) return 'bg-slate-100 text-slate-700 ring-slate-200'
  return 'bg-emerald-50 text-emerald-800 ring-emerald-200'
}

function tarihMetni(value: string | null) {
  if (!value) return '-'
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? value : d.toLocaleDateString('tr-TR')
}
function zamanMetni(value: string | null) {
  if (!value) return '-'
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? value : d.toLocaleString('tr-TR', { dateStyle: 'short', timeStyle: 'short' })
}
function isoGunOnce(gun: number) {
  const d = new Date()
  d.setDate(d.getDate() - gun)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
const bugun = () => isoGunOnce(0)
const yilBasi = () => `${new Date().getFullYear()}-01-01`

type Gorunum = 'dosya' | 'liste' | 'ozet'

export default function InclemeFormlariPage() {
  const { addTab } = useTabs()
  const [gorunum, setGorunum] = useState<Gorunum>('dosya')
  const [turFiltresi, setTurFiltresi] = useState<Tur | 'hepsi'>('hepsi')
  const [baslangic, setBaslangic] = useState(isoGunOnce(30))
  const [bitis, setBitis] = useState(bugun())
  const [aramaKutusu, setAramaKutusu] = useState('')
  const [arama, setArama] = useState('')

  const [guncelleme, setGuncelleme] = useState<GuncellemeRow[]>([])
  const [onInceleme, setOnInceleme] = useState<OnIncelemeRow[]>([])
  const [inceleme, setInceleme] = useState<IncelemeRow[]>([])
  const [ozet, setOzet] = useState<SummaryData | null>(null)
  const [yukleniyor, setYukleniyor] = useState(true)
  const [hata, setHata] = useState('')
  const [islemHatasi, setIslemHatasi] = useState('')
  const [onIncelemeSablonu, setOnIncelemeSablonu] = useState<PreliminaryReviewFormTemplate>([])

  // Yazmayi bitirince ara (her harfte sunucuya gitmesin)
  useEffect(() => {
    const t = window.setTimeout(() => setArama(aramaKutusu.trim()), 400)
    return () => window.clearTimeout(t)
  }, [aramaKutusu])

  useEffect(() => {
    const controller = new AbortController()
    // eslint-disable-next-line react-hooks/set-state-in-effect -- veri yukleme efekti
    setYukleniyor(true)
    setHata('')
    const q = new URLSearchParams()
    if (baslangic) q.set('dateFrom', baslangic)
    if (bitis) q.set('dateTo', bitis)
    if (arama) q.set('search', arama)
    const al = (tip: string) => fetch(`/api/workflow/sonuc-raporu?type=${tip}&${q.toString()}`, { signal: controller.signal, cache: 'no-store' }).then((r) => r.json())
    Promise.all([al('guncelleme'), al('on-inceleme'), al('inceleme'), al('summary')])
      .then(([g, o, i, s]) => {
        if (!g.success || !o.success || !i.success || !s.success) throw new Error(g.error || o.error || i.error || s.error || 'Rapor alınamadı.')
        setGuncelleme(g.data)
        setOnInceleme(o.data)
        setInceleme(i.data)
        setOzet(s.data)
      })
      .catch((err) => {
        if (err?.name === 'AbortError') return
        setHata(err instanceof Error ? err.message : 'Rapor alınamadı.')
      })
      .finally(() => setYukleniyor(false))
    return () => controller.abort()
  }, [baslangic, bitis, arama])

  useEffect(() => {
    fetch(`/api/settings/${PRELIMINARY_REVIEW_FORM_TEMPLATE_SETTING_KEY}`, { cache: 'no-store' })
      .then((r) => r.json())
      .then((p) => { if (Array.isArray(p?.data?.value)) setOnIncelemeSablonu(p.data.value) })
      .catch(() => {})
  }, [])

  const raporlar: Rapor[] = useMemo(() => [
    ...onInceleme.map((r): Rapor => ({ anahtar: `o-${r.id}`, id: r.id, tur: 'onInceleme', tarih: r.tarih, islemZamani: r.islemtarihi, dosyaid: r.dosyaid, dosyaNo: r.dosyaNo, dosyaSahibi: r.dosyaSahibi, telefon: r.telefon, adres: r.adres, sonuc: r.sonuc, aciklama: r.aciklama, islemYapan: r.islemYapan })),
    ...inceleme.map((r): Rapor => ({ anahtar: `i-${r.id}`, id: r.id, tur: 'inceleme', tarih: r.formTarihi, islemZamani: r.islemtarihi, dosyaid: r.dosyaid, dosyaNo: r.dosyaNo, dosyaSahibi: r.dosyaSahibi || r.adSoyad, telefon: r.telefon, adres: r.adres, sonuc: r.ziyaretSonucu || (r.aciliyet ? `Aciliyet: ${r.aciliyet}` : null), aciklama: r.ozet || r.onDegerlendirme, islemYapan: r.islemYapan })),
    ...guncelleme.map((r): Rapor => ({ anahtar: `g-${r.id}`, id: r.id, tur: 'guncelleme', tarih: r.formTarihi, islemZamani: r.islemtarihi, dosyaid: r.dosyaid, dosyaNo: r.dosyaNo, dosyaSahibi: r.dosyaSahibi, telefon: r.telefon, adres: r.adres, sonuc: r.sonuc, aciklama: r.aciklama, islemYapan: r.islemYapan })),
  ].sort((a, b) => (b.tarih || '').localeCompare(a.tarih || '') || (b.islemZamani || '').localeCompare(a.islemZamani || '')), [onInceleme, inceleme, guncelleme])

  const gorunenRaporlar = useMemo(() => (turFiltresi === 'hepsi' ? raporlar : raporlar.filter((r) => r.tur === turFiltresi)), [raporlar, turFiltresi])

  const sayilar = useMemo(() => ({ onInceleme: onInceleme.length, inceleme: inceleme.length, guncelleme: guncelleme.length }), [onInceleme, inceleme, guncelleme])

  const gruplar = useMemo(() => {
    const map = new Map<string, { dosyaid: string | null; dosyaNo: string | null; dosyaSahibi: string | null; telefon: string | null; adres: string | null; raporlar: Rapor[] }>()
    for (const r of gorunenRaporlar) {
      const k = r.dosyaid || r.dosyaNo || r.anahtar
      const g = map.get(k)
      if (g) {
        g.raporlar.push(r)
        g.dosyaSahibi ||= r.dosyaSahibi
        g.telefon ||= r.telefon
        g.adres ||= r.adres
      } else map.set(k, { dosyaid: r.dosyaid, dosyaNo: r.dosyaNo, dosyaSahibi: r.dosyaSahibi, telefon: r.telefon, adres: r.adres, raporlar: [r] })
    }
    return [...map.values()]
  }, [gorunenRaporlar])

  // ---- Islemler (onceki surumle ayni API'ler) ------------------------------
  const dosyayiAc = (dosyaid: string | null, dosyaNo: string | null) => {
    if (!dosyaid) return
    addTab({ title: dosyaNo ? `Dosya ${formatFileNo(dosyaNo)}` : 'Dosya', path: `/documents?fileId=${dosyaid}` })
  }

  const sil = async (r: Rapor) => {
    const ad = TUR[r.tur].ad
    if (!(await confirmDialog(`Bu ${ad} kaydını (Dosya ${formatFileNo(r.dosyaNo) || r.dosyaid}) KALICI olarak silmek istediğinize emin misiniz?`, 'Evet, Sil', 'Vazgeç'))) return
    setIslemHatasi('')
    try {
      const url = r.tur === 'guncelleme' ? `/api/reports/${r.id}`
        : r.tur === 'onInceleme' ? `/api/workflow/on-inceleme/report?id=${encodeURIComponent(r.id)}`
          : `/api/documents/saha-inceleme/${r.id}`
      const res = await fetch(url, { method: 'DELETE' })
      const p = await res.json()
      if (!res.ok || !p.success) throw new Error(p.error || 'Kayıt silinemedi.')
      if (r.tur === 'guncelleme') setGuncelleme((x) => x.filter((y) => y.id !== r.id))
      else if (r.tur === 'onInceleme') setOnInceleme((x) => x.filter((y) => y.id !== r.id))
      else setInceleme((x) => x.filter((y) => y.id !== r.id))
      if (goruntulenen?.anahtar === r.anahtar) setGoruntulenen(null)
    } catch (err) {
      setIslemHatasi(err instanceof Error ? err.message : 'Kayıt silinemedi.')
    }
  }

  // Duzenleme (Ön İnceleme: tarih + aciklama; Sonuç Bekleyen: tarih + konu + rapor)
  const [duzenlenen, setDuzenlenen] = useState<Rapor | null>(null)
  const [duzenForm, setDuzenForm] = useState({ tarih: '', konu: '', metin: '' })
  const [duzenDurum, setDuzenDurum] = useState<'idle' | 'saving'>('idle')
  const [duzenHata, setDuzenHata] = useState('')

  const duzenlemeAc = (r: Rapor) => {
    setDuzenlenen(r)
    setDuzenForm({ tarih: (r.tarih || '').slice(0, 10), konu: r.tur === 'guncelleme' ? r.sonuc || '' : '', metin: r.aciklama || '' })
    setDuzenHata('')
  }

  const duzenlemeKaydet = async () => {
    if (!duzenlenen) return
    setDuzenDurum('saving')
    setDuzenHata('')
    try {
      if (duzenlenen.tur === 'onInceleme') {
        const res = await fetch('/api/workflow/on-inceleme/report', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: duzenlenen.id, date: duzenForm.tarih, aciklama: duzenForm.metin }),
        })
        const p = await res.json()
        if (!res.ok || !p.success) throw new Error(p.error || 'Rapor güncellenemedi.')
        setOnInceleme((x) => x.map((y) => (y.id === duzenlenen.id ? { ...y, tarih: duzenForm.tarih, aciklama: duzenForm.metin } : y)))
      } else {
        if (!duzenForm.konu.trim() || !duzenForm.metin.trim()) throw new Error('Konu ve rapor alanları zorunludur.')
        const res = await fetch(`/api/reports/${duzenlenen.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ date: duzenForm.tarih ? new Date(duzenForm.tarih) : undefined, title: duzenForm.konu, content: duzenForm.metin }),
        })
        const p = await res.json()
        if (!res.ok || !p.success) throw new Error(p.error || 'Rapor güncellenemedi.')
        setGuncelleme((x) => x.map((y) => (y.id === duzenlenen.id ? { ...y, formTarihi: duzenForm.tarih, sonuc: duzenForm.konu, aciklama: duzenForm.metin } : y)))
      }
      setDuzenlenen(null)
    } catch (err) {
      setDuzenHata(err instanceof Error ? err.message : 'Rapor güncellenemedi.')
    } finally {
      setDuzenDurum('idle')
    }
  }

  // Formu goruntule (sayfadan cikmadan)
  const [goruntulenen, setGoruntulenen] = useState<Rapor | null>(null)
  const goruntulenenOnInceleme = goruntulenen?.tur === 'onInceleme' ? onInceleme.find((x) => x.id === goruntulenen.id) : undefined

  const ozetKartlari: Array<{ id: Tur | 'hepsi'; ad: string; deger: number; serit: string }> = [
    { id: 'hepsi', ad: 'Tüm Raporlar', deger: raporlar.length, serit: 'bg-[#0a3a57]' },
    ...TUR_SIRASI.map((t) => ({ id: t, ad: TUR[t].ad, deger: sayilar[t], serit: TUR[t].kart })),
  ]

  const tarihButonu = 'h-10 rounded-lg border border-slate-300 bg-white px-3 text-sm font-black text-slate-700 transition hover:border-[#0a3a57] hover:text-[#0a3a57] lg:text-base'

  const raporSatiri = (r: Rapor, dosyaBilgisi: boolean) => (
    <div key={r.anahtar} className={`flex flex-col gap-2 border-l-4 bg-white px-4 py-3 transition hover:bg-slate-50 lg:flex-row lg:items-start lg:justify-between ${TUR[r.tur].serit}`}>
      <div className="min-w-0 flex-1 space-y-1.5">
        <div className="flex flex-wrap items-center gap-2">
          <span className={`rounded-full px-2.5 py-0.5 text-sm font-black ring-1 lg:text-base ${TUR[r.tur].rozet}`}>{TUR[r.tur].ad}</span>
          <span className="text-sm font-black text-slate-700 lg:text-base">{tarihMetni(r.tarih)}</span>
          {r.sonuc && <span className={`rounded-full px-2.5 py-0.5 text-sm font-bold ring-1 lg:text-base ${sonucRozeti(r.sonuc)}`}>{r.sonuc}</span>}
          {dosyaBilgisi && (
            <button type="button" onClick={() => dosyayiAc(r.dosyaid, r.dosyaNo)} className="rounded-md bg-slate-100 px-2 py-0.5 font-mono text-sm font-black text-[#0a3a57] hover:bg-slate-200 lg:text-base">
              {formatFileNo(r.dosyaNo) || `#${r.dosyaid}`}
            </button>
          )}
          {dosyaBilgisi && r.dosyaSahibi && <span className="text-sm font-black text-slate-900 lg:text-base">{r.dosyaSahibi}</span>}
        </div>
        {r.aciklama && <p className="line-clamp-2 text-sm font-medium leading-relaxed text-slate-600 lg:text-base">{r.aciklama}</p>}
        <p className="text-xs font-semibold text-slate-400 lg:text-sm">
          İşlemi yapan: <span className="font-bold text-slate-600">{r.islemYapan || '—'}</span>
          {r.islemZamani && <> · {zamanMetni(r.islemZamani)}</>}
        </p>
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-1.5">
        <button type="button" onClick={() => setGoruntulenen(r)} className="rounded-lg bg-[#0a3a57] px-3 py-1.5 text-sm font-black text-white hover:bg-[#0d4f6e] lg:text-base">
          Formu Görüntüle
        </button>
        {r.tur !== 'inceleme' && (
          <button type="button" onClick={() => duzenlemeAc(r)} className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-black text-slate-700 hover:bg-slate-100 lg:text-base">
            Düzenle
          </button>
        )}
        <button type="button" onClick={() => void sil(r)} className="rounded-lg border border-rose-200 bg-white px-3 py-1.5 text-sm font-black text-rose-600 hover:bg-rose-50 lg:text-base">
          Sil
        </button>
      </div>
    </div>
  )

  return (
    <div className="ns-yazi-masaustu space-y-4 text-slate-950">
      <div className="ns-sayfa-baslik relative overflow-hidden rounded-xl border-b-4 border-[#c9a227] p-6 text-white shadow-sm">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-sm font-bold uppercase tracking-[0.18em] text-[#e8cf7a]">İş Akışı</p>
            <h1 className="mt-1 text-3xl font-black leading-tight">İnceleme Formları</h1>
            <p className="mt-1 max-w-3xl text-base font-semibold text-white/80">
              Ön İnceleme, Tahkikat ve Sonuç Bekleyen raporları. Dosya no, ad soyad, TC veya telefonla arayın; formu sayfadan çıkmadan görüntüleyin.
            </p>
          </div>
        </div>
      </div>

      {/* Ozet kartlari = tur filtresi */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {ozetKartlari.map((k) => {
          const secili = turFiltresi === k.id
          return (
            <button
              key={k.id}
              type="button"
              onClick={() => setTurFiltresi(k.id === turFiltresi && k.id !== 'hepsi' ? 'hepsi' : k.id)}
              className={`relative overflow-hidden rounded-lg border bg-white py-3 pl-5 pr-4 text-left shadow-sm transition hover:shadow ${secili ? 'border-[#0a3a57] ring-2 ring-[#0a3a57]/20' : 'border-slate-200'}`}
            >
              <span className={`absolute inset-y-0 left-0 w-1.5 ${k.serit}`} />
              <p className="text-sm font-black uppercase tracking-wide text-slate-500">{k.ad}</p>
              <p className="mt-1 text-3xl font-black text-[#0a3a57]">{yukleniyor ? '…' : k.deger.toLocaleString('tr-TR')}</p>
            </button>
          )
        })}
      </div>

      {/* Arama + tarih */}
      <div className="space-y-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="relative">
          <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" className="pointer-events-none absolute left-3.5 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400" aria-hidden>
            <circle cx="9" cy="9" r="6" /><path d="M17 17l-3.5-3.5" strokeLinecap="round" />
          </svg>
          <input
            value={aramaKutusu}
            onChange={(e) => setAramaKutusu(e.target.value)}
            placeholder="Dosya no, ad soyad, TC kimlik no veya telefon ile ara..."
            className="h-12 w-full rounded-lg border-2 border-slate-200 bg-slate-50 pl-11 pr-4 text-base font-semibold outline-none transition focus:border-[#0a3a57] focus:bg-white lg:text-lg"
          />
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <label className="block">
            <span className="mb-1 block text-xs font-black uppercase tracking-wide text-slate-500 lg:text-sm">Başlangıç</span>
            <input type="date" value={baslangic} onChange={(e) => setBaslangic(e.target.value)} className="h-10 rounded-lg border border-slate-300 bg-slate-50 px-3 text-sm font-semibold outline-none focus:border-[#0a3a57] lg:text-base" />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-black uppercase tracking-wide text-slate-500 lg:text-sm">Bitiş</span>
            <input type="date" value={bitis} onChange={(e) => setBitis(e.target.value)} className="h-10 rounded-lg border border-slate-300 bg-slate-50 px-3 text-sm font-semibold outline-none focus:border-[#0a3a57] lg:text-base" />
          </label>
          <button type="button" onClick={() => { setBaslangic(bugun()); setBitis(bugun()) }} className={tarihButonu}>Bugün</button>
          <button type="button" onClick={() => { setBaslangic(isoGunOnce(7)); setBitis(bugun()) }} className={tarihButonu}>Son 7 Gün</button>
          <button type="button" onClick={() => { setBaslangic(isoGunOnce(30)); setBitis(bugun()) }} className={tarihButonu}>Son 30 Gün</button>
          <button type="button" onClick={() => { setBaslangic(yilBasi()); setBitis(bugun()) }} className={tarihButonu}>Bu Yıl</button>
          <button type="button" onClick={() => { setBaslangic(''); setBitis('') }} className={tarihButonu}>Tüm Zamanlar</button>
          {(aramaKutusu || turFiltresi !== 'hepsi') && (
            <button type="button" onClick={() => { setAramaKutusu(''); setTurFiltresi('hepsi') }} className="h-10 rounded-lg border border-rose-200 bg-white px-3 text-sm font-black text-rose-600 hover:bg-rose-50 lg:text-base">
              Filtreleri Temizle
            </button>
          )}
          <div className="ml-auto inline-flex overflow-hidden rounded-lg border border-slate-300 bg-slate-50 p-1">
            {([['dosya', 'Dosyaya Göre'], ['liste', 'Liste'], ['ozet', 'Özet']] as Array<[Gorunum, string]>).map(([id, ad]) => (
              <button
                key={id}
                type="button"
                onClick={() => setGorunum(id)}
                className={`rounded-md px-4 py-1.5 text-sm font-black transition lg:text-base ${gorunum === id ? 'bg-[#0a3a57] text-white shadow' : 'text-slate-600 hover:bg-white'}`}
              >
                {ad}
              </button>
            ))}
          </div>
        </div>
      </div>

      {hata && <div className="rounded-lg border border-rose-200 bg-rose-50 p-4 text-base font-bold text-rose-700">{hata}</div>}
      {islemHatasi && <div className="rounded-lg border border-rose-200 bg-rose-50 p-4 text-base font-bold text-rose-700">{islemHatasi}</div>}

      {yukleniyor ? (
        <div className="rounded-xl border border-slate-200 bg-white p-12 text-center text-base font-bold text-slate-500 shadow-sm">Raporlar yükleniyor...</div>
      ) : gorunum === 'dosya' ? (
        gruplar.length === 0 ? (
          <div className="rounded-xl border border-slate-200 bg-white p-12 text-center text-base font-bold text-slate-500 shadow-sm">Bu arama ve tarih aralığında rapor bulunamadı.</div>
        ) : (
          <div className="space-y-3">
            <p className="text-sm font-bold text-slate-500 lg:text-base">{gruplar.length.toLocaleString('tr-TR')} dosya · {gorunenRaporlar.length.toLocaleString('tr-TR')} rapor</p>
            {gruplar.map((g) => {
              const turSayilari = TUR_SIRASI.map((t) => [t, g.raporlar.filter((r) => r.tur === t).length] as const).filter(([, n]) => n > 0)
              return (
                <section key={g.dosyaid || g.dosyaNo || g.raporlar[0].anahtar} className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
                  <div className="flex flex-col gap-2 border-b-2 border-[#c9a227] bg-gradient-to-r from-[#0a3a57] to-[#0d4f6e] px-4 py-3 text-white lg:flex-row lg:items-center lg:justify-between">
                    <div className="flex min-w-0 flex-wrap items-center gap-3">
                      <button
                        type="button"
                        onClick={() => dosyayiAc(g.dosyaid, g.dosyaNo)}
                        title="Dosyayı aç"
                        className="rounded-md bg-[#c9a227] px-3 py-1 font-mono text-base font-black text-[#0a3a57] hover:bg-[#d8b440] lg:text-lg"
                      >
                        {formatFileNo(g.dosyaNo) || `#${g.dosyaid}`}
                      </button>
                      <span className="text-lg font-black lg:text-xl">{g.dosyaSahibi || 'Ad soyad belirtilmemiş'}</span>
                      <span className="text-sm font-semibold text-white/70 lg:text-base">
                        {[g.telefon, g.adres].filter(Boolean).join(' · ')}
                      </span>
                    </div>
                    <div className="flex shrink-0 flex-wrap gap-1.5">
                      {turSayilari.map(([t, n]) => (
                        <span key={t} className="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-2.5 py-0.5 text-sm font-black ring-1 ring-white/25 lg:text-base">
                          <span className={`h-2.5 w-2.5 rounded-full ${TUR[t].nokta}`} />{TUR[t].ad} {n}
                        </span>
                      ))}
                    </div>
                  </div>
                  <div className="divide-y divide-slate-100">{g.raporlar.map((r) => raporSatiri(r, false))}</div>
                </section>
              )
            })}
          </div>
        )
      ) : gorunum === 'liste' ? (
        <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b-2 border-[#c9a227] bg-gradient-to-r from-[#0a3a57] to-[#0d4f6e] px-4 py-3 text-white">
            <h2 className="text-lg font-black lg:text-xl">Tüm Raporlar</h2>
            <p className="text-sm font-semibold text-white/75">{gorunenRaporlar.length.toLocaleString('tr-TR')} rapor, en yeniden eskiye</p>
          </div>
          {gorunenRaporlar.length === 0 ? (
            <div className="p-12 text-center text-base font-bold text-slate-500">Bu arama ve tarih aralığında rapor bulunamadı.</div>
          ) : (
            <div className="divide-y divide-slate-100">{gorunenRaporlar.map((r) => raporSatiri(r, true))}</div>
          )}
        </section>
      ) : (
        <div className="grid gap-4 lg:grid-cols-3">
          {TUR_SIRASI.map((t) => {
            const turAdi = TUR[t].ad
            const satirlar = (ozet?.bySonuc ?? []).filter((x) => x.type === turAdi)
            const toplam = t === 'onInceleme' ? ozet?.totals.onInceleme : t === 'inceleme' ? ozet?.totals.inceleme : ozet?.totals.guncelleme
            const enBuyuk = Math.max(1, ...satirlar.map((x) => x.count))
            return (
              <section key={t} className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
                <div className={`flex items-center justify-between px-4 py-3 text-white ${TUR[t].kart}`}>
                  <h2 className="text-lg font-black">{turAdi}</h2>
                  <span className="rounded-full bg-white/20 px-3 py-0.5 text-base font-black">{(toplam ?? 0).toLocaleString('tr-TR')}</span>
                </div>
                <div className="space-y-2.5 p-4">
                  {satirlar.length === 0 ? (
                    <p className="text-base font-bold text-slate-400">Kayıt yok.</p>
                  ) : satirlar.map((x) => (
                    <div key={x.sonuc}>
                      <div className="flex items-center justify-between gap-2 text-sm font-bold text-slate-700 lg:text-base">
                        <span className="truncate">{x.sonuc}</span>
                        <span className="font-black tabular-nums text-[#0a3a57]">{x.count.toLocaleString('tr-TR')}</span>
                      </div>
                      <div className="mt-1 h-2 overflow-hidden rounded-full bg-slate-100">
                        <span className={`block h-full ${TUR[t].nokta}`} style={{ width: `${(x.count / enBuyuk) * 100}%` }} />
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            )
          })}
        </div>
      )}

      {/* Formu goruntule */}
      {goruntulenen && (
        <div className="fixed inset-0 z-[2200] flex items-center justify-center bg-slate-950/70 p-2 backdrop-blur-sm md:p-4" onClick={() => setGoruntulenen(null)}>
          <div className="flex max-h-[94vh] w-full max-w-5xl flex-col overflow-hidden rounded-xl border border-slate-300 bg-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex shrink-0 items-start justify-between gap-3 border-b-4 border-[#c9a227] bg-gradient-to-r from-[#0a3a57] to-[#0d4f6e] px-5 py-4 text-white">
              <div className="min-w-0">
                <p className="text-sm font-bold uppercase tracking-[0.14em] text-[#e8cf7a]">{TUR[goruntulenen.tur].ad} · {tarihMetni(goruntulenen.tarih)}</p>
                <h3 className="mt-0.5 truncate text-xl font-black">
                  Dosya {formatFileNo(goruntulenen.dosyaNo) || goruntulenen.dosyaid}{goruntulenen.dosyaSahibi ? ` — ${goruntulenen.dosyaSahibi}` : ''}
                </h3>
              </div>
              <div className="flex shrink-0 gap-2">
                {goruntulenen.tur === 'inceleme' && (
                  <button type="button" onClick={() => window.open(`/api/documents/saha-inceleme/yazdir?id=${encodeURIComponent(goruntulenen.id)}&yazdir=1`, '_blank', 'noopener,noreferrer')} className="rounded-lg bg-[#c9a227] px-3 py-1.5 text-sm font-black text-[#0a3a57] hover:bg-[#d8b440]">
                    Yazdır
                  </button>
                )}
                <button type="button" onClick={() => dosyayiAc(goruntulenen.dosyaid, goruntulenen.dosyaNo)} className="rounded-lg border border-white/30 bg-white/10 px-3 py-1.5 text-sm font-black hover:bg-white/20">
                  Dosyayı Aç
                </button>
                <button type="button" onClick={() => setGoruntulenen(null)} className="rounded-lg border border-white/30 bg-white/10 px-3 py-1.5 text-sm font-black hover:bg-rose-600">✕</button>
              </div>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto bg-slate-50">
              {goruntulenen.tur === 'inceleme' ? (
                <iframe
                  title="Tahkikat formu"
                  src={`/api/documents/saha-inceleme/yazdir?id=${encodeURIComponent(goruntulenen.id)}`}
                  className="h-[78vh] w-full border-0 bg-white"
                />
              ) : (
                <div className="space-y-4 p-5">
                  <div className="grid gap-3 sm:grid-cols-3">
                    {[
                      ['Tarih', tarihMetni(goruntulenen.tarih)],
                      [goruntulenen.tur === 'guncelleme' ? 'Konu' : 'Sonuç', goruntulenen.sonuc || '—'],
                      ['İşlemi Yapan', goruntulenen.islemYapan || '—'],
                    ].map(([e, d]) => (
                      <div key={e} className="rounded-lg border border-slate-200 bg-white px-4 py-3">
                        <p className="text-xs font-black uppercase tracking-wide text-slate-500 lg:text-sm">{e}</p>
                        <p className="mt-1 text-base font-black text-slate-900 lg:text-lg">{d}</p>
                      </div>
                    ))}
                  </div>
                  {goruntulenen.tur === 'onInceleme' && (
                    <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
                      <div className="border-b border-slate-200 bg-amber-50 px-4 py-2 text-sm font-black uppercase tracking-wide text-amber-900 lg:text-base">Ön İnceleme Cevapları</div>
                      {(() => {
                        const cevaplar = goruntulenenOnInceleme?.cevaplar ?? {}
                        const anahtarlar = Object.keys(cevaplar)
                        if (anahtarlar.length === 0) return <p className="px-4 py-3 text-base font-semibold text-slate-400">Cevap girilmemiş.</p>
                        // Sablon sirasiyla; sablonda olmayan (eski) sorular sonda
                        const sirali = [
                          ...onIncelemeSablonu.filter((s) => s.id in cevaplar).map((s) => ({ id: s.id, etiket: s.label })),
                          ...anahtarlar.filter((k) => !onIncelemeSablonu.some((s) => s.id === k)).map((k) => ({ id: k, etiket: k })),
                        ]
                        return (
                          <dl className="divide-y divide-slate-100">
                            {sirali.map((s) => (
                              <div key={s.id} className="grid gap-1 px-4 py-2.5 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
                                <dt className="text-sm font-bold text-slate-500 lg:text-base">{s.etiket}</dt>
                                <dd className="text-base font-semibold text-slate-900 lg:text-lg">{String(cevaplar[s.id] ?? '')}</dd>
                              </div>
                            ))}
                          </dl>
                        )
                      })()}
                    </div>
                  )}
                  <div className="rounded-lg border border-slate-200 bg-white">
                    <div className="border-b border-slate-200 bg-slate-100 px-4 py-2 text-sm font-black uppercase tracking-wide text-slate-700 lg:text-base">
                      {goruntulenen.tur === 'guncelleme' ? 'Komisyon Raporu' : 'Açıklama'}
                    </div>
                    <p className="whitespace-pre-wrap px-4 py-3 text-base font-medium leading-relaxed text-slate-800 lg:text-lg">{goruntulenen.aciklama || '—'}</p>
                  </div>
                </div>
              )}
            </div>
            {goruntulenen.tur !== 'inceleme' && (
              <div className="flex shrink-0 justify-end gap-2 border-t border-slate-200 bg-white px-5 py-3">
                <button type="button" onClick={() => { const r = goruntulenen; setGoruntulenen(null); duzenlemeAc(r) }} className="rounded-lg bg-[#0a3a57] px-4 py-2 text-sm font-black text-white hover:bg-[#0d4f6e] lg:text-base">Düzenle</button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Duzenleme */}
      {duzenlenen && (
        <div className="fixed inset-0 z-[2300] flex items-center justify-center bg-slate-950/60 p-3 backdrop-blur-sm">
          <div className="w-full max-w-2xl overflow-hidden rounded-xl border border-slate-300 bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b-4 border-[#c9a227] bg-gradient-to-r from-[#0a3a57] to-[#0d4f6e] px-5 py-4 text-white">
              <div>
                <h3 className="text-lg font-black">{TUR[duzenlenen.tur].ad} Raporunu Düzenle</h3>
                <p className="text-sm font-semibold text-white/75">Dosya {formatFileNo(duzenlenen.dosyaNo) || duzenlenen.dosyaid}</p>
              </div>
              <button type="button" onClick={() => duzenDurum !== 'saving' && setDuzenlenen(null)} className="rounded-lg px-2.5 py-1 text-lg font-black text-white/80 hover:bg-white/10">✕</button>
            </div>
            <div className="space-y-3 p-5">
              {duzenHata && <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-bold text-rose-700">{duzenHata}</div>}
              <label className="block">
                <span className="mb-1 block text-sm font-black uppercase tracking-wide text-slate-600">Tarih</span>
                <input type="date" value={duzenForm.tarih} onChange={(e) => setDuzenForm((c) => ({ ...c, tarih: e.target.value }))} className="h-11 w-full rounded-lg border border-slate-300 px-3 text-base font-semibold outline-none focus:border-[#0a3a57]" />
              </label>
              {duzenlenen.tur === 'guncelleme' && (
                <label className="block">
                  <span className="mb-1 block text-sm font-black uppercase tracking-wide text-slate-600">Konu</span>
                  <input value={duzenForm.konu} onChange={(e) => setDuzenForm((c) => ({ ...c, konu: e.target.value }))} className="h-11 w-full rounded-lg border border-slate-300 px-3 text-base font-semibold outline-none focus:border-[#0a3a57]" />
                </label>
              )}
              <label className="block">
                <span className="mb-1 block text-sm font-black uppercase tracking-wide text-slate-600">{duzenlenen.tur === 'onInceleme' ? 'Açıklama' : 'Rapor'}</span>
                <textarea rows={8} value={duzenForm.metin} onChange={(e) => setDuzenForm((c) => ({ ...c, metin: e.target.value }))} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-base font-medium leading-relaxed outline-none focus:border-[#0a3a57]" />
              </label>
            </div>
            <div className="flex justify-end gap-2 border-t border-slate-200 bg-slate-50 px-5 py-3">
              <button type="button" onClick={() => setDuzenlenen(null)} disabled={duzenDurum === 'saving'} className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-base font-black text-slate-700 hover:bg-slate-100 disabled:opacity-60">Vazgeç</button>
              <button type="button" onClick={() => void duzenlemeKaydet()} disabled={duzenDurum === 'saving'} className="rounded-lg bg-[#0a3a57] px-5 py-2 text-base font-black text-white hover:bg-[#0d4f6e] disabled:opacity-60">
                {duzenDurum === 'saving' ? 'Kaydediliyor...' : 'Kaydet'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
