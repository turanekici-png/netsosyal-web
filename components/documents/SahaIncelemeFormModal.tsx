'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useHoldWorkflowRecord } from '@/lib/hooks/useWorkflowPresence'
import {
  anahtarliCevap,
  bosMu,
  eksikZorunluSorular,
  ziyaretGerceklesmediMi,
  cevapMetni,
  ozetRaporuUret,
  ozetRaporCumleleri,
  birlesikRaporUret,
  haneAnalizi,
  haneSutunlari,
  calisabilirMi,
  GELIR_KAYNAGI_METNI,
  imzaDuzeni,
  type CevapDegeri,
  type Cevaplar,
  type HaneUyesi,
  type SahaIncelemeDetay,
  type Sablon,
  type Soru,
  type TabloSatiri,
  type TabloSutunu,
} from '@/lib/constants/sahaIncelemeForm'
import SahaIncelemeGecmisiPaneli, { ACILIYET_SINIFLARI } from './SahaIncelemeGecmisiPaneli'
import MikrofonButonu from './MikrofonButonu'
import ImzaAlani from './ImzaAlani'

// Tabloya "Adres" basligiyla eklenen metin sutunu (10px, icerige gore uzar).
const adresSutunuMu = (sutun: TabloSutunu) => sutun.tur !== 'secim' && sutun.baslik.toLocaleLowerCase('tr-TR').includes('adres')

// Adres sorusu: otomatik dolumu "adres" ya da metninde "adres" gecen metin sorusu.
const adresSorusuMu = (soru: Soru) =>
  (soru.tur === 'metin' || soru.tur === 'uzun_metin')
  && (soru.otomatik === 'adres' || (!soru.otomatik && soru.soruMetni.toLocaleLowerCase('tr-TR').includes('adres')))

// Adres alani (kullanici istegi 2026-10-13): tek satir, adresin tamami alana
// sigacak sekilde yazi boyutunu alan genisligi belirler (en fazla 14px,
// en az 8px). Alan genisligi degisince (pencere/zoom) yeniden hesaplanir.
function AdresAlani({ value, onChange, className = 'sf-input sf-adres', enFazla = 14, enAz = 8 }: {
  value: string
  onChange: (v: string) => void
  className?: string
  enFazla?: number
  enAz?: number
}) {
  const ref = useRef<HTMLInputElement>(null)
  const [genislik, setGenislik] = useState(0)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const olc = () => setGenislik(el.clientWidth)
    olc()
    const ro = new ResizeObserver(olc)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  const ENFAZLA = enFazla
  const ENAZ = enAz
  let boyut = ENFAZLA
  if (genislik > 0 && value) {
    const kullanilabilir = genislik - 18 // ic bosluk + kenar payi
    const metinPx = yaziGenisligi(value, `700 ${ENFAZLA}px`)
    if (metinPx > kullanilabilir) boyut = Math.max(ENAZ, Math.floor((kullanilabilir / metinPx) * ENFAZLA * 10) / 10)
  }
  return (
    <input
      ref={ref}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      title={value}
      className={className}
      style={{ '--adres-fs': `${boyut}px` } as React.CSSProperties}
    />
  )
}

// Yazinin ekrandaki gercek genisligi (px) - hane uyeleri tablosunda sutunlari
// icerikleri kadar daraltmak icin (2026-10-13). Tarayici disinda karakter
// sayisindan tahmin edilir.
let olcumTuvali: HTMLCanvasElement | null = null
function yaziGenisligi(metin: string, font: string): number {
  if (!metin) return 0
  if (typeof document === 'undefined') return metin.length * 9
  olcumTuvali ??= document.createElement('canvas')
  const ctx = olcumTuvali.getContext('2d')
  if (!ctx) return metin.length * 9
  ctx.font = `${font} ${getComputedStyle(document.body).fontFamily}`
  return ctx.measureText(metin).width
}

// Hane Ziyareti ve Sosyal Inceleme Formu (2026-10-13) - Dosya Yönetimi >
// "Tahkikat Formu" butonu bunu acar. Eski puanlamali/eleme kriterli
// IncelemeDegerlendirmeFormModal'in yerine gecti (kullanici istegiyle
// puan/karar tamamen kaldirildi). Bolum ve sorular Ayarlar > Tahkikat Formu
// Tasarımı'ndan geldigi icin bu bilesen hicbir soruyu sabit kodlamaz;
// sadece soru TURUNE gore alan cizer.

type DosyaBilgileri = {
  identityNumber?: string
  fullName?: string
  mobilePhone?: string
  address?: string
  personelAdi?: string
}

type OncekiAsamaBilgileri = {
  status: 'idle' | 'loading'
  guncellemeFormu: { aciklama: string | null; cevaplar: { title: string; labels: string[] }[] } | null
  onInceleme: { tarih: string | null; cevaplar: { label: string; value: string }[] } | null
}

type KayitliDigerKurumYardimi = { date?: string; institution?: string; aidType?: string; description?: string; amount?: string; fullName?: string }

type Props = {
  dosyaid: string
  open: boolean
  onClose: () => void
  onSaved: () => void
  canDelete?: boolean
  dosyaBilgileri?: DosyaBilgileri
  haneUyeleri?: HaneUyesi[]
  oncekiAsamaBilgileri?: OncekiAsamaBilgileri
  digerKurumYardimlariKayitli?: KayitliDigerKurumYardimi[]
  // Verilirse form bu kayitli formu duzenleme modunda acar (Dosya Yönetimi >
  // "Tahkikat Formları" sekmesi > Düzenle).
  duzenlenecekFormId?: string | null
  // 2026-10-15: true ise form ekrani kaplayan pencere yerine sayfa icinde
  // (Is Akisi > Tahkikat form SEKMESI) cizilir.
  gomulu?: boolean
}

type ApiResponse<T> = { success: boolean; data?: T; error?: string }


// Bolum vurgu renkleri (sirayla, 10'dan fazla bolumde basa doner) - kullanici
// istegi (2026-10-13): "basliklari renklendirelim, alanlar ayirt edilsin".
// Kurumsal, birbirinden net ayrisan koyu tonlar; stil: globals.css "--sf-renk".
const BOLUM_RENKLERI = ['#1d4ed8', '#0f766e', '#047857', '#b45309', '#7c3aed', '#0e7490', '#be123c', '#4338ca', '#c2410c', '#334155']

// Dosya API'si eksik alanlari '-' ile dolduruyor - bos alan gibi ele al.
function temiz(deger: string | undefined): string {
  const trimmed = (deger || '').trim()
  return trimmed === '-' ? '' : trimmed
}

function simdi(): string {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`
}

function sutunBul(soru: Soru, id: string, yedekIndex: number): TabloSutunu | undefined {
  return soru.sutunlar.find((s) => s.id === id) ?? soru.sutunlar[yedekIndex]
}

function bosTabloSatiri(): TabloSatiri {
  return { hucreler: {} }
}

// Kullanici istegi (2026-10-14): dosyaya kayitli "diger kurum yardimlari"
// (yrd_digerkrmalyrdm) "Gelir kaynaklari" tablosuna otomatik islenir.
// Sabit satirli sablonda yardim turu/kurum satir adina gore eslenir
// (Engelli, Yaslilik, Evde Bakim, Cocuk Parasi, Vakiflar, Diger Yardim
// Kuruluslari); ayni satira dusen birden cok kayit: tutar toplanir, aciklamalar
// alt alta birlestirilir. Duzenlilik/Bilginin kaynagi personele birakilir.
const kucukHarf = (metin: string | undefined) => (metin ?? '').toLocaleLowerCase('tr-TR')

function digerKurumSatirAnahtari(yardim: KayitliDigerKurumYardimi): 'engelli' | 'yaslilik' | 'evde_bakim' | 'cocuk' | 'vakif' | 'diger' {
  const tur = kucukHarf(yardim.aidType)
  const kurum = kucukHarf(yardim.institution)
  if (tur.includes('engelli')) return 'engelli'
  if (tur.includes('yaşlı') || tur.includes('yaslı') || tur.includes('yaşlılık')) return 'yaslilik'
  if (tur.includes('evde bakım')) return 'evde_bakim'
  if (tur.includes('çocuk')) return 'cocuk'
  if (kurum.includes('vakıf') || tur.includes('vakıf')) return 'vakif'
  return 'diger'
}

function sabitSatirAnahtari(sabit: string | undefined): ReturnType<typeof digerKurumSatirAnahtari> | null {
  const s = kucukHarf(sabit)
  if (s.includes('engelli')) return 'engelli'
  if (s.includes('yaşlı') || s.includes('yaslı')) return 'yaslilik'
  if (s.includes('evde bakım')) return 'evde_bakim'
  if (s.includes('çocuk')) return 'cocuk'
  if (s.includes('vakıf')) return 'vakif'
  if (s.includes('diğer yardım') || s.includes('diger yardim')) return 'diger'
  return null
}

function digerKurumAciklamasi(yardim: KayitliDigerKurumYardimi): string {
  const ad = temiz(yardim.fullName)
  const kayitAciklama = temiz(yardim.description)
  return [
    temiz(yardim.institution),
    temiz(yardim.aidType),
    ad && ad !== '-' ? ad : '',
    kayitAciklama && kayitAciklama !== '-' ? kayitAciklama : '',
    temiz(yardim.date),
  ].filter((p) => p && p !== '-').join(' · ')
}

function sayiyaCevir(deger: string | undefined): number {
  const n = Number(String(deger ?? '').replace(/\./g, '').replace(',', '.'))
  return Number.isFinite(n) ? n : 0
}

export default function SahaIncelemeFormModal({
  dosyaid, open, onClose, onSaved, canDelete, dosyaBilgileri, haneUyeleri, oncekiAsamaBilgileri, digerKurumYardimlariKayitli,
  duzenlenecekFormId, gomulu = false,
}: Props) {
  // 2026-10-14: form acikken bu dosya Is Akisi > Tahkikat listesinde diger
  // kullanicilara kirmizi "X bu rapor uzerinde calisiyor" olarak gorunur.
  useHoldWorkflowRecord('tahkikat', open && dosyaid ? dosyaid : null)
  const [sablon, setSablon] = useState<Sablon | null>(null)
  const [cevaplar, setCevaplar] = useState<Cevaplar>({})
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [status, setStatus] = useState('')
  const [eksikler, setEksikler] = useState<number[]>([])
  const [gecmisAcik, setGecmisAcik] = useState(false)
  const [kaydedilenFormId, setKaydedilenFormId] = useState<string | null>(null)
  const [gecmisYenile, setGecmisYenile] = useState(0)
  // Ozet raporun altindaki, tahkikat gorevlisinin kendi serbest aciklamasi.
  const [personelAciklamasi, setPersonelAciklamasi] = useState('')
  // Personelin kendi raporu (otomatik ozetin yaninda) ve birlesik raporun
  // elle duzenlenip duzenlenmedigi.
  const [personelRaporu, setPersonelRaporu] = useState('')
  const [birlesikElle, setBirlesikElle] = useState(false)
  // Duzenlenen kaydin tarihi (birlesik rapordaki tarih; yeni formda bugun).
  const [kayitTarihi, setKayitTarihi] = useState<string | null>(null)
  const [basariMesaji, setBasariMesaji] = useState('')
  const loadedRef = useRef(false)
  const govdeRef = useRef<HTMLDivElement>(null)
  // 2026-10-14 kullanici istegi: form kaydedilmeden kapatilsa bile tekrar
  // acildiginda kaldigi yerden devam etsin ("Temizle" ile bastan baslanir).
  // Taslak bu tarayicida (localStorage) dosya + form bazinda tutulur; yalniz
  // personel bir seyi degistirdiyse yazilir (taslakDegistiRef).
  const taslakDegistiRef = useRef(false)
  const [taslakMesaji, setTaslakMesaji] = useState('')
  const taslakAnahtari = (formId: string | null | undefined) => `netsosyal:saha-taslak:${dosyaid}:${formId || 'yeni'}`
  const taslakSil = (formId: string | null | undefined) => {
    try { window.localStorage.removeItem(taslakAnahtari(formId)) } catch { /* yok say */ }
  }
  const taslakOku = (formId: string | null | undefined): { cevaplar: Cevaplar; personelRaporu: string; zaman: string } | null => {
    try {
      const ham = window.localStorage.getItem(taslakAnahtari(formId))
      const veri = ham ? JSON.parse(ham) : null
      return veri && typeof veri === 'object' && veri.cevaplar ? veri : null
    } catch {
      return null
    }
  }

  // Otomatik dolum - form her acildiginda dosyadan/oturumdan baslangic degerleri.
  const baslangicCevaplari = (s: Sablon): Cevaplar => {
    const sonuc: Cevaplar = {}
    const uyeler = haneUyeleri ?? []
    for (const bolum of s.bolumler) {
      for (const soru of bolum.sorular) {
        const key = String(soru.id)
        switch (soru.otomatik) {
          case 'basvuru_sahibi': if (temiz(dosyaBilgileri?.fullName)) sonuc[key] = temiz(dosyaBilgileri?.fullName); break
          case 'tc_kimlik_no': if (temiz(dosyaBilgileri?.identityNumber)) sonuc[key] = temiz(dosyaBilgileri?.identityNumber); break
          case 'telefon': if (temiz(dosyaBilgileri?.mobilePhone)) sonuc[key] = temiz(dosyaBilgileri?.mobilePhone); break
          case 'adres': if (temiz(dosyaBilgileri?.address)) sonuc[key] = temiz(dosyaBilgileri?.address); break
          case 'personel': if (temiz(dosyaBilgileri?.personelAdi)) sonuc[key] = temiz(dosyaBilgileri?.personelAdi); break
          case 'ziyaret_zamani': sonuc[key] = soru.tur === 'tarih' ? simdi().slice(0, 10) : simdi(); break
          case 'hane_kisi_sayisi': if (uyeler.length > 0) sonuc[key] = String(uyeler.length); break
          default:
            // Kullanici istegi (2026-10-13): sablona sonradan eklenen ve
            // otomatik dolumu secilmemis "adres" sorulari (orn. Hane Yapisi'na
            // eklenen) de dosyadaki adresle baslar.
            if (!soru.otomatik && (soru.tur === 'metin' || soru.tur === 'uzun_metin')
              && soru.soruMetni.toLocaleLowerCase('tr-TR').includes('adres') && temiz(dosyaBilgileri?.address)) {
              sonuc[key] = temiz(dosyaBilgileri?.address)
            }
            break
        }
        if (soru.tur === 'tablo') {
          if (soru.sabitSatirlar.length > 0) {
            sonuc[key] = soru.sabitSatirlar.map((sabit) => ({ sabit, hucreler: {} }))
          } else if (soru.otomatik === 'hane_uyeleri' && uyeler.length > 0) {
            const ad = sutunBul(soru, 'ad', 0)
            const yas = sutunBul(soru, 'yas', 1)
            const yakinlik = sutunBul(soru, 'yakinlik', 2)
            // Tabloya "Adres" basligiyla eklenen sutun kisinin dosyadaki adresiyle dolar.
            const adresSutunu = soru.sutunlar.find(adresSutunuMu)
            sonuc[key] = uyeler.map((uye) => {
              const hucreler: Record<string, string> = {}
              const uyeAdresi = temiz(uye.adres) || temiz(dosyaBilgileri?.address)
              if (adresSutunu && uyeAdresi) hucreler[adresSutunu.id] = uyeAdresi
              if (ad && uye.adSoyad) hucreler[ad.id] = uye.adSoyad
              if (yas && uye.yasGrubu) hucreler[yas.id] = uye.yasGrubu
              if (yakinlik && uye.yakinlik) hucreler[yakinlik.id] = uye.yakinlik
              return { hucreler }
            })
          } else {
            sonuc[key] = [bosTabloSatiri()]
          }
        }
      }
    }
    return sonuc
  }

  // 2026-10-15: personel imzalarinin ad alani tahkikat ekip personelinden
  // acilir liste (bkz. /api/tahkikat-ekip?secim=1): ekip hesabiyla
  // girildiyse SADECE o ekip, degilse tum ekipler ekip adina gore gruplu.
  // Hic ekip uyesi tanimli degilse eski serbest metin kalir.
  const [ekipGruplari, setEkipGruplari] = useState<Array<{ ad: string; uyeler: string[] }>>([])
  useEffect(() => {
    if (!open) return
    let iptal = false
    fetch('/api/tahkikat-ekip?secim=1', { cache: 'no-store' })
      .then((res) => res.json())
      .then((payload) => {
        if (iptal) return
        const ekipler = (payload?.data?.ekipler ?? []) as Array<{ ad?: string; uyeler?: string[] }>
        setEkipGruplari(ekipler
          .map((e) => ({ ad: String(e.ad || ''), uyeler: (e.uyeler ?? []).map((u) => String(u).trim()).filter(Boolean) }))
          .filter((e) => e.uyeler.length > 0))
      })
      .catch(() => {})
    return () => { iptal = true }
  }, [open])

  useEffect(() => {
    if (!open) {
      loadedRef.current = false
      return
    }
    if (loadedRef.current) return
    loadedRef.current = true
    setStatus('')
    setEksikler([])
    setKaydedilenFormId(null)
    setGecmisAcik(false)
    setPersonelAciklamasi('')
    setPersonelRaporu('')
    setBirlesikElle(false)
    setKayitTarihi(null)
    setBasariMesaji('')
    setTaslakMesaji('')
    taslakDegistiRef.current = false

    const load = async () => {
      setIsLoading(true)
      try {
        const response = await fetch('/api/documents/saha-inceleme/sablon', { cache: 'no-store' })
        const payload = await response.json() as ApiResponse<Sablon>
        if (response.ok && payload.success && payload.data) {
          setSablon(payload.data)
          setCevaplar(baslangicCevaplari(payload.data))
          if (duzenlenecekFormId) await formuDuzenlemeyeAc(duzenlenecekFormId)
          // Kaydedilmemis taslak varsa kaldigi yerden devam (soru id'leri uzerinden)
          const taslak = taslakOku(duzenlenecekFormId)
          if (taslak) {
            setCevaplar((current) => ({ ...current, ...taslak.cevaplar }))
            setPersonelRaporu(typeof taslak.personelRaporu === 'string' ? taslak.personelRaporu : '')
            taslakDegistiRef.current = true
            const zaman = taslak.zaman ? new Date(taslak.zaman) : null
            setTaslakMesaji(`Kaydedilmemiş taslak geri yüklendi${zaman && !Number.isNaN(zaman.getTime()) ? ` (${zaman.toLocaleString('tr-TR', { dateStyle: 'short', timeStyle: 'short' })})` : ''}. Baştan başlamak için “Temizle”.`)
          }
        } else {
          setStatus(payload.error || 'Form yüklenemedi.')
        }
      } catch {
        setStatus('Form yüklenemedi.')
      } finally {
        setIsLoading(false)
      }
    }
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  // Form, dosya bilgileri ekrana tam yuklenmeden acilmis olabilir - bilgi
  // sonradan gelirse BOS kalan otomatik alanlari doldur (personelin yazdigina
  // ya da duzelttigine dokunma).
  const dosyaBilgiAnahtari = JSON.stringify([dosyaBilgileri, haneUyeleri])
  useEffect(() => {
    if (!open || !sablon) return
    const otomatik = baslangicCevaplari(sablon)
    // Sonradan gelen dosya bilgisini YALNIZ bos otomatik alanlara isler (prop -> duzenlenebilir state birlestirme).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setCevaplar((current) => {
      let degisti = false
      const sonraki = { ...current }
      for (const bolum of sablon.bolumler) {
        for (const soru of bolum.sorular) {
          if (!soru.otomatik || soru.otomatik === 'ziyaret_zamani') continue
          const key = String(soru.id)
          if (bosMu(soru, current[key]) && !bosMu(soru, otomatik[key])) {
            sonraki[key] = otomatik[key]
            degisti = true
          }
        }
      }
      return degisti ? sonraki : current
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dosyaBilgiAnahtari, sablon, open])

  // Dosyaya kayitli diger kurum yardimlarini "Gelir kaynaklari" tablosuna isle
  // (yalniz BOS hucreler; personelin yazdigina dokunulmaz, kayitli form
  // duzenlenirken calismaz). Yardim kayitlari sonradan gelirse de uygulanir.
  const digerKurumAnahtari = JSON.stringify(digerKurumYardimlariKayitli ?? [])
  useEffect(() => {
    if (!open || !sablon || kaydedilenFormId) return
    const yardimlar = digerKurumYardimlariKayitli ?? []
    if (yardimlar.length === 0) return
    const tablo = sablon.bolumler.flatMap((b) => b.sorular).find((s) => s.tur === 'tablo' && kucukHarf(s.soruMetni).includes('gelir kaynak'))
    if (!tablo) return
    const kaynakSutunu = tablo.sutunlar.find((s) => s.id === 'kaynak') ?? tablo.sutunlar[0]
    const tutarSutunu = tablo.sutunlar.find((s) => s.id === 'tutar') ?? tablo.sutunlar.find((s) => s.tur === 'sayi')
    const aciklamaSutunu = tablo.sutunlar.find((s) => kucukHarf(s.baslik).includes('açıklama'))
    if (!tutarSutunu && !aciklamaSutunu) return

    type Grup = { tutar: number; tutarVar: boolean; aciklamalar: string[]; kaynak: string }
    const sabitli = tablo.sabitSatirlar.length > 0
    const gruplar = new Map<string, Grup>()
    for (const yardim of yardimlar) {
      const anahtar = sabitli ? digerKurumSatirAnahtari(yardim) : `${yardim.institution}|${yardim.aidType}`
      const grup = gruplar.get(anahtar) ?? { tutar: 0, tutarVar: false, aciklamalar: [], kaynak: temiz(yardim.aidType) || temiz(yardim.institution) }
      const tutar = Number(yardim.amount)
      if (yardim.amount && Number.isFinite(tutar) && tutar !== 0) { grup.tutar += tutar; grup.tutarVar = true }
      const aciklama = digerKurumAciklamasi(yardim)
      if (aciklama && !grup.aciklamalar.includes(aciklama)) grup.aciklamalar.push(aciklama)
      gruplar.set(anahtar, grup)
    }

    const doldur = (satir: TabloSatiri, grup: Grup): TabloSatiri => {
      const hucreler = { ...satir.hucreler }
      if (tutarSutunu && grup.tutarVar && !String(hucreler[tutarSutunu.id] ?? '').trim()) hucreler[tutarSutunu.id] = String(Math.round(grup.tutar * 100) / 100)
      if (aciklamaSutunu && grup.aciklamalar.length && !String(hucreler[aciklamaSutunu.id] ?? '').trim()) hucreler[aciklamaSutunu.id] = grup.aciklamalar.join(' | ')
      return { ...satir, hucreler }
    }

    // Sonradan gelen diger kurum yardimlarini YALNIZ bos hucrelere isler (prop -> duzenlenebilir state birlestirme).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setCevaplar((current) => {
      const key = String(tablo.id)
      const satirlar = (current[key] as TabloSatiri[] | undefined) ?? []
      let sonraki: TabloSatiri[]
      if (sabitli) {
        sonraki = satirlar.map((satir) => {
          const grup = gruplar.get(sabitSatirAnahtari(satir.sabit) ?? '')
          return grup ? doldur(satir, grup) : satir
        })
      } else {
        // Sabit satir yok: tablo hic doldurulmamissa her yardim kendi satirina yazilir.
        const bos = satirlar.every((s) => !Object.values(s.hucreler ?? {}).some((v) => String(v ?? '').trim()))
        if (!bos) return current
        sonraki = Array.from(gruplar.values()).map((grup) => {
          const hucreler: Record<string, string> = {}
          if (kaynakSutunu && grup.kaynak) hucreler[kaynakSutunu.id] = grup.kaynak
          return doldur({ hucreler }, grup)
        })
      }
      const degisti = sonraki.some((s, i) => s !== satirlar[i]) || sonraki.length !== satirlar.length
      return degisti ? { ...current, [key]: sonraki } : current
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [digerKurumAnahtari, sablon, open, kaydedilenFormId])

  // "Hanede fiilen yasayan kisi sayisi" hane uyeleri tablosuyla senkron:
  // uye eklenip silindiginde (dolu satir sayisi degisince), sayi elle
  // degistirilmemisse (bos ya da onceki uye sayisina esit) yeni uye sayisina
  // guncellenir. Guncelleme aninda (setCevaplar icinde) uygulanir.
  const kisiSayisiniEsitle = (onceki: Cevaplar, sonraki: Cevaplar): Cevaplar => {
    if (!sablon) return sonraki
    const tum = sablon.bolumler.flatMap((b) => b.sorular)
    const haneSoru = tum.find((s) => s.otomatik === 'hane_uyeleri' && s.tur === 'tablo')
    const kisiSoru = tum.find((s) => s.otomatik === 'hane_kisi_sayisi')
    if (!haneSoru || !kisiSoru) return sonraki
    const say = (c: Cevaplar) => ((c[String(haneSoru.id)] as TabloSatiri[] | undefined) ?? [])
      .filter((r) => Object.values(r.hucreler || {}).some((v) => String(v ?? '').trim())).length
    const a = say(onceki)
    const b = say(sonraki)
    if (a === b) return sonraki
    const mevcut = String(sonraki[String(kisiSoru.id)] ?? '').trim()
    if (mevcut !== '' && mevcut !== String(a)) return sonraki
    return { ...sonraki, [String(kisiSoru.id)]: b ? String(b) : '' }
  }

  // Personel bir sey degistirdikce taslak (kaydedilmemis hali) yazilir.
  useEffect(() => {
    if (!open || isLoading || !sablon || !taslakDegistiRef.current) return
    try {
      window.localStorage.setItem(
        taslakAnahtari(kaydedilenFormId),
        JSON.stringify({ cevaplar, personelRaporu, zaman: new Date().toISOString() }),
      )
    } catch { /* depolama dolu/kapali - taslaksiz devam */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cevaplar, personelRaporu, open, isLoading, sablon, kaydedilenFormId])

  // "Temizle": taslak silinir, form bastan baslar (kayitli form
  // duzenleniyorsa son kaydedilmis haline doner).
  const formuTemizle = async () => {
    if (!sablon || isSaving) return
    const mesaj = kaydedilenFormId
      ? 'Kaydedilmemiş değişiklikler silinip form son kaydedilmiş haline döndürülsün mü?'
      : 'Formdaki tüm girişler silinip form baştan başlatılsın mı?'
    if (!window.confirm(mesaj)) return
    taslakSil(kaydedilenFormId)
    taslakDegistiRef.current = false
    setTaslakMesaji('')
    setStatus('')
    setEksikler([])
    if (kaydedilenFormId) {
      await formuDuzenlemeyeAc(kaydedilenFormId)
    } else {
      setCevaplar(baslangicCevaplari(sablon))
      setPersonelRaporu('')
      setBirlesikElle(false)
      govdeRef.current?.scrollTo({ top: 0, behavior: 'smooth' })
    }
  }

  const setCevap = (soru: Soru, deger: CevapDegeri) => {
    taslakDegistiRef.current = true
    setCevaplar((current) => kisiSayisiniEsitle(current, { ...current, [String(soru.id)]: deger }))
    if (eksikler.includes(soru.id)) setEksikler((current) => current.filter((id) => id !== soru.id))
  }

  // Fonksiyonel guncelleme: art arda hizli tiklamalarda/yazmalarda onceki
  // degisiklik kaybolmasin (eski kapanistaki "cevaplar"a degil, en guncele bakar).
  const toggleCoklu = (soru: Soru, secenekId: string) => {
    taslakDegistiRef.current = true
    const key = String(soru.id)
    setCevaplar((current) => {
      const mevcut = (current[key] as string[] | undefined) ?? []
      return { ...current, [key]: mevcut.includes(secenekId) ? mevcut.filter((id) => id !== secenekId) : [...mevcut, secenekId] }
    })
    if (eksikler.includes(soru.id)) setEksikler((current) => current.filter((id) => id !== soru.id))
  }

  const tabloSatirlari = (soru: Soru): TabloSatiri[] => (cevaplar[String(soru.id)] as TabloSatiri[] | undefined) ?? []
  const setHucre = (soru: Soru, satirIndex: number, sutunId: string, deger: string) => {
    taslakDegistiRef.current = true
    const key = String(soru.id)
    // Hane uyelerinde gelir tutari girilince bos "Hane gelirine katki" -> "Var"
    // (tutarlilik; personel isterse degistirebilir).
    const hs = soru.otomatik === 'hane_uyeleri' ? haneSutunlari(soru) : null
    const katkiOtomatik = hs?.gelir && hs.katki && sutunId === hs.gelir.id && Number(String(deger).replace(',', '.')) > 0
      && (hs.katki.secenekler ?? []).includes('Var') ? hs.katki : null
    setCevaplar((current) => kisiSayisiniEsitle(current, {
      ...current,
      [key]: ((current[key] as TabloSatiri[] | undefined) ?? []).map((satir, i) => {
        if (i !== satirIndex) return satir
        const hucreler = { ...satir.hucreler, [sutunId]: deger }
        if (katkiOtomatik && !String(hucreler[katkiOtomatik.id] ?? '').trim()) hucreler[katkiOtomatik.id] = 'Var'
        return { ...satir, hucreler }
      }),
    }))
    if (eksikler.includes(soru.id)) setEksikler((current) => current.filter((id) => id !== soru.id))
  }

  const otomatikBirlesik = useMemo(
    () => (sablon ? birlesikRaporUret({ sablon, cevaplar, personelRaporu, dosyaEtiketi: `ID ${dosyaid}`, tarih: kayitTarihi ?? new Date().toLocaleDateString('tr-TR') }) : ''),
    [sablon, cevaplar, personelRaporu, dosyaid, kayitTarihi],
  )

  // Kayitli bir formu duzenlemek icin forma yukler (Gecmis formlar > Düzenle).
  // Kaydin kendi sablon kopyasi kullanilir; "Güncelle" ayni kaydi degistirir.
  async function formuDuzenlemeyeAc(formId: string) {
    setStatus('')
    setBasariMesaji('')
    try {
      const response = await fetch(`/api/documents/saha-inceleme/${encodeURIComponent(formId)}`, { cache: 'no-store' })
      const payload = await response.json() as ApiResponse<SahaIncelemeDetay>
      if (!response.ok || !payload.success || !payload.data) throw new Error(payload.error || 'Form yüklenemedi.')
      const d = payload.data
      const tarih = /^\d{4}-\d{2}-\d{2}/.test(d.tarih) ? d.tarih.slice(0, 10).split('-').reverse().join('.') : d.tarih
      // Tablo sorularinda kayitta olmayan sabit satirlari geri ekle (bos satirlar kaydedilmez).
      const bas = baslangicCevaplari(d.sablon)
      const yuklenen: Cevaplar = { ...d.cevaplar }
      for (const soru of d.sablon.bolumler.flatMap((b) => b.sorular)) {
        const key = String(soru.id)
        if (soru.tur === 'tablo' && soru.sabitSatirlar.length > 0) {
          const kayitli = (yuklenen[key] as TabloSatiri[] | undefined) ?? []
          yuklenen[key] = soru.sabitSatirlar.map((sabit) => kayitli.find((r) => r.sabit === sabit) ?? { sabit, hucreler: {} })
        } else if (soru.tur === 'tablo' && !yuklenen[key]) {
          yuklenen[key] = bas[key] ?? [bosTabloSatiri()]
        }
      }
      setSablon(d.sablon)
      setCevaplar(yuklenen)
      setPersonelRaporu(d.personelRaporu ?? '')
      setKayitTarihi(tarih)
      // Birlesik rapor formda gosterilmiyor - guncel cevaplardan yeniden uretilir.
      setBirlesikElle(false)
      setKaydedilenFormId(d.id)
      setEksikler([])
      setGecmisAcik(false)
      govdeRef.current?.scrollTo({ top: 0, behavior: 'smooth' })
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Form yüklenemedi.')
    }
  }
  // Elle duzenlenmediyse birlesik rapor hep otomatik metindir.
  const birlesikMetin = birlesikElle ? personelAciklamasi : otomatikBirlesik
  // 2026-10-14: birlesikElle hicbir yerde true yapilmadigi (elle duzenleme
  // kutusu kaldirildi) icin otomatik metni personelAciklamasi'na kopyalayan
  // efekt KALDIRILDI - birlesikMetin zaten otomatikBirlesik'e esit, sonuc ayni.

  const rapor = useMemo(
    () => (sablon ? ozetRaporuUret(sablon, cevaplar) : { gostergeler: [], paragraf: '', bulgular: [], doluAlan: 0, toplamAlan: 0 }),
    [sablon, cevaplar],
  )
  // "Özet Rapor" karti icin (kayitli form kartlariyla ayni bilgiler) - form
  // bilgileri tek cumle + personel raporu tek cumle.
  const ozetCumleleri = useMemo(
    () => (sablon ? ozetRaporCumleleri(sablon, cevaplar, personelRaporu, kayitTarihi ?? new Date().toLocaleDateString('tr-TR')) : { form: '', personel: '' }),
    [sablon, cevaplar, personelRaporu, kayitTarihi],
  )
  const ozetZiyaretSonucu = sablon ? anahtarliCevap(sablon, cevaplar, 'ziyaret_sonucu') : null
  // 2026-10-15: Evde Bulunamadı / Tahkikat İstemedi vb. - zorunlu alanlar aranmaz
  const ziyaretYapilmadi = ziyaretGerceklesmediMi(ozetZiyaretSonucu)
  const ozetAciliyet = sablon ? anahtarliCevap(sablon, cevaplar, 'aciliyet') : null
  const personelSorusu = sablon?.bolumler.flatMap((b) => b.sorular).find((s) => s.otomatik === 'personel')
  const formPersoneli = (personelSorusu ? cevapMetni(personelSorusu, cevaplar[String(personelSorusu.id)]) : '') || temiz(dosyaBilgileri?.personelAdi)

  // "Toplam aylik gelir" sorusu icin, ayni bolumdeki tablolarin sayisal
  // sutunlarinin toplami - personel tek tikla aktarabilir.
  const tablodanToplam = (soru: Soru): number | null => {
    if (soru.anahtar !== 'toplam_gelir' || !sablon) return null
    const bolum = sablon.bolumler.find((b) => b.sorular.some((s) => s.id === soru.id))
    let toplam = 0
    let var_ = false
    for (const diger of bolum?.sorular ?? []) {
      if (diger.tur !== 'tablo') continue
      const sayiSutunlari = diger.sutunlar.filter((s) => s.tur === 'sayi')
      for (const satir of tabloSatirlari(diger)) {
        for (const sutun of sayiSutunlari) {
          const h = satir.hucreler?.[sutun.id]
          if (h && String(h).trim()) { toplam += sayiyaCevir(h); var_ = true }
        }
      }
    }
    return var_ ? toplam : null
  }

  const handleSave = async () => {
    if (!sablon || isSaving) return
    // 2026-10-15: ziyaret yapilamadiysa (Evde Bulunamadı vb.) yalniz ziyaret sonucu aranir
    const eksik = eksikZorunluSorular(sablon, cevaplar).map(({ soru }) => soru.id)
    if (eksik.length > 0) {
      setEksikler(eksik)
      setStatus(`${eksik.length} zorunlu alan boş. Kırmızı işaretli alanları doldurun.`)
      document.getElementById(`saha-soru-${eksik[0]}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      return
    }

    setEksikler([])
    setIsSaving(true)
    setStatus('')
    setBasariMesaji('')
    // Kayit zaten varsa (yeni kaydedildi ya da Geçmiş formlar > Düzenle) ayni
    // kayit guncellenir - ikinci bir form/Ev Ziyareti satiri olusmaz.
    const guncelleme = Boolean(kaydedilenFormId)
    try {
      const response = await fetch(guncelleme ? `/api/documents/saha-inceleme/${encodeURIComponent(kaydedilenFormId!)}` : '/api/documents/saha-inceleme', {
        method: guncelleme ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          dosyaid,
          cevaplar,
          tcKimlikNo: temiz(dosyaBilgileri?.identityNumber) || null,
          personel: temiz(dosyaBilgileri?.personelAdi) || null,
          personelAciklamasi: birlesikMetin.trim() || null,
          personelRaporu: personelRaporu.trim() || null,
        }),
      })
      const payload = await response.json() as ApiResponse<{ id: string }>
      if (!response.ok || !payload.success) throw new Error(payload.error || 'İnceleme formu kaydedilemedi.')
      // Kaydedildi - taslak artik gereksiz
      taslakDegistiRef.current = false
      taslakSil(kaydedilenFormId)
      setTaslakMesaji('')
      setKaydedilenFormId(payload.data?.id ?? kaydedilenFormId)
      setBasariMesaji(guncelleme
        ? `✓ Değişiklikler kaydedildi (Form No: ${payload.data?.id ?? kaydedilenFormId}). Ev Ziyareti kaydı da güncellendi.`
        : `✓ Form kaydedildi (Form No: ${payload.data?.id}). Dosya Sonuç Bekleyen listesine aktarıldı, özet Ev Ziyareti kayıtlarına eklendi.`)
      govdeRef.current?.scrollTo({ top: 0, behavior: 'smooth' })
      setGecmisYenile((n) => n + 1)
      onSaved()
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'İnceleme formu kaydedilemedi.')
    } finally {
      setIsSaving(false)
    }
  }

  if (!open) return null

  const ayarlar = sablon?.ayarlar

  const soruAlani = (soru: Soru) => {
    const key = String(soru.id)
    const deger = cevaplar[key]
    // Adres alanlari tek satir; yazi boyutu alanin genisligine gore ayarlanir (2026-10-13)
    if (adresSorusuMu(soru)) {
      return <AdresAlani value={(deger as string) ?? ''} onChange={(v) => setCevap(soru, v)} />
    }

    switch (soru.tur) {
      case 'imza':
        return <ImzaAlani value={(deger as string) || undefined} onChange={(dataUrl) => setCevap(soru, dataUrl)} eksik={eksikler.includes(soru.id)} />
      case 'uzun_metin':
        // 2026-10-14: uzun metin alanlarina konusarak yazma (MikrofonButonu)
        return (
          <div className="sf-metin-mikrofon">
            <textarea
              value={(deger as string) ?? ''}
              onChange={(e) => setCevap(soru, e.target.value)}
              rows={soru.yukseklik || 2}
              // Ayarlarda yukseklik verilmisse sabit satir yuksekligi (bos = otomatik buyur)
              className={`sf-input${soru.yukseklik ? ' sf-yukseklik' : ''}`}
              style={soru.yukseklik ? ({ '--sf-yukseklik': `calc(${soru.yukseklik} * 1.45em + 10px)` } as React.CSSProperties) : undefined}
            />
            <MikrofonButonu value={(deger as string) ?? ''} onChange={(metin) => setCevap(soru, metin)} />
          </div>
        )
      case 'sayi': {
        const toplam = tablodanToplam(soru)
        return (
          <div className="sf-input-grup">
            <input type="number" inputMode="decimal" value={(deger as string) ?? ''} onChange={(e) => setCevap(soru, e.target.value)} className="sf-input" />
            {toplam !== null && String(toplam) !== String(deger ?? '') && (
              <button type="button" onClick={() => setCevap(soru, String(toplam))} title="Gelir kaynakları tablosundaki tutarların toplamını aktar" className="sf-btn kucuk">
                Tablodaki toplamı aktar: {toplam.toLocaleString('tr-TR')} TL
              </button>
            )}
          </div>
        )
      }
      case 'tarih':
        return <input type="date" value={(deger as string) ?? ''} onChange={(e) => setCevap(soru, e.target.value)} className="sf-input" style={{ maxWidth: 220 }} />
      case 'tarih_saat':
        return <input type="datetime-local" value={(deger as string) ?? ''} onChange={(e) => setCevap(soru, e.target.value)} className="sf-input" style={{ maxWidth: 260 }} />
      case 'tek':
      case 'coklu': {
        const secilenler = soru.tur === 'tek' ? [deger as string] : ((deger as string[] | undefined) ?? [])
        return (
          <div className="sf-secenekler" role={soru.tur === 'tek' ? 'radiogroup' : 'group'}>
            {soru.secenekler.map((secenek) => {
              const secili = secilenler.includes(secenek.id)
              return (
                <button
                  key={secenek.id}
                  type="button"
                  role={soru.tur === 'tek' ? 'radio' : 'checkbox'}
                  aria-checked={secili}
                  onClick={() => (soru.tur === 'tek' ? setCevap(soru, secili ? '' : secenek.id) : toggleCoklu(soru, secenek.id))}
                  className={`sf-secenek${secili ? ' secili' : ''}`}
                >
                  <span className={`sf-kutu${soru.tur === 'tek' ? ' yuvarlak' : ''}`}>{secili && soru.tur === 'coklu' ? '✓' : ''}</span>
                  {secenek.metin}
                </button>
              )
            })}
          </div>
        )
      }
      case 'tablo': {
        const satirlar = tabloSatirlari(soru)
        const sabitli = soru.sabitSatirlar.length > 0
        // Hane uyeleri: calisabilir satir (yesil), kisi sayisi, toplam gelir,
        // kisi basi gelir ve katki/gelir celiskisi ozet raporlarla AYNI ortak
        // hesaptan gelir (lib haneAnalizi) - ekran ile kayitli rapor tutarli.
        const haneTablosu = soru.otomatik === 'hane_uyeleri'
        const hane = haneTablosu && sablon ? haneAnalizi(sablon, cevaplar) : null
        const calisabilir = (satir: TabloSatiri) => !!hane && calisabilirMi(satir, hane.sutunlar)
        const tl = (n: number) => `${n.toLocaleString('tr-TR', { maximumFractionDigits: 2 })} TL`
        // Kullanici istegi (2026-10-13): hane uyeleri tablosunda her sutun
        // yalnizca icindeki verinin yazi genisligi kadar (secimlerde o an
        // SECILI degerler; bos hucre varsa "Seciniz"). Tablo formun tamamina
        // yayilmaz. Basliklar (12px) en uzun kelimeleri kadar yer ister,
        // gerisi alt satira kirilir.
        const sutunPx = haneTablosu
          ? soru.sutunlar.map((sutun) => {
              const hucreDegerleri = satirlar.map((s) => String(s.hucreler?.[sutun.id] ?? '').trim())
              const veriler = sutun.tur === 'secim'
                ? hucreDegerleri.map((v) => v || 'Seçiniz')
                : hucreDegerleri
              const veriPx = Math.max(0, ...veriler.map((v) => yaziGenisligi(v, '700 12px')))
              const baslikPx = Math.max(0, ...sutun.baslik.split(/\s+/).map((k) => yaziGenisligi(k, '700 12px')))
              // td ic boslugu 8 + kutu ic boslugu 14 + kenarlik 2 + pay 2 (+ secim oku 18)
              const ekPx = 26 + (sutun.tur === 'secim' ? 18 : 0)
              // cok uzun metinler (orn. adres) tabloyu asiri genisletmesin
              return Math.ceil(Math.min(Math.max(veriPx + ekPx, baslikPx + 14, 34), 460))
            })
          // Kullanici istegi (2026-10-14): diger tablolarda da (Tapu/Araç kaydı,
          // gelirler, giderler...) sutunlar karakter sayisina gore YUZDE ile
          // bolununce, yazi girildikce sutun buyuyor ama metnin sagina cok
          // bos alan kaliyordu. Artik genislik gercek yazi genisligi (piksel)
          // kadar: metin sutunu yazdikca metne tam yetecek kadar buyur,
          // tablo formun tamamina yayilmaz.
          : soru.sutunlar.map((sutun, index) => {
              const baslikPx = Math.max(0, ...sutun.baslik.split(/\s+/).map((k) => yaziGenisligi(k, '700 12.5px'))) + 18
              if (sabitli && index === 0) {
                return Math.ceil(Math.max(baslikPx, ...satirlar.map((s) => yaziGenisligi(String(s.sabit ?? ''), '700 14.5px') + 20)))
              }
              const degerler = satirlar.map((s) => String(s.hucreler?.[sutun.id] ?? ''))
              const veriPx = Math.max(0, ...degerler.map((d) => yaziGenisligi(d, '700 14.5px')))
              // td ic boslugu 10 + kutu ic boslugu 14 + kenarlik 2 + pay 6
              if (sutun.tur === 'secim') {
                const secenekPx = Math.max(yaziGenisligi('Seçiniz', '700 14.5px'), ...(sutun.secenekler ?? []).map((x) => yaziGenisligi(x, '700 14.5px')))
                return Math.ceil(Math.max(secenekPx + 54, baslikPx))
              }
              if (sutun.tur === 'sayi') return Math.ceil(Math.max(veriPx + 32, baslikPx, 90))
              return Math.ceil(Math.min(Math.max(veriPx + 32, baslikPx, 160), 760))
            })
        // Adres sutunu varsa (kullanici istegi 2026-10-13): tablo tam genislik olur,
        // adres sutunu genisligi verilmeden kalan bosluğun tamamini alir; adres
        // tek satirda, yazi boyutu sutuna sigacak sekilde (AdresAlani).
        const adresIndex = haneTablosu ? soru.sutunlar.findIndex(adresSutunuMu) : -1
        // Adres sutunu en az, en uzun adresin 12px'te tek satira sigacagi kadar
        // (td + kutu ic bosluklari + olcum payi = 44px; en fazla 900px);
        // ekran yetmezse tablo yatay kayar.
        const ADRES_EN_AZ = adresIndex >= 0
          ? Math.ceil(Math.min(900, Math.max(220, ...satirlar.map((s) => yaziGenisligi(String(s.hucreler?.[soru.sutunlar[adresIndex].id] ?? ''), '700 12px') + 44))))
          : 220
        // 2026-10-14 kullanici istegi: tablolar formun SONUNA KADAR uzasin (sagda
        // bos alan kalmasin). Kalan genisligi adres sutunu, yoksa son metin
        // sutunu (orn. Aciklama) alir; o da yoksa sutunlar orantili buyur.
        const sonMetinIndex = soru.sutunlar.reduce((son, sutun, i) => (sutun.tur === 'metin' && !(sabitli && i === 0) ? i : son), -1)
        const esnekIndex = adresIndex >= 0 ? adresIndex : sonMetinIndex
        const digerPx = sutunPx.reduce((t, w, i) => (i === esnekIndex ? t : t + w), 0) + (sabitli ? 0 : 32)
        const esnekEnAz = adresIndex >= 0 ? ADRES_EN_AZ : esnekIndex >= 0 ? sutunPx[esnekIndex] : 0
        const tabloStili: React.CSSProperties = { width: '100%', minWidth: digerPx + esnekEnAz }
        return (
          <div className={`sf-tablo-kap${haneTablosu ? ' sf-hane-kap' : ''}`}>
            <table className={`sf-tablo sabit-duzen${haneTablosu ? ' sf-hane-tablo' : ''}`} style={tabloStili}>
              <colgroup>
                {sutunPx.map((w, i) => <col key={soru.sutunlar[i].id} style={i === esnekIndex ? undefined : { width: w }} />)}
                {!sabitli && <col style={{ width: 32 }} />}
              </colgroup>
              <thead>
                <tr>
                  {soru.sutunlar.map((sutun) => <th key={sutun.id} title={sutun.baslik}>{sutun.baslik}</th>)}
                  {!sabitli && <th />}
                </tr>
              </thead>
              <tbody>
                {satirlar.map((satir, satirIndex) => (
                  <tr key={satirIndex} className={haneTablosu && calisabilir(satir) ? 'sf-saglikli-satir' : undefined} title={haneTablosu && calisabilir(satir) ? 'Sağlıklı ve 18 yaş üstü: çalışabilecek durumda' : undefined}>
                    {soru.sutunlar.map((sutun, sutunIndex) => (
                      sabitli && sutunIndex === 0 ? (
                        <td key={sutun.id} className="sf-sabit">{satir.sabit}</td>
                      ) : (
                        <td key={sutun.id}>
                          {sutun.tur === 'secim' ? (
                            <select value={satir.hucreler?.[sutun.id] ?? ''} onChange={(e) => setHucre(soru, satirIndex, sutun.id, e.target.value)} className={`sf-hucre${satir.hucreler?.[sutun.id] ? '' : ' bos'}`}>
                              <option value="">Seçiniz</option>
                              {(sutun.secenekler ?? []).map((s) => <option key={s} value={s}>{s}</option>)}
                            </select>
                          ) : adresSutunuMu(sutun) ? (
                            <AdresAlani
                              value={satir.hucreler?.[sutun.id] ?? ''}
                              onChange={(v) => setHucre(soru, satirIndex, sutun.id, v)}
                              className="sf-hucre sf-adres"
                              enFazla={12}
                              enAz={9}
                            />
                          ) : (
                            <input
                              type={sutun.tur === 'sayi' ? 'number' : 'text'}
                              inputMode={sutun.tur === 'sayi' ? 'decimal' : undefined}
                              value={satir.hucreler?.[sutun.id] ?? ''}
                              onChange={(e) => setHucre(soru, satirIndex, sutun.id, e.target.value)}
                              // fare tekerlegi sayiyi yanlislikla degistirmesin (yas elle girilir)
                              onWheel={sutun.tur === 'sayi' ? (e) => e.currentTarget.blur() : undefined}
                              className={`sf-hucre${sutun.tur === 'sayi' ? ' sayi' : ''}`}
                            />
                          )}
                        </td>
                      )
                    ))}
                    {!sabitli && (
                      <td style={{ textAlign: 'center' }}>
                        <button type="button" title="Satırı sil" onClick={() => setCevap(soru, satirlar.filter((_, i) => i !== satirIndex))} className="sf-sil">×</button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
            {hane && (
              <div className="sf-hane-ozet">
                <div className="sf-hane-ozet-kalem">
                  <span>Hanedeki kişi</span>
                  <b>{hane.kisiSayisi ? `${hane.kisiSayisi} kişi` : '—'}</b>
                </div>
                {hane.sutunlar.saglik && hane.sutunlar.yas && (
                  <div className="sf-hane-ozet-kalem yesil" title="Durumu “Sağlıklı” ve 18 yaş ve üzeri olan üyeler; satırları yeşil gösterilir">
                    <span><i className="sf-calisabilir-isaret" />Çalışabilecek birey</span>
                    <b>{hane.calisabilecek !== null ? `${hane.calisabilecek} kişi` : '—'}</b>
                  </div>
                )}
                <div className="sf-hane-ozet-kalem mavi">
                  <span>Aylık toplam gelir</span>
                  <b>{hane.toplamGelir !== null ? tl(hane.toplamGelir) : '—'}</b>
                </div>
                <div className="sf-hane-ozet-kalem mavi">
                  <span>Kişi başı gelir</span>
                  <b>{hane.kisiBasi !== null ? tl(Math.round(hane.kisiBasi * 100) / 100) : '—'}</b>
                </div>
                <div className="sf-hane-ozet-not">
                  {hane.toplamGelir !== null && hane.gelirKaynagi
                    ? `Gelir kaynağı: ${GELIR_KAYNAGI_METNI[hane.gelirKaynagi]}.`
                    : hane.sutunlar.gelir
                      ? `Gelir, üyelerin “${hane.sutunlar.gelir.baslik}” alanına girildiğinde otomatik toplanır.`
                      : 'Gelir, “Gelir ve Çalışma Durumu” bölümünden girilir.'}
                </div>
                {hane.katkiCelisen.length > 0 && (
                  <div className="sf-hane-ozet-uyari">
                    ⚠ “Hane gelirine katkı: Yok” seçili olduğu hâlde gelir tutarı girilmiş: {hane.katkiCelisen.join(', ')}. Lütfen kontrol edin.
                  </div>
                )}
              </div>
            )}
            {!sabitli && (
              <button type="button" onClick={() => setCevap(soru, [...satirlar, bosTabloSatiri()])} className="sf-satir-ekle">+ Satır ekle</button>
            )}
          </div>
        )
      }
      default:
        return <input value={(deger as string) ?? ''} onChange={(e) => setCevap(soru, e.target.value)} className="sf-input" />
    }
  }

  // Tablo, uzun metin ve 3'ten fazla secenekli sorular tam genislikte
  // (etiket ustte); digerleri PDF'teki gibi "etiket | alan" satiri.
  const genisMi = (soru: Soru) => soru.tur === 'tablo'

  // 2026-10-14 kullanici istegi: personel raporu imza alaninin USTUNDE
  // (imzali ilk bolumde, imzalardan hemen once); imza yoksa ozetin icinde.
  const ilkImzaBolumId = sablon?.bolumler.find((b) => b.sorular.some((s) => s.tur === 'imza'))?.id ?? null
  const personelRaporuPaneli = (
    <div className="sf-rapor-blok">
      <div>
        <div className="sf-rapor-panel personel">
          <div className="sf-rapor-panel-bas">Personel raporu <span>tahkikat görevlisi yazar</span></div>
          <div className="sf-rapor-panel-govde">
            <div className="sf-metin-mikrofon">
              <textarea
                value={personelRaporu}
                onChange={(e) => setPersonelRaporu(e.target.value)}
                maxLength={10000}
                rows={6}
                placeholder="Ziyarete ilişkin kendi gözlem, değerlendirme ve önerilerinizi buraya yazın..."
                className="sf-input sf-personel-raporu"
              />
              <MikrofonButonu value={personelRaporu} onChange={(metin) => { taslakDegistiRef.current = true; setPersonelRaporu(metin) }} />
            </div>
          </div>
        </div>
      </div>
    </div>
  )

  return (
    // 2026-10-15: "gomulu" - form bir calisma alani SEKMESINDE acilir (ekrani
    // kaplayan pencere degil); kullanici baska sekmeye gecip donebilir.
    // Mobil/tablette (lg alti) her durumda eskisi gibi tam ekran pencere;
    // masaustunde gomulu ise sekmenin TAMAMINI doldurur. Yukseklik, sayfaya
    // uygulanan olcek (zoom) ile kuculmesin diye --shell-unzoom ile dengelenir.
    <div className={gomulu
      ? 'fixed inset-0 z-[2100] flex items-center justify-center bg-slate-950/70 p-2 backdrop-blur-sm md:p-4 lg:static lg:inset-auto lg:z-auto lg:block lg:bg-transparent lg:p-0 lg:backdrop-blur-none'
      : 'fixed inset-0 z-[2100] flex items-center justify-center bg-slate-950/70 p-2 backdrop-blur-sm md:p-4'}>
      <div className={`saha-form flex w-full flex-col overflow-hidden rounded-lg border border-slate-400/40 ${gomulu
        ? 'max-h-[96vh] max-w-[1320px] shadow-2xl lg:h-[calc((100dvh-165px)*var(--shell-unzoom,1))] lg:max-h-none lg:max-w-none lg:shadow-sm'
        : 'max-h-[96vh] max-w-[1320px] shadow-2xl'}`}>
        <div className="sf-ust">
          <div style={{ minWidth: 0 }}>
            <div className="sf-kurum">{ayarlar?.kurumBasligi || 'Belediye Sosyal Yardım Birimi'}</div>
            <div className="sf-baslik">{ayarlar?.formBasligi || 'Hane Ziyareti ve Sosyal İnceleme Formu'}</div>
            {ayarlar?.altBaslik && <div className="sf-alt">{ayarlar.altBaslik}</div>}
          </div>
          <div className="sf-meta">
            {ayarlar?.surum && <span className="sf-rozet">{ayarlar.surum}</span>}
            <span className="sf-rozet">Dosya ID: {dosyaid}</span>
            <button
              type="button"
              onClick={() => void formuTemizle()}
              disabled={isLoading || isSaving || !sablon}
              title={kaydedilenFormId ? 'Kaydedilmemiş değişiklikleri sil, son kaydedilmiş hale dön' : 'Formu temizle ve baştan başla'}
              className="sf-temizle"
            >
              Temizle
            </button>
            <button type="button" onClick={onClose} aria-label="Kapat" title="Kapat (girdikleriniz taslak olarak saklanır)" className="sf-kapat">✕</button>
          </div>
        </div>

        <div
          ref={govdeRef}
          className="sf-govde min-h-0 flex-1 overflow-y-auto"
          // Taslak icin: personelin yazdigi/sectigi her sey + tablo satiri ekle/sil
          onInputCapture={() => { taslakDegistiRef.current = true }}
          onChangeCapture={() => { taslakDegistiRef.current = true }}
          onClickCapture={(event) => { if ((event.target as HTMLElement).closest?.('table button')) taslakDegistiRef.current = true }}
        >
          {status && <div className="sf-uyari hata">{status}</div>}
          {taslakMesaji && !status && <div className="sf-uyari taslak">{taslakMesaji}</div>}
          {ziyaretYapilmadi && (
            <div className="sf-uyari taslak">
              Ziyaret sonucu “{ozetZiyaretSonucu}” seçildi: diğer zorunlu alanları doldurmadan kaydedebilirsiniz. Dosya Sonuç Bekleyen’e bu bilgiyle düşer.
            </div>
          )}

          {kaydedilenFormId && (
            <div className="sf-uyari ok">
              <span>{basariMesaji || `Kayıtlı form düzenleniyor (Form No: ${kaydedilenFormId}). Değişiklikleri alttaki "Güncelle" düğmesiyle kaydedin.`}</span>
              <span style={{ display: 'flex', gap: 6 }}>
                <a href={`/api/documents/saha-inceleme/yazdir?id=${kaydedilenFormId}&yazdir=1`} target="_blank" rel="noreferrer" className="sf-btn kucuk yesil">Formu Yazdır</a>
                <button type="button" onClick={onClose} className="sf-btn kucuk">Kapat</button>
              </span>
            </div>
          )}

          <div className="sf-kart">
            <button type="button" onClick={() => setGecmisAcik((v) => !v)} className="sf-kart-bas">
              <span className="sf-kart-baslik">Geçmiş formlar ve önceki aşamalar</span>
              <span className="sf-kart-sag">{gecmisAcik ? 'Gizle ▲' : 'Görüntüle ▼'}</span>
            </button>
            {gecmisAcik && (
              <div className="sf-gecmis space-y-2">
                {oncekiAsamaBilgileri?.status === 'loading' && (
                  <div className="rounded border border-slate-200 bg-slate-50 px-2.5 py-2 text-center text-slate-500">Önceki aşamaların bilgileri yükleniyor...</div>
                )}
                {(oncekiAsamaBilgileri?.guncellemeFormu || oncekiAsamaBilgileri?.onInceleme) && (
                  <div className="grid gap-2 sm:grid-cols-2">
                    {oncekiAsamaBilgileri?.guncellemeFormu && (
                      <div className="rounded-md border border-slate-200 bg-slate-50 p-2">
                        <p className="mb-1 font-bold uppercase text-slate-500">Güncelleme formu</p>
                        {oncekiAsamaBilgileri.guncellemeFormu.cevaplar.map((item) => (
                          <p key={item.title}><b className="text-slate-600">{item.title}:</b> {item.labels.join(', ')}</p>
                        ))}
                        {oncekiAsamaBilgileri.guncellemeFormu.aciklama && <p className="mt-1 whitespace-pre-wrap">{oncekiAsamaBilgileri.guncellemeFormu.aciklama}</p>}
                      </div>
                    )}
                    {oncekiAsamaBilgileri?.onInceleme && (
                      <div className="rounded-md border border-slate-200 bg-slate-50 p-2">
                        <p className="mb-1 font-bold uppercase text-slate-500">Ön inceleme formu</p>
                        {oncekiAsamaBilgileri.onInceleme.cevaplar.map((item, index) => (
                          <p key={`${item.label}-${index}`}><b className="text-slate-600">{item.label}:</b> {item.value}</p>
                        ))}
                      </div>
                    )}
                  </div>
                )}
                {digerKurumYardimlariKayitli && digerKurumYardimlariKayitli.length > 0 && (
                  <div className="rounded-md border border-slate-200 bg-slate-50 p-2">
                    <p className="mb-1 font-bold uppercase text-slate-500">Dosyaya kayıtlı diğer kurum yardımları</p>
                    {digerKurumYardimlariKayitli.map((row, index) => (
                      <p key={index}>{[row.date, row.institution, row.aidType, row.amount ? `${row.amount} TL` : '', row.description].filter(Boolean).join(' · ') || '-'}</p>
                    ))}
                  </div>
                )}
                <SahaIncelemeGecmisiPaneli dosyaid={dosyaid} canDelete={!!canDelete} yenile={gecmisYenile} onDuzenle={(id) => void formuDuzenlemeyeAc(id)} duzenlenenId={kaydedilenFormId} />
              </div>
            )}
          </div>

          {isLoading ? (
            <div className="flex items-center justify-center py-24">
              <div className="h-8 w-8 animate-spin rounded-full border-4 border-sky-600 border-t-transparent" />
            </div>
          ) : sablon && (
            <>
              {ayarlar?.kullanimNotu && (
                <div className="sf-not"><b>Kullanım notu:</b> {ayarlar.kullanimNotu}</div>
              )}

              {sablon.bolumler.map((bolum, bolumIndex) => (
                <section key={bolum.id} className="sf-kart" style={{ '--sf-renk': BOLUM_RENKLERI[bolumIndex % BOLUM_RENKLERI.length] } as React.CSSProperties}>
                  <div className="sf-kart-bas">
                    <span className="sf-no">{bolumIndex + 1}</span>
                    <span className="sf-kart-baslik">{bolum.baslik}</span>
                  </div>
                  {bolum.aciklama && <div className="sf-aciklama">{bolum.aciklama}</div>}
                  <div>
                    {(() => {
                      // Kullanici istegi (2026-10-13, 3. tur): imzalar YAN YANA -
                      // solda basvuru sahibi, sagda personel (renk tonuyla ayrik);
                      // personel adi-soyadi, personel imzasinin kutusunda ustte.
                      // 2026-10-15: birden fazla personel imzasi - her birinin
                      // ustunde kendi ad alani (ortak duzen: imzaDuzeni).
                      const duzen = imzaDuzeni(bolum.sorular)
                      const sirali = duzen.siraliImzalar
                      const satirlar = duzen.satirlar
                      // Ekip personelinden secim: ekip uyeleri + (listede yoksa) mevcut deger
                      const personelAdAlani = (adSoru: Soru) => {
                        if (ekipGruplari.length === 0) return soruAlani(adSoru)
                        const mevcut = String(cevaplar[String(adSoru.id)] ?? '').trim()
                        const listede = ekipGruplari.some((g) => g.uyeler.includes(mevcut))
                        const tekEkip = ekipGruplari.length === 1
                        return (
                          <select
                            value={mevcut}
                            onChange={(e) => setCevap(adSoru, e.target.value)}
                            className="sf-input"
                          >
                            <option value="">— Personel seçin —</option>
                            {mevcut && !listede && <option value={mevcut}>{mevcut}</option>}
                            {tekEkip
                              ? ekipGruplari[0].uyeler.map((ad) => <option key={ad} value={ad}>{ad}</option>)
                              : ekipGruplari.map((g) => (
                                <optgroup key={g.ad} label={g.ad}>
                                  {g.uyeler.map((ad) => <option key={`${g.ad}-${ad}`} value={ad}>{ad}</option>)}
                                </optgroup>
                              ))}
                          </select>
                        )
                      }
                      const basvuruImzalari = sirali.filter((s) => !duzen.personelImzasiMi(s))
                      return (
                        <>
                          {satirlar.map((soru) => (
                            <div
                              key={soru.id}
                              id={`saha-soru-${soru.id}`}
                              className={`sf-satir${genisMi(soru) ? ' sf-genis' : ''}${adresSorusuMu(soru) ? ' sf-adres-satiri' : ''}${eksikler.includes(soru.id) ? ' sf-eksik' : ''}`}
                            >
                              <div className="sf-etiket">
                                <span>
                                  {soru.soruMetni}
                                  {soru.zorunlu && (!ziyaretYapilmadi || soru.anahtar === 'ziyaret_sonucu') && <span className="sf-zorunlu"> *</span>}
                                  {soru.ipucu && <span className="sf-ipucu">{soru.ipucu}</span>}
                                </span>
                              </div>
                              <div className="sf-alan">{soruAlani(soru)}</div>
                            </div>
                          ))}
                          {bolum.id === ilkImzaBolumId && personelRaporuPaneli}
                          {sirali.length > 0 && (
                            <div className={`sf-imzalar${duzen.ciftler.length > 1 ? ' sf-imzalar-ekip' : ''}`}>
                              {basvuruImzalari.map((soru) => (
                                <div key={soru.id} id={`saha-soru-${soru.id}`} className={`sf-imza-kart ton-basvuru${eksikler.includes(soru.id) ? ' sf-eksik' : ''}`}>
                                  <div className="sf-imza-kart-bas">
                                    <span className="ikon">✍</span>
                                    <span>
                                      {soru.soruMetni}
                                      {soru.zorunlu && (!ziyaretYapilmadi || soru.anahtar === 'ziyaret_sonucu') && <span className="sf-zorunlu"> *</span>}
                                      {soru.ipucu && <span className="sf-ipucu">{soru.ipucu}</span>}
                                    </span>
                                  </div>
                                  <div className="sf-imza-kart-govde">{soruAlani(soru)}</div>
                                </div>
                              ))}
                              {/* 2026-10-15: personel imzalari TEK kartta yan yana -
                                  her birinin ustunde ekip personelinden secilen ad. */}
                              {duzen.ciftler.length > 0 && (
                                <div className="sf-imza-kart ton-personel">
                                  <div className="sf-imza-kart-bas">
                                    <span className="ikon">✍</span>
                                    <span>
                                      {duzen.ciftler.length > 1 ? 'Personel imzaları' : duzen.ciftler[0].imza.soruMetni}
                                      {duzen.ciftler[0].imza.zorunlu && !ziyaretYapilmadi && <span className="sf-zorunlu"> *</span>}
                                      {duzen.ciftler.length > 1 && <span className="sf-ipucu">Ziyarete katılan personel adını listeden seçip imzalasın; ikinci personel isteğe bağlıdır.</span>}
                                    </span>
                                  </div>
                                  <div className="sf-imza-kart-govde sf-imza-ciftler">
                                    {duzen.ciftler.map(({ imza, ad }, i) => (
                                      <div key={imza.id} id={`saha-soru-${imza.id}`} className={`sf-imza-cift${eksikler.includes(imza.id) || (ad && eksikler.includes(ad.id)) ? ' sf-eksik' : ''}`}>
                                        {ad ? (
                                          <label className="sf-imza-ad" id={`saha-soru-${ad.id}`}>
                                            <span>{duzen.ciftler.length > 1 ? `${i + 1}. Personel` : ad.soruMetni}{ad.zorunlu && !ziyaretYapilmadi && <span className="sf-zorunlu"> *</span>}</span>
                                            {personelAdAlani(ad)}
                                          </label>
                                        ) : (
                                          <span className="sf-imza-cift-baslik">{imza.soruMetni}</span>
                                        )}
                                        {soruAlani(imza)}
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              )}
                            </div>
                          )}
                        </>
                      )
                    })()}
                  </div>
                  {ayarlar?.sonNot && bolum.sorular.some((s) => s.anahtar === 'on_degerlendirme') && (
                    <div className="sf-son-not">{ayarlar.sonNot}</div>
                  )}
                </section>
              ))}

              {/* Kullanici istegi (2026-10-13): "doldurulan cevaplara gore altta
                  kurumsal ve profesyonel bir ozet rapor" - formla birlikte canli
                  guncellenir (bkz. ozetRaporuUret); paragrafi Ev Ziyareti'ne yazilir. */}
              <section className="sf-rapor">
                <div className="sf-rapor-bas">
                  <div>
                    <div className="sf-rapor-ust">Sosyal İnceleme Özet Raporu</div>
                    <div className="sf-rapor-alt">
                      {[dosyaBilgileri?.fullName && temiz(dosyaBilgileri.fullName), `Dosya ID ${dosyaid}`, new Date().toLocaleDateString('tr-TR')].filter(Boolean).join(' · ')}
                    </div>
                  </div>
                  <span className="sf-rapor-doluluk" title="Doldurulan alan / toplam alan">
                    {rapor.doluAlan} / {rapor.toplamAlan} alan dolduruldu
                  </span>
                </div>

                <div className="sf-gostergeler">
                  {rapor.gostergeler.map((g) => (
                    <div key={g.etiket} className={`sf-gosterge ton-${g.ton}`}>
                      <span className="e">{g.etiket}</span>
                      <span className="d">{g.deger}</span>
                    </div>
                  ))}
                </div>

                {/* 2026-10-14 kullanici istegi: "Değerlendirme" kutusu kaldirildi -
                    ayni bilginin ozeti en alttaki "Özet Rapor"da zaten gorunuyor.
                    (Yazdirma ciktisi bu degisiklikten etkilenmez.) */}

                {/* 2026-10-13 (6. tur) kullanici istegi: "Otomatik özet rapor" ve
                    "Birleştirilmiş tahkikat raporu" kutulari kaldirildi - altta
                    yalnizca ustteki ozet bilgi + personel raporu. Birlesik rapor
                    arka planda otomatik uretilip kaydedilir (cikti/Ev Ziyareti). */}
                {!ilkImzaBolumId && personelRaporuPaneli}

                <div className="sf-rapor-dip">
                  Bu özet, formdaki beyan, belge ve gözlemlerden otomatik oluşturulmuştur; tek başına onay/ret kararı niteliği taşımaz.
                </div>
              </section>
            </>
          )}

          {/* 2026-10-13 kullanici istegi: formun EN ALTINDA, kayitli form
              kartlariyla ayni gorunumde, BU formun cevaplarindan canli
              olusan ozet. */}
          {sablon && !isLoading && (
            <section className="sf-kart sf-ozet-rapor" style={{ '--sf-renk': '#1d4ed8' } as React.CSSProperties}>
              <div className="sf-kart-bas">
                <span className="sf-kart-baslik">Özet Rapor</span>
                <span className="sf-kart-sag">cevaplar değiştikçe güncellenir</span>
              </div>
              <div className="sf-ozet-govde">
                <div className="sf-ozet-icerik rounded-lg border border-slate-200 bg-white p-2 shadow-sm">
                  <p className="text-[12px] font-black text-slate-900">
                    {kayitTarihi ?? new Date().toLocaleDateString('tr-TR')} — {formPersoneli || 'Personel belirtilmemiş'}
                    {kaydedilenFormId && <span className="ml-1.5 text-[10px] font-bold text-slate-400">Form No: {kaydedilenFormId}</span>}
                  </p>
                  {(ozetZiyaretSonucu || ozetAciliyet) && (
                    <div className="mt-1 flex flex-wrap items-center gap-1">
                      {ozetZiyaretSonucu && (
                        <span className="rounded-full border border-sky-200 bg-sky-50 px-2 py-0.5 text-[10px] font-black text-sky-700">{ozetZiyaretSonucu}</span>
                      )}
                      {ozetAciliyet && (
                        <span className={`rounded-full border px-2 py-0.5 text-[10px] font-black ${ACILIYET_SINIFLARI[ozetAciliyet] || 'border-slate-300 bg-slate-50 text-slate-600'}`}>Aciliyet: {ozetAciliyet}</span>
                      )}
                    </div>
                  )}
                  <p className="mt-1.5 text-[11px] font-semibold leading-snug text-slate-600">
                    {ozetCumleleri.form || 'Form doldurulduğunda özet burada oluşur.'}
                  </p>
                  {/* 2026-10-14: personel raporu ozetin altinda, PERSONEL basligiyla yeni satirda */}
                  {ozetCumleleri.personel && (
                    <div className="mt-2 border-t border-slate-200 pt-1.5">
                      <p className="text-[10.5px] font-black uppercase tracking-wide text-slate-800">Personel</p>
                      <p className="mt-0.5 whitespace-pre-wrap text-[11px] font-semibold leading-snug text-slate-600">{ozetCumleleri.personel}</p>
                    </div>
                  )}
                </div>
              </div>
            </section>
          )}
        </div>

        <div className="sf-alt-cubuk">
          <a
            href={`/api/documents/saha-inceleme/yazdir?dosyaId=${encodeURIComponent(dosyaid)}&yazdir=1`}
            target="_blank"
            rel="noreferrer"
            title="Sahaya götürmek için bu dosyanın başvuru numarasıyla boş form yazdırır"
            className="sf-btn"
          >
            Boş Form Yazdır (sahaya götürmek için)
          </a>
          <div style={{ display: 'flex', gap: 8 }}>
            {/* 2026-10-13: kayittan sonra alt cubukta yalnizca "Boş Form Yazdır"
                kaliyordu - kullanici onu tiklayip bos cikti aliyordu. Doldurulan
                formun ciktisi burada ana dugme olarak. */}
            {kaydedilenFormId && (
              <a href={`/api/documents/saha-inceleme/yazdir?id=${kaydedilenFormId}&yazdir=1`} target="_blank" rel="noreferrer" className="sf-btn ana">
                Doldurulan Formu Yazdır
              </a>
            )}
            <button type="button" onClick={() => void handleSave()} disabled={isSaving || isLoading || !sablon} className="sf-btn ana">
              {isSaving ? 'Kaydediliyor...' : kaydedilenFormId ? 'Güncelle' : 'Kaydet'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
