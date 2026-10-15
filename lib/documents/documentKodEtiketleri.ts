import { predefinedValuesService } from '@/lib/services/predefinedValues.service'
import { mulkiyetDurumuEtiketleri } from '@/lib/services/mulkiyetDurumu.service'
import { foldTurkish } from '@/lib/utils'
import { BOS_KOD_ETIKETLERI, type DocumentKodEtiketleri } from '@/lib/documents/documentsListQuery'
import { BOS_BIREY_KOD_ETIKETLERI, type BeneficiaryKodEtiketleri } from '@/lib/beneficiary/beneficiaryListQuery'

// 2026-10-15: Dosyalar listesindeki kodlu alanlarin (aile niteligi, mulkiyet,
// konut turu, isinma turu, yardim oncelik sirasi) karsiliklari Ayarlar >
// Hazır Değerler'den okunur (kural: koda gomme). Liste basligi esnek
// eslestirilir; ilgili liste yoksa o alan kod olarak gorunur ve kullanici
// Hazır Değerler'e "Konut Türü" / "Isınma Türü" gibi bir liste ekleyince
// kendiliginden etikete doner.

type Liste = Array<{ id?: unknown; name?: unknown }>

function listeyiHaritala(liste: Liste | undefined): Record<string, string> {
  const sonuc: Record<string, string> = {}
  for (const satir of liste ?? []) {
    const id = String(satir?.id ?? '').trim()
    const ad = String(satir?.name ?? '').trim()
    if (id && ad) sonuc[id] = ad
  }
  return sonuc
}

export async function getDocumentKodEtiketleri(): Promise<DocumentKodEtiketleri> {
  try {
    const { values, titles } = await predefinedValuesService.getAll()
    const degerler = values as Record<string, Liste>
    const basliklar = Object.entries(titles ?? {}).map(([anahtar, baslik]) => [anahtar, foldTurkish(String(baslik))] as const)
    const bul = (eslesir: (baslik: string) => boolean) => {
      const anahtar = basliklar.find(([, baslik]) => eslesir(baslik))?.[0]
      return anahtar ? listeyiHaritala(degerler[anahtar]) : {}
    }

    return {
      aile: listeyiHaritala(degerler.familyType),
      mulkiyet: await mulkiyetDurumuEtiketleri(),
      konut: bul((b) => b.includes('konut') && (b.includes('tur') || b.includes('tip'))),
      isinma: bul((b) => b.includes('isinma') || b.includes('yakit')),
      oncelik: bul((b) => b.includes('oncelik')),
    }
  } catch {
    return BOS_KOD_ETIKETLERI
  }
}

// Bireyler listesi: sağlık (Hazır Değerler > Sağlık Durumu), öğrenim ve
// sosyal güvence (başlık eşleşmesiyle; liste yoksa kod görünür).
export async function getBeneficiaryKodEtiketleri(): Promise<BeneficiaryKodEtiketleri> {
  try {
    const { values, titles } = await predefinedValuesService.getAll()
    const degerler = values as Record<string, Liste>
    const basliklar = Object.entries(titles ?? {}).map(([anahtar, baslik]) => [anahtar, foldTurkish(String(baslik))] as const)
    const bul = (eslesir: (baslik: string) => boolean) => {
      const anahtar = basliklar.find(([, baslik]) => eslesir(baslik))?.[0]
      return anahtar ? listeyiHaritala(degerler[anahtar]) : {}
    }

    return {
      saglik: listeyiHaritala(degerler.healthStatus),
      ogrenim: bul((b) => b.includes('ogrenim') || b.includes('egitim')),
      guvence: bul((b) => b.includes('guvence')),
    }
  } catch {
    return BOS_BIREY_KOD_ETIKETLERI
  }
}
