import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db/prisma'
import { requireApiAccess } from '@/lib/apiAuth'
import { userService } from '@/lib/services'
import { getAuditMetaFromRequest, stampAuditUser } from '@/lib/db/auditContext'

export const dynamic = 'force-dynamic'

type FoodBankPaymentPayload = {
  fileId?: string
  recordId?: string
  paymentDate?: string
  description?: string
}

type FoodBankRecordRow = {
  id: bigint
  dosyaid: bigint | null
  miktar: number | null
  already_paid: boolean
}

function cleanBigInt(value: unknown) {
  if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'bigint') return null
  const text = String(value).trim()
  return /^\d+$/.test(text) ? BigInt(text) : null
}

function cleanDate(value: unknown) {
  if (typeof value !== 'string') return null
  const text = value.trim()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return null

  const [year, month, day] = text.split('-').map(Number)
  const date = new Date(Date.UTC(year, month - 1, day))

  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() + 1 !== month ||
    date.getUTCDate() !== day
  ) {
    return null
  }

  return { text, year, month }
}

function getPeriodName(year: number, month: number) {
  const date = new Date(Date.UTC(year, month - 1, 1))
  const monthName = date.toLocaleDateString('tr-TR', { month: 'long', timeZone: 'UTC' })
  return monthName.charAt(0).toLocaleUpperCase('tr-TR') + monthName.slice(1)
}

async function getCurrentUserId() {
  const user = await userService.getCurrent()
  const userId = user?.id ? Number(user.id) : null

  return Number.isInteger(userId) ? userId : null
}

export async function POST(request: Request) {
  try {
    const accessDenied = await requireApiAccess({ action: 'assistance.update', page: '/documents' })
    if (accessDenied) return accessDenied

    const body = (await request.json()) as FoodBankPaymentPayload
    const fileId = cleanBigInt(body.fileId)
    const recordId = cleanBigInt(body.recordId)
    const paymentDate = cleanDate(body.paymentDate)
    const description = typeof body.description === 'string' ? body.description.trim() : ''

    if (!fileId || !recordId || !paymentDate || !description) {
      return NextResponse.json(
        { success: false, error: 'Kayit, tarih ve aciklama bilgisi zorunludur.' },
        { status: 400 },
      )
    }

    const periodInt = paymentDate.year * 100 + paymentDate.month
    const periodName = getPeriodName(paymentDate.year, paymentDate.month)
    const paidPeriodName = `${periodName} - Ödendi`
    const paymentPeriodLabel = `${String(paymentDate.month).padStart(2, '0')}-${paymentDate.year}`
    const periodStart = `${paymentDate.year}-${String(paymentDate.month).padStart(2, '0')}-01`
    const currentUserId = await getCurrentUserId()

    const result = await prisma.$transaction(async (tx) => {
      await stampAuditUser(tx, undefined, getAuditMetaFromRequest(request))

      const records = await tx.$queryRaw<FoodBankRecordRow[]>`
        SELECT
          t.id,
          t.dosyaid,
          t.miktar,
          EXISTS (
            SELECT 1
            FROM yrd_gidabankasihrk h
            WHERE h.yardimid = t.id
              AND h.dosyaid = t.dosyaid
              AND h.donemint = t.donemint
              AND lower(trim(COALESCE(h.islemadi, ''))) IN ('ode', 'öde')
          ) AS already_paid
        FROM yrd_gidabankasi t
        WHERE t.id = ${recordId}
          AND t.dosyaid = ${fileId}
        LIMIT 1
        FOR UPDATE
      `
      const record = records[0]

      if (!record) {
        return { updatedCount: 0, alreadyPaid: false, periodRecordId: null as bigint | null, movementRecordId: null as bigint | null }
      }

      if (record.already_paid) {
        return { updatedCount: 0, alreadyPaid: true, periodRecordId: null as bigint | null, movementRecordId: null as bigint | null }
      }

      const updatedCount = await tx.$executeRaw`
        UPDATE yrd_gidabankasi
        SET ensondonem = ${periodInt},
            donemadi = ${paidPeriodName},
            donemint = ${periodInt},
            donemstr = ${paidPeriodName},
            dnm_bastarih = ${periodStart}::date,
            dnm_durumu = 1,
            dnm_durumutarih = ${paymentDate.text}::date,
            dnm_durumuaciklama = ${description}
        WHERE id = ${recordId}
          AND dosyaid = ${fileId}
      `

      const periodRows = await tx.$queryRaw<{ id: bigint }[]>`
        WITH updated_period AS (
          UPDATE yrd_gidabankasidnm
          SET kullaniciid = ${currentUserId},
              islemtarihi = NOW(),
              miktar = ${record.miktar},
              aciklama = ${description},
              durumu = 1,
              durumutarih = ${paymentDate.text}::date,
              durumuaciklama = ${description}
          WHERE yrd_gbid = ${recordId}
            AND dosyaid = ${fileId}
            AND donem = ${periodInt}
          RETURNING id
        ),
        inserted_period AS (
          INSERT INTO yrd_gidabankasidnm (
            kullaniciid, islemtarihi, dosyaid, yrd_gbid, bastarih,
            miktar, aciklama, durumu, durumutarih, durumuaciklama, donem
          )
          SELECT
            ${currentUserId}, NOW(), ${fileId}, ${recordId}, ${periodStart}::date,
            ${record.miktar}, ${description}, 1, ${paymentDate.text}::date, ${description}, ${periodInt}
          WHERE NOT EXISTS (SELECT 1 FROM updated_period)
          RETURNING id
        )
        SELECT id FROM updated_period
        UNION ALL
        SELECT id FROM inserted_period
      `
      const periodRecordId = periodRows[0]?.id ?? null

      const movementRows = await tx.$queryRaw<{ id: bigint }[]>`
        INSERT INTO yrd_gidabankasihrk (
          kullaniciid, islemtarihi, dosyaid, yardimid, yrd_gbdnmid,
          islemadi, aciklama, donem, miktar, donemadi, donemint
        )
        VALUES (
          ${currentUserId}, ${paymentDate.text}::date, ${fileId}, ${recordId}, ${periodRecordId},
          ${'Ode'}, ${description}, ${periodInt}, ${record.miktar}, ${paymentPeriodLabel}, ${periodInt}
        )
        RETURNING id
      `

      return { updatedCount, alreadyPaid: false, periodRecordId, movementRecordId: movementRows[0]?.id ?? null }
    })

    if (result.alreadyPaid) {
      return NextResponse.json(
        { success: false, error: 'Bu gida bankasi kaydinin odemesi daha once yapilmis.' },
        { status: 409 },
      )
    }

    if (result.updatedCount === 0) {
      return NextResponse.json(
        { success: false, error: 'Odeme yapilacak gida bankasi kaydi bulunamadi.' },
        { status: 404 },
      )
    }

    return NextResponse.json({
      success: true,
      data: {
        updatedCount: result.updatedCount,
        periodRecordId: result.periodRecordId?.toString() ?? null,
        movementRecordId: result.movementRecordId?.toString() ?? null,
      },
    })
  } catch (error) {
    console.error('Food bank payment error:', error)
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Odeme kaydedilemedi.' },
      { status: 500 },
    )
  }
}
