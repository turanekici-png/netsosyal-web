import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db/prisma'
import { requireApiAccess, requireAuthorizedPersonnelOrAdmin } from '@/lib/apiAuth'
import { userService } from '@/lib/services'
import { createAssistancePeriod } from '@/lib/services/assistancePeriod.service'
import { getAuditMetaFromRequest, withAuditedWrite } from '@/lib/db/auditContext'
import { computeNeighborhoodPaymentWindow } from '@/lib/utils/paymentWindow'

export const dynamic = 'force-dynamic'

const CONVERTIBLE_TABLES = new Set([
  'yrd_ekmek',
  'yrd_gidabankasi',
  'yrd_destekpaketi',
  'yrd_haziryemek',
])

// Bu turlerin "donem" (periyodik odeme) kavrami YOK - Gıda Bankası/Destek
// Paketi'nin aksine tek seferlik/vaka bazli yardimlardir, bu yuzden AYNI
// dosyada BIRDEN FAZLA acilabilirler (findPreviouslyOpenedAssistance
// kisitlamasi UYGULANMAZ). "Onay Bekleyenler > Uygun Görüş İste" detay
// penceresinden "Onayla" ile sadece durumu=2 (aktif) yapilirlar - CONVERTIBLE_TABLES
// gibi donem/hareket kaydi OLUSTURULMAZ.
const SIMPLE_ACTIVATE_TABLES = new Set([
  'yrd_giyim',
  'yrd_ddgidadosyali',
  'yrd_ayninakti',
])

type ConvertApplicationPayload = {
  sourceTable?: string
  recordId?: string
  fileId?: string
  // 'convert' (varsayilan) = "Yeni Müracaat" (durumu=0) bir kaydi yardima
  // dönüştürür. 'reactivate' = zaten ACILMIS ama pasif/iptal/durmus
  // (durumu != 0) olan bir yardimi, "Onay Bekleyenler > Uygun Görüş İste"
  // detay penceresindeki "Mevcut Yardımlar" bölümünden TEK TIKLA tekrar
  // aktif eder - var olan miktar/dönem bilgisi degistirilmeden kullanilir
  // (kullanicinin acikca istegi).
  mode?: 'convert' | 'reactivate'
}

function cleanBigInt(value: unknown) {
  if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'bigint') return null
  const text = String(value).trim()
  return /^\d+$/.test(text) ? BigInt(text) : null
}

function quoteIdentifier(identifier: string) {
  return `"${identifier.replace(/"/g, '""')}"`
}

// Ekmek/Hazır Yemek gibi "sureli" (donem = "N Ay" bicimindeki serbest metin)
// yardimlarda, bir muracaat yardima donusturulduğunde/tekrar aktif
// edildiginde bastarih HER ZAMAN bugune sabitleniyor - ANCAK bittarih hic
// dokunulmadigi icin bos (NULL) kalabiliyor veya eski/artik anlamsiz bir
// tarihte donuk kalabiliyor ("bazılarında bitiş tarihi görünmüyor" sikayeti).
// Bu SQL ifadesi, kaydin KENDI donem alanindaki "N Ay" bilgisini okuyup
// bittarih'i YENI bastarih (bugun) uzerinden yeniden hesaplar. Gıda Bankası/
// Destek Paketi gibi donem alani takvim ay adi olan (dönem formatı UYMAYAN)
// turlerde ifade hicbir sey eslemez ve bittarih DOKUNULMADAN kalir (bu
// turlerde "bitis tarihi" kavrami zaten yok - odeme penceresi ayri alanlarda
// takip edilir).
const BITTARIH_FROM_DONEM_SQL =
  "CASE WHEN donem ~ '^[0-9]+[[:space:]]*[Aa]y' THEN (CURRENT_DATE + ((regexp_replace(donem, '[^0-9]', '', 'g'))::int || ' months')::interval)::date ELSE bittarih END"
// Reaktivasyonda (mode: 'reactivate') ise eslesmeyen durumlarda ESKI/STALE
// bittarih DEGERI degil, NULL yazilir - onceki iptalden kalma tarih
// yanlislikla "aktif" bir kayitta gorunmeye devam etmesin diye.
const BITTARIH_FROM_DONEM_OR_NULL_SQL =
  "CASE WHEN donem ~ '^[0-9]+[[:space:]]*[Aa]y' THEN (CURRENT_DATE + ((regexp_replace(donem, '[^0-9]', '', 'g'))::int || ' months')::interval)::date ELSE NULL END"

function getCurrentPeriodParts() {
  const now = new Date()
  const year = now.getFullYear()
  const month = now.getMonth() + 1
  const monthName = now.toLocaleDateString('tr-TR', { month: 'long' })
  const capitalizedMonthName = monthName.charAt(0).toLocaleUpperCase('tr-TR') + monthName.slice(1)
  const periodStart = `${year}-${String(month).padStart(2, '0')}-01`

  return {
    periodInt: year * 100 + month,
    periodName: capitalizedMonthName,
    periodStart,
    periodDescription: `Ödenmedi -- ${capitalizedMonthName} -- 01.${String(month).padStart(2, '0')}.${year}`,
  }
}

function displayDate(dateText: string) {
  const [year, month, day] = dateText.split('-')
  return `${day}.${month}.${year}`
}

async function getNeighborhoodPaymentWindowDays(fileId: bigint) {
  const rows = await prisma.$queryRaw<{ payment_day: number | null; payment_end_day: number | null }[]>`
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

async function getTableColumns(tableName: string) {
  const rows = await prisma.$queryRaw<{ column_name: string }[]>`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = ${tableName}
  `

  return new Set(rows.map((row) => row.column_name))
}

async function getCurrentUserId() {
  const user = await userService.getCurrent()
  const userId = user?.id ? Number(user.id) : null

  return Number.isInteger(userId) ? userId : null
}

const ASSISTANCE_TYPE_LABELS: Record<string, string> = {
  yrd_ekmek: 'Ekmek Yardımı',
  yrd_gidabankasi: 'Gıda Bankası Yardımı',
  yrd_destekpaketi: 'Destek Paketi',
  yrd_haziryemek: 'Hazır Yemek Yardımı',
}

// Bu dosyada, AYNI yardim turunden ("durumu" 0 = "yeni muracaat" DEGIL,
// yani en az bir kez GERCEKTEN acilmis) baska bir kayit var mi? Aktif/pasif
// (durduruldu/iptal/tamamlandi) farketmeksizin - "durumu != 0" olan HERHANGI
// bir kayit, bu yardimin bu dosyada DAHA ONCE acildigini gosterir. Boyle bir
// kayit varsa, ayni turden ikinci bir yardimin YENIDEN acilmasina izin
// verilmez (mukerrer/duplicate kayit onlenir).
async function findPreviouslyOpenedAssistance(sourceTable: string, fileId: bigint, excludeRecordId: bigint) {
  const rows = await prisma.$queryRawUnsafe<{ id: bigint }[]>(
    `SELECT id FROM ${quoteIdentifier(sourceTable)} WHERE dosyaid = $1::bigint AND id != $2::bigint AND durumu != 0 LIMIT 1`,
    fileId.toString(),
    excludeRecordId.toString(),
  )
  return rows.length > 0
}

export async function PATCH(request: Request) {
  try {
    // Normalde "Yardım ekleme" (assistance.create) yetkisi gerekir - ANCAK
    // "Onay Bekleyenler" sayfasindan bir "Uygun Görüş İste" talebindeki
    // istenen yardimlari onaylayan Yetkili Personel (veya admin), bu
    // yetkiye sahip olmayabilir (o baska bir islem yetkisi). Bu yuzden IKI
    // yoldan biri yeterli: normal islem yetkisi VEYA Yetkili Personel/admin.
    const actionAccessDenied = await requireApiAccess({ action: 'assistance.create', page: '/documents' })
    if (actionAccessDenied) {
      const authorizedCheck = await requireAuthorizedPersonnelOrAdmin()
      if (authorizedCheck.response) return authorizedCheck.response
    }

    const body = (await request.json()) as ConvertApplicationPayload
    const sourceTable = typeof body.sourceTable === 'string' ? body.sourceTable.trim() : ''
    const recordId = cleanBigInt(body.recordId)
    const fileId = cleanBigInt(body.fileId)

    if (!CONVERTIBLE_TABLES.has(sourceTable) && !SIMPLE_ACTIVATE_TABLES.has(sourceTable)) {
      return NextResponse.json(
        { success: false, error: 'Bu müracaat türü yardıma dönüştürülemez.' },
        { status: 400 },
      )
    }

    if (!recordId || !fileId) {
      return NextResponse.json(
        { success: false, error: 'Kayıt ve dosya bilgisi zorunludur.' },
        { status: 400 },
      )
    }

    if (body.mode === 'reactivate') {
      const columns = await getTableColumns(sourceTable)
      const assignments = ['durumu = 2', 'durumutarih = CURRENT_DATE', 'durumuaciklama = NULL']
      // Giyim / Donem Disi Gida: odeme baslangic/bitis tarihi belirlenmez
      // (bkz. asagidaki SIMPLE_ACTIVATE blogundaki ayni not).
      const skipPaymentDates = sourceTable === 'yrd_giyim' || sourceTable === 'yrd_ddgidadosyali'
      if (!skipPaymentDates && columns.has('bastarih')) assignments.push('bastarih = CURRENT_DATE')
      if (!skipPaymentDates && columns.has('bittarih')) {
        assignments.push(columns.has('donem') ? `bittarih = ${BITTARIH_FROM_DONEM_OR_NULL_SQL}` : 'bittarih = NULL')
      }
      if (columns.has('islemtarihi')) assignments.push('islemtarihi = NOW()')

      const updatedCount = await withAuditedWrite((tx) => tx.$executeRawUnsafe(
        `
          UPDATE ${quoteIdentifier(sourceTable)}
          SET ${assignments.join(', ')}
          WHERE id = $1::bigint AND dosyaid = $2::bigint AND durumu != 0
        `,
        recordId.toString(),
        fileId.toString(),
      ), getAuditMetaFromRequest(request))

      if (updatedCount === 0) {
        return NextResponse.json(
          { success: false, error: 'Aktif hale getirilecek yardım kaydı bulunamadı.' },
          { status: 404 },
        )
      }

      return NextResponse.json({ success: true, updatedCount })
    }

    if (SIMPLE_ACTIVATE_TABLES.has(sourceTable)) {
      const columns = await getTableColumns(sourceTable)
      const assignments = ['durumu = 2', 'durumutarih = CURRENT_DATE', 'durumuaciklama = NULL']
      // Kullanici istegi (28 Agustos 2026): Giyim ve Donem Disi Gida
      // yardimlari, yardima donusturulurken ODEME BASLANGIC/BITIS tarihi
      // (bastarih/bittarih) BELIRLEMESIN - sadece durumu degissin, odeme
      // yapildiginda ayrica islenir. (Nakit "yrd_ayninakti" bunun disinda -
      // kendi odeme akisi var, bastarih bugune sabitlenmeye devam eder.)
      const skipPaymentDates = sourceTable === 'yrd_giyim' || sourceTable === 'yrd_ddgidadosyali'
      if (!skipPaymentDates && columns.has('bastarih')) assignments.push('bastarih = CURRENT_DATE')
      if (columns.has('islemtarihi')) assignments.push('islemtarihi = NOW()')

      const updatedCount = await withAuditedWrite((tx) => tx.$executeRawUnsafe(
        `
          UPDATE ${quoteIdentifier(sourceTable)}
          SET ${assignments.join(', ')}
          WHERE id = $1::bigint AND dosyaid = $2::bigint AND durumu = 0
        `,
        recordId.toString(),
        fileId.toString(),
      ), getAuditMetaFromRequest(request))

      if (updatedCount === 0) {
        return NextResponse.json(
          { success: false, error: 'Onaylanacak müracaat kaydı bulunamadı.' },
          { status: 404 },
        )
      }

      return NextResponse.json({ success: true, updatedCount })
    }

    if (await findPreviouslyOpenedAssistance(sourceTable, fileId, recordId)) {
      const typeLabel = ASSISTANCE_TYPE_LABELS[sourceTable] || 'Bu yardım'
      return NextResponse.json(
        { success: false, error: `Bu dosyada daha önce açılmış bir ${typeLabel} kaydı var. Aynı yardım türü (aktif veya pasif) bir dosyada birden fazla açılamaz.` },
        { status: 409 },
      )
    }

    const columns = await getTableColumns(sourceTable)
    const periodParts = getCurrentPeriodParts()
    const periodYear = Math.trunc(periodParts.periodInt / 100)
    const periodMonth = periodParts.periodInt % 100
    const { startDay: neighborhoodPaymentDay, endDay: neighborhoodPaymentEndDay } =
      sourceTable === 'yrd_gidabankasi' || sourceTable === 'yrd_destekpaketi'
        ? await getNeighborhoodPaymentWindowDays(fileId)
        : { startDay: null, endDay: null }
    const { startDate: paymentStartDate, endDate: paymentEndDate } = computeNeighborhoodPaymentWindow(
      neighborhoodPaymentDay, neighborhoodPaymentEndDay, periodYear, periodMonth,
    )
    const paymentDescription = `Ödenmedi -- ${periodParts.periodName} -- ${displayDate(paymentStartDate)}`
    const assignments = [
      'durumu = 2',
      'durumutarih = CURRENT_DATE',
    ]

    // Kullanicinin acikca istegi uzerine: bir muracaat yardima donusturuldugu
    // AN, baslangic tarihi HER ZAMAN o gunun tarihine sabitlenir (eski/farkli
    // bir tarih varsa bile uzerine yazilir) - Ekmek, Gida Bankasi, Destek
    // Paketi ve Hazir Yemek yardimlarinin hepsi icin (CONVERTIBLE_TABLES
    // zaten sadece bu 4 tabloyu icerir).
    if (columns.has('bastarih')) assignments.push('bastarih = CURRENT_DATE')
    // Ekmek/Hazır Yemek gibi sureli (donem = "N Ay") turlerde, bitis tarihi
    // de YENI baslangica gore yeniden hesaplanir - boylece "Bitiş Tarihi"
    // sutunu bos kalmaz (bkz. BITTARIH_FROM_DONEM_SQL yorumu).
    if (columns.has('bittarih') && columns.has('donem')) assignments.push(`bittarih = ${BITTARIH_FROM_DONEM_SQL}`)

    if (sourceTable !== 'yrd_ekmek' && sourceTable !== 'yrd_haziryemek') {
      if (columns.has('donem')) assignments.push(`donem = ''`)
      if (columns.has('ensondonem')) assignments.push(`ensondonem = ${periodParts.periodInt}`)
      if (columns.has('donemadi')) assignments.push(`donemadi = '${periodParts.periodName}'`)
      if (columns.has('donemint')) assignments.push(`donemint = ${periodParts.periodInt}`)
      if (columns.has('donemstr')) assignments.push(`donemstr = '${periodParts.periodName}'`)
      if (columns.has('dnm_bastarih')) assignments.push(`dnm_bastarih = '${paymentStartDate}'::date`)
      if ((sourceTable === 'yrd_gidabankasi' || sourceTable === 'yrd_destekpaketi') && columns.has('dnm_durumutarih')) assignments.push(`dnm_durumutarih = '${paymentEndDate}'::date`)
      if (columns.has('dnm_durumu')) assignments.push('dnm_durumu = 0')
      if (columns.has('dnm_durumuaciklama')) assignments.push(`dnm_durumuaciklama = '${paymentDescription}'`)
    }
    if (columns.has('islemtarihi')) assignments.push('islemtarihi = NOW()')

    const result = await withAuditedWrite(async (tx) => {
      let updatedCount = await tx.$executeRawUnsafe(
        `
          UPDATE ${quoteIdentifier(sourceTable)}
          SET ${assignments.join(', ')}
          WHERE id = $1::bigint
            AND dosyaid = $2::bigint
            AND durumu = 0
        `,
        recordId.toString(),
        fileId.toString(),
      )

      if (updatedCount === 0 && (sourceTable === 'yrd_ekmek' || sourceTable === 'yrd_haziryemek')) {
        updatedCount = await tx.$executeRawUnsafe(
          `
            UPDATE ${quoteIdentifier(sourceTable)}
            SET ${assignments.join(', ')}
            WHERE id = $1::bigint
              AND dosyaid = $2::bigint
          `,
          recordId.toString(),
          fileId.toString(),
        )
      }

      if (updatedCount === 0 && sourceTable === 'yrd_destekpaketi') {
        const currentUserId = await getCurrentUserId()
        const repairedRows = await tx.$queryRaw<{ id: bigint }[]>`
          INSERT INTO yrd_destekpaketihrk (
            kullaniciid, islemtarihi, dosyaid, yardimid, islemadi, aciklama, miktar
          )
          SELECT
            ${currentUserId},
            NOW(),
            t.dosyaid,
            t.id,
            COALESCE(NULLIF(t.donemint::text, ''), ${String(periodParts.periodInt)}),
            COALESCE(NULLIF(t.dnm_durumuaciklama, ''), ${paymentDescription}),
            t.miktar
          FROM yrd_destekpaketi t
          WHERE t.id = ${recordId}
            AND t.dosyaid = ${fileId}
            AND t.durumu = 2
            AND NOT EXISTS (
              SELECT 1
              FROM yrd_destekpaketihrk h
              WHERE h.yardimid = t.id
                AND h.dosyaid = t.dosyaid
                AND h.islemadi = COALESCE(NULLIF(t.donemint::text, ''), ${String(periodParts.periodInt)})
            )
          RETURNING id
        `

        if (repairedRows.length > 0) {
          return { kind: 'repaired' as const }
        }
      }

      if (updatedCount === 0) {
        return { kind: 'notFound' as const }
      }

      if (sourceTable === 'yrd_gidabankasi') {
        const currentUserId = await getCurrentUserId()

        await tx.$executeRaw`
          INSERT INTO yrd_gidabankasihrk (
            kullaniciid, islemtarihi, dosyaid, yardimid, islemadi, aciklama, miktar
          )
          SELECT
            ${currentUserId}, NOW(), t.dosyaid, t.id, ${'Yardım Başla'}, ${"''"}, t.miktar
          FROM yrd_gidabankasi t
          WHERE t.id = ${recordId}
            AND t.dosyaid = ${fileId}
        `

        await createAssistancePeriod({
          db: tx,
          sourceTable: 'yrd_gidabankasi',
          recordId,
          fileId,
          currentUserId,
        })

        await tx.$executeRaw`
          INSERT INTO yrd_gidabankasihrk (
            kullaniciid, islemtarihi, dosyaid, yardimid, islemadi, aciklama,
            miktar, donemadi, donemint
          )
          SELECT
            ${currentUserId}, NOW(), t.dosyaid, t.id, ${String(periodParts.periodInt)}, ${'Ödenmedi'},
            t.miktar, ${periodParts.periodName}, ${periodParts.periodInt}
          FROM yrd_gidabankasi t
          WHERE t.id = ${recordId}
            AND t.dosyaid = ${fileId}
            AND NOT EXISTS (
              SELECT 1
              FROM yrd_gidabankasihrk h
              WHERE h.yardimid = t.id
                AND h.dosyaid = t.dosyaid
                AND h.donemint = ${periodParts.periodInt}
            )
        `
      }

      if (sourceTable === 'yrd_destekpaketi') {
        const currentUserId = await getCurrentUserId()

        await createAssistancePeriod({
          db: tx,
          sourceTable: 'yrd_destekpaketi',
          recordId,
          fileId,
          currentUserId,
        })

        await tx.$executeRaw`
          INSERT INTO yrd_destekpaketihrk (
            kullaniciid, islemtarihi, dosyaid, yardimid, islemadi, aciklama, miktar
          )
          SELECT
            ${currentUserId}, NOW(), t.dosyaid, t.id, ${String(periodParts.periodInt)}, ${paymentDescription},
            t.miktar
          FROM yrd_destekpaketi t
          WHERE t.id = ${recordId}
            AND t.dosyaid = ${fileId}
            AND NOT EXISTS (
              SELECT 1
              FROM yrd_destekpaketihrk h
              WHERE h.yardimid = t.id
                AND h.dosyaid = t.dosyaid
                AND h.islemadi = ${String(periodParts.periodInt)}
            )
        `
      }

      return { kind: 'ok' as const, updatedCount }
    }, getAuditMetaFromRequest(request))

    if (result.kind === 'repaired') {
      return NextResponse.json({ success: true, updatedCount: 0, repairedMovement: true })
    }

    if (result.kind === 'notFound') {
      return NextResponse.json(
        { success: false, error: 'Dönüştürülecek müracaat kaydı bulunamadı.' },
        { status: 404 },
      )
    }

    return NextResponse.json({ success: true, updatedCount: result.updatedCount })
  } catch (error) {
    console.error('Application convert error:', error)
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Müracaat yardıma dönüştürülemedi.' },
      { status: 500 },
    )
  }
}
