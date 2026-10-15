// "Kış Dönemi" yardim durumu kurali (2026-10-15 kullanici istegi): bir
// yardimda Kış Dönemi secilince baslangic/bitis 01 Kasim - 30 Nisan olur ve
// durum TARIHLERE gore belirlenir:
//   baslangic henuz gelmediyse  -> 5 "Bekliyor" (sari)
//   baslangic geldi, bitis gelmedi -> 2 "Devam Ediyor"
//   bitis geldiyse               -> 3 "İptal Edildi"
// Gunu gelince durum degisimini zamanlayici yapar (bkz.
// lib/services/winterSeasonalAid.service.ts). Kod-ad karsiligi Hazır
// Değerler > Yardım Durumu listesindedir (5 = "Bekliyor").
// Istemci ve sunucu ortak kullanir (server-only DEGIL).

export const KIS_DONEMI_ETIKETI = 'Kış Dönemi'
// Kullanici Hazır Değerler'de 5'i "Bekliyor" yapti (eskiden "Durduruldu");
// mevcut Kış Dönemi kayitlari da zaten 5 ile bekliyordu.
export const YARDIM_DURUMU_BEKLIYOR = '5'
export const YARDIM_DURUMU_DEVAM = '2'
export const YARDIM_DURUMU_IPTAL = '3'

// Kış Dönemi destekleyen (donem kolonu olan, donemli) yardim tablolari
export const KIS_DONEMI_TABLOLARI = ['yrd_ekmek', 'yrd_gidabankasi', 'yrd_destekpaketi', 'yrd_haziryemek'] as const

function bugunYmd() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// Bitis gunu "geldiginde" kesilir (mevcut zamanlayici gibi: bittarih <= bugun).
export function kisDonemiDurumu(baslangic: string | null | undefined, bitis: string | null | undefined, bugun = bugunYmd()) {
  const bas = String(baslangic ?? '').slice(0, 10)
  const bit = String(bitis ?? '').slice(0, 10)
  if (bit && bit <= bugun) return YARDIM_DURUMU_IPTAL
  if (bas && bas > bugun) return YARDIM_DURUMU_BEKLIYOR
  return YARDIM_DURUMU_DEVAM
}

// Rozet renkleri (sari) - durum listelerinde ortak
export const BEKLIYOR_ROZET_SINIFI = 'border-yellow-500 !bg-yellow-400 !text-yellow-950 ring-2 ring-yellow-200 shadow-md shadow-yellow-300/70'

// 2026-10-15 kullanici istegi: "yardim kesildiyse (durumu Devam Ediyor ya da
// Bekliyor degilse) donem bilgisi otomatik KAPALI olsun, baska periyot
// gorunmesin"; "tum eski yardimlarda sadece Devam Ediyor ve Bekliyor
// durumlarinin donemini gostersin". Ekranda yalniz 2/5 donemi gorunur;
// veride (donemli 4 tablo) Yeni Müracaat (0) muracaat periyodunu korur.
export const KAPALI_DONEM = 'Kapalı'
export const DONEMI_ACIK_DURUMLAR = [YARDIM_DURUMU_DEVAM, YARDIM_DURUMU_BEKLIYOR]

export function donemAcikMi(durum: unknown) {
  const kod = String(durum ?? '').trim()
  return DONEMI_ACIK_DURUMLAR.includes(kod)
}

// Ekranda gosterilecek donem: kesilmis yardimda (eski kayitlar dahil) "Kapalı"
export function gosterilecekDonem(durum: unknown, donem: string | null | undefined) {
  return donemAcikMi(durum) ? (donem ?? '') : KAPALI_DONEM
}
