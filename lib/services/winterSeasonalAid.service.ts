import { prisma } from '@/lib/db/prisma'

// "Kış Dönemi" periyodu (2026-10-07) - önce sadece Ekmek Yardımı için
// vardı (bkz. app/(modules)/documents/page.tsx KIS_DONEMI_PERIOD_LABEL),
// kullanıcı isteğiyle Gıda Bankası, Destek Paketi ve Hazır Yemek
// yardımlarına da genişletildi. Davranış HER DÖRDÜ için aynı:
//   - Müracaat (durumu=0) olarak oluşturulmuşsa: bastarih (01 Kasım)
//     gelene kadar beklemede kalır, o gün otomatik olarak aktif yardıma
//     (durumu=2) dönüştürülür (bkz. ensureWinterSeasonalAidActivation).
//   - Zaten aktif (durumu=2) bir yardıma "Yardım Düzenle" ekranından
//     Kış Dönemi seçilip kaydedilmişse: yardım KESİNTİSİZ devam eder
//     (bu fonksiyonlar durumu'na dokunmaz, servis/edit ekranı zaten
//     sadece donem/bittarih günceller) - sadece bittarih (30 Nisan)
//     geldiğinde kesilir.
//   - Her iki durumda da bittarih (30 Nisan) geldiğinde otomatik olarak
//     KESİLİR (durumu=1 - "İptal Edildi/Durduruldu", bkz. app/api/
//     documents/service-record/route.ts 'cancel' modundaki AYNI
//     konvansiyon) - bkz. ensureWinterSeasonalAidCutoff.
// Gıda Bankası/Destek Paketi'nin KENDİ aylık "Ödenmedi" dönem takibi
// (foodBankPeriod.service.ts / supportPackagePeriod.service.ts, farklı
// bir mekanizma - donemint/yrd_*dnm tabloları) bu fonksiyonlardan
// TAMAMEN BAĞIMSIZ çalışmaya devam eder, buraya dokunulmaz.

const KIS_DONEMI_PERIOD_LABEL = 'Kış Dönemi'

const globalForWinterAid = globalThis as unknown as {
  winterAidActivationRunDate?: string
  winterAidActivationPromise?: Promise<void>
  winterAidCutoffRunDate?: string
  winterAidCutoffPromise?: Promise<void>
}

function todayDateKey() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

async function activateEkmek() {
  await prisma.$executeRaw`
    WITH activated AS (
      UPDATE yrd_ekmek
      SET durumu = 2, durumutarih = CURRENT_DATE,
          durumuaciklama = 'Kış Dönemi - başlangıç tarihi geldiği için otomatik aktive edildi'
      WHERE durumu = 0 AND donem = ${KIS_DONEMI_PERIOD_LABEL} AND bastarih IS NOT NULL AND bastarih <= CURRENT_DATE
      RETURNING id, kullaniciid, dosyaid, miktar
    )
    INSERT INTO yrd_ekmekhrk (kullaniciid, islemtarihi, dosyaid, yardimid, islemadi, miktar, aciklama, donemadi)
    SELECT kullaniciid, NOW(), dosyaid, id, 'Otomatik Aktivasyon', miktar,
           'Kış Dönemi müracaatı, başlangıç tarihi (01 Kasım) geldiği için sistem tarafından otomatik olarak yardıma dönüştürüldü.',
           ${KIS_DONEMI_PERIOD_LABEL}
    FROM activated
  `
}

async function activateGidaBankasi() {
  await prisma.$executeRaw`
    WITH activated AS (
      UPDATE yrd_gidabankasi
      SET durumu = 2, durumutarih = CURRENT_DATE,
          durumuaciklama = 'Kış Dönemi - başlangıç tarihi geldiği için otomatik aktive edildi'
      WHERE durumu = 0 AND donem = ${KIS_DONEMI_PERIOD_LABEL} AND bastarih IS NOT NULL AND bastarih <= CURRENT_DATE
      RETURNING id, kullaniciid, dosyaid, miktar
    )
    INSERT INTO yrd_gidabankasihrk (kullaniciid, islemtarihi, dosyaid, yardimid, islemadi, aciklama, miktar)
    SELECT kullaniciid, NOW(), dosyaid, id, 'Otomatik Aktivasyon',
           'Kış Dönemi müracaatı, başlangıç tarihi (01 Kasım) geldiği için sistem tarafından otomatik olarak yardıma dönüştürüldü.',
           miktar
    FROM activated
  `
}

async function activateDestekPaketi() {
  await prisma.$executeRaw`
    WITH activated AS (
      UPDATE yrd_destekpaketi
      SET durumu = 2, durumutarih = CURRENT_DATE,
          durumuaciklama = 'Kış Dönemi - başlangıç tarihi geldiği için otomatik aktive edildi'
      WHERE durumu = 0 AND donem = ${KIS_DONEMI_PERIOD_LABEL} AND bastarih IS NOT NULL AND bastarih <= CURRENT_DATE
      RETURNING id, kullaniciid, dosyaid, miktar
    )
    INSERT INTO yrd_destekpaketihrk (kullaniciid, islemtarihi, dosyaid, yardimid, islemadi, aciklama, miktar)
    SELECT kullaniciid, NOW(), dosyaid, id, 'Otomatik Aktivasyon',
           'Kış Dönemi müracaatı, başlangıç tarihi (01 Kasım) geldiği için sistem tarafından otomatik olarak yardıma dönüştürüldü.',
           miktar
    FROM activated
  `
}

async function activateHazirYemek() {
  await prisma.$executeRaw`
    WITH activated AS (
      UPDATE yrd_haziryemek
      SET durumu = 2, durumutarih = CURRENT_DATE,
          durumuaciklama = 'Kış Dönemi - başlangıç tarihi geldiği için otomatik aktive edildi'
      WHERE durumu = 0 AND donem = ${KIS_DONEMI_PERIOD_LABEL} AND bastarih IS NOT NULL AND bastarih <= CURRENT_DATE
      RETURNING id, kullaniciid, dosyaid, miktar
    )
    INSERT INTO yrd_haziryemekhrk (kullaniciid, islemtarihi, dosyaid, yardimid, islemadi, aciklama, miktar)
    SELECT kullaniciid, NOW(), dosyaid, id, 'Otomatik Aktivasyon',
           'Kış Dönemi müracaatı, başlangıç tarihi (01 Kasım) geldiği için sistem tarafından otomatik olarak yardıma dönüştürüldü.',
           miktar
    FROM activated
  `
}

export async function ensureWinterSeasonalAidActivation() {
  const dateKey = todayDateKey()

  if (globalForWinterAid.winterAidActivationRunDate === dateKey) return
  if (globalForWinterAid.winterAidActivationPromise) {
    await globalForWinterAid.winterAidActivationPromise
    return
  }

  globalForWinterAid.winterAidActivationPromise = (async () => {
    await activateEkmek()
    await activateGidaBankasi()
    await activateDestekPaketi()
    await activateHazirYemek()
    globalForWinterAid.winterAidActivationRunDate = dateKey
  })()

  try {
    await globalForWinterAid.winterAidActivationPromise
  } finally {
    globalForWinterAid.winterAidActivationPromise = undefined
  }
}

const KESILDI_ACIKLAMA = 'Kış Dönemi - bitiş tarihi (30 Nisan) geldiği için sistem tarafından otomatik olarak kesildi.'

async function cutoffEkmek() {
  await prisma.$executeRaw`
    WITH cutoff AS (
      UPDATE yrd_ekmek
      SET durumu = 1, durumutarih = CURRENT_DATE, durumuaciklama = ${KESILDI_ACIKLAMA}
      WHERE durumu = 2 AND donem = ${KIS_DONEMI_PERIOD_LABEL} AND bittarih IS NOT NULL AND bittarih <= CURRENT_DATE
      RETURNING id, kullaniciid, dosyaid, miktar
    )
    INSERT INTO yrd_ekmekhrk (kullaniciid, islemtarihi, dosyaid, yardimid, islemadi, miktar, aciklama, donemadi)
    SELECT kullaniciid, NOW(), dosyaid, id, 'Otomatik Kesme', miktar, ${KESILDI_ACIKLAMA}, ${KIS_DONEMI_PERIOD_LABEL}
    FROM cutoff
  `
}

async function cutoffGidaBankasi() {
  await prisma.$executeRaw`
    WITH cutoff AS (
      UPDATE yrd_gidabankasi
      SET durumu = 1, durumutarih = CURRENT_DATE, durumuaciklama = ${KESILDI_ACIKLAMA}
      WHERE durumu = 2 AND donem = ${KIS_DONEMI_PERIOD_LABEL} AND bittarih IS NOT NULL AND bittarih <= CURRENT_DATE
      RETURNING id, kullaniciid, dosyaid, miktar
    )
    INSERT INTO yrd_gidabankasihrk (kullaniciid, islemtarihi, dosyaid, yardimid, islemadi, aciklama, miktar)
    SELECT kullaniciid, NOW(), dosyaid, id, 'Otomatik Kesme', ${KESILDI_ACIKLAMA}, miktar
    FROM cutoff
  `
}

async function cutoffDestekPaketi() {
  await prisma.$executeRaw`
    WITH cutoff AS (
      UPDATE yrd_destekpaketi
      SET durumu = 1, durumutarih = CURRENT_DATE, durumuaciklama = ${KESILDI_ACIKLAMA}
      WHERE durumu = 2 AND donem = ${KIS_DONEMI_PERIOD_LABEL} AND bittarih IS NOT NULL AND bittarih <= CURRENT_DATE
      RETURNING id, kullaniciid, dosyaid, miktar
    )
    INSERT INTO yrd_destekpaketihrk (kullaniciid, islemtarihi, dosyaid, yardimid, islemadi, aciklama, miktar)
    SELECT kullaniciid, NOW(), dosyaid, id, 'Otomatik Kesme', ${KESILDI_ACIKLAMA}, miktar
    FROM cutoff
  `
}

async function cutoffHazirYemek() {
  await prisma.$executeRaw`
    WITH cutoff AS (
      UPDATE yrd_haziryemek
      SET durumu = 1, durumutarih = CURRENT_DATE, durumuaciklama = ${KESILDI_ACIKLAMA}
      WHERE durumu = 2 AND donem = ${KIS_DONEMI_PERIOD_LABEL} AND bittarih IS NOT NULL AND bittarih <= CURRENT_DATE
      RETURNING id, kullaniciid, dosyaid, miktar
    )
    INSERT INTO yrd_haziryemekhrk (kullaniciid, islemtarihi, dosyaid, yardimid, islemadi, aciklama, miktar)
    SELECT kullaniciid, NOW(), dosyaid, id, 'Otomatik Kesme', ${KESILDI_ACIKLAMA}, miktar
    FROM cutoff
  `
}

export async function ensureWinterSeasonalAidCutoff() {
  const dateKey = todayDateKey()

  if (globalForWinterAid.winterAidCutoffRunDate === dateKey) return
  if (globalForWinterAid.winterAidCutoffPromise) {
    await globalForWinterAid.winterAidCutoffPromise
    return
  }

  globalForWinterAid.winterAidCutoffPromise = (async () => {
    await cutoffEkmek()
    await cutoffGidaBankasi()
    await cutoffDestekPaketi()
    await cutoffHazirYemek()
    globalForWinterAid.winterAidCutoffRunDate = dateKey
  })()

  try {
    await globalForWinterAid.winterAidCutoffPromise
  } finally {
    globalForWinterAid.winterAidCutoffPromise = undefined
  }
}
