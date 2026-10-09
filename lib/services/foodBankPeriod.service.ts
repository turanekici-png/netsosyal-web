import { prisma } from '@/lib/db/prisma'

const globalForFoodBankPeriods = globalThis as unknown as {
  foodBankPeriodRunDate?: string
  foodBankPeriodPromise?: Promise<void>
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

export async function ensureMonthlyFoodBankPeriods() {
  const parts = dateParts()

  if (globalForFoodBankPeriods.foodBankPeriodRunDate === parts.dateKey) {
    return
  }

  if (globalForFoodBankPeriods.foodBankPeriodPromise) {
    await globalForFoodBankPeriods.foodBankPeriodPromise
    return
  }

  globalForFoodBankPeriods.foodBankPeriodPromise = (async () => {
    if (parts.day !== 1) {
      globalForFoodBankPeriods.foodBankPeriodRunDate = parts.dateKey
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
        FROM yrd_gidabankasi t
        WHERE t.durumu = 2
          AND t.dosyaid IS NOT NULL
          AND NOT EXISTS (
            SELECT 1
            FROM yrd_gidabankasidnm d
            WHERE d.yrd_gbid = t.id
              AND d.dosyaid = t.dosyaid
              AND d.donem = ${parts.periodInt}
          )
      ),
      updated AS (
        UPDATE yrd_gidabankasi t
        SET ensondonem = ${parts.periodInt},
            donemadi = ${periodName},
            donemint = ${parts.periodInt},
            donemstr = ${periodName},
            dnm_bastarih = ${parts.periodStart}::date,
            dnm_durumu = 0,
            dnm_durumutarih = (${parts.periodStart}::date + INTERVAL '7 days')::date,
            dnm_durumuaciklama = ${periodDescription}
        FROM eligible e
        WHERE t.id = e.id
        RETURNING t.id, t.kullaniciid, t.dosyaid, t.miktar
      ),
      inserted_periods AS (
        INSERT INTO yrd_gidabankasidnm (
          kullaniciid, islemtarihi, dosyaid, yrd_gbid, bastarih,
          miktar, aciklama, durumu, durumutarih, durumuaciklama, donem
        )
        SELECT
          u.kullaniciid, NOW(), u.dosyaid, u.id, ${parts.periodStart}::date,
          u.miktar, ${periodDescription}, 0,
          (${parts.periodStart}::date + INTERVAL '7 days')::date,
          ${periodDescription}, ${parts.periodInt}
        FROM updated u
        RETURNING id, kullaniciid, dosyaid, yrd_gbid, miktar
      )
      ,
      period_rows AS (
        SELECT id, kullaniciid, dosyaid, yrd_gbid, miktar
        FROM inserted_periods
        UNION ALL
        SELECT
          d.id,
          COALESCE(d.kullaniciid, u.kullaniciid),
          d.dosyaid,
          d.yrd_gbid,
          COALESCE(d.miktar, u.miktar)
        FROM updated u
        JOIN yrd_gidabankasidnm d
          ON d.yrd_gbid = u.id
         AND d.dosyaid = u.dosyaid
         AND d.donem = ${parts.periodInt}
        WHERE NOT EXISTS (
          SELECT 1
          FROM inserted_periods p
          WHERE p.id = d.id
        )
      )
      INSERT INTO yrd_gidabankasihrk (
        kullaniciid, islemtarihi, dosyaid, yardimid, yrd_gbdnmid,
        islemadi, aciklama, donem, miktar, donemadi, donemint
      )
      SELECT
        p.kullaniciid, NOW(), p.dosyaid, p.yrd_gbid, p.id,
        ${String(parts.periodInt)}, ${'Odenmedi'}, ${parts.periodInt}, p.miktar, ${periodName}, ${parts.periodInt}
      FROM period_rows p
      WHERE NOT EXISTS (
        SELECT 1
        FROM yrd_gidabankasihrk h
        WHERE h.yardimid = p.yrd_gbid
          AND (
            h.yrd_gbdnmid = p.id
            OR (
              h.dosyaid = p.dosyaid
              AND h.donemint = ${parts.periodInt}
            )
          )
      )
    `

    globalForFoodBankPeriods.foodBankPeriodRunDate = parts.dateKey
  })()

  try {
    await globalForFoodBankPeriods.foodBankPeriodPromise
  } finally {
    globalForFoodBankPeriods.foodBankPeriodPromise = undefined
  }
}
