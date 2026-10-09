import { prisma } from '@/lib/db/prisma'
import { computeNeighborhoodPaymentWindow, getDaysInMonth } from '@/lib/utils/paymentWindow'

type PeriodDb = Pick<typeof prisma, '$queryRaw' | '$queryRawUnsafe' | '$executeRawUnsafe'>

type PeriodSourceTable = 'yrd_gidabankasi' | 'yrd_destekpaketi'

type CreatePeriodOptions = {
  db?: PeriodDb
  sourceTable: PeriodSourceTable
  recordId: bigint
  fileId: bigint
  currentUserId: number | null
  periodDate?: Date
  onlyActiveAssistance?: boolean
}

function getPeriodParts(date = new Date()) {
  const year = date.getFullYear()
  const month = date.getMonth() + 1
  const monthName = date.toLocaleDateString('tr-TR', { month: 'long' })
  const periodName = monthName.charAt(0).toLocaleUpperCase('tr-TR') + monthName.slice(1)
  const periodStart = `${year}-${String(month).padStart(2, '0')}-01`

  return {
    year,
    month,
    periodInt: year * 100 + month,
    periodName,
    periodStart,
  }
}

function displayDate(dateText: string) {
  const [year, month, day] = dateText.split('-')
  return `${day}.${month}.${year}`
}

async function getNeighborhoodPaymentWindowDays(db: PeriodDb, fileId: bigint) {
  const rows = await db.$queryRaw<{ payment_day: number | null; payment_end_day: number | null }[]>`
    SELECT m.odemegunu::int AS payment_day, m.odemegunubitis::int AS payment_end_day
    FROM dosyalar d
    LEFT JOIN mahalleler m
      ON m.id = d.mahalleid
      OR lower(trim(m.mahalleadi)) = lower(trim(d.mahalleadi))
    WHERE d.id = ${fileId}
    ORDER BY CASE WHEN m.id = d.mahalleid THEN 0 ELSE 1 END
    LIMIT 1
  `

  return { startDay: rows[0]?.payment_day ?? null, endDay: rows[0]?.payment_end_day ?? null }
}

async function createFoodBankPeriod(options: CreatePeriodOptions) {
  const db = options.db ?? prisma
  const parts = getPeriodParts(options.periodDate)
  const { startDay, endDay } = await getNeighborhoodPaymentWindowDays(db, options.fileId)
  const { startDate: paymentStartDate, endDate: paymentEndDate } = computeNeighborhoodPaymentWindow(
    startDay, endDay, parts.year, parts.month,
  )
  const periodDescription = `\u00d6denmedi -- ${parts.periodName} -- ${displayDate(paymentStartDate)}`
  const rows = await db.$queryRaw<{ inserted_count: number }[]>`
    WITH target AS (
      SELECT t.id, t.kullaniciid, t.dosyaid, t.miktar
      FROM yrd_gidabankasi t
      WHERE t.id = ${options.recordId}
        AND t.dosyaid = ${options.fileId}
        AND (${Boolean(options.onlyActiveAssistance)}::boolean = false OR t.durumu = 2)
        -- Kullanici istegi (kritik duzeltme, 2. deneme): ILK denemede
        -- "t.donemint IS DISTINCT FROM periodInt" kullanilmisti - bu
        -- YETERSIZ/YANLIS CIKTI: convert-application/route.ts (muracaati
        -- yardima donusturme akisi) bu fonksiyonu cagirmadan HEMEN ONCE,
        -- AYNI islemde donemint'i ZATEN bu ayin degerine esitliyor - bu
        -- yuzden donemint karsilastirmasi HER ZAMAN "ayni" cikip donem
        -- kaydinin (yrd_gidabankasidnm) hic OLUSTURULMAMASINA yol acardi.
        -- Do\u011fru sinyal, "bu donem icin zaten bir kayit/izleme satiri VAR
        -- MI" sorusudur - asagidaki "inserted_periods" adiminin ZATEN
        -- kullandigi AYNI NOT EXISTS kontrolu, simdi PARENT SATIRIN
        -- KENDISINI guncellemeden ONCE de calistiriliyor. Boylece: (a)
        -- zaten bu donem icin kaydi (odenmis ya da odenmemis) olan bir
        -- yardimi duzenleyip kaydetmek dnm_durumu'nu ARTIK resetlemez,
        -- (b) yeni donusturulen/HENUZ bu donem icin kaydi olmayan bir
        -- yardimda donem dogru sekilde olusturulmaya devam eder.
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
          donemadi = ${parts.periodName},
          donemint = ${parts.periodInt},
          donemstr = ${parts.periodName},
          dnm_bastarih = ${paymentStartDate}::date,
          dnm_durumu = 0,
          dnm_durumutarih = ${paymentEndDate}::date,
          dnm_durumuaciklama = ${periodDescription},
          -- Kullanici istegi: dosya sahibinin adresi/mahallesi degisince
          -- alisveris gunu de degisir - manuel donem olusturuldugunda bu
          -- "donmus" (yalnizca ilk kayitta - hic - yazilan) sutun da DOSYANIN
          -- SU ANKI mahallesine gore guncellensin (barkod/form baski
          -- "gida.odeme_gunu" tokeni DOGRUDAN bu sutunu okuyor - ekrandaki
          -- odeme_baslangic/bitis zaten canli hesaplaniyordu, bu sutun
          -- degildi). Yeni mahallede eslesme bulunamazsa (startDay NULL)
          -- eski deger korunur.
          odemegunu = COALESCE(${startDay}, t.odemegunu)
      FROM target e
      WHERE t.id = e.id
      RETURNING t.id, COALESCE(t.kullaniciid, ${options.currentUserId}) AS kullaniciid, t.dosyaid, t.miktar
    ),
    inserted_periods AS (
      INSERT INTO yrd_gidabankasidnm (
        kullaniciid, islemtarihi, dosyaid, yrd_gbid, bastarih,
        miktar, aciklama, durumu, durumutarih, durumuaciklama, donem
      )
      SELECT
        u.kullaniciid, NOW(), u.dosyaid, u.id, ${paymentStartDate}::date,
        u.miktar, ${periodDescription}, 0, ${paymentEndDate}::date,
        ${periodDescription}, ${parts.periodInt}
      FROM updated u
      WHERE NOT EXISTS (
        SELECT 1
        FROM yrd_gidabankasidnm d
        WHERE d.yrd_gbid = u.id
          AND d.dosyaid = u.dosyaid
          AND d.donem = ${parts.periodInt}
      )
      RETURNING id, kullaniciid, dosyaid, yrd_gbid, miktar
    ),
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
    ),
    inserted_movements AS (
      INSERT INTO yrd_gidabankasihrk (
        kullaniciid, islemtarihi, dosyaid, yardimid, yrd_gbdnmid,
        islemadi, aciklama, donem, miktar, donemadi, donemint
      )
      SELECT
        p.kullaniciid, NOW(), p.dosyaid, p.yrd_gbid, p.id,
        ${String(parts.periodInt)}, ${'\u00d6denmedi'}, ${parts.periodInt}, p.miktar, ${parts.periodName}, ${parts.periodInt}
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
      RETURNING id
    )
    SELECT COUNT(*)::int AS inserted_count FROM inserted_movements
  `

  return rows[0]?.inserted_count ?? 0
}

// "yrd_destekpaketi.odemegunu" sutunu prisma/schema.prisma icinde
// tanimliydi ama canli veritabanina hic ALTER TABLE ile uygulanmamisti
// (bu projede "prisma migrate" kullanilmiyor - CREATE TABLE/ALTER TABLE IF
// NOT EXISTS deseniyle idempotent kuruluyor). Bu eksiklik "column
// t.odemegunu does not exist" (42703) hatasina yol aciyordu. PostgreSQL
// 9.4'te "ADD COLUMN IF NOT EXISTS" desteklenmedigi icin (9.6+ ozelligi)
// once information_schema'dan kontrol edip oyle ekliyoruz - bkz.
// app/api/workflow/on-inceleme/report/route.ts'deki ayni desen.
let destekPaketiOdemegunuEnsured = false
async function ensureDestekPaketiOdemegunuColumn(db: PeriodDb) {
  if (destekPaketiOdemegunuEnsured) return

  const columnResult = await db.$queryRawUnsafe<Array<{ column_name: string }>>(`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'yrd_destekpaketi'
      AND column_name = 'odemegunu';
  `)

  if (columnResult.length === 0) {
    await db.$executeRawUnsafe(`
      ALTER TABLE public.yrd_destekpaketi ADD COLUMN odemegunu INTEGER;
    `)
  }

  destekPaketiOdemegunuEnsured = true
}

async function createSupportPackagePeriod(options: CreatePeriodOptions) {
  const db = options.db ?? prisma
  await ensureDestekPaketiOdemegunuColumn(db)
  const parts = getPeriodParts(options.periodDate)
  const { startDay: supportPackagePaymentDay } = await getNeighborhoodPaymentWindowDays(db, options.fileId)
  const paymentStartDay =
    supportPackagePaymentDay && supportPackagePaymentDay >= 1
      ? Math.min(supportPackagePaymentDay, getDaysInMonth(parts.year, parts.month))
      : 1
  const paymentStartDate = `${parts.year}-${String(parts.month).padStart(2, '0')}-${String(paymentStartDay).padStart(2, '0')}`
  const periodDescription = `\u00d6denmedi -- ${parts.periodName} -- ${displayDate(paymentStartDate)}`
  const rows = await db.$queryRaw<{ inserted_count: number }[]>`
    WITH target AS (
      SELECT t.id, t.kullaniciid, t.dosyaid, t.miktar
      FROM yrd_destekpaketi t
      WHERE t.id = ${options.recordId}
        AND t.dosyaid = ${options.fileId}
        AND (${Boolean(options.onlyActiveAssistance)}::boolean = false OR t.durumu = 2)
        -- Kullanici istegi (kritik duzeltme, 2. deneme) - bkz.
        -- createFoodBankPeriod'daki AYNI notun bire bir esdegeri: donemint
        -- karsilastirmasi yerine, "bu donem icin zaten bir hareket
        -- (yrd_destekpaketihrk) kaydi VAR MI" kontrolu kullanilir - asagidaki
        -- "inserted_movements" adiminin ZATEN kullandigi AYNI NOT EXISTS
        -- kontrolu, simdi parent satiri guncellemeden ONCE de calistiriliyor.
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
      SET donem = ${parts.periodName},
          donemint = ${parts.periodInt},
          donemstr = ${parts.periodName},
          dnm_bastarih = ${paymentStartDate}::date,
          dnm_durumu = 0,
          dnm_durumuaciklama = ${periodDescription},
          -- bkz. createFoodBankPeriod'daki AYNI not: dosyanin SU ANKI
          -- mahallesine gore alisveris gunu de guncellensin (baski
          -- "destekpaketi.odeme_gunu" tokeni bu sutunu okuyor).
          odemegunu = COALESCE(${supportPackagePaymentDay}, t.odemegunu)
      FROM target e
      WHERE t.id = e.id
      RETURNING t.id, COALESCE(t.kullaniciid, ${options.currentUserId}) AS kullaniciid, t.dosyaid, t.miktar
    ),
    inserted_movements AS (
      INSERT INTO yrd_destekpaketihrk (
        kullaniciid, islemtarihi, dosyaid, yardimid, islemadi, aciklama, miktar
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
      RETURNING id
    )
    SELECT COUNT(*)::int AS inserted_count FROM inserted_movements
  `

  return rows[0]?.inserted_count ?? 0
}

export async function createAssistancePeriod(options: CreatePeriodOptions) {
  if (options.sourceTable === 'yrd_gidabankasi') {
    return createFoodBankPeriod(options)
  }

  return createSupportPackagePeriod(options)
}
