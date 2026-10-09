import type { CevapPayload, CevapSonucu, EvaluationResult, Karar, SoruRow } from './types'

// Inceleme Formu v2 puanlama motoru - SAF fonksiyonlar (DB baglantisi yok),
// hem API route'undan (backend, otorite) hem form modalindan (istemci,
// sadece anlik onizleme icin) import edilebilir. Kaydetme aninda backend'in
// hesapladigi sonuc nihaidir; istemci kopyasi sadece kullanicinin puanini
// canli gormesi icindir.

// Kullanicinin "karar tablosu" spesifikasyonu - her puan araligina hem karar
// adi hem de onerilen varsayilan yardim turu metni bagli. Personel bu
// oneriyi formda degistirebilir, backend sadece bos birakilirsa kullanir.
const KARAR_ESIKLERI: { min: number; karar: Karar; oneri: string }[] = [
  { min: 80, karar: 'Kritik', oneri: 'Tüm yardım türleri - Öncelikli liste' },
  { min: 60, karar: 'Yuksek', oneri: 'Nakit yardım + Ayni yardım' },
  { min: 40, karar: 'Orta', oneri: 'Ayni yardım (gıda, yakacak)' },
  { min: 20, karar: 'Dusuk', oneri: 'Tek seferlik destek' },
  { min: 0, karar: 'Yardim Gerekmiyor', oneri: 'Ret - Gerekçe tutanağa yazılır' },
]

export function kararFromPuan(puan: number): Karar {
  const esik = KARAR_ESIKLERI.find((entry) => puan >= entry.min)
  return esik ? esik.karar : 'Yardim Gerekmiyor'
}

export function yardimTuruOnerisiFromPuan(puan: number): string {
  const esik = KARAR_ESIKLERI.find((entry) => puan >= entry.min)
  return esik ? esik.oneri : 'Ret - Gerekçe tutanağa yazılır'
}

// "Hanenin Aylik Gelir Durumu" sorusu (puanlamaKurali='gelir_kademeli')
// icin ozel kademeli puanlama - spesifikasyonun istedigi 0-1000/1001-3000/
// 3001+ TL kisi basi gelir bantlari.
export function scoreGelirKademeli(toplamGelir: number, haneBuyuklugu: number): number {
  if (!Number.isFinite(toplamGelir) || toplamGelir < 0) return 0
  if (!Number.isFinite(haneBuyuklugu) || haneBuyuklugu <= 0) return 0
  const kisiBasi = toplamGelir / haneBuyuklugu
  if (kisiBasi <= 1000) return 25
  if (kisiBasi <= 3000) return 15
  return 5
}

function sumSecilenPuan(soru: SoruRow, cevap: CevapPayload | undefined): number {
  if (!cevap?.secilenSecenekler?.length) return 0
  const secenekMap = new Map(soru.secenekler.map((s) => [s.id, s]))
  return cevap.secilenSecenekler.reduce((total, id) => total + (secenekMap.get(id)?.puan ?? 0), 0)
}

function anySecilenYoneticiOnayi(sorular: SoruRow[], cevaplar: CevapPayload[]): boolean {
  const soruMap = new Map(sorular.map((s) => [s.id, s]))
  return cevaplar.some((cevap) => {
    const soru = soruMap.get(cevap.soruId)
    if (!soru || !cevap.secilenSecenekler?.length) return false
    const secenekMap = new Map(soru.secenekler.map((s) => [s.id, s]))
    return cevap.secilenSecenekler.some((id) => secenekMap.get(id)?.yoneticiOnayi)
  })
}

function findEliminasyonNedeni(sorular: SoruRow[], cevaplar: CevapPayload[]): string | null {
  const nedenler: string[] = []
  const soruMap = new Map(sorular.map((s) => [s.id, s]))

  for (const cevap of cevaplar) {
    const soru = soruMap.get(cevap.soruId)
    if (!soru || soru.bolum !== 'kriter' || !cevap.secilenSecenekler?.length) continue

    for (const secenekId of cevap.secilenSecenekler) {
      const secenek = soru.secenekler.find((s) => s.id === secenekId)
      if (secenek?.redTetikler) {
        nedenler.push(`${soru.soruMetni}: ${secenek.secenekMetni}`)
      }
    }
  }

  return nedenler.length > 0 ? nedenler.join(' | ') : null
}

export function evaluateForm(cevaplar: CevapPayload[], sorular: SoruRow[], haneKisiSayisi?: number | null): EvaluationResult {
  const eliminasyonRedNedeni = findEliminasyonNedeni(sorular, cevaplar)

  if (eliminasyonRedNedeni) {
    // RED: sadece bilgi+kriter cevaplari saklanir, puanlama kolonlari NULL
    // kalir (spesifikasyonun kurali).
    const cevapSonuclari: CevapSonucu[] = cevaplar
      .filter((cevap) => {
        const soru = sorular.find((s) => s.id === cevap.soruId)
        return soru?.bolum === 'bilgi' || soru?.bolum === 'kriter'
      })
      .map((cevap) => ({ ...cevap, toplamPuan: 0 }))

    return {
      eliminasyonSonucu: 'RED',
      eliminasyonRedNedeni,
      toplamPuan: null,
      maksimumPuan: 100,
      karar: null,
      yardimTuruOnerisiOnerilen: null,
      onayDurumu: 'onay_gerekmiyor',
      cevapSonuclari,
    }
  }

  // KABUL: degerlendirme bolumundeki her soru puanlanir, gozlem/bilgi/kriter
  // cevaplari kaydedilir ama puana katilmaz.
  let hamToplam = 0

  const cevapSonuclari: CevapSonucu[] = cevaplar.map((cevap) => {
    const soru = sorular.find((s) => s.id === cevap.soruId)
    if (!soru || soru.bolum !== 'degerlendirme') {
      return { ...cevap, toplamPuan: null }
    }

    let puan: number
    if (soru.puanlamaKurali === 'gelir_kademeli') {
      // Secenek metni artik Ayarlar'dan serbestce duzenlenebildigi icin
      // (kullanici istegi 13 Eylul 2026) buradaki ayrimi metne gore degil,
      // sayisal gelir cevabinin FIILEN girilmis olup olmadigina gore
      // yapiyoruz - frontend zaten sadece "gelir var" secenegi
      // secildiginde sayiCevap gonderiyor (bkz. IncelemeDegerlendirmeFormModal).
      const secilenId = cevap.secilenSecenekler?.[0]
      const secenek = soru.secenekler.find((s) => s.id === secilenId)
      const gelirVarMi = cevap.sayiCevap !== null && cevap.sayiCevap !== undefined
      puan = gelirVarMi ? scoreGelirKademeli(cevap.sayiCevap ?? 0, haneKisiSayisi ?? 0) : (secenek?.puan ?? 0)
    } else {
      puan = sumSecilenPuan(soru, cevap)
    }

    hamToplam += puan
    return { ...cevap, toplamPuan: puan }
  })

  const toplamPuan = Math.max(0, Math.min(100, hamToplam))
  const onayGerekli = anySecilenYoneticiOnayi(sorular, cevaplar)

  return {
    eliminasyonSonucu: 'KABUL',
    eliminasyonRedNedeni: null,
    toplamPuan,
    maksimumPuan: 100,
    karar: kararFromPuan(toplamPuan),
    yardimTuruOnerisiOnerilen: yardimTuruOnerisiFromPuan(toplamPuan),
    onayDurumu: onayGerekli ? 'beklemede' : 'onay_gerekmiyor',
    cevapSonuclari,
  }
}

export function getKararRenk(puan: number | null): 'yesil' | 'sari' | 'turuncu' | 'kirmizi' | 'gri' {
  if (puan === null) return 'gri'
  if (puan >= 80) return 'yesil'
  if (puan >= 60) return 'sari'
  if (puan >= 40) return 'turuncu'
  return 'kirmizi'
}
