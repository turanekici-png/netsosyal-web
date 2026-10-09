import { prisma } from '@/lib/db/prisma'

const globalForSupportPackagePeriods = globalThis as unknown as {
  supportPackagePeriodRunDate?: string
  supportPackagePeriodPromise?: Promise<void>
}

function dateParts(date = new Date()) {
  const year = date.getFullYear()
  const month = date.getMonth() + 1
  const day = date.getDate()

  return {
    year,
    month,
    day,
    dateKey: `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
    periodInt: year * 100 + month,
    periodStart: `${year}-${String(month).padStart(2, '0')}-01`,
  }
}

function getPeriodName(year: number, month: number) {
  const date = new Date(Date.UTC(year, month - 1, 1))
  const monthName = date.toLocaleDateString('tr-TR', { month: 'long', timeZone: 'UTC' })
  return monthName.charAt(0).toLocaleUpperCase('tr-TR') + monthName.slice(1)
}

export async function ensureMonthlySupportPackagePeriods() {
  const parts = dateParts()

  if (globalForSupportPackagePeriods.supportPackagePeriodRunDate === parts.dateKey) {
    return
  }

  if (globalForSupportPackagePeriods.supportPackagePeriodPromise) {
    await globalForSupportPackagePeriods.supportPackagePeriodPromise
    return
  }

  globalForSupportPackagePeriods.supportPackagePeriodPromise = (async () => {
    if (parts.day !== 1) {
      globalForSupportPackagePeriods.supportPackagePeriodRunDate = parts.dateKey
      return
    }

    const periodName = getPeriodName(parts.year, parts.month)
    const periodDescription = `Odenmedi -- ${periodName} -- 01.${String(parts.month).padStart(2, '0')}.${parts.year}`

    await prisma.$executeRaw`
      WITH eligible AS (
        SELECT
          t.id,
          t.kullaniciid,
          t.dosyaid,
          t.miktar
        FROM yrd_destekpaketi t
        WHERE t.durumu = 2
          AND t.dosyaid IS NOT NULL
          AND NOT EXISTS (
            SELECT 1
            FROM yrd_destekpaketihrk h
            WHERE h.yardimid = t.id
              AND h.dosyaid = t.dosyaid
              AND h.islemadi = ${String(parts.periodInt)}
          )
      ),
      updated AS (
        UPDATE yrd_destekpaketi t
        SET donem = ${periodName},
            donemint = ${parts.periodInt},
            donemstr = ${periodName},
            dnm_bastarih = ${parts.periodStart}::date,
            dnm_durumu = 0,
            dnm_durumuaciklama = ${periodDescription}
        FROM eligible e
        WHERE t.id = e.id
        RETURNING t.id, t.kullaniciid, t.dosyaid, t.miktar
      )
      INSERT INTO yrd_destekpaketihrk (
        kullaniciid, islemtarihi, dosyaid, yardimid,
        islemadi, aciklama, miktar
      )
      SELECT
        u.kullaniciid, NOW(), u.dosyaid, u.id,
        ${String(parts.periodInt)}, ${periodDescription}, u.miktar
      FROM updated u
      WHERE NOT EXISTS (
        SELECT 1
        FROM yrd_destekpaketihrk h
        WHERE h.yardimid = u.id
          AND h.dosyaid = u.dosyaid
          AND h.islemadi = ${String(parts.periodInt)}
      )
    `

    globalForSupportPackagePeriods.supportPackagePeriodRunDate = parts.dateKey
  })()

  try {
    await globalForSupportPackagePeriods.supportPackagePeriodPromise
  } finally {
    globalForSupportPackagePeriods.supportPackagePeriodPromise = undefined
  }
}
