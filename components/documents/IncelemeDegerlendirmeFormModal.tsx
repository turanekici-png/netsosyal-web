'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { evaluateForm, getKararRenk } from '@/app/api/documents/inceleme-degerlendirme/_lib/scoring'
import type { CevapPayload } from '@/app/api/documents/inceleme-degerlendirme/_lib/types'
import type { SoruRow } from '@/lib/constants/incelemeDegerlendirmeForm'
import IncelemeDegerlendirmeGecmisiPaneli from './IncelemeDegerlendirmeGecmisiPaneli'

// Kullanici istegi (13 Eylul 2026): "kisisel bilgileri dosyadan otomatik
// cekesin" - dosyada zaten var olan kimlik/ad soyad/telefon/adres bilgisi
// ve giris yapan personelin adi, form her acildiginda Kişi Bilgileri
// bolumune otomatik dolduruluyor (kullanici yine de degistirebilir).
type DosyaBilgileri = {
  identityNumber?: string
  fullName?: string
  mobilePhone?: string
  address?: string
  personelAdi?: string
}

// Kullanici istegi (13 Eylul 2026): "Geçmiş Formlar" alaninda bu dosya icin
// en son doldurulmus Guncelleme Formu ve On Inceleme bilgileri de
// gorunsun - eski (artik dormant) İnceleme Formu modalinin zaten yaptigi
// fetch/cozumleme (documents/page.tsx: fetchPriorFormSummaries,
// resolvedPriorUpdateFormAnswers, resolvedPriorPreliminaryReviewAnswers)
// parent'tan prop olarak aliniyor - ayni mantigi burada tekrarlamaya gerek
// yok, parent zaten hesapliyor.
type OncekiGuncellemeFormu = {
  aciklama: string | null
  cevaplar: { title: string; labels: string[] }[]
}
type OncekiOnInceleme = {
  tarih: string | null
  cevaplar: { label: string; value: string }[]
}
type OncekiAsamaBilgileri = {
  status: 'idle' | 'loading'
  guncellemeFormu: OncekiGuncellemeFormu | null
  onInceleme: OncekiOnInceleme | null
}

// Dosyaya kayitli, bu formdan BAGIMSIZ "diger kurum yardimlari" (kullanici
// istegi 13 Eylul 2026) - displayedPerson.externalAids (bkz. documents/
// page.tsx ExternalAidRow). Formun kendi digerKurumYardimlari state'i
// (asagida) bu tahkikata OZEL yeni giris icindir, KARISTIRILMASIN.
type KayitliDigerKurumYardimi = {
  date?: string
  institution?: string
  aidType?: string
  description?: string
  amount?: string
}

type Props = {
  dosyaid: string
  open: boolean
  onClose: () => void
  onSaved: () => void
  // Yonetici onayi gerektiren kayitlar icin "Onayla/Reddet" butonlarini
  // gostermek amacli - eski sistemde olmayan, sadece bu yeni akisa ozel yeni
  // bir yetki (bkz. documents.evaluationApprove).
  canApprove?: boolean
  dosyaBilgileri?: DosyaBilgileri
  oncekiAsamaBilgileri?: OncekiAsamaBilgileri
  digerKurumYardimlariKayitli?: KayitliDigerKurumYardimi[]
}

type ApiResponse<T> = { success: boolean; data?: T; error?: string }

type DigerKurumSatiri = { kurum: string; yardimTuru: string; tutar: string }

const KARAR_RENK_SINIFLARI: Record<string, string> = {
  yesil: 'border-emerald-300 bg-emerald-50 text-emerald-800',
  sari: 'border-amber-300 bg-amber-50 text-amber-800',
  turuncu: 'border-orange-300 bg-orange-50 text-orange-800',
  kirmizi: 'border-rose-300 bg-rose-50 text-rose-800',
  gri: 'border-slate-300 bg-slate-50 text-slate-700',
}

// Kullanici istegi (13 Eylul 2026): Kişi Bilgileri alani sadece TC/Ad
// Soyad/Telefon/Adres'i gostersin, digerleri kaldirilsin. TC Kimlik No ve
// Telefon hala soru bankasindaki sistem sorularina (BILGI_SORU_ESLESTIRME)
// karsilik geldigi icin cevaplar tablosuna da yaziliyor; Ad Soyad/Adres ise
// dogrudan formun kendi kolonlari (bir soru bankasi karsiligi yok). Ziyaret
// Tarihi ve Personel Adı sorulari hala arka planda (goruntusuz) otomatik
// dolduruluyor - bkz. asagidaki reset efekti.
const BILGI_SORU_ESLESTIRME = {
  tcKimlikNo: 'TC Kimlik No',
  telefon: 'Telefon',
  tarih: 'Ziyaret Tarihi',
  personel: 'Personel Adı',
} as const

// Dosya API'si eksik alanlari '-' ile dolduruyor (bkz. app/api/documents/
// fetch/route.ts) - bunu bos alan gibi ele al, forma "-" yazilmasin.
function temizDosyaAlani(deger: string | undefined): string {
  const trimmed = (deger || '').trim()
  return trimmed === '-' ? '' : trimmed
}

// Kucuk/kompakt input siniflari - kullanici istegi (13 Eylul 2026): "alan
// ve yazi puntolari cok buyuk, sayfa geneliyle ayni yapalim" - uygulamanin
// genelinde kullanilan kompakt olcek (bkz. orn. documents/page.tsx h-8/
// text-[13px] input kaliplari) burada da uygulaniyor.
//
// Kullanici istegi (14 Eylul 2026, 2. tur): "web tarafında yazı puntoları
// çok büyük... küçülterek daha stabil ve optimize... profesyonel görünüm" -
// bir onceki turda kompaktlastirilan degerler burada BIR KADEME DAHA
// kucultuldu (hem web hem mobilde ayni siniflar kullanildigi icin ikisini
// de etkiler).
const INPUT_CLASS = 'mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-[12px] font-semibold text-slate-900 outline-none focus:border-sky-500'
const LABEL_CLASS = 'text-[10px] font-bold text-slate-600'
const SECENEK_BTN_BASE = 'w-full rounded-md border px-2 py-1.5 text-left text-[11px] font-bold transition'
const SORU_METNI_CLASS = 'mb-1.5 text-left text-[11.5px] font-black text-slate-800'

// Kullanici istegi (14 Eylul 2026, 2. tur): "soru başlıklarını renklendir
// ve alanları renk tonlaması ile ayır" - her bolumun soru metni, o
// bolumun aksan rengiyle (Eleme=rose, Degerlendirme=emerald, Gözlem=amber)
// tonlanir; bolum-bagimsiz varsayilan slate-800 kalir (ör. Kişi Bilgileri
// icindeki kullanici bilgi sorulari).
const SORU_METNI_RENK: Record<string, string> = {
  kriter: 'text-rose-900',
  degerlendirme: 'text-emerald-900',
  gozlem: 'text-amber-900',
}

export default function IncelemeDegerlendirmeFormModal({ dosyaid, open, onClose, onSaved, canApprove, dosyaBilgileri, oncekiAsamaBilgileri, digerKurumYardimlariKayitli }: Props) {
  const [sorular, setSorular] = useState<SoruRow[]>([])
  const [isLoadingSorular, setIsLoadingSorular] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [status, setStatus] = useState('')
  const [gecmisAcik, setGecmisAcik] = useState(false)

  const [tarih, setTarih] = useState('')
  const [personel, setPersonel] = useState('')
  const [tcKimlikNo, setTcKimlikNo] = useState('')
  const [adSoyad, setAdSoyad] = useState('')
  const [telefon, setTelefon] = useState('')
  const [adres, setAdres] = useState('')
  const [haneKisiSayisi, setHaneKisiSayisi] = useState('')
  const [yardimTuruOnerisi, setYardimTuruOnerisi] = useState('')
  const [yardimTuruOnerisiDuzenlendi, setYardimTuruOnerisiDuzenlendi] = useState(false)
  const [digerKurumYardimlari, setDigerKurumYardimlari] = useState<DigerKurumSatiri[]>([])
  const [gelirTutari, setGelirTutari] = useState('')

  const [cevaplar, setCevaplar] = useState<Record<number, { secilenSecenekler?: number[]; metinCevap?: string; sayiCevap?: number }>>({})

  const loadedRef = useRef(false)

  useEffect(() => {
    if (!open || loadedRef.current) return
    loadedRef.current = true

    // Onceki doldurmadan kalan taslak veriyi temizle ve dosyadaki mevcut
    // kimlik/ad soyad/telefon/adres bilgisiyle + giris yapan personelin
    // adiyla Kişi Bilgileri bolumunu otomatik doldur (kullanici istegi
    // 13 Eylul 2026). Tarih (bugun) ve Personel artik ekranda gosterilmiyor,
    // arka planda otomatik set ediliyor.
    setTarih(new Date().toISOString().slice(0, 10))
    setPersonel(temizDosyaAlani(dosyaBilgileri?.personelAdi))
    setTcKimlikNo(temizDosyaAlani(dosyaBilgileri?.identityNumber))
    setAdSoyad(temizDosyaAlani(dosyaBilgileri?.fullName))
    setTelefon(temizDosyaAlani(dosyaBilgileri?.mobilePhone))
    setAdres(temizDosyaAlani(dosyaBilgileri?.address))
    setHaneKisiSayisi('')
    setYardimTuruOnerisi('')
    setYardimTuruOnerisiDuzenlendi(false)
    setDigerKurumYardimlari([])
    setGelirTutari('')
    setCevaplar({})
    setStatus('')

    const load = async () => {
      setIsLoadingSorular(true)
      try {
        const response = await fetch('/api/documents/inceleme-degerlendirme/sorular', { cache: 'no-store' })
        const payload = await response.json() as ApiResponse<SoruRow[]>
        if (response.ok && payload.success && payload.data) {
          setSorular(payload.data)
        } else {
          setStatus(payload.error || 'Sorular yüklenemedi.')
        }
      } catch {
        setStatus('Sorular yüklenemedi.')
      } finally {
        setIsLoadingSorular(false)
      }
    }

    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  useEffect(() => {
    if (!open) loadedRef.current = false
  }, [open])

  const bilgiSoruIdByLabel = useMemo(() => {
    const map: Partial<Record<keyof typeof BILGI_SORU_ESLESTIRME, number>> = {}
    for (const [key, label] of Object.entries(BILGI_SORU_ESLESTIRME)) {
      const soru = sorular.find((s) => s.bolum === 'bilgi' && s.soruMetni === label)
      if (soru) map[key as keyof typeof BILGI_SORU_ESLESTIRME] = soru.id
    }
    return map
  }, [sorular])

  // Sistem bilgi sorulari (TC/Telefon dahil - Ziyaret Tarihi, Personel Adı,
  // İl, İlçe, Köy/Mahalle, Muhtar Adı Soyadı) artik bu ekranda hic
  // gosterilmiyor (kullanici istegi 13 Eylul 2026) - sadece kullanicinin
  // Ayarlar'dan SONRADAN eklediği ozel bilgi sorulari burada listelenir.
  const kullaniciBilgiSorulari = useMemo(
    () => sorular.filter((s) => s.bolum === 'bilgi' && !s.sistemSorusu),
    [sorular],
  )
  const kriterSorulari = useMemo(() => sorular.filter((s) => s.bolum === 'kriter'), [sorular])
  const degerlendirmeSorulari = useMemo(() => sorular.filter((s) => s.bolum === 'degerlendirme'), [sorular])
  const gozlemSorulari = useMemo(() => sorular.filter((s) => s.bolum === 'gozlem'), [sorular])

  const gelirSorusu = useMemo(() => degerlendirmeSorulari.find((s) => s.puanlamaKurali === 'gelir_kademeli'), [degerlendirmeSorulari])
  // Secenek metni Ayarlar'dan serbestce degistirilebildigi icin (kullanici
  // istegi 13 Eylul 2026) metne gore degil, seed sirasindaki 2. seceneğe
  // (en yuksek "sira") gore "gelir var" secenegini buluyoruz - sayisal
  // gelir alani bu secenek secildiginde acilir.
  const gelirVarSecenegi = useMemo(() => {
    if (!gelirSorusu || gelirSorusu.secenekler.length < 2) return undefined
    return [...gelirSorusu.secenekler].sort((a, b) => b.sira - a.sira)[0]
  }, [gelirSorusu])
  const gelirSecili = gelirSorusu ? cevaplar[gelirSorusu.id]?.secilenSecenekler?.[0] : undefined

  const setSecilenTek = (soru: SoruRow, secenekId: number) => {
    setCevaplar((current) => ({ ...current, [soru.id]: { secilenSecenekler: [secenekId] } }))
  }

  const toggleSecilenCoklu = (soru: SoruRow, secenekId: number) => {
    setCevaplar((current) => {
      const mevcut = current[soru.id]?.secilenSecenekler || []
      const yeni = mevcut.includes(secenekId) ? mevcut.filter((id) => id !== secenekId) : [...mevcut, secenekId]
      return { ...current, [soru.id]: { secilenSecenekler: yeni } }
    })
  }

  const setMetinCevap = (soru: SoruRow, metin: string) => {
    setCevaplar((current) => ({ ...current, [soru.id]: { metinCevap: metin } }))
  }

  // Anlik onizleme icin - backend'deki AYNI saf fonksiyonu kullanir (tek
  // kaynak, iki ayri puanlama mantigi bakim sorunu yaratmasin diye).
  const onizlemeSonuc = useMemo(() => {
    if (!gelirSorusu) return null
    const cevapListesi: CevapPayload[] = Object.entries(cevaplar).map(([soruId, cevap]) => ({ soruId: Number(soruId), ...cevap }))
    if (cevapListesi.length === 0) return null
    return evaluateForm(cevapListesi, sorular, Number(haneKisiSayisi) || null)
  }, [cevaplar, sorular, gelirSorusu, haneKisiSayisi])

  const eliminasyonTetiklendi = onizlemeSonuc?.eliminasyonSonucu === 'RED'

  // Karar araligina gore onerilen varsayilan yardim turunu otomatik doldur -
  // personel elle bir seyler yazdiktan sonra ("duzenlendi") bir daha
  // ustune yazma, sadece bos/dokunulmamis haldeyken senkron tut.
  useEffect(() => {
    if (yardimTuruOnerisiDuzenlendi) return
    const oneri = onizlemeSonuc?.yardimTuruOnerisiOnerilen
    if (oneri) setYardimTuruOnerisi(oneri)
  }, [onizlemeSonuc?.yardimTuruOnerisiOnerilen, yardimTuruOnerisiDuzenlendi])

  const addDigerKurumSatiri = () => {
    setDigerKurumYardimlari((current) => [...current, { kurum: '', yardimTuru: '', tutar: '' }])
  }
  const removeDigerKurumSatiri = (index: number) => {
    setDigerKurumYardimlari((current) => current.filter((_, i) => i !== index))
  }
  const updateDigerKurumSatiri = (index: number, patch: Partial<DigerKurumSatiri>) => {
    setDigerKurumYardimlari((current) => current.map((satir, i) => (i === index ? { ...satir, ...patch } : satir)))
  }

  const cevaplanmisKriterler = useMemo(() => kriterSorulari.filter((s) => cevaplar[s.id]), [kriterSorulari, cevaplar])
  const cevaplanmisDegerlendirmeler = useMemo(() => degerlendirmeSorulari.filter((s) => cevaplar[s.id]), [degerlendirmeSorulari, cevaplar])
  const cevaplanmisGozlemler = useMemo(() => gozlemSorulari.filter((s) => cevaplar[s.id]), [gozlemSorulari, cevaplar])
  const ozetGosterilsinMi = cevaplanmisKriterler.length > 0 || cevaplanmisDegerlendirmeler.length > 0 || cevaplanmisGozlemler.length > 0

  // Kullanici istegi (13 Eylul 2026): "kısa ve kurumsal metin şeklinde,
  // örneğin hanede çalışabilecek birey yok, evi kira, araç kaydı yok, 2
  // öğrencisi var şeklinde olsun" - alan/deger listesi yerine akici, kisa
  // bir metin ozeti. Soru metni SISTEM sorulari icin degistirilemez oldugu
  // (bkz. sorular/[id] route.ts) icin burada soru metnine gore eslestirme
  // GUVENLE yapilabilir; secenek METNI ise Ayarlar'dan degistirilebildigi
  // icin eslestirme secenegin SIRASINA gore yapiliyor (metnine gore degil) -
  // boylece admin seçenek yazisini rötuşlasa bile ozet cumlesi kirilmiyor.
  // Bu tabloda olmayan (kullanicinin sonradan Ayarlar'dan ekledigi) sorular
  // icin otomatik olarak genel bir yedek ifade uretilir (bkz. asagida).
  const OZET_IFADE_TABLOSU: Record<string, (siralar: number[], sayiCevap?: number) => (string | null)[]> = {
    'Başvuru sahibi veya hanedeki herhangi bir birey adına taşınmaz kaydı var mı?': (s) => {
      if (s.includes(1) && s.length === 1) return ['taşınmaz kaydı yok']
      const parca: string[] = []
      if (s.includes(2)) parca.push('bir konutu var')
      if (s.includes(3)) parca.push('birden fazla taşınmazı var')
      if (s.includes(4)) parca.push('hisseli taşınmazı var')
      return parca
    },
    'Hanedeki herhangi bir birey adına belediyemizin belirlediği model sınırının üzerinde veya birden fazla araç kaydı var mı?': (s) => [s.includes(2) ? 'araç kaydı var' : 'araç kaydı yok'],
    'Hanedeki herhangi bir birey adına aktif vergi mükellefiyet kaydı bulunuyor mu?': (s) => [s.includes(2) ? 'vergi mükellefi' : 'vergi mükellefiyeti yok'],
    'Hanedeki herhangi bir bireyin aktif SGK sigorta kaydı var mı?': (s) => [s.includes(2) ? 'aktif SGK kaydı var' : 'SGK kaydı yok'],
    'Hanede 18-55 yaş arasında, sağlıklı ve çalışabilir durumda birey var mı? (Engelli, öğrenci, asker, tutuklu veya çalışamaz hasta hariç - belge zorunludur)': (s) => [s.includes(2) ? 'hanede çalışabilecek birey var' : 'hanede çalışabilecek birey yok'],
    'Başvuru sahibinin nüfusa kayıtlı adresi Sivas Merkez mi?': (s) => [s.includes(2) ? 'Sivas Merkez dışında ikamet ediyor' : 'Sivas Merkez\'de ikamet ediyor'],
    'Hanenin toplam aylık geliri belediyemizin belirlediği gelir limitini aşıyor mu?': (s) => [s.includes(2) ? 'gelir limitini aşıyor' : 'geliri limitin altında'],
    'Hanenin toplam aylık geliri nedir?': (s, sayi) => [s.includes(2) && sayi ? `aylık geliri ${sayi} TL` : 'hanede geliri yok'],
    'Hanenin geliri nasıl sağlanmaktadır? (Birden fazla seçilebilir)': (s) => [
      s.includes(1) ? 'düzenli geliri yok' : null,
      s.includes(2) ? 'sosyal yardımla geçiniyor' : null,
      s.includes(3) ? 'nafaka geliri var' : null,
      s.includes(4) ? 'düzensiz işlerden geçiniyor' : null,
      s.includes(5) ? 'kira geliri var' : null,
    ],
    'Başvuru sahibinin yaşadığı konut için hangisi geçerlidir?': (s) => [
      s.includes(1) ? 'kendi evinde oturuyor' : s.includes(2) ? 'evi kira' : s.includes(3) ? 'sosyal konutta oturuyor' : s.includes(4) ? 'yakınının evinde kira ödemeden kalıyor' : null,
    ],
    'Yerinde yapılan incelemede konuta ilişkin hangisi gözlemlenmiştir?': (s) => [
      s.includes(1) ? 'konutta ciddi yapısal sorun var' : s.includes(2) ? 'konut bakımsız/rutubetli' : null,
    ],
    'Hanede kaç kişi yaşamaktadır?': (s) => [
      s.includes(1) ? 'hanede 1-2 kişi yaşıyor' : s.includes(2) ? 'hanede 3-4 kişi yaşıyor' : s.includes(3) ? 'hanede 5-6 kişi yaşıyor' : s.includes(4) ? 'hanede 7 ve üzeri kişi yaşıyor' : null,
    ],
    'Hanede sağlık durumu geçim koşullarını olumsuz etkileyen birey var mı? (Birden fazla seçilebilir)': (s) => [
      s.includes(1) ? 'ağır hastalık var' : null,
      s.includes(2) ? 'kronik hastalık var' : null,
      s.includes(3) ? '%80 üzeri engelli birey var' : null,
      s.includes(4) ? '%40-79 engelli birey var' : null,
    ],
    'Hanenin genel yapısı nasıldır?': (s) => [
      s.includes(1) ? 'dul' : s.includes(2) ? 'eşi cezaevinde' : s.includes(3) ? 'boşanmış, tek yaşıyor' : s.includes(4) ? 'anne/babasıyla yaşıyor' : s.includes(5) ? 'imam nikahıyla yaşıyor' : null,
    ],
    'Başvuru sahibinin yardım alabileceği yakını ya da sosyal çevresi var mı?': (s) => [
      s.includes(1) ? 'sosyal desteği yok' : s.includes(2) ? 'sınırlı sosyal desteği var' : s.includes(3) ? 'düzenli aile desteği var' : null,
    ],
    'Ziyaret sırasında evde yeterli yiyecek gözlemlendi mi?': (s) => [s.includes(3) ? 'beslenme yetersiz' : s.includes(2) ? 'beslenme kısmen yetersiz' : null],
    'Konutun ısınma sistemi çalışır durumda mı?': (s) => [s.includes(3) ? 'ısınma sistemi çalışmıyor' : s.includes(2) ? 'ısınma kısmen yetersiz' : null],
    'Hanedeki öğrenci durumu nedir?': (s) => [s.includes(1) ? 'ilköğretim çağında öğrencisi var' : s.includes(2) ? 'üniversite çağında öğrencisi var' : null],
    'Başvuru sahibinin beyanı ile yerinde yapılan gözlem örtüşüyor mu?': (s) => [s.includes(3) ? 'beyan ile gözlem arasında ciddi çelişki var' : s.includes(2) ? 'beyan ile gözlemde küçük farklılıklar var' : null],
  }

  const soruIfadeleri = (soru: SoruRow): string[] => {
    const cevap = cevaplar[soru.id]
    if (!cevap) return []
    if (soru.secimTuru === 'metin') return []

    const siralar = (cevap.secilenSecenekler || [])
      .map((id) => soru.secenekler.find((s) => s.id === id)?.sira)
      .filter((sira): sira is number => sira !== undefined)

    const uretici = OZET_IFADE_TABLOSU[soru.soruMetni]
    if (uretici) {
      return uretici(siralar, cevap.sayiCevap).filter((metin): metin is string => Boolean(metin))
    }

    // Tabloda olmayan (Ayarlar'dan sonradan eklenmis) sorular icin yedek:
    // secilen secenek metinlerini oldugu gibi kullan.
    const secilenMetinler = (cevap.secilenSecenekler || [])
      .map((id) => soru.secenekler.find((s) => s.id === id)?.secenekMetni)
      .filter((metin): metin is string => Boolean(metin))
    return secilenMetinler.length > 0 ? [secilenMetinler.join(' / ').toLocaleLowerCase('tr-TR')] : []
  }

  // Kullanici istegi (13 Eylul 2026): "en alta verilen cevaplara göre bir
  // özet rapor yapalım... kısa ve kurumsal metin şeklinde olsun". Kaydetme
  // oncesi tek paragraflik, akici bir gozden gecirme ozeti uretir.
  const ozetParagrafi = useMemo(() => {
    if (eliminasyonTetiklendi) {
      return `Kriter değerlendirmesi sonucunda başvuru elenmiştir: ${onizlemeSonuc?.eliminasyonRedNedeni || ''}`
    }

    const parcalar: string[] = []
    for (const soru of cevaplanmisKriterler) parcalar.push(...soruIfadeleri(soru))
    for (const soru of cevaplanmisDegerlendirmeler) parcalar.push(...soruIfadeleri(soru))
    for (const soru of cevaplanmisGozlemler) parcalar.push(...soruIfadeleri(soru))

    let cumle = parcalar.filter(Boolean).join(', ')
    if (cumle) cumle = cumle.charAt(0).toLocaleUpperCase('tr-TR') + cumle.slice(1) + '.'

    const digerKurumMetinleri = [
      ...(digerKurumYardimlariKayitli || []).map((row) => `${row.institution || 'Kurum belirtilmemiş'}${row.aidType ? ` - ${row.aidType}` : ''}${row.amount ? ` (${row.amount} TL)` : ''}`),
      ...digerKurumYardimlari.filter((s) => s.kurum.trim()).map((s) => `${s.kurum}${s.yardimTuru ? ` - ${s.yardimTuru}` : ''}${s.tutar ? ` (${s.tutar} TL)` : ''}`),
    ]
    const digerKurumCumlesi = digerKurumMetinleri.length > 0 ? ` Kayıtlı diğer kurum yardımı: ${digerKurumMetinleri.join('; ')}.` : ''

    const sonucCumlesi = onizlemeSonuc
      ? ` Toplam puan ${onizlemeSonuc.toplamPuan ?? 0}/100, ${onizlemeSonuc.karar}.${yardimTuruOnerisi ? ` Öneri: ${yardimTuruOnerisi}.` : ''}`
      : ''

    return `${cumle}${digerKurumCumlesi}${sonucCumlesi}`.trim()
  }, [eliminasyonTetiklendi, onizlemeSonuc, cevaplanmisKriterler, cevaplanmisDegerlendirmeler, cevaplanmisGozlemler, cevaplar, digerKurumYardimlariKayitli, digerKurumYardimlari, yardimTuruOnerisi])

  const handleSave = async () => {
    if (isSaving) return
    setIsSaving(true)
    setStatus('')

    try {
      const finalCevaplar: CevapPayload[] = Object.entries(cevaplar).map(([soruId, cevap]) => ({ soruId: Number(soruId), ...cevap }))

      // Bilgi bolumundeki ozel alanlari (dedike kolonlara sahip sistem
      // sorulari) cevaplar dizisine de ekle - hem inceleme_form_cevaplar
      // tablosunda gorunsunler hem de puanlama motoru bunlari okuyabilsin.
      const bilgiEkle = (key: keyof typeof BILGI_SORU_ESLESTIRME, metin: string) => {
        const soruId = bilgiSoruIdByLabel[key]
        if (soruId && metin.trim()) finalCevaplar.push({ soruId, metinCevap: metin.trim() })
      }
      bilgiEkle('tcKimlikNo', tcKimlikNo)
      bilgiEkle('telefon', telefon)
      bilgiEkle('tarih', tarih)
      bilgiEkle('personel', personel)

      if (gelirSorusu && gelirVarSecenegi && gelirSecili === gelirVarSecenegi.id) {
        const soruId = gelirSorusu.id
        const index = finalCevaplar.findIndex((c) => c.soruId === soruId)
        const sayiCevap = Number(gelirTutari.replace(',', '.')) || 0
        if (index >= 0) finalCevaplar[index] = { ...finalCevaplar[index], sayiCevap }
      }

      const response = await fetch('/api/documents/inceleme-degerlendirme', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          dosyaid,
          tarih: tarih || null,
          personel: personel || null,
          tcKimlikNo: tcKimlikNo || null,
          adSoyad: adSoyad || null,
          telefon: telefon || null,
          adres: adres || null,
          haneKisiSayisi: haneKisiSayisi ? Number(haneKisiSayisi) : null,
          yardimTuruOnerisi: yardimTuruOnerisi || null,
          digerKurumYardimlari: digerKurumYardimlari
            .filter((satir) => satir.kurum.trim())
            .map((satir) => ({ kurum: satir.kurum, yardimTuru: satir.yardimTuru || undefined, tutar: satir.tutar ? Number(satir.tutar) : null })),
          // Kullanici istegi (13 Eylul 2026): "tahkikat gorevlisinin
          // doldurmus oldugu rapor ozetini... Ev Ziyareti alanina... yazsin"
          // - asagida uretilen kisa/kurumsal ozetParagrafi, backend'in
          // evziyareti tablosuna (Dosya İşlemleri > Ev Ziyareti Formları,
          // Sonuç Bekleyen > Son Ev Ziyareti) yazacagi metindir.
          raporOzeti: ozetParagrafi || null,
          cevaplar: finalCevaplar,
        }),
      })
      const payload = await response.json() as ApiResponse<null>

      if (!response.ok || !payload.success) {
        throw new Error(payload.error || 'Tahkikat formu kaydedilemedi.')
      }

      onSaved()
      onClose()
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Tahkikat formu kaydedilemedi.')
    } finally {
      setIsSaving(false)
    }
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-[2100] flex items-center justify-center bg-slate-950/75 p-2 backdrop-blur-sm md:p-4">
      <div className="relative flex max-h-[96vh] w-full max-w-[1200px] flex-col overflow-hidden rounded-xl border border-slate-300 bg-slate-50 shadow-2xl">
        {/* Kullanici istegi (13 Eylul 2026, 3. tur): "renklendirelim, basliklar
            belirgin olsun, daha profesyonel bir gorunum olsun" - uygulamanin
            genelinde (İş Akışı sayfalari) kullanilan turuncu->mavi gradyan
            aksan cubugu bu modalin ustune de eklendi. */}
        <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-orange-500 via-sky-600 to-[#0076b6]" />
        <div className="flex items-center justify-between gap-3 border-b-2 border-sky-100 bg-gradient-to-r from-sky-50 via-white to-white px-2.5 py-2 shadow-sm">
          <div className="min-w-0">
            <p className="text-[9px] font-black uppercase tracking-wide text-sky-700">Dosya İşlemleri</p>
            <h3 className="text-[14px] font-black tracking-tight text-sky-950">Tahkikat Formu</h3>
            <p className="text-[10px] font-bold text-slate-500">Dosya No: {dosyaid}</p>
          </div>
          {onizlemeSonuc && !eliminasyonTetiklendi && (
            <div className={`hidden rounded-lg border px-2 py-1 text-right shadow-sm md:block ${KARAR_RENK_SINIFLARI[getKararRenk(onizlemeSonuc.toplamPuan)]}`}>
              <span className="block text-[9px] font-black uppercase">Toplam Puan (Önizleme)</span>
              <span className="mr-2 align-middle text-[13px] font-black">{onizlemeSonuc.toplamPuan ?? 0} / 100</span>
              <span className="align-middle text-[10px] font-black">{onizlemeSonuc.karar}</span>
            </div>
          )}
          <button type="button" onClick={onClose} className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-slate-400 hover:bg-sky-100 hover:text-sky-800">✕</button>
        </div>

        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
          {status && (
            <div className="rounded-lg border border-rose-200 bg-rose-50 px-2.5 py-1.5 text-[12px] font-bold text-rose-700">{status}</div>
          )}

          <section className="overflow-hidden rounded-lg border-2 border-slate-300 bg-white shadow-sm">
            <button
              type="button"
              onClick={() => setGecmisAcik((current) => !current)}
              className="flex w-full items-center justify-between bg-slate-100 px-2.5 py-2 text-left"
            >
              <span className="flex items-center gap-1.5 text-[11.5px] font-black uppercase tracking-wide text-slate-700">
                <span className="h-3.5 w-1 rounded-full bg-slate-500" />
                Geçmiş Formlar
              </span>
              <span className="text-[11px] font-black text-sky-600">{gecmisAcik ? 'Gizle ▲' : 'Görüntüle ▼'}</span>
            </button>
            {gecmisAcik && (
              <div className="space-y-2 border-t border-slate-100 p-2">
                {oncekiAsamaBilgileri?.status === 'loading' && (
                  <div className="rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-2.5 text-center text-[11px] font-bold text-slate-500">
                    Önceki aşamaların bilgileri yükleniyor...
                  </div>
                )}

                {(oncekiAsamaBilgileri?.guncellemeFormu || oncekiAsamaBilgileri?.onInceleme) && (
                  <div className="grid gap-2.5 sm:grid-cols-2">
                    {oncekiAsamaBilgileri?.guncellemeFormu && (
                      <div className="rounded-lg border-2 border-indigo-300 bg-indigo-50/70 p-2.5 shadow-sm">
                        <p className="mb-1.5 text-[10px] font-black uppercase tracking-wide text-indigo-700">
                          Güncelleme Formu Bilgileri
                        </p>
                        {oncekiAsamaBilgileri.guncellemeFormu.cevaplar.length > 0 ? (
                          <div className="grid gap-1.5 sm:grid-cols-2">
                            {oncekiAsamaBilgileri.guncellemeFormu.cevaplar.map((item) => (
                              <div key={item.title} className="rounded-md border border-indigo-100 bg-white px-2.5 py-1.5">
                                <div className="text-[9px] font-black uppercase text-indigo-500">{item.title}</div>
                                <div className="text-[12px] font-bold text-slate-800">{item.labels.join(', ')}</div>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <p className="text-[11px] font-semibold text-slate-500">İşaretlenmiş bir cevap bulunamadı.</p>
                        )}
                        {oncekiAsamaBilgileri.guncellemeFormu.aciklama && (
                          <div className="mt-1.5 rounded-md border border-indigo-100 bg-white px-2.5 py-1.5">
                            <div className="text-[9px] font-black uppercase text-indigo-500">Açıklama</div>
                            <p className="whitespace-pre-wrap text-[12px] font-semibold text-slate-800">{oncekiAsamaBilgileri.guncellemeFormu.aciklama}</p>
                          </div>
                        )}
                      </div>
                    )}

                    {oncekiAsamaBilgileri?.onInceleme && (
                      <div className="rounded-lg border-2 border-amber-300 bg-amber-50/70 p-2.5 shadow-sm">
                        <p className="mb-1.5 text-[10px] font-black uppercase tracking-wide text-amber-700">
                          Ön İnceleme Formu Bilgileri
                        </p>
                        {oncekiAsamaBilgileri.onInceleme.cevaplar.length > 0 ? (
                          <div className="grid gap-1.5 sm:grid-cols-2">
                            {oncekiAsamaBilgileri.onInceleme.cevaplar.map((item, index) => (
                              <div key={`${item.label}-${index}`} className="rounded-md border border-amber-100 bg-white px-2.5 py-1.5">
                                <div className="text-[9px] font-black uppercase text-amber-600">{item.label}</div>
                                <div className="text-[12px] font-bold text-slate-800">{item.value}</div>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <p className="text-[11px] font-semibold text-slate-500">İşaretlenmiş bir cevap bulunamadı.</p>
                        )}
                      </div>
                    )}
                  </div>
                )}

                <IncelemeDegerlendirmeGecmisiPaneli dosyaid={dosyaid} canApprove={!!canApprove} />
              </div>
            )}
          </section>

          {isLoadingSorular ? (
            <div className="flex items-center justify-center py-24">
              <div className="h-8 w-8 animate-spin rounded-full border-4 border-sky-500 border-t-transparent" />
            </div>
          ) : (
            <>
              <section className="overflow-hidden rounded-lg border-2 border-sky-200 bg-white shadow-sm">
                <div className="flex items-center gap-1.5 border-b-2 border-sky-200 bg-sky-50 px-2 py-1.5">
                  <span className="h-3.5 w-1 rounded-full bg-sky-600" />
                  <h4 className="text-[10.5px] font-black uppercase tracking-wide text-sky-800">Kişi Bilgileri</h4>
                </div>
                <div className="p-2">
                {/* Kullanici istegi (13 Eylul 2026, 2. tur): "kişi bilgileri
                    alanı çok büyük, adres ekranda görünmüyor" - Adres,
                    TC/Ad Soyad/Telefon ile ayni dar (1/4) sutuna sikismis tek
                    satirlik input'ta tasiyordu, uzun adresler gorunmuyordu.
                    Kisa alanlar 3 dar sutuna alindi, Adres ayri bir satirda
                    tam genislikte, 2 satirlik sarilan bir textarea oldu. */}
                <div className="grid gap-2.5 sm:grid-cols-3">
                  <label className={LABEL_CLASS}>TC Kimlik No
                    <input value={tcKimlikNo} onChange={(e) => setTcKimlikNo(e.target.value)} className={INPUT_CLASS} />
                  </label>
                  <label className={LABEL_CLASS}>Ad Soyad
                    <input value={adSoyad} onChange={(e) => setAdSoyad(e.target.value)} className={INPUT_CLASS} />
                  </label>
                  <label className={LABEL_CLASS}>Telefon
                    <input value={telefon} onChange={(e) => setTelefon(e.target.value)} className={INPUT_CLASS} />
                  </label>
                </div>
                <label className={`mt-2.5 block ${LABEL_CLASS}`}>Adres
                  <textarea
                    value={adres}
                    onChange={(e) => setAdres(e.target.value)}
                    rows={2}
                    className={`${INPUT_CLASS} resize-none`}
                  />
                </label>

                {kullaniciBilgiSorulari.length > 0 && (
                  <div className="mt-2.5 grid gap-2.5 border-t border-slate-100 pt-2.5 sm:grid-cols-2 lg:grid-cols-3">
                    {kullaniciBilgiSorulari.map((soru) => (
                      <label key={soru.id} className={LABEL_CLASS}>
                        {soru.soruMetni}
                        <input
                          value={cevaplar[soru.id]?.metinCevap || ''}
                          onChange={(e) => setMetinCevap(soru, e.target.value)}
                          className={INPUT_CLASS}
                        />
                      </label>
                    ))}
                  </div>
                )}
                </div>
              </section>

              {/* Kullanici istegi (13 Eylul 2026): "Diğer Kurum Yardımları"
                  girisi Kişi Bilgileri'nin hemen altina tasindi - eskiden
                  Gözlem'in altindaydi. */}
              <section className="overflow-hidden rounded-lg border-2 border-violet-200 bg-white shadow-sm">
                <div className="flex items-center gap-1.5 border-b-2 border-violet-200 bg-violet-50 px-2 py-1.5">
                  <span className="h-3.5 w-1 rounded-full bg-violet-600" />
                  <h4 className="text-[10.5px] font-black uppercase tracking-wide text-violet-800">Diğer Kurum Yardımları</h4>
                </div>
                <div className="p-2">

                {digerKurumYardimlariKayitli && digerKurumYardimlariKayitli.length > 0 && (
                  <div className="mb-2.5 rounded-lg border border-violet-200 bg-violet-50/50 p-2">
                    <p className="mb-1.5 text-[10px] font-black uppercase tracking-wide text-violet-700">Dosyaya Kayıtlı (Önceki Bilgi)</p>
                    <div className="space-y-1">
                      {digerKurumYardimlariKayitli.map((row, index) => (
                        <div key={index} className="grid grid-cols-2 gap-1.5 rounded-md border border-violet-100 bg-white px-2.5 py-1.5 text-[11px] sm:grid-cols-4">
                          <div><span className="block text-[9px] font-black uppercase text-violet-500">Kurum</span><span className="font-bold text-slate-800">{row.institution || '-'}</span></div>
                          <div><span className="block text-[9px] font-black uppercase text-violet-500">Yardım Türü</span><span className="font-bold text-slate-800">{row.aidType || '-'}</span></div>
                          <div><span className="block text-[9px] font-black uppercase text-violet-500">Tutar</span><span className="font-bold text-slate-800">{row.amount || '-'}</span></div>
                          <div><span className="block text-[9px] font-black uppercase text-violet-500">Tarih</span><span className="font-bold text-slate-800">{row.date || '-'}</span></div>
                          {row.description && (
                            <div className="col-span-2 sm:col-span-4"><span className="block text-[9px] font-black uppercase text-violet-500">Açıklama</span><span className="font-semibold text-slate-700">{row.description}</span></div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <div className="space-y-1.5">
                  {digerKurumYardimlari.map((satir, index) => (
                    <div key={index} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_110px_32px] gap-1.5">
                      <input value={satir.kurum} onChange={(e) => updateDigerKurumSatiri(index, { kurum: e.target.value })} placeholder="Kurum" className="rounded-md border border-slate-300 px-2.5 py-1.5 text-[12px] outline-none focus:border-sky-500" />
                      <input value={satir.yardimTuru} onChange={(e) => updateDigerKurumSatiri(index, { yardimTuru: e.target.value })} placeholder="Yardım türü" className="rounded-md border border-slate-300 px-2.5 py-1.5 text-[12px] outline-none focus:border-sky-500" />
                      <input type="number" value={satir.tutar} onChange={(e) => updateDigerKurumSatiri(index, { tutar: e.target.value })} placeholder="Tutar" className="rounded-md border border-slate-300 px-2.5 py-1.5 text-[12px] outline-none focus:border-sky-500" />
                      <button type="button" onClick={() => removeDigerKurumSatiri(index)} className="flex h-7 w-7 items-center justify-center rounded-md border border-rose-200 text-rose-500 hover:bg-rose-50">×</button>
                    </div>
                  ))}
                  <button type="button" onClick={addDigerKurumSatiri} className="w-full rounded-md border border-dashed border-slate-300 py-1.5 text-[10px] font-black text-slate-500 hover:border-sky-500 hover:text-sky-600">
                    + Kurum Yardımı Ekle
                  </button>
                </div>
                </div>
              </section>

              <section className="overflow-hidden rounded-lg border-2 border-rose-300 bg-rose-50/40 shadow-sm">
                <div className="flex items-center gap-1.5 border-b-2 border-rose-300 bg-rose-100 px-2 py-1.5">
                  <span className="h-3.5 w-1 rounded-full bg-rose-600" />
                  <h4 className="text-[10.5px] font-black uppercase tracking-wide text-rose-800">Eleme Kriterleri</h4>
                </div>
                <div className="space-y-1.5 p-2">
                  {kriterSorulari.map((soru) => (
                    <div key={soru.id} className="rounded-md border border-rose-200 bg-white p-2">
                      <p className={`${SORU_METNI_CLASS} ${SORU_METNI_RENK.kriter}`}>{soru.soruMetni}</p>
                      <div className="flex flex-col items-stretch gap-1">
                        {soru.secenekler.map((secenek) => {
                          const secili = (cevaplar[soru.id]?.secilenSecenekler || []).includes(secenek.id)
                          return (
                            <button
                              key={secenek.id}
                              type="button"
                              onClick={() => soru.secimTuru === 'coklu' ? toggleSecilenCoklu(soru, secenek.id) : setSecilenTek(soru, secenek.id)}
                              className={`${SECENEK_BTN_BASE} ${
                                secili
                                  ? secenek.redTetikler ? 'border-rose-500 bg-rose-500 text-white' : 'border-sky-500 bg-sky-500 text-white'
                                  : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
                              }`}
                            >
                              {secenek.secenekMetni}
                              {secenek.yoneticiOnayi && <span className="ml-1">⚠</span>}
                            </button>
                          )
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              </section>

              {eliminasyonTetiklendi ? (
                <div className="rounded-lg border-2 border-rose-400 bg-rose-50 p-3">
                  <p className="text-[12.5px] font-black text-rose-800">ELİMİNASYON: RED</p>
                  <p className="mt-1 text-[11px] font-bold text-rose-700">{onizlemeSonuc?.eliminasyonRedNedeni}</p>
                  <p className="mt-1.5 text-[11px] font-semibold text-rose-600">
                    Eleme kriterlerinden biri tetiklendiği için değerlendirme/puanlama bölümleri gizlendi. Form yine de kaydedilebilir.
                  </p>
                </div>
              ) : (
                <>
                  <section className="overflow-hidden rounded-lg border-2 border-emerald-200 bg-white shadow-sm">
                    <div className="flex items-center gap-1.5 border-b-2 border-emerald-200 bg-emerald-50 px-2 py-1.5">
                      <span className="h-3.5 w-1 rounded-full bg-emerald-600" />
                      <h4 className="text-[10.5px] font-black uppercase tracking-wide text-emerald-800">Değerlendirme</h4>
                    </div>
                    <div className="space-y-1.5 p-2">
                      {degerlendirmeSorulari.map((soru) => (
                        <div key={soru.id} className="rounded-md border border-emerald-100 p-2">
                          <p className={`${SORU_METNI_CLASS} ${SORU_METNI_RENK.degerlendirme}`}>{soru.soruMetni}</p>
                          <div className="flex flex-col items-stretch gap-1">
                            {soru.secenekler.map((secenek) => {
                              const secili = (cevaplar[soru.id]?.secilenSecenekler || []).includes(secenek.id)
                              return (
                                <button
                                  key={secenek.id}
                                  type="button"
                                  onClick={() => soru.secimTuru === 'coklu' ? toggleSecilenCoklu(soru, secenek.id) : setSecilenTek(soru, secenek.id)}
                                  className={`${SECENEK_BTN_BASE} ${secili ? 'border-sky-500 bg-sky-500 text-white' : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'}`}
                                >
                                  {secenek.secenekMetni}{secenek.puan !== 0 ? ` (${secenek.puan > 0 ? '+' : ''}${secenek.puan})` : ''}
                                </button>
                              )
                            })}
                            {soru.id === gelirSorusu?.id && gelirVarSecenegi && gelirSecili === gelirVarSecenegi.id && (
                              <div className="grid gap-1.5 sm:grid-cols-2">
                                <input
                                  type="number"
                                  value={gelirTutari}
                                  onChange={(e) => setGelirTutari(e.target.value)}
                                  placeholder="Toplam aylık gelir (TL)"
                                  className="w-full rounded-md border border-slate-300 px-2.5 py-1.5 text-[12px] font-semibold text-slate-900 outline-none focus:border-sky-500"
                                />
                                <input
                                  type="number"
                                  min={1}
                                  value={haneKisiSayisi}
                                  onChange={(e) => setHaneKisiSayisi(e.target.value)}
                                  placeholder="Hane kişi sayısı (kişi başı hesap için)"
                                  className="w-full rounded-md border border-slate-300 px-2.5 py-1.5 text-[12px] font-semibold text-slate-900 outline-none focus:border-sky-500"
                                />
                              </div>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </section>

                  <section className="overflow-hidden rounded-lg border-2 border-amber-200 bg-white shadow-sm">
                    <div className="flex items-center gap-1.5 border-b-2 border-amber-200 bg-amber-50 px-2 py-1.5">
                      <span className="h-3.5 w-1 rounded-full bg-amber-600" />
                      <h4 className="text-[10.5px] font-black uppercase tracking-wide text-amber-800">Gözlem</h4>
                    </div>
                    <div className="space-y-1.5 p-2">
                      {gozlemSorulari.map((soru) => (
                        <div key={soru.id} className="rounded-md border border-amber-100 p-2">
                          <p className={`${SORU_METNI_CLASS} ${SORU_METNI_RENK.gozlem}`}>{soru.soruMetni}</p>
                          {soru.secimTuru === 'metin' ? (
                            <textarea
                              value={cevaplar[soru.id]?.metinCevap || ''}
                              onChange={(e) => setMetinCevap(soru, e.target.value)}
                              rows={3}
                              className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-left text-[12px] font-semibold text-slate-900 outline-none focus:border-sky-500"
                            />
                          ) : (
                            <div className="flex flex-col items-stretch gap-1">
                              {soru.secenekler.map((secenek) => {
                                const secili = (cevaplar[soru.id]?.secilenSecenekler || []).includes(secenek.id)
                                return (
                                  <button
                                    key={secenek.id}
                                    type="button"
                                    onClick={() => soru.secimTuru === 'coklu' ? toggleSecilenCoklu(soru, secenek.id) : setSecilenTek(soru, secenek.id)}
                                    className={`${SECENEK_BTN_BASE} ${secili ? 'border-sky-500 bg-sky-500 text-white' : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'}`}
                                  >
                                    {secenek.secenekMetni}
                                    {secenek.yoneticiOnayi && <span className="ml-1">⚠</span>}
                                  </button>
                                )
                              })}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </section>

                  <section className="overflow-hidden rounded-lg border-2 border-indigo-200 bg-white shadow-sm">
                    <div className="flex items-center gap-1.5 border-b-2 border-indigo-200 bg-indigo-50 px-2 py-1.5">
                      <span className="h-3.5 w-1 rounded-full bg-indigo-600" />
                      <h4 className="text-[10.5px] font-black uppercase tracking-wide text-indigo-800">Yardım Türü Önerisi <span className="font-normal normal-case text-indigo-400">(karar puanına göre otomatik dolduruldu, düzenleyebilirsiniz)</span></h4>
                    </div>
                    <div className="p-2">
                    <textarea
                      value={yardimTuruOnerisi}
                      onChange={(e) => { setYardimTuruOnerisi(e.target.value); setYardimTuruOnerisiDuzenlendi(true) }}
                      rows={2}
                      className="w-full rounded-md border border-slate-300 px-2.5 py-1.5 text-[12px] outline-none focus:border-sky-500"
                    />
                    </div>
                  </section>
                </>
              )}

              {/* Kullanici istegi (13 Eylul 2026): "kısa ve kurumsal metin
                  şeklinde... hanede çalışabilecek birey yok, evi kira, araç
                  kaydı yok, 2 öğrencisi var şeklinde olsun" - liste yerine
                  tek paragraflik akici ozet (bkz. ozetParagrafi useMemo). */}
              {ozetGosterilsinMi && ozetParagrafi && (
                <section className={`overflow-hidden rounded-lg border-2 shadow-sm ${eliminasyonTetiklendi ? 'border-rose-300 bg-rose-50' : 'border-teal-300 bg-teal-50'}`}>
                  <div className={`flex items-center gap-1.5 border-b-2 px-2 py-1.5 ${eliminasyonTetiklendi ? 'border-rose-300 bg-rose-100' : 'border-teal-300 bg-teal-100'}`}>
                    <span className={`h-3.5 w-1 rounded-full ${eliminasyonTetiklendi ? 'bg-rose-600' : 'bg-teal-600'}`} />
                    <h4 className={`text-[10.5px] font-black uppercase tracking-wide ${eliminasyonTetiklendi ? 'text-rose-800' : 'text-teal-800'}`}>Özet Rapor</h4>
                  </div>
                  <p className={`p-2.5 text-[12.5px] font-semibold leading-relaxed ${eliminasyonTetiklendi ? 'text-rose-900' : 'text-slate-800'}`}>{ozetParagrafi}</p>
                </section>
              )}
            </>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-slate-200 bg-white px-3 py-2">
          <button type="button" onClick={onClose} className="rounded-md border border-slate-300 px-3 py-1.5 text-[12px] font-black text-slate-600 hover:bg-slate-50">Vazgeç</button>
          <button
            type="button"
            onClick={() => void handleSave()}
            disabled={isSaving || isLoadingSorular}
            className="rounded-md bg-sky-600 px-4 py-1.5 text-[12px] font-black text-white shadow-sm hover:bg-sky-700 disabled:cursor-wait disabled:opacity-60"
          >
            {isSaving ? 'Kaydediliyor...' : 'Kaydet'}
          </button>
        </div>
      </div>
    </div>
  )
}
