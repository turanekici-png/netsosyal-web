import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db/prisma'
import { requireApiAccess } from '@/lib/apiAuth'
import { userService } from '@/lib/services'
import { getAuditMetaFromRequest, stampAuditUser } from '@/lib/db/auditContext'

export const dynamic = 'force-dynamic'

type SupportPackagePaymentPayload = {
  fileId?: string
  recordId?: string
  paymentDate?: string
  description?: string
}

type SupportPackageRecordRow = {
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

function getDaysInMonth(year: number, month: number) {
  return new Date(year, month, 0).getDate()
}

async function getNeighborhoodPaymentDay(fileId: bigint) {
  const rows = await prisma.$queryRaw<{ payment_day: number | null }[]>`
    SELECT m.odemegunu::int AS payment_day
    FROM dosyalar d
    LEFT JOIN mahalleler m
      ON m.id = d.mahalleid
      OR lower(trim(m.mahalleadi)) = lower(trim(d.mahalleadi))
    WHERE d.id = ${fileId}
    ORDER BY CASE WHEN m.id = d.mahalleid THEN 0 ELSE 1 END
    LIMIT 1
  `

  return rows[0]?.payment_day ?? null
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

    const body = (await request.json()) as SupportPackagePaymentPayload
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
    const neighborhoodPaymentDay = await getNeighborhoodPaymentDay(fileId)
    const paymentStartDay =
      neighborhoodPaymentDay && neighborhoodPaymentDay >= 1
        ? Math.min(neighborhoodPaymentDay, getDaysInMonth(paymentDate.year, paymentDate.month))
        : 1
    const periodStart = `${paymentDate.year}-${String(paymentDate.month).padStart(2, '0')}-${String(paymentStartDay).padStart(2, '0')}`
    const currentUserId = await getCurrentUserId()

    const result = await prisma.$transaction(async (tx) => {
      await stampAuditUser(tx, undefined, getAuditMetaFromRequest(request))

      const records = await tx.$queryRaw<SupportPackageRecordRow[]>`
        SELECT
          t.id,
          t.dosyaid,
          t.miktar,
          EXISTS (
            SELECT 1
            FROM yrd_destekpaketihrk h
            WHERE h.yardimid = t.id
              AND h.dosyaid = t.dosyaid
              AND (EXTRACT(YEAR FROM h.islemtarihi)::int * 100 + EXTRACT(MONTH FROM h.islemtarihi)::int) = t.donemint
              AND lower(trim(COALESCE(h.islemadi, ''))) IN ('ode', 'öde')
          ) AS already_paid
        FROM yrd_destekpaketi t
        WHERE t.id = ${recordId}
          AND t.dosyaid = ${fileId}
        LIMIT 1
        FOR UPDATE
      `
      const record = records[0]

      if (!record) {
        return { updatedCount: 0, alreadyPaid: false, movementRecordId: null as bigint | null }
      }

      if (record.already_paid) {
        return { updatedCount: 0, alreadyPaid: true, movementRecordId: null as bigint | null }
      }

      const updatedCount = await tx.$executeRaw`
        UPDATE yrd_destekpaketi
        SET donem = ${paidPeriodName},
            donemint = ${periodInt},
            donemstr = ${paidPeriodName},
            dnm_bastarih = ${periodStart}::date,
            dnm_durumu = 1,
            dnm_durumuaciklama = ${description}
        WHERE id = ${recordId}
          AND dosyaid = ${fileId}
      `

      const movementRows = await tx.$queryRaw<{ id: bigint }[]>`
        INSERT INTO yrd_destekpaketihrk (
          kullaniciid, islemtarihi, dosyaid, yardimid,
          islemadi, aciklama, miktar
        )
        VALUES (
          ${currentUserId}, ${paymentDate.text}::date, ${fileId}, ${recordId},
          ${'Ode'}, ${description}, ${record.miktar}
        )
        RETURNING id
      `

      return { updatedCount, alreadyPaid: false, movementRecordId: movementRows[0]?.id ?? null }
    })

    if (result.alreadyPaid) {
      return NextResponse.json(
        { success: false, error: 'Bu destek paketi kaydinin odemesi bu donem icin daha once yapilmis.' },
        { status: 409 },
      )
    }

    if (result.updatedCount === 0) {
      return NextResponse.json(
        { success: false, error: 'Odeme yapilacak destek paketi kaydi bulunamadi.' },
        { status: 404 },
      )
    }

    return NextResponse.json({
      success: true,
      data: {
        updatedCount: result.updatedCount,
        movementRecordId: result.movementRecordId?.toString() ?? null,
      },
    })
  } catch (error) {
    console.error('Support package payment error:', error)
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Odeme kaydedilemedi.' },
      { status: 500 },
    )
  }
}
