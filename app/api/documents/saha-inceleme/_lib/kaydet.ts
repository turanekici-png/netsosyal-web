import {
  anahtarliCevap,
  bosMu,
  cevapMetni,
  eksikZorunluSorular,
  IMZA_AZAMI_UZUNLUK,
  ozetMetniUret,
  ozetRaporCumleleri,
  ozetRaporMetni,
  type CevapDegeri,
  type Cevaplar,
  type OtomatikDolum,
  type Sablon,
  type Soru,
  type TabloSatiri,
} from '@/lib/constants/sahaIncelemeForm'

// Yeni kayit (POST) ve mevcut kaydi guncelleme (PUT /[id]) ortak mantigi.

// Gelen cevaplari, sablondaki soru turune gore temizler - bilinmeyen
// soru id'leri ve ture uymayan degerler atilir.
export function cevaplariTemizle(sablon: Sablon, ham: unknown): Cevaplar {
  const temiz: Cevaplar = {}
  if (!ham || typeof ham !== 'object') return temiz
  const kaynak = ham as Record<string, unknown>

  for (const bolum of sablon.bolumler) {
    for (const soru of bolum.sorular) {
      const deger = kaynak[String(soru.id)]
      if (deger === undefined || deger === null) continue
      const temizDeger = degeriTemizle(soru, deger)
      if (temizDeger !== null && !bosMu(soru, temizDeger)) temiz[String(soru.id)] = temizDeger
    }
  }
  return temiz
}

function degeriTemizle(soru: Soru, deger: unknown): CevapDegeri | null {
  const secenekIdleri = new Set(soru.secenekler.map((s) => s.id))
  switch (soru.tur) {
    case 'imza':
      // Sadece tuvalden gelen PNG data URL'i kabul edilir.
      return typeof deger === 'string' && deger.startsWith('data:image/png;base64,') && deger.length <= IMZA_AZAMI_UZUNLUK ? deger : null
    case 'tek':
      return typeof deger === 'string' && secenekIdleri.has(deger) ? deger : null
    case 'coklu':
      return Array.isArray(deger) ? [...new Set(deger.filter((x): x is string => typeof x === 'string' && secenekIdleri.has(x)))] : null
    case 'tablo': {
      if (!Array.isArray(deger)) return null
      const sutunIdleri = soru.sutunlar.map((s) => s.id)
      return deger.slice(0, 100).map((satir): TabloSatiri => {
        const kayit = (satir && typeof satir === 'object' ? satir : {}) as { sabit?: unknown; hucreler?: Record<string, unknown> }
        const hucreler: Record<string, string> = {}
        for (const id of sutunIdleri) {
          const hucre = kayit.hucreler?.[id]
          if (hucre !== undefined && hucre !== null && String(hucre).trim() !== '') hucreler[id] = String(hucre).trim().slice(0, 1000)
        }
        const sabit = typeof kayit.sabit === 'string' && soru.sabitSatirlar.includes(kayit.sabit) ? kayit.sabit : undefined
        return sabit ? { sabit, hucreler } : { hucreler }
      })
    }
    default:
      return typeof deger === 'string' || typeof deger === 'number' ? String(deger).trim().slice(0, 5000) : null
  }
}

export function otomatikCevap(sablon: Sablon, cevaplar: Cevaplar, otomatik: OtomatikDolum): string | null {
  for (const bolum of sablon.bolumler) {
    for (const soru of bolum.sorular) {
      if (soru.otomatik === otomatik) {
        const metin = cevapMetni(soru, cevaplar[String(soru.id)])
        if (metin) return metin
      }
    }
  }
  return null
}

export function metinVeyaNull(value: unknown) {
  const text = String(value ?? '').trim()
  return text ? text.slice(0, 2000) : null
}

export type KaydetPayload = {
  dosyaid?: unknown
  cevaplar?: unknown
  tcKimlikNo?: unknown
  personel?: unknown
  personelAciklamasi?: unknown
  personelRaporu?: unknown
}

// Cevaplari dogrular ve kayit kolonlarini hesaplar. Hata metni donerse 400.
// tarihYedek: formda ziyaret tarihi sorusu yoksa ozet raporda kullanilacak
// tarih (guncellemede kaydin kendi tarihi; yeni kayitta bugun).
export function kayitAlanlariniHazirla(sablon: Sablon, payload: KaydetPayload, tarihYedek?: string | null) {
  const cevaplar = cevaplariTemizle(sablon, payload.cevaplar)
  if (Object.keys(cevaplar).length === 0) return { hata: 'Formda doldurulmuş bir alan yok.' } as const
  // 2026-10-15: ziyaret yapilamadiysa (Evde Bulunamadı vb.) yalniz ziyaret sonucu aranir
  const ilkEksik = eksikZorunluSorular(sablon, cevaplar)[0]
  if (ilkEksik) {
    return { hata: `"${ilkEksik.bolum.baslik}" bölümünde zorunlu alan boş: ${ilkEksik.soru.soruMetni}` } as const
  }

  const ziyaretZamani = otomatikCevap(sablon, cevaplar, 'ziyaret_zamani')
  const ozet = ozetMetniUret(sablon, cevaplar)
  const personelRaporu = String(payload.personelRaporu ?? '').trim().slice(0, 10000) || null
  // 2026-10-13 kullanici istegi: Ev Ziyareti raporu = formdaki "Özet Rapor"
  // (form bilgileri tek cumle + personel raporu tek cumle).
  const cumleler = ozetRaporCumleleri(sablon, cevaplar, personelRaporu ?? '', tarihYedek || bugununTarihi())
  // 2026-10-14: personel raporu ozetin altinda, "PERSONEL:" basligiyla yeni satirda.
  const evZiyaretiRaporu = ozetRaporMetni(cumleler)
  return {
    hata: null,
    cevaplar,
    tarih: ziyaretZamani && /^\d{4}-\d{2}-\d{2}/.test(ziyaretZamani) ? ziyaretZamani.slice(0, 10) : null,
    personel: otomatikCevap(sablon, cevaplar, 'personel') ?? metinVeyaNull(payload.personel),
    adSoyad: otomatikCevap(sablon, cevaplar, 'basvuru_sahibi'),
    tcKimlikNo: otomatikCevap(sablon, cevaplar, 'tc_kimlik_no') ?? metinVeyaNull(payload.tcKimlikNo),
    telefon: otomatikCevap(sablon, cevaplar, 'telefon'),
    adres: otomatikCevap(sablon, cevaplar, 'adres'),
    ziyaretSonucu: anahtarliCevap(sablon, cevaplar, 'ziyaret_sonucu'),
    aciliyet: anahtarliCevap(sablon, cevaplar, 'aciliyet'),
    oncelikliIhtiyac: anahtarliCevap(sablon, cevaplar, 'oncelikli_ihtiyac'),
    onDegerlendirme: anahtarliCevap(sablon, cevaplar, 'on_degerlendirme'),
    ozet: ozet || null,
    // personelAciklamasi: birlestirilmis tahkikat raporu (otomatik ozet + personel raporu)
    personelAciklamasi: String(payload.personelAciklamasi ?? '').trim().slice(0, 20000) || null,
    personelRaporu,
    evZiyaretiRaporu: evZiyaretiRaporu || ozet || 'Hane ziyareti ve sosyal inceleme formu dolduruldu.',
  }
}

// Sunucu saati Turkiye (bkz. pg-naive-timestamp notu) - "dd.mm.yyyy".
function bugununTarihi() {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(d.getDate())}.${p(d.getMonth() + 1)}.${d.getFullYear()}`
}

export function evZiyaretiKonusu(aciliyet: string | null) {
  return `Hane Ziyareti ve Sosyal İnceleme${aciliyet ? ` (${aciliyet})` : ''}`
}
