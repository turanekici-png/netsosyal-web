import type { DigerKurumYardimi, IncelemeDegerlendirmeFormRow } from './types'

export function mapFormRow(row: Record<string, unknown>): IncelemeDegerlendirmeFormRow {
  return {
    id: String(row.id ?? ''),
    dosyaid: String(row.dosyaid ?? ''),
    tarih: String(row.tarih ?? ''),
    personel: (row.personel as string) ?? null,
    tcKimlikNo: (row.tc_kimlik_no as string) ?? null,
    adSoyad: (row.ad_soyad as string) ?? null,
    telefon: (row.telefon as string) ?? null,
    adres: (row.adres as string) ?? null,
    il: (row.il as string) ?? null,
    ilce: (row.ilce as string) ?? null,
    koy: (row.koy as string) ?? null,
    muhtarAdi: (row.muhtar_adi as string) ?? null,
    haneKisiSayisi: row.hane_kisi_sayisi === null || row.hane_kisi_sayisi === undefined ? null : Number(row.hane_kisi_sayisi),
    digerKurumYardimlari: Array.isArray(row.diger_kurum_yardimlari) ? row.diger_kurum_yardimlari as DigerKurumYardimi[] : [],
    toplamPuan: row.toplam_puan === null || row.toplam_puan === undefined ? null : Number(row.toplam_puan),
    maksimumPuan: Number(row.maksimum_puan ?? 100),
    karar: (row.karar as IncelemeDegerlendirmeFormRow['karar']) ?? null,
    yardimTuruOnerisi: (row.yardim_turu_onerisi as string) ?? null,
    eliminasyonSonucu: (row.eliminasyon_sonucu as IncelemeDegerlendirmeFormRow['eliminasyonSonucu']) ?? null,
    eliminasyonRedNedeni: (row.eliminasyon_red_nedeni as string) ?? null,
    onayDurumu: (row.onay_durumu as IncelemeDegerlendirmeFormRow['onayDurumu']) ?? 'onay_gerekmiyor',
    onayNotu: (row.onay_notu as string) ?? null,
    kullaniciid: row.kullaniciid === null || row.kullaniciid === undefined ? null : Number(row.kullaniciid),
    olusturmaTarihi: String(row.olusturma_tarihi ?? ''),
    guncellemeTarihi: String(row.guncelleme_tarihi ?? ''),
  }
}
