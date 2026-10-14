import { predefinedValuesService } from '@/lib/services/predefinedValues.service'
import { foldTurkish } from '@/lib/utils'

// 2026-10-14 kullanici istegi: "bundan sonra bu degerlerin karsiliklarini
// Hazır Değerler'den alalim". dosyalar.mulkiyetdurumu kodlarinin anlami
// koda gomulu DEGIL, Ayarlar > Hazır Değerler'deki basliginda "mülkiyet"
// gecen listeden okunur (kullanicinin ekledigi: 1 Kendi Evi, 2 Kira,
// 3 Lojman, 4 Yakınının Evi, 5 Kapıcı Dairesi, 6 Bağış, 7 Geçici Barınma,
// 8 Müşterek Tapu, 9 Diğer). Liste yoksa bos doner (kod yazilmaz/cevrilmez).

export type KodluDeger = { id: string; name: string }

export async function mulkiyetDurumuListesi(): Promise<KodluDeger[]> {
  const { values, titles } = await predefinedValuesService.getAll()
  const kategori = Object.entries(titles ?? {}).find(([, baslik]) => foldTurkish(String(baslik)).includes('mulkiyet'))?.[0]
  const liste = kategori ? ((values as Record<string, unknown>)[kategori] as KodluDeger[] | undefined) ?? [] : []
  return liste.filter((s) => String(s?.id ?? '').trim() !== '' && String(s?.name ?? '').trim() !== '')
}

// { "1": "Kendi Evi", "2": "Kira", ... } - SQL'e jsonb parametre olarak verilebilir.
export async function mulkiyetDurumuEtiketleri(): Promise<Record<string, string>> {
  const sonuc: Record<string, string> = {}
  for (const s of await mulkiyetDurumuListesi()) sonuc[String(s.id).trim()] = String(s.name).trim()
  return sonuc
}
