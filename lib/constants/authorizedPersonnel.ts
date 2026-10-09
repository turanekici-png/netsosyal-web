// "Ayarlar > Yetkili Personeller" listesi - mevcut kullanicilardan (kullanicilar
// tablosu) secilen bir alt kume, onay gerektiren islemlerde (bkz.
// app/api/documents/approval-requests) onay yetkisi tasir. Hem istemci
// (app/(modules)/settings/page.tsx) hem sunucu (approval-requests API
// route'lari) AYNI anahtar/tip tanimini kullanir - iki yerde ayri ayri
// tanimlanirsa (typo riski) anahtar uyusmazligi sessizce veri kaybina yol
// acabilirdi.
export const AUTHORIZED_PERSONNEL_SETTING_KEY = 'authorized_personnel'

export interface AuthorizedPersonnelEntry {
  userId: string
  title?: string
  addedAt?: string
}
